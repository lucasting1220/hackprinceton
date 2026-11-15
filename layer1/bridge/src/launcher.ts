import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import * as settings from "./settings.ts";

/** Layer 2's coordinator script, in its pyproject.toml and start command (contracts/README.md). */
const SCRIPT = "layer2-coordinator";

/** Layer 2's coordinator, or the labelled stub that stands in for it. */
export type CoordinatorProgram = "real" | "stub";

/** The real coordinator once layer2/pyproject.toml's [project.scripts] table declares it. */
export function chooseProgram(repoRoot: string): CoordinatorProgram {
  const file = path.join(repoRoot, settings.LAYER2_PROJECT_DIR, settings.LAYER2_PYPROJECT_FILE);
  if (!existsSync(file)) return "stub";
  // Node has no TOML parser: split the file where each table starts, and read [project.scripts].
  const tables = readFileSync(file, { encoding: "utf8" }).split(/^\s*\[/m);
  const scripts = tables.find((table) => /^\s*project\.scripts\s*\]/.test(table)) ?? "";
  return new RegExp(`^\\s*${SCRIPT}\\s*=`, "m").test(scripts) ? "real" : "stub";
}

/** Each program's file and arguments, started without a shell; the real one is the contract's. */
export function coordinatorCommand(program: CoordinatorProgram, repo: string, config: string) {
  if (program === "stub") {
    const stub = path.join(repo, ...settings.COORDINATOR_STUB_PATH);
    return { file: process.execPath, args: [stub, "--config", config] };
  }
  const project = path.join(repo, settings.LAYER2_PROJECT_DIR);
  return { file: "uv", args: ["run", "--project", project, SCRIPT, "--config", config] };
}

/** The wait before restarting after `crashes` crashes in a row; the last wait repeats. */
export function restartDelay(crashes: number, backoff: readonly number[]): number {
  return backoff[Math.min(crashes, backoff.length - 1)] ?? 0;
}

/** The Windows command that ends a process and every process it started: no shell, no window. */
export function windowsTreeStopCommand(pid: number) {
  const timeout = settings.COORDINATOR_TREE_STOP_TIMEOUT_MS;
  const options = { shell: false, stdio: "ignore", timeout, windowsHide: true } as const;
  return { file: "taskkill.exe", args: ["/PID", String(pid), "/T", "/F"], options };
}
