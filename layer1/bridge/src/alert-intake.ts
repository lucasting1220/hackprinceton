/**
 * The alert intake: POST /v1/alerts on the bridge's local side (127.0.0.1:7470, coordinator.json's
 * bridge_url), where Layer 2's coordinator hands over the alerts Layer 4 sends for phones. The
 * setup server's machine guard runs first (its Host, no Origin, JSON, the size and time limits);
 * this checks the alert, seals it once with the home key and saves it in the outbox before the 202.
 * The bridge adds nothing and decides nothing: kind, severity and text go to the phone as sent.
 * Logs name the alert_id, kind, severity and msg_id, never the title or the body.
 */
import type { KeyObject } from "node:crypto";
import type { Home } from "./home.ts";
import { HomeError, readCoordinatorClientPort, readHomeSecrets } from "./home.ts";
import { type AlertFields, sealAlert } from "./home-messages.ts";
import { type Html, html } from "./html.ts";
import { Outbox, OutboxError } from "./outbox.ts";
import { CoordinatorLink, PhoneHandoff, PhoneRequests } from "./phone-handoff.ts";
import * as settings from "./settings.ts";
import type { MachineReply, PageRoute } from "./setup-server.ts";
import { utcSeconds } from "./wire.ts";

/**
 * The alert's fields, exactly contracts/alert.json's: Layer 4's Alert dataclass
 * (layer4/src/layer4/alerts.py) plus `type` and `schema_version`.
 */
export const ALERT_FIELDS = [
  "type",
  "schema_version",
  "alert_id",
  "kind",
  "severity",
  "detected_at",
  "title",
  "body",
  "update",
] as const;

/**
 * What the home's messages for phones need once a home exists: its ID, its key and its outbox, and
 * the handoff to Layer 2's coordinator, which also remembers which phone sent each request.
 */
export type HomeAlerts = Readonly<{
  homeId: string;
  homeKey: KeyObject;
  outbox: Outbox;
  handoff?: PhoneHandoff;
}>;

/** The checked alert, or the first field that breaks a rule, named with the rule, never the value. */
export type ParsedAlert =
  | Readonly<{ ok: true; alert: AlertFields; unknownFields: readonly string[] }>
  | Readonly<{ ok: false; reason: string }>;

const ALERT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const WORD = /^[a-z][a-z0-9_]{0,31}$/;
/** ISO 8601 with a zone: Z or an offset, to the second with any fraction. */
const ISO_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|([+-])(\d{2}):(\d{2}))$/;
/** Names of unlisted fields shown on the setup page as they are; others only as "and others". */
const SHOWN_NAME = /^[A-Za-z0-9_.-]{1,64}$/;

/**
 * `value` as UTC whole seconds with Z, the same instant (phone-hub.md §1), if it is an ISO 8601
 * time with a zone on a real date: 2026-11-14T03:12:45.123456+00:00 becomes 2026-11-14T03:12:45Z.
 */
export function normalizeUtc(value: unknown): string | undefined {
  const match = typeof value === "string" ? ISO_TIME.exec(value) : null;
  if (match === null) return undefined;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as number[];
  const offsetHours = Number(match[9] ?? 0);
  const offsetMinutes = Number(match[10] ?? 0);
  if (offsetHours > 23 || offsetMinutes > 59) return undefined;
  const wall = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day, hour, minute, second));
  const same = utcSeconds(wall) === `${match[0].slice(0, 19)}Z`;
  if (!same || (year ?? 0) < 1000) return undefined;
  const sign = match[8] === "-" ? -1 : 1;
  const offsetMs = sign * (offsetHours * 60 + offsetMinutes) * 60_000;
  return utcSeconds(new Date(wall.getTime() - offsetMs));
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Text of 1 to `max` code points, well-formed so the app's JSON decoder takes it. */
export function textRule(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return "must be text";
  if (!value.isWellFormed()) return "must be well-formed Unicode";
  const length = [...value].length;
  return length >= 1 && length <= max ? undefined : `must be 1 to ${max} characters`;
}

