import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { describe, test } from "node:test";
import { credentialHash, toBase64url } from "../bridge/src/phone-crypto.ts";
import { HUB_CLOSE } from "../bridge/src/relay-protocol.ts";
import { RELAY_MAX_BODY_BYTES } from "../bridge/src/settings.ts";
import type { Wrapper } from "../bridge/src/wire.ts";
import { RelayStoreError } from "../relay/src/store.ts";
import { call, errorCode, homeKey, hubWrapper, TestPhone } from "./relay-fixtures.ts";
import { FakeHub, type HubRelay, refusedUpgrade, startHubRelay } from "./relay-hub-fixtures.ts";

/** A connected hub that has read its welcome. */
async function signedIn(relay: HubRelay, options = {}): Promise<FakeHub> {
  const hub = await FakeHub.connect(relay, options);
  assert.equal((await hub.next()).type, "welcome");
  return hub;
}

function alertFor(relay: HubRelay, change: Partial<Wrapper> = {}): Wrapper {
  return { ...hubWrapper({ homeId: relay.homeId, type: "alert", key: homeKey() }), ...change };
}

function storedIds(relay: HubRelay, phone: TestPhone) {
  const page = relay.store.messagePage({
    homeId: relay.homeId,
    deviceId: phone.deviceId,
    role: phone.role,
    after: null,
    limit: 50,
    nowMs: Date.now(),
  });
  return page.messages.map((message) => message.msg_id);
}

/** No log line holds the hub credential. */
function assertCleanLogs(relay: HubRelay): void {
  for (const line of relay.logs) assert.ok(!line.includes(relay.hubCredential), line);
}

describe("relay hub socket: sign-in and connection", () => {
  test("a missing or wrong credential gets 401 with no upgrade, and another path 404", async (t) => {
    const relay = await startHubRelay(t);
    const wrong = toBase64url(randomBytes(32));
    assert.equal(await refusedUpgrade(relay.hubUrl, {}), 401);
    assert.equal(await refusedUpgrade(relay.hubUrl, { Authorization: `Bearer ${wrong}` }), 401);
    const basic = { Authorization: `Basic ${relay.hubCredential}` };
    assert.equal(await refusedUpgrade(relay.hubUrl, basic), 401);
    const elsewhere = relay.hubUrl.replace("/v1/hub", "/v1/other");
    const bearer = { Authorization: `Bearer ${relay.hubCredential}` };
    assert.equal(await refusedUpgrade(elsewhere, bearer), 404);
    assert.equal(relay.store.home(relay.homeId)?.hubConnected, false);
    assert.equal(relay.hub.connected(relay.homeId), false);
    assertCleanLogs(relay);
  });

  test("welcome names the home and its revoked phones; open and close set the hub's state", async (t) => {
    const kept = new TestPhone();
    const gone = new TestPhone();
    const relay = await startHubRelay(t, [kept, gone]);
    relay.store.revokeDevice(gone.deviceId, Date.now());
    const hub = await FakeHub.connect(relay);
    assert.deepEqual(await hub.next(), {
      type: "welcome",
      v: 1,
      home_id: relay.homeId,
      revoked: [gone.deviceId],
    });
    assert.equal(relay.store.home(relay.homeId)?.hubConnected, true);
    assert.ok(relay.contacts.includes(relay.homeId), "opening counts as contact");
    const home = await call(relay, "/v1/home", kept);
    assert.equal((home.body as { hub: { online: boolean } }).hub.online, true);
    hub.ws.close();
    await hub.closed();
    await delay(50);
    assert.equal(relay.store.home(relay.homeId)?.hubConnected, false);
    assert.equal(relay.hub.connected(relay.homeId), false);
    assertCleanLogs(relay);
  });

  test("a second connection for the home replaces the first, which closes with 4001", async (t) => {
    const relay = await startHubRelay(t);
    const first = await signedIn(relay);
    const second = await signedIn(relay);
    assert.equal(await first.closed(), HUB_CLOSE.replaced);
    await delay(50);
    assert.equal(relay.store.home(relay.homeId)?.hubConnected, true, "the newer one still counts");
    second.send({ type: "phones", v: 1, phones: [] });
    second.ws.close();
    await second.closed();
    await delay(50);
    assert.equal(relay.store.home(relay.homeId)?.hubConnected, false);
  });

  test("a frame after the credential is replaced ends the connection with 4002", async (t) => {
    const phone = new TestPhone();
    const relay = await startHubRelay(t, [phone]);
    const hub = await signedIn(relay);
    relay.store.replaceHubCredential(relay.homeId, credentialHash(toBase64url(randomBytes(32))));
    hub.send({ type: "phones", v: 1, phones: [] });
    assert.equal(await hub.closed(), HUB_CLOSE.credentialRevoked);
    assert.equal((await call(relay, "/v1/home", phone)).status, 200, "the list wasn't applied");
    assert.equal(
      await refusedUpgrade(relay.hubUrl, { Authorization: `Bearer ${relay.hubCredential}` }),
      401,
    );
  });

  test("a hub that misses its pongs is cut off; one that answers stays", async (t) => {
    const relay = await startHubRelay(t, [], { pingIntervalMs: 50, silentCloseMs: 300 });
    const answering = await signedIn(relay);
    await delay(600);
    assert.equal(answering.ws.readyState, answering.ws.OPEN);
    assert.ok(relay.contacts.length > 2, "each pong counts as contact");
    answering.ws.close();
    await answering.closed();
    const silent = await signedIn(relay, { autoPong: false });
    assert.equal(await silent.closed(), 1006);
    assert.ok(relay.logs.some((line) => line.includes("missed its pongs")));
  });
});

