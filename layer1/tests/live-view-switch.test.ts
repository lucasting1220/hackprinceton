import assert from "node:assert/strict";
import { createSecretKey, randomBytes } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { type IncomingMessage, request } from "node:http";
import path from "node:path";
import { text } from "node:stream/consumers";
import { type TestContext, test } from "node:test";
import { loadHome } from "../bridge/src/home.ts";
import { LanGateway } from "../bridge/src/lan-gateway.ts";
import { LiveViewConsent } from "../bridge/src/live-view-consent.ts";
import { startBridge } from "../bridge/src/main.ts";
import type { Reply } from "../bridge/src/network-server.ts";
import type { Envelope } from "../bridge/src/phone-crypto.ts";
import type { PhoneLookup, PhoneRole } from "../bridge/src/phones.ts";
import * as settings from "../bridge/src/settings.ts";
import { freePort, makeTempDir, STUB } from "./coordinator-fixtures.ts";
import { FakePhone, phoneWrapper } from "./fake-phone.ts";
import { pageClient } from "./page-client.ts";

const HOME_ID = "7a8e0c4e-5f1d-4c39-9d7e-1b2a3c4d5e6f";
const NOW_MS = Date.UTC(2026, 10, 15, 9, 0, 0);

async function tempStateDir(t: TestContext): Promise<string> {
  const dir = await makeTempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** A gateway whose live_view_setting goes to `consent`, and a phone of each role. */
function gatewayWith(consent: LiveViewConsent) {
  const phones = new Map<
    string,
    { role: PhoneRole; phoneKey: ReturnType<typeof createSecretKey> }
  >();
  const gateway = new LanGateway({
    homeId: HOME_ID,
    phones: {
      lookup: (deviceId): PhoneLookup => {
        const phone = phones.get(deviceId);
        return phone === undefined ? { state: "unknown" } : { state: "paired", ...phone };
      },
      remove: async () => undefined,
    },
    now: () => NOW_MS,
    log: () => undefined,
    handlers: { live_view_setting: (opened) => consent.handle(opened) },
  });
  const phone = (deviceId: string, role: PhoneRole) => {
    const phoneKey = createSecretKey(randomBytes(32));
    phones.set(deviceId, { role, phoneKey });
    return (fields: Record<string, unknown>) =>
      phoneWrapper(phoneKey, {
        homeId: HOME_ID,
        deviceId,
        type: "live_view_setting",
        sentAt: new Date(NOW_MS).toISOString(),
        fields,
      });
  };
  return { gateway, phone };
}

const code = (reply: Reply) => Reflect.get(Object(Reflect.get(reply.body, "error")), "code");

test("live view starts off, and a resident phone turns it on and off by either route", async (t) => {
  const stateDir = await tempStateDir(t);
  const lines: string[] = [];
  const consent = await LiveViewConsent.load(stateDir, {
    log: (line) => lines.push(line),
    now: () => NOW_MS,
  });
  assert.equal(consent.enabled(), false);
  assert.equal(consent.problem(), undefined);
  const { gateway, phone } = gatewayWith(consent);
  const resident = phone("resident-phone", "resident");

  const on = await gateway.commands(resident({ enabled: true }));
  assert.deepEqual([on.status, on.body], [202, { v: 1, accepted: true }]);
  assert.equal(consent.enabled(), true);
  const saved = JSON.parse(await readFile(path.join(stateDir, "live-view.json"), "utf8"));
  assert.deepEqual(saved, { schema_version: 1, enabled: true, changed_at: "2026-11-15T09:00:00Z" });
  assert.equal(
    (await LiveViewConsent.load(stateDir)).enabled(),
    true,
    "it didn't survive a reload",
  );

  const off = await gateway.commands(resident({ enabled: false }), "relay");
  assert.equal(off.status, 202);
  assert.equal(consent.enabled(), false);
  assert.deepEqual(lines, [
    "L1 live-view: live view turned on by phone resident-phone",
    "L1 live-view: live view turned off by phone resident-phone",
  ]);
});

test("a caregiver phone can't change live view, and a malformed setting changes nothing", async (t) => {
  const consent = await LiveViewConsent.load(await tempStateDir(t), { log: () => undefined });
  const { gateway, phone } = gatewayWith(consent);
  const caregiver = await gateway.commands(
    phone("caregiver-phone", "caregiver")({ enabled: true }),
  );
  assert.deepEqual([caregiver.status, code(caregiver)], [400, "forbidden"]);
  const resident = phone("resident-phone", "resident");
  for (const fields of [{}, { enabled: "true" }, { enabled: 1 }, { enabled: null }]) {
    const reply = await gateway.commands(resident(fields));
    assert.deepEqual([reply.status, code(reply)], [400, "bad_request"], JSON.stringify(fields));
  }
  assert.equal(consent.enabled(), false);
});

test("an unreadable setting is off and reported, and the next change replaces it", async (t) => {
  const stateDir = await tempStateDir(t);
  const file = path.join(stateDir, "live-view.json");
  for (const broken of ["{not json", JSON.stringify({ schema_version: 2, enabled: true })]) {
    await writeFile(file, broken, "utf8");
    const lines: string[] = [];
    const consent = await LiveViewConsent.load(stateDir, { log: (line) => lines.push(line) });
    assert.equal(consent.enabled(), false);
    assert.match(consent.problem() ?? "", /live view stays off until it is set again$/);
    assert.equal(lines.length, 1);
    await consent.set(true, { by: "setup_page" });
    assert.equal(consent.problem(), undefined);
    assert.equal((await LiveViewConsent.load(stateDir)).enabled(), true);
  }
});

test("a setting that can't be saved keeps its old value and says why", async (t) => {
  const stateDir = await tempStateDir(t);
  const consent = await LiveViewConsent.load(stateDir, { log: () => undefined });
  // A folder where the file should be makes the rename fail.
  await mkdir(path.join(stateDir, "live-view.json"));
  const { gateway, phone } = gatewayWith(consent);
  const reply = await gateway.commands(phone("resident-phone", "resident")({ enabled: true }));
  assert.deepEqual([reply.status, code(reply)], [500, "internal"]);
  assert.equal(consent.enabled(), false);
  assert.match(consent.problem() ?? "", /^couldn't save the setting: /);
});

type Answer = { status: number; body: { bundle?: unknown; error?: unknown } };

/** A JSON POST with no Origin, as the app sends it. */
function postJson(port: number, target: string, body: unknown): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const sent = request(
      {
        host: "127.0.0.1",
        port,
        method: "POST",
        path: target,
        timeout: 5_000,
        headers: { host: `127.0.0.1:${port}`, "content-type": "application/json" },
      },
      (reply: IncomingMessage) => {
        text(reply).then(
          (raw) => resolve({ status: reply.statusCode ?? 0, body: JSON.parse(raw) }),
          reject,
        );
      },
    );
    sent.on("timeout", () => sent.destroy(new Error("no answer"))).on("error", reject);
    sent.end(JSON.stringify(body));
  });
}

