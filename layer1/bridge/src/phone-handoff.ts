/**
 * Phone → home handoff (the Layer 1 doc's "Handoff to Layer 4"): a paired phone's `request` and
 * `watch_data`, once the LAN gateway has opened them, are posted to Layer 2's coordinator on
 * 127.0.0.1 at coordinator.json's client_port, as POST /v1/requests (for Layer 4) and POST
 * /v1/watch-data (for Layer 3). The coordinator answers 202 once a worker's job has the message and
 * 503 when no job takes that kind. The bridge remembers which phone sent each request, so Layer 4's
 * reply goes back to that phone alone. Logs name device IDs, request IDs and statuses, never a
 * request's text or a reading.
 */
import type { KeyObject } from "node:crypto";
import { request as httpRequest } from "node:http";
import type { OpenedRequest } from "./lan-gateway.ts";
import { errorReply, type Reply } from "./network-server.ts";
import type { PhoneLookup } from "./phones.ts";
import * as settings from "./settings.ts";
import { isUtcTime } from "./wire.ts";

/** The coordinator's two paths for the bridge (layer2/src/layer2/coordinator/inbox.py). */
export type CoordinatorPath = "/v1/requests" | "/v1/watch-data";

/** What the coordinator did with a message: took it, had no job for it, or couldn't be reached. */
export type CoordinatorAnswer = "accepted" | "no_job" | "unavailable";

export interface CoordinatorLinkOptions {
  /** coordinator.json's client_port; tests pass a fake coordinator's port. */
  readonly port: number;
  /** settings.COORDINATOR_REQUEST_TIMEOUT_MS by default. */
  readonly timeoutMs?: number;
  readonly log?: (line: string) => void;
}

/** Posts JSON to Layer 2's coordinator on 127.0.0.1, with a time limit and no proxy. */
export class CoordinatorLink {
  readonly #port: number;
  readonly #timeoutMs: number;
  readonly #log: (line: string) => void;

  constructor(options: CoordinatorLinkOptions) {
    this.#port = options.port;
    this.#timeoutMs = options.timeoutMs ?? settings.COORDINATOR_REQUEST_TIMEOUT_MS;
    this.#log = options.log ?? ((line: string) => console.log(line));
  }

  /** Posts `body` to `path`; never rejects. Its contents are never logged. */
  post(path: CoordinatorPath, body: object): Promise<CoordinatorAnswer> {
    const payload = Buffer.from(JSON.stringify(body), "utf8");
    const where = `${settings.LOCAL_HOST}:${this.#port}${path}`;
    return new Promise((resolve) => {
      const sent = httpRequest(
        {
          host: settings.LOCAL_HOST,
          port: this.#port,
          path,
          method: "POST",
          agent: false,
          headers: { "content-type": "application/json", "content-length": payload.length },
          signal: AbortSignal.timeout(this.#timeoutMs),
        },
        (response) => {
          response.resume();
          const status = response.statusCode ?? 0;
          if (status === 202) return resolve("accepted");
          if (status === 503) return resolve("no_job");
          this.#log(`L1 handoff: the coordinator answered ${status} at ${where}`);
          resolve("unavailable");
        },
      );
      sent.on("error", (error: Error) => {
        const why = error.name === "AbortError" ? `no answer within ${this.#timeoutMs} ms` : "";
        this.#log(`L1 handoff: can't reach the coordinator at ${where}: ${why || error.message}`);
        resolve("unavailable");
      });
      sent.end(payload);
    });
  }
}

/** The phone a remembered request came from, with its own key, or why it can't be answered. */
export type AskingPhone =
  | Readonly<{ ok: true; deviceId: string; phoneKey: KeyObject }>
  | Readonly<{ ok: false; reason: string }>;

type Asked = Readonly<{ deviceId: string; at: number; phone: () => PhoneLookup }>;

/** Which phone sent each request, for REQUEST_REPLY_WINDOW_MS, in memory only. */
export class PhoneRequests {
  readonly #asked = new Map<string, Asked>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  /** Records that `deviceId` sent `requestId`; false if another phone already sent that ID. */
  remember(requestId: string, deviceId: string, phone: () => PhoneLookup): boolean {
    this.#drop();
    const earlier = this.#asked.get(requestId);
    if (earlier !== undefined && earlier.deviceId !== deviceId) return false;
    this.#asked.delete(requestId);
    this.#asked.set(requestId, { deviceId, at: this.#now(), phone });
    while (this.#asked.size > settings.REQUESTS_REMEMBERED) {
      const oldest = this.#asked.keys().next();
      if (oldest.done === true) break;
      this.#asked.delete(oldest.value);
    }
    return true;
  }

