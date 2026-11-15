import assert from "node:assert/strict";
import { describe, type TestContext, test } from "node:test";
import { credentialHash } from "../bridge/src/phone-crypto.ts";
import { MESSAGE_RETENTION_MS, RELAY_SWEEP_BATCH } from "../bridge/src/settings.ts";
import { parseRelayCursor, RelayStore } from "../relay/src/store.ts";
import { homeKey, hubWrapper, TestPhone } from "./relay-fixtures.ts";

const T0 = Date.UTC(2026, 10, 14, 15, 0, 0);
const HOME = "home-a";
const key = homeKey();

interface Fixture {
  readonly store: RelayStore;
  readonly carer: TestPhone;
  readonly resident: TestPhone;
}

function fixture(t: TestContext): Fixture {
  const store = RelayStore.open(":memory:");
  t.after(() => store.close());
  store.createHome(HOME, credentialHash("hub"), T0);
  const [carer, resident] = [new TestPhone(), new TestPhone("resident")];
  store.syncDevices(HOME, [carer.entry(), resident.entry()], T0);
  return { store, carer, resident };
}

const alert = (msgId?: string) =>
  hubWrapper({ homeId: HOME, type: "alert", key, ...(msgId === undefined ? {} : { msgId }) });

function page(store: RelayStore, phone: TestPhone, after: string | null, limit = 50, nowMs = T0) {
  return store.messagePage({
    homeId: HOME,
    deviceId: phone.deviceId,
    role: phone.role,
    after,
    limit,
    nowMs,
  });
}

/** A field of a JSON object or a database row, read by name. */
function field(value: unknown, name: string): unknown {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value));
  return Object.getOwnPropertyDescriptor(value, name)?.value;
}

