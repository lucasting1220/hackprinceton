import assert from "node:assert/strict";
import { createSecretKey, randomBytes } from "node:crypto";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { acceptedWorkers, addAcceptedWorker, createHome } from "../bridge/src/home.ts";
import { readWorkerStatus, workerFiles } from "../bridge/src/laptop.ts";
import type { LinkReport } from "../bridge/src/link.ts";
import type { BrowserProcess } from "../bridge/src/live-sender.ts";
import { startBridge } from "../bridge/src/main.ts";
import { tokenSha256 } from "../bridge/src/phone-crypto.ts";
import { utcSeconds } from "../bridge/src/wire.ts";
import * as settings from "../bridge/src/settings.ts";
import { freePort, makeTempDir, STUB, waitFor } from "./coordinator-fixtures.ts";
import { phoneWrapper } from "./fake-phone.ts";
import { pageClient } from "./page-client.ts";

/** The QR code's own SVG; the sidebar's icons are SVGs too. */
const QR_SVG = `<svg width="${settings.QR_DISPLAY_PX}"`;

const WORKER_STUB = path.join(import.meta.dirname, "..", "..", ...settings.WORKER_STUB_PATH);
const STOP_WAIT_MS = 15_000;
const contract = (name: string) => path.join(import.meta.dirname, "..", "..", "contracts", name);

