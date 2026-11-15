/**
 * The phones' HTTP API at the relay (phone-hub.md §5), on 127.0.0.1 behind Caddy: sign-in with
 * X-Debbie-Device and a Bearer device credential, the failed sign-in limiter, GET /healthz,
 * GET /v1/home, GET /v1/messages, POST /v1/commands (forwarded to the hub socket),
 * POST /v1/push-tokens and POST /v1/unpair. It never logs a credential, a push token or a body.
 */
import { timingSafeEqual } from "node:crypto";
import * as http from "node:http";
import { credentialHash } from "../../bridge/src/phone-crypto.ts";
import {
  JSON_REQUEST_TIMEOUT_CHECK_MS,
  MESSAGES_PAGE_MAX,
  RELAY_HEADERS_TIMEOUT_MS,
  RELAY_LIMITER_ADDRESSES_MAX,
  RELAY_MAX_BODY_BYTES,
  RELAY_REQUEST_TIMEOUT_MS,
  RELAY_SIGNIN_BLOCK_MS,
  RELAY_SIGNIN_FAILURES_MAX,
  RELAY_SIGNIN_WINDOW_MS,
} from "../../bridge/src/settings.ts";
import { parseWrapper, utcSeconds } from "../../bridge/src/wire.ts";
import { LIVE_VIEW_PATH } from "../../bridge/src/settings.ts";
import { pushConfigured, type RelayConfig } from "./config.ts";
import type { CommandForwarder, CommandOutcome } from "./hub-socket.ts";
import type { LiveViewSessions } from "./live-view.ts";
import {
  type DeviceRecord,
  ENVIRONMENTS,
  type Environment,
  type HomeRecord,
  type RelayStore,
} from "./store.ts";

export interface PhoneApiOptions {
  readonly store: RelayStore;
  readonly config: RelayConfig;
  /** The clock, in milliseconds; tests pass their own. */
  readonly now?: () => number;
  readonly log?: (line: string) => void;
  /** Called once a phone has unpaired itself, so the hub socket can tell a connected hub. */
  readonly onUnpair?: (homeId: string, deviceId: string) => void;
  /** Where POST /v1/commands goes: the hub socket. Without one, every hub is offline. */
  readonly commands?: CommandForwarder;
  readonly limiter?: SignInLimiter;
  /** Live view's sessions (§7). Without them, a live view request gets 503 hub_offline. */
  readonly liveView?: LiveViewSessions;
}

interface Reply {
  readonly status: number;
  readonly body?: object;
  readonly headers?: http.OutgoingHttpHeaders;
}

function errorReply(status: number, code: string, message: string): Reply {
  return { status, body: { v: 1, error: { code, message } } };
}

/** The relay's refusals (phone-hub.md §5.6). Messages are fixed and never repeat the request. */
export const REFUSED = {
  notFound: errorReply(404, "not_found", "There is no such path."),
  method: errorReply(405, "method_not_allowed", "This path takes another method."),
  notJson: errorReply(415, "unsupported_media_type", "The body must be JSON."),
  tooLarge: errorReply(413, "too_large", "The body is too large."),
  badJson: errorReply(400, "bad_json", "The body isn't valid JSON."),
  badRequest: errorReply(400, "bad_request", "A field is missing or malformed."),
  version: errorReply(400, "unsupported_version", "This version isn't supported."),
  wrongApp: errorReply(400, "wrong_app", "The push token is for another app."),
  unauthorized: errorReply(401, "unauthorized", "The device or its credential isn't known."),
  removed: errorReply(401, "device_removed", "This iPhone was removed from the home."),
  forbidden: errorReply(403, "forbidden", "This device may not do that."),
  tooMany: errorReply(429, "too_many_attempts", "Too many failed sign-ins. Try again later."),
  internal: errorReply(500, "internal", "Something went wrong in the relay."),
  lanOnly: errorReply(400, "lan_only", "This command travels on the home network only."),
  unsupportedType: errorReply(400, "unsupported_type", "The relay never forwards this type."),
  hubOffline: errorReply(503, "hub_offline", "The home laptop isn't connected to the relay."),
  hubTimeout: errorReply(504, "hub_timeout", "The home laptop didn't answer in time."),
} as const;

