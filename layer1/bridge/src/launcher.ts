import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import * as settings from "./settings.ts";

/** Layer 2's coordinator script, in its pyproject.toml and start command (contracts/README.md). */
const SCRIPT = "layer2-coordinator";
const STARTING_STUB = "Layer 2's coordinator isn't built yet; starting the STUB";
/** Only the program itself prints these: Layer 2 logs "L2 coordinator:", the stub its label. */
const OWN_LINE = { real: "L2 coordinator: ", stub: "STUB layer2-coordinator: " } as const;
/** uv's own failures print lines starting with this, and exit 2 as a bad config does. */
const UV_ERROR = "error: ";

/** Layer 2's coordinator, or the labelled stub that stands in for it. */
export type CoordinatorProgram = "real" | "stub";

/**
 * Exit code 0 ends in "stopped", 3 in "rejected", and 2 in "bad_config" when the program itself
 * said why; any other end restarts.
 */
export type CoordinatorState =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "restarting"
  | "bad_config"
  | "rejected"
  | "cannot_start";

/** What the setup page shows; lastErrorLine says why the latest run failed. */
export interface CoordinatorStatus {
  program: CoordinatorProgram | null;
  state: CoordinatorState;
  lastErrorLine: string | null;
  pid: number | null;
}

/** Absolute paths, and coordinator.json's stop_file; tests shorten the times. */
export interface LauncherOptions {
  repoRoot: string;
  configFile: string;
  stopFile: string;
  /** Gets the launcher's lines and the coordinator's stderr lines; console.log by default. */
  log?: (line: string) => void;
  stopDeadlineMs?: number;
  restartBackoffMs?: readonly number[];
}

/** What a run printed: whether the program itself spoke, and the line that says why it ended. */
type RunOutput = { own: boolean; errorLine: string | null };

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

/** Starts Layer 2's coordinator or its stub, restarts it after a crash, and stops it. */
export class CoordinatorLauncher {
  readonly #options: Required<LauncherOptions>;
  #program: CoordinatorProgram | null = null;
  #state: CoordinatorState = "stopped";
  #lastErrorLine: string | null = null;
  #child: ChildProcess | null = null;
  #closed: Promise<void> = Promise.resolve();
  #restartTimer: NodeJS.Timeout | undefined;
  #crashes = 0;
  /** The latest start() or stop(); each runs once the one before it has finished. */
  #queue: Promise<void> = Promise.resolve();