/** Checks a received alert against the field list and its rules. Unlisted fields are ignored. */
export function parseAlert(body: unknown): ParsedAlert {
  if (!isRecord(body)) return { ok: false, reason: "alert: must be a JSON object" };
  const rejected = (field: string, rule: string): ParsedAlert => ({
    ok: false,
    reason: `${field}: ${rule}`,
  });
  const listed: ReadonlySet<string> = new Set(ALERT_FIELDS);
  for (const field of ALERT_FIELDS) {
    if (!Object.hasOwn(body, field)) return rejected(field, "missing");
  }
  const { type, schema_version, alert_id, kind, severity, title, body: text, update } = body;
  const { detected_at: detected } = body;
  if (type !== "alert") return rejected("type", "must be alert");
  if (schema_version !== 1) return rejected("schema_version", "must be 1");
  if (typeof alert_id !== "string" || !ALERT_ID.test(alert_id)) {
    return rejected("alert_id", "must be an ID of 1 to 64 letters, digits, - or _");
  }
  if (typeof kind !== "string" || !WORD.test(kind))
    return rejected("kind", "must be a lowercase word");
  if (typeof severity !== "string" || !WORD.test(severity)) {
    return rejected("severity", "must be a lowercase word");
  }
  const detectedAt = normalizeUtc(detected);
  if (detectedAt === undefined) {
    return rejected(
      "detected_at",
      "must be an ISO 8601 time with a zone, such as 2026-11-14T03:12:45Z",
    );
  }
  const titleRule = textRule(title, settings.ALERT_TITLE_MAX_CHARS);
  if (titleRule !== undefined) return rejected("title", titleRule);
  const bodyRule = textRule(text, settings.ALERT_BODY_MAX_CHARS);
  if (bodyRule !== undefined) return rejected("body", bodyRule);
  if (typeof update !== "boolean") return rejected("update", "must be true or false");
  const alert = {
    alert_id,
    kind,
    severity,
    detected_at: detectedAt,
    title: title as string,
    body: text as string,
    update,
  };
  const unknownFields = Object.keys(body).filter((field) => !listed.has(field));
  return { ok: true, alert, unknownFields };
}

/** The intake's answers: its own type and schema_version, as Layer 2's messages have. */
export const answer = (status: number, type: string, reason?: string): MachineReply => ({
  status,
  json: reason === undefined ? { type, schema_version: 1 } : { type, schema_version: 1, reason },
});
export const ACCEPTED = answer(202, "accepted");
export const NO_HOME = answer(503, "unavailable", "no_home");
export const UNWRITABLE = answer(503, "unavailable", "outbox_unwritable");

/**
 * Reads the home key and opens the outbox, once a home exists: main.ts's home-ready hook. A key
 * file that can't be read leaves alerts off (503 no_home), with the reason logged. The handoff reads
 * coordinator.json's client_port; if it can't, phones' requests get 503 and the reason is logged.
 */
export async function openHomeAlerts(
  home: Home,
  log: (line: string) => void,
): Promise<HomeAlerts | undefined> {
  let homeKey: KeyObject;
  try {
    ({ homeKey } = await readHomeSecrets(home.stateDir));
  } catch (error) {
    if (!(error instanceof HomeError)) throw error;
    log(`L1 alerts: alerts for phones are off: ${error.message}`);
    return undefined;
  }
  const outbox = await Outbox.open(home.stateDir, { log });
  const handoff = await openHandoff(home, log);
  return { homeId: home.homeId, homeKey, outbox, ...(handoff === undefined ? {} : { handoff }) };
}

async function openHandoff(home: Home, log: (line: string) => void) {
  let port: number;
  try {
    port = await readCoordinatorClientPort(home.stateDir);
  } catch (error) {
    if (!(error instanceof HomeError)) throw error;
    log(`L1 handoff: phones' requests can't reach the coordinator: ${error.message}`);
    return undefined;
  }
  const coordinator = new CoordinatorLink({ port, log });
  return new PhoneHandoff({ coordinator, requests: new PhoneRequests(), log });
}

export interface AlertIntakeOptions {
  /** The home's alerts once the home is ready, else undefined (503 no_home). */
  readonly ready: () => HomeAlerts | undefined;
  readonly log?: (line: string) => void;
}

