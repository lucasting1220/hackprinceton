import assert from "node:assert/strict";
import { randomBytes, verify } from "node:crypto";
import { writeFile } from "node:fs/promises";
import type { IncomingHttpHeaders } from "node:http2";
import { describe, type TestContext, test } from "node:test";
import { credentialHash } from "../bridge/src/phone-crypto.ts";
import { APNS_RETRY_DELAYS_MS, APNS_TOKEN_RENEW_MS } from "../bridge/src/settings.ts";
import { ApnsClient, type ApnsClientOptions, type ApnsNotification } from "../relay/src/apns.ts";
import type { RelayConfig } from "../relay/src/config.ts";
import { type Environment, type PushTarget, RelayStore } from "../relay/src/store.ts";
import { FakeApns, writeTestKeys } from "./fake-apns.ts";
import { TEST_TOPIC, TestPhone, tempDir, testConfig } from "./relay-fixtures.ts";

const T0 = Date.UTC(2026, 10, 14, 15, 0, 0);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const NOTIFICATION: ApnsNotification = {
  pushType: "alert",
  priority: 10,
  expiresAtMs: T0 + 86_400_000,
  collapseId: "a1",
  payload: '{"aps":{"alert":{"title":"Debbie"}}}',
  label: "message m1",
};

interface Setup {
  readonly fake: FakeApns;
  readonly client: ApnsClient;
  readonly store: RelayStore;
  readonly config: RelayConfig;
  readonly target: PushTarget;
  readonly logs: string[];
  readonly delays: number[];
  readonly clock: { now: number };
  readonly publicKeys: Awaited<ReturnType<typeof writeTestKeys>>;
}

/** A store with one caregiver whose token is registered, a fake APNs and a client for it. */
async function setup(
  t: TestContext,
  env: Environment = "production",
  options: Partial<ApnsClientOptions> = {},
): Promise<Setup> {
  const config = testConfig(await tempDir(t));
  const apns = config.apns;
  assert.ok(apns !== undefined);
  const publicKeys = await writeTestKeys(apns);
  const fake = await FakeApns.start(t);
  const store = RelayStore.open(":memory:");
  t.after(() => store.close());
  store.createHome("home-a", credentialHash("hub"), T0);
  const phone = new TestPhone();
  store.syncDevices("home-a", [phone.entry()], T0);
  const token = randomBytes(32).toString("hex");
  store.setPushToken(phone.deviceId, env, token, T0);
  const logs: string[] = [];
  const delays: number[] = [];
  const clock = { now: T0 };
  const client = new ApnsClient({
    store,
    apns,
    origins: fake.origins(),
    tls: fake.tls(),
    now: () => clock.now,
    log: (line) => logs.push(line),
    sleep: async (ms) => {
      delays.push(ms);
    },
    ...options,
  });
  t.after(() => client.close());
  const target = { deviceId: phone.deviceId, environment: env, token };
  return { fake, client, store, config, target, logs, delays, clock, publicKeys };
}

