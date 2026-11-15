import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createSecretKey } from "node:crypto";
import { once } from "node:events";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { loadHome } from "../bridge/src/home.ts";
import { startBridge } from "../bridge/src/main.ts";
import { type Envelope, fromBase64url } from "../bridge/src/phone-crypto.ts";
import * as settings from "../bridge/src/settings.ts";
import type { Wrapper } from "../bridge/src/wire.ts";
import { freePort, makeTempDir, STUB, waitFor } from "./coordinator-fixtures.ts";
import { FakePhone, FETCH_FIELDS, phoneWrapper } from "./fake-phone.ts";
import { openHomeWrapper } from "./home-reader.ts";
import { pageClient } from "./page-client.ts";

/** The stub standing in for Layer 2's coordinator carrying a Layer 4 alert. */
const ALERT_STUB = path.join(import.meta.dirname, "..", "stubs", "fake-layer2-to-phone.ts");

/** How long a bridge may take to stop once its stop file appears, and the stub to finish. */
const STOP_WAIT_MS = 15_000;
const STUB_TIMEOUT_MS = 20_000;

interface NetworkReply {
  readonly bundle?: Envelope;
  readonly messages?: readonly Wrapper[];
  readonly next?: string | null;
}

async function postJson(port: number, target: string, body: unknown) {
  const response = await fetch(`http://127.0.0.1:${port}${target}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });
  return { status: response.status, body: (await response.json()) as NetworkReply };
}

/** Runs `npm run stub:alert`'s program against the bridge at `bridgeUrl`; its exit code and output. */
async function runAlertStub(bridgeUrl: string): Promise<{ code: unknown; output: string }> {
  const args = [ALERT_STUB, "--bridge-url", bridgeUrl, "--kind", "fall", "--rewrite-after", "0"];
  const child = spawn(process.execPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: STUB_TIMEOUT_MS,
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
    });
  }
  const [code] = await once(child, "close");
  return { code, output };
}

test("the stub's alert reaches a paired phone over the LAN gateway, its update replaces the text, and both survive a restart", async (t: TestContext) => {
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
  const networkPort = (bridge: Awaited<ReturnType<typeof start>>) => {
    const state = bridge.phones()?.state();
    if (state?.on !== true) throw new Error("the network side is off");
    return state.port;
  };

  // No home yet: the alert intake answers 503 no_home.
  const first = await start();
  const early = await runAlertStub(first.url);
  assert.equal(early.code, 1);
  assert.match(early.output, /^STUB layer2-to-phone: /);
  assert.match(early.output, /503 .*"no_home"/);

  // Create a home and pair a caregiver phone, as step 2 does.
  const page = pageClient(first.url);
  assert.equal((await page.post("/home")).statusCode, 200);
  const home = await loadHome(stateDir);
  assert.ok(home !== undefined);
  assert.equal((await page.post("/pairing/start")).statusCode, 303);
  const state = first.phones()?.state();
  assert.ok(state?.on === true);
  const payload = state.pairing.qr();
  assert.ok(payload !== undefined);
  let port = networkPort(first);
  const phone = new FakePhone(payload);
  assert.equal((await postJson(port, "/v1/pair", phone.request())).status, 202);
  const pending = (await page.get("/pairing")).page;
  const pendingId = /name="pending_id" value="([^"]+)"/.exec(pending)?.[1] ?? "";
  assert.equal((await page.post("/pairing/confirm", { pending_id: pendingId })).statusCode, 303);
  const collected = await postJson(port, "/v1/pair", phone.request());
  assert.ok(collected.body.bundle !== undefined);
  const bundle = phone.openBundle(collected.body.bundle) as { device_id: string; home_key: string };
  const homeKey = createSecretKey(fromBase64url(bundle.home_key, 32));
  const fetchAll = () =>
    postJson(
      port,
      "/v1/lan/messages",
      phoneWrapper(phone.key(), {
        homeId: home.homeId,
        deviceId: bundle.device_id,
        type: "fetch",
        fields: FETCH_FIELDS,
      }),
    );

  // The stub hands over an alert and its rewrite: 202 twice.
  const sent = await runAlertStub(first.url);
  assert.equal(sent.code, 0, sent.output);
  assert.equal(sent.output.match(/^STUB layer2-to-phone: 202 /gm)?.length, 2, sent.output);

  // The phone fetches both over the LAN gateway and opens them with the home key from its bundle.
  const opened = async () => {
    const fetched = await fetchAll();
    assert.equal(fetched.status, 200);
    return (fetched.body.messages ?? []).map((wrapper) =>
      openHomeWrapper(wrapper, homeKey, home.homeId),
    );
  };
  const [alert, update] = await opened();
  assert.ok(alert !== undefined && update !== undefined);
  assert.deepEqual(
    [alert.kind, alert.severity, alert.title, alert.update],
    ["fall", "urgent", "Possible fall", false],
  );
  assert.match(String(alert.body), /^STUB: /);
  assert.equal(update.alert_id, alert.alert_id);
  assert.equal(update.update, true);
  assert.match(String(update.body), /^STUB rewrite: /);
  assert.equal(update.title, alert.title);

  // After a restart through the stop file, a fetch from the start still gets both.
  const before = lines.filter((line) => line === "L1 bridge: stopped").length;
  await writeFile(first.stopFile, "", "utf8");
  await waitFor(
    () => lines.filter((line) => line === "L1 bridge: stopped").length > before,
    STOP_WAIT_MS,
  );
  const second = await start();
  port = networkPort(second);
  const again = await opened();
  assert.deepEqual(
    again.map((message) => message.msg_id),
    [alert.msg_id, update.msg_id],
  );
  await second.stop("the test ended");
  for (const line of lines) {
    assert.ok(!line.includes("STUB: ") && !line.includes("STUB rewrite"), line);
  }
});
