/**
 * The frames on the hub's WebSocket to the relay (layer1/contracts/hub-relay-messages.json): their
 * types, their checks and their text form. The relay's hub socket and the bridge's relay link both
 * import it. It imports only wire.ts and phone-crypto.ts' types (no I/O), so the relay may use it.
 * Every refusal names a field, never a value, so a refusal is safe to log.
 */
import type { Role } from "./phone-crypto.ts";
import { parseWrapper, type Wrapper } from "./wire.ts";

/** The path the hub opens its WebSocket on, at the relay's public URL. */
export const HUB_PATH = "/v1/hub";

/** The relay's own close codes: a newer connection for the home, or a credential no longer valid. */
export const HUB_CLOSE = { replaced: 4001, credentialRevoked: 4002 } as const;

/** Why the relay refused a delivered wrapper; the hub retries only `storage`. */
export type NackError = "invalid" | "too_large" | "storage";
const NACK_ERRORS: readonly NackError[] = ["invalid", "too_large", "storage"];

/** One phone of the hub's list. A removed phone carries only its ID: the hub keeps nothing else. */
export type PhoneEntry =
  | Readonly<{ device_id: string; removed: true }>
  | Readonly<{ device_id: string; role: Role; credential_sha256: string; removed: false }>;

// Relay → hub.
export type WelcomeFrame = Readonly<{
  type: "welcome";
  v: 1;
  home_id: string;
  revoked: readonly string[];
}>;
export type AckFrame = Readonly<{ type: "ack"; v: 1; msg_id: string }>;
export type NackFrame = Readonly<{ type: "nack"; v: 1; msg_id: string; error: NackError }>;
export type CommandFrame = Readonly<{ type: "command"; v: 1; from: string; wrapper: Wrapper }>;
export type PhoneUnpairedFrame = Readonly<{ type: "phone_unpaired"; v: 1; device_id: string }>;
export type RelayFrame = WelcomeFrame | AckFrame | NackFrame | CommandFrame | PhoneUnpairedFrame;

// Hub → relay.
export type PhonesFrame = Readonly<{ type: "phones"; v: 1; phones: readonly PhoneEntry[] }>;
export type DeliverFrame = Readonly<{ type: "deliver"; v: 1; wrapper: Wrapper }>;
/**
 * The hub's answer to a `command`: the status and code the LAN gateway gives the same command,
 * `202` with a null code when it accepted it, else an error status (400 to 599) and its code.
 */
export type CommandResultFrame = Readonly<{
  type: "command_result";
  v: 1;
  msg_id: string;
  status: number;
  code: string | null;
}>;
export type HubFrame = PhonesFrame | DeliverFrame | CommandResultFrame;

/**
 * A frame that can't be used. `known` is false for a type this side doesn't take or a newer `v`,
 * which the receiver logs and ignores. `msgId` is a refused `deliver`'s message ID, for its `nack`.
 */
export type FrameRefusal = Readonly<{
  ok: false;
  type: string | undefined;
  known: boolean;
  field: string;
  msgId: string | undefined;
}>;
export type ParsedFrame<T> = Readonly<{ ok: true; frame: T }> | FrameRefusal;

const ID = /^[A-Za-z0-9._-]{1,64}$/;
const TYPE = /^[a-z][a-z0-9_]{0,31}$/;
const CODE = /^[a-z][a-z0-9_]{0,63}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

type Fields = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

class Refused extends Error {
  readonly field: string;
  readonly msgId: string | undefined;

  constructor(field: string, msgId?: string) {
    super(`bad ${field}`);
    this.field = field;
    this.msgId = msgId;
  }
}

function id(fields: Fields, name: string): string {
  const { [name]: value } = fields;
  if (!isId(value)) throw new Refused(name);
  return value;
}

function wrapper(fields: Fields, msgIdOnRefusal: boolean): Wrapper {
  const { wrapper: value } = fields;
  const parsed = parseWrapper(value);
  if (parsed.ok) return parsed.wrapper;
  const { msg_id: msgId } = isRecord(value) ? value : {};
  throw new Refused(`wrapper.${parsed.field}`, msgIdOnRefusal && isId(msgId) ? msgId : undefined);
}

