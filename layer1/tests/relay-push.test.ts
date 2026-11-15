import assert from "node:assert/strict";
import { createSecretKey, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, type TestContext, test } from "node:test";
import { credentialHash, fromBase64url, KEY_BYTES, open } from "../bridge/src/phone-crypto.ts";
import {
  APNS_PAYLOAD_MAX_BYTES,
  PUSH_ALERT_EXPIRY_MS,
  PUSH_HUB_STATUS_EXPIRY_MS,
  RELAY_REPUSH_WINDOW_MS,
} from "../bridge/src/settings.ts";
import { parseWrapper, type Wrapper } from "../bridge/src/wire.ts";
import { ApnsClient, type ApnsNotification, type PushOutcome } from "../relay/src/apns.ts";
import {
  alertNotification,
  alertPayload,
  collapseHeader,
  hubStatusNotification,
  hubStatusPayload,
  Pusher,
  type PushSender,
} from "../relay/src/push.ts";
import { type Environment, type PushTarget, RelayStore } from "../relay/src/store.ts";
import { FakeApns, writeTestKeys } from "./fake-apns.ts";
import { homeKey, hubWrapper, TestPhone, tempDir, testConfig } from "./relay-fixtures.ts";

const T0 = Date.UTC(2026, 10, 14, 15, 0, 0);
const HOME = "home-a";
const contracts = path.join(import.meta.dirname, "..", "contracts");

interface Sent {
  readonly target: PushTarget;
  readonly notification: ApnsNotification;
}

/** A sender that records every push; each answer waits until `release` when `held` is set. */
class RecordingSender implements PushSender {
  readonly sent: Sent[] = [];
  held = false;
  readonly #waiting: (() => void)[] = [];

