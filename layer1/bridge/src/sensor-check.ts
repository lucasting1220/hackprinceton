/**
 * Check sensors (Layer 1 ask T6): Layer 3's device list and device check, run without a shell as
 * contracts/README.md gives them, through uv in Layer 3's project, each with the contract's time
 * limit. Neither opens a device itself: only Layer 3's capture program does (ask T4).
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { createInterface } from "node:readline";
import * as settings from "./settings.ts";

/** How a program run ended: its exit code and output, a timeout, or failing to start. */
export type RunResult =
  | Readonly<{ kind: "exited"; code: number | null; stdout: string; lastLine: string }>
  | Readonly<{ kind: "timed_out"; lastLine: string }>
  | Readonly<{ kind: "failed"; message: string }>;

/** Runs `file` with `args`, without a shell; tests pass a fake. */
export type ProgramRunner = (
  file: string,
  args: readonly string[],
  options: Readonly<{ cwd: string; timeoutMs: number }>,
) => Promise<RunResult>;

/** One camera or mic from the device list. */
export type ListedDevice = Readonly<{ name: string; kind: string; sameName: boolean }>;

/** The device list read, or why it could not be. */
export type DeviceListRead =
  | Readonly<{
      ok: true;
      cameras: readonly ListedDevice[];
      mics: readonly ListedDevice[];
      problems: readonly string[];
    }>
  | Readonly<{ ok: false; message: string }>;

/** One device's part of the device check. */
export type DeviceOutcome = Readonly<{
  name: string | null;
  result: string;
  message: string;
  fix: string | null;
  similar: readonly string[];
}>;

/** The device check read, or why it could not be. */
export type DeviceCheckRead =
  | Readonly<{ ok: true; allOk: boolean; camera: DeviceOutcome; mic: DeviceOutcome }>
  | Readonly<{ ok: false; message: string }>;

/** The kinds the pickers offer (contracts/README.md): never built-in, Continuity or virtual. */
const OFFERED_KINDS = ["external", "unknown"];

/** The device list's and check's exit codes (contracts/README.md). */
const EXIT_OK = 0;
const EXIT_BAD_CONFIG = 2;
const EXIT_DEVICE_FAILED = 4;

/** The results a bridge started over SSH on a Mac may get because the permission isn't its own. */
const PERMISSION_RESULTS = ["no_permission", "silent", "open_failed"];

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

function captureCommand(repoRoot: string, mode: readonly string[]) {
  const project = path.join(repoRoot, settings.LAYER3_PROJECT_DIR);
  const run = ["run", "--project", project, "python", "-m", settings.LAYER3_CAPTURE_MODULE];
  return { file: "uv", args: [...run, ...mode] };
}

/** `uv run --project <repo>/layer3 python -m layer3.capture_job list --json`. */
export const deviceListCommand = (repoRoot: string) => captureCommand(repoRoot, ["list", "--json"]);

/** `uv run --project <repo>/layer3 python -m layer3.capture_job check --config <file> --json`. */
export const deviceCheckCommand = (repoRoot: string, configFile: string) =>
  captureCommand(repoRoot, ["check", "--config", configFile, "--json"]);

/** The default runner: spawn without a shell, keep standard output and the last error line. */
export const runProgram: ProgramRunner = (file, args, { cwd, timeoutMs }) =>
  new Promise((resolve) => {
    const child = spawn(file, args, {
      cwd,
      shell: false,
      timeout: timeoutMs,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let lastLine = "no error output";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      if (stdout.length < settings.DEVICE_OUTPUT_MAX_BYTES) stdout += chunk;
    });
    createInterface({ input: child.stderr.setEncoding("utf8") }).on("line", (line) => {
      if (line.trim() !== "") lastLine = line.trim();
    });
    child.once("error", (error: NodeJS.ErrnoException) => {
      const message = error.code === "ENOENT" ? `${file} is not installed` : error.message;
      resolve({ kind: "failed", message });
    });
    child.once("close", (code, signal) => {
      if (signal !== null) resolve({ kind: "timed_out", lastLine });
      else resolve({ kind: "exited", code, stdout, lastLine });
    });
  });

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

function listedDevices(value: unknown): ListedDevice[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const devices: ListedDevice[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return undefined;
    const { name, kind, same_name: sameName } = entry;
    if (typeof name !== "string" || typeof kind !== "string" || typeof sameName !== "boolean") {
      return undefined;
    }
    devices.push({ name, kind, sameName });
  }
  return devices;
}

/** What the device list printed (contracts/device-list.json), or undefined if not that shape. */
export function parseDeviceList(text: string): DeviceListRead | undefined {
  const data = parseJson(text);
  if (!isRecord(data)) return undefined;
  const { schema_version: version, type, problems, cameras: cameraList, mics: micList } = data;
  const cameras = listedDevices(cameraList);
  const mics = listedDevices(micList);
  const shaped = version === settings.DEVICE_LIST_SCHEMA_VERSION && type === "device_list";
  if (!shaped || cameras === undefined || mics === undefined || !isStringList(problems)) {
    return undefined;
  }
  return { ok: true, cameras, mics, problems };
}

