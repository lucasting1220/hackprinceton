/**
 * The outbox: sealed hub → phone wrappers kept on disk in outbox.json, the only reader and writer of
 * that file. It holds wrappers only, never a plaintext or a key, and is written whole and owner-only
 * through json-file.ts's one write queue before an append resolves. Phones page through it with
 * cursors `l.<epoch>.<seq>` (phone-hub.md §4.5).
 *
 *   open: no file ───────▶ a new outbox with a new epoch
 *         valid ─────────▶ loaded; messages past retention dropped
 *         unreadable ────▶ set aside as outbox.json.unreadable-<UTC time>, a new epoch, reported
 *   append: drop by age and count, and a latest-only type's older message, add
 *           ─▶ write the whole file ─ok─▶ swap in memory ─▶ the seq
 *                                   └─fails─▶ memory unchanged, rejects
 */
import { randomBytes } from "node:crypto";
import { rename } from "node:fs/promises";
import path from "node:path";
import {
  errorMessage,
  JsonFileError,
  readJsonFile,
  retryWhileBusy,
  updateJsonFile,
} from "./json-file.ts";
import * as settings from "./settings.ts";
import { isUtcTime, parseWrapper, utcSeconds, type Wrapper } from "./wire.ts";

export type OutboxEntry = Readonly<{ seq: number; created_at: string; wrapper: Wrapper }>;

/** A fetch's page (§4.5): `next` is null only while the outbox has never held a message. */
export type OutboxPage = Readonly<{ messages: readonly Wrapper[]; next: string | null }>;

/** What the LAN gateway, and later the relay, read of the outbox. */
export interface MessageSource {
  /**
   * The wrappers after `after` that `wanted` keeps, oldest first, at most `limit` (capped at
   * MESSAGES_PAGE_MAX). A null, foreign or unreadable cursor starts at the oldest kept message.
   */
  page(after: string | null, limit: number, wanted: (wrapper: Wrapper) => boolean): OutboxPage;
}

export interface OutboxOptions {
  /** The clock, in milliseconds since the Unix epoch; tests pass their own. */
  readonly now?: () => number;
  readonly log?: (line: string) => void;
}

/** An append that could not be saved. The message names the file, never a message. */
export class OutboxError extends Error {
  override name = "OutboxError";
}

type State = Readonly<{ epoch: string; nextSeq: number; messages: readonly OutboxEntry[] }>;

const EPOCH = /^[A-Za-z0-9_-]{12}$/;
const CURSOR = /^l\.([A-Za-z0-9_-]{12})\.(\d{1,15})$/;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isSeq = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 1;

/** The saved outbox, or undefined if any part of it breaks the file's rules. */
function parseState(data: unknown): State | undefined {
  if (!isRecord(data)) return undefined;
  const { schema_version: version, epoch, next_seq: nextSeq, messages } = data;
  if (version !== 1) return undefined;
  if (typeof epoch !== "string" || !EPOCH.test(epoch) || !isSeq(nextSeq)) return undefined;
  if (!Array.isArray(messages)) return undefined;
  const entries: OutboxEntry[] = [];
  for (const item of messages as unknown[]) {
    if (!isRecord(item)) return undefined;
    const { seq, created_at: createdAt, wrapper } = item;
    if (!isSeq(seq) || !isUtcTime(createdAt)) return undefined;
    if (seq <= (entries.at(-1)?.seq ?? 0) || seq >= nextSeq) return undefined;
    const parsed = parseWrapper(wrapper);
    if (!parsed.ok) return undefined;
    entries.push({ seq, created_at: createdAt, wrapper: parsed.wrapper });
  }
  return { epoch, nextSeq, messages: entries };
}

/** A UTC time that every system allows in a file name: 20261114T031245Z. */
const fileTime = (ms: number) => utcSeconds(new Date(ms)).replace(/[-:]/g, "");

export class Outbox implements MessageSource {
  readonly #file: string;
  readonly #now: () => number;
  readonly #log: (line: string) => void;
  #state: State;
  /** The end of this outbox's appends, so each builds on the one before. */
  #tail: Promise<unknown> = Promise.resolve();
  #setAside: string | undefined;
  #unwritable: string | undefined;

  private constructor(file: string, state: State, options: OutboxOptions) {
    this.#file = file;
    this.#now = options.now ?? Date.now;
    this.#log = options.log ?? ((line: string) => console.log(line));
    this.#state = state;
  }

