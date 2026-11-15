/**
 * A new laptop's side of Add a laptop (phone-hub.md §6): the join client, the files it writes
 * (worker-token, worker.json and laptop.json, in that order), Layer 2's check, the worker launcher,
 * the worker's status file and the bridge link. A laptop holds either home.json (it is the home
 * laptop) or laptop.json (it joined), never both. The token is written only to its file and kept in
 * memory only as its hash, for the link; neither is logged or shown, nor is any key.
 */
import { execFile, spawn } from "node:child_process";
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { createInterface } from "node:readline";
import {
  errorMessage,
  JsonFileError,
  readFileBytes,
  readJsonFile,
  removePath,
  updateJsonFile,
  writeFileWhole,
} from "./json-file.ts";
import {
  chooseProgram,
  type CoordinatorStatus,
  WorkerLauncher,
  type WorkerLauncherOptions,
  workerCheckCommand,
} from "./launcher.ts";
import { errorKind, type LinkOutcome, type LinkReport, sendLinkReport } from "./link.ts";
import type { LinkCommand } from "./live-view-commands.ts";
import {
  checkedName,
  fromBase64url,
  KEY_BYTES,
  laptopKey,
  open,
  PhoneCryptoRefusal,
  rawPublicKey,
  sharedSecret,
  toBase64url,
  tokenSha256,
} from "./phone-crypto.ts";
import {
  checkDevices,
  type DeviceCheckRead,
  type DeviceListRead,
  listDevices,
  type ProgramRunner,
  runProgram,
} from "./sensor-check.ts";
import * as settings from "./settings.ts";
import { isUtcTime, utcSeconds } from "./wire.ts";

/** One missing item, as contracts/check-output.json and worker-status.json list them. */
export type MissingItem = Readonly<{ id: string; reason: string; required: boolean }>;

/** What Layer 2's check printed, or why it gave nothing usable. */
export type CheckResult =
  | Readonly<{ ok: true; allRequired: boolean; missing: readonly MissingItem[] }>
  | Readonly<{ ok: false; message: string }>;

/** worker-status.json read for this laptop: its state, or what is wrong with the file. */
export type WorkerStatusRead =
  | Readonly<{ ok: true; state: "connected" | "rejected" | "disconnected"; nodeId: string }>
  | Readonly<{ ok: true; state: "none" }>
  | Readonly<{ ok: false; problem: string }>;

/**
 * worker.json's camera and mic: the only devices Layer 3 may open, each named exactly as the
 * operating system shows it, or null when there is none or the resident declined it.
 */
export type Sensors = Readonly<{ camera: string | null; mic: string | null }>;

const NO_SENSORS: Sensors = { camera: null, mic: null };

/** What the Join a home page shows. */
export type LaptopView =
  | Readonly<{ step: "none" }>
  | Readonly<{ step: "finding"; address: string }>
  | Readonly<{ step: "waiting"; qr: string; homeCode: string; expiresAt: string; address: string }>
  | Readonly<{ step: "failed"; message: string }>
  | Readonly<{ step: "setting_up"; doing: string }>
  | Readonly<{ step: "check_failed"; message: string; missing: readonly MissingItem[] }>
  | Readonly<{
      step: "joined";
      name: string;
      nodeId: string;
      homeAddress: string;
      worker: CoordinatorStatus;
      connection: string;
      link: string;
      rejected: boolean;
      sensors: Sensors;
    }>;

/** Where the join is; "joined" is shown from the launcher and the status file. */
type Stage = Exclude<LaptopView, { step: "joined" }> | Readonly<{ step: "joined" }>;

const NOT_STARTED: CoordinatorStatus = {
  program: null,
  state: "stopped",
  lastErrorLine: null,
  pid: null,
};

export interface LaptopOptions {
  readonly stateDir: string;
  /** The repository whose Layer 2 worker, or its stub, the launcher runs. */
  readonly repoRoot: string;
  readonly log?: (line: string) => void;
  /** worker.json's python: what `uv python find 3.12` prints, by default. */
  readonly findPython?: () => Promise<string>;
  readonly now?: () => number;
  /** Tests shorten the waits. */
  readonly joinPollMs?: number;
  readonly linkReportMs?: number;
  readonly checkTimeoutMs?: number;
  readonly launcher?: Partial<Omit<WorkerLauncherOptions, "repoRoot" | "configFile" | "stopFile">>;
  /** Runs Layer 3's device list and check; tests pass a fake. */
  readonly runProgram?: ProgramRunner;
  /** Takes the commands the home laptop's bridge sends over the link: live-sender.ts's LiveSender. */
  readonly linkCommands?: LinkCommandHandler;
}