/** The session path of live view's status and stop calls (§7.2, §7.3). */
const SESSION_PATH = new RegExp(`^${LIVE_VIEW_PATH}/([0-9a-f-]{36})$`);

/** Commands the relay never carries (§5.5): watch readings stay on the home network. */
const LAN_ONLY_TYPES: readonly string[] = ["heart_rate", "fetch"];
/** The commands the relay forwards to the hub, and those of them a resident may send (R14). */
const RELAYED_TYPES: readonly string[] = [
  "request",
  "laptop_approval",
  "live_view_setting",
  "unpair",
];
const RESIDENT_TYPES: readonly string[] = ["live_view_setting", "unpair"];

const ID = /^[A-Za-z0-9._-]{1,64}$/;
const BEARER = /^Bearer ([A-Za-z0-9_-]{1,256})$/;
/** An APNs device token: hex, 32 bytes today, and Apple says it may grow. */
const PUSH_TOKEN = /^[0-9a-fA-F]{64,200}$/;
const LIMIT = /^\d{1,9}$/;

interface Entry {
  windowStartMs: number;
  failures: number;
  blockedUntilMs: number;
  lastSeenMs: number;
}

/**
 * Failed sign-ins per address: RELAY_SIGNIN_FAILURES_MAX within a window block the address for
 * RELAY_SIGNIN_BLOCK_MS. An address is forgotten after a quiet window, and at most `capacity` are
 * held, the least recently seen dropped first, so a scan from many addresses can't grow it.
 */
export class SignInLimiter {
  readonly #entries = new Map<string, Entry>();
  readonly #capacity: number;

  constructor(capacity = RELAY_LIMITER_ADDRESSES_MAX) {
    this.#capacity = capacity;
  }

  get size(): number {
    return this.#entries.size;
  }

