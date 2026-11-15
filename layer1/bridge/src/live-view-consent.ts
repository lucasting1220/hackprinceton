/**
 * The resident's live view consent (the doc's "Live view"): one setting in the home's state folder,
 * `live-view.json`, off until the resident or the person at the coordinator laptop turns it on. A
 * missing file is off; so is one that can't be read, which the setup page reports and the next
 * change replaces. The resident phone's `live_view_setting` and the setup page's switch change it.
 */
import path from "node:path";
import type { Reply } from "./network-server.ts";
import { errorReply } from "./network-server.ts";
import type { OpenedRequest } from "./lan-gateway.ts";
import { errorMessage, JsonFileError, readJsonFile, writeFileWhole } from "./json-file.ts";
import * as settings from "./settings.ts";
import { utcSeconds } from "./wire.ts";

/** What changed the setting: the setup page's switch, or a resident phone by its device ID. */
export type ConsentChanger =
  | Readonly<{ by: "setup_page" }>
  | Readonly<{ by: "phone"; deviceId: string }>;

/** The refusals of phone-hub.md §4.4 for `live_view_setting`. */
const REFUSED = {
  forbidden: errorReply(400, "forbidden", "Only the resident's phone can change live view."),
  badRequest: errorReply(400, "bad_request", "The request is malformed."),
  internal: errorReply(500, "internal", "Something went wrong in the hub."),
};

const ACCEPTED: Reply = { status: 202, body: { v: 1, accepted: true } };

export class LiveViewConsent {
  readonly #file: string;
  readonly #log: (line: string) => void;
  readonly #now: () => number;
  #enabled: boolean;
  #problem: string | undefined;
  /** Writes run one at a time, so the file always ends with the last change made. */
  #writes: Promise<unknown> = Promise.resolve();

  private constructor(
    file: string,
    enabled: boolean,
    problem: string | undefined,
    options: Options,
  ) {
    this.#file = file;
    this.#enabled = enabled;
    this.#problem = problem;
    this.#log = options.log ?? ((line: string) => console.log(line));
    this.#now = options.now ?? Date.now;
  }

  /** The setting saved in `stateDir`: off when there is none, or when it can't be read. */
  static async load(stateDir: string, options: Options = {}): Promise<LiveViewConsent> {
    const file = path.join(stateDir, settings.STATE_NAMES.liveView);
    const log = options.log ?? ((line: string) => console.log(line));
    let saved: unknown;
    try {
      saved = await readJsonFile(file);
    } catch (error) {
      if (!(error instanceof JsonFileError)) throw error;
      if (error.code === "ENOENT") return new LiveViewConsent(file, false, undefined, options);
      const problem = `${errorMessage(error)}; live view stays off until it is set again`;
      log(`L1 live-view: ${problem}`);
      return new LiveViewConsent(file, false, problem, options);
    }
    const enabled = parse(saved);
    if (enabled !== undefined) return new LiveViewConsent(file, enabled, undefined, options);
    const problem = `${file} is not valid; live view stays off until it is set again`;
    log(`L1 live-view: ${problem}`);
    return new LiveViewConsent(file, false, problem, options);
  }

  /** Whether the resident lets caregivers start live view now. */
  enabled(): boolean {
    return this.#enabled;
  }

  /** Why the saved setting couldn't be read or written, for the setup page; undefined when fine. */
  problem(): string | undefined {
    return this.#problem;
  }

  /**
   * Saves the setting, then applies it. A failed write keeps the setting as it was, reports why on
   * the setup page and rethrows, so the caller answers that the change didn't happen.
   */
  set(enabled: boolean, changer: ConsentChanger): Promise<void> {
    const write = this.#writes.then(() => this.#save(enabled, changer));
    this.#writes = Promise.allSettled([write]);
    return write;
  }

  /** The handler for a phone's `live_view_setting` (phone-hub.md §4.4), on either route. */
  async handle(request: OpenedRequest): Promise<Reply> {
    if (request.role !== "resident") return REFUSED.forbidden;
    const { enabled } = request.plaintext;
    if (typeof enabled !== "boolean") return REFUSED.badRequest;
    try {
      await this.set(enabled, { by: "phone", deviceId: request.deviceId });
    } catch (error) {
      if (!(error instanceof JsonFileError)) throw error;
      return REFUSED.internal;
    }
    return ACCEPTED;
  }

  async #save(enabled: boolean, changer: ConsentChanger): Promise<void> {
    const saved = {
      schema_version: 1,
      enabled,
      changed_at: utcSeconds(new Date(this.#now())),
    };
    try {
      await writeFileWhole(this.#file, `${JSON.stringify(saved, null, 2)}\n`);
    } catch (error) {
      if (!(error instanceof JsonFileError)) throw error;
      this.#problem = `couldn't save the setting: ${error.message}`;
      this.#log(`L1 live-view: ${this.#problem}`);
      throw error;
    }
    this.#enabled = enabled;
    this.#problem = undefined;
    const who = changer.by === "phone" ? `phone ${changer.deviceId}` : "the setup page";
    this.#log(`L1 live-view: live view turned ${enabled ? "on" : "off"} by ${who}`);
  }
}

interface Options {
  /** Gets the setting's lines; console.log by default. */
  readonly log?: (line: string) => void;
  /** The clock, in milliseconds since the Unix epoch; tests pass their own. */
  readonly now?: () => number;
}

/** `enabled` from a saved file with schema_version 1, or undefined when it isn't one. */
function parse(saved: unknown): boolean | undefined {
  if (typeof saved !== "object" || saved === null) return undefined;
  const version: unknown = Reflect.get(saved, "schema_version");
  const enabled: unknown = Reflect.get(saved, "enabled");
  return version === 1 && typeof enabled === "boolean" ? enabled : undefined;
}
