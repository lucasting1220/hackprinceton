import assert from "node:assert/strict";
import { once } from "node:events";
import { createSecretKey } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { WebSocket } from "ws";
import { LIVE_VIEW_PATH } from "../bridge/src/settings.ts";
import { parseRelayConfig } from "../relay/src/config.ts";
import { TurnSecretError, TurnServers, turnLogin } from "../relay/src/turn.ts";
import { call, errorCode, TestPhone, tempDir } from "./relay-fixtures.ts";
import { FakeHub, type HubRelay, phoneCommand, startHubRelay } from "./relay-hub-fixtures.ts";

const WAIT_MS = 3_000;

type Message = Readonly<Record<string, unknown>>;

/** The fields of the relay's frames and messages that these tests read. */
type Fields = Readonly<{
  type?: unknown;
  session_id?: unknown;
  from?: unknown;
  wrapper?: unknown;
  expires_at?: unknown;
  sender_token?: unknown;
  reason?: unknown;
  ice_servers?: unknown;
}>;
const fields = (value: unknown): Fields => value as Fields;

/** A signaling client: it records each message and its socket's close code. */
class Peer {
  readonly ws: WebSocket;
  readonly #messages: Message[] = [];
  readonly #waiting: Array<(message: Message) => void> = [];
  readonly closed: Promise<number>;

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.closed = new Promise((resolve) => ws.once("close", (code) => resolve(code)));
    ws.on("message", (data) => {
      const message: Message = JSON.parse(data.toString());
      const waiter = this.#waiting.shift();
      if (waiter === undefined) this.#messages.push(message);
      else waiter(message);
    });
  }

  next(): Promise<Message> {
    const message = this.#messages.shift();
    if (message !== undefined) return Promise.resolve(message);
    return within(new Promise((resolve) => this.#waiting.push(resolve)));
  }

  send(message: unknown): void {
    this.ws.send(JSON.stringify(message));
  }
}

function within<T>(work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`nothing within ${WAIT_MS} ms`)), WAIT_MS);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

const signalUrl = (relay: HubRelay, sessionId: string) =>
  `${relay.url.replace("http:", "ws:")}${LIVE_VIEW_PATH}/${sessionId}/signal`;

/** The caregiver phone's signaling socket, signed in with its device headers. */
async function viewer(relay: HubRelay, sessionId: string, phone: TestPhone): Promise<Peer> {
  const ws = new WebSocket(signalUrl(relay, sessionId), { headers: phone.headers() });
  const peer = new Peer(ws);
  await within(once(ws, "open"));
  return peer;
}

/** The sender page's signaling socket, which signs in with its hello and token. */
async function sender(relay: HubRelay, sessionId: string, token: string): Promise<Peer> {
  const ws = new WebSocket(signalUrl(relay, sessionId));
  const peer = new Peer(ws);
  await within(once(ws, "open"));
  peer.send({ type: "hello", token });
  return peer;
}

/** The upgrade's HTTP status when the relay refuses a signaling socket. */
async function refused(url: string, headers: Record<string, string> = {}): Promise<number> {
  const ws = new WebSocket(url, { headers });
  const [, response] = await within(once(ws, "unexpected-response"));
  response.resume();
  return response.statusCode;
}

/** A relay with one caregiver, one resident and a connected hub, and a session started. */
async function started(t: TestContext, liveView: Parameters<typeof startHubRelay>[3] = {}) {
  const caregiver = new TestPhone();
  const resident = new TestPhone("resident");
  const other = new TestPhone();
  const relay = await startHubRelay(t, [caregiver, resident, other], {}, liveView);
  const hub = await FakeHub.connect(relay);
  assert.equal((await hub.next()).type, "welcome");
  const request = phoneCommand(caregiver, relay.homeId, "live_view_request");
  const answer = await call(relay, LIVE_VIEW_PATH, caregiver, { body: request });
  assert.equal(answer.status, 202);
  const body = answer.body as { session_id: string; state: string; expires_at: string };
  const start = fields(await hub.next());
  return { relay, hub, caregiver, resident, other, request, body, start };
}

