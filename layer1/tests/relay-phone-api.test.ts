import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  RELAY_LIMITER_ADDRESSES_MAX,
  RELAY_SIGNIN_FAILURES_MAX,
  RELAY_SIGNIN_WINDOW_MS,
} from "../bridge/src/settings.ts";
import { SignInLimiter } from "../relay/src/phone-api.ts";
import {
  call,
  errorCode,
  homeKey,
  hubWrapper,
  type TestRelay,
  TestPhone,
  TEST_TOPIC,
  startRelay,
  tempDir,
  testConfig,
} from "./relay-fixtures.ts";

const TOKEN = "ab".repeat(32);

function record(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value));
  return { ...value };
}

function messageIds(body: unknown): unknown[] {
  const messages = field(record(body), "messages");
  assert.ok(Array.isArray(messages));
  return messages.map((message) => field(record(message), "msg_id"));
}

/** No log line holds a credential or a push token. */
function assertCleanLogs(relay: TestRelay, secrets: readonly string[]): void {
  for (const line of relay.logs) {
    for (const secret of secrets) assert.ok(!line.includes(secret), line);
  }
}

/** A field of a JSON object or a database row, read by name. */
function field(value: unknown, name: string): unknown {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value));
  return Object.getOwnPropertyDescriptor(value, name)?.value;
}

describe("relay phone API: sign-in", () => {
  test("GET /healthz needs no sign-in", async (t) => {
    const relay = await startRelay(t);
    const answer = await call(relay, "/healthz");
    assert.equal(answer.status, 200);
    assert.deepEqual(answer.body, { v: 1, ok: true });
    assert.equal(answer.headers.get("cache-control"), "no-store");
  });

  test("missing, unknown or wrong credentials get 401 unauthorized", async (t) => {
    const phone = new TestPhone();
    const relay = await startRelay(t, [phone]);
    const stranger = new TestPhone();
    const cases: Record<string, string>[] = [
      {},
      { "X-Debbie-Device": phone.deviceId },
      { Authorization: `Bearer ${phone.credential}` },
      { "X-Debbie-Device": phone.deviceId, Authorization: `Bearer ${stranger.credential}` },
      { "X-Debbie-Device": phone.deviceId, Authorization: `Basic ${phone.credential}` },
      stranger.headers(),
    ];
    for (const headers of cases) {
      const answer = await call(relay, "/v1/home", undefined, { headers });
      assert.equal(answer.status, 401);
      assert.equal(errorCode(answer), "unauthorized");
    }
    assert.equal((await call(relay, "/v1/home", phone)).status, 200);
  });

  test("a revoked device hears device_removed only with its own credential", async (t) => {
    const phone = new TestPhone();
    const relay = await startRelay(t, [phone]);
    relay.store.revokeDevice(phone.deviceId, Date.now());
    const own = await call(relay, "/v1/home", phone);
    assert.equal(own.status, 401);
    assert.equal(errorCode(own), "device_removed");
    const wrong = await call(relay, "/v1/home", undefined, {
      headers: { "X-Debbie-Device": phone.deviceId, Authorization: "Bearer wrong" },
    });
    assert.equal(errorCode(wrong), "unauthorized");
  });

  test("20 failed sign-ins from one address get 429; another address still signs in", async (t) => {
    const phone = new TestPhone();
    const relay = await startRelay(t, [phone]);
    const from = (address: string) => ({ "X-Forwarded-For": `10.0.0.9, ${address}` });
    for (let index = 0; index < RELAY_SIGNIN_FAILURES_MAX; index += 1) {
      const answer = await call(relay, "/v1/home", undefined, { headers: from("203.0.113.5") });
      assert.equal(answer.status, 401);
    }
    const blocked = await call(relay, "/v1/home", phone, { headers: from("203.0.113.5") });
    assert.equal(blocked.status, 429);
    assert.equal(errorCode(blocked), "too_many_attempts");
    const other = await call(relay, "/v1/home", phone, { headers: from("203.0.113.6") });
    assert.equal(other.status, 200);
    assert.ok(relay.logs.some((line) => line.includes("203.0.113.5")));
  });
});

describe("relay phone API: the limiter", () => {
  test("blocks after the limit, unblocks after a minute and forgets a quiet address", () => {
    const limiter = new SignInLimiter();
    for (let index = 1; index < RELAY_SIGNIN_FAILURES_MAX; index += 1) {
      assert.equal(limiter.recordFailure("a", index), false);
    }
    assert.equal(limiter.recordFailure("a", 100), true);
    assert.equal(limiter.isBlocked("a", 101), true);
    assert.equal(limiter.isBlocked("a", 100 + RELAY_SIGNIN_WINDOW_MS), false);
    limiter.recordFailure("b", 0);
    limiter.recordFailure("c", 3 * RELAY_SIGNIN_WINDOW_MS);
    assert.equal(limiter.size, 1, "a and b were quiet for a minute and are forgotten");
    for (let index = 1; index < RELAY_SIGNIN_FAILURES_MAX; index += 1) {
      limiter.recordFailure("d", 4 * RELAY_SIGNIN_WINDOW_MS + index);
    }
    assert.equal(limiter.recordFailure("d", 5 * RELAY_SIGNIN_WINDOW_MS + 100), false);
  });

  test("never holds more than its capacity, dropping the least recently seen", () => {
    const limiter = new SignInLimiter();
    for (let index = 0; index <= RELAY_LIMITER_ADDRESSES_MAX + 50; index += 1) {
      limiter.recordFailure(`198.51.${index >> 8}.${index & 255}`, 1_000);
    }
    assert.equal(limiter.size, RELAY_LIMITER_ADDRESSES_MAX);
  });
});

