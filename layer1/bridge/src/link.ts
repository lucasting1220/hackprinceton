/**
 * The bridge link (phone-hub.md §6.6): a worker laptop's bridge posts a sealed link_report to the
 * home laptop's bridge every LINK_REPORT_MS (LINK_CAMERA_REPORT_MS for the camera laptop), and gets
 * a sealed link_reply carrying the commands queued for it, such as live view's. Both sides derive the link key from the join token's SHA-256 and the node ID,
 * so a node no longer in accepted-workers.json gets 403 unknown_node. Freshness and repeats follow
 * §2.5, kept in the LAN gateway's one memory of message IDs. Log lines name node IDs only, never a
 * token, a hash, a key, a report or a command (a live_view_open holds the sender token).
 */
import { randomUUID } from "node:crypto";
import type { AcceptedWorker, Home } from "./home.ts";
import { AcceptedWorkersError, acceptedWorkers, removeAcceptedWorker } from "./home.ts";
import { errorMessage } from "./json-file.ts";
import { type LinkCommand, parseLinkCommand } from "./live-view-commands.ts";
import { errorReply, type Reply, type Route } from "./network-server.ts";
import { linkKey, open, PhoneCryptoRefusal, seal } from "./phone-crypto.ts";
import * as settings from "./settings.ts";
import { isUtcTime, parseWrapper, utcSeconds, type Wrapper } from "./wire.ts";

/**
 * What a worker laptop reports: its setup state, what it is missing and, after its live view sender
 * couldn't start or stopped by itself, that session's ID. The keys are the plaintext's (§6.6).
 */
export type LinkReport = Readonly<{
  state: string;
  missing: readonly Readonly<{ id: string; reason: string; required: boolean }>[];
  live_view_lost?: string;
}>;

/** A linked laptop as the home laptop's page lists it. */
export type LinkedLaptop = LinkReport & Readonly<{ nodeId: string; reportedAt: string }>;

export interface LinkHubOptions {
  readonly home: Home;
  /** The LAN gateway's memory of message IDs, shared under senders "node:<node_id>". */
  readonly seen: { rememberMsgId(sender: string, msgId: string): boolean };
  readonly now?: () => number;
  readonly log?: (line: string) => void;
  /** The accepted workers; accepted-workers.json by default. */
  readonly workers?: () => Promise<AcceptedWorker[]>;
  /** Takes a node out of the accepted workers; accepted-workers.json by default. */
  readonly removeWorker?: (nodeId: string) => Promise<boolean>;
  /** Told each node that left or was removed, so the join listing forgets it. */
  readonly onRemoved?: (nodeId: string) => void;
}

/** The answer to a link_leave the hub took (§6.6). */
const LEFT: Reply = { status: 202, body: { v: 1, accepted: true } };

const REFUSED = {
  badRequest: errorReply(400, "bad_request", "The request is malformed."),
  unsupportedVersion: errorReply(400, "unsupported_version", "This version is not supported."),
  unsupportedType: errorReply(400, "unsupported_type", "This path doesn't take this type."),
  unknownNode: errorReply(403, "unknown_node", "This laptop isn't part of this home."),
  badEnvelope: errorReply(400, "bad_envelope", "The envelope doesn't open, or doesn't match."),
  stale: errorReply(400, "stale", "The request's time is too far from the hub's clock."),
  duplicate: errorReply(409, "duplicate", "This message was already received."),
  internal: errorReply(500, "internal", "Something went wrong in the hub."),
};

/** A report's state and missing items are shown on a page, so each is short plain text. */
const STATE = /^[a-z_]{1,32}$/;
const ID = /^[A-Za-z0-9._-]{1,64}$/;
const MISSING_MAX = 32;
const TEXT_MAX = 2000;
const utf8 = new TextDecoder("utf-8", { fatal: true });

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The report's fields, or undefined if they break §6.6's shape. */
function parseReport(plaintext: Readonly<Record<string, unknown>>): LinkReport | undefined {
  const { state, missing, live_view_lost: lost } = plaintext;
  if (typeof state !== "string" || !STATE.test(state) || !Array.isArray(missing)) return undefined;
  if (lost !== undefined && (typeof lost !== "string" || !ID.test(lost))) return undefined;
  if (missing.length > MISSING_MAX) return undefined;
  const items = missing.map((item: unknown) => {
    if (!isRecord(item)) return undefined;
    const { id, reason, required } = item;
    const short = (text: unknown) => typeof text === "string" && text.length <= TEXT_MAX;
    if (!short(id) || !short(reason) || typeof required !== "boolean") return undefined;
    return { id: String(id), reason: String(reason), required };
  });
  if (items.some((item) => item === undefined)) return undefined;
  const report = { state, missing: items.filter((item) => item !== undefined) };
  return lost === undefined ? report : { ...report, live_view_lost: lost };
}