const status = async (relay: HubRelay, phone: TestPhone, sessionId: string) =>
  call(relay, `${LIVE_VIEW_PATH}/${sessionId}`, phone);

test("a caregiver's request makes a session and sends the hub its request unopened", async (t) => {
  const { relay, body, start, request, caregiver } = await started(t);
  assert.equal(body.state, "requested");
  assert.match(body.session_id, /^[0-9a-f-]{36}$/);
  assert.equal(start.type, "live_view_start");
  assert.equal(start.session_id, body.session_id);
  assert.equal(start.from, caregiver.deviceId);
  assert.deepEqual(start.wrapper, request);
  assert.equal(start.expires_at, body.expires_at);
  assert.match(String(start.sender_token), /^[A-Za-z0-9_-]{43}$/);
  const minutes = (Date.parse(body.expires_at) - Date.now()) / 60_000;
  assert.ok(minutes > 4.9 && minutes <= 5, `the session lasts ${minutes} minutes`);
  const read = await status(relay, caregiver, body.session_id);
  assert.deepEqual(read.body, { v: 1, ...body, reason: null });
  assert.ok(!relay.logs.join("\n").includes(String(start.sender_token)), "the token was logged");
});

test("a resident can't start live view, and other requests are refused before the hub", async (t) => {
  const caregiver = new TestPhone();
  const resident = new TestPhone("resident");
  const relay = await startHubRelay(t, [caregiver, resident]);
  const ask = (phone: TestPhone, wrapper: unknown) =>
    call(relay, LIVE_VIEW_PATH, phone, { body: wrapper });
  // No hub yet.
  const offline = await ask(caregiver, phoneCommand(caregiver, relay.homeId, "live_view_request"));
  assert.deepEqual([offline.status, errorCode(offline)], [503, "hub_offline"]);
  const hub = await FakeHub.connect(relay);
  await hub.next();
  const residentAsks = await ask(
    resident,
    phoneCommand(resident, relay.homeId, "live_view_request"),
  );
  assert.deepEqual([residentAsks.status, errorCode(residentAsks)], [403, "forbidden"]);
  const wrongType = await ask(caregiver, phoneCommand(caregiver, relay.homeId, "request"));
  assert.deepEqual([wrongType.status, errorCode(wrongType)], [400, "unsupported_type"]);
  const notYours = phoneCommand(caregiver, relay.homeId, "live_view_request", resident.deviceId);
  const forged = await ask(caregiver, notYours);
  assert.deepEqual([forged.status, errorCode(forged)], [403, "forbidden"]);
  const unsigned = await call(relay, LIVE_VIEW_PATH, undefined, { body: {} });
  assert.equal(unsigned.status, 401);
  assert.ok(
    relay.logs.every((line) => !line.includes("live view session")),
    "a session started",
  );
});

