/**
 * The hub credential file, relay-credential.json in the state folder (layer1/contracts/
 * relay-credential.json): the only reader and writer of it. The relay's `admin provision` prints
 * it; `import` saves it owner-only; the bridge reads it at start for the relay link and for the
 * pairing bundle's relay_url. The hub credential never reaches a log line, an error or a page.
 *
 *   ssh … admin.ts provision … | node layer1/bridge/src/relay-credential.ts import [--state-dir <dir>]
 */
import { stat } from "node:fs/promises";
import path from "node:path";
import { addAbortSignal, type Readable } from "node:stream";
import { parseArgs } from "node:util";
import { HomeError, loadHome, resolveStateDir } from "./home.ts";
import { errorMessage, readJsonFile, writeFileWhole } from "./json-file.ts";
import * as settings from "./settings.ts";
import { isUtcTime } from "./wire.ts";

const HUB_CREDENTIAL = /^[A-Za-z0-9_-]{43}$/;
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "[::1]"]);
const FIELDS = ["schema_version", "home_id", "relay_url", "hub_credential", "issued_at"] as const;

/** A checked credential file. The credential is held privately and leaves only as a header. */
export class RelayCredential {
  readonly homeId: string;
  readonly relayUrl: string;
  /** When the relay issued it: messages created earlier are never relayed. */
  readonly issuedAt: string;
  readonly #hubCredential: string;

  constructor(homeId: string, relayUrl: string, hubCredential: string, issuedAt: string) {
    this.homeId = homeId;
    this.relayUrl = relayUrl;
    this.issuedAt = issuedAt;
    this.#hubCredential = hubCredential;
  }

  /** The Authorization header's value for the relay's /v1/hub. Never log it. */
  authorization(): string {
    return `Bearer ${this.#hubCredential}`;
  }
}

/** What the state folder holds: no file, a usable one, or one that can't be used, and why. */
export type RelayCredentialState =
  | Readonly<{ state: "none" }>
  | Readonly<{ state: "ok"; credential: RelayCredential }>
  | Readonly<{ state: "unusable"; file: string; reason: string }>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** https://, or http:// to a loopback host (tests on one machine), with nothing after the host. */
function isRelayUrl(value: unknown): value is string {
  if (typeof value !== "string" || !URL.canParse(value)) return false;
  const url = new URL(value);
  const plainLoopback = url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  const clean = url.username === "" && url.password === "" && url.search === "" && url.hash === "";
  return (url.protocol === "https:" || plainLoopback) && clean && url.pathname === "/";
}

/**
 * The credential in a parsed file for home `homeId`, or the first rule it breaks. The reason names
 * a field and its rule, never a value.
 */
export function parseRelayCredential(data: unknown, homeId: string): RelayCredential | string {
  if (!isRecord(data)) return "it isn't a JSON object";
  const { schema_version: version, home_id, relay_url, hub_credential, issued_at } = data;
  if (version !== settings.RELAY_CREDENTIAL_SCHEMA_VERSION) return "schema_version isn't 1";
  if (home_id !== homeId) return "home_id isn't this home's";
  if (!isRelayUrl(relay_url)) {
    return "relay_url must be https:// (http:// only for a loopback host)";
  }
  if (typeof hub_credential !== "string" || !HUB_CREDENTIAL.test(hub_credential)) {
    return "hub_credential must be 43 base64url characters";
  }
  if (!isUtcTime(issued_at)) return "issued_at must be a UTC time";
  return new RelayCredential(homeId, new URL(relay_url).origin, hub_credential, issued_at);
}

/** The credential file's path in `stateDir`. */
export function relayCredentialFile(stateDir: string): string {
  return path.join(stateDir, settings.RELAY_CREDENTIAL_FILE_NAME);
}

/**
 * Reads the credential file for home `homeId`. No file means remote access isn't set up. A file
 * that other accounts may read, can't be read, or breaks a rule is unusable, with the reason.
 */