/** A sealed message's plaintext as a JSON object, or undefined if it doesn't open or parse. */
function openPlaintext(
  wrapper: Wrapper,
  key: ReturnType<typeof linkKey>,
  homeId: string,
): Readonly<{ sentAt: string; fields: Readonly<Record<string, unknown>> }> | undefined {
  let bytes: Buffer;
  try {
    bytes = open(wrapper.envelope, key, { homeId, type: wrapper.type });
  } catch (error) {
    if (error instanceof PhoneCryptoRefusal) return undefined;
    throw error;
  }
  try {
    const value: unknown = JSON.parse(utf8.decode(bytes));
    if (!isRecord(value)) return undefined;
    const { type, msg_id: msgId, sent_at: sentAt } = value;
    const matches = type === wrapper.type && msgId === wrapper.msg_id && isUtcTime(sentAt);
    return matches ? { sentAt, fields: value } : undefined;
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) return undefined;
    throw error;
  } finally {
    bytes.fill(0);
  }
}

/** A §3 wrapper around `fields`, sealed with the link key under kid `nodeId`. */
export function sealLinkMessage(
  key: ReturnType<typeof linkKey>,
  label: Readonly<{ homeId: string; nodeId: string; type: string }>,
  fields: Readonly<Record<string, unknown>>,
  now: number,
): Wrapper {
  const msgId = randomUUID();
  const sentAt = utcSeconds(new Date(now));
  const plaintext = { msg_id: msgId, sent_at: sentAt, type: label.type, ...fields };
  const bytes = Buffer.from(JSON.stringify(plaintext), "utf8");
  const envelope = seal(bytes, key, label.nodeId, { homeId: label.homeId, type: label.type });
  bytes.fill(0);
  return { v: 1, msg_id: msgId, type: label.type, sent_at: sentAt, envelope };
}

/** The home laptop's side: POST /v1/link and what each linked laptop last reported. */
export class LinkHub {
  readonly #home: Home;
  readonly #seen: LinkHubOptions["seen"];
  readonly #now: () => number;
  readonly #log: (line: string) => void;
  readonly #workers: () => Promise<AcceptedWorker[]>;
  readonly #removeWorker: (nodeId: string) => Promise<boolean>;
  readonly #onRemoved: (nodeId: string) => void;
  readonly #linked = new Map<string, LinkedLaptop>();
  /** Commands waiting for each laptop's next report, oldest first. */
  readonly #queued = new Map<string, LinkCommand[]>();
  readonly #listeners = new Set<(nodeId: string, report: LinkReport) => void>();

  constructor(options: LinkHubOptions) {
    this.#home = options.home;
    this.#seen = options.seen;
    this.#now = options.now ?? Date.now;
    this.#log = options.log ?? ((line: string) => console.log(line));
    this.#workers = options.workers ?? (() => acceptedWorkers(options.home));
    this.#removeWorker =
      options.removeWorker ?? ((nodeId) => removeAcceptedWorker(options.home, nodeId));
    this.#onRemoved = options.onRemoved ?? (() => undefined);
  }

  routes(): Route[] {
    return [{ method: "POST", path: "/v1/link", handle: (body) => this.report(body) }];
  }

  /**
   * Queues `command` for laptop `nodeId`'s next report. A close for a session whose open is still
   * waiting removes that open instead, so the laptop never starts a window that already ended.
   */
  queue(nodeId: string, command: LinkCommand): void {
    const queued = this.#queued.get(nodeId) ?? [];
    if (command.type === "live_view_close") {
      const open = queued.findIndex(
        (item) => item.type === "live_view_open" && item.session_id === command.session_id,
      );
      if (open !== -1) {
        queued.splice(open, 1);
        return;
      }
    }
    queued.push(command);
    while (queued.length > settings.LINK_COMMANDS_MAX) queued.shift();
    this.#queued.set(nodeId, queued);
  }

