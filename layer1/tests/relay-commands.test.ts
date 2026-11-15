import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Wrapper } from "../bridge/src/wire.ts";
import { type Answer, call, errorCode, TestPhone } from "./relay-fixtures.ts";
import { FakeHub, type HubRelay, phoneCommand, startHubRelay } from "./relay-hub-fixtures.ts";

const post = (relay: HubRelay, phone: TestPhone, body: unknown): Promise<Answer> =>
  call(relay, "/v1/commands", phone, { body });

/** A connected hub that has read its welcome. */
async function signedIn(relay: HubRelay): Promise<FakeHub> {
  const hub = await FakeHub.connect(relay);
  assert.equal((await hub.next()).type, "welcome");
  return hub;
}

/** Sends `wrapper` as `phone`, has the hub answer with `status` and `code`, and returns the answer. */
async function answered(
  relay: HubRelay,
  hub: FakeHub,
  phone: TestPhone,
  wrapper: Wrapper,
  status: number,
  code: string | null,
): Promise<Answer> {
  const answer = post(relay, phone, wrapper);
  const command = await hub.next();
  assert.deepEqual(command, { type: "command", v: 1, from: phone.deviceId, wrapper });
  hub.send({ type: "command_result", v: 1, msg_id: wrapper.msg_id, status, code });
  return answer;
}

describe("relay commands: forwarding", () => {
  test("a command goes to the hub with its sender, and the hub's 202 is the phone's", async (t) => {
    const phone = new TestPhone();
    const relay = await startHubRelay(t, [phone]);
    const hub = await signedIn(relay);
    const wrapper = phoneCommand(phone, relay.homeId, "request");
    const answer = await answered(relay, hub, phone, wrapper, 202, null);
    assert.equal(answer.status, 202);
    assert.deepEqual(answer.body, { v: 1, accepted: true });
  });

  test("the hub's refusals pass through with their status and code", async (t) => {
    const phone = new TestPhone();
    const relay = await startHubRelay(t, [phone]);
    const hub = await signedIn(relay);
    const refusals: Array<[number, string]> = [
      [400, "stale"],
      [400, "bad_envelope"],
      [409, "duplicate"],
      [501, "not_supported"],
    ];
    for (const [status, code] of refusals) {
      const wrapper = phoneCommand(phone, relay.homeId, "laptop_approval");
      const answer = await answered(relay, hub, phone, wrapper, status, code);
      assert.deepEqual([answer.status, errorCode(answer)], [status, code]);
    }
  });

  test("a hub 403 device_removed is 401 device_removed and revokes the device", async (t) => {
    const phone = new TestPhone();
    const relay = await startHubRelay(t, [phone]);
    const hub = await signedIn(relay);
    const wrapper = phoneCommand(phone, relay.homeId, "unpair");
    const answer = await answered(relay, hub, phone, wrapper, 403, "device_removed");
    assert.deepEqual([answer.status, errorCode(answer)], [401, "device_removed"]);
    assert.notEqual(relay.store.device(phone.deviceId)?.revokedAtMs, null);
    assert.equal(errorCode(await call(relay, "/v1/home", phone)), "device_removed");
  });

  test("a hub 403 unknown_device is 401 unauthorized, and nothing is revoked", async (t) => {
    const phone = new TestPhone();
    const relay = await startHubRelay(t, [phone]);
    const hub = await signedIn(relay);
    const wrapper = phoneCommand(phone, relay.homeId, "request");
    const answer = await answered(relay, hub, phone, wrapper, 403, "unknown_device");
    assert.deepEqual([answer.status, errorCode(answer)], [401, "unauthorized"]);
    assert.equal(relay.store.device(phone.deviceId)?.revokedAtMs, null);
  });

  test("503 hub_offline with no hub, or when the hub leaves while the phone waits", async (t) => {
    const phone = new TestPhone();
    const relay = await startHubRelay(t, [phone]);
    const offline = await post(relay, phone, phoneCommand(phone, relay.homeId, "request"));
    assert.deepEqual([offline.status, errorCode(offline)], [503, "hub_offline"]);
    const hub = await signedIn(relay);
    const waiting = post(relay, phone, phoneCommand(phone, relay.homeId, "request"));
    assert.equal((await hub.next()).type, "command");
    hub.ws.terminate();
    const left = await waiting;
    assert.deepEqual([left.status, errorCode(left)], [503, "hub_offline"]);
  });

  test("504 hub_timeout when the hub doesn't answer in time", async (t) => {
    const phone = new TestPhone();
    const relay = await startHubRelay(t, [phone], { commandTimeoutMs: 200 });
    const hub = await signedIn(relay);
    const wrapper = phoneCommand(phone, relay.homeId, "request");
    const started = Date.now();
    const answer = post(relay, phone, wrapper);
    assert.equal((await hub.next()).type, "command");
    const late = await answer;
    assert.deepEqual([late.status, errorCode(late)], [504, "hub_timeout"]);
    assert.ok(Date.now() - started >= 200);
    hub.send({ type: "command_result", v: 1, msg_id: wrapper.msg_id, status: 202, code: null });
    const next = phoneCommand(phone, relay.homeId, "request");
    const after = await answered(relay, hub, phone, next, 202, null);
    assert.equal(after.status, 202, "a late answer doesn't settle the next command");
  });
});