test("once the hub accepts and the sender signs in, the phone and the sender exchange messages", async (t) => {
  const { relay, hub, caregiver, resident, other, body, start } = await started(t);
  const id = body.session_id;
  hub.send({ type: "live_view_answer", v: 1, session_id: id, accepted: true, reason: null });
  const senderPeer = await sender(relay, id, String(start.sender_token));
  const welcome = await senderPeer.next();
  assert.deepEqual(welcome, { type: "welcome", ice_servers: [], expires_at: body.expires_at });
  await waitFor(async () => (await status(relay, caregiver, id)).body, "ready");
  const ready = (await status(relay, caregiver, id)).body as { viewer?: unknown };
  const origin = new URL(relay.config.public_url).origin.replace(/^http/, "ws");
  assert.deepEqual(ready.viewer, {
    signaling_url: `${origin}${LIVE_VIEW_PATH}/${id}/signal`,
    client_id: caregiver.deviceId,
    ice_servers: [],
  });

  // Only the phone that started it reads it or joins it; a resident may not use live view at all.
  assert.equal((await status(relay, other, id)).status, 404);
  assert.equal(await refused(signalUrl(relay, id), other.headers()), 403);
  assert.equal((await status(relay, resident, id)).status, 403);
  assert.equal(await refused(signalUrl(relay, id), resident.headers()), 403);

  const viewerPeer = await viewer(relay, id, caregiver);
  assert.equal(fields(await viewerPeer.next()).type, "welcome");
  assert.deepEqual(await viewerPeer.next(), { type: "peer", state: "joined" });
  assert.deepEqual(await senderPeer.next(), { type: "peer", state: "joined" });

  senderPeer.send({ type: "offer", sdp: "v=0 offer" });
  assert.deepEqual(await viewerPeer.next(), { type: "offer", sdp: "v=0 offer" });
  viewerPeer.send({ type: "nonsense" }); // not one of the peer types: dropped
  viewerPeer.send({ type: "answer", sdp: "v=0 answer" });
  assert.deepEqual(await senderPeer.next(), { type: "answer", sdp: "v=0 answer" });
  const candidate = { type: "candidate", candidate: "candidate:1 1 udp 1 1.2.3.4 5 typ host" };
  viewerPeer.send(candidate);
  assert.deepEqual(await senderPeer.next(), candidate);
});

test("a sender with the wrong token is refused, and an unknown session's signaling is 404", async (t) => {
  const { relay, hub, body } = await started(t);
  hub.send({
    type: "live_view_answer",
    v: 1,
    session_id: body.session_id,
    accepted: true,
    reason: null,
  });
  const wrong = await sender(relay, body.session_id, "A".repeat(43));
  assert.equal(await within(wrong.closed), 4003);
  assert.equal(await refused(signalUrl(relay, "00000000-0000-4000-8000-000000000000")), 404);
});

test("the hub's denial ends the session with its reason, and its signaling is gone", async (t) => {
  const { relay, hub, caregiver, body } = await started(t);
  hub.send({
    type: "live_view_answer",
    v: 1,
    session_id: body.session_id,
    accepted: false,
    reason: "live_view_off",
  });
  await waitFor(
    async () => (await status(relay, caregiver, body.session_id)).body,
    "denied",
    "live_view_off",
  );
  assert.equal(await refused(signalUrl(relay, body.session_id), caregiver.headers()), 410);

  // Any other refusal is a failure, not the resident's choice.
  const again = phoneCommand(caregiver, relay.homeId, "live_view_request");
  const next = await call(relay, LIVE_VIEW_PATH, caregiver, { body: again });
  const id = (next.body as { session_id: string }).session_id;
  await hub.next();
  hub.send({
    type: "live_view_answer",
    v: 1,
    session_id: id,
    accepted: false,
    reason: "no_camera",
  });
  await waitFor(async () => (await status(relay, caregiver, id)).body, "failed", "no_camera");
});

test("Stop ends the session at once, closes both sockets and tells the hub", async (t) => {
  const { relay, hub, caregiver, body, start } = await started(t);
  const id = body.session_id;
  hub.send({ type: "live_view_answer", v: 1, session_id: id, accepted: true, reason: null });
  const senderPeer = await sender(relay, id, String(start.sender_token));
  const viewerPeer = await viewer(relay, id, caregiver);
  const stopped = await call(relay, `${LIVE_VIEW_PATH}/${id}`, caregiver, { method: "DELETE" });
  assert.equal(stopped.status, 204);
  assert.deepEqual(await hub.next(), {
    type: "live_view_end",
    v: 1,
    session_id: id,
    reason: "stopped",
  });
  for (const peer of [senderPeer, viewerPeer]) assert.equal(await within(peer.closed), 4000);
  await waitFor(async () => (await status(relay, caregiver, id)).body, "ended", "stopped");
  const again = await call(relay, `${LIVE_VIEW_PATH}/${id}`, new TestPhone(), {
    method: "DELETE",
  });
  assert.equal(again.status, 401, "a phone the relay doesn't know can't stop it");
});

