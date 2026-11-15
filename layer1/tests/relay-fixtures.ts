/**
 * Relay test fixtures: a relay.json in a temporary folder, a phone API on 127.0.0.1 port 0 with an
 * in-memory database, hub messages sealed as the hub seals them, and a test phone whose keys come
 * from tests/fake-phone.ts.
 */
import { once } from "node:events";
import {
  createSecretKey,
  generateKeyPairSync,
  type KeyObject,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import type { QrPayload } from "../bridge/src/pairing.ts";
import {
  credentialHash,
  fromBase64url,
  KEY_BYTES,
  open,
  type Role,
  seal,
  toBase64url,
} from "../bridge/src/phone-crypto.ts";
import { DEVICE_CREDENTIAL_BYTES } from "../bridge/src/settings.ts";
import { utcSeconds, type Wrapper } from "../bridge/src/wire.ts";
import { parseRelayConfig, type RelayConfig } from "../relay/src/config.ts";
import { createPhoneApi, type PhoneApiOptions } from "../relay/src/phone-api.ts";
import { type PhoneListEntry, RelayStore } from "../relay/src/store.ts";
import { FakePhone } from "./fake-phone.ts";

export const TEST_TOPIC = "com.example.debbie";

/** A temporary folder, removed when the test ends. */
export async function tempDir(t: TestContext): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "l1-relay-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** A relay.json's fields in `dir`, with both APNs keys unless `overrides` says otherwise. */
export function configJson(dir: string, overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    listen_port: 7490,
    public_url: "http://127.0.0.1:7490",
    database_file: path.join(dir, "relay.db"),
    stop_file: path.join(dir, "relay.stop"),
    hub_silent_limit_s: 60,
    watchdog_tick_s: 1,
    apns: {
      topic: TEST_TOPIC,
      team_id: "TEAMID0000",
      keys: {
        production: { key_id: "KEYID00001", key_file: path.join(dir, "production.p8") },
        sandbox: { key_id: "KEYID00002", key_file: path.join(dir, "sandbox.p8") },
      },
    },
    ...overrides,
  };
}

export function testConfig(dir: string, overrides: Record<string, unknown> = {}): RelayConfig {
  return parseRelayConfig(configJson(dir, overrides), "relay.json");
}

/** A home key, as Create a home makes one. */
export function homeKey(): KeyObject {
  return createSecretKey(randomBytes(KEY_BYTES));
}

export interface HubMessage {
  readonly homeId: string;
  readonly type: string;
  readonly key: KeyObject;
  /** The device a phone-key message is for; without it the message is sealed with the home key. */
  readonly to?: string;
  readonly fields?: Record<string, unknown>;
  readonly collapseId?: string;
  readonly msgId?: string;
}

/** A hub → phone wrapper, sealed as the hub seals one (phone-hub.md §2.4 and §3). */
export function hubWrapper(message: HubMessage): Wrapper {
  const msgId = message.msgId ?? randomUUID();
  const sentAt = utcSeconds(new Date());
  const kid = message.to ?? "home";
  const plaintext = { msg_id: msgId, sent_at: sentAt, type: message.type, ...message.fields };
  const envelope = seal(Buffer.from(JSON.stringify(plaintext)), message.key, kid, {
    homeId: message.homeId,
    type: message.type,
  });
  const wrapper: Wrapper = { v: 1, msg_id: msgId, type: message.type, sent_at: sentAt, envelope };
  const routed = message.to === undefined ? wrapper : { ...wrapper, to: message.to };
  return message.collapseId === undefined ? routed : { ...routed, collapse_id: message.collapseId };
}

/** A test hub's pairing QR code, so a FakePhone can derive its phone key. */
function testQr(): QrPayload {
  const { publicKey } = generateKeyPairSync("x25519");
  const hubPub = fromBase64url(publicKey.export({ format: "jwk" }).x, KEY_BYTES);
  return {
    v: 1,
    addrs: ["192.168.1.20:7480"],
    hub_pub: toBase64url(hubPub),
    secret: toBase64url(randomBytes(16)),
    exp: Math.floor(Date.now() / 1000) + 600,
  };
}

/** A paired phone as the relay sees it: a device ID, a credential and a phone key. */
export class TestPhone {
  readonly deviceId = randomUUID();
  readonly credential = toBase64url(randomBytes(DEVICE_CREDENTIAL_BYTES));
  readonly role: Role;
  readonly #fake: FakePhone;

  constructor(role: Role = "caregiver") {
    this.role = role;
    this.#fake = new FakePhone(testQr(), { role });
  }

  /** The phone key, which the hub seals this phone's `to` messages with. */
  key(): KeyObject {
    return this.#fake.key();
  }

  /** This phone in the hub's `phones` list. */
  entry(): Extract<PhoneListEntry, { removed: false }> {
    return {
      device_id: this.deviceId,
      role: this.role,
      credential_sha256: credentialHash(this.credential),
      removed: false,
    };
  }

  headers(): Record<string, string> {
    return { "X-Debbie-Device": this.deviceId, Authorization: `Bearer ${this.credential}` };
  }

  /** Opens a hub message as the app does: its own key for its `to` messages, else the home key. */
  open(wrapper: Wrapper, homeId: string, home?: KeyObject): Record<string, unknown> {
    const key = wrapper.to === this.deviceId ? this.key() : home;
    if (key === undefined) throw new Error("this phone has no key for that message");
    const label = { homeId, type: wrapper.type };
    const parsed: unknown = JSON.parse(open(wrapper.envelope, key, label).toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) throw new Error("not a JSON object");
    return { ...parsed };
  }
}

export interface TestRelay {
  readonly store: RelayStore;
  readonly config: RelayConfig;
  readonly url: string;
  readonly logs: string[];
  readonly homeId: string;
}

/**
 * A phone API on 127.0.0.1 port 0 with an in-memory database holding one home and `phones`.
 * Everything closes when the test ends.
 */
export async function startRelay(
  t: TestContext,
  phones: readonly TestPhone[] = [],
  options: Partial<Omit<PhoneApiOptions, "store" | "log">> = {},
): Promise<TestRelay> {
  const store = RelayStore.open(":memory:");
  const config = options.config ?? testConfig(await tempDir(t));
  const homeId = randomUUID();
  store.createHome(homeId, credentialHash(randomUUID()), Date.now());
  store.syncDevices(
    homeId,
    phones.map((phone) => phone.entry()),
    Date.now(),
  );
  const logs: string[] = [];
  const server = createPhoneApi({
    ...options,
    store,
    config,
    log: (line) => logs.push(line),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    store.close();
  });
  const { port } = server.address() as AddressInfo;
  return { store, config, url: `http://127.0.0.1:${port}`, logs, homeId };
}

export interface Answer {
  readonly status: number;
  readonly body: unknown;
  readonly headers: Headers;
}

/** Calls the relay as `phone`, with a JSON body when one is given; times out after 5 seconds. */
export async function call(
  relay: TestRelay,
  route: string,
  phone?: TestPhone,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Answer> {
  const headers: Record<string, string> = { ...phone?.headers(), ...init.headers };
  if (init.body !== undefined) headers["Content-Type"] ??= "application/json";
  const response = await fetch(`${relay.url}${route}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers,
    signal: AbortSignal.timeout(5_000),
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text === "" ? undefined : JSON.parse(text),
    headers: response.headers,
  };
}

/** The error code of an answer's §1 error body. */
export function errorCode(answer: Answer): unknown {
  const body = answer.body;
  if (typeof body !== "object" || body === null || !("error" in body)) return undefined;
  const { error } = body;
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}