describe("relay store: messages", () => {
  test("a repeated msg_id is stored once and reported as a duplicate", (t) => {
    const { store, carer } = fixture(t);
    const wrapper = alert();
    const first = store.storeMessage(HOME, wrapper, T0);
    const again = store.storeMessage(HOME, wrapper, T0 + 1);
    assert.deepEqual(again, { seq: first.seq, duplicate: true });
    assert.equal(first.duplicate, false);
    assert.equal(page(store, carer, null).messages.length, 1);
  });

  test("latest-only types keep one row per home, and other types keep every row", (t) => {
    const { store, carer } = fixture(t);
    for (const type of ["heartbeat", "heartbeat", "care_status", "care_status"]) {
      store.storeMessage(HOME, hubWrapper({ homeId: HOME, type, key }), T0);
    }
    store.storeMessage(HOME, alert(), T0);
    store.storeMessage(HOME, alert(), T0);
    const types = page(store, carer, null).messages.map((message) => message.type);
    assert.deepEqual(types, ["heartbeat", "care_status", "alert", "alert"]);
  });

  test("the relay keeps only the newest monitoring snapshot per home", (t) => {
    const { store, carer } = fixture(t);
    const snapshots = [1, 2, 3].map(() => hubWrapper({ homeId: HOME, type: "monitoring", key }));
    store.storeMessage(HOME, alert(), T0);
    for (const snapshot of snapshots) store.storeMessage(HOME, snapshot, T0);
    const ids = page(store, carer, null).messages.map((message) => [message.type, message.msg_id]);
    assert.deepEqual(ids.slice(1), [["monitoring", snapshots[2]?.msg_id]]);
    assert.equal(ids[0]?.[0], "alert");
  });

  test("a caregiver gets home-key messages and its own; a resident only its own", (t) => {
    const { store, carer, resident } = fixture(t);
    const other = new TestPhone();
    const homeAlert = alert();
    const toCarer = hubWrapper({
      homeId: HOME,
      type: "reply",
      key: carer.key(),
      to: carer.deviceId,
    });
    const toResident = hubWrapper({
      homeId: HOME,
      type: "reply",
      key: resident.key(),
      to: resident.deviceId,
    });
    const toOther = hubWrapper({
      homeId: HOME,
      type: "reply",
      key: other.key(),
      to: other.deviceId,
    });
    for (const wrapper of [homeAlert, toCarer, toResident, toOther]) {
      store.storeMessage(HOME, wrapper, T0);
    }
    const carerPage = page(store, carer, null).messages;
    assert.deepEqual(
      carerPage.map((message) => message.msg_id),
      [homeAlert.msg_id, toCarer.msg_id],
    );
    const residentPage = page(store, resident, null).messages;
    assert.deepEqual(
      residentPage.map((message) => message.msg_id),
      [toResident.msg_id],
    );
    const [mine] = residentPage;
    assert.ok(mine !== undefined);
    assert.equal(field(resident.open(mine, HOME), "type"), "reply");
  });

  test("pages follow r. cursors oldest first, and an empty page keeps the cursor", (t) => {
    const { store, carer } = fixture(t);
    const sent = Array.from({ length: 5 }, () => alert());
    for (const wrapper of sent) store.storeMessage(HOME, wrapper, T0);
    const first = page(store, carer, null, 2);
    assert.deepEqual(
      first.messages.map((message) => message.msg_id),
      sent.slice(0, 2).map((wrapper) => wrapper.msg_id),
    );
    assert.match(String(first.next), /^r\.\d+$/);
    const second = page(store, carer, first.next, 10);
    assert.deepEqual(
      second.messages.map((message) => message.msg_id),
      sent.slice(2).map((wrapper) => wrapper.msg_id),
    );
    const empty = page(store, carer, second.next);
    assert.deepEqual(empty, { messages: [], next: second.next });
  });

  test("a cursor that isn't this relay's, or is past any it issued, starts at the window", (t) => {
    const { store, carer } = fixture(t);
    const sent = [alert(), alert()];
    for (const wrapper of sent) store.storeMessage(HOME, wrapper, T0);
    for (const after of [null, "l.3f2a.7", "r.", "r.-1", "garbage", "r.999999"]) {
      assert.equal(page(store, carer, after).messages.length, 2, String(after));
    }
  });

  test("with no message for the phone, a foreign cursor gets the home's newest or null", (t) => {
    const { store, resident } = fixture(t);
    assert.deepEqual(page(store, resident, "l.1.1"), { messages: [], next: null });
    const { seq } = store.storeMessage(HOME, alert(), T0);
    assert.deepEqual(page(store, resident, "l.1.1"), { messages: [], next: `r.${seq}` });
  });

  test("messages older than 7 days are left out, and the sweep deletes them in batches", (t) => {
    const { store, carer } = fixture(t);
    const old = RELAY_SWEEP_BATCH * 2 + 7;
    for (let index = 0; index < old; index += 1) store.storeMessage(HOME, alert(), T0);
    const fresh = alert();
    store.storeMessage(HOME, fresh, T0 + MESSAGE_RETENTION_MS);
    const later = T0 + MESSAGE_RETENTION_MS + 1;
    assert.deepEqual(
      page(store, carer, null, 50, later).messages.map((message) => message.msg_id),
      [fresh.msg_id],
    );
    assert.equal(store.sweep(later), old);
    assert.equal(store.sweep(later), 0);
    assert.equal(page(store, carer, null, 50, T0).messages.length, 1);
  });

  test("a sequence number is never issued twice, even after the newest is deleted", (t) => {
    const { store, carer } = fixture(t);
    const first = store.storeMessage(HOME, alert(), T0);
    store.sweep(T0 + MESSAGE_RETENTION_MS + 1);
    const second = store.storeMessage(HOME, alert(), T0 + MESSAGE_RETENTION_MS + 2);
    assert.ok(second.seq > first.seq);
    const after = page(store, carer, `r.${first.seq}`, 50, T0 + MESSAGE_RETENTION_MS + 3);
    assert.equal(after.messages.length, 1);
  });

  test("stored wrappers hold only the contract's fields", (t) => {
    const { store, carer } = fixture(t);
    const wrapper = hubWrapper({ homeId: HOME, type: "alert", key, collapseId: "alert-1" });
    store.storeMessage(HOME, wrapper, T0);
    assert.deepEqual(page(store, carer, null).messages, [wrapper]);
    assert.equal(parseRelayCursor("r.12"), 12);
    assert.equal(parseRelayCursor("l.12"), undefined);
  });
});