/** What runs the link's commands on this laptop, and stops with it. */
export interface LinkCommandHandler {
  handle(command: LinkCommand): Promise<void>;
  close(): Promise<void>;
}

/** How often this laptop reports over the link: about every second with a camera, for live view. */
export function linkReportInterval(sensors: Sensors): number {
  return sensors.camera === null ? settings.LINK_REPORT_MS : settings.LINK_CAMERA_REPORT_MS;
}

/** laptop.json: what this laptop joined (Layer 1 only). */
interface Joined {
  readonly homeId: string;
  readonly nodeId: string;
  readonly name: string;
  /** The home laptop's bridge, as "host:port". */
  readonly hubAddress: string;
  readonly hubPublicKey: string;
  readonly coordinatorPort: number;
  readonly tokenSha256: string;
}

/** A join waiting for approval; its private key lives only here, in memory. */
interface JoinSession {
  readonly hub: URL;
  readonly name: string;
  readonly python: string;
  readonly privateKey: KeyObject;
  readonly laptopPublic: Buffer;
  readonly joinId: string;
  readonly hubPublic: Buffer;
  readonly exp: number;
  readonly qr: string;
}

/** The ticket's plaintext fields (§6.4). */
interface Ticket {
  readonly home_id: string;
  readonly node_id: string;
  readonly display_name: string;
  readonly join_token: string;
  readonly coordinator_port: number;
}

/** A failure the page shows as it is. Its message never holds a token, a key or a ticket. */
export class LaptopError extends Error {
  override name = "LaptopError";
}

const TOKEN = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9._-]{1,64}$/;
const isPort = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 0xffff;
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const keysOf = (value: object) => Object.keys(value).sort().join(",");
const utf8 = new TextDecoder("utf-8", { fatal: true });

/**
 * The home laptop's bridge from what the person typed: a.b.c.d, a host name or an IPv6 address,
 * with or without a port (7480 by default). Undefined if it is anything else, such as a URL path.
 */