function decodePart(part: string | undefined): unknown {
  assert.ok(part !== undefined);
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

function bearer(headers: IncomingHttpHeaders | undefined): string {
  const value = headers?.authorization;
  assert.ok(typeof value === "string" && value.startsWith("bearer "));
  return value.slice("bearer ".length);
}

/** No log line holds a push token, a provider token or a key. */
function assertNoSecrets(setup: Setup): void {
  const joined = setup.logs.join("\n");
  assert.ok(!joined.includes(setup.target.token), "a push token was logged");
  for (const request of setup.fake.requests) {
    assert.ok(!joined.includes(bearer(request.headers)), "a provider token was logged");
  }
  assert.ok(!joined.includes("PRIVATE KEY"), "a key was logged");
}

describe("APNs client: requests", () => {
  test("posts the payload to /3/device/<token> with Apple's headers, and records success", async (t) => {
    const s = await setup(t);
    assert.deepEqual(await s.client.send(s.target, NOTIFICATION), { result: "sent" });
    assert.equal(s.fake.requests.length, 1);
    const [request] = s.fake.requests;
    assert.ok(request !== undefined);
    const { headers } = request;
    assert.equal(headers[":method"], "POST");
    assert.equal(headers[":path"], `/3/device/${s.target.token}`);
    assert.equal(headers["apns-topic"], TEST_TOPIC);
    assert.equal(headers["apns-push-type"], "alert");
    assert.equal(headers["apns-priority"], "10");
    assert.equal(headers["apns-expiration"], String((T0 + 86_400_000) / 1000));
    assert.equal(headers["apns-collapse-id"], "a1");
    assert.equal(headers["content-type"], "application/json");
    assert.match(String(headers["apns-id"]), UUID);
    assert.equal(request.body, NOTIFICATION.payload);
    const health = s.store.pushHealth("production");
    assert.equal(health.lastOkAtMs, T0);
    assert.equal(health.lastError, null);
    assert.ok(
      s.logs.some((line) => line.includes(String(headers["apns-id"])) && line.includes("m1")),
    );
    assertNoSecrets(s);
  });

  test("a push without a collapse ID sends no apns-collapse-id header", async (t) => {
    const s = await setup(t);
    const { collapseId: _unused, ...rest } = NOTIFICATION;
    await s.client.send(s.target, rest);
    assert.equal(s.fake.requests[0]?.headers["apns-collapse-id"], undefined);
  });

  test("a sandbox token goes through the sandbox key", async (t) => {
    const s = await setup(t, "sandbox");
    assert.deepEqual(await s.client.send(s.target, NOTIFICATION), { result: "sent" });
    const [header] = bearer(s.fake.requests[0]?.headers).split(".");
    assert.deepEqual(decodePart(header), { alg: "ES256", kid: "KEYID00002" });
    assert.equal(s.store.pushHealth("sandbox").lastOkAtMs, T0);
    assert.equal(s.store.pushHealth("production").lastOkAtMs, null);
  });

  test("an environment with no key sends nothing and answers not_configured", async (t) => {
    const s = await setup(t);
    const apns = s.config.apns;
    const sandbox = apns?.keys.sandbox;
    assert.ok(apns !== undefined && sandbox !== undefined);
    const client = new ApnsClient({
      store: s.store,
      apns: { ...apns, keys: { sandbox } },
      origins: s.fake.origins(),
      tls: s.fake.tls(),
    });
    assert.deepEqual(await client.send(s.target, NOTIFICATION), {
      result: "failed",
      reason: "not_configured",
    });
    const none = new ApnsClient({ store: s.store, apns: undefined });
    assert.deepEqual(await none.send(s.target, NOTIFICATION), {
      result: "failed",
      reason: "not_configured",
    });
    assert.equal(s.fake.requests.length, 0);
  });
});

describe("APNs client: the provider token", () => {
  test("is an ES256 JWT with the key ID and team ID, signed by the environment's key", async (t) => {
    const s = await setup(t);
    await s.client.send(s.target, NOTIFICATION);
    const jwt = bearer(s.fake.requests[0]?.headers);
    const [header, claims, signature] = jwt.split(".");
    assert.deepEqual(decodePart(header), { alg: "ES256", kid: "KEYID00001" });
    assert.deepEqual(decodePart(claims), { iss: "TEAMID0000", iat: T0 / 1000 });
    assert.ok(signature !== undefined);
    const signed = verify(
      "sha256",
      Buffer.from(`${header}.${claims}`),
      { key: s.publicKeys.production, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url"),
    );
    assert.equal(signed, true);
  });

  test("is reused for 40 minutes and renewed after", async (t) => {
    const s = await setup(t);
    await s.client.send(s.target, NOTIFICATION);
    s.clock.now = T0 + APNS_TOKEN_RENEW_MS - 1;
    await s.client.send(s.target, NOTIFICATION);
    s.clock.now = T0 + APNS_TOKEN_RENEW_MS;
    await s.client.send(s.target, NOTIFICATION);
    const tokens = s.fake.requests.map((request) => bearer(request.headers));
    assert.equal(tokens[0], tokens[1]);
    assert.notEqual(tokens[1], tokens[2]);
    const claims = decodePart(tokens[2]?.split(".")[1]);
    assert.deepEqual(claims, { iss: "TEAMID0000", iat: (T0 + APNS_TOKEN_RENEW_MS) / 1000 });
    assert.equal(APNS_TOKEN_RENEW_MS, 40 * 60_000);
  });

  test("a key file that can't be read marks the environment failing, and logs no key", async (t) => {
    const s = await setup(t);
    const file = s.config.apns?.keys.production?.key_file;
    assert.ok(file !== undefined);
    await writeFile(file, "-----BEGIN PRIVATE KEY-----\nnot a key\n-----END PRIVATE KEY-----\n");
    assert.deepEqual(await s.client.send(s.target, NOTIFICATION), {
      result: "failed",
      reason: "key_unreadable",
    });
    assert.equal(s.fake.requests.length, 0);
    assert.equal(s.store.pushHealth("production").lastError, "key_unreadable");
    assertNoSecrets(s);
  });
});

describe("APNs client: Apple's answers", () => {
  for (const [status, reason] of [
    [410, "Unregistered"],
    [400, "BadDeviceToken"],
    [400, "DeviceTokenNotForTopic"],
  ] as const) {
    test(`${status} ${reason} deletes the token and is never retried`, async (t) => {
      const s = await setup(t);
      s.fake.reply({ status, reason });
      assert.deepEqual(await s.client.send(s.target, NOTIFICATION), {
        result: "token_refused",
        reason,
      });
      assert.equal(s.fake.requests.length, 1);
      assert.deepEqual(s.store.pushTargets("home-a"), []);
      assert.equal(s.store.pushHealth("production").lastError, null);
      assertNoSecrets(s);
    });
  }

  test("403 ExpiredProviderToken renews the token and retries once", async (t) => {
    const s = await setup(t);
    s.fake.reply({ status: 403, reason: "ExpiredProviderToken" });
    assert.deepEqual(await s.client.send(s.target, NOTIFICATION), { result: "sent" });
    assert.equal(s.fake.requests.length, 2);
    const [first, second] = s.fake.requests.map((request) => bearer(request.headers));
    assert.notEqual(first, second);
    assert.deepEqual(s.delays, []);

    s.fake.reply(
      { status: 403, reason: "ExpiredProviderToken" },
      { status: 403, reason: "ExpiredProviderToken" },
    );
    assert.deepEqual(await s.client.send(s.target, NOTIFICATION), {
      result: "failed",
      reason: "ExpiredProviderToken",
    });
    assert.equal(s.fake.requests.length, 4);
  });

  test("403 InvalidProviderToken marks the environment failing, keeps the token, and stops", async (t) => {
    const s = await setup(t);
    s.clock.now = T0 + 5_000;
    s.fake.reply({ status: 403, reason: "InvalidProviderToken" });
    assert.deepEqual(await s.client.send(s.target, NOTIFICATION), {
      result: "failed",
      reason: "InvalidProviderToken",
    });
    assert.equal(s.fake.requests.length, 1);
    assert.equal(s.store.pushTargets("home-a").length, 1);
    const health = s.store.pushHealth("production");
    assert.equal(health.lastError, "InvalidProviderToken");
    assert.equal(health.lastErrorAtMs, T0 + 5_000);
  });

  test("503 is retried after 1, 5 and 15 seconds, then given up and recorded", async (t) => {
    const s = await setup(t);
    const unavailable = { status: 503, reason: "ServiceUnavailable" };
    s.fake.reply(unavailable, unavailable, unavailable, unavailable);
    assert.deepEqual(await s.client.send(s.target, NOTIFICATION), {
      result: "failed",
      reason: "ServiceUnavailable",
    });
    assert.equal(s.fake.requests.length, 4);
    assert.deepEqual(s.delays, [1_000, 5_000, 15_000]);
    assert.deepEqual(APNS_RETRY_DELAYS_MS, [1_000, 5_000, 15_000]);
    assert.equal(s.store.pushHealth("production").lastError, "ServiceUnavailable");
    const ids = new Set(s.fake.requests.map((request) => request.headers["apns-id"]));
    assert.equal(ids.size, 1, "a retry keeps its apns-id");
  });

  test("429 that clears on a retry ends in success", async (t) => {
    const s = await setup(t);
    s.fake.reply({ status: 429, reason: "TooManyRequests" });
    assert.deepEqual(await s.client.send(s.target, NOTIFICATION), { result: "sent" });
    assert.deepEqual(s.delays, [1_000]);
  });

  test("a request with no answer times out, is retried, and is reported", async (t) => {
    const s = await setup(t, "production", { requestTimeoutMs: 100 });
    s.fake.reply("hang", "hang", "hang", "hang");
    const started = Date.now();
    assert.deepEqual(await s.client.send(s.target, NOTIFICATION), {
      result: "failed",
      reason: "timeout",
    });
    assert.ok(Date.now() - started < 5_000);
    assert.equal(s.fake.requests.length, 4);
    assert.equal(s.store.pushHealth("production").lastError, "timeout");
    assert.ok(s.logs.some((line) => line.includes("timeout")));
  });

  test("an APNs that can't be reached is a network failure, after the retries", async (t) => {
    const s = await setup(t, "production", {
      origins: { production: "https://127.0.0.1:1", sandbox: "https://127.0.0.1:1" },
    });
    assert.deepEqual(await s.client.send(s.target, NOTIFICATION), {
      result: "failed",
      reason: "network",
    });
    assert.equal(s.delays.length, 3);
    assert.equal(s.store.pushHealth("production").lastError, "network");
  });
});
