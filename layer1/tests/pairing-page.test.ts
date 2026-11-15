import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { type TestContext, test } from "node:test";
import type { Home } from "../bridge/src/home.ts";
import { PhoneAccess, type PhoneAccessOptions } from "../bridge/src/phone-access.ts";
import { pairingBody } from "../bridge/src/pairing-page.ts";
import type { QrPayload } from "../bridge/src/pairing.ts";
import type { Envelope } from "../bridge/src/phone-crypto.ts";
import * as settings from "../bridge/src/settings.ts";
import { startSetupServer } from "../bridge/src/setup-server.ts";
import { freePort, makeTempDir, STUB } from "./coordinator-fixtures.ts";
import { FakePhone } from "./fake-phone.ts";
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

const loopback = (port: number) => [`127.0.0.1:${port}`];

/** The setup page with its phone side, as main.ts wires it, for a home made through the page. */
async function serve(t: TestContext, network: Omit<PhoneAccessOptions, "log"> = {}) {
  const [repoRoot, stateDir] = [await makeTempDir(), await makeTempDir()];
  const stubFile = path.join(repoRoot, ...settings.COORDINATOR_STUB_PATH);
  await mkdir(path.dirname(stubFile), { recursive: true });
  await writeFile(stubFile, await readFile(STUB, "utf8"), "utf8");
  const { COORDINATOR_LISTEN_PORT: listen, COORDINATOR_CLIENT_PORT: client } = settings;
  const homeOptions = { ports: { listen, dashboard: await freePort(), client } };
  const lines: string[] = [];
  const log = (line: string) => lines.push(line);
  let access: PhoneAccess | undefined;
  const onHomeReady = async (home: Home) => {
    access = await PhoneAccess.start(home, { port: 0, addresses: loopback, ...network, log });
  };
  const server = await startSetupServer({
    stateDir,
    repoRoot,
    port: 0,
    homeOptions,
    log,
    onHomeReady,
    phoneAccess: () => access,
  });
  t.after(async () => {
    await access?.close();
    await server.close();
    for (const dir of [repoRoot, stateDir]) await rm(dir, { recursive: true, force: true });
  });
  const browser = pageClient(server.url);
  const on = () => {
    const state = access?.state();
    if (state?.on !== true) throw new Error("the phone side is off");
    return state;
  };
  /** The QR code's payload, which a phone would scan. */
  const qr = (): QrPayload => {
    const payload = on().pairing.qr();
    if (payload === undefined) throw new Error("no code is showing");
    return payload;
  };
  /** POST /v1/pair on the network side, as the app sends it. */
  const pair = async (phone: FakePhone) => {
    const response = await fetch(`http://127.0.0.1:${on().port}/v1/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(phone.request()),
      signal: AbortSignal.timeout(5_000),
    });
    return { status: response.status, body: (await response.json()) as NetworkReply };
  };
  return { ...browser, url: server.url, stateDir, lines, on, qr, pair, access: () => access };
}

const pendingIdOf = (page: string) => /name="pending_id" value="([^"]+)"/.exec(page)?.[1] ?? "";
const reloads = (page: string) => page.includes('<meta http-equiv="refresh" content="2">');

test("each action refuses a missing token, a foreign Origin and a foreign Host", async (t) => {
  const s = await serve(t);
  assert.equal((await s.post("/home")).statusCode, 200);
  const { port } = new URL(s.url);
  const token = await s.token();
  const actions = ["/pairing/start", "/pairing/confirm", "/pairing/cancel", "/phones/remove"];
  for (const action of actions) {
    const noToken = await s.send("POST", action, {}, "pending_id=x&device_id=y");
    assert.equal(noToken.statusCode, 403, `${action} with no token`);
    assert.match(noToken.page, /from an earlier run of the bridge/);
    const body = `token=${token}`;
    const foreign = await s.send("POST", action, { origin: "http://evil.example" }, body);
    assert.equal(foreign.statusCode, 403, `${action} from another Origin`);
    const rebound = await s.send("POST", action, { host: `evil.example:${port}` }, body);
    assert.equal(rebound.statusCode, 403, `${action} for another Host`);
  }
  assert.equal(s.on().pairing.view().state, "none", "a refused start showed a code");
  const view = await s.send("GET", "/pairing", { host: "evil.example" });
  assert.equal(view.statusCode, 403);
});

test("the pairing states render, from the QR code to paired, with no secret as text", async (t) => {
  const s = await serve(t);
  const created = await s.post("/home");
  assert.match(created.page, /<h2>Phones<\/h2><p>No phones are paired yet\.<\/p>/);
  assert.match(created.page, /<button>Pair a phone<\/button>/);
  const port = s.on().port;
  assert.ok(created.page.includes(`Phones reach this laptop at 127.0.0.1:${port}.`));
  assert.match((await s.get("/pairing")).page, /No code is showing\./);

  const started = await s.post("/pairing/start");
  assert.deepEqual([started.statusCode, started.headers.location], [303, "/pairing"]);
  const showing = (await s.get("/pairing")).page;
  const qr = s.qr();
  assert.ok(showing.includes(QR_SVG) && reloads(showing), showing);
  assert.ok(showing.includes(`Phones reach this laptop at 127.0.0.1:${port}.`));
  assert.match(showing, /choose Allow/);
  assert.ok(!showing.includes(qr.secret), "the QR secret is on the page as text");

  const phone = new FakePhone(qr, { name: "Sam's <script>alert(1)</script> iPhone" });
  assert.equal((await s.pair(phone)).status, 202);
  const pending = (await s.get("/pairing")).page;
  assert.ok(!reloads(pending), "the page reloads while a phone waits for Confirm");
  assert.ok(pending.includes(`<h2>${phone.code()}</h2>`), "the code differs from the phone's");
  assert.ok(pending.includes("Sam&#39;s &#60;script&#62;alert(1)&#60;/script&#62; iPhone"));
  assert.ok(!pending.includes("<script>"), "the name is not escaped");
  assert.match(pending, /wants to pair as a caregiver/);

  const wrong = await s.post("/pairing/confirm", { pending_id: "not-the-id" });
  assert.equal(wrong.statusCode, 303);
  assert.match((await s.get("/pairing")).page, /No phone is waiting for this Confirm\./);
  await s.post("/pairing/confirm", { pending_id: pendingIdOf(pending) });
  const waiting = (await s.get("/pairing")).page;
  assert.ok(reloads(waiting) && waiting.includes("Waiting for Sam&#39;s"), waiting);

  const collected = await s.pair(phone);
  assert.equal(collected.status, 200);
  const paired = (await s.get("/pairing")).page;
  assert.match(paired, /iPhone is paired as a caregiver\./);
  assert.match(paired, /Remote access isn&#39;t set up yet, so this phone reaches home only/);
  assert.match(paired, /<button>Pair another phone<\/button>/);

  const home = (await s.get("/")).page;
  assert.match(home, /iPhone, caregiver, paired \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/);
  const bundle = phone.openBundle(collected.body.bundle ?? missing(), "") as {
    device_credential?: string;
    home_key?: string;
  };
  const phonesFile = await readFile(path.join(s.stateDir, settings.STATE_NAMES.phones), "utf8");
  const stored = (
    JSON.parse(phonesFile) as { phones: { phone_key?: string; credential_sha256?: string }[] }
  ).phones[0];
  const secrets = [
    qr.secret,
    bundle.device_credential,
    bundle.home_key,
    stored?.phone_key,
    stored?.credential_sha256,
  ];
  for (const page of [showing, pending, waiting, paired, home]) {
    for (const secret of secrets) assert.ok(secret && !page.includes(secret), "a secret shows");
  }
  // Another code can be shown once the phone has its keys.
  assert.equal((await s.post("/pairing/start")).statusCode, 303);
  assert.ok((await s.get("/pairing")).page.includes(QR_SVG));
});

test("Cancel, Remove and a resident's pairing", async (t) => {
  const s = await serve(t);
  await s.post("/home");
  await s.post("/pairing/start");
  await s.post("/pairing/cancel");
  assert.match((await s.get("/pairing")).page, /Pairing was cancelled\./);
  await s.post("/pairing/start");
  const phone = new FakePhone(s.qr(), { name: "Gran's iPhone", role: "resident" });
  await s.pair(phone);
  assert.match((await s.get("/pairing")).page, /wants to pair as a resident/);
  await s.post("/pairing/start"); // refused while a phone waits
  assert.match((await s.get("/pairing")).page, /A phone is waiting for Confirm\./);
  await s.post("/pairing/confirm", { pending_id: pendingIdOf((await s.get("/pairing")).page) });
  await s.pair(phone);
  assert.match((await s.get("/pairing")).page, /is paired as a resident\./);
  const [listed] = s.on().phones.list();
  assert.ok(listed !== undefined);
  const removed = await s.post("/phones/remove", { device_id: listed.deviceId });
  assert.deepEqual([removed.statusCode, removed.headers.location], [303, "/"]);
  assert.match((await s.get("/")).page, /No phones are paired yet\./);
  assert.equal(s.on().phones.lookup(listed.deviceId).state, "removed");
});

test("the states a page reload can't reach render too: expired, uncollected, saving", () => {
  const body = (view: Parameters<typeof pairingBody>[0]) => pairingBody(view, undefined, "t").body;
  assert.match(body({ state: "expired" }).text, /This code expired\./);
  const phone = { deviceId: "d", name: "Sam <b>", role: "caregiver" } as const;
  const lost = body({ state: "confirmed", phone, collected: false, collecting: false }).text;
  assert.match(lost, /Sam &#60;b&#62; didn't collect its keys\./);
  const pendingPhone = { pendingId: "p", name: "Sam", role: "resident", code: "0042" } as const;
  const expiresAt = "2026-11-14T15:20:00Z";
  const saving = pairingBody(
    { state: "pending", expiresAt, phone: pendingPhone, confirming: true },
    undefined,
    "t",
  );
  assert.equal(saving.reload, settings.PAIRING_PAGE_RELOAD_SECONDS);
});

test("a paired phone is told it reaches home only on Wi-Fi only while there is no relay_url", () => {
  const phone = { deviceId: "d", name: "Sam", role: "caregiver" } as const;
  const view = { state: "confirmed", phone, collected: true, collecting: false } as const;
  const remote = /Remote access isn&#39;t set up yet/;
  assert.match(pairingBody(view, undefined, "t").body.text, remote);
  const withRelay = pairingBody(view, undefined, "t", "https://relay.example.com").body.text;
  assert.doesNotMatch(withRelay, remote);
  assert.match(withRelay, /Sam is paired as a caregiver\./);
});

test("why pairing is unavailable: no home, no network, a port in use, an unreadable list", async (t) => {
  const none = await serve(t);
  assert.match((await none.get("/pairing")).page, /isn't available: there is no home yet/);

  const offline = await serve(t, { addresses: () => [] });
  assert.match((await offline.post("/home")).page, /This laptop isn&#39;t connected to a network/);
  await offline.post("/pairing/start");
  assert.match((await offline.get("/pairing")).page, /isn&#39;t connected to a network\. Connect/);

  const blocker = createServer().listen(0, "0.0.0.0");
  await once(blocker, "listening");
  const address = blocker.address();
  const busyPort = typeof address === "object" && address !== null ? address.port : 0;
  const busy = await serve(t, { port: busyPort });
  const busyHome = (await busy.post("/home")).page;
  assert.ok(busyHome.includes(`port ${busyPort} is in use by another program`), busyHome);
  assert.match((await busy.get("/pairing")).page, /in use by another program/);
  blocker.close();
  await once(blocker, "close");
  await busy.post("/pairing/start"); // Pair a phone tries the port again
  assert.equal(busy.access()?.state().on, true);
  assert.ok((await busy.get("/pairing")).page.includes(QR_SVG));

  const broken = await serve(t);
  const phonesFile = path.join(broken.stateDir, settings.STATE_NAMES.phones);
  await writeFile(phonesFile, "{", "utf8");
  const brokenHome = (await broken.post("/home")).page;
  assert.ok(brokenHome.includes(`the phone list can&#39;t be read: ${phonesFile}`), brokenHome);
  assert.equal(await readFile(phonesFile, "utf8"), "{", "the phone list was overwritten");
});