  /** Forgets a request the coordinator didn't take, so the phone may send it again. */
  forget(requestId: string): void {
    this.#asked.delete(requestId);
  }

  /** The paired phone that sent `requestId` in the last REQUEST_REPLY_WINDOW_MS. */
  askingPhone(requestId: string): AskingPhone {
    this.#drop();
    const asked = this.#asked.get(requestId);
    if (asked === undefined) {
      return { ok: false, reason: "no phone sent this request since the bridge started" };
    }
    const phone = asked.phone();
    if (phone.state !== "paired") return { ok: false, reason: "the phone that asked was removed" };
    return { ok: true, deviceId: asked.deviceId, phoneKey: phone.phoneKey };
  }

  #drop(): void {
    const oldest = this.#now() - settings.REQUEST_REPLY_WINDOW_MS;
    for (const [requestId, asked] of this.#asked) {
      if (asked.at >= oldest) break;
      this.#asked.delete(requestId);
    }
  }
}

/** The handoff's refusals and its 202, in phone-hub.md §1's form; none repeats the request. */
const REFUSED = {
  badRequest: errorReply(400, "bad_request", "The request is malformed."),
  unsupportedType: errorReply(400, "unsupported_type", "This path doesn't take this type."),
  noJob: errorReply(503, "no_job", "Nothing in the home takes this right now. Try again later."),
  unavailable: errorReply(
    503,
    "coordinator_down",
    "The home's coordinator isn't answering. Try again later.",
  ),
};
const ACCEPTED: Reply = { status: 202, body: { v: 1, accepted: true } };

/** The answer while the bridge has no link to the coordinator, such as before a home exists. */
export const COORDINATOR_DOWN = REFUSED.unavailable;

