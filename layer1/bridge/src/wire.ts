/**
 * The phone ↔ hub routing wrapper (§3 of the contract): its type, its shape check and the hub's
 * time format, the one copy the LAN gateway, step 4's sealer and step 5's relay share. It never
 * opens the envelope and imports only phone-crypto.ts (no I/O), so the relay may import it.
 */
import type { Envelope } from "./phone-crypto.ts";
import { fromBase64url, NONCE_BYTES, PhoneCryptoRefusal, TAG_BYTES } from "./phone-crypto.ts";

/** msg_id, the envelope's kid and to are IDs: strings with no meaning in their format (§1). */
const ID = /^[A-Za-z0-9._-]{1,64}$/;
const TYPE = /^[a-z][a-z0-9_]{0,31}$/;
/** ISO 8601 in UTC with Z, to the second as the app and the hub write it, or with a fraction. */
const UTC_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
/** collapse_id, the alert's ID, becomes the APNs collapse ID, which is at most 64 bytes. */
const COLLAPSE_ID_MAX_BYTES = 64;

/** A wrapper as it travels: the envelope stays sealed, and collapse_id is only on an alert. */
export type Wrapper = Readonly<{
  v: 1;
  msg_id: string;
  type: string;
  sent_at: string;
  to?: string;
  collapse_id?: string;
  envelope: Envelope;
}>;

/** The field a refusal is about, by name and never by value, so a refusal is safe to log. */
export type WrapperField = "wrapper" | keyof Wrapper | `envelope.${keyof Envelope}`;

/** The wrapper with only the contract's fields, or the first bad field and the error code. */
export type ParsedWrapper =
  | Readonly<{ ok: true; wrapper: Wrapper }>
  | Readonly<{ ok: false; code: "bad_request" | "unsupported_version"; field: WrapperField }>;

/** `date` in UTC to the whole second, the way the hub writes every time: 2026-11-14T15:10:00Z. */
export function utcSeconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function isId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

/** The UTC form above, on a real date and time: 2026-02-30 and 23:59:60 are refused. */
export function isUtcTime(value: unknown): value is string {
  if (typeof value !== "string" || !UTC_TIME.test(value)) return false;
  const seconds = `${value.slice(0, 19)}Z`;
  const date = new Date(seconds);
  return !Number.isNaN(date.getTime()) && utcSeconds(date) === seconds;
}

/** Whether `value` is strict base64url of that many bytes, through phone-crypto's one decoder. */
function decodes(value: unknown, bytes: number | { readonly atLeast: number }): value is string {
  if (typeof value !== "string") return false;
  try {
    fromBase64url(value, bytes);
  } catch (error) {
    if (error instanceof PhoneCryptoRefusal) return false;
    throw error;
  }
  return true;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A `v` above 1 is a newer version, which the contract answers with its own code (§1). */
function refuse(field: WrapperField, version?: unknown): ParsedWrapper {
  const newer = typeof version === "number" && version > 1;
  return { ok: false, code: newer ? "unsupported_version" : "bad_request", field };
}

/**
 * Checks a received wrapper's shape (§3) with no key, and returns a new wrapper holding only the
 * contract's fields, so an unknown field is never passed on.
 */
export function parseWrapper(value: unknown): ParsedWrapper {
  if (!isRecord(value)) return refuse("wrapper");
  const { v, msg_id, type, sent_at, to, collapse_id, envelope } = value;
  if (v !== 1) return refuse("v", v);
  if (!isId(msg_id)) return refuse("msg_id");
  if (typeof type !== "string" || !TYPE.test(type)) return refuse("type");
  if (!isUtcTime(sent_at)) return refuse("sent_at");
  if (to !== undefined && !isId(to)) return refuse("to");
  // A lone surrogate has no UTF-8 form to count, and the app can't decode a page holding one.
  const collapses =
    typeof collapse_id === "string" &&
    type === "alert" &&
    collapse_id.isWellFormed() &&
    Buffer.byteLength(collapse_id, "utf8") <= COLLAPSE_ID_MAX_BYTES;
  if (collapse_id !== undefined && !collapses) return refuse("collapse_id");
  if (!isRecord(envelope)) return refuse("envelope");
  const { v: version, kid, n, c } = envelope;
  if (version !== 1) return refuse("envelope.v", version);
  if (!isId(kid)) return refuse("envelope.kid");
  if (!decodes(n, NONCE_BYTES)) return refuse("envelope.n");
  if (!decodes(c, { atLeast: TAG_BYTES })) return refuse("envelope.c");
  const wrapper: Wrapper = { v: 1, msg_id, type, sent_at, envelope: { v: 1, kid, n, c } };
  const routed = to === undefined ? wrapper : { ...wrapper, to };
  return { ok: true, wrapper: collapse_id === undefined ? routed : { ...routed, collapse_id } };
}