export function hubUrl(typed: string): URL | undefined {
  let text = typed.trim();
  if (text === "" || /[\s/?#@\\]/.test(text)) return undefined;
  if (isIP(text) === 6) text = `[${text}]`;
  if (!URL.canParse(`http://${text}`)) return undefined;
  const url = new URL(`http://${text}`);
  if (url.port === "") url.port = String(settings.BRIDGE_NETWORK_PORT);
  return url;
}

/**
 * worker.json's coordinator_url: ws://<the host this laptop reached>:<listen_port>/ws, built with
 * the URL API (contracts/README.md), so an IPv6 address keeps its brackets.
 */
export function coordinatorUrl(hub: URL, coordinatorPort: number): string {
  const url = new URL("/ws", `ws://${hub.hostname}`);
  url.port = String(coordinatorPort);
  return url.href;
}

/** The join QR code's compact JSON (§6.1): the app's JoinQR fields and the hub's whole key. */
export function joinQrPayload(fields: {
  joinId: string;
  name: string;
  laptopPublic: Uint8Array;
  exp: number;
  hubPublic: string;
}): string {
  return JSON.stringify({
    v: 1,
    kind: "join",
    join_id: fields.joinId,
    name: fields.name,
    laptop_pub: toBase64url(fields.laptopPublic),
    exp: fields.exp,
    hub_pub: fields.hubPublic,
  });
}

/** Opens a join ticket with the laptop's key (§6.4) and checks its fields. */
export function openTicket(
  envelope: unknown,
  session: Pick<JoinSession, "privateKey" | "laptopPublic" | "joinId" | "hubPublic">,
): Ticket {
  const bad = () => new LaptopError("the home laptop's answer doesn't open with this laptop's key");
  const { v, kid, n, c } = isRecord(envelope) ? envelope : {};
  if (kid !== "join" || typeof v !== "number" || typeof n !== "string" || typeof c !== "string") {
    throw bad();
  }
  let bytes: Buffer;
  try {
    const shared = sharedSecret(session.privateKey, session.hubPublic);
    const key = laptopKey(shared, session.joinId, session.hubPublic, session.laptopPublic);
    bytes = open({ v, kid, n, c }, key, { homeId: "", type: "join_ticket" });
  } catch (error) {
    if (error instanceof PhoneCryptoRefusal) throw bad();
    throw error;
  }
  let ticket: unknown;
  try {
    ticket = JSON.parse(utf8.decode(bytes));
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) throw bad();
    throw error;
  } finally {
    bytes.fill(0);
  }
  const fields = isRecord(ticket) ? ticket : {};
  const { type, home_id, node_id, display_name, join_token, coordinator_port } = fields;
  const ok =
    type === "join_ticket" &&
    typeof home_id === "string" &&
    typeof node_id === "string" &&
    ID.test(node_id) &&
    typeof display_name === "string" &&
    typeof join_token === "string" &&
    TOKEN.test(join_token) &&
    isPort(coordinator_port);
  if (!ok) throw bad();
  return { home_id, node_id, display_name, join_token, coordinator_port };
}

/** Every path in a worker laptop's state folder. */
export function workerFiles(stateDir: string) {
  const at = (name: string) => path.join(stateDir, name);
  const names = settings.WORKER_STATE_NAMES;
  return {
    laptop: at(names.laptop),
    config: at(names.workerConfig),
    token: at(names.workerToken),
    status: at(names.workerStatus),
    stop: at(names.workerStop),
    pid: at(names.workerPid),
    workerStateDir: at(names.workerStateDir),
  };
}

/**
 * A camera or mic name as typed on the joined laptop's page: the trimmed name, null for an empty
 * field, or undefined when it is too long or holds a control character.
 */
export function sensorName(typed: string): string | null | undefined {
  const name = typed.trim();
  if (name === "") return null;
  if ([...name].length > settings.SENSOR_NAME_MAX_CHARS || /\p{Cc}/u.test(name)) return undefined;
  return name;
}

/** worker.json's camera and mic, or none when the file or either field isn't usable. */
function sensorsOf(config: unknown): Sensors {
  const { camera, mic } = isRecord(config) ? config : {};
  const named = (value: unknown) => (typeof value === "string" ? value : null);
  return { camera: named(camera), mic: named(mic) };
}

/**
 * worker.json (contracts/worker.json): every field, with absolute paths. Camera and mic are null
 * until the joined laptop's page names them.
 */
export function workerConfig(
  stateDir: string,
  joined: Joined,
  hub: URL,
  python: string,
  sensors: Sensors = NO_SENSORS,
) {
  const files = workerFiles(stateDir);
  return {
    schema_version: 1,
    home_id: joined.homeId,
    node_id: joined.nodeId,
    display_name: joined.name,
    coordinator_url: coordinatorUrl(hub, joined.coordinatorPort),
    token_file: files.token,
    camera: sensors.camera,
    mic: sensors.mic,
    frame_feed_port: settings.FRAME_FEED_PORT,
    ollama_url: settings.OLLAMA_URL,
    python,
    status_file: files.status,
    stop_file: files.stop,
    state_dir: files.workerStateDir,
  };
}

/** A missing item from check or the status file, or undefined if it isn't one. */
function missingItem(value: unknown): MissingItem | undefined {
  if (!isRecord(value) || keysOf(value) !== "id,reason,required") return undefined;
  const { id, reason, required } = value;
  if (typeof id !== "string" || typeof reason !== "string" || typeof required !== "boolean") {
    return undefined;
  }
  return { id, reason, required };
}

function missingList(value: unknown): MissingItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.map(missingItem);
  return items.every((item) => item !== undefined) ? items : undefined;
}

/** What check printed (contracts/check-output.json), or undefined if it isn't that shape. */
export function parseCheckOutput(text: string): CheckResult | undefined {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
  if (!isRecord(data) || keysOf(data) !== "missing,ok,schema_version") return undefined;
  const { schema_version: version, ok, missing: listed } = data;
  const missing = missingList(listed);
  if (version !== 1 || typeof ok !== "boolean" || missing === undefined) return undefined;
  return { ok: true, allRequired: ok, missing };
}

/**
 * Runs Layer 2's check on worker.json, without a shell, from the repository: exit 0 or 4 with
 * check-output.json's shape is a result; a timeout, a missing uv or other output is a message
 * with its last error line.
 */
export function runCheck(repoRoot: string, configFile: string, timeoutMs: number) {
  const program = chooseProgram(repoRoot, "layer2-worker");
  const { file, args } = workerCheckCommand(program, repoRoot, configFile);
  return new Promise<CheckResult>((resolve) => {
    const child = spawn(file, args, {
      cwd: repoRoot,
      shell: false,
      timeout: timeoutMs,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let lastLine = "no error output";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      if (stdout.length < settings.JSON_REQUEST_MAX_BYTES) stdout += chunk;
    });
    createInterface({ input: child.stderr.setEncoding("utf8") }).on("line", (line) => {
      if (line.trim() !== "") lastLine = line.trim();
    });
    child.once("error", (error: NodeJS.ErrnoException) => {
      const message = error.code === "ENOENT" ? `${file} is not installed` : error.message;
      resolve({ ok: false, message: `can't run the check: ${message}` });
    });
    child.once("close", (code, signal) => {
      const parsed = code === 0 || code === 4 ? parseCheckOutput(stdout) : undefined;
      if (parsed !== undefined) return resolve(parsed);
      const seconds = Math.round(timeoutMs / 1000);
      const why =
        signal === null ? `exited with code ${code}` : `didn't finish within ${seconds} s`;
      resolve({ ok: false, message: `the check ${why}: ${lastLine}` });
    });
  });
}