  constructor(options: LauncherOptions) {
    this.#options = {
      log: (line) => console.log(line),
      stopDeadlineMs: settings.COORDINATOR_STOP_DEADLINE_MS,
      restartBackoffMs: settings.COORDINATOR_RESTART_BACKOFF_MS,
      ...options,
    };
  }

  status(): CoordinatorStatus {
    const pid = this.#child?.pid ?? null;
    return { program: this.#program, state: this.#state, lastErrorLine: this.#lastErrorLine, pid };
  }

  /**
   * Unless the coordinator runs or is due to restart: deletes a stale stop file, and starts the
   * chosen program.
   */
  start(): Promise<void> {
    return this.#inTurn(() => this.#start());
  }

  /** Writes the stop file, waits up to the deadline, then ends the coordinator's process tree. */
  stop(): Promise<void> {
    return this.#inTurn(() => this.#stop());
  }

  #say(message: string): void {
    this.#options.log(`L1 launcher: ${message}`);
  }

  /** Runs starts and stops one at a time, in the order they were called. */
  #inTurn(action: () => Promise<void>): Promise<void> {
    const result = this.#queue.then(action);
    this.#queue = result.catch(() => undefined); // its caller gets the error; the next one runs
    return result;
  }

  async #start(): Promise<void> {
    if (this.#child !== null || this.#state === "restarting") return;
    this.#state = "starting";
    try {
      rmSync(this.#options.stopFile, { force: true });
      this.#program = chooseProgram(this.#options.repoRoot);
    } catch (error) {
      this.#state = "cannot_start";
      this.#lastErrorLine = error instanceof Error ? error.message : String(error);
      throw error;
    }
    this.#say(this.#program === "real" ? "starting Layer 2's coordinator" : STARTING_STUB);
    this.#spawn(this.#program);
    await new Promise((resolve) => setImmediate(resolve)); // a failed spawn is reported by then
  }

  async #stop(): Promise<void> {
    clearTimeout(this.#restartTimer);
    const child = this.#child;
    if (child === null) {
      if (this.#state === "restarting") this.#state = "stopped";
      return;
    }
    this.#state = "stopping";
    const deadline = this.#options.stopDeadlineMs;
    if (this.#writeStopFile()) {
      if (await this.#closesWithin(deadline)) return;
      this.#say(`the coordinator did not stop within ${deadline} ms; ending all its processes`);
    }
    this.#endTree(child);
    const ended = await this.#closesWithin(settings.COORDINATOR_TREE_STOP_TIMEOUT_MS);
    if (!ended) this.#say(`could not end the coordinator (pid ${child.pid})`);
  }

  /** Writes the stop file; if it cannot, says why, and only ending the processes is left. */
  #writeStopFile(): boolean {
    try {
      writeFileSync(this.#options.stopFile, "", { encoding: "utf8" });
      return true;
    } catch (error) {
      const { code } = error as NodeJS.ErrnoException;
      this.#say(`cannot write the stop file (${code}); ending all its processes`);
      return false;
    }
  }

  #closesWithin(ms: number): Promise<boolean> {
    return Promise.race([this.#closed.then(() => true), sleep(ms, false, { ref: false })]);
  }

  #spawn(program: CoordinatorProgram): void {
    const { repoRoot, configFile } = this.#options;
    const { file, args } = coordinatorCommand(program, repoRoot, configFile);
    // Outside Windows it gets its own process group, so that stop() can end all it starts.
    const child: ChildProcess = spawn(file, args, {
      cwd: repoRoot,
      detached: process.platform !== "win32",
      shell: false,
      stdio: ["ignore", "inherit", "pipe"],
      windowsHide: true,
    });
    child.once("error", (error: NodeJS.ErrnoException) => {
      this.#child = null;
      this.#state = "cannot_start";
      this.#lastErrorLine = error.code === "ENOENT" ? `${file} not found` : error.message;
      this.#say(`cannot start the coordinator: ${this.#lastErrorLine}`);
    });
    const run: RunOutput = { own: false, errorLine: null };
    // After EMFILE or ENFILE, Node gives the child no stderr; its error event says why.
    if (child.stderr) {
      createInterface({ input: child.stderr.setEncoding("utf8") }).on("line", (line) => {
        if (line.trim() === "") return;
        this.#options.log(line);
        run.own ||= line.includes(OWN_LINE[program]);
        // uv's first error line says what failed; otherwise the latest line says why it ended.
        if (!run.errorLine?.startsWith(UV_ERROR)) run.errorLine = line.trim();
      });
    }
    this.#closed = new Promise((resolve) => {
      child.once("close", (code, signal) => {
        const delay = this.#ended(child, code ?? signal, run);
        if (delay !== null) this.#restartTimer = setTimeout(() => this.#spawn(program), delay);
        resolve();
      });
    });
    this.#child = child;
    this.#state = "running";
  }

  /** Applies the exit policy, and returns the wait before a restart or null for none. */
  #ended(child: ChildProcess, end: number | string | null, run: RunOutput) {
    if (this.#child !== child) return null; // it never started
    this.#child = null;
    if (this.#state === "stopping" || end === 0) {
      this.#state = "stopped";
      this.#say("the coordinator stopped");
      return null;
    }
    this.#lastErrorLine = run.errorLine;
    const why = run.errorLine ?? "no error output";
    // uv exits 2 when it cannot run the program, so 2 is a bad config only if the program said so.
    if ((end === 2 && run.own) || end === 3) {
      this.#state = end === 2 ? "bad_config" : "rejected";
      this.#say(`the coordinator exited with code ${end}; not restarting: ${why}`);
      return null;
    }
    const delay = restartDelay(this.#crashes, this.#options.restartBackoffMs);
    this.#crashes += 1;
    this.#state = "restarting";
    const how = typeof end === "number" ? `exit code ${end}` : end;
    this.#say(`the coordinator crashed (${how}); restarting in ${delay} ms: ${why}`);
    return delay;
  }

  /** Ends the coordinator and everything it started: taskkill on Windows, its group elsewhere. */
  #endTree(child: ChildProcess): void {
    if (child.pid === undefined) return;
    if (process.platform === "win32") {
      const { file, args, options } = windowsTreeStopCommand(child.pid);
      spawn(file, args, options).on("error", (error) => this.#say(`${file}: ${error.message}`));
      return;
    }
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      this.#say("the coordinator's processes had already ended");
    }
  }
}
