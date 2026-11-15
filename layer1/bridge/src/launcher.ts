import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import path from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import * as settings from "./settings.ts";

/**
 * What differs between Layer 2's two programs: the script in its pyproject.toml and start command
 * (contracts/README.md), the labelled stub that stands in for it, and the prefix only the program
 * itself prints (Layer 2 logs "L2 coordinator:", a stub its label).
 */
interface ProgramSpec {
  readonly name: "coordinator" | "worker";
  readonly script: string;
  readonly stubPath: readonly string[];
  readonly ownLine: { readonly real: string; readonly stub: string };
}

const COORDINATOR: ProgramSpec = {
  name: "coordinator",
  script: "layer2-coordinator",
  stubPath: settings.COORDINATOR_STUB_PATH,
  ownLine: { real: "L2 coordinator: ", stub: "STUB layer2-coordinator: " },
};

const WORKER: ProgramSpec = {
  name: "worker",
  script: "layer2-worker",
  stubPath: settings.WORKER_STUB_PATH,
  ownLine: { real: "L2 worker: ", stub: "STUB layer2-worker: " },
};
/** uv's own failures print lines starting with this, and exit 2 as a bad config does. */
const UV_ERROR = "error: ";

/** Layer 2's coordinator, or the labelled stub that stands in for it. */
export type CoordinatorProgram = "real" | "stub";

/**
 * Exit code 0 ends in "stopped", 3 in "rejected", and 2 in "bad_config" when the program itself
 * said why; any other end restarts. While "starting", a coordinator left running is asked to stop.
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

/** Absolute paths, and coordinator.json's stop_file and dashboard_port; tests shorten the times. */
export interface LauncherOptions {
  repoRoot: string;
  configFile: string;
  stopFile: string;
  dashboardPort: number;
  /** Gets the launcher's lines and the coordinator's stderr lines; console.log by default. */
  log?: (line: string) => void;
  stopDeadlineMs?: number;
  restartBackoffMs?: readonly number[];
  backoffResetMs?: number;
}

/** What a run printed: whether the program itself spoke, and the line that says why it ended. */
type RunOutput = { own: boolean; errorLine: string | null };

/** The real program once layer2/pyproject.toml's [project.scripts] table declares its script. */
export function chooseProgram(repoRoot: string, script = COORDINATOR.script): CoordinatorProgram {
  const file = path.join(repoRoot, settings.LAYER2_PROJECT_DIR, settings.LAYER2_PYPROJECT_FILE);
  if (!existsSync(file)) return "stub";
  // Node has no TOML parser: split the file where each table starts, and read [project.scripts].
  const tables = readFileSync(file, { encoding: "utf8" }).split(/^\s*\[/m);
  const scripts = tables.find((table) => /^\s*project\.scripts\s*\]/.test(table)) ?? "";
  return new RegExp(`^\\s*${script}\\s*=`, "m").test(scripts) ? "real" : "stub";
}

/** A program's file and `args`, started without a shell: the contract's uv run, or the stub. */
function programCommand(
  spec: ProgramSpec,
  program: CoordinatorProgram,
  repo: string,
  args: string[],
) {
  if (program === "stub") {
    return { file: process.execPath, args: [path.join(repo, ...spec.stubPath), ...args] };
  }
  const project = path.join(repo, settings.LAYER2_PROJECT_DIR);
  return { file: "uv", args: ["run", "--project", project, spec.script, ...args] };
}

/** Each program's file and arguments, started without a shell; the real one is the contract's. */
export function coordinatorCommand(program: CoordinatorProgram, repo: string, config: string) {
  return programCommand(COORDINATOR, program, repo, ["--config", config]);
}

/** The worker's start command: `uv run --project <repo>/layer2 layer2-worker --config <file>`. */
export function workerCommand(program: CoordinatorProgram, repo: string, config: string) {
  return programCommand(WORKER, program, repo, ["--config", config]);
}