/** worker-status.json, if Layer 2 has written it, checked against contracts/worker-status.json. */
export async function readWorkerStatus(file: string): Promise<WorkerStatusRead> {
  let data: unknown;
  try {
    data = await readJsonFile(file);
  } catch (error) {
    if (error instanceof JsonFileError && error.code === "ENOENT")
      return { ok: true, state: "none" };
    if (error instanceof JsonFileError) return { ok: false, problem: error.message };
    throw error;
  }
  const keys = "missing,node_id,schema_version,state,updated_at";
  const fields = isRecord(data) && keysOf(data) === keys ? data : {};
  const { schema_version: version, node_id: nodeId, state: written, missing, updated_at } = fields;
  const state = (["connected", "rejected", "disconnected"] as const).find((s) => s === written);
  const ok =
    version === 1 &&
    typeof nodeId === "string" &&
    missingList(missing) !== undefined &&
    isUtcTime(updated_at);
  if (!ok || state === undefined) {
    return { ok: false, problem: `${file} doesn't match its contract` };
  }
  return { ok: true, state, nodeId };
}

/** `uv python find 3.12`, without a shell: worker.json's python. */
export function findPython(): Promise<string> {
  const args = ["python", "find", settings.WORKER_PYTHON_VERSION];
  const options = { timeout: settings.PYTHON_FIND_TIMEOUT_MS, shell: false, windowsHide: true };
  return new Promise((resolve, reject) => {
    execFile("uv", args, options, (error, stdout) => {
      const found = stdout.trim();
      if (error === null && path.isAbsolute(found)) return resolve(found);
      const missingUv = error !== null && "code" in error && error.code === "ENOENT";
      const install = `run uv python install ${settings.WORKER_PYTHON_VERSION}`;
      const why = missingUv
        ? "uv is not installed"
        : `Python ${settings.WORKER_PYTHON_VERSION} is missing: ${install}`;
      reject(new LaptopError(why));
    });
  });
}

/** laptop.json's fields, or undefined if it isn't a joined laptop's. */
function parseJoined(data: unknown, tokenHash: string): Joined | undefined {
  const fields = isRecord(data) ? data : {};
  const { schema_version: version, home_id, node_id, display_name } = fields;
  const { hub_address, hub_public_key, coordinator_port } = fields;
  if (version !== 1) return undefined;
  const strings = [home_id, node_id, display_name, hub_address, hub_public_key];
  if (!strings.every((value) => typeof value === "string") || !isPort(coordinator_port)) {
    return undefined;
  }
  return {
    homeId: String(home_id),
    nodeId: String(node_id),
    name: String(display_name),
    hubAddress: String(hub_address),
    hubPublicKey: String(hub_public_key),
    coordinatorPort: coordinator_port,
    tokenSha256: tokenHash,
  };
}

/** A failed answer from the home laptop's bridge, in the person's words. */
function unreachable(hub: URL, error: unknown): LaptopError {
  const kind = errorKind(error);
  const hint =
    kind === "EHOSTUNREACH"
      ? "If macOS asked whether to find devices on the local network, allow it, and start the bridge from Terminal.app"
      : "Check that both laptops are on the same network";
  return new LaptopError(`Can't reach the home laptop at ${hub.host} (${kind}). ${hint}.`);
}