/** The page's text with the escapes html.ts makes undone. */
const unescaped = (text: string) =>
  text.replace(/&#(\d+);/g, (_, digits: string) => String.fromCharCode(Number(digits)));

/** A JSON POST to a bridge's network side, as the app sends it. */
async function postJson(port: number, target: string, body: unknown) {
  const response = await fetch(`http://127.0.0.1:${port}${target}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });
  return { status: response.status, body: (await response.json()) as unknown };
}

/** The page at `target` once it holds `text`; fails after 5 seconds with the last page. */
async function pageWith(client: ReturnType<typeof pageClient>, target: string, text: string) {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const { page } = await client.get(target);
    if (page.includes(text)) return page;
    if (Date.now() > deadline) assert.fail(`${target} never showed ${text}: ${page}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** A bridge in this process on free ports, whose lines are its own; stopped through its stop file. */
/** Each running bridge's stop, which the test's cleanup calls before it removes the folders. */
const running: (() => Promise<void>)[] = [];

async function bridgeIn(stateDir: string, repoRoot: string, extra: object = {}) {
  const lines: string[] = [];
  const bridge = await startBridge({
    stateDir,
    repoRoot,
    port: 0,
    open: async () => undefined,
    log: (line) => lines.push(line),
    network: { port: 0, addresses: (port) => [`127.0.0.1:${port}`] },
    laptop: { findPython: async () => process.execPath, joinPollMs: 50, linkReportMs: 100 },
    ...extra,
  });
  let stopped = false;
  const stopThroughFile = async () => {
    if (stopped) return;
    stopped = true;
    await writeFile(bridge.stopFile, "", "utf8");
    await waitFor(() => lines.includes("L1 bridge: stopped"), STOP_WAIT_MS);
  };
  running.push(stopThroughFile);
  return { bridge, lines, page: pageClient(bridge.url), stopThroughFile };
}

test("a laptop joins: Join a home, a caregiver's approval over the LAN gateway, the worker, the link", async (t) => {
  const [repoRoot, homeDir, laptopDir] = [
    await makeTempDir(),
    await makeTempDir(),
    await makeTempDir(),
  ];
  t.after(async () => {
    for (const stop of running.splice(0)) await stop();
    for (const dir of [repoRoot, homeDir, laptopDir])
      await rm(dir, { recursive: true, force: true });
  });
  for (const [from, to] of [
    [STUB, settings.COORDINATOR_STUB_PATH],
    [WORKER_STUB, settings.WORKER_STUB_PATH],
  ] as const) {
    const target = path.join(repoRoot, ...to);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(from, target);
  }
  const { COORDINATOR_LISTEN_PORT: listen, COORDINATOR_CLIENT_PORT: client } = settings;
  const home = await createHome(homeDir, {
    ports: { listen, dashboard: await freePort(), client },
  });
  const hub = await bridgeIn(homeDir, repoRoot);
  const state = hub.bridge.phones()?.state();
  assert.ok(state?.on === true, "the home laptop's network side is off");
  const phoneKey = createSecretKey(randomBytes(32));
  const deviceId = "caregiver-phone";
  await state.phones.add({
    deviceId,
    name: "Caregiver's iPhone",
    role: "caregiver",
    phoneKey,
    credentialSha256: tokenSha256("credential"),
  });
  const homePage = await hub.page.get("/");
  const homeCode = home.hubPublicKey.slice(0, settings.HUB_TAG_CHARS);
  assert.ok(homePage.page.includes(`127.0.0.1:${state.port}`), "the address isn't on the page");
  assert.ok(homePage.page.includes(`Home code: <strong>${homeCode}</strong>`));

  // The new laptop: Join a home with the address the home laptop's page shows. Its sender window
  // is a fake browser that records its start and kill, and can close by itself.
  const browsers: Array<{ args: readonly string[]; killed: boolean; exit: () => void }> = [];
  const spawn = (_file: string, args: readonly string[]): BrowserProcess => {
    let exit: (how: string) => void = () => undefined;
    const exited = new Promise<string>((resolve) => {
      exit = resolve;
    });
    const browser = { args, killed: false, exit: () => exit("it ended with 0") };
    browsers.push(browser);
    const kill = () => {
      browser.killed = true;
      exit("killed");
    };
    return { kill, exited };
  };
  const liveSender = { spawn, findBrowser: () => "/fake/chrome" };
  const laptop = await bridgeIn(laptopDir, repoRoot, { liveSender });
  assert.match((await laptop.page.get("/")).page, /<a href="\/join">Join a home<\/a>/);
  const address = `127.0.0.1:${state.port}`;
  const started = await laptop.page.post("/join/start", { address, name: "Kitchen laptop" });
  assert.equal(started.statusCode, 303);
  const waiting = await pageWith(laptop.page, "/join", QR_SVG);
  assert.ok(waiting.includes(`Home code: <strong>${homeCode}</strong>`), waiting);
  const text = /<pre>([^<]+)<\/pre>/.exec(waiting)?.[1] ?? "{}";
  const qr = JSON.parse(unescaped(text)) as Record<string, unknown>;
  assert.deepEqual(Object.keys(qr), [
    "v",
    "kind",
    "join_id",
    "name",
    "laptop_pub",
    "exp",
    "hub_pub",
  ]);
  const { exp, hub_pub: hubPub, kind } = qr;
  assert.ok(Number.isInteger(exp) && hubPub === home.hubPublicKey && kind === "join");
  assert.match((await hub.page.get("/")).page, /Kitchen laptop: waiting for a caregiver/);

  // The role lock: neither laptop can take the other role now.
  assert.equal((await laptop.page.post("/home")).statusCode, 409);
  const other = { address, name: "Second laptop" };
  assert.equal((await hub.page.post("/join/start", other)).statusCode, 409);

  // The caregiver scans the code and approves, over home Wi-Fi.
  const { join_id, laptop_pub, name } = qr;
  const approval = phoneWrapper(phoneKey, {
    homeId: home.homeId,
    deviceId,
    type: "laptop_approval",
    fields: { join_id, laptop_pub, name, approve: true },
  });
  const approved = await postJson(state.port, "/v1/lan/commands", approval);
  assert.deepEqual(approved, { status: 202, body: { v: 1, accepted: true } });

  // The new laptop writes its files, runs check, starts the worker and shows Joined.
  const files = workerFiles(laptopDir);
  const joined = await pageWith(laptop.page, "/", "<p>Joined</p>");
  assert.ok(!joined.includes("Pair a phone"), "a worker offers Pair a phone");
  const token = await readFile(files.token, "utf8");
  assert.match(token, /^[0-9a-f]{64}$/);
  if (process.platform !== "win32") assert.equal((await stat(files.token)).mode & 0o777, 0o600);
  const [worker] = await acceptedWorkers(home);
  assert.deepEqual(worker?.token_sha256, tokenSha256(token));
  assert.equal(worker?.display_name, "Kitchen laptop");
  const written = JSON.parse(await readFile(files.config, "utf8")) as Record<string, unknown>;
  const example = JSON.parse(await readFile(contract("worker.json"), "utf8")) as Record<
    string,
    unknown
  >;
  assert.deepEqual(Object.keys(written).sort(), Object.keys(example).sort());
  for (const [field, value] of Object.entries(example)) {
    const sensor = field === "camera" || field === "mic";
    if (sensor) assert.equal(written[field], null, `${field} stays null until the page names it`);
    else assert.equal(typeof written[field], typeof value, field);
    if (field === "python" || field.endsWith("_file") || field.endsWith("_dir")) {
      assert.ok(path.isAbsolute(String(written[field])), `${field} is not absolute`);
    }
  }
  const { coordinator_url: url, node_id: writtenNode, home_id: writtenHome } = written;
  assert.equal(url, `ws://127.0.0.1:${listen}/ws`);
  assert.equal(writtenNode, worker?.node_id);
  assert.equal(writtenHome, home.homeId);
  const nodeId = String(worker?.node_id);

  // The link: the home laptop's page shows what the worker laptop reports.
  await waitFor(() => state.link.linked().get(nodeId)?.state === "connected", 5_000);
  const listedOnHub = `Kitchen laptop, node <code>${nodeId}</code>: connected`;
  assert.ok((await hub.page.get("/")).page.includes(listedOnHub));
  const hubDevices = (await hub.page.get("/devices")).page;
  const listed = `<span class="dot ok"></span><div class="device-text"><div>Kitchen laptop</div><div class="muted">node <code>${nodeId}</code>, connected`;
  assert.ok(hubDevices.includes(listed), hubDevices);
  const laptopDevices = (await laptop.page.get("/devices")).page;
  assert.ok(
    laptopDevices.includes(`<div>${address}</div><div class="muted">link: connected</div>`),
  );
  assert.ok(
    !laptopDevices.includes('id="nav-overview"') && !laptopDevices.includes(">Laptops</div>"),
    "a joined laptop links a dashboard it lacks",
  );

  // Live view over the link: the hub's queued live_view_open reaches this laptop on its next
  // report, which serves the sender page and opens the window; live_view_close kills it.
  const session = "6f1c2b9e-0c1d-4a55-9a36-9f2b6a4d7e10";
  const senderToken = randomBytes(32).toString("base64url");
  state.link.queue(nodeId, {
    type: "live_view_open",
    session_id: session,
    sender_token: senderToken,
    signaling_url: `wss://relay.example.com${settings.LIVE_VIEW_PATH}/${session}/signal`,
    expires_at: utcSeconds(new Date(Date.now() + 300_000)),
  });
  await waitFor(() => browsers.length === 1, 5_000);
  const senderUrl = new URL(settings.LIVE_SENDER_PATH, laptop.bridge.url).href;
  assert.equal(browsers[0]?.args[0], `--app=${senderUrl}`);
  const served = await fetch(senderUrl, { signal: AbortSignal.timeout(5_000) });
  assert.equal(served.status, 200);
  assert.match(await served.text(), new RegExp(session));
  state.link.queue(nodeId, { type: "live_view_close", session_id: session, reason: "stopped" });
  await waitFor(() => browsers[0]?.killed === true, 5_000);
  const gone = await fetch(senderUrl, { signal: AbortSignal.timeout(5_000) });
  await gone.body?.cancel();
  assert.equal(gone.status, 404);
  // A window that closes by itself reaches the hub as live_view_lost in the next report.
  const heard: LinkReport[] = [];
  state.link.onReport((reporter, report) => {
    if (reporter === nodeId && report.live_view_lost !== undefined) heard.push(report);
  });
  const second = "0b7a3c52-41d4-4a6e-9a6c-2f0e5d1c8b21";
  state.link.queue(nodeId, {
    type: "live_view_open",
    session_id: second,
    sender_token: senderToken,
    signaling_url: `wss://relay.example.com${settings.LIVE_VIEW_PATH}/${second}/signal`,
    expires_at: utcSeconds(new Date(Date.now() + 300_000)),
  });
  await waitFor(() => browsers.length === 2, 5_000);
  browsers[1]?.exit();
  await waitFor(() => heard.length === 1, 5_000);
  assert.equal(heard[0]?.live_view_lost, second);
  for (const line of [...hub.lines, ...laptop.lines]) assert.ok(!line.includes(senderToken), line);

  // A restarted bridge starts the worker again with the same node ID and token.
  await laptop.stopThroughFile();
  const stopped = await readWorkerStatus(files.status);
  assert.ok(stopped.ok && stopped.state === "disconnected", "the worker didn't stop");
  const again = await bridgeIn(laptopDir, repoRoot);
  await waitFor(() => again.lines.some((line) => line.includes(`connected as ${nodeId}`)), 5_000);
  assert.equal(await readFile(files.token, "utf8"), token);

  // Leave this home: the joined page offers it, a confirm page asks, and leaving stops the worker,
  // deletes the join's files and shows Join a home again.
  const rejoined = await pageWith(again.page, "/", "<p>Joined</p>");
  assert.match(rejoined, /<a href="\/join\/leave">Leave this home<\/a>/);
  const confirm = (await again.page.get("/join/leave")).page;
  assert.match(confirm, /<form method="post" action="\/join\/leave">/);
  assert.match(confirm, /<button>Leave this home<\/button>/);
  // Pressed on the confirm page, so with its token: the joined page "/" has no form of its own,
  // and keep-awake's form, which puts a token there, is only on where keep-awake runs (not Linux).
  const confirmToken = /name="token" value="([^"]+)"/.exec(confirm)?.[1] ?? "no token on the page";
  const leave = await again.page.post("/join/leave", { token: confirmToken });
  assert.equal(leave.statusCode, 303);
  await pageWith(again.page, "/join", 'action="/join/start"');
  for (const file of [files.laptop, files.config, files.token]) {
    await assert.rejects(stat(file), { code: "ENOENT" }, `${file} survived leaving`);
  }
  const left = await readWorkerStatus(files.status);
  assert.ok(left.ok && left.state === "none", "the status file survived leaving");
  // The home laptop was told: it no longer accepts the token or lists the laptop.
  assert.deepEqual(await acceptedWorkers(home), []);
  assert.equal(state.link.linked().has(nodeId), false);
  assert.ok(!(await hub.page.get("/")).page.includes(nodeId), "the home laptop still lists it");
  // Remove on the home laptop's page, for a laptop that can't leave by itself.
  const lost = { node_id: "lost-node", display_name: "Lost laptop", token_sha256: "0".repeat(64) };
  await addAcceptedWorker(home, lost);
  const listing = (await hub.page.get("/")).page;
  assert.ok(listing.includes("Lost laptop, node <code>lost-node</code>: not reporting"), listing);
  assert.match(listing, /action="\/laptops\/remove">.*name="node_id" value="lost-node"/);
  const removed = await hub.page.post("/laptops/remove", { node_id: "lost-node" });
  assert.equal(removed.statusCode, 303);
  assert.deepEqual(await acceptedWorkers(home), []);
  assert.ok(!(await hub.page.get("/")).page.includes("lost-node"), "Remove left it listed");
  assert.equal((await again.page.get("/join/leave")).statusCode, 303, "leave without a home");

  for (const line of [...hub.lines, ...laptop.lines, ...again.lines]) {
    assert.ok(!line.includes(token) && !line.includes(tokenSha256(token)), line);
    assert.ok(!line.includes("Kitchen laptop"), `a chosen name was logged: ${line}`);
  }
});
