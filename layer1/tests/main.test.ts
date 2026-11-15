import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { pathToFileURL } from "node:url";
import { createHome, readHomeSecrets } from "../bridge/src/home.ts";
import { startBridge } from "../bridge/src/main.ts";
import * as settings from "../bridge/src/settings.ts";
import type { Wrapper } from "../bridge/src/wire.ts";
import { freePort, makeTempDir, STUB, waitFor } from "./coordinator-fixtures.ts";
import { openHomeWrapper } from "./home-reader.ts";

const MAIN = path.join(import.meta.dirname, "..", "bridge", "src", "main.ts");

/** How long a child bridge may take to stop once its stop file appears. */
const STOP_WAIT_MS = 15_000;

/** What the child runs: startBridge on a free port, with an opener that prints what it opens. */
const RUN_BRIDGE = `const { startBridge } = await import(process.argv[1]);
const [stateDir, repoRoot] = process.argv.slice(2);
const open = async (url) => console.log("opened " + url);
await startBridge({ stateDir, repoRoot, port: 0, open });`;

/** Asks a bridge to stop the way a script or another program does: through its stop file. */
const writeStopFile = (stateDir: string) =>
  writeFile(path.join(stateDir, settings.STATE_NAMES.bridgeStop), "", "utf8");

/** The bridge in a child process, once it has opened its page; its coordinator is the stub. */
async function runBridge(t: TestContext, prepare: (stateDir: string) => Promise<unknown>) {
  const [repoRoot, stateDir] = [await makeTempDir(), await makeTempDir()];
  const stub = path.join(repoRoot, ...settings.COORDINATOR_STUB_PATH);
  await mkdir(path.dirname(stub), { recursive: true });
  await copyFile(STUB, stub);
  await prepare(stateDir);
  const script = [RUN_BRIDGE, pathToFileURL(MAIN).href, stateDir, repoRoot];
  const child = spawn(process.execPath, ["--input-type=module", "-e", ...script], {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000, // the backstop if a failed test leaves it running
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
    });
  }
  let running = true;
  const exited = once(child, "exit").finally(() => {
    running = false;
  });
  t.after(async () => {
    const failed = running; // a failed test leaves it running
    if (failed) await writeStopFile(stateDir);
    const [code] = await exited;
    if ((failed || code !== 0) && output.includes("ready on")) {
      // A stub that a failed run left running ends only once it finds its stop file.
      const stopFile = path.join(stateDir, settings.STATE_NAMES.coordinatorStop);
      await writeFile(stopFile, "", "utf8");
      await waitFor(() => !existsSync(stopFile), STOP_WAIT_MS).catch((error: unknown) => {
        console.error(`L1 test: the stub has not taken its stop file: ${String(error)}`);
      });
    }
    for (const dir of [repoRoot, stateDir]) await rm(dir, { recursive: true, force: true });
  });
  await waitFor(() => output.includes("opened "), STOP_WAIT_MS);
  const url = /the setup page is at (\S+)/.exec(output)?.[1] ?? "no address printed";
  return { child, stateDir, url, output: () => output, exited, running: () => running };
}

/** Fails if the bridge has not exited `ms` after its stop file appeared. */
async function exitWithin(bridge: Awaited<ReturnType<typeof runBridge>>, ms = STOP_WAIT_MS) {
  await waitFor(() => !bridge.running(), ms);
  return bridge.exited;
}

test("a restarted bridge starts the home's stub and opens its page; its stop file stops both", async (t) => {
  const { COORDINATOR_LISTEN_PORT: listen, COORDINATOR_CLIENT_PORT: client } = settings;
  const dashboard = await freePort();
  const ports = { listen, dashboard, client };
  const bridge = await runBridge(t, (dir) => createHome(dir, { ports }));
  assert.ok(bridge.output().includes(`opened ${bridge.url}\n`), bridge.output());
  await waitFor(() => bridge.output().includes("STUB layer2-coordinator: ready on"));
  // The terminal closes, as when its window does: from now on every write fails.
  bridge.child.stdout.destroy();
  bridge.child.stderr.destroy();
  await writeStopFile(bridge.stateDir);
  assert.deepEqual(await exitWithin(bridge), [0, null]);
  const stopFile = path.join(bridge.stateDir, settings.STATE_NAMES.bridgeStop);
  assert.equal(existsSync(stopFile), false, "the bridge left its stop file");
  const stub = fetch(`http://127.0.0.1:${dashboard}/`, { signal: AbortSignal.timeout(2_000) });
  await assert.rejects(stub, "the stub still runs");
});

test("with unreadable home files the page still answers, and the stop file stops it", async (t) => {
  const homeFile = (dir: string) => path.join(dir, settings.STATE_NAMES.home);
  const bridge = await runBridge(t, (dir) => writeFile(homeFile(dir), "{", "utf8"));
  const reply = await fetch(bridge.url, { signal: AbortSignal.timeout(2_000) });
  const problem = "home files unreadable: ";
  assert.ok((await reply.text()).includes(problem), "the page does not show the problem");
  assert.ok(bridge.output().includes(`L1 bridge: ${problem}`), bridge.output());
  await writeStopFile(bridge.stateDir);
  assert.deepEqual(await exitWithin(bridge), [0, null]);
  assert.ok(bridge.output().includes("L1 bridge: bridge.stop found; stopping\n"), bridge.output());
});

