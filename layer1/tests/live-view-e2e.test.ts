import assert from "node:assert/strict";
import { createSecretKey, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { type WebSocket, WebSocketServer } from "ws";
import { LanGateway } from "../bridge/src/lan-gateway.ts";
import type { LinkedLaptop, LinkReport } from "../bridge/src/link.ts";
import type { LinkCommand } from "../bridge/src/live-view-commands.ts";
import { LiveViewConsent } from "../bridge/src/live-view-consent.ts";
import { cameraLaptopsFrom, LiveViewHub } from "../bridge/src/live-view-hub.ts";
import type { BrowserProcess } from "../bridge/src/live-sender.ts";
import { scriptSafeJson } from "../bridge/src/live-sender-page.ts";
import { RelayCredential } from "../bridge/src/relay-credential.ts";
import { RelayLink } from "../bridge/src/relay-link.ts";
import * as settings from "../bridge/src/settings.ts";
import { startSetupServer } from "../bridge/src/setup-server.ts";
import { utcSeconds } from "../bridge/src/wire.ts";
import { makeTempDir, waitFor } from "./coordinator-fixtures.ts";
import { TestPhone, tempDir } from "./relay-fixtures.ts";
import { phoneCommand } from "./relay-hub-fixtures.ts";

const CAMERA = "cam-1";

/** A frame the hub sent the relay, with the fields these tests read. */
type HubFrame = Readonly<{
  type?: unknown;
  session_id?: unknown;
  accepted?: unknown;
  reason?: unknown;
}>;

/** A stand-in relay on a real WebSocket: it welcomes the hub, records its frames and sends its own. */
async function fakeRelay(t: TestContext) {
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await once(server, "listening");
  const homeId = randomUUID();
  const frames: HubFrame[] = [];
  const sockets: WebSocket[] = [];
  server.on("connection", (ws) => {
    sockets.push(ws);
    ws.on("message", (data) => frames.push(JSON.parse(data.toString()) as HubFrame));
    ws.send(JSON.stringify({ type: "welcome", v: 1, home_id: homeId, revoked: [] }));
  });
  t.after(async () => {
    for (const client of server.clients) client.terminate();
    await new Promise((resolve) => server.close(resolve));
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const send = (frame: unknown) => sockets.at(-1)?.send(JSON.stringify(frame));
  return { homeId, url, frames, send, connected: () => sockets.length > 0 };
}

/** Layer 2's dashboard on port 0, listing `cam-1` with a camera on GET /api/state. */
async function fakeDashboard(t: TestContext): Promise<number> {
  const body = {
    schema_version: 1,
    laptops: [
      { node_id: CAMERA, sensors: ["camera", "mic"], last_status_at: utcSeconds(new Date()) },
    ],
  };
  const server = createServer((request, response) => {
    const found = request.url === "/api/state";
    response.writeHead(found ? 200 : 404, { "content-type": "application/json" });
    response.end(JSON.stringify(found ? body : {}));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return (server.address() as AddressInfo).port;
}

/** The camera laptop's real bridge local server, with a fake browser that records starts and kills. */
async function cameraLaptop(t: TestContext, lines: string[]) {
  const [repoRoot, stateDir] = [await makeTempDir(), await makeTempDir()];
  const browsers: Array<{ file: string; args: readonly string[]; killed: boolean }> = [];
  const spawn = (file: string, args: readonly string[]): BrowserProcess => {
    const browser = { file, args, killed: false };
    browsers.push(browser);
    let exit: (how: string) => void = () => undefined;
    const exited = new Promise<string>((resolve) => {
      exit = resolve;
    });
    return {
      kill: () => {
        browser.killed = true;
        exit("it ended with SIGTERM");
      },
      exited,
    };
  };
  const server = await startSetupServer({
    stateDir,
    repoRoot,
    port: 0,
    log: (line) => lines.push(line),
    liveSender: { spawn, findBrowser: () => "/fake/chrome" },
  });
  t.after(async () => {
    await server.close();
    for (const dir of [repoRoot, stateDir]) await rm(dir, { recursive: true, force: true });
  });
  const senderUrl = new URL(settings.LIVE_SENDER_PATH, server.url).href;
  return { server, browsers, senderUrl, stateDir };
}

/** The bridge link between the hub and the camera laptop: a queued command reaches its bridge. */
class CameraLink {
  readonly queued: Array<[string, LinkCommand]> = [];
  readonly delivered: Array<Promise<void>> = [];
  readonly #laptops = new Map<string, LinkedLaptop>();
  readonly #deliver: (command: LinkCommand) => Promise<void>;

  constructor(deliver: (command: LinkCommand) => Promise<void>) {
    this.#deliver = deliver;
    const report: LinkReport = { state: "connected", missing: [] };
    this.#laptops.set(CAMERA, { nodeId: CAMERA, reportedAt: utcSeconds(new Date()), ...report });
  }

  queue(nodeId: string, command: LinkCommand): void {
    this.queued.push([nodeId, command]);
    if (nodeId === CAMERA) this.delivered.push(this.#deliver(command));
  }

  linked(): ReadonlyMap<string, LinkedLaptop> {
    return this.#laptops;
  }

  onReport(): () => void {
    return () => undefined;
  }
}

/**
 * The whole live view path on one machine: a fake relay's live_view_start over the hub's real
 * RelayLink, the hub's real checks with a test caregiver's sealed wrapper, Layer 2's /api/state on
 * a fake dashboard, and the camera laptop's real bridge serving the sender page and starting a
 * fake browser.
 */
async function liveViewHome(t: TestContext) {
  const relay = await fakeRelay(t);
  const lines: string[] = [];
  const log = (line: string) => lines.push(line);
  const caregiver = new TestPhone();
  const directory = {
    lookup: (deviceId: string) =>
      deviceId === caregiver.deviceId
        ? ({ state: "paired", role: "caregiver", phoneKey: caregiver.key() } as const)
        : ({ state: "unknown" } as const),
    remove: async () => undefined,
  };
  const gateway = new LanGateway({ homeId: relay.homeId, phones: directory, log });
  const consent = await LiveViewConsent.load(await tempDir(t), { log });
  await consent.set(true, { by: "setup_page" });
  const dashboard = await fakeDashboard(t);
  const camera = await cameraLaptop(t, lines);
  const link = new CameraLink((command) => camera.server.liveSender.handle(command));
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
  const credential = new RelayCredential(
    relay.homeId,
    relay.url,
    "E".repeat(43),
    utcSeconds(new Date()),
  );
  relayLink = RelayLink.start({
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
    liveView: hub,
    log,
  });
  const started = relayLink;
  t.after(() => started.close());
  await waitFor(() => started.status().state === "connected" && relay.connected());
  const sessionId = randomUUID();
  const senderToken = randomBytes(32).toString("base64url");
  relay.send({
    type: "live_view_start",
    v: 1,
    session_id: sessionId,
    from: caregiver.deviceId,
    wrapper: phoneCommand(caregiver, relay.homeId, "live_view_request"),
    expires_at: utcSeconds(new Date(Date.now() + 300_000)),
    sender_token: senderToken,
  });
  const answer = () => relay.frames.find((frame) => frame.type === "live_view_answer");
  await waitFor(() => answer() !== undefined, 5_000);
  return { relay, link, camera, consent, lines, sessionId, senderToken, answer };
}

const get = (url: string) => fetch(url, { signal: AbortSignal.timeout(5_000) });

test("end to end: accepted, the camera laptop serves the page and starts the browser; the relay's end closes it", async (t) => {
  const h = await liveViewHome(t);
  assert.deepEqual(h.answer(), {
    type: "live_view_answer",
    v: 1,
    session_id: h.sessionId,
    accepted: true,
    reason: null,
  });
  const signaling = `${h.relay.url.replace("http:", "ws:")}${settings.LIVE_VIEW_PATH}/${h.sessionId}/signal`;
  assert.deepEqual(
    h.link.queued.map(([nodeId, command]) => [nodeId, command.type]),
    [[CAMERA, "live_view_open"]],
  );
  await Promise.all(h.link.delivered);

  assert.equal(h.camera.browsers.length, 1);
  assert.equal(h.camera.browsers[0]?.file, "/fake/chrome");
  assert.deepEqual(h.camera.browsers[0]?.args, [
    `--app=${h.camera.senderUrl}`,
    `--user-data-dir=${path.join(h.camera.stateDir, settings.LIVE_SENDER_BROWSER_DIR)}`,
    ...settings.LIVE_SENDER_BROWSER_FLAGS,
  ]);
  const served = await get(h.camera.senderUrl);
  const page = await served.text();
  assert.equal(served.status, 200);
  assert.ok(page.includes(scriptSafeJson(signaling).slice(1, -1)), "the signaling URL");
  assert.ok(page.includes(scriptSafeJson(h.senderToken)), "the token, escaped for the script");
  assert.equal(served.headers.get("cache-control"), "no-store");
  assert.match(served.headers.get("content-security-policy") ?? "", /script-src 'sha256-/);

  h.relay.send({ type: "live_view_end", v: 1, session_id: h.sessionId, reason: "stopped" });
  await waitFor(() => h.link.queued.length === 2, 5_000);
  assert.deepEqual(h.link.queued[1], [
    CAMERA,
    { type: "live_view_close", session_id: h.sessionId, reason: "stopped" },
  ]);
  await Promise.all(h.link.delivered);
  assert.equal(h.camera.browsers[0]?.killed, true);
  const gone = await get(h.camera.senderUrl);
  await gone.body?.cancel();
  assert.equal(gone.status, 404);
  assert.ok(h.consent.enabled(), "a plain stop leaves consent on");
  for (const line of h.lines) assert.ok(!line.includes(h.senderToken), line);
});

test("end to end: the resident turning live view off mid-session ends it as resident_turned_off", async (t) => {
  const h = await liveViewHome(t);
  assert.equal(h.answer()?.accepted, true);
  await Promise.all(h.link.delivered);
  assert.equal(h.camera.browsers.length, 1);
  await h.consent.set(false, { by: "setup_page" });
  const ended = () => h.relay.frames.find((frame) => frame.type === "live_view_end");
  await waitFor(() => ended() !== undefined, 5_000);
  assert.deepEqual(ended(), {
    type: "live_view_end",
    v: 1,
    session_id: h.sessionId,
    reason: "resident_turned_off",
  });
  await waitFor(() => h.link.queued.length === 2, 5_000);
  assert.deepEqual(h.link.queued[1]?.[1], {
    type: "live_view_close",
    session_id: h.sessionId,
    reason: "resident_turned_off",
  });
  await Promise.all(h.link.delivered);
  assert.equal(h.camera.browsers[0]?.killed, true);
  const gone = await get(h.camera.senderUrl);
  await gone.body?.cancel();
  assert.equal(gone.status, 404);
  for (const line of h.lines) assert.ok(!line.includes(h.senderToken), line);
});
