import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { WebSocket } from "ws";
import { credentialHash, toBase64url } from "../bridge/src/phone-crypto.ts";
import { HUB_PATH } from "../bridge/src/relay-protocol.ts";
import { HUB_CREDENTIAL_BYTES, RELAY_STOP_DEADLINE_MS } from "../bridge/src/settings.ts";
import { parseRelayConfig, type RelayConfig } from "../relay/src/config.ts";
import { RelayStartError, startRelay } from "../relay/src/main.ts";
import { RelayStore } from "../relay/src/store.ts";
import { freePort, waitFor } from "./coordinator-fixtures.ts";
import { FakeApns, writeTestKeys } from "./fake-apns.ts";
import { layer1 } from "./layer1-files.ts";
import { configJson, homeKey, hubWrapper, TestPhone, tempDir } from "./relay-fixtures.ts";

const MAIN = path.join(layer1, "relay", "src", "main.ts");
/** How long a test waits for the relay to start, a frame, or the relay to stop. */
const WAIT_MS = 10_000;

/** A relay.json in `dir` on a free port, without an apns block unless `overrides` gives one. */
async function relayJson(dir: string, overrides: Record<string, unknown> = {}) {
  const port = await freePort();
  const json = configJson(dir, {
    listen_port: port,
    public_url: `http://127.0.0.1:${port}`,
    apns: undefined,
    ...overrides,
  });
  const file = path.join(dir, "relay.json");
  await writeFile(file, JSON.stringify(json), "utf8");
  return { file, config: parseRelayConfig(JSON.parse(JSON.stringify(json)), file), port };
}

/** One home with a hub credential and `phones`, written to the relay's database before it starts. */
function seedHome(config: RelayConfig, phones: readonly TestPhone[]) {
  const store = RelayStore.open(config.database_file);
  const homeId = `home-${randomBytes(4).toString("hex")}`;
  const hubCredential = toBase64url(randomBytes(HUB_CREDENTIAL_BYTES));
  store.createHome(homeId, credentialHash(hubCredential), Date.now());
  store.syncDevices(
    homeId,
    phones.map((phone) => phone.entry()),
    Date.now(),
  );
  return { store, homeId, hubCredential };
}

/** GET `route` as `phone`, with a 5-second limit: the status and the JSON body. */
async function get(url: string, route: string, phone: TestPhone) {
  const response = await fetch(`${url}${route}`, {
    headers: phone.headers(),
    signal: AbortSignal.timeout(5_000),
  });
  const body: unknown = await response.json();
  return { status: response.status, body };
}

/** A frame from the relay, with the fields these tests read. */
type Frame = Readonly<{ type?: unknown; msg_id?: unknown; home_id?: unknown }>;