test("the session ends when its time is up, and when the hub never answers", async (t) => {
  const timing = { sessionMs: 600, startWaitMs: 300 };
  const first = await started(t, { timing });
  await waitFor(
    async () => (await status(first.relay, first.caregiver, first.body.session_id)).body,
    "failed",
    "hub_timeout",
  );
  assert.equal(fields(await first.hub.next()).reason, "hub_timeout");

  const second = await started(t, { timing });
  const id = second.body.session_id;
  second.hub.send({ type: "live_view_answer", v: 1, session_id: id, accepted: true, reason: null });
  await sender(second.relay, id, String(second.start.sender_token));
  await waitFor(async () => (await status(second.relay, second.caregiver, id)).body, "ready");
  await waitFor(
    async () => (await status(second.relay, second.caregiver, id)).body,
    "ended",
    "expired",
  );
  assert.equal(fields(await second.hub.next()).reason, "expired");
});

test("a new request ends the home's earlier session, and the hub disconnecting ends the session", async (t) => {
  const { relay, hub, caregiver, body } = await started(t);
  const next = phoneCommand(caregiver, relay.homeId, "live_view_request");
  const second = await call(relay, LIVE_VIEW_PATH, caregiver, { body: next });
  assert.equal(second.status, 202);
  const frames = [await hub.next(), await hub.next()];
  assert.deepEqual(
    frames.map((frame) => frame.type),
    ["live_view_start", "live_view_end"],
  );
  assert.equal(fields(frames[1]).reason, "replaced");
  await waitFor(
    async () => (await status(relay, caregiver, body.session_id)).body,
    "ended",
    "replaced",
  );

  const newer = (second.body as { session_id: string }).session_id;
  hub.ws.close();
  await waitFor(async () => (await status(relay, caregiver, newer)).body, "failed", "hub_offline");
});

test("the hub's own live_view_end ends the session, such as the resident turning it off", async (t) => {
  const { relay, hub, caregiver, body } = await started(t);
  const reason = "resident_turned_off";
  hub.send({ type: "live_view_end", v: 1, session_id: body.session_id, reason });
  await waitFor(
    async () => (await status(relay, caregiver, body.session_id)).body,
    "ended",
    reason,
  );
});

test("the sender's bye ends the session: turned off by the resident, or else lost", async (t) => {
  for (const [bye, reason] of [
    [{ type: "bye", reason: "resident_turned_off" }, "resident_turned_off"],
    [{ type: "bye", reason: "anything" }, "lost"],
  ] as const) {
    const { relay, hub, caregiver, body, start } = await started(t);
    const id = body.session_id;
    hub.send({ type: "live_view_answer", v: 1, session_id: id, accepted: true, reason: null });
    const senderPeer = await sender(relay, id, String(start.sender_token));
    const viewerPeer = await viewer(relay, id, caregiver);
    await waitFor(async () => (await status(relay, caregiver, id)).body, "ready");
    senderPeer.send(bye);
    await waitFor(async () => (await status(relay, caregiver, id)).body, "ended", reason);
    assert.equal(fields(await hub.next()).reason, reason);
    assert.equal(await within(viewerPeer.closed), 4000);
  }
});

