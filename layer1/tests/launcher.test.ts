import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { describe, type TestContext, test } from "node:test";
import {
  CoordinatorLauncher,
  chooseProgram,
  coordinatorCommand,
  type LauncherOptions,
  restartDelay,
  windowsTreeStopCommand,
} from "../bridge/src/launcher.ts";
import * as settings from "../bridge/src/settings.ts";
import { makeTempDir, STUB, startStub, waitFor, writeConfig } from "./coordinator-fixtures.ts";

const DECLARED = '[project]\nname = "layer2"\n\n[project.scripts]\nlayer2-coordinator = "m:run"\n';

/** A test child that ignores its stop file, starts a grandchild, and writes both process IDs. */
const STUBBORN = `import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const forever = "setInterval(() => {}, 1000)";
const grandchild = spawn(process.execPath, ["-e", forever], { stdio: "ignore" });
writeFileSync("pids", process.pid + " " + grandchild.pid);
setInterval(() => {}, 1000);
`;

/** A launcher for a repository with no Layer 2 whose stub is `source`; stopped after the test. */
async function launch(t: TestContext, source: string, options: Partial<LauncherOptions> = {}) {
  const repoRoot = await makeTempDir();
  const stub = path.join(repoRoot, ...settings.COORDINATOR_STUB_PATH);
  await mkdir(path.dirname(stub), { recursive: true });
  await writeFile(stub, source, { encoding: "utf8" });
  const config = await writeConfig(repoRoot); // configFile, stopFile and dashboardPort
  const lines: string[] = [];
  const log = (line: string) => lines.push(line);
  const launcher = new CoordinatorLauncher({ repoRoot, ...config, log, ...options });
  t.after(async () => {
    await launcher.stop();
    await rm(repoRoot, { recursive: true, force: true });
  });
  // Test children write files in their working folder, which is the repository.
  const read = (name: string): string =>
    existsSync(path.join(repoRoot, name)) ? readFileSync(path.join(repoRoot, name), "utf8") : "";
  return { launcher, lines, repo: repoRoot, read, stopFile: config.stopFile };
}