/** A hub on a real WebSocket to the relay: the frames it got, and its close code. */
async function connectHub(port: number, credential: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${HUB_PATH}`, {
    headers: { Authorization: `Bearer ${credential}` },
    handshakeTimeout: WAIT_MS,
  });
  const frames: Frame[] = [];
  ws.on("message", (data) => frames.push({ ...JSON.parse(data.toString()) }));
  const closed = new Promise<number>((resolve) => ws.once("close", (code) => resolve(code)));
  await once(ws, "open");
  const frame = async (type: string): Promise<Frame> => {
    await waitFor(() => frames.some((found) => found.type === type), WAIT_MS);
    const found = frames.find((candidate) => candidate.type === type);
    if (found === undefined) throw new Error(`no ${type} frame`);
    return found;
  };
  return { ws, frames, closed, frame };
}

describe("relay main", () => {
  test("as a child process: phones sign in and fetch, a hub delivers, and the stop file stops it", async (t) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "l1-relay-main-"));
    const { file, config, port } = await relayJson(dir);
    const phone = new TestPhone();
    const seeded = seedHome(config, [phone]);
    // As if the last run ended without recording the hub's disconnection.
    seeded.store.setHubConnected(seeded.homeId, true);
    seeded.store.close();
    const { homeId, hubCredential } = seeded;

    const child = spawn(process.execPath, [MAIN, "--config", file], {
      cwd: layer1,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const exited = once(child, "exit");
    // One hook, so the folder outlives the child: a failed test still stops it by its stop file.
    t.after(async () => {
      if (child.exitCode === null) {
        await writeFile(config.stop_file, "", "utf8");
        await exited;
      }
      await rm(dir, { recursive: true, force: true });
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    await waitFor(() => output.includes("L1 relay: listening on"), WAIT_MS);
    assert.ok(output.includes(`listening on http://127.0.0.1:${port}`), output);
    assert.ok(output.includes("no apns block in relay.json"), "missing push setup is reported");

    const url = `http://127.0.0.1:${port}`;
    const before = await get(url, "/v1/home", phone);
    assert.equal(before.status, 200);
    assert.deepEqual((before.body as { hub: { online: boolean } }).hub.online, false);

    const hub = await connectHub(port, hubCredential);
    assert.equal((await hub.frame("welcome")).home_id, homeId);
    const key = homeKey();
    const wrapper = hubWrapper({ homeId, type: "alert", key, fields: { title: "Fall" } });
    hub.ws.send(JSON.stringify({ type: "deliver", v: 1, wrapper }));
    assert.equal((await hub.frame("ack")).msg_id, wrapper.msg_id);

    const home = await get(url, "/v1/home", phone);
    assert.equal((home.body as { hub: { online: boolean } }).hub.online, true);
    const page = await get(url, "/v1/messages", phone);
    assert.equal(page.status, 200);
    const [fetched] = (page.body as { messages: (typeof wrapper)[] }).messages;
    assert.ok(fetched !== undefined);
    assert.equal(fetched.msg_id, wrapper.msg_id);
    const { title } = phone.open(fetched, homeId, key);
    assert.equal(title, "Fall");

    const started = Date.now();
    await writeFile(config.stop_file, "", "utf8");
    await waitFor(() => child.exitCode !== null, RELAY_STOP_DEADLINE_MS);
    assert.equal(child.exitCode, 0, output);
    assert.ok(Date.now() - started < RELAY_STOP_DEADLINE_MS);
    assert.equal(await hub.closed, 1001);
    assert.equal(existsSync(config.stop_file), false, "the stop file is removed");
    assert.ok(output.includes("L1 relay: stopped"), output);
    for (const secret of [hubCredential, phone.credential]) {
      assert.equal(output.includes(secret), false, "no credential reaches the log");
    }
    const after = RelayStore.open(config.database_file);
    t.after(() => after.close());
    assert.equal(after.home(homeId)?.hubConnected, false);
  });

  test("pushes: the restart re-push, back online on the hub's contact, and a new alert", async (t) => {
    const dir = await tempDir(t);
    const fake = await FakeApns.start(t);
    const withKeys = configJson(dir);
    const { config } = await relayJson(dir, { apns: withKeys.apns });
    if (config.apns === undefined) throw new Error("the test config has no apns block");
    await writeTestKeys(config.apns);
    const phone = new TestPhone();
    const { store, homeId, hubCredential } = seedHome(config, [phone]);
    store.setPushToken(phone.deviceId, "production", randomBytes(32).toString("hex"), Date.now());
    store.recordContact(homeId, Date.now() - 600_000);
    store.setOfflineNotified(homeId, Date.now() - 400_000);
    const key = homeKey();
    const cutOff = hubWrapper({ homeId, type: "alert", key });
    store.storeMessage(homeId, cutOff, Date.now());
    store.close();

    const logs: string[] = [];
    const relay = await startRelay(config, {
      log: (line) => logs.push(line),
      apnsOrigins: fake.origins(),
      apnsTls: fake.tls(),
    });
    t.after(() => relay.stop("test over"));
    await waitFor(() => fake.requests.length === 1, WAIT_MS);
    assert.ok(fake.requests[0]?.body.includes(cutOff.msg_id), "the cut-off alert is pushed");

    const hub = await connectHub(config.listen_port, hubCredential);
    await hub.frame("welcome");
    await waitFor(() => fake.requests.length === 2, WAIT_MS);
    assert.ok(fake.requests[1]?.body.includes('"back_online"'), "back online is pushed");

    const fresh = hubWrapper({ homeId, type: "alert", key });
    hub.ws.send(JSON.stringify({ type: "deliver", v: 1, wrapper: fresh }));
    await hub.frame("ack");
    await waitFor(() => fake.requests.length === 3, WAIT_MS);
    assert.ok(fake.requests[2]?.body.includes(fresh.msg_id), "the new alert is pushed");

    await writeFile(config.stop_file, "", "utf8");
    await relay.stopped;
    assert.equal(await hub.closed, 1001);
    assert.ok(logs.includes("L1 relay: stopped"));
  });

  test("listens on 127.0.0.1, and a busy port is refused with a message naming it", async (t) => {
    const dir = await tempDir(t);
    const { config, port } = await relayJson(dir);
    const busy = createServer().listen(port, "127.0.0.1");
    await once(busy, "listening");
    t.after(() => busy.close());
    await assert.rejects(
      startRelay(config, { log: () => undefined }),
      (error: unknown) => error instanceof RelayStartError && error.message.includes(String(port)),
    );
    busy.close();
    await once(busy, "close");

    const relay = await startRelay(config, { log: () => undefined });
    assert.equal(relay.url, `http://127.0.0.1:${port}`);
    await relay.stop("test over");
  });

  test("npm run relay starts relay/src/main.ts", async () => {
    const pkg: unknown = JSON.parse(await readFile(path.join(layer1, "package.json"), "utf8"));
    assert.equal((pkg as { scripts: { relay: string } }).scripts.relay, "node relay/src/main.ts");
  });
});
