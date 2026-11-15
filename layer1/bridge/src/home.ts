import * as crypto from "node:crypto";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  errorMessage,
  JsonFileError,
  readFileBytes,
  readJsonFile,
  removePath,
  updateJsonFile,
  writeFileWhole,
} from "./json-file.ts";
import * as settings from "./settings.ts";

/** What later steps need to know about the home. It never holds the home key or the private key. */
export interface Home {
  readonly homeId: string;
  /** The hub's raw 32-byte X25519 public key in base64url, as the pairing QR code carries it. */
  readonly hubPublicKey: string;
  /** The dashboard port in coordinator.json, for the dashboard link. */
  readonly dashboardPort: number;
  /** coordinator.json's listen_port, where workers reach the coordinator; join tickets carry it. */
  readonly listenPort: number;
  readonly stateDir: string;
  readonly coordinatorConfigFile: string;
  readonly acceptedWorkersFile: string;
  readonly stopFile: string;
  readonly coordinatorStateDir: string;
}

/** The home's secrets, as key objects that print no key material. Never log them anyway. */
export interface HomeSecrets {
  readonly homeKey: crypto.KeyObject;
  readonly hubPrivateKey: crypto.KeyObject;
}

export interface CreateHomeOptions {
  /** The ports written to coordinator.json; settings.ts's by default. */
  readonly ports?: { readonly listen: number; readonly dashboard: number; readonly client: number };
  /** coordinator.json's bridge_url: the setup page's address; settings.BRIDGE_URL by default. */
  readonly bridgeUrl?: string;
  /** Writes each file whole; tests pass one that fails. */
  readonly writeFile?: typeof writeFileWhole;
  /** Removes what a failed creation wrote; tests pass one that fails. */
  readonly remove?: typeof removePath;
}

/** Home files that cannot be read or created. The message names the file or folder involved. */
export class HomeError extends Error {
  override name = "HomeError";
}

/** createHome's refusal: the state folder already holds a home, which is never replaced. */
export class HomeExistsError extends HomeError {
  override name = "HomeExistsError";
}

const DEFAULT_PORTS = {
  listen: settings.COORDINATOR_LISTEN_PORT,
  dashboard: settings.DASHBOARD_PORT,
  client: settings.COORDINATOR_CLIENT_PORT,
};

/** Every home operation in this process waits for the one before it to finish (R2). */
let queue: Promise<unknown> = Promise.resolve();

function locked<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(operation);
  queue = Promise.allSettled([result]);
  return result;
}

/** The state folder: `--state-dir`, which must be absolute, or else this system's default. */
export function resolveStateDir(
  stateDirOption: string | undefined,
  platform = process.platform,
  env = process.env,
  homeDir = os.homedir(),
): string {
  const paths = platform === "win32" ? path.win32 : path.posix;
  const defaults: Partial<Record<NodeJS.Platform, string>> = {
    darwin: paths.join(homeDir, ...settings.MACOS_APP_DATA_DIRS, settings.STATE_DIR_NAME),
    win32: paths.join(env[settings.WINDOWS_APP_DATA_ENV] ?? "", settings.STATE_DIR_NAME),
  };
  const stateDir = stateDirOption ?? defaults[platform] ?? "";
  // Layer 2 does not count a Windows path without a drive or share, such as \Debbie, as absolute.
  const driveless = platform === "win32" && paths.parse(stateDir).root.length === 1;
  if (!paths.isAbsolute(stateDir) || driveless) {
    throw new Error("the state folder must be an absolute path: pass --state-dir <folder>");
  }
  return paths.normalize(stateDir);
}

/** Creates the home in `stateDir`. Throws HomeExistsError if one exists: a home is never replaced. */
export function createHome(stateDir: string, options: CreateHomeOptions = {}): Promise<Home> {
  return locked(() => create(stateDir, options));
}

/**
 * The home in `stateDir`, or undefined when there is none. Unreadable or invalid files throw a
 * HomeError naming the file ("home files unreadable"); this never creates a home.
 */
export function loadHome(stateDir: string): Promise<Home | undefined> {
  return locked(() => load(stateDir));
}

/** Reads the home key and the hub's private key, for later steps. Never log what it returns. */
export function readHomeSecrets(stateDir: string): Promise<HomeSecrets> {
  return locked(() => readSecrets(filesIn(stateDir)));
}