  isBlocked(address: string, nowMs: number): boolean {
    return (this.#entries.get(address)?.blockedUntilMs ?? 0) > nowMs;
  }

  /** Counts a failed sign-in; true when this failure blocks the address. */
  recordFailure(address: string, nowMs: number): boolean {
    this.#forget(nowMs);
    const known = this.#entries.get(address);
    const entry =
      known !== undefined && nowMs - known.windowStartMs < RELAY_SIGNIN_WINDOW_MS
        ? known
        : { windowStartMs: nowMs, failures: 0, blockedUntilMs: 0, lastSeenMs: nowMs };
    entry.failures += 1;
    entry.lastSeenMs = nowMs;
    const blocks = entry.failures >= RELAY_SIGNIN_FAILURES_MAX;
    if (blocks) {
      entry.blockedUntilMs = nowMs + RELAY_SIGNIN_BLOCK_MS;
      entry.windowStartMs = nowMs;
      entry.failures = 0;
    }
    // Map keeps insertion order, so re-inserting keeps the least recently seen first.
    this.#entries.delete(address);
    this.#entries.set(address, entry);
    for (const oldest of this.#entries.keys()) {
      if (this.#entries.size <= this.#capacity) break;
      this.#entries.delete(oldest);
    }
    return blocks;
  }

  /** Drops the addresses that have been quiet for a window and aren't blocked. */
  #forget(nowMs: number): void {
    for (const [address, entry] of this.#entries) {
      const quiet = nowMs - entry.lastSeenMs >= RELAY_SIGNIN_WINDOW_MS;
      if (!quiet || entry.blockedUntilMs > nowMs) break;
      this.#entries.delete(address);
    }
  }
}

export type SignIn =
  | Readonly<{ ok: true; device: DeviceRecord; home: HomeRecord }>
  | Readonly<{ ok: false; reply: Reply; failed: boolean }>;

/** A digest no stored hash equals, compared against when the device is unknown. */
const NO_DEVICE = Buffer.alloc(32);

/**
 * Checks X-Debbie-Device and the Bearer credential against the stored hash in constant time. A
 * revoked device hears device_removed only with its own credential. `failed` counts toward the
 * limiter.
 */
export function signIn(store: RelayStore, headers: http.IncomingHttpHeaders): SignIn {
  const deviceId = headers["x-debbie-device"];
  const credential = BEARER.exec(headers.authorization ?? "")?.[1];
  if (typeof deviceId !== "string" || !ID.test(deviceId) || credential === undefined) {
    return { ok: false, reply: REFUSED.unauthorized, failed: true };
  }
  const device = store.device(deviceId);
  const stored = device === undefined ? NO_DEVICE : Buffer.from(device.credentialSha256, "hex");
  const presented = Buffer.from(credentialHash(credential), "hex");
  const matches = stored.length === presented.length && timingSafeEqual(stored, presented);
  if (device === undefined || !matches) {
    return { ok: false, reply: REFUSED.unauthorized, failed: true };
  }
  if (device.revokedAtMs !== null) return { ok: false, reply: REFUSED.removed, failed: false };
  const home = store.home(device.homeId);
  if (home === undefined) return { ok: false, reply: REFUSED.unauthorized, failed: true };
  return { ok: true, device, home };
}

interface Signed {
  readonly device: DeviceRecord;
  readonly home: HomeRecord;
  readonly url: URL;
  readonly request: http.IncomingMessage;
  /** The live view session ID in the path, for §7's session calls; "" for other paths. */
  readonly sessionId: string;
}

interface Route {
  readonly method: "GET" | "POST" | "DELETE";
  /** The path, or "session" for live view's per-session path (§7). */
  readonly path: string;
  /** Whether a resident device may call it (R14). */
  readonly resident: boolean;
  readonly handle: (signed: Signed) => Reply | Promise<Reply>;
}

const iso = (ms: number | null): string | null => (ms === null ? null : utcSeconds(new Date(ms)));

/** The hub's state: online only while its connection is open (R15). */
function hubState(home: HomeRecord): object {
  return { online: home.hubConnected, last_contact_at: iso(home.lastContactAtMs) };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Makes the phone API's server; the caller listens on 127.0.0.1. Headers must arrive within 10
 * seconds and the whole request within 15.
 */
export function createPhoneApi(options: PhoneApiOptions): http.Server {
  const { store, config } = options;
  const now = options.now ?? Date.now;
  const log = options.log ?? ((line: string) => console.log(line));
  const limiter = options.limiter ?? new SignInLimiter();

  /** Push health for the caller's environment: that of its newest token, else production. */
  const pushState = (deviceId: string): object => {
    const env: Environment = store.pushEnvironment(deviceId) ?? "production";
    if (!pushConfigured(config, env)) return { state: "not_configured", since: null };
    const health = store.pushHealth(env);
    const failing =
      health.lastErrorAtMs !== null &&
      (health.lastOkAtMs === null || health.lastErrorAtMs > health.lastOkAtMs);
    return failing
      ? { state: "failing", since: iso(health.lastErrorAtMs) }
      : { state: "ok", since: iso(health.lastOkAtMs) };
  };

  const routes: readonly Route[] = [
    {
      method: "GET",
      path: "/v1/home",
      resident: true,
      handle: ({ device, home }) => ({
        status: 200,
        body: { v: 1, home_id: home.homeId, hub: hubState(home), push: pushState(device.deviceId) },
      }),
    },
    {
      method: "GET",
      path: "/v1/messages",
      resident: true,
      handle: ({ device, home, url }) => {
        const limitText = url.searchParams.get("limit");
        const limit = limitText === null ? MESSAGES_PAGE_MAX : Number(limitText);
        if (limitText !== null && (!LIMIT.test(limitText) || limit < 1)) return REFUSED.badRequest;
        const page = store.messagePage({
          homeId: home.homeId,
          deviceId: device.deviceId,
          role: device.role,
          after: url.searchParams.get("after"),
          limit: Math.min(limit, MESSAGES_PAGE_MAX),
          nowMs: now(),
        });
        return { status: 200, body: { v: 1, ...page, hub: hubState(home) } };
      },
    },
    {
      method: "POST",
      path: "/v1/commands",
      resident: true,
      handle: async ({ device, home, request }) => {
        const read = await readJsonBody(request);
        if (!read.ok) return read.reply;
        const parsed = parseWrapper(read.value);
        if (!parsed.ok) {
          return parsed.code === "unsupported_version" ? REFUSED.version : REFUSED.badRequest;
        }
        const { wrapper } = parsed;
        if (wrapper.envelope.kid !== device.deviceId) return REFUSED.forbidden;
        if (LAN_ONLY_TYPES.includes(wrapper.type)) return REFUSED.lanOnly;
        if (device.role === "resident" && !RESIDENT_TYPES.includes(wrapper.type)) {
          return REFUSED.forbidden;
        }
        if (!RELAYED_TYPES.includes(wrapper.type)) return REFUSED.unsupportedType;
        if (options.commands === undefined) return REFUSED.hubOffline;
        const outcome = await options.commands.forward(home.homeId, device.deviceId, wrapper);
        return commandReply(outcome, device);
      },
    },
    {
      method: "POST",
      path: LIVE_VIEW_PATH,
      resident: false,
      handle: async ({ device, home, request }) => {
        const read = await readJsonBody(request);
        if (!read.ok) return read.reply;
        const parsed = parseWrapper(read.value);
        if (!parsed.ok) {
          return parsed.code === "unsupported_version" ? REFUSED.version : REFUSED.badRequest;
        }
        const { wrapper } = parsed;
        if (wrapper.envelope.kid !== device.deviceId) return REFUSED.forbidden;
        if (wrapper.type !== "live_view_request") return REFUSED.unsupportedType;
        const started = options.liveView?.start(home.homeId, device.deviceId, wrapper);
        return started === undefined ? REFUSED.hubOffline : { status: 202, body: started };
      },
    },
    {
      method: "GET",
      path: "session",
      resident: false,
      handle: ({ device, sessionId }) => {
        const status = options.liveView?.status(device.deviceId, sessionId);
        return status === undefined ? REFUSED.notFound : { status: 200, body: status };
      },
    },
    {
      method: "DELETE",
      path: "session",
      resident: false,
      handle: ({ device, request, sessionId }) => {
        request.resume();
        const stopped = options.liveView?.stop(device.deviceId, sessionId) ?? false;
        return stopped ? { status: 204 } : REFUSED.notFound;
      },
    },
    {
      method: "POST",
      path: "/v1/push-tokens",
      resident: false,
      handle: async ({ device, request }) => {
        const read = await readJsonBody(request);
        if (!read.ok) return read.reply;
        const body = read.value;
        if (!isRecord(body)) return REFUSED.badRequest;
        const { v, token, environment, bundle_id: bundleId } = body;
        if (typeof v === "number" && v > 1) return REFUSED.version;
        if (v !== 1 || typeof token !== "string" || !PUSH_TOKEN.test(token)) {
          return REFUSED.badRequest;
        }
        const env = ENVIRONMENTS.find((known) => known === environment);
        if (env === undefined || typeof bundleId !== "string" || bundleId === "") {
          return REFUSED.badRequest;
        }
        if (config.apns !== undefined && bundleId !== config.apns.topic) return REFUSED.wrongApp;
        store.setPushToken(device.deviceId, env, token.toLowerCase(), now());
        log(`L1 relay: device ${device.deviceId} registered a ${env} push token`);
        return { status: 204 };
      },
    },
    {
      method: "POST",
      path: "/v1/unpair",
      resident: true,
      handle: ({ device, home, request }) => {
        request.resume();
        store.revokeDevice(device.deviceId, now());
        log(`L1 relay: device ${device.deviceId} of home ${home.homeId} unpaired itself`);
        options.onUnpair?.(home.homeId, device.deviceId);
        return { status: 204 };
      },
    },
  ];

  /**
   * The phone's answer to its command: the relay's 503 and 504, or the hub's answer passed through,
   * except a hub 403, which is the relay's 401 (and revokes the device for device_removed).
   */
  const commandReply = (outcome: CommandOutcome, device: DeviceRecord): Reply => {
    switch (outcome.kind) {
      case "offline":
        return REFUSED.hubOffline;
      case "timeout":
        return REFUSED.hubTimeout;
      case "accepted":
        return { status: 202, body: { v: 1, accepted: true } };
      case "refused":
        if (outcome.status !== 403) {
          return errorReply(outcome.status, outcome.code, "The home laptop refused this command.");
        }
        if (outcome.code !== "device_removed") return REFUSED.unauthorized;
        store.revokeDevice(device.deviceId, now());
        log(`L1 relay: the hub says device ${device.deviceId} was removed; revoked it`);
        return REFUSED.removed;
    }
  };

  const answer = async (request: http.IncomingMessage): Promise<Reply> => {
    const url = new URL(request.url ?? "/", "http://relay.invalid");
    if (url.pathname === "/healthz") {
      if (request.method === "GET") return { status: 200, body: { v: 1, ok: true } };
      return { ...REFUSED.method, headers: { Allow: "GET" } };
    }
    const session = SESSION_PATH.exec(url.pathname);
    const path = session === null ? url.pathname : "session";
    const route = routes.find((row) => row.path === path && row.method === request.method);
    if (route === undefined) {
      const allowed = routes.filter((row) => row.path === path).map((row) => row.method);
      if (allowed.length === 0) return REFUSED.notFound;
      return { ...REFUSED.method, headers: { Allow: allowed.join(", ") } };
    }
    const address = clientAddress(request);
    if (limiter.isBlocked(address, now())) return REFUSED.tooMany;
    const signed = signIn(store, request.headers);
    if (!signed.ok) {
      if (signed.failed && limiter.recordFailure(address, now())) {
        log(`L1 relay: blocked ${address} for a minute after repeated failed sign-ins`);
      }
      return signed.reply;
    }
    if (signed.device.role === "resident" && !route.resident) return REFUSED.forbidden;
    const sessionId = session?.[1] ?? "";
    return route.handle({ device: signed.device, home: signed.home, url, request, sessionId });
  };

  const server = http.createServer(
    {
      headersTimeout: RELAY_HEADERS_TIMEOUT_MS,
      requestTimeout: RELAY_REQUEST_TIMEOUT_MS,
      connectionsCheckingInterval: JSON_REQUEST_TIMEOUT_CHECK_MS,
    },
    (request, response) => {
      answer(request)
        .then((reply) => send(response, reply))
        .catch((error: unknown) => {
          log(`L1 relay: a phone request failed with ${errorClass(error)}`);
          if (!response.headersSent) send(response, REFUSED.internal);
        });
    },
  );
  return server;
}

/** The caller's address: the last X-Forwarded-For entry, which Caddy adds, else the socket's. */
function clientAddress(request: http.IncomingMessage): string {
  const forwarded = request.headers["x-forwarded-for"];
  const last = (typeof forwarded === "string" ? forwarded : "").split(",").at(-1)?.trim();
  return last !== undefined && last !== "" ? last : (request.socket.remoteAddress ?? "unknown");
}

type JsonBody = Readonly<{ ok: true; value: unknown }> | Readonly<{ ok: false; reply: Reply }>;

const utf8 = new TextDecoder("utf-8", { fatal: true });

/**
 * Reads a JSON body of at most RELAY_MAX_BODY_BYTES (else 413) in application/json (else 415);
 * the server's request time limit bounds the wait.
 */
function readJsonBody(request: http.IncomingMessage): Promise<JsonBody> {
  const mediaType = request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    request.resume();
    return Promise.resolve({ ok: false, reply: REFUSED.notJson });
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= RELAY_MAX_BODY_BYTES) chunks.push(chunk);
      else resolve({ ok: false, reply: REFUSED.tooLarge });
    });
    request.on("end", () => {
      if (size > RELAY_MAX_BODY_BYTES) return;
      try {
        resolve({ ok: true, value: JSON.parse(utf8.decode(Buffer.concat(chunks))) });
      } catch {
        resolve({ ok: false, reply: REFUSED.badJson });
      }
    });
    request.on("error", reject);
  });
}

/** Sends a reply as JSON that no cache keeps, with no CORS headers. */
function send(response: http.ServerResponse, reply: Reply): void {
  if (reply.body === undefined) {
    response.writeHead(reply.status, { ...reply.headers, "Cache-Control": "no-store" });
    response.end();
    return;
  }
  const text = JSON.stringify(reply.body);
  response.writeHead(reply.status, {
    ...reply.headers,
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
  });
  response.end(text);
}

/** The class of what was thrown: all a log line says of a failed request. */
const errorClass = (error: unknown): string =>
  error instanceof Error ? error.constructor.name : typeof error;