  /** The outbox in `stateDir`. An unreadable file is set aside, never thrown or overwritten. */
  static async open(stateDir: string, options: OutboxOptions = {}): Promise<Outbox> {
    const file = path.join(stateDir, settings.OUTBOX_FILE_NAME);
    const fresh = (): State => ({
      epoch: randomBytes(settings.OUTBOX_EPOCH_BYTES).toString("base64url"),
      nextSeq: 1,
      messages: [],
    });
    let reason: string | undefined;
    let state: State | undefined;
    try {
      state = parseState(await readJsonFile(file));
      if (state === undefined) reason = "it breaks the outbox's rules";
    } catch (error) {
      if (!(error instanceof JsonFileError)) throw error;
      if (error.code !== "ENOENT") reason = error.message;
    }
    const outbox = new Outbox(file, state ?? fresh(), options);
    outbox.#state = outbox.#kept(outbox.#state);
    if (reason !== undefined) await outbox.#putAside(reason);
    return outbox;
  }

  /** The file's path. */
  get file(): string {
    return this.#file;
  }

  /**
   * Adds `wrapper` after dropping messages past retention, writes the whole file, and resolves with
   * its seq once it is on disk. A failed write rejects with OutboxError and changes nothing.
   */
  append(wrapper: Wrapper): Promise<number> {
    const run = this.#tail.then(async () => {
      const now = this.#now();
      const seq = this.#state.nextSeq;
      const entry = { seq, created_at: utcSeconds(new Date(now)), wrapper };
      const kept = this.#kept(this.#state, now);
      // Live status is latest-only (phone-hub.md §3): a new one replaces the one before.
      const latestOnly = settings.LATEST_ONLY_TYPES.includes(wrapper.type);
      const older = kept.messages.filter(
        (item) => !latestOnly || item.wrapper.type !== wrapper.type,
      );
      const next = { ...kept, nextSeq: seq + 1, messages: [...older, entry] };
      const saved = this.#kept(next, now);
      const file = {
        schema_version: 1,
        epoch: saved.epoch,
        next_seq: saved.nextSeq,
        messages: saved.messages,
      };
      try {
        await updateJsonFile(this.#file, () => file);
      } catch (error) {
        if (!(error instanceof JsonFileError)) throw error;
        this.#unwritable = error.message;
        this.#log(`L1 outbox: could not save message ${wrapper.msg_id}: ${error.message}`);
        throw new OutboxError(`the outbox can't be written: ${error.message}`, { cause: error });
      }
      this.#state = saved;
      this.#unwritable = undefined;
      return seq;
    });
    this.#tail = Promise.allSettled([run]);
    return run;
  }

  page(after: string | null, limit: number, wanted: (wrapper: Wrapper) => boolean): OutboxPage {
    const { epoch, nextSeq, messages } = this.#kept(this.#state);
    const cursor = (seq: number) => `l.${epoch}.${seq}`;
    const match = after === null ? null : CURSOR.exec(after);
    const seq = Number(match?.[2]);
    const ours = match?.[1] === epoch && seq < nextSeq;
    const from = ours ? seq : 0;
    const most = Math.min(limit, settings.MESSAGES_PAGE_MAX);
    const found: Wrapper[] = [];
    let examined: number | undefined;
    for (const entry of messages) {
      if (entry.seq <= from) continue;
      examined = entry.seq;
      if (wanted(entry.wrapper)) found.push(entry.wrapper);
      if (found.length >= most) break;
    }
    if (examined !== undefined) return { messages: found, next: cursor(examined) };
    if (ours) return { messages: found, next: after };
    return { messages: found, next: nextSeq > 1 ? cursor(nextSeq - 1) : null };
  }

  /** What the setup page should say about the outbox; empty when all is well. */
  problems(): string[] {
    const found: string[] = [];
    if (this.#unwritable !== undefined) found.push(`Alerts can't be saved: ${this.#unwritable}`);
    if (this.#setAside !== undefined) found.push(this.#setAside);
    return found;
  }

  /** `state` without the messages older than MESSAGE_RETENTION_MS or beyond the newest maximum. */
  #kept(state: State, now = this.#now()): State {
    const oldest = utcSeconds(new Date(now - settings.MESSAGE_RETENTION_MS));
    const young = state.messages.filter((entry) => entry.created_at >= oldest);
    return { ...state, messages: young.slice(-settings.OUTBOX_MESSAGES_MAX) };
  }

  async #putAside(reason: string): Promise<void> {
    const aside = `${this.#file}.unreadable-${fileTime(this.#now())}`;
    try {
      await retryWhileBusy(() => rename(this.#file, aside));
    } catch (error) {
      this.#setAside = `The alert store ${this.#file} is unreadable (${reason}) and could not be set aside (${errorMessage(error)}); the next alert replaces it.`;
      this.#log(`L1 outbox: ${this.#setAside}`);
      return;
    }
    this.#setAside = `The alert store was unreadable (${reason}) and was set aside as ${aside}. Older alerts may not reach phones.`;
    this.#log(`L1 outbox: ${this.#setAside}`);
  }
}