async function create(stateDir: string, options: CreateHomeOptions): Promise<Home> {
  const { ports = DEFAULT_PORTS, writeFile = writeFileWhole } = options;
  const files = filesIn(stateDir);
  const { privateKey } = crypto.generateKeyPairSync("x25519");
  const home = homeAt(stateDir, crypto.randomUUID(), publicKeyOf(privateKey), ports);
  const homeJson = {
    schema_version: 1,
    home_id: home.homeId,
    created_at: new Date().toISOString(),
    hub_public_key: home.hubPublicKey,
  };
  const coordinatorJson = {
    schema_version: 1,
    home_id: home.homeId,
    listen_port: ports.listen,
    dashboard_port: ports.dashboard,
    client_port: ports.client,
    ollama_url: settings.OLLAMA_URL,
    bridge_url: options.bridgeUrl ?? settings.BRIDGE_URL,
    ...coordinatorPaths(home),
  };
  // home.json goes first, created exclusively: it is what makes a home exist (R2).
  const contents: [string, string | Uint8Array][] = [
    [files.home, json(homeJson)],
    [files.homeKey, crypto.randomBytes(settings.HOME_KEY_BYTES)],
    [files.hubPrivateKey, privateKey.export({ format: "der", type: "pkcs8" })],
    [home.coordinatorConfigFile, json(coordinatorJson)],
    [home.acceptedWorkersFile, json({ schema_version: 1, workers: [] })],
  ];
  const folder = { recursive: true, mode: settings.PRIVATE_DIR_MODE } as const;
  const written: string[] = [];
  try {
    for (const [file, content] of contents) {
      const createdDir = await mkdir(path.dirname(file), folder);
      if (createdDir !== undefined) written.push(createdDir);
      await writeFile(file, content, { exclusive: true });
      written.push(file);
    }
  } catch (error) {
    const exists = error instanceof JsonFileError && error.code === "EEXIST";
    if (exists && error.filePath === files.home) {
      throw new HomeExistsError(`a home already exists in ${stateDir}`);
    }
    throw await undo(written.reverse(), error, stateDir, options.remove);
  }
  console.log(`L1 home: home created, home_id ${home.homeId}, in ${stateDir}`);
  return home;
}

/** Removes what a failed creation wrote, newest first, and returns the error to report (R3). */
async function undo(written: string[], failure: unknown, stateDir: string, remove = removePath) {
  const reason = `could not create the home: ${errorMessage(failure)}`;
  const deleteFolder = `so delete the folder ${stateDir}`;
  try {
    for (const entry of written) {
      await remove(entry);
    }
  } catch (error) {
    const stuck = `${reason}; undoing it failed too (${errorMessage(error)})`;
    return new HomeError(`${stuck}, ${deleteFolder}`, { cause: failure });
  }
  // A file that was already there is left from an earlier home, so a retry would fail the same way.
  if (failure instanceof JsonFileError && failure.code === "EEXIST") {
    const leftover = `${failure.filePath} is left from an earlier home`;
    return new HomeError(`${reason}; ${leftover}, ${deleteFolder}`, { cause: failure });
  }
  return new HomeError(`${reason}; its files were removed, so try again`, { cause: failure });
}

async function load(stateDir: string): Promise<Home | undefined> {
  const files = filesIn(stateDir);
  const saved = await readJsonFile(files.home).catch((error: unknown) => {
    if (error instanceof JsonFileError && error.code === "ENOENT") return undefined;
    throw unreadable(files.home, error);
  });
  if (saved === undefined) return undefined;
  const config = await readJsonFile(files.coordinatorConfigFile).catch((error: unknown) => {
    throw unreadable(files.coordinatorConfigFile, error);
  });
  field(files.home, saved, "schema_version", (value): value is 1 => value === 1);
  const home = homeAt(
    stateDir,
    field(files.home, saved, "home_id", isString),
    field(files.home, saved, "hub_public_key", isString),
    {
      dashboard: field(files.coordinatorConfigFile, config, "dashboard_port", isPort),
      listen: field(files.coordinatorConfigFile, config, "listen_port", isPort),
    },
  );
  // Layer 2's coordinator follows coordinator.json, so its paths must be this folder's files.
  for (const [name, value] of Object.entries(coordinatorPaths(home))) {
    field(files.coordinatorConfigFile, config, name, (found): found is string => found === value);
  }
  if (publicKeyOf((await readSecrets(files)).hubPrivateKey) !== home.hubPublicKey) {
    throw unreadable(files.hubPrivateKey, new Error(`it does not match ${files.home}`));
  }
  return home;
}

