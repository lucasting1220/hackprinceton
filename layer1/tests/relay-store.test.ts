import assert from "node:assert/strict";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, type TestContext, test } from "node:test";
import { credentialHash } from "../bridge/src/phone-crypto.ts";
import { RelayStore, RelayStoreError } from "../relay/src/store.ts";
import { TestPhone, tempDir } from "./relay-fixtures.ts";

const T0 = Date.UTC(2026, 10, 14, 15, 0, 0);

function memoryStore(t: TestContext): RelayStore {
  const store = RelayStore.open(":memory:");
  t.after(() => store.close());
  return store;
}

function withHome(t: TestContext, homeId = "home-a"): RelayStore {
  const store = memoryStore(t);
  assert.equal(store.createHome(homeId, credentialHash(`hub-${homeId}`), T0), true);
  return store;
}

/** A field of a JSON object or a database row, read by name. */
function field(value: unknown, name: string): unknown {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value));
  return Object.getOwnPropertyDescriptor(value, name)?.value;
}

describe("relay store: schema and settings", () => {
  test("a file database uses WAL, FULL sync, foreign keys, a busy timeout and STRICT tables", async (t) => {
    const file = path.join(await tempDir(t), "relay.db");
    const store = RelayStore.open(file);
    t.after(() => store.close());
    assert.equal(store.pragma("journal_mode"), "wal");
    assert.equal(store.pragma("synchronous"), 2);
    assert.equal(store.pragma("foreign_keys"), 1);
    assert.equal(store.pragma("busy_timeout"), 5000);
    assert.equal(store.pragma("user_version"), 1);
    const raw = new DatabaseSync(file, { readOnly: true });
    t.after(() => raw.close());
    const tables = raw.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table'").all();
    const names = tables.map((row) => field(row, "name"));
    for (const name of ["homes", "devices", "push_tokens", "messages", "push_health"]) {
      assert.ok(names.includes(name), name);
    }
    for (const row of tables.filter((table) => field(table, "name") !== "sqlite_sequence")) {
      assert.match(String(field(row, "sql")), /STRICT$/);
    }
  });

  test("reopening keeps the data, and a newer schema is refused", async (t) => {
    const file = path.join(await tempDir(t), "relay.db");
    const first = RelayStore.open(file);
    first.createHome("home-a", credentialHash("x"), T0);
    first.close();
    const second = RelayStore.open(file);
    assert.equal(second.home("home-a")?.createdAtMs, T0);
    second.close();
    const raw = new DatabaseSync(file);
    raw.exec("PRAGMA user_version = 2");
    raw.close();
    assert.throws(() => RelayStore.open(file), RelayStoreError);
  });
});

describe("relay store: homes", () => {
  test("a home is created once and found by its hub credential's hash", (t) => {
    const store = memoryStore(t);
    assert.equal(store.createHome("home-a", credentialHash("one"), T0), true);
    assert.equal(store.createHome("home-a", credentialHash("two"), T0), false);
    assert.equal(store.homeByHubCredential(credentialHash("one"))?.homeId, "home-a");
    assert.equal(store.homeByHubCredential(credentialHash("two")), undefined);
  });

  test("replacing the credential cuts the old one off", (t) => {
    const store = withHome(t);
    assert.equal(store.replaceHubCredential("home-a", credentialHash("new")), true);
    assert.equal(store.homeByHubCredential(credentialHash("hub-home-a")), undefined);
    assert.equal(store.homeByHubCredential(credentialHash("new"))?.homeId, "home-a");
    assert.equal(store.replaceHubCredential("nowhere", credentialHash("x")), false);
  });

  test("connection, contact and the offline record are kept", (t) => {
    const store = withHome(t);
    assert.deepEqual(store.home("home-a"), {
      homeId: "home-a",
      createdAtMs: T0,
      hubConnected: false,
      lastContactAtMs: null,
      offlineNotifiedAtMs: null,
    });
    store.setHubConnected("home-a", true);
    store.recordContact("home-a", T0 + 1);
    store.setOfflineNotified("home-a", T0 + 2);
    assert.deepEqual(store.home("home-a"), {
      homeId: "home-a",
      createdAtMs: T0,
      hubConnected: true,
      lastContactAtMs: T0 + 1,
      offlineNotifiedAtMs: T0 + 2,
    });
  });
});

