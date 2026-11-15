// STUB of Layer 2's worker (layer2-worker): Layer 1 runs it when Layer 2 declares none, and in tests.
/**
 * `node fake-layer2-worker.ts --config <worker.json>`, mirroring the real worker's files but not its
 * connection: it exits 2 unless worker.json has exactly contracts/worker.json's fields and the token
 * file holds 64 lowercase hex characters; it writes worker-status.json as "connected" without
 * contacting any coordinator; and it exits 0 once stop_file appears, removing it.
 * `node fake-layer2-worker.ts check --config <worker.json> --json` prints contracts/check-output.json's
 * shape, with the token as the one required item, and exits 4 when it is missing. It never prints
 * the token and imports nothing from bridge/.
 */
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const STOP_POLL_MS = 200;
const EXIT_BAD_CONFIG = 2;
const EXIT_MISSING = 4;
const USAGE = "usage: fake-layer2-worker.ts [check] --config <worker.json> [--json]";
const TOKEN = /^[0-9a-f]{64}$/;
const FIELDS = [
  "schema_version",
  "home_id",
  "node_id",
  "display_name",
  "coordinator_url",
  "token_file",
  "camera",
  "mic",
  "frame_feed_port",
  "ollama_url",
  "python",
  "status_file",
  "stop_file",
  "state_dir",
];

interface Config {
  node_id: string;
  token_file: string;
  status_file: string;
  stop_file: string;
}

function log(message: string): void {
  process.stderr.write(`STUB layer2-worker: ${message}\n`);
}

/** The config, or why it cannot be used, naming fields but never their values. */
function readConfig(file: string): Config | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, { encoding: "utf8" }));
  } catch (error) {
    const { code, name } = error as NodeJS.ErrnoException;
    return `cannot read ${file} as JSON (${code ?? name})`;
  }
  const config = new Map(Object.entries(parsed ?? {}));
  const keys = [...config.keys()].sort().join(",");
  if (keys !== [...FIELDS].sort().join(",")) return `${file} is not valid: its fields`;
  for (const [key, value] of config) {
    const isPath = key === "python" || key.endsWith("_file") || key.endsWith("_dir");
    if (isPath && !(typeof value === "string" && path.isAbsolute(value))) {
      return `${file} is not valid: ${key}: must be an absolute path`;
    }
  }
  return parsed as Config;
}

/** Whether the token file holds a well-formed token. */
function tokenOk(config: Config): boolean {
  try {
    return TOKEN.test(readFileSync(config.token_file, { encoding: "utf8" }));
  } catch {
    return false;
  }
}

function writeStatus(config: Config, state: "connected" | "disconnected"): void {
  const updatedAt = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const status = {
    schema_version: 1,
    node_id: config.node_id,
    state,
    missing: [],
    updated_at: updatedAt,
  };
  const temp = `${config.status_file}.stub.tmp`;
  writeFileSync(temp, JSON.stringify(status), { encoding: "utf8" });
  renameSync(temp, config.status_file);
}

function main(): void {
  const args = process.argv.slice(2);
  const check = args[0] === "check";
  const rest = check ? args.slice(1) : args;
  const [flag, file, ...extra] = rest;
  const extraOk = check ? extra.length === 1 && extra[0] === "--json" : extra.length === 0;
  const config = flag === "--config" && file && extraOk ? readConfig(file) : USAGE;
  if (typeof config === "string") {
    log(config);
    process.exitCode = EXIT_BAD_CONFIG;
    return;
  }
  if (check) {
    const ok = tokenOk(config);
    const missing = ok
      ? []
      : [{ id: "token", reason: "the token file is malformed", required: true }];
    process.stdout.write(`${JSON.stringify({ schema_version: 1, ok, missing })}\n`);
    process.exitCode = ok ? 0 : EXIT_MISSING;
    return;
  }
  if (!tokenOk(config)) {
    log("the token file must hold exactly 64 lowercase hex characters, no newline");
    process.exitCode = EXIT_BAD_CONFIG;
    return;
  }
  if (existsSync(config.stop_file)) {
    log("the stop file is already there; not starting");
    rmSync(config.stop_file, { force: true });
    return;
  }
  writeStatus(config, "connected");
  log(`connected as ${config.node_id} (STUB: no coordinator was contacted)`);
  const poll = setInterval(() => {
    if (!existsSync(config.stop_file)) return;
    clearInterval(poll);
    writeStatus(config, "disconnected");
    rmSync(config.stop_file, { force: true });
    log("stop file found; stopped");
  }, STOP_POLL_MS);
}

main();
