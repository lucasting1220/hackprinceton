/**
 * The operator's command on the relay server:
 *   node relay/src/admin.ts provision --config <relay.json> --home-id <home ID> [--replace]
 *   node relay/src/admin.ts status --config <relay.json>
 * provision prints the home's hub credential file to stdout as one JSON line and nothing else; the
 * relay keeps only the credential's hash. Nothing secret goes to stderr, a log or the server's disk.
 */
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { errorMessage } from "../../bridge/src/json-file.ts";
import { credentialHash, toBase64url } from "../../bridge/src/phone-crypto.ts";
import {
  HUB_CREDENTIAL_BYTES,
  RELAY_CREDENTIAL_SCHEMA_VERSION,
} from "../../bridge/src/settings.ts";
import { utcSeconds } from "../../bridge/src/wire.ts";
import { loadRelayConfig, missingPushSetup, pushConfigured, type RelayConfig } from "./config.ts";
import { ENVIRONMENTS, RelayStore } from "./store.ts";

/** The hub credential file (layer1/contracts/relay-credential.json). */
export interface CredentialFile {
  readonly schema_version: number;
  readonly home_id: string;
  readonly relay_url: string;
  readonly hub_credential: string;
  readonly issued_at: string;
}

export type ProvisionResult =
  | Readonly<{ ok: true; file: CredentialFile }>
  | Readonly<{ ok: false; reason: "exists" | "unknown_home" }>;

export interface AdminIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly now?: () => Date;
}

/** Exit codes: 1 for a usage, config or database problem, 2 for a home that already exists. */
const EXIT_FAILED = 1;
const EXIT_EXISTS = 2;

const HOME_ID = /^[A-Za-z0-9._-]{1,64}$/;

const USAGE = [
  "usage:",
  "  node relay/src/admin.ts provision --config <relay.json> --home-id <home ID> [--replace]",
  "  node relay/src/admin.ts status --config <relay.json>",
].join("\n");

/**
 * Creates the home with a new hub credential, or with `replace` gives an existing home a new one,
 * which cuts the old one off. Only the credential's hash is stored.
 */
export function provisionHome(
  store: RelayStore,
  config: RelayConfig,
  homeId: string,
  options: { readonly replace: boolean; readonly now: Date },
): ProvisionResult {
  const credential = toBase64url(randomBytes(HUB_CREDENTIAL_BYTES));
  const hash = credentialHash(credential);
  if (options.replace) {
    if (!store.replaceHubCredential(homeId, hash)) return { ok: false, reason: "unknown_home" };
  } else if (!store.createHome(homeId, hash, options.now.getTime())) {
    return { ok: false, reason: "exists" };
  }
  const file: CredentialFile = {
    schema_version: RELAY_CREDENTIAL_SCHEMA_VERSION,
    home_id: homeId,
    relay_url: config.public_url,
    hub_credential: credential,
    issued_at: utcSeconds(options.now),
  };
  return { ok: true, file };
}

const iso = (ms: number | null): string | null => (ms === null ? null : utcSeconds(new Date(ms)));

/** Each home's connection, last contact, offline state and phone counts, and push health. */
export function relayStatus(store: RelayStore, config: RelayConfig): object {
  const homes = store.homes().map((home) => ({
    home_id: home.homeId,
    hub_connected: home.hubConnected,
    last_contact_at: iso(home.lastContactAtMs),
    offline_notified_at: iso(home.offlineNotifiedAtMs),
    phones: store.deviceCounts(home.homeId),
  }));
  const push = Object.fromEntries(
    ENVIRONMENTS.map((env) => {
      const health = store.pushHealth(env);
      return [
        env,
        {
          configured: pushConfigured(config, env),
          last_ok_at: iso(health.lastOkAtMs),
          last_error: health.lastError,
          last_error_at: iso(health.lastErrorAtMs),
        },
      ];
    }),
  );
  return { homes, push };
}

/** Runs the command in `args` and returns its exit code. */
export async function runAdmin(args: readonly string[], io: AdminIo): Promise<number> {
  const now = io.now ?? (() => new Date());
  let parsed: ReturnType<typeof parseCommand>;
  try {
    parsed = parseCommand(args);
  } catch (error) {
    io.stderr(`L1 relay admin: ${errorMessage(error)}\n${USAGE}\n`);
    return EXIT_FAILED;
  }
  let store: RelayStore | undefined;
  try {
    const config = await loadRelayConfig(parsed.config);
    store = RelayStore.open(config.database_file);
    if (parsed.command === "status") {
      for (const line of missingPushSetup(config)) io.stderr(`${line}\n`);
      io.stdout(`${JSON.stringify(relayStatus(store, config), null, 2)}\n`);
      return 0;
    }
    const result = provisionHome(store, config, parsed.homeId, {
      replace: parsed.replace,
      now: now(),
    });
    if (!result.ok) {
      io.stderr(
        result.reason === "exists"
          ? `L1 relay admin: home ${parsed.homeId} already has a hub credential; pass --replace to issue a new one\n`
          : `L1 relay admin: there is no home ${parsed.homeId} to replace the credential of\n`,
      );
      return result.reason === "exists" ? EXIT_EXISTS : EXIT_FAILED;
    }
    io.stdout(`${JSON.stringify(result.file)}\n`);
    io.stderr(
      `L1 relay admin: ${parsed.replace ? "replaced the hub credential of" : "provisioned"} home ${parsed.homeId}\n`,
    );
    return 0;
  } catch (error) {
    io.stderr(`L1 relay admin: ${errorMessage(error)}\n`);
    return EXIT_FAILED;
  } finally {
    store?.close();
  }
}

type Command =
  | Readonly<{ command: "status"; config: string }>
  | Readonly<{ command: "provision"; config: string; homeId: string; replace: boolean }>;

function parseCommand(args: readonly string[]): Command {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    strict: true,
    options: {
      config: { type: "string" },
      "home-id": { type: "string" },
      replace: { type: "boolean", default: false },
    },
  });
  const [command, ...extra] = positionals;
  const config = values.config;
  if (extra.length > 0) throw new Error("too many arguments");
  if (config === undefined) throw new Error("--config is required");
  if (command === "status") {
    if (values["home-id"] !== undefined || values.replace) {
      throw new Error("status takes only --config");
    }
    return { command, config };
  }
  if (command !== "provision") throw new Error("the command must be provision or status");
  const homeId = values["home-id"];
  if (homeId === undefined || !HOME_ID.test(homeId)) {
    throw new Error("--home-id must be an ID of 1 to 64 letters, digits, '.', '_' or '-'");
  }
  return { command, config, homeId, replace: values.replace };
}

if (import.meta.main) {
  const code = await runAdmin(process.argv.slice(2), {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  });
  process.exitCode = code;
}