describe("relay phone API: home and messages", () => {
  test("GET /v1/home reports the hub as online only while it is connected", async (t) => {
    const phone = new TestPhone();
    const relay = await startRelay(t, [phone]);
    const before = await call(relay, "/v1/home", phone);
    assert.deepEqual(before.body, {
      v: 1,
      home_id: relay.homeId,
      hub: { online: false, last_contact_at: null },
      push: { state: "ok", since: null },
    });
    relay.store.setHubConnected(relay.homeId, true);
    relay.store.recordContact(relay.homeId, Date.UTC(2026, 10, 14, 15, 12, 5));
    const during = record((await call(relay, "/v1/home", phone)).body);
    assert.deepEqual(field(during, "hub"), {
      online: true,
      last_contact_at: "2026-11-14T15:12:05Z",
    });
    relay.store.setHubConnected(relay.homeId, false);
    const after = record((await call(relay, "/v1/home", phone)).body);
    assert.equal(field(record(field(after, "hub")), "online"), false);
  });

  test("push state follows the caller's environment, its health and the config", async (t) => {
    const phone = new TestPhone();
    const config = testConfig(await tempDir(t), {
      apns: { topic: TEST_TOPIC, team_id: "TEAMID0000", keys: {} },
    });
    const unconfigured = await startRelay(t, [phone], { config });
    const none = record((await call(unconfigured, "/v1/home", phone)).body);
    assert.deepEqual(field(none, "push"), { state: "not_configured", since: null });

    const relay = await startRelay(t, [phone]);
    relay.store.setPushToken(phone.deviceId, "sandbox", TOKEN, 1);
    relay.store.recordPushResult("sandbox", null, Date.UTC(2026, 10, 14, 15, 0, 0));
    relay.store.recordPushResult("production", "InvalidProviderToken", Date.UTC(2026, 10, 14));
    const ok = record((await call(relay, "/v1/home", phone)).body);
    assert.deepEqual(field(ok, "push"), { state: "ok", since: "2026-11-14T15:00:00Z" });
    relay.store.recordPushResult("sandbox", "BadDeviceToken", Date.UTC(2026, 10, 14, 15, 1, 0));
    const failing = record((await call(relay, "/v1/home", phone)).body);
    assert.deepEqual(field(failing, "push"), { state: "failing", since: "2026-11-14T15:01:00Z" });
  });

  test("GET /v1/messages pages by role and to, with r. cursors and the hub's state", async (t) => {
    const [carer, resident] = [new TestPhone(), new TestPhone("resident")];
    const relay = await startRelay(t, [carer, resident]);
    const key = homeKey();
    const alert = hubWrapper({ homeId: relay.homeId, type: "alert", key, collapseId: "a-1" });
    const reply = hubWrapper({
      homeId: relay.homeId,
      type: "reply",
      key: resident.key(),
      to: resident.deviceId,
    });
    relay.store.storeMessage(relay.homeId, alert, Date.now());
    relay.store.storeMessage(relay.homeId, reply, Date.now());

    const carerPage = await call(relay, "/v1/messages", carer);
    assert.equal(carerPage.status, 200);
    assert.deepEqual(messageIds(carerPage.body), [alert.msg_id]);
    const body = record(carerPage.body);
    assert.deepEqual(field(body, "hub"), { online: false, last_contact_at: null });
    assert.match(String(field(body, "next")), /^r\.\d+$/);
    const [first] = field(record(carerPage.body), "messages") as unknown[];
    assert.deepEqual(first, alert);
    assert.equal(field(carer.open(alert, relay.homeId, key), "type"), "alert");

    const residentPage = await call(relay, "/v1/messages?after=l.1.2", resident);
    assert.deepEqual(messageIds(residentPage.body), [reply.msg_id]);
    assert.equal(field(resident.open(reply, relay.homeId), "type"), "reply");

    const next = encodeURIComponent(String(field(body, "next")));
    const empty = await call(relay, `/v1/messages?after=${next}`, carer);
    assert.deepEqual(messageIds(empty.body), []);
    assert.equal(field(record(empty.body), "next"), field(body, "next"));
  });

  test("limit is capped at 50 and must be a whole number of at least 1", async (t) => {
    const carer = new TestPhone();
    const relay = await startRelay(t, [carer]);
    const key = homeKey();
    for (let index = 0; index < 60; index += 1) {
      const wrapper = hubWrapper({ homeId: relay.homeId, type: "alert", key });
      relay.store.storeMessage(relay.homeId, wrapper, Date.now());
    }
    assert.equal(messageIds((await call(relay, "/v1/messages", carer)).body).length, 50);
    const capped = await call(relay, "/v1/messages?limit=500", carer);
    assert.equal(messageIds(capped.body).length, 50);
    const three = await call(relay, "/v1/messages?limit=3", carer);
    assert.equal(messageIds(three.body).length, 3);
    for (const limit of ["0", "-1", "2.5", "x", ""]) {
      const answer = await call(relay, `/v1/messages?limit=${limit}`, carer);
      assert.equal(answer.status, 400, limit);
      assert.equal(errorCode(answer), "bad_request");
    }
  });
});

