import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { keepAwakeCommand } from "../bridge/src/keep-awake.ts";
import { type BridgeOptions, startBridge } from "../bridge/src/main.ts";
import * as settings from "../bridge/src/settings.ts";
import { makeTempDir, waitFor } from "./coordinator-fixtures.ts";

const STOP_WAIT_MS = 15_000;

test("caffeinate on macOS holds off idle sleep until the bridge's process exits", () => {
  assert.deepEqual(keepAwakeCommand("darwin", 4321), {
    file: "/usr/bin/caffeinate",
    args: ["-dis", "-w", "4321"],
    env: {},
  });
});

test("one hidden PowerShell child on Windows, with fixed text and the ID in its environment", () => {
  const command = keepAwakeCommand("win32", 4321);
  assert.ok(command !== undefined);
  assert.equal(command.file, "powershell.exe");
  assert.deepEqual(command.args.slice(0, -1), [
    "-NoProfile",
    "-NonInteractive",
    "-WindowStyle",
    "Hidden",
    "-EncodedCommand",
  ]);
  assert.deepEqual(command.env, { DEBBIE_BRIDGE_PID: "4321" });
  const script = Buffer.from(command.args.at(-1) ?? "", "base64").toString("utf16le");
  assert.match(script, /SetThreadExecutionState\(\[uint32\]2147483651\)/);
  assert.match(script, /Get-Process -Id \(\[int\]\$env:DEBBIE_BRIDGE_PID\)/);
  assert.match(script, /\$bridge\.WaitForExit\(\)$/);
  assert.equal(script.includes("4321"), false, "the process ID is placed in the script");
  const other = keepAwakeCommand("win32", 99);
  assert.equal(other?.args.at(-1), command.args.at(-1), "the script depends on the process ID");
});

test("no helper on other platforms, and no command for an invalid process ID", () => {
  assert.equal(keepAwakeCommand("linux", 4321), undefined);
  assert.equal(keepAwakeCommand("freebsd", 4321), undefined);
  assert.throws(() => keepAwakeCommand("darwin", 0), /not a process ID/);
  assert.throws(() => keepAwakeCommand("darwin", 1.5), /not a process ID/);
});

/** A bridge in this process with no home, stopped through its stop file once the test ends. */
async function bridgeInProcess(t: TestContext, keepAwake?: BridgeOptions["keepAwake"]) {
  const [repoRoot, stateDir] = [await makeTempDir(), await makeTempDir()];
  const lines: string[] = [];
  const bridge = await startBridge({
    stateDir,
    repoRoot,
    port: 0,
    open: async () => undefined,
    log: (line) => lines.push(line),
    ...(keepAwake === undefined ? {} : { keepAwake }),
  });
  const stopped = () => lines.includes("L1 bridge: stopped");
  const stopThroughFile = async () => {
    if (!stopped()) {
      await writeFile(bridge.stopFile, "", "utf8");
      await waitFor(stopped, STOP_WAIT_MS);
    }
  };
  t.after(async () => {
    await stopThroughFile();
    for (const dir of [repoRoot, stateDir]) await rm(dir, { recursive: true, force: true });
  });
  return { bridge, lines, stopThroughFile };
}

const page = async (url: string) => {
  const reply = await fetch(url, { signal: AbortSignal.timeout(2_000) });
  return { status: reply.status, body: await reply.text() };
};

test("a missing helper is reported once, on the page and in the log, and the bridge runs on", async (t) => {
  const missing = path.join(import.meta.dirname, "no-such-helper");
  const command = { file: missing, args: [], env: {} };
  const { bridge, lines, stopThroughFile } = await bridgeInProcess(t, { command });
  const problem = `cannot start ${missing}: not found; it may sleep and stop watching the home.`;
  const logged = lines.filter((line) => line.startsWith("L1 keep-awake: "));
  assert.equal(logged.length, 1, lines.join("\n"));
  assert.ok(logged[0]?.startsWith(`L1 keep-awake: ${problem}`), logged[0]);
  const shown = await page(bridge.url);
  assert.equal(shown.status, 200, "the bridge stopped answering");
  assert.ok(shown.body.includes(`<p>Keep awake: ${problem}`), shown.body);
  assert.ok(shown.body.includes("Create a home"), "the page lost its own content");
  assert.equal(bridge.keepAwake()?.pid(), undefined);
  await stopThroughFile();
  assert.ok(lines.includes("L1 bridge: bridge.stop found; stopping"));
});

test("an unsupported platform is reported, and the bridge runs on", async (t) => {
  const { bridge, lines } = await bridgeInProcess(t, { platform: "aix" });
  const problem = "this laptop can't be kept awake on aix; it may sleep";
  assert.ok(lines.some((line) => line.startsWith(`L1 keep-awake: ${problem}`)));
  const shown = await page(bridge.url);
  assert.equal(shown.status, 200);
  assert.ok(shown.body.includes(`Keep awake: this laptop can&#39;t be kept awake on aix`));
});

/** The full command line of a running process, or undefined once it is gone. */
function commandLine(pid: number): string | undefined {
  const options = { encoding: "utf8", timeout: 5_000 } as const;
  const run = spawnSync("/bin/ps", ["-p", String(pid), "-o", "command="], options);
  return run.status === 0 ? run.stdout.trim() : undefined;
}

/** Whether a process with this ID exists. */
function processRuns(pid: number): boolean {
  try {
    return process.kill(pid, 0);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

test("this platform's real helper runs while the bridge runs and is gone after it stops", async (t) => {
  const { bridge, lines, stopThroughFile } = await bridgeInProcess(t);
  const keepAwake = bridge.keepAwake();
  if (keepAwakeCommand(process.platform, process.pid) === undefined) {
    const problem = `this laptop can't be kept awake on ${process.platform}`;
    assert.equal(keepAwake?.problem()?.startsWith(problem), true, keepAwake?.problem());
    assert.ok((await page(bridge.url)).body.includes("Keep awake: this laptop can&#39;t"));
    return;
  }
  assert.equal(keepAwake?.problem(), undefined, lines.join("\n"));
  const pid = keepAwake?.pid();
  assert.ok(pid !== undefined, "the helper has no process ID");
  if (process.platform === "darwin") {
    assert.equal(commandLine(pid), `/usr/bin/caffeinate -dis -w ${process.pid}`);
  }
  assert.ok(processRuns(pid), "the helper is not running");
  assert.equal((await page(bridge.url)).body.includes("Keep awake:"), false);
  await stopThroughFile();
  await waitFor(() => !processRuns(pid), settings.KEEP_AWAKE_STOP_TIMEOUT_MS);
  assert.equal(existsSync(bridge.stopFile), false);
  assert.ok(!lines.some((line) => line.includes("ended (")), "the stop was reported as a problem");
});