describe("relay commands: the relay's own refusals", () => {
  test("lan_only, unsupported_type and forbidden never reach the hub", async (t) => {
    const carer = new TestPhone();
    const resident = new TestPhone("resident");
    const relay = await startHubRelay(t, [carer, resident]);
    const hub = await signedIn(relay);
    const cases: Array<[TestPhone, Wrapper, number, string]> = [
      [carer, phoneCommand(carer, relay.homeId, "heart_rate"), 400, "lan_only"],
      [carer, phoneCommand(carer, relay.homeId, "fetch"), 400, "lan_only"],
      [carer, phoneCommand(carer, relay.homeId, "ack"), 400, "unsupported_type"],
      [carer, phoneCommand(carer, relay.homeId, "live_view_request"), 400, "unsupported_type"],
      [carer, phoneCommand(carer, relay.homeId, "request", resident.deviceId), 403, "forbidden"],
      [resident, phoneCommand(resident, relay.homeId, "laptop_approval"), 403, "forbidden"],
      [resident, phoneCommand(resident, relay.homeId, "request"), 403, "forbidden"],
      [resident, phoneCommand(resident, relay.homeId, "ack"), 403, "forbidden"],
    ];
    for (const [phone, wrapper, status, code] of cases) {
      const answer = await post(relay, phone, wrapper);
      assert.deepEqual([answer.status, errorCode(answer)], [status, code], wrapper.type);
    }
    const allowed = phoneCommand(resident, relay.homeId, "live_view_setting");
    const answer = await answered(relay, hub, resident, allowed, 202, null);
    assert.equal(answer.status, 202, "the first command the hub saw is the resident's allowed one");
  });

  test("a malformed wrapper is 400 bad_request, and a newer v unsupported_version", async (t) => {
    const phone = new TestPhone();
    const relay = await startHubRelay(t, [phone]);
    const wrapper = phoneCommand(phone, relay.homeId, "request");
    const bad = await post(relay, phone, { ...wrapper, sent_at: "now" });
    assert.deepEqual([bad.status, errorCode(bad)], [400, "bad_request"]);
    const newer = await post(relay, phone, { ...wrapper, v: 2 });
    assert.deepEqual([newer.status, errorCode(newer)], [400, "unsupported_version"]);
    const unsigned = await call(relay, "/v1/commands", undefined, { body: wrapper });
    assert.deepEqual([unsigned.status, errorCode(unsigned)], [401, "unauthorized"]);
  });
});