export async function readRelayCredential(
  stateDir: string,
  homeId: string,
): Promise<RelayCredentialState> {
  const file = relayCredentialFile(stateDir);
  const unusable = (reason: string): RelayCredentialState => ({ state: "unusable", file, reason });
  let data: unknown;
  try {
    const { mode } = await stat(file);
    // Windows has no owner-only bits; the profile's permissions guard the state folder there.
    if (process.platform !== "win32" && (mode & 0o077) !== 0) {
      return unusable("other accounts on this laptop may read it; run chmod 600 on it");
    }
    data = await readJsonFile(file);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    if ("code" in error && error.code === "ENOENT") return { state: "none" };
    return unusable(errorMessage(error).replace(`${file}: `, ""));
  }
  const parsed = parseRelayCredential(data, homeId);
  return typeof parsed === "string" ? unusable(parsed) : { state: "ok", credential: parsed };
}

/** Reads `input` to its end, or rejects past `maxBytes` or once `timeoutMs` has passed. */
async function readInput(input: Readable, maxBytes: number, timeoutMs: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  addAbortSignal(AbortSignal.timeout(timeoutMs), input);
  try {
    for await (const chunk of input as AsyncIterable<unknown>) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
      size += bytes.length;
      if (size > maxBytes) throw new ImportRefusal(`the input is over ${maxBytes} bytes`);
      chunks.push(bytes);
    }
  } catch (error) {
    if (!(error instanceof Error && error.name === "AbortError")) throw error;
    throw new ImportRefusal("no complete credential file arrived in time", { cause: error });
  } finally {
    input.destroy();
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** A refused import; the message never repeats the input. */
export class ImportRefusal extends Error {
  override name = "ImportRefusal";
}

/**
 * `import`: reads the credential file `admin provision` printed from `input` (at most
 * RELAY_CREDENTIAL_IMPORT_MAX_BYTES, within RELAY_CREDENTIAL_IMPORT_TIMEOUT_MS), checks it for the
 * home in `stateDir`, and writes it whole and owner-only. A refusal writes nothing.
 */
export async function importRelayCredential(
  input: Readable,
  stateDir: string,
  timeoutMs: number = settings.RELAY_CREDENTIAL_IMPORT_TIMEOUT_MS,
): Promise<string> {
  let home: Awaited<ReturnType<typeof loadHome>>;
  try {
    home = await loadHome(stateDir);
  } catch (error) {
    if (!(error instanceof HomeError)) throw error;
    throw new ImportRefusal(error.message, { cause: error });
  }
  if (home === undefined) throw new ImportRefusal(`there is no home in ${stateDir}`);
  const text = await readInput(input, settings.RELAY_CREDENTIAL_IMPORT_MAX_BYTES, timeoutMs);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new ImportRefusal("the input isn't one JSON object");
  }
  const parsed = parseRelayCredential(data, home.homeId);
  if (typeof parsed === "string") throw new ImportRefusal(parsed);
  const record: Readonly<Record<string, unknown>> = isRecord(data) ? data : {};
  const kept = Object.fromEntries(FIELDS.map((name) => [name, record[name]]));
  const file = relayCredentialFile(stateDir);
  await writeFileWhole(file, `${JSON.stringify(kept, null, 2)}\n`);
  return file;
}

/** `node bridge/src/relay-credential.ts import [--state-dir <absolute folder>]`. */
async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { "state-dir": { type: "string" } },
  });
  if (positionals.length !== 1 || positionals[0] !== "import") {
    throw new ImportRefusal("usage: relay-credential.ts import [--state-dir <folder>]");
  }
  await importRelayCredential(process.stdin, resolveStateDir(values["state-dir"]));
  console.log("Saved. Restart the bridge to connect to the relay.");
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(`L1 relay credential: not saved: ${errorMessage(error)}`);
    process.exitCode = 1;
  });
}