  /** Calls `listener` with each accepted report; returns what stops it. */
  onReport(listener: (nodeId: string, report: LinkReport) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Each laptop's latest report, by node ID. */
  linked(): ReadonlyMap<string, LinkedLaptop> {
    return this.#linked;
  }

  /**
   * Removes laptop `nodeId` from the home: out of accepted-workers.json, so Layer 2's coordinator
   * refuses its token and drops its connection, and out of what the page lists. Resolves whether it
   * was accepted; throws an AcceptedWorkersError if the file can't be read or written.
   */
  async remove(nodeId: string): Promise<boolean> {
    const listed = await this.#removeWorker(nodeId);
    this.#forget(nodeId);
    this.#log(`L1 link: node ${nodeId} removed from the home`);
    return listed;
  }

  #forget(nodeId: string): void {
    this.#linked.delete(nodeId);
    this.#queued.delete(nodeId);
    this.#onRemoved(nodeId);
  }

  /**
   * POST /v1/link: a link_report, recorded and answered with a sealed link_reply, or a link_leave,
   * which removes the laptop from the home. Both are checked as §6.6 says.
   */
  async report(body: unknown): Promise<Reply> {
    const parsed = parseWrapper(body);
    if (!parsed.ok) {
      return parsed.code === "unsupported_version"
        ? REFUSED.unsupportedVersion
        : REFUSED.badRequest;
    }
    const { wrapper } = parsed;
    if (wrapper.type !== "link_report" && wrapper.type !== "link_leave") {
      return REFUSED.unsupportedType;
    }
    const nodeId = wrapper.envelope.kid;
    let workers: AcceptedWorker[];
    try {
      workers = await this.#workers();
    } catch (error) {
      if (!(error instanceof AcceptedWorkersError)) throw error;
      this.#log(`L1 link: can't check node ${nodeId}: ${errorMessage(error)}`);
      return REFUSED.internal;
    }
    const worker = workers.find((entry) => entry.node_id === nodeId);
    if (worker === undefined) {
      this.#linked.delete(nodeId);
      this.#queued.delete(nodeId);
      return REFUSED.unknownNode;
    }
    const key = linkKey(worker.token_sha256, nodeId);
    const plaintext = openPlaintext(wrapper, key, this.#home.homeId);
    if (plaintext === undefined) return REFUSED.badEnvelope;
    const now = this.#now();
    if (Math.abs(Date.parse(plaintext.sentAt) - now) > settings.PHONE_CLOCK_SKEW_MS) {
      return REFUSED.stale;
    }
    if (!this.#seen.rememberMsgId(`node:${nodeId}`, wrapper.msg_id)) return REFUSED.duplicate;
    if (wrapper.type === "link_leave") return this.#leave(nodeId);
    const report = parseReport(plaintext.fields);
    if (report === undefined) return REFUSED.badRequest;
    if (!this.#linked.has(nodeId)) this.#log(`L1 link: node ${nodeId} linked`);
    this.#linked.set(nodeId, { nodeId, reportedAt: utcSeconds(new Date(now)), ...report });
    for (const listener of this.#listeners) listener(nodeId, report);
    const commands = this.#queued.get(nodeId) ?? [];
    this.#queued.delete(nodeId);
    const label = { homeId: this.#home.homeId, nodeId, type: "link_reply" };
    const reply = sealLinkMessage(key, label, { in_reply_to: wrapper.msg_id, commands }, now);
    if (commands.length > 0) {
      const types = commands.map((command) => command.type).join(", ");
      this.#log(`L1 link: sent node ${nodeId} ${types}`);
    }
    return { status: 200, body: reply };
  }

  /** A link_leave: the laptop left, so it is taken out of the home as Remove does. */
  async #leave(nodeId: string): Promise<Reply> {
    try {
      await this.#removeWorker(nodeId);
    } catch (error) {
      if (!(error instanceof AcceptedWorkersError)) throw error;
      this.#log(`L1 link: node ${nodeId} left, but couldn't be removed: ${errorMessage(error)}`);
      return REFUSED.internal;
    }
    this.#forget(nodeId);
    this.#log(`L1 link: node ${nodeId} left the home`);
    return LEFT;
  }
}

/** What one report over the link came to, for the worker laptop's page. */
export type LinkOutcome =
  | Readonly<{ ok: true; commands: readonly LinkCommand[]; ignored: number }>
  | Readonly<{ ok: false; removed: boolean; reason: string }>;

export interface LinkTarget {
  /** The home laptop's bridge, as "http://host:port". */
  readonly hubUrl: string;
  readonly homeId: string;
  readonly nodeId: string;
  /** The SHA-256 of this laptop's join token, in lowercase hex. A secret: never log it. */
  readonly tokenSha256: string;
}

/** The worker laptop's side: posts one report and checks the sealed reply. */
export async function sendLinkReport(
  target: LinkTarget,
  report: LinkReport,
  now: () => number = Date.now,
): Promise<LinkOutcome> {
  const { hubUrl, homeId, nodeId } = target;
  const key = linkKey(target.tokenSha256, nodeId);
  const sent = sealLinkMessage(key, { homeId, nodeId, type: "link_report" }, report, now());
  let response: Response;
  let answer: unknown;
  try {
    response = await fetch(new URL("/v1/link", hubUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sent),
      signal: AbortSignal.timeout(settings.JOIN_REQUEST_TIMEOUT_MS),
    });
    answer = await response.json();
  } catch (error) {
    return {
      ok: false,
      removed: false,
      reason: `can't reach the home laptop (${errorKind(error)})`,
    };
  }
  if (response.status === 403) {
    return { ok: false, removed: true, reason: "this laptop is no longer part of the home" };
  }
  const parsed = response.status === 200 ? parseWrapper(answer) : undefined;
  const reply = parsed?.ok === true ? parsed.wrapper : undefined;
  const opened =
    reply?.type === "link_reply" && reply.envelope.kid === nodeId
      ? openPlaintext(reply, key, homeId)
      : undefined;
  const { in_reply_to: inReplyTo, commands } = opened?.fields ?? {};
  if (inReplyTo === sent.msg_id && Array.isArray(commands)) {
    const parsed = commands.map(parseLinkCommand);
    const valid = parsed.filter((command) => command !== undefined);
    return { ok: true, commands: valid, ignored: parsed.length - valid.length };
  }
  return { ok: false, removed: false, reason: `the home laptop answered ${response.status}` };
}

/** What telling the home laptop this laptop is leaving came to: told, or why not. */
export type LeaveOutcome = Readonly<{ ok: true }> | Readonly<{ ok: false; reason: string }>;

/**
 * The worker laptop's side of leaving: one sealed link_leave. A 403 counts as told, since the home
 * laptop already doesn't list this laptop.
 */
export async function sendLinkLeave(
  target: LinkTarget,
  now: () => number = Date.now,
): Promise<LeaveOutcome> {
  const { hubUrl, homeId, nodeId } = target;
  const key = linkKey(target.tokenSha256, nodeId);
  const sent = sealLinkMessage(key, { homeId, nodeId, type: "link_leave" }, {}, now());
  let response: Response;
  try {
    response = await fetch(new URL("/v1/link", hubUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sent),
      signal: AbortSignal.timeout(settings.JOIN_REQUEST_TIMEOUT_MS),
    });
    await response.body?.cancel();
  } catch (error) {
    return { ok: false, reason: `can't reach the home laptop (${errorKind(error)})` };
  }
  if (response.status === 202 || response.status === 403) return { ok: true };
  return { ok: false, reason: `the home laptop answered ${response.status}` };
}

/** A fetch failure's kind, such as a timeout or ECONNREFUSED, never its URL or body. */
export function errorKind(error: unknown): string {
  if (error instanceof Error && error.name === "TimeoutError") return "no answer in time";
  const cause = error instanceof Error ? error.cause : undefined;
  if (cause instanceof Error && "code" in cause && typeof cause.code === "string")
    return cause.code;
  return error instanceof Error ? error.name : typeof error;
}
