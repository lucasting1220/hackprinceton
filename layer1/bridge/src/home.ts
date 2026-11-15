import * as crypto from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { errorMessage, JsonFileError, removePath, writeFileWhole } from "./json-file.ts";
import * as settings from "./settings.ts";

/** What later steps need to know about the home. It never holds the home key or the private key. */
export interface Home {
  readonly homeId: string;
  /** The hub's raw 32-byte X25519 public key in base64url, as the pairing QR code carries it. */
  readonly hubPublicKey: string;
  /** The dashboard port in coordinator.json, for the dashboard link. */
  readonly dashboardPort: number;
  readonly stateDir: string;
  readonly coordinatorConfigFile: string;
  readonly acceptedWorkersFile: string;
  readonly stopFile: string;
  readonly coordinatorStateDir: string;
}

export interface CreateHomeOptions {
  /** The ports written to coordinator.json; settings.ts's by default. */
  readonly ports?: { readonly listen: number; readonly dashboard: number; readonly client: number };
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

/** Creates the home in `stateDir`. Throws HomeExistsError if one exists: a home is never replaced. */
export function createHome(stateDir: string, options: CreateHomeOptions = {}): Promise<Home> {
  return locked(() => create(stateDir, options));
}

async function create(stateDir: string, options: CreateHomeOptions): Promise<Home> {
  const { ports = DEFAULT_PORTS, writeFile = writeFileWhole } = options;
  const files = filesIn(stateDir);
  const { privateKey } = crypto.generateKeyPairSync("x25519");
  const home = homeAt(stateDir, crypto.randomUUID(), publicKeyOf(privateKey), ports.dashboard);
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
    bridge_url: settings.BRIDGE_URL,
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

function homeAt(stateDir: string, homeId: string, hubPublicKey: string, port: number): Home {
  const { home, homeKey, hubPrivateKey, ...coordinatorFiles } = filesIn(stateDir);
  return { homeId, hubPublicKey, dashboardPort: port, stateDir, ...coordinatorFiles };
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

const json = (data: unknown): string => `${JSON.stringify(data, null, 2)}\n`;
