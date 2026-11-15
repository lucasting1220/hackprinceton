import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
import { errorMessage } from "./json-file.ts";
import * as settings from "./settings.ts";

/** A helper's file and arguments, started without a shell, and what it adds to its environment. */
export interface KeepAwakeCommand {
  readonly file: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

/** The environment variable that hands the Windows helper the bridge's process ID. */
const BRIDGE_PID_VARIABLE = "DEBBIE_BRIDGE_PID";

/**
 * SetThreadExecutionState's ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED, written out as
 * one number: the laptop and its screen stay awake, as the Layer 1 doc's keep-awake step asks.
 */
const ES_CONTINUOUS_SYSTEM_REQUIRED = 0x80000000 + 0x1 + 0x2;

/**
 * The Windows helper: holds off sleep for as long as its own thread lives, then waits for the
 * bridge's process to exit. It is fixed text; the process ID comes in through the environment.
 */
const WINDOWS_SCRIPT = `$ErrorActionPreference = 'Stop'
$bridge = Get-Process -Id ([int]$env:${BRIDGE_PID_VARIABLE})
Add-Type -Namespace Debbie -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);'
if ([Debbie.Power]::SetThreadExecutionState([uint32]${ES_CONTINUOUS_SYSTEM_REQUIRED}) -eq 0) { exit 2 }
$bridge.WaitForExit()`;

/**
 * The helper that keeps this laptop awake until process `pid` exits, or undefined where there is
 * none: caffeinate on macOS, and one PowerShell child on Windows.
 */
export function keepAwakeCommand(platform: string, pid: number): KeepAwakeCommand | undefined {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`not a process ID: ${pid}`);
  if (platform === "darwin") {
    return { file: settings.KEEP_AWAKE_MACOS_FILE, args: ["-dis", "-w", String(pid)], env: {} };
  }
  if (platform === "win32") {
    // An encoded command, so that no quoting rule of PowerShell's or of Windows' applies to it.
    const encoded = Buffer.from(WINDOWS_SCRIPT, "utf16le").toString("base64");
    const args = ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden"];
    return {
      file: settings.KEEP_AWAKE_WINDOWS_FILE,
      args: [...args, "-EncodedCommand", encoded],
      env: { [BRIDGE_PID_VARIABLE]: String(pid) },
    };
  }
  return undefined;
}

/** What the setup page says about keep-awake: on, turned off for this run, or why it can't be. */
export type KeepAwakeStatus =
  | Readonly<{ state: "on" }>
  | Readonly<{ state: "off" }>
  | Readonly<{ state: "problem"; problem: string }>;

export interface KeepAwakeOptions {
  /** process.platform by default; tests pass another. */
  readonly platform?: string;
  /** The process the helper outlives no longer than; the bridge's own by default. */
  readonly pid?: number;
  /** In place of the platform's helper; tests pass one that is missing. */
  readonly command?: KeepAwakeCommand;
  readonly log: (line: string) => void;
}

/**
 * Keeps this laptop awake while the bridge runs, so the home keeps watching. Where it cannot, the
 * bridge runs on: problem() says why, for the setup page, and one log line says so too.
 */
export class KeepAwake {
  readonly #log: (line: string) => void;
  #child: ChildProcess | undefined;
  #problem: string | undefined;
  #stopping = false;
  #turnedOff = false;

  private constructor(log: (line: string) => void) {
    this.#log = log;
  }

  /** Starts the helper; resolves once it runs or once its problem is known, never rejecting. */
  static async start(options: KeepAwakeOptions): Promise<KeepAwake> {
    const keepAwake = new KeepAwake(options.log);
    const platform = options.platform ?? process.platform;
    const command = options.command ?? keepAwakeCommand(platform, options.pid ?? process.pid);
    if (command === undefined) {
      keepAwake.#report(`this laptop can't be kept awake on ${platform}`);
    } else {
      await keepAwake.#spawn(command);
    }
    return keepAwake;
  }

  /** Why this laptop may sleep while the bridge runs, or undefined while the helper holds it. */
  problem(): string | undefined {
    return this.#problem;
  }

  /** On, turned off for this run on the setup page, or its problem. */
  status(): KeepAwakeStatus {
    if (this.#turnedOff) return { state: "off" };
    const problem = this.#problem;
    return problem === undefined ? { state: "on" } : { state: "problem", problem };
  }

  /** The setup page's Turn off: ends the helper for this run; the next start keeps awake again. */
  async turnOff(): Promise<void> {
    if (this.#turnedOff) return;
    this.#turnedOff = true;
    this.#log("L1 keep-awake: turned off on the setup page for this run");
    await this.stop();
  }

  /** The helper's process ID while it runs. */
  pid(): number | undefined {
    return this.#child?.pid;
  }

  /** Ends the helper, waiting up to settings.KEEP_AWAKE_STOP_TIMEOUT_MS for it to exit. */
  async stop(): Promise<void> {
    this.#stopping = true;
    const child = this.#child;
    if (child === undefined || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit").then(() => true);
    child.kill();
    const timeout = sleep(settings.KEEP_AWAKE_STOP_TIMEOUT_MS, false, { ref: false });
    if (!(await Promise.race([exited, timeout]))) {
      this.#log(`L1 keep-awake: the helper (pid ${child.pid}) did not end in time`);
    }
  }

  /** Says once, on the setup page and in the log, that this laptop may sleep. */
  #report(why: string): void {
    if (this.#problem !== undefined) return;
    this.#problem = `${why}; it may sleep and stop watching the home. Set it never to sleep.`;
    this.#log(`L1 keep-awake: ${this.#problem}`);
  }

  async #spawn({ file, args, env }: KeepAwakeCommand): Promise<void> {
    let child: ChildProcess;
    try {
      child = spawn(file, args, {
        env: { ...process.env, ...env },
        shell: false,
        stdio: "ignore",
        windowsHide: true,
      });
    } catch (error) {
      this.#report(`cannot start ${file}: ${errorMessage(error)}`);
      return;
    }
    this.#child = child;
    child.once("exit", (code, signal) => {
      this.#child = undefined;
      if (!this.#stopping) this.#report(`${file} ended (${String(code ?? signal)})`);
    });
    const started = new Promise<string | undefined>((resolve) => {
      child.once("spawn", () => resolve(undefined));
      child.once("error", (error: NodeJS.ErrnoException) => {
        this.#child = undefined;
        resolve(error.code === "ENOENT" ? "not found" : error.message);
      });
    });
    const timeout = settings.KEEP_AWAKE_START_TIMEOUT_MS;
    const late = `it did not start within ${timeout} ms`;
    const failed = await Promise.race([started, sleep(timeout, late, { ref: false })]);
    if (failed === undefined) {
      this.#log(`L1 keep-awake: keeping this laptop awake while the bridge runs (${file})`);
    } else {
      this.#report(`cannot start ${file}: ${failed}`);
    }
  }
}