function deviceOutcome(value: unknown): DeviceOutcome | undefined {
  if (!isRecord(value)) return undefined;
  const { name, result, message, fix, similar } = value;
  const ok =
    (typeof name === "string" || name === null) &&
    typeof result === "string" &&
    typeof message === "string" &&
    (typeof fix === "string" || fix === null) &&
    isStringList(similar);
  return ok ? { name, result, message, fix, similar } : undefined;
}

/** What the device check printed (contracts/device-check.json), or undefined if not that shape. */
export function parseDeviceCheck(text: string): DeviceCheckRead | undefined {
  const data = parseJson(text);
  if (!isRecord(data)) return undefined;
  const { schema_version: version, type, ok, camera: cameraPart, mic: micPart } = data;
  const camera = deviceOutcome(cameraPart);
  const mic = deviceOutcome(micPart);
  const shaped = version === settings.DEVICE_CHECK_SCHEMA_VERSION && type === "device_check";
  if (!shaped || typeof ok !== "boolean" || camera === undefined || mic === undefined) {
    return undefined;
  }
  return { ok: true, allOk: ok, camera, mic };
}

function failure(what: string, run: RunResult, timeoutMs: number): string {
  if (run.kind === "failed") return `can't run ${what}: ${run.message}`;
  if (run.kind === "timed_out") {
    return `${what} didn't finish within ${Math.round(timeoutMs / 1000)} s: ${run.lastLine}`;
  }
  return `${what} exited with code ${run.code}: ${run.lastLine}`;
}

/** Runs Layer 3's device list; any failure, including its timeout, is a message. */
export async function listDevices(
  repoRoot: string,
  run: ProgramRunner = runProgram,
): Promise<DeviceListRead> {
  const { file, args } = deviceListCommand(repoRoot);
  const timeoutMs = settings.DEVICE_LIST_TIMEOUT_MS;
  const ran = await run(file, args, { cwd: repoRoot, timeoutMs });
  if (ran.kind === "exited" && ran.code === EXIT_OK) {
    const parsed = parseDeviceList(ran.stdout);
    if (parsed !== undefined) return parsed;
    return {
      ok: false,
      message: "Layer 3's device list printed something other than its contract",
    };
  }
  return { ok: false, message: failure("Layer 3's device list", ran, timeoutMs) };
}

/** Runs Layer 3's device check on worker.json; any failure, including its timeout, is a message. */
export async function checkDevices(
  repoRoot: string,
  configFile: string,
  run: ProgramRunner = runProgram,
): Promise<DeviceCheckRead> {
  const { file, args } = deviceCheckCommand(repoRoot, configFile);
  const timeoutMs = settings.DEVICE_CHECK_TIMEOUT_MS;
  const ran = await run(file, args, { cwd: repoRoot, timeoutMs });
  if (ran.kind === "exited" && (ran.code === EXIT_OK || ran.code === EXIT_DEVICE_FAILED)) {
    const parsed = parseDeviceCheck(ran.stdout);
    if (parsed !== undefined) return parsed;
    return {
      ok: false,
      message: "Layer 3's device check printed something other than its contract",
    };
  }
  if (ran.kind === "exited" && ran.code === EXIT_BAD_CONFIG) {
    return {
      ok: false,
      message: `Layer 3's device check couldn't read worker.json: ${ran.lastLine}`,
    };
  }
  return { ok: false, message: failure("Layer 3's device check", ran, timeoutMs) };
}

/** A picker's devices: external first, then unknown; and the names two or more devices share. */
export function pickerChoices(devices: readonly ListedDevice[]) {
  const usable = devices.filter((device) => OFFERED_KINDS.includes(device.kind));
  const offered = usable
    .filter((device) => !device.sameName)
    .sort((a, b) => OFFERED_KINDS.indexOf(a.kind) - OFFERED_KINDS.indexOf(b.kind));
  const flagged = [...new Set(usable.filter((device) => device.sameName).map((d) => d.name))];
  return { offered, flagged };
}

/** A picker's posted value: `device:<name>` for a device, `none` for none. */
export const PICK_NONE = "none";
const PICK_PREFIX = "device:";
export const pickValue = (name: string) => `${PICK_PREFIX}${name}`;

/** The name a picker posted: "" for none, or undefined when nothing usable was picked. */
export function pickedName(value: string | null): string | undefined {
  if (value === PICK_NONE) return "";
  if (value?.startsWith(PICK_PREFIX) !== true) return undefined;
  const name = value.slice(PICK_PREFIX.length);
  return name.trim() === "" ? undefined : name;
}

/** Whether this bridge was started over SSH, where macOS's camera and mic permission isn't its own. */
export function startedOverSsh(env: NodeJS.ProcessEnv = process.env): boolean {
  const { SSH_CONNECTION: connection, SSH_TTY: terminal } = env;
  return Boolean(connection ?? terminal);
}

/** The line telling a Mac bridge started over SSH to start from Terminal.app, when it applies. */
export function sshHint(
  check: DeviceCheckRead,
  overSsh: boolean,
  platform: string = process.platform,
): string | undefined {
  if (!check.ok || !overSsh || platform !== "darwin") return undefined;
  const results = [check.camera.result, check.mic.result];
  if (!results.some((result) => PERMISSION_RESULTS.includes(result))) return undefined;
  return "This bridge was started over SSH, so macOS doesn't give it the camera and mic. Stop it, then start it again directly in a Terminal.app window on this laptop.";
}