test("TURN logins are coturn's: expiry in Unix seconds, the session, and HMAC-SHA1 of the secret", async (t) => {
  // The expected password comes from openssl, not from Node's crypto.
  const secret = createSecretKey(Buffer.from("test-turn-secret", "utf8"));
  const login = turnLogin(secret, "0f9e8d7c-6b5a-4938-8271-605f4e3d2c1b", 1_794_727_000_400);
  assert.deepEqual(login, {
    username: "1794727000:0f9e8d7c-6b5a-4938-8271-605f4e3d2c1b",
    credential: "SkG9zLoHFxzXuEHcDVaHPKiEH5g=",
  });

  const dir = await tempDir(t);
  const file = path.join(dir, "turn-secret");
  await writeFile(file, "test-turn-secret\n", "utf8");
  const turn = await TurnServers.load({ host: "relay.example.org", port: 3478, secret_file: file });
  const servers = turn.iceServers("0f9e8d7c-6b5a-4938-8271-605f4e3d2c1b", 1_794_727_000_400);
  assert.deepEqual(servers, [
    { urls: ["stun:relay.example.org:3478"] },
    {
      urls: [
        "turn:relay.example.org:3478?transport=udp",
        "turn:relay.example.org:3478?transport=tcp",
      ],
      ...login,
    },
  ]);

  await writeFile(file, "\n", "utf8");
  await assert.rejects(
    TurnServers.load({ host: "h", port: 1, secret_file: file }),
    TurnSecretError,
  );
  const missing = TurnServers.load({ host: "h", port: 1, secret_file: path.join(dir, "none") });
  await assert.rejects(
    missing,
    (error: Error) =>
      error instanceof TurnSecretError && !error.message.includes("test-turn-secret"),
  );
});

test("with TURN set up, both ends get the session's ICE servers, whose login ends with it", async (t) => {
  const dir = await tempDir(t);
  const file = path.join(dir, "turn-secret");
  await writeFile(file, "test-turn-secret", "utf8");
  const turn = await TurnServers.load({ host: "relay.example.org", port: 3478, secret_file: file });
  const { relay, hub, caregiver, body, start } = await started(t, { turn });
  hub.send({
    type: "live_view_answer",
    v: 1,
    session_id: body.session_id,
    accepted: true,
    reason: null,
  });
  const senderPeer = await sender(relay, body.session_id, String(start.sender_token));
  const viewerPeer = await viewer(relay, body.session_id, caregiver);
  const expected = turn.iceServers(body.session_id, Date.parse(body.expires_at));
  for (const peer of [senderPeer, viewerPeer]) {
    const welcome = fields(await peer.next());
    assert.deepEqual(welcome.ice_servers, expected);
  }
  const username = String(expected[1]?.username);
  assert.equal(Number(username.split(":")[0]) * 1000, Date.parse(body.expires_at));
  assert.ok(relay.logs.every((line) => !line.includes(String(expected[1]?.credential))));
});

test("relay.json's turn block is checked, and is optional", () => {
  const base = {
    schema_version: 1,
    listen_port: 7490,
    public_url: "https://relay.example.org",
    database_file: "/var/lib/relay.db",
    stop_file: "/var/lib/relay.stop",
    hub_silent_limit_s: 180,
    watchdog_tick_s: 60,
  };
  assert.equal(parseRelayConfig(base, "relay.json").turn, undefined);
  const turn = {
    host: "relay.example.org",
    port: 3478,
    secret_file: "/run/credentials/turn-secret",
  };
  assert.deepEqual(parseRelayConfig({ ...base, turn }, "relay.json").turn, turn);
  for (const [field, bad] of [
    ["host", "relay example"],
    ["port", 0],
    ["secret_file", "relative/turn-secret"],
  ] as const) {
    assert.throws(
      () => parseRelayConfig({ ...base, turn: { ...turn, [field]: bad } }, "relay.json"),
      new RegExp(`turn\\.${field}`),
    );
  }
});

/** Polls the status body until its state (and reason) are the given ones. */
async function waitFor(
  read: () => Promise<unknown>,
  state: string,
  reason?: string,
): Promise<void> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const body = (await read()) as { state?: unknown; reason?: unknown };
    if (body.state === state && (reason === undefined || body.reason === reason)) return;
    if (Date.now() > deadline) assert.fail(`the session is ${JSON.stringify(body)}, not ${state}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