/** POSTs JSON to the home laptop's bridge; the body is undefined if the answer isn't JSON. */
async function postJson(hub: URL, target: string, body: unknown) {
  let response: Response;
  try {
    response = await fetch(new URL(target, hub), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(settings.JOIN_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw unreachable(hub, error);
  }
  const answer: unknown = await response.json().catch((error: unknown) => {
    if (error instanceof SyntaxError) return undefined;
    throw unreachable(hub, error);
  });
  return { status: response.status, body: answer };
}

const NOT_A_HOME = "That address is not a Debbie home laptop. Type the address its page shows.";

/** The join, the worker's setup and the link, for one laptop's state folder. */
export class Laptop {
  readonly #options: LaptopOptions;
  readonly #files: ReturnType<typeof workerFiles>;
  readonly #log: (line: string) => void;
  readonly #now: () => number;
  #view: Stage = { step: "none" };
  #session: JoinSession | undefined;
  #joined: Joined | undefined;
  #launcher: WorkerLauncher | undefined;
  #status: WorkerStatusRead = { ok: true, state: "none" };
  #disconnectedSince: number | undefined;
  #link: LinkOutcome | undefined;
  #missing: readonly MissingItem[] = [];
  #sensors: Sensors = NO_SENSORS;
  /** A live view session whose sender window couldn't start or closed, until a report says so. */
  #liveViewLost: string | undefined;
  readonly #timers = new Set<NodeJS.Timeout>();
  /** The generation whose link reports run, so Check again starts no second loop. */
  #linking = -1;
  /** Counts joins and resets, so an answer for an earlier one is ignored. */
  #generation = 0;
  #closed = false;

  constructor(options: LaptopOptions) {
    this.#options = options;
    this.#files = workerFiles(options.stateDir);
    this.#log = options.log ?? ((line: string) => console.log(line));
    this.#now = options.now ?? Date.now;
  }

  /** Whether this laptop is joining or has joined a home: the role lock's half (A4). */
  busy(): boolean {
    return this.#view.step !== "none" || existsSync(this.#files.laptop);
  }

  view(): LaptopView {
    const joined = this.#joined;
    if (this.#view.step !== "joined") return this.#view;
    return joined === undefined ? { step: "none" } : this.#joinedView(joined);
  }

  /** Starts joining the home whose bridge is at `address`; the page then shows each step. */
  join(address: string, name: string): { ok: true } | { ok: false; message: string } {
    if (this.busy()) return { ok: false, message: "This laptop is already joining a home." };
    const hub = hubUrl(address);
    if (hub === undefined) {
      return {
        ok: false,
        message: "Type the home laptop's address as its page shows it, such as 192.168.1.20.",
      };
    }
    let checked: string;
    try {
      checked = checkedName(name);
    } catch (error) {
      if (!(error instanceof PhoneCryptoRefusal)) throw error;
      return { ok: false, message: "Give this laptop a name of 1 to 64 characters." };
    }
    this.#view = { step: "finding", address: hub.host };
    this.#run(this.#find(hub, checked, ++this.#generation));
    return { ok: true };
  }

  /** Show a new code, Join again, Cancel or Leave this home: drops the join and its files. */
  async reset(): Promise<void> {
    this.#generation += 1;
    this.#session = undefined;
    this.#stopTimers();
    await this.#launcher?.stop();
    this.#launcher = undefined;
    for (const file of [
      this.#files.laptop,
      this.#files.config,
      this.#files.token,
      this.#files.status,
    ]) {
      await removePath(file);
    }
    this.#joined = undefined;
    this.#sensors = NO_SENSORS;
    this.#view = { step: "none" };
  }

  /** Layer 3's device list, for the Camera and mic page's pickers. */
  listDevices(): Promise<DeviceListRead> {
    return listDevices(this.#options.repoRoot, this.#options.runProgram ?? runProgram);
  }

  /**
   * Saves the camera and mic into worker.json, then, with the worker stopped, runs Layer 3's
   * device check on them (contracts/README.md: check runs before the worker starts), then starts
   * the worker again so Layer 2 reads them. Without the resident's consent both are null; an
   * empty name means none, and with neither named there is no check.
   */
  async saveSensors(
    camera: string,
    mic: string,
    consent: boolean,
  ): Promise<{ ok: true; check?: DeviceCheckRead } | { ok: false; message: string }> {
    const launcher = this.#launcher;
    if (this.view().step !== "joined" || launcher === undefined) {
      return { ok: false, message: "This laptop hasn't finished joining a home." };
    }
    const named = { camera: sensorName(camera), mic: sensorName(mic) };
    if (consent && (named.camera === undefined || named.mic === undefined)) {
      const most = settings.SENSOR_NAME_MAX_CHARS;
      return {
        ok: false,
        message: `Type each name as the operating system shows it, in at most ${most} characters, on one line.`,
      };
    }
    const sensors: Sensors = consent
      ? { camera: named.camera ?? null, mic: named.mic ?? null }
      : NO_SENSORS;
    const generation = this.#generation;
    await updateJsonFile(this.#files.config, (config) => {
      if (!isRecord(config)) throw new LaptopError(`${this.#files.config} is damaged.`);
      return { ...config, camera: sensors.camera, mic: sensors.mic };
    });
    if (generation !== this.#generation) return { ok: true };
    this.#sensors = sensors;
    this.#log("L1 laptop: camera and mic saved; restarting the worker");
    await launcher.stop();
    await removePath(this.#files.status);
    let check: DeviceCheckRead | undefined;
    if (sensors.camera !== null || sensors.mic !== null) {
      const run = this.#options.runProgram ?? runProgram;
      check = await checkDevices(this.#options.repoRoot, this.#files.config, run);
      const said = check.ok ? (check.allOk ? "passed" : "found a problem") : check.message;
      this.#log(`L1 laptop: Layer 3's device check ${said}`);
    }
    if (generation === this.#generation) await launcher.start();
    return check === undefined ? { ok: true } : { ok: true, check };
  }

  /** Check again, after check found a required item missing. */
  checkAgain(): void {
    if (this.#view.step === "check_failed") this.#run(this.#setUp(this.#generation));
  }

  /** At start: a laptop that joined earlier starts its worker again, with its node ID and token. */
  async resume(): Promise<void> {
    let data: unknown;
    try {
      data = await readJsonFile(this.#files.laptop);
    } catch (error) {
      if (error instanceof JsonFileError && error.code === "ENOENT") return;
      if (!(error instanceof JsonFileError)) throw error;
      this.#view = {
        step: "failed",
        message: `This laptop's files can't be read: ${error.message}`,
      };
      return;
    }
    const token = await readTokenFile(this.#files.token);
    const joined = token === undefined ? undefined : parseJoined(data, tokenSha256(token));
    if (joined === undefined) {
      const message = `${this.#files.laptop} or its token file is damaged. Join again to replace them.`;
      this.#view = { step: "failed", message };
      return;
    }
    this.#joined = joined;
    this.#sensors = await readJsonFile(this.#files.config).then(sensorsOf, (error: unknown) => {
      if (error instanceof JsonFileError) return NO_SENSORS;
      throw error;
    });
    this.#log(`L1 laptop: joined as node ${joined.nodeId}; starting the worker`);
    await this.#setUp(this.#generation);
  }

  /** Tells the home laptop, in the next link report, that live view session `sessionId` is lost. */
  liveViewLost(sessionId: string): void {
    this.#liveViewLost = sessionId;
  }

  /** Stops the worker, the sender window and every timer. */
  async close(): Promise<void> {
    this.#closed = true;
    this.#generation += 1;
    this.#stopTimers();
    await this.#options.linkCommands?.close();
    await this.#launcher?.stop();
  }

  /** Runs a step in the background; a failure shows on the page instead of ending the bridge. */
  #run(step: Promise<void>): void {
    step.catch((error: unknown) => {
      const message =
        error instanceof LaptopError
          ? error.message
          : `Something went wrong: ${errorMessage(error)}`;
      if (!(error instanceof LaptopError)) this.#log(`L1 laptop: ${errorMessage(error)}`);
      this.#view = { step: "failed", message };
    });
  }

  #later(ms: number, action: () => Promise<void>): void {
    if (this.#closed) return;
    const timer = setTimeout(() => {
      this.#timers.delete(timer);
      this.#run(action());
    }, ms);
    this.#timers.add(timer);
  }

  #stopTimers(): void {
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
  }

  /** Find the home: Python first, then the join request with a fresh key pair. */
  async #find(hub: URL, name: string, generation: number): Promise<void> {
    const python = await (this.#options.findPython ?? findPython)();
    const { privateKey } = generateKeyPairSync("x25519");
    const laptopPublic = rawPublicKey(privateKey);
    const sent = { v: 1, name, laptop_pub: toBase64url(laptopPublic) };
    const { status, body } = await postJson(hub, "/v1/join", sent);
    if (generation !== this.#generation) return;
    if (status === 429) {
      throw new LaptopError(
        "Too many laptops are waiting for approval. Try again in a few minutes.",
      );
    }
    if (status === 400) throw new LaptopError("The home laptop refused this laptop's name.");
    const { join_id: joinId, exp, hub_pub: hubPub } = isRecord(body) ? body : {};
    let hubPublic: Buffer;
    try {
      hubPublic = fromBase64url(hubPub, KEY_BYTES);
    } catch (error) {
      if (error instanceof PhoneCryptoRefusal) throw new LaptopError(NOT_A_HOME);
      throw error;
    }
    if (status !== 202 || typeof joinId !== "string" || !Number.isInteger(exp)) {
      throw new LaptopError(NOT_A_HOME);
    }
    const expSeconds = Number(exp);
    const qr = joinQrPayload({
      joinId,
      name,
      laptopPublic,
      exp: expSeconds,
      hubPublic: String(hubPub),
    });
    this.#session = {
      hub,
      name,
      python,
      privateKey,
      laptopPublic,
      joinId,
      hubPublic,
      exp: expSeconds,
      qr,
    };
    this.#view = {
      step: "waiting",
      qr,
      homeCode: String(hubPub).slice(0, settings.HUB_TAG_CHARS),
      expiresAt: utcSeconds(new Date(expSeconds * 1000)),
      address: hub.host,
    };
    this.#log(`L1 laptop: waiting for a caregiver to approve join ${joinId}`);
    this.#later(this.#options.joinPollMs ?? settings.JOIN_POLL_MS, () => this.#poll(generation));
  }

  /** Asks whether the join was approved, every JOIN_POLL_MS until an answer ends it. */
  async #poll(generation: number): Promise<void> {
    const session = this.#session;
    if (session === undefined || generation !== this.#generation) return;
    const again = () =>
      this.#later(this.#options.joinPollMs ?? settings.JOIN_POLL_MS, () => this.#poll(generation));
    let answer: { status: number; body: unknown };
    try {
      answer = await postJson(session.hub, "/v1/join/status", { v: 1, join_id: session.joinId });
    } catch (error) {
      if (!(error instanceof LaptopError)) throw error;
      if (this.#now() >= session.exp * 1000) throw new LaptopError("This code expired.");
      return again(); // the home laptop may be busy for a moment; the code says when to stop
    }
    if (generation !== this.#generation) return;
    const { status, body } = answer;
    if (status === 202) return again();
    if (status === 410) throw new LaptopError("This code expired.");
    if (status === 409) throw new LaptopError("A caregiver declined this laptop.");
    if (status === 404)
      throw new LaptopError("The home laptop restarted, so its code no longer works.");
    if (status !== 200 || !isRecord(body)) throw new LaptopError(NOT_A_HOME);
    const { ticket: sealed } = body;
    const ticket = openTicket(sealed, session);
    this.#session = undefined;
    await this.#writeFiles(session, ticket);
    await this.#setUp(generation);
  }

  /** The token file, then worker.json, then laptop.json, which marks the laptop joined. */
  async #writeFiles(session: JoinSession, ticket: Ticket): Promise<void> {
    this.#view = { step: "setting_up", doing: "Writing this laptop's files" };
    const joined: Joined = {
      homeId: ticket.home_id,
      nodeId: ticket.node_id,
      name: ticket.display_name,
      hubAddress: session.hub.host,
      hubPublicKey: toBase64url(session.hubPublic),
      coordinatorPort: ticket.coordinator_port,
      tokenSha256: tokenSha256(ticket.join_token),
    };
    const { stateDir } = this.#options;
    const folder = { recursive: true, mode: settings.PRIVATE_DIR_MODE } as const;
    await mkdir(this.#files.workerStateDir, folder);
    await writeFileWhole(this.#files.token, ticket.join_token);
    const config = workerConfig(stateDir, joined, session.hub, session.python);
    await writeFileWhole(this.#files.config, json(config));
    const laptopJson = {
      schema_version: 1,
      home_id: joined.homeId,
      node_id: joined.nodeId,
      display_name: joined.name,
      hub_address: joined.hubAddress,
      hub_public_key: joined.hubPublicKey,
      coordinator_port: joined.coordinatorPort,
      joined_at: utcSeconds(new Date(this.#now())),
    };
    await writeFileWhole(this.#files.laptop, json(laptopJson));
    this.#joined = joined;
    this.#sensors = NO_SENSORS;
    this.#log(`L1 laptop: joined the home as node ${joined.nodeId}`);
  }

  /** Layer 2's check, then the worker, the status file's watch and the link. */
  async #setUp(generation: number): Promise<void> {
    this.#view = {
      step: "setting_up",
      doing: "Checking this laptop (the first check can take a few minutes)",
    };
    this.#startLink(generation);
    const timeout = this.#options.checkTimeoutMs ?? settings.WORKER_CHECK_TIMEOUT_MS;
    const checked = await runCheck(this.#options.repoRoot, this.#files.config, timeout);
    if (generation !== this.#generation) return;
    if (!checked.ok) {
      this.#view = { step: "check_failed", message: checked.message, missing: [] };
      return;
    }
    this.#missing = checked.missing;
    if (!checked.allRequired) {
      const message = "This laptop is missing something the worker needs.";
      this.#view = { step: "check_failed", message, missing: checked.missing };
      return;
    }
    this.#view = { step: "setting_up", doing: "Starting the worker" };
    await removePath(this.#files.status);
    this.#launcher ??= new WorkerLauncher({
      ...this.#options.launcher,
      repoRoot: this.#options.repoRoot,
      configFile: this.#files.config,
      stopFile: this.#files.stop,
      pidFile: this.#files.pid,
      log: this.#log,
    });
    await this.#launcher.start();
    this.#view = { step: "joined" };
    this.#watchStatus(generation);
  }

  /** Reads the status file every WORKER_STATUS_POLL_MS. */
  #watchStatus(generation: number): void {
    const read = async () => {
      if (generation !== this.#generation) return;
      this.#status = await readWorkerStatus(this.#files.status);
      const connected = this.#status.ok && this.#status.state === "connected";
      if (connected) this.#disconnectedSince = undefined;
      else this.#disconnectedSince ??= this.#now();
      this.#later(settings.WORKER_STATUS_POLL_MS, read);
    };
    this.#run(read());
  }

  /** Reports to the home laptop's bridge every LINK_REPORT_MS while joined. */
  #startLink(generation: number): void {
    if (this.#linking === generation) return;
    this.#linking = generation;
    const report = async () => {
      const joined = this.#joined;
      if (joined === undefined || generation !== this.#generation) return;
      const target = {
        hubUrl: `http://${joined.hubAddress}`,
        homeId: joined.homeId,
        nodeId: joined.nodeId,
        tokenSha256: joined.tokenSha256,
      };
      const lost = this.#liveViewLost;
      const sent = this.#report();
      const outcome = await sendLinkReport(
        target,
        lost === undefined ? sent : { ...sent, live_view_lost: lost },
        this.#now,
      );
      this.#link = outcome;
      if (outcome.ok) {
        if (this.#liveViewLost === lost) this.#liveViewLost = undefined;
        this.#runCommands(outcome);
      }
      this.#later(this.#options.linkReportMs ?? linkReportInterval(this.#sensors), report);
    };
    this.#run(report());
  }

  /** Hands each command from the home laptop to its handler, in order; none without one. */
  #runCommands(outcome: Extract<LinkOutcome, { ok: true }>): void {
    if (outcome.ignored > 0) {
      this.#log(`L1 laptop: ignored ${outcome.ignored} malformed command(s) from the home laptop`);
    }
    const handler = this.#options.linkCommands;
    for (const command of outcome.commands) {
      if (handler === undefined) {
        this.#log(`L1 laptop: no handler here for ${command.type}; ignored`);
        continue;
      }
      handler.handle(command).catch((error: unknown) => {
        this.#log(`L1 laptop: ${command.type} failed: ${errorMessage(error)}`);
      });
    }
  }

  /** The link report: this laptop's setup state and what it is missing. */
  #report(): LinkReport {
    const view = this.view();
    if (view.step !== "joined") return { state: view.step, missing: this.#missing };
    const state = view.rejected ? "rejected" : this.#connection();
    return { state, missing: this.#missing };
  }

  #connection(): "connected" | "connecting" | "restarting" | "stopped" {
    if (this.#launcher?.status().state === "restarting") return "restarting";
    const status = this.#status;
    const mine = status.ok && status.state !== "none" && status.nodeId === this.#joined?.nodeId;
    if (mine && status.state === "connected") return "connected";
    return this.#launcher?.status().state === "running" ? "connecting" : "stopped";
  }

  #joinedView(joined: Joined): LaptopView {
    const worker = this.#launcher?.status() ?? NOT_STARTED;
    const status = this.#status;
    const rejected =
      worker.state === "rejected" ||
      (status.ok && status.state === "rejected" && status.nodeId === joined.nodeId);
    const waited =
      this.#disconnectedSince === undefined ? 0 : this.#now() - this.#disconnectedSince;
    const words = {
      connected: "Joined",
      connecting:
        waited >= settings.WORKER_CONNECT_HINT_MS
          ? `Connecting to the home at ${joined.hubAddress}. Check that the home laptop's bridge is running and both laptops are on the same network.`
          : `Connecting to the home at ${joined.hubAddress}…`,
      restarting: `Restarting the worker after a crash: ${worker.lastErrorLine ?? "no error output"}`,
      stopped: `The worker isn't running: ${worker.lastErrorLine ?? worker.state.replace("_", " ")}`,
    };
    const link = this.#link;
    const linkWords =
      link === undefined
        ? "not connected yet"
        : link.ok
          ? "connected"
          : `not connected: ${link.reason}`;
    const problem = status.ok ? "" : ` (${status.problem})`;
    return {
      step: "joined",
      name: joined.name,
      nodeId: joined.nodeId,
      homeAddress: joined.hubAddress,
      worker,
      connection: `${words[this.#connection()]}${problem}`,
      link: linkWords,
      rejected,
      sensors: this.#sensors,
    };
  }
}

/** The token file's text, or undefined when it is missing or malformed. */
async function readTokenFile(file: string): Promise<string | undefined> {
  try {
    const token = (await readFileBytes(file)).toString("utf8");
    return TOKEN.test(token) ? token : undefined;
  } catch (error) {
    if (error instanceof JsonFileError) return undefined;
    throw error;
  }
}

const json = (data: unknown): string => `${JSON.stringify(data, null, 2)}\n`;