describe("relay phone API: push tokens and unpair", () => {
  const registration = (overrides: Record<string, unknown> = {}) => ({
    v: 1,
    token: TOKEN,
    environment: "sandbox",
    bundle_id: TEST_TOPIC,
    ...overrides,
  });

  test("POST /v1/push-tokens saves the token, and refuses a wrong app or a bad field", async (t) => {
    const [carer, other] = [new TestPhone(), new TestPhone()];
    const relay = await startRelay(t, [carer, other]);
    const saved = await call(relay, "/v1/push-tokens", carer, { body: registration() });
    assert.equal(saved.status, 204);
    assert.deepEqual(relay.store.pushTargets(relay.homeId), [
      { deviceId: carer.deviceId, environment: "sandbox", token: TOKEN },
    ]);
    const moved = await call(relay, "/v1/push-tokens", other, { body: registration() });
    assert.equal(moved.status, 204);
    assert.deepEqual(
      relay.store.pushTargets(relay.homeId).map((target) => target.deviceId),
      [other.deviceId],
    );
    const wrongApp = await call(relay, "/v1/push-tokens", carer, {
      body: registration({ bundle_id: "com.example.other" }),
    });
    assert.equal(wrongApp.status, 400);
    assert.equal(errorCode(wrongApp), "wrong_app");
    const cases: [Record<string, unknown>, string][] = [
      [{ environment: "staging" }, "bad_request"],
      [{ token: "not hex" }, "bad_request"],
      [{ token: "ab" }, "bad_request"],
      [{ bundle_id: 5 }, "bad_request"],
      [{ v: 2 }, "unsupported_version"],
    ];
    for (const [overrides, code] of cases) {
      const answer = await call(relay, "/v1/push-tokens", carer, { body: registration(overrides) });
      assert.equal(answer.status, 400);
      assert.equal(errorCode(answer), code);
    }
    const notJson = await call(relay, "/v1/push-tokens", carer, {
      body: registration(),
      headers: { "Content-Type": "text/plain" },
    });
    assert.equal(notJson.status, 415);
    const tooLarge = await call(relay, "/v1/push-tokens", carer, {
      body: registration({ padding: "x".repeat(70_000) }),
    });
    assert.equal(tooLarge.status, 413);
    assertCleanLogs(relay, [TOKEN, carer.credential, other.credential]);
  });

  test("a resident may read its home and messages and unpair, but not register a token", async (t) => {
    const resident = new TestPhone("resident");
    const relay = await startRelay(t, [resident]);
    assert.equal((await call(relay, "/v1/home", resident)).status, 200);
    assert.equal((await call(relay, "/v1/messages", resident)).status, 200);
    const token = await call(relay, "/v1/push-tokens", resident, { body: registration() });
    assert.equal(token.status, 403);
    assert.equal(errorCode(token), "forbidden");
    assert.equal((await call(relay, "/v1/unpair", resident, { method: "POST" })).status, 204);
  });

  test("POST /v1/unpair revokes the device, deletes its tokens and tells the hub", async (t) => {
    const carer = new TestPhone();
    const told: string[][] = [];
    const relay = await startRelay(t, [carer], {
      onUnpair: (homeId, deviceId) => told.push([homeId, deviceId]),
    });
    relay.store.setPushToken(carer.deviceId, "production", TOKEN, 1);
    const answer = await call(relay, "/v1/unpair", carer, { body: { v: 1 } });
    assert.equal(answer.status, 204);
    assert.equal(answer.body, undefined);
    assert.notEqual(relay.store.device(carer.deviceId)?.revokedAtMs, null);
    assert.deepEqual(relay.store.pushTargets(relay.homeId), []);
    assert.deepEqual(told, [[relay.homeId, carer.deviceId]]);
    const after = await call(relay, "/v1/home", carer);
    assert.equal(errorCode(after), "device_removed");
    assertCleanLogs(relay, [TOKEN, carer.credential]);
  });

  test("an unknown path gets 404 and a wrong method 405 with Allow", async (t) => {
    const carer = new TestPhone();
    const relay = await startRelay(t, [carer]);
    const missing = await call(relay, "/v1/nothing", carer);
    assert.equal(missing.status, 404);
    assert.equal(errorCode(missing), "not_found");
    const wrong = await call(relay, "/v1/home", carer, { method: "POST" });
    assert.equal(wrong.status, 405);
    assert.equal(wrong.headers.get("allow"), "GET");
    assert.equal((await call(relay, "/healthz", undefined, { method: "POST" })).status, 405);
  });
});