async function readSecrets(files: ReturnType<typeof filesIn>): Promise<HomeSecrets> {
  const homeKey = await readKey(files.homeKey, (bytes) => {
    if (bytes.length !== settings.HOME_KEY_BYTES) throw new RangeError("wrong length");
    return crypto.createSecretKey(bytes);
  });
  const hubPrivateKey = await readKey(files.hubPrivateKey, (der) =>
    crypto.createPrivateKey({ key: der, format: "der", type: "pkcs8" }),
  );
  return { homeKey, hubPrivateKey };
}

/** Reads a key file into a key object. A failure names the file, never its bytes. */
async function readKey(file: string, toKey: (bytes: Buffer) => crypto.KeyObject) {
  try {
    return toKey(await readFileBytes(file));
  } catch (error) {
    throw unreadable(file, error);
  }
}

/** Every path in the state folder. */
function filesIn(stateDir: string) {
  const at = (...names: string[]) => path.join(stateDir, ...names);
  const names = settings.STATE_NAMES;
  return {
    home: at(names.home),
    homeKey: at(names.keysDir, names.homeKey),
    hubPrivateKey: at(names.keysDir, names.hubPrivateKey),
    coordinatorConfigFile: at(names.coordinatorConfig),
    acceptedWorkersFile: at(names.acceptedWorkers),
    stopFile: at(names.coordinatorStop),
    coordinatorStateDir: at(names.coordinatorStateDir),
  };
}

function homeAt(
  stateDir: string,
  homeId: string,
  hubPublicKey: string,
  ports: { readonly dashboard: number; readonly listen: number },
): Home {
  const { home, homeKey, hubPrivateKey, ...coordinatorFiles } = filesIn(stateDir);
  const { dashboard: dashboardPort, listen: listenPort } = ports;
  return { homeId, hubPublicKey, dashboardPort, listenPort, stateDir, ...coordinatorFiles };
}

/** The paths coordinator.json gives Layer 2's coordinator: this state folder's files. */
const coordinatorPaths = (home: Home) => ({
  accepted_workers_file: home.acceptedWorkersFile,
  state_dir: home.coordinatorStateDir,
  stop_file: home.stopFile,
});

/** The raw X25519 public key of a private key, in base64url: its JWK `x` ("" for other kinds). */
function publicKeyOf(privateKey: crypto.KeyObject): string {
  return crypto.createPublicKey(privateKey).export({ format: "jwk" }).x ?? "";
}

/** Field `name` of the JSON object read from `file`, which must pass `ok`. */
function field<T>(file: string, data: unknown, name: string, ok: (v: unknown) => v is T): T {
  const value: unknown = typeof data === "object" && data !== null ? Reflect.get(data, name) : null;
  if (!ok(value)) throw unreadable(file, new Error(`${name} is missing or invalid`));
  return value;
}

function unreadable(file: string, error: unknown): HomeError {
  const reason = error instanceof JsonFileError ? error.message : `${file}: ${errorMessage(error)}`;
  return new HomeError(`home files unreadable: ${reason}`, { cause: error });
}

const isString = (value: unknown): value is string => typeof value === "string";
const isPort = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 0xffff;
const json = (data: unknown): string => `${JSON.stringify(data, null, 2)}\n`;

/** One entry of accepted-workers.json, with contracts/accepted-workers.json's field names. */
export interface AcceptedWorker {
  readonly node_id: string;
  readonly display_name: string;
  /** Link-key material (phone-hub.md §6.6), so a secret: never logged and never shown. */
  readonly token_sha256: string;
}

/** accepted-workers.json can't be read or would break Layer 2's rules. Names the file, no value. */
export class AcceptedWorkersError extends HomeError {
  override name = "AcceptedWorkersError";
}

const WORKER_KEYS = ["display_name", "node_id", "token_sha256"];
const TOKEN_SHA256 = /^[0-9a-f]{64}$/;

