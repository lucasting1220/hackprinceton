/**
 * Apple's push service (APNs) over HTTP/2 with token-based auth: one connection per environment,
 * one ES256 provider token per environment's key, a timeout on every request, and Apple's answers
 * recorded in the store's push health. A token Apple refuses is deleted. It never logs a push
 * token, a provider token or the key, and reads the key only from the file relay.json names.
 */
import { createPrivateKey, type KeyObject, randomUUID, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as http2 from "node:http2";
import {
  APNS_ANSWER_MAX_BYTES,
  APNS_ORIGINS,
  APNS_REQUEST_TIMEOUT_MS,
  APNS_RETRY_DELAYS_MS,
  APNS_SESSION_IDLE_MS,
  APNS_TOKEN_RENEW_MS,
} from "../../bridge/src/settings.ts";
import type { ApnsConfig, ApnsKey } from "./config.ts";
import type { Environment, PushTarget, RelayStore } from "./store.ts";

/** One push, as Debbie's push builder makes it (push.ts). */
export interface ApnsNotification {
  readonly pushType: "alert";
  readonly priority: 5 | 10;
  readonly expiresAtMs: number;
  /** Already checked to be safe as a header value. */
  readonly collapseId?: string | undefined;
  readonly payload: string;
  /** What the push is for, for the log: a message ID or a hub status, never a secret. */
  readonly label: string;
}

/**
 * Apple's answer for one target: accepted; the token refused and deleted; or failed, after any
 * retries, with Apple's reason or `timeout`, `network`, `key_unreadable` or `not_configured`.
 */
export type PushOutcome =
  | Readonly<{ result: "sent" }>
  | Readonly<{ result: "token_refused"; reason: string }>
  | Readonly<{ result: "failed"; reason: string }>;

export interface ApnsClientOptions {
  readonly store: RelayStore;
  /** relay.json's apns block; without it, or without an environment's key, those pushes are off. */
  readonly apns: ApnsConfig | undefined;
  readonly now?: () => number;
  readonly log?: (line: string) => void;
  /** Where each environment's APNs is: Apple's hosts, or a test's fake. */
  readonly origins?: Readonly<Record<Environment, string>>;
  /** TLS options for the connection, such as a test's own certificate authority. */
  readonly tls?: http2.SecureClientSessionOptions;
  readonly requestTimeoutMs?: number;
  readonly retryDelaysMs?: readonly number[];
  readonly sleep?: (ms: number) => Promise<void>;
}

/** Apple's reasons that mean this device token will never work, so it is deleted (§8). */
const DEAD_TOKEN_REASONS: ReadonlySet<string> = new Set([
  "Unregistered",
  "BadDeviceToken",
  "DeviceTokenNotForTopic",
]);

/** Apple's reasons are short words; anything else is recorded by status alone. */
const REASON = /^[A-Za-z]{1,64}$/;

type Attempt =
  | Readonly<{ kind: "answer"; status: number; reason: string | null }>
  | Readonly<{ kind: "error"; reason: "timeout" | "network" }>;

interface ProviderToken {
  readonly jwt: string;
  readonly issuedAtMs: number;
}

/** A key file that can't be read, or doesn't hold a P-256 private key. */
class ApnsKeyError extends Error {
  override name = "ApnsKeyError";
}

function base64urlJson(value: object): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

/** An APNs provider token: a JWT signed with ES256, `kid` the key ID and `iss` the team ID. */
export function providerToken(
  key: KeyObject,
  keyId: string,
  teamId: string,
  issuedAtMs: number,
): string {
  const header = base64urlJson({ alg: "ES256", kid: keyId });
  const claims = base64urlJson({ iss: teamId, iat: Math.floor(issuedAtMs / 1000) });
  const input = `${header}.${claims}`;
  const signature = sign("sha256", Buffer.from(input, "utf8"), { key, dsaEncoding: "ieee-p1363" });
  return `${input}.${signature.toString("base64url")}`;
}

/** An error's code, such as ENOENT, or its class name: never its message. */
function errorCode(error: Error): string {
  const code: unknown = Object.getOwnPropertyDescriptor(error, "code")?.value;
  return typeof code === "string" ? code : error.name;
}

function answerReason(body: Buffer): string | null {
  if (body.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const reason: unknown = Object.getOwnPropertyDescriptor(parsed, "reason")?.value;
  return typeof reason === "string" && REASON.test(reason) ? reason : null;
}

export class ApnsClient {
  readonly #store: RelayStore;
  readonly #apns: ApnsConfig | undefined;
  readonly #now: () => number;
  readonly #log: (line: string) => void;
  readonly #origins: Readonly<Record<Environment, string>>;
  readonly #tls: http2.SecureClientSessionOptions;
  readonly #timeoutMs: number;
  readonly #retryDelaysMs: readonly number[];
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #sessions = new Map<Environment, http2.ClientHttp2Session>();
  readonly #tokens = new Map<Environment, ProviderToken>();
  readonly #keys = new Map<Environment, KeyObject>();

  constructor(options: ApnsClientOptions) {
    this.#store = options.store;
    this.#apns = options.apns;
    this.#now = options.now ?? Date.now;
    this.#log = options.log ?? ((line) => console.log(line));
    this.#origins = options.origins ?? APNS_ORIGINS;
    this.#tls = options.tls ?? {};
    this.#timeoutMs = options.requestTimeoutMs ?? APNS_REQUEST_TIMEOUT_MS;
    this.#retryDelaysMs = options.retryDelaysMs ?? APNS_RETRY_DELAYS_MS;
    this.#sleep =
      options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  }

  /** Pushes one notification to one device token, through the token's environment. */
  async send(target: PushTarget, notification: ApnsNotification): Promise<PushOutcome> {
    const env = target.environment;
    const apns = this.#apns;
    const key = apns?.keys[env];
    if (apns === undefined || key === undefined)
      return { result: "failed", reason: "not_configured" };
    const apnsId = randomUUID();
    const what = `L1 relay: push ${apnsId} for ${notification.label} to device ${target.deviceId} (${env})`;
    let renewed = false;
    let retries = 0;
    for (;;) {
      let jwt: string;
      try {
        jwt = await this.#providerToken(env, key, apns.team_id);
      } catch (error) {
        if (!(error instanceof ApnsKeyError)) throw error;
        this.#store.recordPushResult(env, "key_unreadable", this.#now());
        this.#log(`${what} failed: the ${env} APNs key can't be used (${error.message})`);
        return { result: "failed", reason: "key_unreadable" };
      }
      const attempt = await this.#request(env, target.token, notification, apnsId, jwt, apns.topic);
      if (attempt.kind === "answer") {
        const { status, reason } = attempt;
        if (status === 200) {
          this.#store.recordPushResult(env, null, this.#now());
          this.#log(`${what} accepted`);
          return { result: "sent" };
        }
        if (
          (status === 400 || status === 410) &&
          reason !== null &&
          DEAD_TOKEN_REASONS.has(reason)
        ) {
          this.#store.deletePushToken(env, target.token);
          this.#log(`${what} refused: ${status} ${reason}, so the token is deleted`);
          return { result: "token_refused", reason };
        }
        if (status === 403 && reason === "ExpiredProviderToken" && !renewed) {
          renewed = true;
          this.#tokens.delete(env);
          this.#log(`${what}: Apple said the provider token expired, so it is renewed once`);
          continue;
        }
        if (status !== 429 && status < 500) {
          const recorded = reason ?? `status_${status}`;
          this.#store.recordPushResult(env, recorded, this.#now());
          this.#log(`${what} refused: ${status} ${recorded}`);
          return { result: "failed", reason: recorded };
        }
      }
      const reason =
        attempt.kind === "error" ? attempt.reason : (attempt.reason ?? `status_${attempt.status}`);
      const delay = this.#retryDelaysMs[retries];
      if (delay === undefined) {
        this.#store.recordPushResult(env, reason, this.#now());
        this.#log(`${what} failed after ${retries} retries: ${reason}`);
        return { result: "failed", reason };
      }
      retries += 1;
      this.#log(`${what} failed (${reason}), retry ${retries} in ${delay} ms`);
      await this.#sleep(delay);
    }
  }

  /** Closes every APNs connection; the next push opens one again. */
  close(): void {
    for (const session of this.#sessions.values()) session.close();
    this.#sessions.clear();
  }

  async #providerToken(env: Environment, key: ApnsKey, teamId: string): Promise<string> {
    const now = this.#now();
    const cached = this.#tokens.get(env);
    if (cached !== undefined && now - cached.issuedAtMs < APNS_TOKEN_RENEW_MS) return cached.jwt;
    const jwt = providerToken(await this.#signingKey(env, key), key.key_id, teamId, now);
    this.#tokens.set(env, { jwt, issuedAtMs: now });
    return jwt;
  }

  async #signingKey(env: Environment, key: ApnsKey): Promise<KeyObject> {
    const cached = this.#keys.get(env);
    if (cached !== undefined) return cached;
    let loaded: KeyObject;
    try {
      loaded = createPrivateKey(await readFile(key.key_file, { encoding: "utf8" }));
    } catch (error) {
      // Only the code goes on: a parser's message could quote the file.
      if (error instanceof Error) throw new ApnsKeyError(errorCode(error));
      throw error;
    }
    if (
      loaded.asymmetricKeyType !== "ec" ||
      loaded.asymmetricKeyDetails?.namedCurve !== "prime256v1"
    ) {
      throw new ApnsKeyError("not a P-256 key");
    }
    this.#keys.set(env, loaded);
    return loaded;
  }

  #session(env: Environment): http2.ClientHttp2Session {
    const existing = this.#sessions.get(env);
    if (existing !== undefined && !existing.closed && !existing.destroyed) return existing;
    const session = http2.connect(this.#origins[env], this.#tls);
    const forget = () => {
      if (this.#sessions.get(env) === session) this.#sessions.delete(env);
    };
    session.on("error", (error: Error) => {
      forget();
      this.#log(`L1 relay: the ${env} APNs connection failed (${errorCode(error)})`);
    });
    session.on("goaway", forget);
    session.on("close", forget);
    session.setTimeout(APNS_SESSION_IDLE_MS, () => session.close());
    this.#sessions.set(env, session);
    return session;
  }

  #request(
    env: Environment,
    token: string,
    notification: ApnsNotification,
    apnsId: string,
    jwt: string,
    topic: string,
  ): Promise<Attempt> {
    const headers: http2.OutgoingHttpHeaders = {
      ":method": "POST",
      ":path": `/3/device/${token}`,
      authorization: `bearer ${jwt}`,
      "apns-id": apnsId,
      "apns-push-type": notification.pushType,
      "apns-priority": String(notification.priority),
      "apns-topic": topic,
      "apns-expiration": String(Math.floor(notification.expiresAtMs / 1000)),
      "content-type": "application/json",
    };
    if (notification.collapseId !== undefined)
      headers["apns-collapse-id"] = notification.collapseId;
    return new Promise((resolve) => {
      let stream: http2.ClientHttp2Stream;
      try {
        stream = this.#session(env).request(headers);
      } catch (error) {
        // A connection that Apple is closing refuses new requests: retried like a network error.
        if (error instanceof Error && errorCode(error).startsWith("ERR_HTTP2_")) {
          resolve({ kind: "error", reason: "network" });
          return;
        }
        throw error;
      }
      let settled = false;
      const finish = (attempt: Attempt) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(attempt);
      };
      const timer = setTimeout(() => {
        finish({ kind: "error", reason: "timeout" });
        stream.close(http2.constants.NGHTTP2_CANCEL);
      }, this.#timeoutMs);
      let status = 0;
      let size = 0;
      const chunks: Buffer[] = [];
      stream.on("response", (answer) => {
        status = Number(answer[":status"]);
      });
      stream.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size <= APNS_ANSWER_MAX_BYTES) chunks.push(chunk);
      });
      stream.on("end", () => {
        if (status === 0) finish({ kind: "error", reason: "network" });
        else finish({ kind: "answer", status, reason: answerReason(Buffer.concat(chunks)) });
      });
      stream.on("error", () => finish({ kind: "error", reason: "network" }));
      stream.on("close", () => finish({ kind: "error", reason: "network" }));
      stream.end(notification.payload);
    });
  }
}
