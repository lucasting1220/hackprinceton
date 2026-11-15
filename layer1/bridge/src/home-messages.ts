/**
 * Hub → phone messages (phone-hub.md §3): `alert`, `care_status`, `report` and the `heartbeat`,
 * sealed with the home key, and `reply`, sealed with one phone's own key; the only place in bridge/
 * that builds their plaintext or wrapper. Each is sealed once;
 * the LAN gateway, and later the relay, serve the same wrapper. No I/O, so the relay may import it.
 */
import { type KeyObject, randomUUID } from "node:crypto";
import { seal } from "./phone-crypto.ts";
import { utcSeconds, type Wrapper } from "./wire.ts";

/** The key ID of every message sealed with the home key (phone-hub.md §2.4). */
const HOME_KID = "home";

/** The hub → caregivers types sealed with the home key (§3's message types). */
export type HomeMessageType = "alert" | "care_status" | "heartbeat" | "report";

/** An alert's fields as the phone gets them, with detected_at already in UTC whole seconds. */
export type AlertFields = Readonly<{
  alert_id: string;
  kind: string;
  severity: string;
  detected_at: string;
  title: string;
  body: string;
  update: boolean;
}>;

/** What a test fixes in place of the fresh values; a nonce used twice with one key breaks it. */
export type SealChoices = Readonly<{ msgId?: string; sentAt?: Date; nonce?: Uint8Array }>;

/** The home a message is sealed for. Never log the key. */
export type HomeSeal = Readonly<{ homeId: string; homeKey: KeyObject }>;

/** JSON with every object's keys sorted and no spaces, as the app's vectors are written. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Seals `fields` with msg_id, sent_at and type (which `fields` can't replace) under the home key,
 * with the type in the associated data, and wraps it (§3). An alert's collapse_id is its alert_id.
 */
export function sealHomeMessage(
  type: HomeMessageType,
  fields: Readonly<Record<string, unknown>>,
  home: HomeSeal,
  choices: SealChoices = {},
): Wrapper {
  const msgId = choices.msgId ?? randomUUID();
  const sentAt = utcSeconds(choices.sentAt ?? new Date());
  const plaintext = Buffer.from(
    canonicalJson({ ...fields, msg_id: msgId, sent_at: sentAt, type }),
    "utf8",
  );
  const label = { homeId: home.homeId, type };
  const envelope = seal(plaintext, home.homeKey, HOME_KID, label, choices.nonce);
  plaintext.fill(0);
  const wrapper: Wrapper = { v: 1, msg_id: msgId, type, sent_at: sentAt, envelope };
  const { alert_id: collapseId } = fields;
  return type === "alert" && typeof collapseId === "string"
    ? { ...wrapper, collapse_id: collapseId }
    : wrapper;
}

/** An alert, for every caregiver phone (§3). */
export function sealAlert(alert: AlertFields, home: HomeSeal, choices: SealChoices = {}): Wrapper {
  return sealHomeMessage("alert", alert, home, choices);
}

/** Layer 4's live status, for every caregiver phone; its fields arrive with that step (§3). */
export function sealCareStatus(
  status: Readonly<Record<string, unknown>>,
  home: HomeSeal,
  choices: SealChoices = {},
): Wrapper {
  return sealHomeMessage("care_status", status, home, choices);
}

/** The heartbeat, which carries no fields and goes through the relay only, never the outbox (§3). */
export function sealHeartbeat(home: HomeSeal, choices: SealChoices = {}): Wrapper {
  return sealHomeMessage("heartbeat", {}, home, choices);
}

/** Layer 4's daily report, for every caregiver phone (§3). */
export function sealReport(
  report: Readonly<Record<string, unknown>>,
  home: HomeSeal,
  choices: SealChoices = {},
): Wrapper {
  return sealHomeMessage("report", report, home, choices);
}

/** The phone a `reply` is sealed for, with its own key. Never log the key. */
export type PhoneSeal = Readonly<{ homeId: string; deviceId: string; phoneKey: KeyObject }>;

/**
 * Layer 4's answer to one phone's request (§3): sealed with that phone's own key, kid its device ID,
 * and routed to it alone by `to`, so no other phone fetches it.
 */
export function sealReply(
  reply: Readonly<Record<string, unknown>>,
  phone: PhoneSeal,
  choices: SealChoices = {},
): Wrapper {
  const msgId = choices.msgId ?? randomUUID();
  const sentAt = utcSeconds(choices.sentAt ?? new Date());
  const type = "reply";
  const plaintext = Buffer.from(
    canonicalJson({ ...reply, msg_id: msgId, sent_at: sentAt, type }),
    "utf8",
  );
  const label = { homeId: phone.homeId, type };
  const envelope = seal(plaintext, phone.phoneKey, phone.deviceId, label, choices.nonce);
  plaintext.fill(0);
  return { v: 1, msg_id: msgId, type, sent_at: sentAt, to: phone.deviceId, envelope };
}