/**
 * accepted-workers.json's entries, checked as Layer 2's model checks them: exactly its keys at each
 * level, version 1, 64 lowercase hex hashes, and no node_id or hash twice. A file that breaks them
 * throws an AcceptedWorkersError, since the coordinator would refuse every worker.
 */
function parseAcceptedWorkers(file: string, data: unknown): AcceptedWorker[] {
  const broken = (rule: string) => new AcceptedWorkersError(`${file} is not valid: ${rule}`);
  const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
  const keys = (value: object) => Object.keys(value).sort().join(",");
  if (!isObject(data) || keys(data) !== "schema_version,workers") throw broken("its keys");
  const { schema_version: version, workers } = data;
  if (version !== 1) throw broken("schema_version must be 1");
  if (!Array.isArray(workers)) throw broken("workers must be a list");
  const entries = workers.map((worker: unknown, index): AcceptedWorker => {
    const fields = isObject(worker) && keys(worker) === WORKER_KEYS.join(",") ? worker : {};
    const { node_id, display_name, token_sha256 } = fields;
    const ok =
      typeof node_id === "string" &&
      typeof display_name === "string" &&
      typeof token_sha256 === "string" &&
      TOKEN_SHA256.test(token_sha256);
    if (!ok) throw broken(`workers[${index}] does not match the contract`);
    return { node_id, display_name, token_sha256 };
  });
  for (const key of ["node_id", "token_sha256"] as const) {
    const values = entries.map((entry) => entry[key]);
    if (new Set(values).size !== values.length) throw broken(`two workers share a ${key}`);
  }
  return entries;
}

/** The workers the home accepts, from accepted-workers.json. */
export async function acceptedWorkers(home: Home): Promise<AcceptedWorker[]> {
  const file = home.acceptedWorkersFile;
  const data = await readJsonFile(file).catch((error: unknown) => {
    throw new AcceptedWorkersError(errorMessage(error), { cause: error });
  });
  return parseAcceptedWorkers(file, data);
}

/**
 * Appends `worker` to accepted-workers.json through updateJsonFile's queue, written whole, so two
 * approvals at once both land. A file that already breaks Layer 2's rules is left as it is, and so
 * is one the new entry would break; either throws an AcceptedWorkersError.
 */
export async function addAcceptedWorker(home: Home, worker: AcceptedWorker): Promise<void> {
  const file = home.acceptedWorkersFile;
  await updateJsonFile(file, (current) => {
    const workers = parseAcceptedWorkers(file, current ?? { schema_version: 1, workers: [] });
    const entry = {
      node_id: worker.node_id,
      display_name: worker.display_name,
      token_sha256: worker.token_sha256,
    };
    const next = { schema_version: 1, workers: [...workers, entry] };
    parseAcceptedWorkers(file, next);
    return next;
  });
}

/**
 * Takes node `nodeId` out of accepted-workers.json through updateJsonFile's queue, so Layer 2's
 * coordinator refuses its token and drops its connection. Resolves whether the node was listed; a
 * file that breaks Layer 2's rules is left as it is and throws an AcceptedWorkersError.
 */
export async function removeAcceptedWorker(home: Home, nodeId: string): Promise<boolean> {
  const file = home.acceptedWorkersFile;
  let listed = false;
  await updateJsonFile(file, (current) => {
    const workers = parseAcceptedWorkers(file, current ?? { schema_version: 1, workers: [] });
    const kept = workers.filter((worker) => worker.node_id !== nodeId);
    listed = kept.length !== workers.length;
    return { schema_version: 1, workers: kept };
  }).catch((error: unknown) => {
    if (!(error instanceof JsonFileError)) throw error;
    throw new AcceptedWorkersError(error.message, { cause: error });
  });
  return listed;
}

/** coordinator.json's client_port: where the bridge posts to Layer 2's coordinator on 127.0.0.1. */
export function readCoordinatorClientPort(stateDir: string): Promise<number> {
  const file = filesIn(stateDir).coordinatorConfigFile;
  return locked(async () => {
    const config = await readJsonFile(file).catch((error: unknown) => {
      throw unreadable(file, error);
    });
    return field(file, config, "client_port", isPort);
  });
}
