import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, type TestContext, test } from "node:test";
import { readWorkerStatus, runCheck, workerFiles } from "../bridge/src/laptop.ts";
import {
  WorkerLauncher,
  type WorkerLauncherOptions,
  workerCheckCommand,
  workerCommand,
} from "../bridge/src/launcher.ts";
import * as settings from "../bridge/src/settings.ts";
import { makeTempDir, waitFor } from "./coordinator-fixtures.ts";

const WORKER_STUB = path.join(import.meta.dirname, "..", "..", ...settings.WORKER_STUB_PATH);
const TOKEN = "0123456789abcdef".repeat(4);

/**
 * A repository with no Layer 2 whose worker stub is the real one or `source`, and a state folder
 * with worker.json (contracts/worker.json's example with this folder's paths) and a token file.
 */
async function workerRepo(t: TestContext, source?: string) {
  const repoRoot = await makeTempDir();
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const stub = path.join(repoRoot, ...settings.WORKER_STUB_PATH);
  await mkdir(path.dirname(stub), { recursive: true });
  if (source === undefined) await copyFile(WORKER_STUB, stub);
  else await writeFile(stub, source, "utf8");
  const files = workerFiles(repoRoot);
  const contract = path.join(import.meta.dirname, "..", "..", "contracts", "worker.json");
  const example = JSON.parse(await readFile(contract, "utf8")) as object;
  const config = {
    ...example,
    token_file: files.token,
    python: process.execPath,
    status_file: files.status,
    stop_file: files.stop,
    state_dir: files.workerStateDir,
  };
  await writeFile(files.config, JSON.stringify(config), "utf8");
  await writeFile(files.token, TOKEN, "utf8");
  return { repoRoot, files };
}

function launch(
  t: TestContext,
  repo: Awaited<ReturnType<typeof workerRepo>>,
  options: Partial<WorkerLauncherOptions> = {},
) {
  const lines: string[] = [];
  const { repoRoot, files } = repo;
  const launcher = new WorkerLauncher({
    repoRoot,
    configFile: files.config,
    stopFile: files.stop,
    pidFile: files.pid,
    log: (line) => lines.push(line),
    restartBackoffMs: [50],
    ...options,
  });
  t.after(() => launcher.stop());
  return { launcher, lines };
}

describe("the worker launcher", () => {
  test("runs exactly the contract's worker and check commands", () => {
    const [repo, config] = [path.resolve("repo"), path.resolve("state", "worker.json")];
    const project = path.join(repo, "layer2");
    const run = ["run", "--project", project, "layer2-worker"];
    assert.deepEqual(workerCommand("real", repo, config), {
      file: "uv",
      args: [...run, "--config", config],
    });
    assert.deepEqual(workerCheckCommand("real", repo, config), {
      file: "uv",
      args: [...run, "check", "--config", config, "--json"],
    });
    const stub = path.join(repo, ...settings.WORKER_STUB_PATH);
    assert.deepEqual(workerCommand("stub", repo, config).args, [stub, "--config", config]);
  });

  test("starts the stub, which writes connected; writes the pid file; stops through the stop file", async (t) => {
    const repo = await workerRepo(t);
    const { launcher, lines } = launch(t, repo);
    await launcher.start();
    await waitFor(() => existsSync(repo.files.status));
    assert.deepEqual(await readWorkerStatus(repo.files.status), {
      ok: true,
      state: "connected",
      nodeId: "node-uuid",
    });
    assert.equal(readFileSync(repo.files.pid, "utf8"), String(launcher.status().pid));
    await launcher.stop();
    assert.equal(launcher.status().state, "stopped");
    assert.equal(existsSync(repo.files.stop), false, "the stub did not take its stop file");
    assert.ok(lines.includes("L1 launcher: Layer 2's worker isn't built yet; starting the STUB"));
    assert.ok(lines.some((line) => line.startsWith("STUB layer2-worker: connected as node-uuid")));
    assert.ok(
      lines.every((line) => !line.includes(TOKEN)),
      "a log line holds the token",
    );
  });

  test("exit 3 ends in rejected, without a restart", async (t) => {
    const source = `process.stderr.write("STUB layer2-worker: rejected\\n"); process.exitCode = 3;\n`;
    const repo = await workerRepo(t, source);
    const { launcher, lines } = launch(t, repo);
    await launcher.start();
    await waitFor(() => launcher.status().state === "rejected");
    await new Promise((resolve) => setTimeout(resolve, 200));
    const starts = lines.filter((line) => line.includes("starting the STUB"));
    assert.equal(starts.length, 1, "it restarted a rejected worker");
    assert.equal(launcher.status().lastErrorLine, "STUB layer2-worker: rejected");
  });

  test("a worker an earlier bridge left running is asked to stop through its stop file first", async (t) => {
    const repo = await workerRepo(t);
    const stub = path.join(repo.repoRoot, ...settings.WORKER_STUB_PATH);
    const left = spawn(process.execPath, [stub, "--config", repo.files.config], {
      stdio: "ignore",
      timeout: 20_000,
    });
    const leftExit = once(left, "exit");
    await waitFor(() => existsSync(repo.files.status));
    await writeFile(repo.files.pid, String(left.pid), "utf8");
    const { launcher, lines } = launch(t, repo);
    await launcher.start();
    const asked = `${repo.files.pid} names a running process; asking the worker there to stop`;
    assert.equal(lines[0], `L1 launcher: ${asked}`);
    assert.deepEqual(await leftExit, [0, null], "the left worker did not stop by its stop file");
    assert.equal(launcher.status().state, "running");
  });

  test("a pid file naming no live process adds no wait", async (t) => {
    const repo = await workerRepo(t);
    const ended = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    await once(ended, "exit");
    await writeFile(repo.files.pid, String(ended.pid), "utf8");
    const { launcher, lines } = launch(t, repo, { stopDeadlineMs: 60_000 });
    const started = performance.now();
    await launcher.start();
    assert.ok(performance.now() - started < 5_000, "it waited for a dead worker");
    assert.ok(lines.every((line) => !line.includes("asking the worker")));
  });
});

describe("Layer 2's check, run by the bridge", () => {
  test("reads ok and missing, and exit 4's required item", async (t) => {
    const repo = await workerRepo(t);
    const timeout = settings.WORKER_CHECK_TIMEOUT_MS;
    assert.deepEqual(await runCheck(repo.repoRoot, repo.files.config, timeout), {
      ok: true,
      allRequired: true,
      missing: [],
    });
    await writeFile(repo.files.token, `${TOKEN}\n`, "utf8");
    const missing = { id: "token", reason: "the token file is malformed", required: true };
    assert.deepEqual(await runCheck(repo.repoRoot, repo.files.config, timeout), {
      ok: true,
      allRequired: false,
      missing: [missing],
    });
  });

  test("bad output, another exit and a timeout are reported with the last error line", async (t) => {
    const cases = [
      ['process.stdout.write("OK\\n");', /^the check exited with code 0: no error output$/],
      ['console.error("uv: broken"); process.exitCode = 1;', /exited with code 1: uv: broken$/],
      ["setInterval(() => {}, 1000);", /didn't finish within 0 s/],
    ] as const;
    for (const [source, message] of cases) {
      const repo = await workerRepo(t, source);
      const result = await runCheck(repo.repoRoot, repo.files.config, 300);
      assert.ok(!result.ok && message.test(result.message), JSON.stringify(result));
    }
  });
});
