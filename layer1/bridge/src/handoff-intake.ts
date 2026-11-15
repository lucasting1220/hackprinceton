/**
 * Layer 4's other messages for phones, on the bridge's local side next to POST /v1/alerts, behind
 * the same machine guard (the Layer 1 doc's "Handoff to Layer 4"):
 *
 *   POST /v1/replies  {request_id, title, body}           ─▶ `reply` to the phone that asked
 *   POST /v1/reports  {report_id, date, title, body}      ─▶ `report` for every caregiver
 *   POST /v1/status   {activity, heart_rate, sleep, steps, no_heart_data} ─▶ `care_status`, latest only
 *
 * Each is checked, sealed once and saved in the outbox before the 202: 400 names the field and the
 * rule, never the value; 503 when there's no home or the outbox can't be written. `type` and
 * `schema_version` are allowed and not passed on; other unlisted fields are ignored and reported.
 * Logs name IDs only, never a title, a body or a reading.
 */
import {
  ACCEPTED,
  answer,
  type HomeAlerts,
  NO_HOME,
  textRule,
  UNWRITABLE,
} from "./alert-intake.ts";
import { sealCareStatus, sealReply, sealReport } from "./home-messages.ts";
import { type Html, html } from "./html.ts";
import { OutboxError } from "./outbox.ts";
import { isCalendarDate } from "./phone-handoff.ts";
import * as settings from "./settings.ts";
import type { MachineReply, PageRoute } from "./setup-server.ts";
import type { Wrapper } from "./wire.ts";

/** The fields each intake takes, exactly the doc's; the plaintext carries just these. */
export const REPLY_FIELDS = ["request_id", "title", "body"] as const;
export const REPORT_FIELDS = ["report_id", "date", "title", "body"] as const;
export const STATUS_FIELDS = ["activity", "heart_rate", "sleep", "steps", "no_heart_data"] as const;

/** Allowed in every body, as Layer 2's messages carry them, and never passed on. */
const ENVELOPE_FIELDS: readonly string[] = ["type", "schema_version"];

const ID = /^[A-Za-z0-9_.-]{1,64}$/;
const SHOWN_NAME = /^[A-Za-z0-9_.-]{1,64}$/;

type Fields = Readonly<Record<string, unknown>>;

/** The checked message, or the first field that breaks a rule, named with the rule. */
export type ParsedMessage =
  | Readonly<{ ok: true; fields: Fields; unknownFields: readonly string[] }>
  | Readonly<{ ok: false; reason: string }>;