describe("relay store: devices", () => {
  test("the phone list adds, updates and revokes missing or removed phones", (t) => {
    const store = withHome(t);
    const [a, b, c] = [new TestPhone(), new TestPhone("resident"), new TestPhone()];
    assert.deepEqual(store.syncDevices("home-a", [a.entry(), b.entry(), c.entry()], T0), {
      revoked: [],
      refused: [],
    });
    assert.deepEqual(store.deviceCounts("home-a"), { caregivers: 2, residents: 1, revoked: 0 });
    const result = store.syncDevices(
      "home-a",
      [
        { ...a.entry(), credential_sha256: credentialHash("rotated") },
        { device_id: b.deviceId, removed: true },
      ],
      T0 + 1,
    );
    assert.deepEqual(result.revoked.sort(), [b.deviceId, c.deviceId].sort());
    assert.equal(store.device(a.deviceId)?.credentialSha256, credentialHash("rotated"));
    assert.equal(store.device(b.deviceId)?.revokedAtMs, T0 + 1);
    assert.deepEqual(store.revokedDevices("home-a"), [b.deviceId, c.deviceId].sort());
  });

  test("a revoked device stays revoked when a later list names it again", (t) => {
    const store = withHome(t);
    const phone = new TestPhone();
    store.syncDevices("home-a", [phone.entry()], T0);
    assert.equal(store.revokeDevice(phone.deviceId, T0 + 1), true);
    assert.equal(store.revokeDevice(phone.deviceId, T0 + 2), false);
    store.syncDevices("home-a", [phone.entry()], T0 + 3);
    assert.equal(store.device(phone.deviceId)?.revokedAtMs, T0 + 1);
  });

  test("a device ID of another home is refused and left alone", (t) => {
    const store = withHome(t);
    store.createHome("home-b", credentialHash("hub-b"), T0);
    const phone = new TestPhone();
    store.syncDevices("home-a", [phone.entry()], T0);
    const result = store.syncDevices("home-b", [phone.entry()], T0);
    assert.deepEqual(result, { revoked: [], refused: [phone.deviceId] });
    assert.equal(store.device(phone.deviceId)?.homeId, "home-a");
    store.syncDevices("home-b", [], T0);
    assert.equal(store.device(phone.deviceId)?.revokedAtMs, null);
  });
});

describe("relay store: push tokens and push health", () => {
  test("a token moves to the device that registered it last", (t) => {
    const store = withHome(t);
    const [a, b] = [new TestPhone(), new TestPhone()];
    store.syncDevices("home-a", [a.entry(), b.entry()], T0);
    store.setPushToken(a.deviceId, "sandbox", "aa".repeat(32), T0);
    store.setPushToken(b.deviceId, "sandbox", "aa".repeat(32), T0 + 1);
    assert.deepEqual(store.pushTargets("home-a"), [
      { deviceId: b.deviceId, environment: "sandbox", token: "aa".repeat(32) },
    ]);
    store.setPushToken(b.deviceId, "sandbox", "bb".repeat(32), T0 + 2);
    assert.deepEqual(
      store.pushTargets("home-a").map((target) => target.token),
      ["bb".repeat(32)],
    );
  });

  test("only caregivers that aren't revoked are push targets, and revoking deletes tokens", (t) => {
    const store = withHome(t);
    const [carer, resident] = [new TestPhone(), new TestPhone("resident")];
    store.syncDevices("home-a", [carer.entry(), resident.entry()], T0);
    store.setPushToken(carer.deviceId, "production", "cc".repeat(32), T0);
    store.setPushToken(carer.deviceId, "sandbox", "dd".repeat(32), T0 + 5);
    store.setPushToken(resident.deviceId, "production", "ee".repeat(32), T0);
    assert.equal(store.pushTargets("home-a").length, 2);
    assert.equal(store.pushEnvironment(carer.deviceId), "sandbox");
    store.deletePushToken("sandbox", "dd".repeat(32));
    assert.equal(store.pushEnvironment(carer.deviceId), "production");
    store.revokeDevice(carer.deviceId, T0 + 6);
    assert.deepEqual(store.pushTargets("home-a"), []);
    assert.equal(store.pushEnvironment(carer.deviceId), undefined);
  });

  test("push health keeps the last success and the last refusal per environment", (t) => {
    const store = memoryStore(t);
    assert.deepEqual(store.pushHealth("production"), {
      environment: "production",
      lastOkAtMs: null,
      lastError: null,
      lastErrorAtMs: null,
    });
    store.recordPushResult("production", null, T0);
    store.recordPushResult("production", "InvalidProviderToken", T0 + 1);
    assert.deepEqual(store.pushHealth("production"), {
      environment: "production",
      lastOkAtMs: T0,
      lastError: "InvalidProviderToken",
      lastErrorAtMs: T0 + 1,
    });
    assert.equal(store.pushHealth("sandbox").lastOkAtMs, null);
  });
});