/** The check command: `uv run --project <repo>/layer2 layer2-worker check --config <file> --json`. */
export function workerCheckCommand(program: CoordinatorProgram, repo: string, config: string) {
  return programCommand(WORKER, program, repo, ["check", "--config", config, "--json"]);
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

/** How a launcher finds a program that an earlier bridge left running. */
type Leftover = { readonly port: number } | { readonly pidFile: string };

/** Starts one of Layer 2's programs or its stub, restarts it after a crash, and stops it. */
class Layer2Launcher {
  readonly #spec: ProgramSpec;
  readonly #leftover: Leftover;
  readonly #options: Required<Omit<LauncherOptions, "dashboardPort">>;
  #program: CoordinatorProgram | null = null;
  #state: CoordinatorState = "stopped";
  #lastErrorLine: string | null = null;
  #child: ChildProcess | null = null;
  #closed: Promise<void> = Promise.resolve();
  #restartTimer: NodeJS.Timeout | undefined;
  #crashes = 0;
  /** The latest start() or stop(); each runs once the one before it has finished. */
  #queue: Promise<void> = Promise.resolve();

  constructor(
    spec: ProgramSpec,
    options: Omit<LauncherOptions, "dashboardPort">,
    leftover: Leftover,
  ) {
    this.#spec = spec;
    this.#leftover = leftover;
    this.#options = {
      log: (line) => console.log(line),
      stopDeadlineMs: settings.COORDINATOR_STOP_DEADLINE_MS,
      restartBackoffMs: settings.COORDINATOR_RESTART_BACKOFF_MS,
      backoffResetMs: settings.COORDINATOR_BACKOFF_RESET_MS,
      ...options,
    };
  }

  status(): CoordinatorStatus {
    const pid = this.#child?.pid ?? null;
    return { program: this.#program, state: this.#state, lastErrorLine: this.#lastErrorLine, pid };
  }

  /**
   * Unless the coordinator runs or is due to restart: asks one that an earlier bridge left running
   * to stop, deletes a stale stop file, and starts the chosen program.
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
    this.#lastErrorLine = null;
    this.#crashes = 0;
    try {
      await this.#stopLeftover();
      rmSync(this.#options.stopFile, { force: true });
      this.#program = chooseProgram(this.#options.repoRoot, this.#spec.script);
    } catch (error) {
      this.#state = "cannot_start";
      this.#lastErrorLine = error instanceof Error ? error.message : String(error);
      throw error;
    }
    const { name } = this.#spec;
    const stub = `Layer 2's ${name} isn't built yet; starting the STUB`;
    this.#say(this.#program === "real" ? `starting Layer 2's ${name}` : stub);
    this.#spawn(this.#program);
    await new Promise((resolve) => setImmediate(resolve)); // a failed spawn is reported by then
  }

  /** A program that an earlier bridge left running keeps its place; its stop file ends it. */
  async #stopLeftover(): Promise<void> {
    const { stopFile, stopDeadlineMs } = this.#options;
    const found = await this.#leftoverFound();
    if (found === undefined) return;
    this.#say(`${found}; asking the ${this.#spec.name} there to stop`);
    writeFileSync(stopFile, "", { encoding: "utf8" });
    const deadline = performance.now() + stopDeadlineMs;
    while (existsSync(stopFile) && performance.now() < deadline) {
      await sleep(settings.COORDINATOR_STOP_POLL_MS);
    }
    if (existsSync(stopFile)) this.#say(`nothing took the stop file within ${stopDeadlineMs} ms`);
  }

  /**
   * What shows that a program an earlier bridge started still runs: the coordinator's dashboard
   * port in use, or a live process named in the worker's pid file (never ended by that ID).
   */
  async #leftoverFound(): Promise<string | undefined> {
    const leftover = this.#leftover;
    if ("port" in leftover) {
      const where = `${settings.LOCAL_HOST}:${leftover.port}`;
      return (await this.#inUse(where, leftover.port)) ? `${where} is in use` : undefined;
    }
    let pid: number;
    try {
      pid = Number.parseInt(readFileSync(leftover.pidFile, { encoding: "utf8" }), 10);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    return Number.isInteger(pid) && pid > 0 && processRuns(pid)
      ? `${leftover.pidFile} names a running process`
      : undefined;
  }

  /** Whether a program accepts connections on this local port, as a running dashboard does. */
  #inUse(where: string, port: number): Promise<boolean> {
    const timeout = settings.COORDINATOR_PROBE_TIMEOUT_MS;
    const socket = connect({ host: settings.LOCAL_HOST, port, timeout });
    const answer = new Promise<boolean>((resolve) => {
      // A program that listens answers at once, so no answer in time means the port is free.
      socket.once("connect", () => resolve(true)).once("timeout", () => resolve(false));
      socket.on("error", (error: NodeJS.ErrnoException) => {
        // A refused connection is the usual answer: nothing listens there.
        if (error.code !== "ECONNREFUSED") this.#say(`cannot check ${where}: ${error.message}`);
        resolve(false);
      });
    });
    return answer.finally(() => socket.destroy());
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
      this.#say(
        `the ${this.#spec.name} did not stop within ${deadline} ms; ending all its processes`,
      );
    }
    this.#endTree(child);
    const ended = await this.#closesWithin(settings.COORDINATOR_TREE_STOP_TIMEOUT_MS);
    if (!ended) this.#say(`could not end the ${this.#spec.name} (pid ${child.pid})`);
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
    const { file, args } = programCommand(this.#spec, program, repoRoot, ["--config", configFile]);
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
      this.#say(`cannot start the ${this.#spec.name}: ${this.#lastErrorLine}`);
    });
    const startedAt = performance.now();
    const run: RunOutput = { own: false, errorLine: null };
    // After EMFILE or ENFILE, Node gives the child no stderr; its error event says why.
    if (child.stderr) {
      createInterface({ input: child.stderr.setEncoding("utf8") }).on("line", (line) => {
        if (line.trim() === "") return;
        this.#options.log(line);
        run.own ||= line.includes(this.#spec.ownLine[program]);
        // uv's first error line says what failed; otherwise the latest line says why it ended.
        if (!run.errorLine?.startsWith(UV_ERROR)) run.errorLine = line.trim();
      });
    }
    this.#closed = new Promise((resolve) => {
      child.once("close", (code, signal) => {
        const delay = this.#ended(child, code ?? signal, run, performance.now() - startedAt);
        if (delay !== null) this.#restartTimer = setTimeout(() => this.#spawn(program), delay);
        resolve();
      });
    });
    this.#child = child;
    this.#state = "running";
    if ("pidFile" in this.#leftover && child.pid !== undefined) {
      this.#writePidFile(this.#leftover.pidFile, child.pid);
    }
  }

  /** Writes the pid file the next bridge checks; if it cannot, says why and runs on without it. */
  #writePidFile(pidFile: string, pid: number): void {
    try {
      writeFileSync(pidFile, String(pid), { encoding: "utf8" });
    } catch (error) {
      this.#say(`cannot write ${pidFile} (${(error as NodeJS.ErrnoException).code})`);
    }
  }

  /** Applies the exit policy, and returns the wait before a restart or null for none. */
  #ended(child: ChildProcess, end: number | string | null, run: RunOutput, ranMs: number) {
    if (this.#child !== child) return null; // it never started
    this.#child = null;
    if (this.#state === "stopping" || end === 0) {
      this.#state = "stopped";
      this.#say(`the ${this.#spec.name} stopped`);
      return null;
    }
    this.#lastErrorLine = run.errorLine;
    const why = run.errorLine ?? "no error output";
    // uv exits 2 when it cannot run the program, so 2 is a bad config only if the program said so.
    if ((end === 2 && run.own) || end === 3) {
      this.#state = end === 2 ? "bad_config" : "rejected";
      this.#say(`the ${this.#spec.name} exited with code ${end}; not restarting: ${why}`);
      return null;
    }
    if (ranMs >= this.#options.backoffResetMs) this.#crashes = 0;
    const delay = restartDelay(this.#crashes, this.#options.restartBackoffMs);
    this.#crashes += 1;
    this.#state = "restarting";
    const how = typeof end === "number" ? `exit code ${end}` : end;
    this.#say(`the ${this.#spec.name} crashed (${how}); restarting in ${delay} ms: ${why}`);
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
      this.#say(`the ${this.#spec.name}'s processes had already ended`);
    }
  }
}

/** Whether a process with this ID exists; one this user may not signal exists too. */
function processRuns(pid: number): boolean {
  try {
    return process.kill(pid, 0);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Starts Layer 2's coordinator or its stub, restarts it after a crash, and stops it. */
export class CoordinatorLauncher extends Layer2Launcher {
  constructor(options: LauncherOptions) {
    super(COORDINATOR, options, { port: options.dashboardPort });
  }
}

/** worker.json's paths, and the pid file a later bridge reads to find a worker still running. */
export interface WorkerLauncherOptions extends Omit<LauncherOptions, "dashboardPort"> {
  pidFile: string;
}

/**
 * Starts Layer 2's worker or its stub, as the coordinator's launcher does: exit 3 ends in
 * "rejected" without a restart. A worker an earlier bridge left running is found through the pid
 * file and asked to stop through its stop file (R5).
 */
export class WorkerLauncher extends Layer2Launcher {
  constructor(options: WorkerLauncherOptions) {
    const { pidFile, ...rest } = options;
    super(WORKER, rest, { pidFile });
  }
}