function isRecord(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Checks the shared shape, then `rules` field by field; the first broken rule wins. */
function parseWith(
  what: string,
  listed: readonly string[],
  body: unknown,
  rules: (body: Fields) => readonly (readonly [string, string | undefined])[],
): ParsedMessage {
  if (!isRecord(body)) return { ok: false, reason: `${what}: must be a JSON object` };
  for (const field of listed) {
    if (!Object.hasOwn(body, field)) return { ok: false, reason: `${field}: missing` };
  }
  for (const [field, rule] of rules(body)) {
    if (rule !== undefined) return { ok: false, reason: `${field}: ${rule}` };
  }
  const fields = Object.fromEntries(listed.map((field) => [field, body[field]]));
  const known = new Set([...listed, ...ENVELOPE_FIELDS]);
  const unknownFields = Object.keys(body).filter((field) => !known.has(field));
  return { ok: true, fields, unknownFields };
}

const idRule = (value: unknown) =>
  typeof value === "string" && ID.test(value)
    ? undefined
    : "must be an ID of 1 to 64 letters, digits, ., - or _";

/** Checks a reply from Layer 4 (its answer to a phone's `ask` or `check_now`). */
export function parseReply(body: unknown): ParsedMessage {
  return parseWith("reply", REPLY_FIELDS, body, ({ request_id, title, body: text }) => [
    ["request_id", idRule(request_id)],
    ["title", textRule(title, settings.HANDOFF_TITLE_MAX_CHARS)],
    ["body", textRule(text, settings.REPLY_BODY_MAX_CHARS)],
  ]);
}

/** Checks a daily report from Layer 4. */
export function parseReport(body: unknown): ParsedMessage {
  return parseWith("report", REPORT_FIELDS, body, ({ report_id, date, title, body: text }) => [
    ["report_id", idRule(report_id)],
    ["date", isCalendarDate(date) ? undefined : "must be a date such as 2026-11-14"],
    ["title", textRule(title, settings.HANDOFF_TITLE_MAX_CHARS)],
    ["body", textRule(text, settings.REPORT_BODY_MAX_CHARS)],
  ]);
}

const objectOrNull = (value: unknown) =>
  value === null || isRecord(value) ? undefined : "must be a JSON object or null";

/**
 * Checks a live status from Layer 4. Its parts pass on as Layer 4 sends them; only `heart_rate`'s
 * `bpm` is checked, because the app drops a whole status whose `bpm` isn't a whole number.
 */
export function parseStatus(body: unknown): ParsedMessage {
  return parseWith("status", STATUS_FIELDS, body, (fields) => {
    const { activity, heart_rate: heart, sleep, steps, no_heart_data: noHeartData } = fields;
    const { bpm } = isRecord(heart) ? heart : { bpm: 0 };
    const bpmOk = typeof bpm === "number" && Number.isSafeInteger(bpm) && bpm >= 0;
    return [
      ["activity", objectOrNull(activity)],
      ["heart_rate", objectOrNull(heart)],
      ["heart_rate.bpm", bpmOk ? undefined : "must be a whole number"],
      ["sleep", objectOrNull(sleep)],
      ["steps", objectOrNull(steps)],
      ["no_heart_data", typeof noHeartData === "boolean" ? undefined : "must be true or false"],
    ];
  });
}

/** One intake: its path, its check, and how its message is sealed and named in the log. */
type IntakeKind = Readonly<{
  path: "/v1/replies" | "/v1/reports" | "/v1/status";
  what: string;
  parse: (body: unknown) => ParsedMessage;
  /** The sealed wrapper, or a rejection reason; `home` holds the key and the request ledger. */
  seal: (fields: Fields, home: HomeAlerts) => Wrapper | MachineReply;
  /** The IDs the log names, never a title, a body or a reading. */
  name: (fields: Fields) => string;
}>;

const rejected = (reason: string): MachineReply => answer(400, "rejected", reason);

const KINDS: readonly IntakeKind[] = [
  {
    path: "/v1/replies",
    what: "reply",
    parse: parseReply,
    seal: (fields, home) => {
      const requests = home.handoff?.requests;
      if (requests === undefined) return NO_HOME;
      const { request_id: requestId } = fields;
      const asking = requests.askingPhone(String(requestId));
      if (!asking.ok) return rejected(`request_id: ${asking.reason}`);
      const { deviceId, phoneKey } = asking;
      return sealReply(fields, { homeId: home.homeId, deviceId, phoneKey });
    },
    name: ({ request_id: requestId }) => `reply to request ${String(requestId)}`,
  },
  {
    path: "/v1/reports",
    what: "report",
    parse: parseReport,
    seal: (fields, home) => sealReport(fields, home),
    name: ({ report_id: reportId, date }) => `report ${String(reportId)} for ${String(date)}`,
  },
  {
    path: "/v1/status",
    what: "status",
    parse: parseStatus,
    seal: (fields, home) => sealCareStatus(fields, home),
    name: () => "live status",
  },
];

export interface HandoffIntakeOptions {
  /** The home's messages once the home is ready, else undefined (503 no_home). */
  readonly ready: () => HomeAlerts | undefined;
  readonly log?: (line: string) => void;
}

/** POST /v1/replies, /v1/reports and /v1/status, for the setup server's route table. */
export class HandoffIntake {
  readonly #ready: () => HomeAlerts | undefined;
  readonly #log: (line: string) => void;
  /** The latest rejection per path, for the setup page. */
  readonly #rejected = new Map<string, string>();
  readonly #unknownFields = new Set<string>();

  constructor(options: HandoffIntakeOptions) {
    this.#ready = options.ready;
    this.#log = options.log ?? ((line: string) => console.log(line));
  }

  /** The three machine routes. */
  routes(): PageRoute[] {
    return KINDS.map((kind) => ({
      method: "POST",
      path: kind.path,
      guard: "machine",
      handle: (body: unknown) => this.accept(kind.path, body),
    }));
  }

  /** One body for `path`, once the machine guard has passed it: 202, 400 or 503. */
  async accept(path: IntakeKind["path"], body: unknown): Promise<MachineReply> {
    const kind = KINDS.find((row) => row.path === path);
    if (kind === undefined) return rejected("path: unknown");
    const parsed = kind.parse(body);
    if (!parsed.ok) return this.#reject(kind, parsed.reason);
    this.#noteUnknown(kind, parsed.unknownFields);
    const home = this.#ready();
    if (home === undefined) return NO_HOME;
    const sealed = kind.seal(parsed.fields, home);
    if (!("envelope" in sealed)) {
      if (sealed.status === 400) this.#remember(kind, Reflect.get(sealed.json, "reason"));
      return sealed;
    }
    let seq: number;
    try {
      seq = await home.outbox.append(sealed);
    } catch (error) {
      if (!(error instanceof OutboxError)) throw error;
      return UNWRITABLE;
    }
    this.#log(
      `L1 handoff: accepted ${kind.name(parsed.fields)} as message ${sealed.msg_id}, seq ${seq}`,
    );
    return ACCEPTED;
  }

  /** The setup page's "Messages for phones" block: only when something needs the person's eye. */
  section(): Html | "" {
    const problems = [...this.#rejected].map(
      ([path, reason]) => `Rejected a message from Layer 2 at ${path}: ${reason}`,
    );
    if (this.#unknownFields.size > 0) {
      const names = [...this.#unknownFields].join(", ");
      problems.push(`Layer 2 sent fields the doc doesn't list: ${names}`);
    }
    if (problems.length === 0) return "";
    return html`<h2>Messages for phones</h2><ul>${problems.map((line) => html`<li>${line}</li>`)}</ul>`;
  }

  #reject(kind: IntakeKind, reason: string): MachineReply {
    this.#remember(kind, reason);
    return rejected(reason);
  }

  #remember(kind: IntakeKind, reason: unknown): void {
    const text = String(reason);
    this.#rejected.set(kind.path, text);
    this.#log(`L1 handoff: rejected a ${kind.what} from Layer 2: ${text}`);
  }

  /** Reports each unlisted field name once, by name only, up to ALERT_UNKNOWN_FIELDS_SHOWN. */
  #noteUnknown(kind: IntakeKind, fields: readonly string[]): void {
    for (const field of fields) {
      const shown = `${kind.what}.${SHOWN_NAME.test(field) ? field : "(unnamed)"}`;
      if (this.#unknownFields.has(shown)) continue;
      if (this.#unknownFields.size >= settings.ALERT_UNKNOWN_FIELDS_SHOWN) return;
      this.#unknownFields.add(shown);
      this.#log(`L1 handoff: Layer 2 sent a field the doc doesn't list: ${shown}`);
    }
  }
}