function alive(pid: number): boolean {
  try {
    return process.kill(pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    return false;
  }
}

describe("the coordinator launcher", () => {
  test("chooses Layer 2's coordinator only when [project.scripts] declares it", async (t) => {
    const repo = await makeTempDir();
    t.after(() => rm(repo, { recursive: true, force: true }));
    assert.equal(chooseProgram(repo), "stub", "no layer2/pyproject.toml");
    await mkdir(path.join(repo, "layer2"));
    const otherScript = '[project.scripts]\nlayer2-worker = "m:run"\n';
    for (const [text, program] of [
      [DECLARED, "real"],
      [otherScript, "stub"],
      [`${otherScript}\n[tool.other]\nlayer2-coordinator = "m:run"\n`, "stub"],
    ] as const) {
      await writeFile(path.join(repo, "layer2", "pyproject.toml"), text, { encoding: "utf8" });
      assert.equal(chooseProgram(repo), program, text);
    }
  });

  test("builds the exact commands, and waits 1, 2, 5, 10, then 30 s between restarts", () => {
    const [repo, config] = [path.resolve("repo"), path.resolve("state", "coordinator.json")];
    const project = path.join(repo, "layer2");
    const args = ["run", "--project", project, "layer2-coordinator", "--config", config];
    assert.deepEqual(coordinatorCommand("real", repo, config), { file: "uv", args });
    const stub = path.join(repo, "layer1", "stubs", "fake-layer2-coordinator.ts");
    const stubCommand = { file: process.execPath, args: [stub, "--config", config] };
    assert.deepEqual(coordinatorCommand("stub", repo, config), stubCommand);
    const timeout = settings.COORDINATOR_TREE_STOP_TIMEOUT_MS;
    const options = { shell: false, stdio: "ignore", timeout, windowsHide: true };
    const taskkill = { file: "taskkill.exe", args: ["/PID", "4242", "/T", "/F"], options };
    assert.deepEqual(windowsTreeStopCommand(4242), taskkill);
    const backoff = settings.COORDINATOR_RESTART_BACKOFF_MS;
    const waits = [0, 1, 2, 3, 4, 5].map((crashes) => restartDelay(crashes, backoff));
    assert.deepEqual(waits, [1_000, 2_000, 5_000, 10_000, 30_000, 30_000]);
  });

  test("runs the stub when Layer 2 declares none, and its stop file stops it", async (t) => {
    const { launcher, lines, stopFile } = await launch(t, await readFile(STUB, "utf8"));
    await writeFile(stopFile, "", { encoding: "utf8" }); // left over from an earlier run
    await Promise.all([launcher.start(), launcher.start()]); // the second does nothing
    assert.equal(existsSync(stopFile), false, "start() deletes a stale stop file");
    await waitFor(() => lines.some((line) => line.includes("ready")));
    const { pid, ...status } = launcher.status();
    assert.deepEqual(status, { program: "stub", state: "running", lastErrorLine: null });
    assert.equal(typeof pid, "number");
    await launcher.stop();
    assert.equal(launcher.status().state, "stopped");
    assert.equal(existsSync(stopFile), false, "the stub found its stop file and removed it");
    const starting = "L1 launcher: Layer 2's coordinator isn't built yet; starting the STUB";
    const ours = lines.filter((line) => line.startsWith("L1 "));
    assert.deepEqual(ours, [starting, "L1 launcher: the coordinator stopped"]);
  });

  test("asks a coordinator an earlier bridge left running to stop, then starts", async (t) => {
    const leftover = await startStub(t);
    await waitFor(() => leftover.stderr().includes("ready"));
    const { configFile, stopFile, dashboardPort } = leftover;
    const options = { configFile, stopFile, dashboardPort };
    const { launcher, lines } = await launch(t, await readFile(STUB, "utf8"), options);
    await launcher.start();
    const where = `127.0.0.1:${dashboardPort}`;
    assert.equal(lines[0], `L1 launcher: ${where} is in use; asking the coordinator there to stop`);
    assert.equal(await leftover.exitCode, 0);
    await waitFor(() => lines.some((line) => line.includes("ready")));
    assert.equal(launcher.status().state, "running");
  });

  test("restarts after any end but 0, 2 or 3, and a 2 from uv itself, until stopped", async (t) => {
    const own = "STUB layer2-coordinator:";
    for (const [code, stderr, restarts, state, lastErrorLine] of [
      [1, "first line\\nlast line", true, "stopped", "last line"],
      [0, `${own} stopped`, false, "stopped", null],
      [2, `${own} bad config`, false, "bad_config", `${own} bad config`],
      [2, "error: Failed to spawn\\n  cause: not found", true, "stopped", "error: Failed to spawn"],
      [3, "token rejected", false, "rejected", "token rejected"],
    ] as const) {
      const child = `import { appendFileSync } from "node:fs";
appendFileSync("starts", "x");
process.stderr.write("${stderr}\\n\\n");
process.exitCode = ${code};`;
      const { launcher, read } = await launch(t, child, { restartBackoffMs: [100] });
      await launcher.start();
      const [runs, ended] = restarts ? [2, "restarting"] : [1, state];
      await waitFor(() => read("starts").length >= runs && launcher.status().state === ended);
      if (restarts) await launcher.stop(); // cancels the restart that is due
      const starts = read("starts").length;
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(read("starts").length, starts, `started again after ${stderr}`);
      assert.deepEqual(launcher.status(), { program: "stub", state, lastErrorLine, pid: null });
    }
  });

  test("the backoff starts again after a long run, and after start()", async (t) => {
    // The second run lasts 300 ms; without the reset, the third start would wait 60 s.
    const child = `import { appendFileSync, readFileSync } from "node:fs";
appendFileSync("starts", "x");
process.stderr.write("crashed\\n");
if (readFileSync("starts", "utf8").length === 2) setTimeout(() => process.exit(1), 300);
else process.exitCode = 1;`;
    const options = { restartBackoffMs: [50, 60_000], backoffResetMs: 200 };
    const { launcher, read } = await launch(t, child, options);
    await launcher.start();
    await waitFor(() => read("starts").length === 3, 3_000);
    await waitFor(() => launcher.status().state === "restarting"); // in 60 s
    await launcher.stop();
    await launcher.start();
    assert.equal(launcher.status().lastErrorLine, null);
    await waitFor(() => read("starts").length === 5, 3_000);
  });

  test("a coordinator that ignores its stop file is ended with its children", async (t) => {
    const { launcher, lines, read } = await launch(t, STUBBORN, { stopDeadlineMs: 300 });
    await launcher.start();
    await waitFor(() => read("pids").split(" ").length === 2);
    const pids = read("pids").split(" ").map(Number);
    const first = launcher.stop();
    await waitFor(() => launcher.status().state === "stopping");
    await launcher.stop(); // a second stop, such as a second Ctrl+C, waits for the first
    assert.equal(launcher.status().state, "stopped");
    await first;
    assert.ok(lines.some((line) => line.includes("did not stop within 300 ms")));
    await waitFor(() => !pids.some(alive));
  });

  test("a stop file that cannot be written: stop() ends at once, start() says why", async (t) => {
    const { launcher, lines, stopFile } = await launch(t, "setInterval(() => {}, 1000);");
    await launcher.start();
    await mkdir(stopFile); // a folder where the stop file goes, so writing or deleting it fails
    await launcher.stop();
    assert.equal(launcher.status().state, "stopped");
    assert.ok(lines.some((line) => line.startsWith("L1 launcher: cannot write the stop file")));
    const error = await launcher.start().catch((reason: unknown) => reason);
    assert.ok(error instanceof Error, "start() rejects when it cannot delete the stop file");
    assert.equal(launcher.status().state, "cannot_start");
    assert.equal(launcher.status().lastErrorLine, error.message, "and the status says why");
  });

  test("a missing uv is reported by the time start() returns", async (t) => {
    const { launcher, lines, repo } = await launch(t, "");
    await mkdir(path.join(repo, "layer2"));
    await writeFile(path.join(repo, "layer2", "pyproject.toml"), DECLARED, "utf8");
    const env = process.env;
    process.env = { PATH: repo }; // no uv on this PATH
    try {
      await launcher.start();
    } finally {
      process.env = env;
    }
    const status = { program: "real", state: "cannot_start", lastErrorLine: "uv not found" };
    assert.deepEqual(launcher.status(), { ...status, pid: null });
    assert.deepEqual(lines, [
      "L1 launcher: starting Layer 2's coordinator",
      "L1 launcher: cannot start the coordinator: uv not found",
    ]);
  });

  test("a spawn that fails before the child has stderr (EMFILE) is reported", async (t) => {
    const { launcher } = await launch(t, "");
    const error = Object.assign(new Error(`spawn ${process.execPath} EMFILE`), { code: "EMFILE" });
    // Node returns such a child, with no stdio, and reports the error on the next tick.
    const spawn = t.mock.method(childProcess, "spawn", () => {
      const child = new childProcess.ChildProcess();
      process.nextTick(() => child.emit("error", error));
      return child;
    });
    syncBuiltinESMExports();
    try {
      await launcher.start();
      await waitFor(() => launcher.status().state === "cannot_start");
    } finally {
      spawn.mock.restore();
      syncBuiltinESMExports();
    }
    assert.equal(launcher.status().lastErrorLine, error.message);
  });
});