const ID = /^[A-Za-z0-9._-]{1,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const REQUEST_KINDS: readonly unknown[] = ["ask", "check_now"];

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isAmount = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/** A calendar date, YYYY-MM-DD, that exists. */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/** The request Layer 4 gets (the doc's `POST /v1/requests`). */
export type PhoneRequestBody = Readonly<{
  request_id: string;
  device_id: string;
  kind: string;
  text: string;
}>;

/** A phone's request as Layer 4 gets it, or undefined if malformed. */
export function parsePhoneRequest(
  deviceId: string,
  plaintext: Readonly<Record<string, unknown>>,
): PhoneRequestBody | undefined {
  const { request_id: requestId, kind, text } = plaintext;
  if (typeof requestId !== "string" || !ID.test(requestId)) return undefined;
  if (typeof kind !== "string" || !REQUEST_KINDS.includes(kind)) return undefined;
  if (typeof text !== "string" || !text.isWellFormed()) {
    return undefined;
  }
  const length = [...text].length;
  if (length > settings.REQUEST_TEXT_MAX_CHARS || (kind === "ask" && text.trim() === "")) {
    return undefined;
  }
  return { request_id: requestId, device_id: deviceId, kind, text };
}

/** Each item of `value` rebuilt by `item` with only its listed fields, or undefined if any fails. */
function listOf(
  value: unknown,
  item: (row: Readonly<Record<string, unknown>>) => Record<string, unknown> | undefined,
): Record<string, unknown>[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows: Record<string, unknown>[] = [];
  for (const row of value as unknown[]) {
    const kept = isRecord(row) ? item(row) : undefined;
    if (kept === undefined) return undefined;
    rows.push(kept);
  }
  return rows;
}

/** A UTC time in the range contracts/README.md gives for watch readings. */
function isReadingTime(value: unknown): value is string {
  if (!isUtcTime(value)) return false;
  const at = Date.parse(value);
  const earliest = Date.parse(settings.WATCH_READING_EARLIEST_AT);
  return at >= earliest && at <= Date.parse(settings.WATCH_READING_LATEST_AT);
}

/** A night's date, YYYY-MM-DD, in the same range as the readings' times. */
function isReadingDate(value: unknown): value is string {
  if (!isCalendarDate(value)) return false;
  const earliest = settings.WATCH_READING_EARLIEST_AT.slice(0, 10);
  return value >= earliest && value <= settings.WATCH_READING_LATEST_AT.slice(0, 10);
}

/**
 * The watch data Layer 3 gets, exactly contracts/watch-data.json: `{schema_version, type,
 * device_id, heart_rate, sleep, steps}`, each list holding only the contract's fields, or undefined
 * if any is missing or malformed. Each list may be empty. `device_id` is always the sending phone's,
 * from its envelope; a `device_id`, `type` or `schema_version` in the plaintext is ignored.
 */
export function parseWatchData(
  deviceId: string,
  plaintext: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> | undefined {
  const { heart_rate: heartRows, sleep: sleepRows, steps: stepRows } = plaintext;
  const heartRate = listOf(heartRows, ({ measured_at, bpm }) =>
    isReadingTime(measured_at) && isAmount(bpm) ? { measured_at, bpm } : undefined,
  );
  const sleep = listOf(sleepRows, (row) => {
    const { night_of, asleep_minutes, bedtime_at, wake_at, interruptions } = row;
    const times = isReadingTime(bedtime_at) && isReadingTime(wake_at);
    if (!isReadingDate(night_of) || !isAmount(asleep_minutes) || !times) return undefined;
    if (!isCount(interruptions)) return undefined;
    return { night_of, asleep_minutes, bedtime_at, wake_at, interruptions };
  });
  const steps = listOf(stepRows, ({ measured_at, steps_today }) =>
    isReadingTime(measured_at) && isCount(steps_today) ? { measured_at, steps_today } : undefined,
  );
  if (heartRate === undefined || sleep === undefined || steps === undefined) return undefined;
  return {
    schema_version: settings.WATCH_DATA_SCHEMA_VERSION,
    type: "watch_data",
    device_id: deviceId,
    heart_rate: heartRate,
    sleep,
    steps,
  };
}

export interface PhoneHandoffOptions {
  readonly coordinator: CoordinatorLink;
  readonly requests: PhoneRequests;
  readonly log?: (line: string) => void;
}

/**
 * The phone → home types the handoff carries, and the roles that may send each (phone-hub.md §3):
 * a caregiver phone in resident mode keeps its caregiver role, so it may send `watch_data` too.
 */
export const HANDOFF_TYPES: Readonly<Record<string, readonly OpenedRequest["role"][]>> = {
  request: ["caregiver"],
  watch_data: ["resident", "caregiver"],
};

/** Carries an opened `request` or `watch_data` to the coordinator, and answers the phone. */
export class PhoneHandoff {
  readonly requests: PhoneRequests;
  readonly #coordinator: CoordinatorLink;
  readonly #log: (line: string) => void;

  constructor(options: PhoneHandoffOptions) {
    this.#coordinator = options.coordinator;
    this.requests = options.requests;
    this.#log = options.log ?? ((line: string) => console.log(line));
  }

  /**
   * 202 once the coordinator took it, 503 `no_job` or `coordinator_down` when it didn't,
   * 400 for a malformed one or a role that never sends this type. `phone` looks the sender up again
   * when Layer 4's reply comes.
   */
  async forward(request: OpenedRequest, phone: () => PhoneLookup): Promise<Reply> {
    const { type, deviceId, role, plaintext } = request;
    if (!Object.hasOwn(HANDOFF_TYPES, type) || !HANDOFF_TYPES[type]?.includes(role)) {
      return REFUSED.unsupportedType;
    }
    if (type === "watch_data") {
      const body = parseWatchData(deviceId, plaintext);
      if (body === undefined) return REFUSED.badRequest;
      return this.#post("/v1/watch-data", body, `watch data from ${deviceId}`);
    }
    const body = parsePhoneRequest(deviceId, plaintext);
    if (body === undefined) return REFUSED.badRequest;
    const requestId = body.request_id;
    if (!this.requests.remember(requestId, deviceId, phone)) return REFUSED.badRequest;
    const reply = await this.#post("/v1/requests", body, `request ${requestId} from ${deviceId}`);
    if (reply.status !== 202) this.requests.forget(requestId);
    return reply;
  }

  async #post(path: CoordinatorPath, body: object, what: string): Promise<Reply> {
    const answer = await this.#coordinator.post(path, body);
    if (answer === "accepted") {
      this.#log(`L1 handoff: the coordinator took ${what}`);
      return ACCEPTED;
    }
    if (answer === "no_job") {
      this.#log(`L1 handoff: no job takes ${what} right now (503)`);
      return REFUSED.noJob;
    }
    return REFUSED.unavailable;
  }
}