export class AlertIntake {
  readonly #ready: () => HomeAlerts | undefined;
  readonly #log: (line: string) => void;
  /** Hashes of the alerts saved since start, oldest first, each with its save while it runs. */
  readonly #saved = new Map<string, Promise<void>>();
  #rejected: string | undefined;
  readonly #unknownFields = new Set<string>();
  #moreUnknownFields = false;

  constructor(options: AlertIntakeOptions) {
    this.#ready = options.ready;
    this.#log = options.log ?? ((line: string) => console.log(line));
  }

  /** The route the setup server's table holds, behind its machine guard. */
  route(): PageRoute {
    return { method: "POST", path: "/v1/alerts", guard: "machine", handle: (b) => this.accept(b) };
  }

  /** One alert's body, once the machine guard has passed it: 202, 400 or 503. */
  async accept(body: unknown): Promise<MachineReply> {
    const parsed = parseAlert(body);
    if (!parsed.ok) {
      this.#rejected = parsed.reason;
      this.#log(`L1 alerts: rejected an alert from Layer 2: ${parsed.reason}`);
      return answer(400, "rejected", parsed.reason);
    }
    this.#noteUnknown(parsed.unknownFields);
    const { alert } = parsed;
    // contracts/README.md: a repeated alert_id with the same update value is the same alert, so a
    // retry whose text differs is not saved twice.
    const hash = `${alert.alert_id}\u0000${String(alert.update)}`;
    const earlier = this.#saved.get(hash);
    if (earlier !== undefined) {
      try {
        await earlier;
        return ACCEPTED;
      } catch (error) {
        if (!(error instanceof OutboxError)) throw error;
        return UNWRITABLE;
      }
    }
    const home = this.#ready();
    if (home === undefined) return NO_HOME;
    const saving = this.#save(alert, home);
    this.#saved.set(hash, saving);
    try {
      await saving;
    } catch (error) {
      this.#saved.delete(hash);
      if (!(error instanceof OutboxError)) throw error;
      return UNWRITABLE;
    }
    for (const oldest of this.#saved.keys()) {
      if (this.#saved.size <= settings.ALERTS_REMEMBERED) break;
      this.#saved.delete(oldest);
    }
    return ACCEPTED;
  }

  /** The setup page's "Alerts for phones" block: only when something needs the person's eye. */
  section(): Html | "" {
    const problems = [...(this.#ready()?.outbox.problems() ?? [])];
    if (this.#rejected !== undefined) {
      problems.push(`Rejected an alert from Layer 2: ${this.#rejected}`);
    }
    const names = [...this.#unknownFields];
    if (this.#moreUnknownFields) names.push("and others");
    if (names.length > 0) {
      problems.push(`Layer 2 sent fields the contract doesn't list: ${names.join(", ")}`);
    }
    if (problems.length === 0) return "";
    return html`<h2>Alerts for phones</h2><ul>${problems.map((line) => html`<li>${line}</li>`)}</ul>`;
  }

  async #save(alert: AlertFields, home: HomeAlerts): Promise<void> {
    const wrapper = sealAlert(alert, home);
    const seq = await home.outbox.append(wrapper);
    const { alert_id, kind, severity, update } = alert;
    this.#log(
      `L1 alerts: accepted alert ${alert_id} (${kind}, ${severity}, update ${update}) as message ${wrapper.msg_id}, seq ${seq}`,
    );
  }

  /** Reports each unlisted field name once, on the page and in the log. */
  #noteUnknown(fields: readonly string[]): void {
    for (const field of fields) {
      const shown = SHOWN_NAME.test(field);
      if (shown && this.#unknownFields.has(field)) continue;
      if (shown && this.#unknownFields.size < settings.ALERT_UNKNOWN_FIELDS_SHOWN) {
        this.#unknownFields.add(field);
        this.#log(`L1 alerts: Layer 2 sent a field the contract doesn't list: ${field}`);
      } else if (!this.#moreUnknownFields) {
        this.#moreUnknownFields = true;
        this.#log("L1 alerts: Layer 2 sent more fields the contract doesn't list");
      }
    }
  }
}
