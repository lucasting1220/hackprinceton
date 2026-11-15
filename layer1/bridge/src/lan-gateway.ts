/**
 * The LAN gateway (phone-hub.md §4.4 to §4.6): requests from paired phones, each sealed with the
 * phone's own key. openPhoneRequest runs checks 1 to 6 and knows nothing of HTTP or of the route a
 * request came by, so step 5's relay connector can call it too; the routes then switch on the
 * type. Log lines name device IDs only, never a key, a plaintext or a request.
 */
import type { KeyObject } from "node:crypto";
import type { Reply, Route } from "./network-server.ts";
import { errorReply } from "./network-server.ts";
import type { MessageSource } from "./outbox.ts";
import { open, PhoneCryptoRefusal } from "./phone-crypto.ts";
import { COORDINATOR_DOWN, HANDOFF_TYPES, type PhoneHandoff } from "./phone-handoff.ts";
import type { PhoneLookup } from "./phones.ts";
import * as settings from "./settings.ts";
import { isUtcTime, parseWrapper, utcSeconds, type Wrapper } from "./wire.ts";

/** What the gateway needs of the phone list: PhoneRegistry, or an in-memory list in tests. */
export interface PhoneDirectory {
  lookup(deviceId: string): PhoneLookup;
  remove(deviceId: string): Promise<void>;
}

export interface LanGatewayOptions {
  readonly homeId: string;
  readonly phones: PhoneDirectory;
  /** The clock, in milliseconds since the Unix epoch; tests pass their own. */
  readonly now?: () => number;
  /** Gets the gateway's lines; console.log by default. */
  readonly log?: (line: string) => void;
  /** Step 4's outbox, which fills a fetch's page; without one every page is empty. */
  readonly outbox?: MessageSource;
  /** Handlers for the later steps' command types, in place of 501 (step 3: laptop_approval). */
  readonly handlers?: Readonly<Record<string, CommandHandler>>;
  /** Carries `request` and `watch_data` to Layer 2's coordinator; without it they get 503. */
  readonly handoff?: PhoneHandoff;
}

/** What a command type's handler answers for an opened request. */
export type CommandHandler = (request: OpenedRequest) => Promise<Reply>;

/** A request that passed checks 1 to 6: the phone, and the plaintext as a JSON object. */
export type OpenedRequest = Readonly<{
  deviceId: string;
  role: "caregiver" | "resident";
  type: string;
  plaintext: Readonly<Record<string, unknown>>;
}>;

export type OpenResult =
  | Readonly<{ ok: true; request: OpenedRequest }>
  | Readonly<{ ok: false; reply: Reply }>;

/** The refusals of §4.6. Each message is fixed and never repeats the request. */
const REFUSED = {
  badRequest: errorReply(400, "bad_request", "The request is malformed."),
  unsupportedVersion: errorReply(400, "unsupported_version", "This version is not supported."),
  unknownDevice: errorReply(403, "unknown_device", "This phone isn't paired with this home."),
  deviceRemoved: errorReply(403, "device_removed", "This phone was removed from the home."),
  badEnvelope: errorReply(400, "bad_envelope", "The envelope doesn't open, or doesn't match."),
  stale: errorReply(400, "stale", "The request's time is too far from the hub's clock."),
  duplicate: errorReply(409, "duplicate", "This message was already received."),
  unsupportedType: errorReply(400, "unsupported_type", "This path doesn't take this type."),
  notSupported: errorReply(501, "not_supported", "The hub doesn't handle this type yet."),
  lanOnly: errorReply(400, "lan_only", "This type travels on the home Wi-Fi only."),
};

/** The route a command came by: the LAN gateway's own path, or the relay link (step 5). */
export type CommandRoute = "lan" | "relay";

/** Types that never travel through the relay (phone-hub.md §5.5). */
const LAN_ONLY: ReadonlySet<string> = new Set(["heart_rate", "fetch"]);

/** Commands that a later step builds: 501 until then, on either route (Reconciliation 11). */
const LATER_COMMANDS: ReadonlySet<string> = new Set(["laptop_approval", "live_view_setting"]);

