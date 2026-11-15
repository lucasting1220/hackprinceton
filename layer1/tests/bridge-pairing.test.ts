import assert from "node:assert/strict";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { loadHome } from "../bridge/src/home.ts";
import { startBridge } from "../bridge/src/main.ts";
import type { Envelope } from "../bridge/src/phone-crypto.ts";
import * as settings from "../bridge/src/settings.ts";
import { freePort, makeTempDir, STUB, waitFor } from "./coordinator-fixtures.ts";
import { FakePhone, FETCH_FIELDS, phoneWrapper } from "./fake-phone.ts";
import { pageClient } from "./page-client.ts";

/** The QR code's own SVG; the sidebar's icons are SVGs too. */
const QR_SVG = `<svg width="${settings.QR_DISPLAY_PX}"`;

/** The fields of the network side's JSON replies that these tests read. */
interface NetworkReply {
  readonly bundle?: Envelope;
  readonly messages?: unknown;
  readonly next?: unknown;
  readonly error?: { readonly code?: string };
}

const missing = (): never => {
  throw new Error("the reply has no bundle");
};

/** How long a bridge may take to stop once its stop file appears. */
const STOP_WAIT_MS = 15_000;

/** A JSON POST to the bridge's network side, as the app sends it. */
async function postJson(port: number, target: string, body: unknown) {
  const response = await fetch(`http://127.0.0.1:${port}${target}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });
  return { status: response.status, body: (await response.json()) as NetworkReply };
}

test("a phone pairs through both sides, stays paired across a restart, and Remove locks it out", async (t: TestContext) => {
  const [repoRoot, stateDir] = [await makeTempDir(), await makeTempDir()];
  const stub = path.join(repoRoot, ...settings.COORDINATOR_STUB_PATH);
  await mkdir(path.dirname(stub), { recursive: true });
  await copyFile(STUB, stub);
  const { COORDINATOR_LISTEN_PORT: listen, COORDINATOR_CLIENT_PORT: client } = settings;
  const homeOptions = { ports: { listen, dashboard: await freePort(), client } };
  const lines: string[] = [];
  const running: { stop: (reason: string) => Promise<void> }[] = [];
  t.after(async () => {
    for (const bridge of running) await bridge.stop("the test ended");
    for (const dir of [repoRoot, stateDir]) await rm(dir, { recursive: true, force: true });
  });

  /** Starts the bridge on free ports, its network side reached at 127.0.0.1. */
  const start = async () => {
    const bridge = await startBridge({
      stateDir,
      repoRoot,
      port: 0,
      homeOptions,
      open: async () => undefined,
      log: (line) => lines.push(line),
      network: { port: 0, addresses: (port) => [`127.0.0.1:${port}`] },
    });
    running.push(bridge);
    return bridge;
  };
  /** Stops it the way a script does on any system: through its stop file, with no signal. */
  const stopThroughFile = async (bridge: Awaited<ReturnType<typeof start>>) => {
    const before = lines.filter((line) => line === "L1 bridge: stopped").length;
    await writeFile(bridge.stopFile, "", "utf8");
    await waitFor(
      () => lines.filter((line) => line === "L1 bridge: stopped").length > before,
      STOP_WAIT_MS,
    );
  };
  const networkPort = (bridge: Awaited<ReturnType<typeof start>>) => {
    const state = bridge.phones()?.state();
    if (state?.on !== true) throw new Error("the network side is off");
    return state.port;
  };

  // Create a home through the page, then show a code.
  const first = await start();
  const page = pageClient(first.url);
  assert.equal((await page.post("/home")).statusCode, 200);
  const home = await loadHome(stateDir);
  assert.ok(home !== undefined);
  assert.equal((await page.post("/pairing/start")).statusCode, 303);
  assert.ok((await page.get("/pairing")).page.includes(QR_SVG));
  const state = first.phones()?.state();
  assert.ok(state?.on === true);
  const qr = state.pairing.qr(); // what the phone scans off the page
  assert.ok(qr !== undefined);
  let port = networkPort(first);
  assert.deepEqual(qr.addrs, [`127.0.0.1:${port}`]);

  // The phone asks, the person confirms on the page, the phone collects its bundle.
  const phone = new FakePhone(qr);
  assert.equal((await postJson(port, "/v1/pair", phone.request())).status, 202);
  const pending = (await page.get("/pairing")).page;
  assert.ok(pending.includes(`<h2>${phone.code()}</h2>`));
  const pendingId = /name="pending_id" value="([^"]+)"/.exec(pending)?.[1] ?? "";
  assert.equal((await page.post("/pairing/confirm", { pending_id: pendingId })).statusCode, 303);
  const collected = await postJson(port, "/v1/pair", phone.request());
  assert.equal(collected.status, 200);
  const bundle = phone.openBundle(collected.body.bundle ?? missing()) as {
    home_id: string;
    device_id: string;
  };
  assert.equal(bundle.home_id, home.homeId);
  const deviceId = bundle.device_id;
  const key = phone.key();
  const fetchPage = (to: number) =>
    postJson(
      to,
      "/v1/lan/messages",
      phoneWrapper(key, {
        homeId: home.homeId,
        deviceId,
        type: "fetch",
        fields: FETCH_FIELDS,
      }),
    );

  // The phone's first request sealed with its own key goes through the LAN gateway.
  const fetched = await fetchPage(port);
  assert.equal(fetched.status, 200);
  assert.deepEqual([fetched.body.messages, fetched.body.next], [[], null]);

  // After a restart the phone is still paired.
  await stopThroughFile(first);
  await assert.rejects(fetchPage(port), "the network side still answers after the stop");
  const second = await start();
  port = networkPort(second);
  assert.equal((await fetchPage(port)).status, 200);

  // Remove on the page, and the gateway refuses the phone as removed.
  const secondPage = pageClient(second.url);
  assert.match((await secondPage.get("/")).page, /Caregiver&#39;s iPhone, caregiver, paired/);
  const devices = (await secondPage.get("/devices")).page;
  assert.match(
    devices,
    /<a href="\/devices" id="nav-devices" class="on">/,
    "the Devices tab isn't the one shown",
  );
  assert.match(devices, /<div>Caregiver&#39;s iPhone<\/div><div class="muted">caregiver, paired /);
  assert.match(devices, /1 phone and 0 laptops connected/);
  const removed = await secondPage.post("/phones/remove", { device_id: deviceId });
  assert.equal(removed.statusCode, 303);
  const refused = await fetchPage(port);
  assert.equal(refused.status, 403);
  assert.deepEqual(refused.body.error?.code, "device_removed");
  await stopThroughFile(second);
  for (const line of lines) assert.ok(!line.includes(qr.secret), "a log line holds the QR secret");
});