test("the setup page's switch and a paired resident phone both change live view, and it survives a restart", async (t) => {
  const [repoRoot, stateDir] = [await makeTempDir(), await makeTempDir()];
  const stub = path.join(repoRoot, ...settings.COORDINATOR_STUB_PATH);
  await mkdir(path.dirname(stub), { recursive: true });
  await copyFile(STUB, stub);
  const ports = {
    listen: await freePort(),
    dashboard: await freePort(),
    client: await freePort(),
  };
  const lines: string[] = [];
  const start = () =>
    startBridge({
      stateDir,
      repoRoot,
      port: 0,
      homeOptions: { ports },
      open: async () => undefined,
      log: (line) => lines.push(line),
      network: { port: 0, addresses: (port) => [`127.0.0.1:${port}`] },
    });
  let bridge = await start();
  t.after(async () => {
    await bridge.stop("the test ended");
    for (const dir of [repoRoot, stateDir]) await rm(dir, { recursive: true, force: true });
  });
  let page = pageClient(bridge.url);
  assert.equal((await page.post("/home")).statusCode, 200);
  const home = await loadHome(stateDir);
  assert.ok(home !== undefined);
  assert.match((await page.get("/")).page, /Live view is off\./);

  // Pair a resident phone, as step 2 does.
  const lan = bridge.phones()?.state();
  assert.ok(lan?.on === true);
  assert.equal((await page.post("/pairing/start")).statusCode, 303);
  const qr = lan.pairing.qr();
  assert.ok(qr !== undefined);
  const phone = new FakePhone(qr, { role: "resident", name: "Resident's iPhone" });
  assert.equal((await postJson(lan.port, "/v1/pair", phone.request())).status, 202);
  const pendingId = /name="pending_id" value="([^"]+)"/.exec(
    (await page.get("/pairing")).page,
  )?.[1];
  await page.post("/pairing/confirm", { pending_id: pendingId ?? "" });
  const collected = await postJson(lan.port, "/v1/pair", phone.request());
  const bundle = phone.openBundle(collected.body.bundle as Envelope) as { device_id: string };
  const setting = (enabled: boolean) =>
    phoneWrapper(phone.key(), {
      homeId: home.homeId,
      deviceId: bundle.device_id,
      type: "live_view_setting",
      fields: { enabled },
    });

  const on = await postJson(lan.port, "/v1/lan/commands", setting(true));
  assert.deepEqual([on.status, on.body], [202, { v: 1, accepted: true }]);
  assert.match((await page.get("/")).page, /Live view is on:/);

  assert.equal((await page.post("/live-view", { enabled: "off" })).statusCode, 303);
  assert.match((await page.get("/")).page, /Live view is off\./);
  assert.equal((await page.post("/live-view", { enabled: "on" })).statusCode, 303);
  assert.ok(
    lines.includes("L1 live-view: live view turned on by the setup page"),
    lines.join("\n"),
  );

  // A form without the page's token changes nothing.
  const forged = await page.send("POST", "/live-view", {}, "enabled=off&token=wrong");
  assert.equal(forged.statusCode, 403);

  await bridge.stop("restarting");
  bridge = await start();
  page = pageClient(bridge.url);
  assert.match((await page.get("/")).page, /Live view is on:/, "the setting didn't survive");
});