/** The bridge in this process, with no home; its lines are collected. */
async function bridgeInProcess(t: TestContext) {
  const [repoRoot, stateDir] = [await makeTempDir(), await makeTempDir()];
  t.after(() => Promise.all([repoRoot, stateDir].map((dir) => rm(dir, { recursive: true }))));
  const lines: string[] = [];
  const opened: string[] = [];
  const open = async (url: string) => {
    opened.push(url);
  };
  const bridge = await startBridge({
    stateDir,
    repoRoot,
    port: 0,
    open,
    log: (line) => lines.push(line),
  });
  t.after(() => bridge.stop("the test ended"));
  return { bridge, stateDir, lines, opened };
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  test(`${signal}'s handler closes the page and removes the bridge's handlers`, async (t) => {
    const before = process.listeners(signal);
    const { bridge, lines, opened } = await bridgeInProcess(t);
    assert.deepEqual(opened, [bridge.url]);
    const added = process.listeners(signal).filter((listener) => !before.includes(listener));
    assert.equal(added.length, 1, `the bridge has no ${signal} handler`);
    // The handler itself is called, as Node calls it on the signal; no signal is sent.
    added[0]?.(signal);
    await bridge.stop("asked again"); // the shutdown the handler started, not a second one
    assert.deepEqual(process.listeners(signal), before, "the bridge left its handler");
    assert.deepEqual(
      lines.filter((line) => line.endsWith("stopping")),
      [`L1 bridge: ${signal} received; stopping`],
    );
    const page = fetch(bridge.url, { signal: AbortSignal.timeout(2_000) });
    await assert.rejects(page, "the page still answers");
  });
}

test("a stop file left from an earlier run is removed and does not stop the bridge", async (t) => {
  const stateDir = await makeTempDir();
  await writeStopFile(stateDir);
  const repoRoot = await makeTempDir();
  t.after(() => Promise.all([repoRoot, stateDir].map((dir) => rm(dir, { recursive: true }))));
  const lines: string[] = [];
  const open = async () => undefined;
  const bridge = await startBridge({
    stateDir,
    repoRoot,
    port: 0,
    open,
    log: (line) => lines.push(line),
  });
  t.after(() => bridge.stop("the test ended"));
  assert.equal(existsSync(bridge.stopFile), false, "the old stop file is still there");
  await new Promise((resolve) => setTimeout(resolve, settings.BRIDGE_STOP_POLL_MS * 2));
  const reply = await fetch(bridge.url, { signal: AbortSignal.timeout(2_000) });
  assert.equal(reply.status, 200);
  assert.deepEqual(
    lines.filter((line) => line.endsWith("stopping")),
    [],
  );
});

test("the bridge exits 1 with a clear message when it cannot run", () => {
  const options = { encoding: "utf8", timeout: 10_000 } as const;
  const run = spawnSync(process.execPath, [MAIN, "--state-dir", "relative"], options);
  const why = "the state folder must be an absolute path: pass --state-dir <folder>";
  assert.deepEqual([run.status, run.stdout, run.stderr], [1, "", `L1 bridge: ${why}\n`]);
});

test("the coordinator's bridge queues a monitoring snapshot for caregivers from Layer 2's /api/state", async (t) => {
  const [repoRoot, stateDir] = [await makeTempDir(), await makeTempDir()];
  const stub = path.join(repoRoot, ...settings.COORDINATOR_STUB_PATH);
  await mkdir(path.dirname(stub), { recursive: true });
  await copyFile(STUB, stub);
  t.after(() => Promise.all([repoRoot, stateDir].map((dir) => rm(dir, { recursive: true }))));
  const { COORDINATOR_LISTEN_PORT: listen, COORDINATOR_CLIENT_PORT: client } = settings;
  const home = await createHome(stateDir, {
    ports: { listen, dashboard: await freePort(), client },
  });
  const body = {
    schema_version: 1,
    updated_at: new Date().toISOString(),
    laptops: [
      {
        node_id: "node-a",
        display_name: "Kitchen laptop",
        last_status_at: new Date().toISOString(),
        sensors: ["camera", "mic"],
        missing: [],
      },
    ],
    jobs: [
      { job: "capture", node_id: "node-a", state: "running" },
      { job: "fall_model", node_id: "node-a", state: "running" },
    ],
    dropped: [],
  };
  const bridge = await startBridge({
    stateDir,
    repoRoot,
    port: 0,
    open: async () => undefined,
    log: () => undefined,
    network: { port: 0, addresses: (port) => [`127.0.0.1:${port}`] },
    monitoring: {
      readState: async () => ({ ok: true, body }),
      languageModel: async () => true,
    },
  });
  t.after(() => bridge.stop("the test ended"));
  const outboxFile = path.join(stateDir, settings.OUTBOX_FILE_NAME);
  const queued = (): Wrapper[] => {
    if (!existsSync(outboxFile)) return [];
    const saved = JSON.parse(readFileSync(outboxFile, "utf8")) as {
      messages: { wrapper: Wrapper }[];
    };
    return saved.messages.map((entry) => entry.wrapper).filter((w) => w.type === "monitoring");
  };
  let found: Wrapper[] = [];
  await waitFor(() => {
    found = queued();
    return found.length > 0;
  }, STOP_WAIT_MS);
  const [wrapper] = found;
  assert.ok(wrapper !== undefined);
  const { homeKey } = await readHomeSecrets(stateDir);
  const plaintext = openHomeWrapper(wrapper, homeKey, home.homeId);
  const { state, camera, mic, fall_detection: fall, sound_detection: sound } = plaintext;
  assert.deepEqual([state, camera, mic, fall, sound], ["ok", "up", "up", "running", "unplaced"]);
});