const utf8 = new TextDecoder("utf-8", { fatal: true });

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class LanGateway {
  readonly #homeId: string;
  readonly #phones: PhoneDirectory;
  readonly #now: () => number;
  readonly #log: (line: string) => void;
  readonly #outbox: MessageSource | undefined;
  readonly #handlers: Readonly<Record<string, CommandHandler>>;
  readonly #handoff: PhoneHandoff | undefined;
  /** Per phone, each msg_id seen in the last PHONE_SEEN_IDS_MS and when, oldest first. */
  readonly #seen = new Map<string, Map<string, number>>();
  /** Per phone, when its wrong clock was last logged. */
  readonly #staleLogged = new Map<string, number>();

  constructor(options: LanGatewayOptions) {
    this.#homeId = options.homeId;
    this.#phones = options.phones;
    this.#now = options.now ?? Date.now;
    this.#log = options.log ?? ((line: string) => console.log(line));
    this.#outbox = options.outbox;
    this.#handlers = options.handlers ?? {};
    this.#handoff = options.handoff;
  }

  /**
   * Records a msg_id from `sender`, false if it came in the last PHONE_SEEN_IDS_MS: the one memory
   * of message IDs, which the bridge link shares under senders "node:<node_id>" (phone-hub.md §6.6).
   */
  rememberMsgId(sender: string, msgId: string): boolean {
    return this.#remember(sender, msgId, this.#now());
  }

  /** §4.4's checks 1 to 6, in order, on a received wrapper. */
  openPhoneRequest(body: unknown): OpenResult {
    const parsed = parseWrapper(body);
    if (!parsed.ok) {
      const newer = parsed.code === "unsupported_version";
      return refuse(newer ? REFUSED.unsupportedVersion : REFUSED.badRequest);
    }
    const { wrapper } = parsed;
    const deviceId = wrapper.envelope.kid;
    const phone = this.#phones.lookup(deviceId);
    if (phone.state !== "paired") {
      return refuse(phone.state === "removed" ? REFUSED.deviceRemoved : REFUSED.unknownDevice);
    }
    const plaintext = this.#open(wrapper.envelope, phone.phoneKey, wrapper.type);
    if (plaintext === undefined) return refuse(REFUSED.badEnvelope);
    const { type, msg_id: msgId, sent_at: sentAt } = plaintext;
    if (type !== wrapper.type || msgId !== wrapper.msg_id || !isUtcTime(sentAt)) {
      return refuse(REFUSED.badEnvelope);
    }
    const now = this.#now();
    const skew = Date.parse(sentAt) - now;
    if (Math.abs(skew) > settings.PHONE_CLOCK_SKEW_MS) {
      this.#logStale(deviceId, skew > 0 ? "ahead" : "behind", now);
      return refuse(REFUSED.stale);
    }
    if (!this.#remember(deviceId, msgId, now)) return refuse(REFUSED.duplicate);
    return { ok: true, request: { deviceId, role: phone.role, type, plaintext } };
  }

  /** POST /v1/lan/messages and POST /v1/lan/commands, for the network side. */
  routes(): Route[] {
    return [
      { method: "POST", path: "/v1/lan/messages", handle: (body) => this.messages(body) },
      { method: "POST", path: "/v1/lan/commands", handle: (body) => this.commands(body) },
    ];
  }

  /** A `fetch` gets the page (§4.5); step 4 fills its messages from the outbox. */
  messages(body: unknown): Reply {
    const opened = this.openPhoneRequest(body);
    if (!opened.ok) return opened.reply;
    const { type, plaintext, deviceId, role } = opened.request;
    if (type !== "fetch") return REFUSED.unsupportedType;
    const { after, limit } = plaintext;
    const cursorOk = after === null || typeof after === "string";
    if (!cursorOk || typeof limit !== "number" || !Number.isInteger(limit) || limit < 1) {
      return REFUSED.badRequest;
    }
    const hub = { online: true, last_contact_at: utcSeconds(new Date(this.#now())) };
    const page = this.#outbox?.page(after, limit, forPhone(deviceId, role)) ?? EMPTY_PAGE;
    return { status: 200, body: { v: 1, messages: page.messages, next: page.next, hub } };
  }

  /**
   * A phone → hub command, by either route: through the relay, `heart_rate` and `fetch` get
   * lan_only; `unpair` removes the phone, `request` and `watch_data` go to the coordinator, a
   * handler's type goes to it, and others get 501.
   */
  async commands(body: unknown, route: CommandRoute = "lan"): Promise<Reply> {
    const opened = this.openPhoneRequest(body);
    if (!opened.ok) return opened.reply;
    const { type, deviceId } = opened.request;
    if (route === "relay" && LAN_ONLY.has(type)) return REFUSED.lanOnly;
    if (Object.hasOwn(HANDOFF_TYPES, type)) {
      const phone = () => this.#phones.lookup(deviceId);
      return this.#handoff?.forward(opened.request, phone) ?? COORDINATOR_DOWN;
    }
    const handler = Object.hasOwn(this.#handlers, type) ? this.#handlers[type] : undefined;
    if (handler !== undefined) return handler(opened.request);
    if (LATER_COMMANDS.has(type)) return REFUSED.notSupported;
    if (type !== "unpair") return REFUSED.unsupportedType;
    await this.#phones.remove(deviceId);
    this.#seen.delete(deviceId);
    this.#log(`L1 lan-gateway: phone ${deviceId} unpaired itself (${route})`);
    return { status: 202, body: { v: 1, accepted: true } };
  }

  /** Checks 3 and the first half of 4: the plaintext as a JSON object, or undefined. */
  #open(envelope: Parameters<typeof open>[0], key: KeyObject, type: string) {
    let bytes: Buffer;
    try {
      bytes = open(envelope, key, { homeId: this.#homeId, type });
    } catch (error) {
      if (error instanceof PhoneCryptoRefusal) return undefined;
      throw error;
    }
    try {
      const value: unknown = JSON.parse(utf8.decode(bytes));
      return isRecord(value) ? value : undefined;
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof TypeError) return undefined;
      throw error;
    } finally {
      bytes.fill(0);
    }
  }

  /** Records `msgId` for this phone; false if it came in the last PHONE_SEEN_IDS_MS. */
  #remember(deviceId: string, msgId: string, now: number): boolean {
    let seen = this.#seen.get(deviceId);
    if (seen === undefined) {
      seen = new Map();
      this.#seen.set(deviceId, seen);
    }
    for (const [id, at] of seen) {
      if (now - at < settings.PHONE_SEEN_IDS_MS) break;
      seen.delete(id);
    }
    if (seen.has(msgId)) return false;
    seen.set(msgId, now);
    while (seen.size > settings.PHONE_SEEN_IDS_MAX) {
      const oldest = seen.keys().next();
      if (oldest.done === true) break;
      seen.delete(oldest.value);
    }
    return true;
  }

  /** One line per phone at most once a STALE_LOG_INTERVAL_MS (R7). */
  #logStale(deviceId: string, direction: "ahead" | "behind", now: number): void {
    const last = this.#staleLogged.get(deviceId);
    if (last !== undefined && now - last < settings.STALE_LOG_INTERVAL_MS) return;
    this.#staleLogged.set(deviceId, now);
    const seconds = settings.PHONE_CLOCK_SKEW_MS / 1000;
    this.#log(
      `L1 lan-gateway: refused requests from ${deviceId}: its clock is more than ${seconds} s ${direction}`,
    );
  }
}

const refuse = (reply: Reply): OpenResult => ({ ok: false, reply });

const EMPTY_PAGE = { messages: [], next: null } as const;

/**
 * The wrappers a phone may fetch (§4.5): a caregiver's home-key messages and those sent to it; a
 * resident holds no home key, so only those sent to it.
 */
const forPhone =
  (deviceId: string, role: OpenedRequest["role"]) =>
  (wrapper: Wrapper): boolean =>
    wrapper.to === deviceId || (role === "caregiver" && wrapper.to === undefined);