describe("relay hub socket: frames", () => {
  test("phones syncs the home's devices, and another home's device is refused", async (t) => {
    const kept = new TestPhone();
    const dropped = new TestPhone();
    const relay = await startHubRelay(t, [kept, dropped]);
    const added = new TestPhone("resident");
    const hub = await signedIn(relay);
    relay.store.createHome("other-home", credentialHash("other"), Date.now());
    const stranger = new TestPhone();
    relay.store.syncDevices("other-home", [stranger.entry()], Date.now());
    const phones = [kept.entry(), added.entry(), stranger.entry()];
    hub.send({ type: "phones", v: 1, phones });
    const ack = alertFor(relay);
    hub.send({ type: "deliver", v: 1, wrapper: ack });
    assert.equal((await hub.next()).type, "ack", "frames are handled in order");
    assert.equal((await call(relay, "/v1/home", added)).status, 200);
    assert.equal(errorCode(await call(relay, "/v1/home", dropped)), "device_removed");
    assert.equal(relay.store.device(stranger.deviceId)?.homeId, "other-home");
    assert.ok(relay.logs.some((line) => line.includes(stranger.deviceId)));
  });

  test("a delivered message is stored, then acknowledged; a repeat is acknowledged again", async (t) => {
    const phone = new TestPhone();
    const relay = await startHubRelay(t, [phone]);
    const hub = await signedIn(relay);
    const wrapper = alertFor(relay, { collapse_id: "a1" });
    hub.send({ type: "deliver", v: 1, wrapper: { ...wrapper, extra: "dropped" } });
    assert.deepEqual(await hub.next(), { type: "ack", v: 1, msg_id: wrapper.msg_id });
    hub.send({ type: "deliver", v: 1, wrapper });
    assert.deepEqual(await hub.next(), { type: "ack", v: 1, msg_id: wrapper.msg_id });
    assert.deepEqual(storedIds(relay, phone), [wrapper.msg_id]);
    assert.deepEqual(relay.stored, [[relay.homeId, wrapper.msg_id]], "pushed once, not twice");
    const page = await call(relay, "/v1/messages", phone);
    assert.deepEqual((page.body as { messages: unknown[] }).messages, [wrapper]);
  });

  test("frames sent successfully are not logged as failures", async (t) => {
    const relay = await startHubRelay(t, [new TestPhone()]);
    const hub = await signedIn(relay);
    const wrapper = alertFor(relay);
    hub.send({ type: "deliver", v: 1, wrapper });
    assert.deepEqual(await hub.next(), { type: "ack", v: 1, msg_id: wrapper.msg_id });
    await delay(50);
    assert.deepEqual(
      relay.logs.filter((line) => line.includes("failed")),
      [],
      "a send whose callback reports no error is a success",
    );
  });

  test("a bad wrapper, a kid that breaks the rule and an oversized one are refused", async (t) => {
    const phone = new TestPhone();
    const relay = await startHubRelay(t, [phone]);
    const hub = await signedIn(relay);
    const good = alertFor(relay);
    const nacks: Array<[Wrapper | object, string, string]> = [
      [{ ...good, msg_id: "n1", sent_at: "soon" }, "n1", "invalid"],
      [{ ...good, msg_id: "n2", to: phone.deviceId }, "n2", "invalid"],
      [
        { ...good, msg_id: "n3", envelope: { ...good.envelope, kid: phone.deviceId } },
        "n3",
        "invalid",
      ],
      [
        {
          ...good,
          msg_id: "n4",
          envelope: { ...good.envelope, c: "A".repeat(RELAY_MAX_BODY_BYTES) },
        },
        "n4",
        "too_large",
      ],
    ];
    for (const [wrapper, msgId, error] of nacks) {
      hub.send({ type: "deliver", v: 1, wrapper });
      assert.deepEqual(await hub.next(), { type: "nack", v: 1, msg_id: msgId, error });
    }
    const reply = { ...good, msg_id: "r1", to: phone.deviceId };
    const sealed = { ...reply, envelope: { ...good.envelope, kid: phone.deviceId } };
    hub.send({ type: "deliver", v: 1, wrapper: sealed });
    assert.deepEqual(await hub.next(), { type: "ack", v: 1, msg_id: "r1" });
    assert.deepEqual(storedIds(relay, phone), ["r1"]);
    assert.deepEqual(relay.stored, [[relay.homeId, "r1"]]);
  });

  test("a store that can't write answers nack storage, and the hub stays connected", async (t) => {
    const relay = await startHubRelay(t);
    const hub = await signedIn(relay);
    const wrapper = alertFor(relay);
    relay.store.storeMessage = () => {
      throw new RelayStoreError("disk full");
    };
    hub.send({ type: "deliver", v: 1, wrapper });
    assert.deepEqual(await hub.next(), {
      type: "nack",
      v: 1,
      msg_id: wrapper.msg_id,
      error: "storage",
    });
    assert.equal(hub.ws.readyState, hub.ws.OPEN);
    assert.deepEqual(relay.stored, []);
  });

  test("unknown frames are logged once and ignored; a newer v too", async (t) => {
    const relay = await startHubRelay(t);
    const hub = await signedIn(relay);
    hub.send({ type: "later_frame", v: 1 });
    hub.send({ type: "another_frame", v: 1 });
    hub.send({ type: "phones", v: 2, phones: "changed" });
    const wrapper = alertFor(relay);
    hub.send({ type: "deliver", v: 1, wrapper });
    assert.equal((await hub.next()).type, "ack");
    const unknown = relay.logs.filter((line) => line.includes("doesn't know"));
    assert.equal(unknown.length, 1);
  });

  test("a phone that unpairs through the relay is reported to the connected hub", async (t) => {
    const phone = new TestPhone();
    const relay = await startHubRelay(t, [phone]);
    const hub = await signedIn(relay);
    assert.equal((await call(relay, "/v1/unpair", phone, { method: "POST" })).status, 204);
    assert.deepEqual(await hub.next(), {
      type: "phone_unpaired",
      v: 1,
      device_id: phone.deviceId,
    });
    assertCleanLogs(relay);
  });
});
