import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import {
  chooseProgram,
  coordinatorCommand,
  restartDelay,
  windowsTreeStopCommand,
} from "../bridge/src/launcher.ts";
import * as settings from "../bridge/src/settings.ts";
import { makeTempDir } from "./coordinator-fixtures.ts";

const DECLARED = '[project]\nname = "layer2"\n\n[project.scripts]\nlayer2-coordinator = "m:run"\n';

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
});