  async send(target: PushTarget, notification: ApnsNotification): Promise<PushOutcome> {
    this.sent.push({ target, notification });
    if (this.held) await new Promise<void>((resolve) => this.#waiting.push(resolve));
    return { result: "sent" };
  }

  release(): void {
    this.held = false;
    for (const resolve of this.#waiting.splice(0)) resolve();
  }
}

function storeWithHome(t: TestContext, file = ":memory:"): RelayStore {
  const store = RelayStore.open(file);
  t.after(() => store.close());
  store.createHome(HOME, credentialHash(`hub-${HOME}`), T0);
  return store;
}

function token(): string {
  return randomBytes(32).toString("hex");
}

/** An alert wrapper as the hub sends it, through the relay's own check. */
function alert(collapseId = "a1", fields: Record<string, unknown> = {}): Wrapper {
  const parsed = parseWrapper(
    hubWrapper({ homeId: HOME, type: "alert", key: homeKey(), collapseId, fields }),
  );
  assert.ok(parsed.ok);
  return parsed.wrapper;
}

function json(text: string): unknown {
  return JSON.parse(text);
}

interface Vector {
  readonly name: string;
  readonly home_id: string;
  readonly key: string;
  readonly envelope: Wrapper["envelope"];
}

async function alertVector(): Promise<Vector> {
  const vectors: unknown = JSON.parse(
    await readFile(path.join(contracts, "vectors.json"), { encoding: "utf8" }),
  );
  assert.ok(typeof vectors === "object" && vectors !== null && "envelopes" in vectors);
  const envelopes = vectors.envelopes;
  assert.ok(Array.isArray(envelopes));
  const found: unknown = envelopes.find(
    (entry: unknown) =>
      typeof entry === "object" &&
      entry !== null &&
      "name" in entry &&
      entry.name === "alert-home-key",
  );
  assert.ok(typeof found === "object" && found !== null);
  return found as Vector;
}

/** The golden file's payload, serialized as the builder serializes one. */
async function golden(name: string): Promise<string> {
  return JSON.stringify(json(await readFile(path.join(contracts, name), { encoding: "utf8" })));
}

describe("push payloads: the golden files in layer1/contracts", () => {
  test("push-alert.json is the builder's payload for the vectors' alert, and opens with the home key", async () => {
    const vector = await alertVector();
    const parsed = parseWrapper({
      v: 1,
      msg_id: "m1",
      type: "alert",
      collapse_id: "a1",
      sent_at: "2026-11-14T15:12:04Z",
      envelope: vector.envelope,
    });
    assert.ok(parsed.ok);
    const payload = alertPayload(vector.home_id, parsed.wrapper);
    assert.equal(payload, await golden("push-alert.json"));
    const pushed = json(payload);
    assert.ok(typeof pushed === "object" && pushed !== null && "debbie" in pushed);
    const { debbie } = pushed;
    assert.ok(typeof debbie === "object" && debbie !== null && "w" in debbie);
    const reparsed = parseWrapper(debbie.w);
    assert.ok(reparsed.ok);
    const key = createSecretKey(fromBase64url(vector.key, KEY_BYTES));
    const plaintext = json(
      open(reparsed.wrapper.envelope, key, { homeId: vector.home_id, type: "alert" }).toString(),
    );
    assert.ok(typeof plaintext === "object" && plaintext !== null && "msg_id" in plaintext);
    assert.equal(plaintext.msg_id, reparsed.wrapper.msg_id);
  });

  test("push-hub-offline.json and push-back-online.json are the builder's payloads", async () => {
    assert.equal(
      hubStatusPayload("hub_offline", Date.UTC(2026, 10, 14, 15, 18, 45)),
      await golden("push-hub-offline.json"),
    );
    assert.equal(
      hubStatusPayload("back_online", Date.UTC(2026, 10, 14, 15, 25, 0)),
      await golden("push-back-online.json"),
    );
  });

  test("the payloads carry §8's placeholder text, levels, threads and both time fields", () => {
    const wrapper = alert();
    assert.deepEqual(json(alertPayload(HOME, wrapper)), {
      aps: {
        alert: { title: "Debbie", body: "New alert from Debbie" },
        "mutable-content": 1,
        "interruption-level": "time-sensitive",
        sound: "default",
        "thread-id": "alerts",
      },
      debbie: { v: 1, home_id: HOME, w: json(JSON.stringify(wrapper)) },
    });
    const offline = json(hubStatusPayload("hub_offline", T0 + 1_500));
    assert.deepEqual(offline, {
      aps: {
        alert: { title: "Can't Reach Home", body: "Debbie can't reach home right now." },
        "mutable-content": 1,
        "interruption-level": "active",
        sound: "default",
        "thread-id": "home-status",
      },
      debbie: {
        v: 1,
        type: "hub_offline",
        last_contact: T0 / 1000 + 1,
        last_contact_at: "2026-11-14T15:00:01Z",
      },
    });
    const back = json(hubStatusPayload("back_online", T0));
    assert.ok(typeof back === "object" && back !== null && "aps" in back);
    assert.deepEqual(back.aps, {
      alert: { title: "Home Is Back Online", body: "Debbie is hearing from home again." },
      "mutable-content": 1,
      "interruption-level": "passive",
      "thread-id": "home-status",
    });
  });
});

describe("push notifications: headers", () => {
  test("an alert: priority 10, 24-hour expiry, the alert ID as collapse ID", () => {
    const notification = alertNotification(HOME, alert("alert-7"), T0);
    assert.equal(notification.pushType, "alert");
    assert.equal(notification.priority, 10);
    assert.equal(notification.expiresAtMs, T0 + PUSH_ALERT_EXPIRY_MS);
    assert.equal(PUSH_ALERT_EXPIRY_MS, 24 * 60 * 60_000);
    assert.equal(notification.collapseId, "alert-7");
  });

  test("offline and back online share hub-status-<home_id>, expire in an hour, priorities 10 and 5", () => {
    const offline = hubStatusNotification(HOME, "hub_offline", T0, T0 + 60_000);
    const back = hubStatusNotification(HOME, "back_online", T0, T0 + 60_000);
    assert.equal(offline.collapseId, `hub-status-${HOME}`);
    assert.equal(back.collapseId, offline.collapseId);
    assert.equal(offline.expiresAtMs, T0 + 60_000 + PUSH_HUB_STATUS_EXPIRY_MS);
    assert.equal(PUSH_HUB_STATUS_EXPIRY_MS, 60 * 60_000);
    assert.equal(offline.priority, 10);
    assert.equal(back.priority, 5);
  });

  test("a collapse ID with a newline, a NUL or a non-ASCII character never becomes a header", () => {
    for (const unsafe of ["a\nb", "a\u0000b", "a\rb", "café", "a b", ""]) {
      assert.equal(collapseHeader(unsafe), undefined, JSON.stringify(unsafe));
    }
    assert.equal(collapseHeader(undefined), undefined);
    assert.equal(collapseHeader("a".repeat(64)), "a".repeat(64));
    assert.equal(collapseHeader("a".repeat(65)), undefined);
    const wrapper = alert("line\nbreak");
    assert.equal(wrapper.collapse_id, "line\nbreak", "the wrapper check lets it through");
    assert.equal(alertNotification(HOME, wrapper, T0).collapseId, undefined);
  });

  test("an alert payload over 4,096 bytes is sent in its truncated form", () => {
    const big = alert("a1", { body: "x".repeat(APNS_PAYLOAD_MAX_BYTES) });
    const payload = alertPayload(HOME, big);
    assert.ok(Buffer.byteLength(payload) <= APNS_PAYLOAD_MAX_BYTES);
    const parsed = json(payload);
    assert.ok(typeof parsed === "object" && parsed !== null && "debbie" in parsed);
    assert.deepEqual(parsed.debbie, { v: 1, home_id: HOME, msg_id: big.msg_id, truncated: true });
    const small = json(alertPayload(HOME, alert()));
    assert.ok(typeof small === "object" && small !== null && "debbie" in small);
    assert.ok(typeof small.debbie === "object" && small.debbie !== null && "w" in small.debbie);
  });
});

describe("pusher: targets and order", () => {
  test("only caregivers with tokens are pushed, each through its token's environment", async (t) => {
    const store = storeWithHome(t);
    const both = new TestPhone();
    const noToken = new TestPhone();
    const resident = new TestPhone("resident");
    const removed = new TestPhone();
    store.syncDevices(
      HOME,
      [both, noToken, resident, removed].map((phone) => phone.entry()),
      T0,
    );
    const tokens: Record<string, string> = {};
    for (const [phone, env] of [
      [both, "production"],
      [both, "sandbox"],
      [resident, "production"],
      [removed, "production"],
    ] as const) {
      tokens[`${phone.deviceId}/${env}`] = token();
      store.setPushToken(phone.deviceId, env, tokens[`${phone.deviceId}/${env}`] ?? "", T0);
    }
    store.revokeDevice(removed.deviceId, T0);
    const sender = new RecordingSender();
    const pusher = new Pusher({ store, sender, now: () => T0, log: () => undefined });
    const wrapper = alert();
    pusher.delivered(HOME, wrapper, store.storeMessage(HOME, wrapper, T0));
    await pusher.settled();
    const sent = sender.sent.map(({ target }) => `${target.deviceId}/${target.environment}`).sort();
    assert.deepEqual(sent, [`${both.deviceId}/production`, `${both.deviceId}/sandbox`].sort());
    for (const { target } of sender.sent) {
      assert.equal(target.token, tokens[`${target.deviceId}/${target.environment}`]);
    }
  });

  test("a repeated alert, or any other type, is not pushed", async (t) => {
    const store = storeWithHome(t);
    const phone = new TestPhone();
    store.syncDevices(HOME, [phone.entry()], T0);
    store.setPushToken(phone.deviceId, "production", token(), T0);
    const sender = new RecordingSender();
    const pusher = new Pusher({ store, sender, now: () => T0, log: () => undefined });
    const wrapper = alert();
    pusher.delivered(HOME, wrapper, store.storeMessage(HOME, wrapper, T0));
    pusher.delivered(HOME, wrapper, store.storeMessage(HOME, wrapper, T0));
    const parsed = parseWrapper(hubWrapper({ homeId: HOME, type: "heartbeat", key: homeKey() }));
    assert.ok(parsed.ok);
    pusher.delivered(HOME, parsed.wrapper, store.storeMessage(HOME, parsed.wrapper, T0));
    await pusher.settled();
    assert.equal(sender.sent.length, 1);
  });

  test("delivered returns before Apple answers, and the alert is marked pushed only after (R13)", async (t) => {
    const store = storeWithHome(t);
    const phone = new TestPhone();
    store.syncDevices(HOME, [phone.entry()], T0);
    store.setPushToken(phone.deviceId, "production", token(), T0);
    const sender = new RecordingSender();
    sender.held = true;
    const pusher = new Pusher({ store, sender, now: () => T0, log: () => undefined });
    const wrapper = alert();
    pusher.delivered(HOME, wrapper, store.storeMessage(HOME, wrapper, T0));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(sender.sent.length, 1, "the push started");
    assert.equal(store.unpushedAlerts(T0 - 1).length, 1, "not marked before Apple answers");
    sender.release();
    await pusher.settled();
    assert.deepEqual(store.unpushedAlerts(T0 - 1), []);
  });

  test("an alert with no target is marked pushed, so a restart doesn't try it again", async (t) => {
    const store = storeWithHome(t);
    const pusher = new Pusher({
      store,
      sender: new RecordingSender(),
      now: () => T0,
      log: () => undefined,
    });
    const wrapper = alert();
    pusher.delivered(HOME, wrapper, store.storeMessage(HOME, wrapper, T0));
    await pusher.settled();
    assert.deepEqual(store.unpushedAlerts(T0 - 1), []);
  });

  test("a restart after the ack but before the push sends that alert's push once (R13)", async (t) => {
    const file = path.join(await tempDir(t), "relay.db");
    const first = RelayStore.open(file);
    first.createHome(HOME, credentialHash("hub"), T0);
    const phone = new TestPhone();
    first.syncDevices(HOME, [phone.entry()], T0);
    first.setPushToken(phone.deviceId, "production", token(), T0);
    const old = alert("old");
    first.storeMessage(HOME, old, T0 - RELAY_REPUSH_WINDOW_MS - 1);
    const recent = alert("recent");
    first.storeMessage(HOME, recent, T0 - 1_000);
    first.close();

    const store = RelayStore.open(file);
    t.after(() => store.close());
    const sender = new RecordingSender();
    const restarted = new Pusher({ store, sender, now: () => T0, log: () => undefined });
    assert.equal(restarted.repushUnpushed(), 1);
    await restarted.settled();
    assert.deepEqual(
      sender.sent.map(({ notification }) => notification.collapseId),
      ["recent"],
      "only the alert from the last 10 minutes",
    );
    const again = new Pusher({ store, sender, now: () => T0, log: () => undefined });
    assert.equal(again.repushUnpushed(), 0);
    await again.settled();
    assert.equal(sender.sent.length, 1);
  });

  test("a home's alerts wait for its status push in flight, so back online goes first", async (t) => {
    const store = storeWithHome(t);
    const phone = new TestPhone();
    store.syncDevices(HOME, [phone.entry()], T0);
    store.setPushToken(phone.deviceId, "production", token(), T0);
    const sender = new RecordingSender();
    sender.held = true;
    const pusher = new Pusher({ store, sender, now: () => T0, log: () => undefined });
    pusher.hubStatus(HOME, "back_online", T0);
    const wrapper = alert();
    pusher.delivered(HOME, wrapper, store.storeMessage(HOME, wrapper, T0));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(
      sender.sent.map(({ notification }) => notification.label),
      [`back_online of home ${HOME}`],
    );
    sender.release();
    await pusher.settled();
    assert.deepEqual(
      sender.sent.map(({ notification }) => notification.label),
      [`back_online of home ${HOME}`, `message ${wrapper.msg_id}`],
    );
  });

  test("a sender that throws is logged by class, and later pushes still go out", async (t) => {
    const store = storeWithHome(t);
    const phone = new TestPhone();
    store.syncDevices(HOME, [phone.entry()], T0);
    store.setPushToken(phone.deviceId, "production", token(), T0);
    let calls = 0;
    const sender: PushSender = {
      send: async () => {
        calls += 1;
        if (calls === 1) throw new RangeError("boom");
        return { result: "sent" };
      },
    };
    const logs: string[] = [];
    const pusher = new Pusher({ store, sender, now: () => T0, log: (line) => logs.push(line) });
    pusher.hubStatus(HOME, "hub_offline", T0);
    pusher.hubStatus(HOME, "back_online", T0);
    await pusher.settled();
    assert.equal(calls, 2);
    assert.ok(logs.some((line) => line.includes("RangeError") && !line.includes("boom")));
  });
});

describe("pusher through the APNs client and a fake APNs", () => {
  test("an alert reaches Apple with its headers, and a dead token is deleted", async (t) => {
    const config = testConfig(await tempDir(t));
    assert.ok(config.apns !== undefined);
    await writeTestKeys(config.apns);
    const fake = await FakeApns.start(t);
    const store = storeWithHome(t);
    const alive = new TestPhone();
    const gone = new TestPhone();
    store.syncDevices(HOME, [alive.entry(), gone.entry()], T0);
    const aliveToken = token();
    const goneToken = token();
    store.setPushToken(alive.deviceId, "production", aliveToken, T0);
    store.setPushToken(gone.deviceId, "sandbox" satisfies Environment, goneToken, T0);
    const logs: string[] = [];
    const client = new ApnsClient({
      store,
      apns: config.apns,
      origins: fake.origins(),
      tls: fake.tls(),
      now: () => T0,
      log: (line) => logs.push(line),
    });
    t.after(() => client.close());
    const pusher = new Pusher({
      store,
      sender: client,
      now: () => T0,
      log: (line) => logs.push(line),
    });
    fake.replyTo(goneToken, { status: 410, reason: "Unregistered" });
    const wrapper = alert("a9");
    pusher.delivered(HOME, wrapper, store.storeMessage(HOME, wrapper, T0));
    await pusher.settled();
    assert.equal(fake.requests.length, 2);
    for (const request of fake.requests) {
      assert.equal(request.headers["apns-collapse-id"], "a9");
      assert.equal(request.body, alertPayload(HOME, wrapper));
    }
    assert.equal(store.pushTargets(HOME).length, 1);
    assert.deepEqual(store.unpushedAlerts(T0 - 1), []);
    const joined = logs.join("\n");
    for (const secret of [aliveToken, goneToken, wrapper.envelope.c]) {
      assert.ok(!joined.includes(secret), "a token or ciphertext was logged");
    }
  });
});
