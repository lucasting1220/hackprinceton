import assert from "node:assert/strict";
import { createSecretKey, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { type TestContext, test } from "node:test";
import { type WebSocket, WebSocketServer } from "ws";
import { sealAlert } from "../bridge/src/home-messages.ts";
import { LanGateway } from "../bridge/src/lan-gateway.ts";
import { Outbox } from "../bridge/src/outbox.ts";
import { credentialHash } from "../bridge/src/phone-crypto.ts";
import { PhoneRegistry } from "../bridge/src/phones.ts";
import { RelayCredential } from "../bridge/src/relay-credential.ts";
import {
  hubSocketUrl,
  RelayLink,
  type RelayLinkTiming,
  remoteAccessText,
  upgradeStatus,
} from "../bridge/src/relay-link.ts";
import { HUB_CLOSE } from "../bridge/src/relay-protocol.ts";
import { utcSeconds, type Wrapper } from "../bridge/src/wire.ts";
import { waitFor } from "./coordinator-fixtures.ts";
import { phoneWrapper } from "./fake-phone.ts";
import { call, errorCode, TestPhone, tempDir } from "./relay-fixtures.ts";
import { type HubRelay, phoneCommand, startHubRelay } from "./relay-hub-fixtures.ts";

/** Short times, so backoff, heartbeats and retries happen within a test. */
const FAST: Partial<RelayLinkTiming> = {
  backoffMs: [50, 100],
  backoffResetMs: 60_000,
  rejectedRetryMs: 400,
  heartbeatMs: 300,
  ackTimeoutMs: 1_000,
  connectTimeoutMs: 2_000,
};

const ALERT = {
  alert_id: "a1",
  kind: "fall",
  severity: "urgent",
  detected_at: "2026-11-14T15:12:00Z",
  title: "Possible fall",
  body: "In the kitchen",
  update: false,
} as const;

interface Linked {
  readonly relay: HubRelay;
  readonly link: RelayLink;
  readonly gateway: LanGateway;
  readonly phones: PhoneRegistry;
  readonly outbox: Outbox;
  readonly phone: TestPhone;
  readonly homeKey: ReturnType<typeof createSecretKey>;
  readonly logs: string[];
}

/** Adds `phone` to the hub's phone list, as Confirm does. */
function addPhone(phones: PhoneRegistry, phone: TestPhone): Promise<void> {
  return phones.add({
    deviceId: phone.deviceId,
    name: "Sam's iPhone",
    role: phone.role,
    phoneKey: phone.key(),
    credentialSha256: credentialHash(phone.credential),
  });
}

/**
 * A relay running its real hub socket on port 0, and a hub's phone list, outbox and LAN gateway in
 * a temporary folder, linked by a RelayLink. `prepare` runs before the link starts.
 */
async function linked(
  t: TestContext,
  options: {
    readonly credential?: string;
    readonly issuedAt?: string;
    readonly prepare?: (parts: Prepared) => Promise<void>;
  } = {},
): Promise<Linked> {
  const relay = await startHubRelay(t);
  const stateDir = await tempDir(t);
  const logs: string[] = [];
  const log = (line: string) => logs.push(line);
  const phones = await PhoneRegistry.load(stateDir);
  const phone = new TestPhone();
  await addPhone(phones, phone);
  const clock = { offset: 0 };
  const outbox = await Outbox.open(stateDir, { log, now: () => Date.now() + clock.offset });
  await options.prepare?.({ relay, outbox, phones, clock });
  clock.offset = 0;
  const homeKey = createSecretKey(randomBytes(32));
  const issuedAt = options.issuedAt ?? utcSeconds(new Date(Date.now() - 60_000));
  const hubCredential = options.credential ?? relay.hubCredential;
  const credential = new RelayCredential(relay.homeId, relay.url, hubCredential, issuedAt);
  const gateway = new LanGateway({ homeId: relay.homeId, phones, log });
  const link = RelayLink.start({
    credential,
    homeKey,
    phones,
    outbox,
    commands: (wrapper) => gateway.commands(wrapper, "relay"),
    log,
    timing: FAST,
  });
  t.after(() => link.close());
  return { relay, link, gateway, phones, outbox, phone, homeKey, logs };
}

/** What a test may set up before the link starts; `clock.offset` shifts the outbox's clock. */
interface Prepared {
  readonly relay: HubRelay;
  readonly outbox: Outbox;
  readonly phones: PhoneRegistry;
  readonly clock: { offset: number };
}

const connected = (link: RelayLink) => link.status().state === "connected";

test("the hub socket URL follows the relay's scheme", () => {
  assert.equal(hubSocketUrl("https://relay.example.com").href, "wss://relay.example.com/v1/hub");
  assert.equal(hubSocketUrl("http://127.0.0.1:7490").href, "ws://127.0.0.1:7490/v1/hub");
});

test("the setup page's words for each state never hold the credential", () => {
  const now = Date.UTC(2026, 10, 14, 15, 10, 0);
  assert.equal(remoteAccessText({ state: "not_set_up" }), "not set up");
  assert.equal(
    remoteAccessText({ state: "connected", since: "2026-11-14T15:10:00Z" }),
    "connected to the relay since 2026-11-14T15:10:00Z",
  );
  assert.equal(
    remoteAccessText({ state: "retrying", at: now + 4_200, reason: "no answer" }, now),
    "can't reach the relay (no answer); retrying in 5 s",
  );
  assert.match(remoteAccessText({ state: "rejected" }), /run the provisioning command again/);
  const unusable = { state: "unusable", file: "/s/relay-credential.json", reason: "x" } as const;
  assert.match(remoteAccessText(unusable), /\/s\/relay-credential\.json can't be used \(x\)/);
});

test("the link signs in with the hub credential and sends its phones after welcome and each change", async (t) => {
  const { relay, link, phones, phone, logs } = await linked(t);
  await waitFor(() => relay.store.device(phone.deviceId)?.revokedAtMs === null);
  assert.ok(connected(link));
  assert.equal(relay.hub.connected(relay.homeId), true);

  const second = new TestPhone("resident");
  await addPhone(phones, second);
  await waitFor(() => relay.store.device(second.deviceId)?.role === "resident");
  await phones.remove(second.deviceId);
  await waitFor(() => relay.store.device(second.deviceId)?.revokedAtMs !== null);

  const all = [...logs, ...relay.logs].join("\n");
  assert.ok(!all.includes(relay.hubCredential), "the hub credential reached a log line");
  assert.ok(!remoteAccessText(link.status()).includes(relay.hubCredential));
});

test("welcome's revoked phones are marked removed on the hub", async (t) => {
  const revoked = new TestPhone();
  const { phones } = await linked(t, {
    prepare: async ({ relay, phones }) => {
      await addPhone(phones, revoked);
      relay.store.syncDevices(relay.homeId, [revoked.entry()], Date.now());
      relay.store.revokeDevice(revoked.deviceId, Date.now());
    },
  });
  await waitFor(() => phones.lookup(revoked.deviceId).state === "removed");
});

test("the outbox drains in order, marked relayed only on ack, and stays fetchable on the LAN", async (t) => {
  let old: Wrapper | undefined;
  const homeKey = createSecretKey(randomBytes(32));
  const { relay, outbox } = await linked(t, {
    prepare: async ({ outbox: box, relay: hub, clock }) => {
      clock.offset = -120_000; // two minutes before the credential's issued_at, a minute ago
      old = sealAlert({ ...ALERT, alert_id: "old" }, { homeId: hub.homeId, homeKey });
      await box.append(old);
    },
  });
  const first = sealAlert(ALERT, { homeId: relay.homeId, homeKey });
  const second = sealAlert({ ...ALERT, alert_id: "a2" }, { homeId: relay.homeId, homeKey });
  await outbox.append(first);
  await outbox.append(second);
  await waitFor(() => outbox.pending(10).length === 1);
  const delivered = relay.stored.map(([, msgId]) => msgId);
  const alerts = delivered.filter((id) => id === first.msg_id || id === second.msg_id);
  assert.deepEqual(alerts, [first.msg_id, second.msg_id]);
  assert.ok(old !== undefined);
  assert.ok(!delivered.includes(old.msg_id), "a message older than issued_at was relayed");
  assert.deepEqual(
    outbox.pending(10).map((entry) => entry.wrapper.msg_id),
    [old.msg_id],
  );
  const lan = outbox.page(null, 50, () => true).messages.map((wrapper) => wrapper.msg_id);
  assert.deepEqual(lan, [old.msg_id, first.msg_id, second.msg_id]);
});

test("a message the relay refuses as invalid is marked refused, reported and not resent", async (t) => {
  const homeKey = createSecretKey(randomBytes(32));
  const { relay, outbox, link } = await linked(t);
  await waitFor(() => connected(link));
  const sealed = sealAlert(ALERT, { homeId: relay.homeId, homeKey });
  // A wrapper for every caregiver must carry kid "home"; the relay refuses this one.
  const broken = { ...sealed, envelope: { ...sealed.envelope, kid: "someone" } };
  await outbox.append(broken);
  await waitFor(() => outbox.problems().some((line) => line.includes("refused 1 message")));
  assert.deepEqual(outbox.pending(10), []);
  await relay.restart();
  await waitFor(() => connected(link) && relay.hub.connected(relay.homeId));
  const good = sealAlert({ ...ALERT, alert_id: "a2" }, { homeId: relay.homeId, homeKey });
  await outbox.append(good);
  await waitFor(() => relay.stored.some(([, id]) => id === good.msg_id));
  const refusals = relay.logs.filter((line) => line.includes(`refused message ${broken.msg_id}`));
  assert.equal(refusals.length, 1, "the refused message was sent again");
});

test("the link survives a relay restart and delivers what waited meanwhile", async (t) => {
  const homeKey = createSecretKey(randomBytes(32));
  const { relay, outbox, link, logs } = await linked(t);
  await waitFor(() => connected(link) && relay.hub.connected(relay.homeId));
  await relay.restart();
  const waiting = sealAlert(ALERT, { homeId: relay.homeId, homeKey });
  await outbox.append(waiting);
  await waitFor(() => relay.stored.some(([, id]) => id === waiting.msg_id), 5_000);
  assert.ok(connected(link));
  assert.ok(
    logs.some((line) => /connecting again in \d+ ms/.test(line)),
    logs.join("\n"),
  );
});

test("heartbeats go through home-messages.ts and the relay keeps only the newest", async (t) => {
  const { relay, link, phone, homeKey } = await linked(t);
  await waitFor(() => relay.stored.length >= 2, 3_000);
  assert.ok(connected(link));
  const page = relay.store.messagePage({
    homeId: relay.homeId,
    deviceId: phone.deviceId,
    role: "caregiver",
    after: null,
    limit: 50,
    nowMs: Date.now(),
  });
  const heartbeats = page.messages.filter((wrapper) => wrapper.type === "heartbeat");
  assert.equal(heartbeats.length, 1);
  const heartbeat = heartbeats[0];
  assert.ok(heartbeat !== undefined);
  const opened = phone.open(heartbeat, relay.homeId, homeKey);
  assert.deepEqual(Object.keys(opened).sort(), ["msg_id", "sent_at", "type"]);
});

test("a heartbeat the relay never acknowledges ends the connection, and the link reconnects", async (t) => {
  const relay = await fakeRelay(t, () => undefined);
  const { link, logs } = relayLinkTo(t, relay);
  await waitFor(() => relay.connections >= 1 && connected(link));
  await waitFor(() => logs.some((line) => line.includes("didn't acknowledge a heartbeat")), 4_000);
  await waitFor(() => relay.connections >= 2, 4_000);
});

test("a command whose from isn't its kid, or 31 seconds old or ahead, is refused as the LAN would", async (t) => {
  const results: SeenFrame[] = [];
  const relay = await fakeRelay(t, (frame) => {
    if (frame.type === "command_result") results.push(frame);
    const { wrapper } = frame;
    if (frame.type === "deliver" && typeof wrapper === "object" && wrapper !== null) {
      relay.send({ type: "ack", v: 1, msg_id: Reflect.get(wrapper, "msg_id") });
    }
  });
  const { link, phone, homeId } = relayLinkTo(t, relay);
  await waitFor(() => connected(link) && relay.connections === 1);
  const at = (offsetMs: number) => utcSeconds(new Date(Date.now() + offsetMs));
  const wrongFrom = phoneCommand(phone, homeId, "unpair");
  relay.send({ type: "command", v: 1, from: "someone-else", wrapper: wrongFrom });
  for (const offset of [-31_000, 31_000]) {
    const late = phoneWrapper(phone.key(), {
      homeId,
      deviceId: phone.deviceId,
      type: "unpair",
      sentAt: at(offset),
    });
    relay.send({ type: "command", v: 1, from: phone.deviceId, wrapper: late });
  }
  await waitFor(() => results.length === 3);
  const answers = results.map(({ status, code }) => `${String(status)} ${String(code)}`);
  assert.deepEqual(answers, ["400 bad_envelope", "400 stale", "400 stale"]);
  assert.equal(link.status().state, "connected");
});

test("a refused credential slows retries to the rejected interval and says so", async (t) => {
  const { link, relay, logs } = await linked(t, { credential: "B".repeat(43) });
  await waitFor(() => link.status().state === "rejected");
  assert.match(remoteAccessText(link.status()), /rejected this home's credential/);
  const tries = () => relay.logs.filter((line) => line.includes("refused a hub sign-in")).length;
  const before = tries();
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(tries(), before, "it retried before the rejected interval");
  await waitFor(() => tries() > before, 2_000);
  assert.ok(!logs.join("\n").includes("B".repeat(43)));
});

test("a credential replaced while connected (close 4002) counts as rejected", async (t) => {
  const { link, relay } = await linked(t);
  await waitFor(() => connected(link) && relay.hub.connected(relay.homeId));
  relay.store.replaceHubCredential(relay.homeId, credentialHash("C".repeat(43)));
  await waitFor(() => link.status().state === "rejected", 3_000);
  assert.ok(relay.logs.some((line) => line.includes("was replaced")));
  assert.equal(HUB_CLOSE.credentialRevoked, 4002);
});

test("upgradeStatus reports the relay's answer to a sign-in", async (t) => {
  const relay = await startHubRelay(t);
  const url = new URL(relay.hubUrl);
  assert.equal(await upgradeStatus(url, `Bearer ${relay.hubCredential}`, 2_000), 101);
  assert.equal(await upgradeStatus(url, `Bearer ${"D".repeat(43)}`, 2_000), 401);
});

test("a phone's command goes through the relay to the LAN gateway and its answer comes back", async (t) => {
  const { relay, link, phone, phones } = await linked(t);
  await waitFor(() => connected(link) && relay.store.device(phone.deviceId) !== undefined);

  const later = await call(relay, "/v1/commands", phone, {
    body: phoneCommand(phone, relay.homeId, "laptop_approval"),
  });
  assert.equal(later.status, 501);
  assert.equal(errorCode(later), "not_supported");

  // `request` takes the handoff's branch of the same switch; this gateway has no handoff.
  const handoff = await call(relay, "/v1/commands", phone, {
    body: phoneCommand(phone, relay.homeId, "request"),
  });
  assert.equal(handoff.status, 503);
  assert.equal(errorCode(handoff), "coordinator_down");

  const unpair = phoneCommand(phone, relay.homeId, "unpair");
  const accepted = await call(relay, "/v1/commands", phone, { body: unpair });
  assert.equal(accepted.status, 202);
  assert.equal(phones.lookup(phone.deviceId).state, "removed");
  await waitFor(() => relay.store.device(phone.deviceId)?.revokedAtMs !== null);
});

test("on the relay route heart_rate gets lan_only, and a repeat from either route 409 duplicate", async (t) => {
  const { relay, link, phone, gateway } = await linked(t);
  await waitFor(() => connected(link) && relay.store.device(phone.deviceId) !== undefined);
  const heartRate = phoneCommand(phone, relay.homeId, "heart_rate");
  const relayed = await gateway.commands(heartRate, "relay");
  assert.equal(relayed.status, 400);
  assert.match(JSON.stringify(relayed.body), /"lan_only"/);
  const onLan = await gateway.commands(phoneCommand(phone, relay.homeId, "heart_rate"));
  assert.match(JSON.stringify(onLan.body), /"unsupported_type"/);

  const request = phoneCommand(phone, relay.homeId, "laptop_approval");
  assert.equal((await gateway.commands(request)).status, 501, "the LAN route answers first");
  const again = await call(relay, "/v1/commands", phone, { body: request });
  assert.equal(again.status, 409);
  assert.equal(errorCode(again), "duplicate");
});

/** A frame the hub sent, with the fields these tests read. */
type SeenFrame = Readonly<{ type?: unknown; wrapper?: unknown; status?: unknown; code?: unknown }>;

/** A stand-in relay on a real WebSocket: it welcomes the hub, then only records what arrives. */
async function fakeRelay(t: TestContext, onFrame: (frame: SeenFrame) => void) {
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await once(server, "listening");
  const homeId = randomUUID();
  const state = {
    homeId,
    connections: 0,
    latest: undefined as WebSocket | undefined,
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    send(frame: unknown) {
      state.latest?.send(JSON.stringify(frame));
    },
  };
  server.on("connection", (ws) => {
    state.connections += 1;
    state.latest = ws;
    ws.on("message", (data) => onFrame(JSON.parse(data.toString()) as SeenFrame));
    ws.send(JSON.stringify({ type: "welcome", v: 1, home_id: homeId, revoked: [] }));
  });
  t.after(async () => {
    for (const client of server.clients) client.terminate();
    await new Promise((resolve) => server.close(resolve));
  });
  return state;
}

/** A link from a hub with one paired phone to `relay`, whose LAN gateway answers its commands. */
function relayLinkTo(t: TestContext, relay: Awaited<ReturnType<typeof fakeRelay>>) {
  const phone = new TestPhone();
  const logs: string[] = [];
  const log = (line: string) => logs.push(line);
  const { homeId } = relay;
  const lookup = { state: "paired", role: "caregiver", phoneKey: phone.key() } as const;
  const directory = {
    lookup: (deviceId: string) =>
      deviceId === phone.deviceId ? lookup : { state: "unknown" as const },
    remove: async () => undefined,
  };
  const gateway = new LanGateway({ homeId, phones: directory, log });
  const credential = new RelayCredential(homeId, relay.url, "E".repeat(43), utcSeconds(new Date()));
  const link = RelayLink.start({
    credential,
    homeKey: createSecretKey(randomBytes(32)),
    phones: { relayList: () => [], remove: async () => undefined, onChange: () => () => undefined },
    outbox: {
      pending: () => [],
      markRelayed: async () => undefined,
      markRefused: async () => undefined,
      onAdded: () => () => undefined,
    },
    commands: (wrapper) => gateway.commands(wrapper, "relay"),
    log,
    timing: FAST,
  });
  t.after(() => link.close());
  return { link, phone, homeId, logs };
}
