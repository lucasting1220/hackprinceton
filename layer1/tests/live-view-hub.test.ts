import assert from "node:assert/strict";
import { createSecretKey, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { WebSocket } from "ws";
import { LanGateway } from "../bridge/src/lan-gateway.ts";
import type { LinkedLaptop, LinkReport } from "../bridge/src/link.ts";
import type { LinkCommand } from "../bridge/src/live-view-commands.ts";
import { LiveViewConsent } from "../bridge/src/live-view-consent.ts";
import {
  type CameraLaptops,
  cameraLaptopsFrom,
  LiveViewHub,
  parseCameraLaptops,
  signalingUrl,
} from "../bridge/src/live-view-hub.ts";
import { credentialHash } from "../bridge/src/phone-crypto.ts";
import { PhoneRegistry } from "../bridge/src/phones.ts";
import { RelayCredential } from "../bridge/src/relay-credential.ts";
import { RelayLink } from "../bridge/src/relay-link.ts";
import type { LiveViewStartFrame } from "../bridge/src/relay-protocol.ts";
import { LIVE_VIEW_PATH } from "../bridge/src/settings.ts";
import { utcSeconds } from "../bridge/src/wire.ts";
import { waitFor } from "./coordinator-fixtures.ts";
import { call, TestPhone, tempDir } from "./relay-fixtures.ts";
import { phoneCommand, startHubRelay } from "./relay-hub-fixtures.ts";

const CONTRACTS = path.join(import.meta.dirname, "..", "..", "contracts");

/** The bridge link as the hub sees it: what was queued, who reported, and when. */
class FakeLink {
  readonly queued: Array<[string, LinkCommand]> = [];
  readonly laptops = new Map<string, LinkedLaptop>();
  readonly #listeners = new Set<(nodeId: string, report: LinkReport) => void>();

  queue(nodeId: string, command: LinkCommand): void {
    this.queued.push([nodeId, command]);
  }

  linked(): ReadonlyMap<string, LinkedLaptop> {
    return this.laptops;
  }

  onReport(listener: (nodeId: string, report: LinkReport) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** A report from `nodeId` at `at` (ms). */
  report(nodeId: string, at: number, extra: Partial<LinkReport> = {}): void {
    const report: LinkReport = { state: "connected", missing: [], ...extra };
    this.laptops.set(nodeId, { nodeId, reportedAt: utcSeconds(new Date(at)), ...report });
    for (const listener of this.#listeners) listener(nodeId, report);
  }
}

/** A hub's live view with a caregiver and a resident paired, consent on and camera laptop cam-1. */
async function hubWith(
  t: TestContext,
  options: { consent?: boolean; cameras?: CameraLaptops; reported?: boolean } = {},
) {
  const homeId = randomUUID();
  const caregiver = new TestPhone();
  const resident = new TestPhone("resident");
  const logs: string[] = [];
  const log = (line: string) => logs.push(line);
  const directory = {
    lookup: (deviceId: string) => {
      const phone = [caregiver, resident].find((one) => one.deviceId === deviceId);
      return phone === undefined
        ? ({ state: "unknown" } as const)
        : ({ state: "paired", role: phone.role, phoneKey: phone.key() } as const);
    },
    remove: async () => undefined,
  };
  const gateway = new LanGateway({ homeId, phones: directory, log });
  const consent = await LiveViewConsent.load(await tempDir(t), { log });
  if (options.consent ?? true) await consent.set(true, { by: "setup_page" });
  const clock = { now: Date.now() };
  const link = new FakeLink();
  if (options.reported ?? true) link.report("cam-1", clock.now);
  const ended: Array<[string, string]> = [];
  const hub = new LiveViewHub({
    open: (wrapper) => gateway.openPhoneRequest(wrapper),
    consent,
    link,
    cameraLaptops: async () => options.cameras ?? { ok: true, nodeIds: ["cam-1"] },
    relayUrl: "https://relay.example.com",
    endToRelay: (sessionId, reason) => ended.push([sessionId, reason]),
    now: () => clock.now,
    log,
    timing: { checkMs: 10, quietMs: 15_000 },
  });
  t.after(() => hub.close());
  const frame = (
    phone: TestPhone = caregiver,
    changes: Partial<LiveViewStartFrame> = {},
  ): LiveViewStartFrame => ({
    type: "live_view_start",
    v: 1,
    session_id: randomUUID(),
    from: phone.deviceId,
    wrapper: phoneCommand(phone, homeId, "live_view_request"),
    expires_at: utcSeconds(new Date(Date.now() + 300_000)),
    sender_token: randomBytes(32).toString("base64url"),
    ...changes,
  });
  return { hub, link, consent, ended, logs, clock, caregiver, resident, homeId, frame };
}

test("a caregiver's request with consent on and a camera laptop is accepted and live_view_open queued", async (t) => {
  const h = await hubWith(t);
  const start = h.frame();
  assert.equal(await h.hub.start(start), null);
  assert.deepEqual(h.link.queued, [
    [
      "cam-1",
      {
        type: "live_view_open",
        session_id: start.session_id,
        sender_token: start.sender_token,
        signaling_url: `wss://relay.example.com${LIVE_VIEW_PATH}/${start.session_id}/signal`,
        expires_at: start.expires_at,
      },
    ],
  ]);
  assert.deepEqual(h.hub.session(), { id: start.session_id, nodeId: "cam-1" });
  assert.ok(!h.logs.join("\n").includes(start.sender_token));
});

test("consent off answers live_view_off and queues nothing", async (t) => {
  const h = await hubWith(t, { consent: false });
  assert.equal(await h.hub.start(h.frame()), "live_view_off");
  assert.deepEqual(h.link.queued, []);
  assert.equal(h.hub.session(), undefined);
});

test("no camera laptop, or one whose link is quiet, answers no_camera", async (t) => {
  const none = await hubWith(t, { cameras: { ok: true, nodeIds: [] } });
  assert.equal(await none.hub.start(none.frame()), "no_camera");
  const down = await hubWith(t, { cameras: { ok: false, reason: "can't read it" } });
  assert.equal(await down.hub.start(down.frame()), "no_camera");
  const unlinked = await hubWith(t, { reported: false });
  assert.equal(await unlinked.hub.start(unlinked.frame()), "no_camera");
  const quiet = await hubWith(t);
  quiet.clock.now += 16_000;
  assert.equal(await quiet.hub.start(quiet.frame()), "no_camera");
  for (const h of [none, down, unlinked, quiet]) assert.deepEqual(h.link.queued, []);
});

test("a bad wrapper, a resident's request, a repeat and another type are refused", async (t) => {
  const h = await hubWith(t);
  const other = new TestPhone();
  const notKid = h.frame(h.caregiver, { from: other.deviceId });
  assert.equal(await h.hub.start(notKid), "bad_envelope");
  const wrongKey = h.frame(h.caregiver, {
    wrapper: phoneCommand(other, h.homeId, "live_view_request", h.caregiver.deviceId),
  });
  assert.equal(await h.hub.start(wrongKey), "bad_envelope");
  const unknown = h.frame(other);
  assert.equal(await h.hub.start(unknown), "unknown_device");
  assert.equal(await h.hub.start(h.frame(h.resident)), "forbidden");
  const fetch = h.frame(h.caregiver, {
    wrapper: phoneCommand(h.caregiver, h.homeId, "unpair"),
  });
  assert.equal(await h.hub.start(fetch), "unsupported_type");
  const once = h.frame();
  assert.equal(await h.hub.start(once), null);
  assert.equal(await h.hub.start({ ...once, session_id: randomUUID() }), "duplicate");
  assert.equal(h.link.queued.length, 1);
});

test("the relay's end closes the window; resident_turned_off also turns consent off", async (t) => {
  const h = await hubWith(t);
  const first = h.frame();
  await h.hub.start(first);
  h.hub.ended(first.session_id, "stopped");
  assert.deepEqual(h.link.queued.at(-1), [
    "cam-1",
    { type: "live_view_close", session_id: first.session_id, reason: "stopped" },
  ]);
  assert.equal(h.hub.session(), undefined);
  assert.equal(h.consent.enabled(), true);
  const second = h.frame();
  await h.hub.start(second);
  h.hub.ended(second.session_id, "resident_turned_off");
  await waitFor(() => !h.consent.enabled());
  assert.deepEqual(h.link.queued.at(-1), [
    "cam-1",
    { type: "live_view_close", session_id: second.session_id, reason: "resident_turned_off" },
  ]);
  assert.deepEqual(h.ended, [], "the relay ended it, so the hub doesn't tell it again");
  assert.ok(h.logs.some((line) => line.includes("turned off by the sender window")));
});

test("consent turned off during a session ends it as resident_turned_off", async (t) => {
  const h = await hubWith(t);
  const start = h.frame();
  await h.hub.start(start);
  await h.consent.set(false, { by: "phone", deviceId: h.resident.deviceId });
  assert.deepEqual(h.ended, [[start.session_id, "resident_turned_off"]]);
  assert.deepEqual(h.link.queued.at(-1), [
    "cam-1",
    { type: "live_view_close", session_id: start.session_id, reason: "resident_turned_off" },
  ]);
  assert.equal(h.hub.session(), undefined);
});

test("a camera laptop whose link goes quiet, or that reports its window lost, ends the session as lost", async (t) => {
  const h = await hubWith(t);
  const quiet = h.frame();
  await h.hub.start(quiet);
  h.clock.now += 10_000;
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(h.ended, [], "still within the limit");
  h.clock.now += 6_000;
  await waitFor(() => h.ended.length === 1);
  assert.deepEqual(h.ended, [[quiet.session_id, "lost"]]);
  h.link.report("cam-1", h.clock.now);
  const reported = h.frame();
  await h.hub.start(reported);
  h.link.report("cam-1", h.clock.now, { live_view_lost: "another-session" });
  assert.equal(h.ended.length, 1);
  h.link.report("cam-1", h.clock.now, { live_view_lost: reported.session_id });
  assert.deepEqual(h.ended.at(-1), [reported.session_id, "lost"]);
  assert.equal(h.hub.session(), undefined);
});

test("a newer session replaces the open one, whose window closes", async (t) => {
  const h = await hubWith(t);
  const first = h.frame();
  await h.hub.start(first);
  const second = h.frame();
  await h.hub.start(second);
  assert.deepEqual(
    h.link.queued.map(([, command]) => [command.type, command.session_id]),
    [
      ["live_view_open", first.session_id],
      ["live_view_close", first.session_id],
      ["live_view_open", second.session_id],
    ],
  );
  assert.equal(h.hub.session()?.id, second.session_id);
});

test("the signaling URL is on the relay's origin, ws for http", () => {
  assert.equal(
    signalingUrl("https://relay.example.com/some/path", "s1"),
    `wss://relay.example.com${LIVE_VIEW_PATH}/s1/signal`,
  );
  assert.equal(
    signalingUrl("http://127.0.0.1:7490", "s1"),
    `ws://127.0.0.1:7490${LIVE_VIEW_PATH}/s1/signal`,
  );
  assert.equal(signalingUrl("", "s1"), undefined);
});

/** Layer 2's dashboard on port 0, answering GET /api/state with `status` and `body`. */
async function fakeDashboard(t: TestContext, status: number, body: unknown): Promise<number> {
  const server = createServer((request, response) => {
    const found = request.url === "/api/state";
    response.writeHead(found ? status : 404, { "content-type": "application/json" });
    response.end(JSON.stringify(found ? body : {}));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return (server.address() as AddressInfo).port;
}

test("Layer 2's /api/state gives its camera laptops, most recently heard first", async (t) => {
  const example: unknown = JSON.parse(
    await readFile(path.join(CONTRACTS, "api-state.json"), "utf8"),
  );
  assert.deepEqual(parseCameraLaptops(example), ["node-uuid"]);
  const state = {
    schema_version: 1,
    laptops: [
      { node_id: "old", sensors: ["camera"], last_status_at: "2026-11-14T03:12:00Z" },
      { node_id: "mic-only", sensors: ["mic"], last_status_at: "2026-11-14T03:12:50Z" },
      { node_id: "new", sensors: ["camera", "mic"], last_status_at: "2026-11-14T03:12:44Z" },
    ],
  };
  const port = await fakeDashboard(t, 200, state);
  assert.deepEqual(await cameraLaptopsFrom(port), { ok: true, nodeIds: ["new", "old"] });
  const failing = await fakeDashboard(t, 503, {});
  assert.deepEqual(await cameraLaptopsFrom(failing), {
    ok: false,
    reason: "Layer 2's /api/state answered 503",
  });
  const empty = await fakeDashboard(t, 200, { schema_version: 1 });
  assert.equal((await cameraLaptopsFrom(empty)).ok, false);
  const closed = createServer();
  closed.listen(0, "127.0.0.1");
  await once(closed, "listening");
  const gone = (closed.address() as AddressInfo).port;
  await new Promise((resolve) => closed.close(resolve));
  const unreachable = await cameraLaptopsFrom(gone);
  assert.equal(unreachable.ok, false);
});

/**
 * The whole start through the real relay: a caregiver's POST, the relay's live_view_start over the
 * hub's real RelayLink, the hub's checks, Layer 2's /api/state on a fake dashboard, and the sender
 * signing in to signaling with the token from the queued command.
 */
async function throughRelay(t: TestContext, consentOn: boolean) {
  const relay = await startHubRelay(t);
  const stateDir = await tempDir(t);
  const logs: string[] = [];
  const log = (line: string) => logs.push(line);
  const phones = await PhoneRegistry.load(stateDir);
  const phone = new TestPhone();
  await phones.add({
    deviceId: phone.deviceId,
    name: "Sam's iPhone",
    role: phone.role,
    phoneKey: phone.key(),
    credentialSha256: credentialHash(phone.credential),
  });
  const gateway = new LanGateway({ homeId: relay.homeId, phones, log });
  const consent = await LiveViewConsent.load(stateDir, { log });
  if (consentOn) await consent.set(true, { by: "setup_page" });
  const dashboard = await fakeDashboard(t, 200, {
    schema_version: 1,
    laptops: [
      { node_id: "cam-1", sensors: ["camera", "mic"], last_status_at: utcSeconds(new Date()) },
    ],
  });
  const link = new FakeLink();
  link.report("cam-1", Date.now());
  let relayLink: RelayLink | undefined;
  const hub = new LiveViewHub({
    open: (wrapper) => gateway.openPhoneRequest(wrapper),
    consent,
    link,
    cameraLaptops: () => cameraLaptopsFrom(dashboard),
    relayUrl: relay.url,
    endToRelay: (sessionId, reason) => relayLink?.liveViewEnd(sessionId, reason),
    log,
  });
  t.after(() => hub.close());
  const issuedAt = utcSeconds(new Date(Date.now() - 60_000));
  const credential = new RelayCredential(relay.homeId, relay.url, relay.hubCredential, issuedAt);
  relayLink = RelayLink.start({
    credential,
    homeKey: createSecretKey(randomBytes(32)),
    phones,
    outbox: {
      pending: () => [],
      markRelayed: async () => undefined,
      markRefused: async () => undefined,
      onAdded: () => () => undefined,
    },
    commands: (wrapper) => gateway.commands(wrapper, "relay"),
    liveView: hub,
    log,
  });
  const started = relayLink;
  t.after(() => started.close());
  await waitFor(
    () =>
      started.status().state === "connected" && relay.store.device(phone.deviceId) !== undefined,
  );
  const request = phoneCommand(phone, relay.homeId, "live_view_request");
  const answer = await call(relay, LIVE_VIEW_PATH, phone, { body: request });
  assert.equal(answer.status, 202);
  const { session_id: sessionId } = answer.body as { session_id: string };
  const session = async () =>
    (await call(relay, `${LIVE_VIEW_PATH}/${sessionId}`, phone)).body as {
      state: string;
      reason: string | null;
    };
  return { relay, link, consent, logs, sessionId, session, phone };
}

test("through the relay: accepted, the sender signs in with the queued token, and the session is ready", async (t) => {
  const r = await throughRelay(t, true);
  await waitFor(() => r.link.queued.length === 1);
  const [nodeId, command] = r.link.queued[0] ?? [];
  assert.equal(nodeId, "cam-1");
  assert.ok(command?.type === "live_view_open");
  const expected = `${r.relay.url.replace("http:", "ws:")}${LIVE_VIEW_PATH}/${r.sessionId}/signal`;
  assert.equal(command.signaling_url, expected);
  const sender = new WebSocket(command.signaling_url);
  t.after(() => sender.terminate());
  const messages: Array<{ type?: string; reason?: string }> = [];
  sender.on("message", (data) => messages.push(JSON.parse(data.toString())));
  await once(sender, "open");
  sender.send(JSON.stringify({ type: "hello", token: command.sender_token }));
  await waitFor(() => messages.some((message) => message.type === "welcome"));
  let state = await r.session();
  for (let tries = 0; state.state !== "ready" && tries < 50; tries += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    state = await r.session();
  }
  assert.equal(state.state, "ready");
  // The sender window's own button: the relay ends the session and the hub turns consent off.
  sender.send(JSON.stringify({ type: "bye", reason: "resident_turned_off" }));
  await waitFor(() => !r.consent.enabled());
  await waitFor(() => r.link.queued.length === 2);
  assert.deepEqual(r.link.queued[1], [
    "cam-1",
    { type: "live_view_close", session_id: r.sessionId, reason: "resident_turned_off" },
  ]);
  assert.ok(!r.logs.join("\n").includes(command.sender_token));
});

test("through the relay: consent off is denied with live_view_off", async (t) => {
  const r = await throughRelay(t, false);
  let state = await r.session();
  for (let tries = 0; state.state === "requested" && tries < 100; tries += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    state = await r.session();
  }
  assert.deepEqual([state.state, state.reason], ["denied", "live_view_off"]);
  assert.deepEqual(r.link.queued, []);
});

test("through the relay: the hub ending a session tells the relay", async (t) => {
  const r = await throughRelay(t, true);
  await waitFor(() => r.link.queued.length === 1);
  await r.consent.set(false, { by: "setup_page" });
  let state = await r.session();
  for (let tries = 0; state.state !== "ended" && tries < 100; tries += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    state = await r.session();
  }
  assert.deepEqual([state.state, state.reason], ["ended", "resident_turned_off"]);
});