function phoneEntry(value: unknown): PhoneEntry {
  if (!isRecord(value)) throw new Refused("phones");
  const deviceId = id(value, "device_id");
  const { removed, role, credential_sha256: hash } = value;
  if (removed === true) return { device_id: deviceId, removed: true };
  if (removed !== false) throw new Refused("phones.removed");
  if (role !== "caregiver" && role !== "resident") throw new Refused("phones.role");
  if (typeof hash !== "string" || !SHA256_HEX.test(hash)) {
    throw new Refused("phones.credential_sha256");
  }
  return { device_id: deviceId, role, credential_sha256: hash, removed: false };
}

function commandResult(fields: Fields): CommandResultFrame {
  const msgId = id(fields, "msg_id");
  const { status, code } = fields;
  if (typeof status !== "number" || !Number.isInteger(status)) throw new Refused("status");
  if (status === 202) {
    if (code !== null) throw new Refused("code");
    return { type: "command_result", v: 1, msg_id: msgId, status, code: null };
  }
  if (status < 400 || status > 599) throw new Refused("status");
  if (typeof code !== "string" || !CODE.test(code)) throw new Refused("code");
  return { type: "command_result", v: 1, msg_id: msgId, status, code };
}

const HUB_PARSERS: Readonly<Record<HubFrame["type"], (fields: Fields) => HubFrame>> = {
  phones: (fields) => {
    const { phones } = fields;
    if (!Array.isArray(phones)) throw new Refused("phones");
    return { type: "phones", v: 1, phones: phones.map(phoneEntry) };
  },
  deliver: (fields) => ({ type: "deliver", v: 1, wrapper: wrapper(fields, true) }),
  command_result: commandResult,
};

const RELAY_PARSERS: Readonly<Record<RelayFrame["type"], (fields: Fields) => RelayFrame>> = {
  welcome: (fields) => {
    const { revoked } = fields;
    if (!Array.isArray(revoked) || !revoked.every(isId)) throw new Refused("revoked");
    return { type: "welcome", v: 1, home_id: id(fields, "home_id"), revoked: [...revoked] };
  },
  ack: (fields) => ({ type: "ack", v: 1, msg_id: id(fields, "msg_id") }),
  nack: (fields) => {
    const { error: given } = fields;
    const error = NACK_ERRORS.find((known) => known === given);
    if (error === undefined) throw new Refused("error");
    return { type: "nack", v: 1, msg_id: id(fields, "msg_id"), error };
  },
  command: (fields) => ({
    type: "command",
    v: 1,
    from: id(fields, "from"),
    wrapper: wrapper(fields, false),
  }),
  phone_unpaired: (fields) => ({
    type: "phone_unpaired",
    v: 1,
    device_id: id(fields, "device_id"),
  }),
};

function parseWith<T>(
  text: string,
  parsers: Readonly<Record<string, (fields: Fields) => T>>,
): ParsedFrame<T> {
  const refuse = (field: string, type?: string, known = true, msgId?: string): FrameRefusal => ({
    ok: false,
    type,
    known,
    field,
    msgId,
  });
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return refuse("frame");
    throw error;
  }
  if (!isRecord(value)) return refuse("frame");
  const { type, v } = value;
  if (typeof type !== "string" || !TYPE.test(type)) return refuse("type");
  const parser = Object.hasOwn(parsers, type) ? parsers[type] : undefined;
  if (parser === undefined) return refuse("type", type, false);
  if (typeof v === "number" && v > 1) return refuse("v", type, false);
  if (v !== 1) return refuse("v", type);
  try {
    return { ok: true, frame: parser(value) };
  } catch (error) {
    if (error instanceof Refused) return refuse(error.field, type, true, error.msgId);
    throw error;
  }
}

/** Checks a frame the hub sent, keeping only the contract's fields. */
export function parseHubFrame(text: string): ParsedFrame<HubFrame> {
  return parseWith(text, HUB_PARSERS);
}

/** Checks a frame the relay sent, keeping only the contract's fields. */
export function parseRelayFrame(text: string): ParsedFrame<RelayFrame> {
  return parseWith(text, RELAY_PARSERS);
}

/** A frame's text form, as it is sent. */
export function encodeFrame(frame: RelayFrame | HubFrame): string {
  return JSON.stringify(frame);
}
