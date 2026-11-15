// STUB of Layer 2's coordinator (layer2-coordinator): Layer 1 runs it when Layer 2 declares none.
/**
 * `node fake-layer2-coordinator.ts --config <coordinator.json>`, mirroring the real coordinator: it
 * reads only coordinator.json and exits 2 unless it matches contracts/coordinator.json; serves a
 * STUB page and GET /api/state (contracts/api-state.json, empty lists) on 127.0.0.1 at
 * dashboard_port, or exits 1 if that port is taken; and exits 0 once stop_file appears, removing
 * it. It has no messages for phones, so it never calls bridge_url. It imports nothing from bridge/.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

const STOP_POLL_MS = 500;
const DASHBOARD_HOST = "127.0.0.1";
const EXIT_ERROR = 1;
const EXIT_BAD_CONFIG = 2;
const USAGE = "usage: fake-layer2-coordinator.ts --config <coordinator.json>";
const PAGE = "<!doctype html><title>STUB coordinator</title><h1>STUB: no Layer 2 coordinator</h1>";
const PORT_FIELDS = ["listen_port", "dashboard_port", "client_port"];
const PORTS_DIFFER = "listen_port, dashboard_port and client_port must all differ";

type Rule = readonly [(value: unknown) => boolean, string];
const TEXT: Rule = [(value) => typeof value === "string", "must be text"];
const PORT: Rule = [
  (value) => Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 65535,
  "must be a whole number from 1 to 65535",
];
const ABSOLUTE: Rule = [
  (value) => typeof value === "string" && path.isAbsolute(value),
  "must be an absolute path",
];
const FIELDS = new Map<string, Rule>([
  ["schema_version", [(value) => value === 1, "must be 1"]],
  ["home_id", TEXT],
  ["listen_port", PORT],
  ["dashboard_port", PORT],
  ["client_port", PORT],
  ["ollama_url", TEXT],
  ["bridge_url", TEXT],
  ["accepted_workers_file", ABSOLUTE],
  ["state_dir", ABSOLUTE],
  ["stop_file", ABSOLUTE],
]);

interface Config {
  dashboard_port: number;
  stop_file: string;
}

function log(message: string): void {
  process.stderr.write(`STUB layer2-coordinator: ${message}\n`);
}

/** What is wrong with the config's fields, naming them but never their values; null if nothing. */
function problemWith(config: Map<string, unknown>): string | null {
  const unknown = [...config.keys()].find((key) => !FIELDS.has(key));
  if (unknown !== undefined) return `${unknown}: not a coordinator.json field`;
  for (const [key, [valid, rule]] of FIELDS) {
    if (!config.has(key)) return `${key}: missing`;
    if (!valid(config.get(key))) return `${key}: ${rule}`;
  }
  const ports = new Set(PORT_FIELDS.map((key) => config.get(key)));
  return ports.size === PORT_FIELDS.length ? null : PORTS_DIFFER;
}

/** JSON.parse reads 7443.0 and 7443e0 as 7443, but Layer 2 refuses a port written that way. */
function asWritten(key: string, value: unknown, context?: { source?: string }): unknown {
  const decimal = typeof value === "number" && /[.eE]/.test(context?.source ?? "");
  return decimal && PORT_FIELDS.includes(key) ? Number.NaN : value;
}

/** The config, or why it cannot be used. */
function readConfig(file: string): Config | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, { encoding: "utf8" }), asWritten);
  } catch (error) {
    // Read and JSON errors alike; JSON's own message would quote the file's text.
    const { code, name } = error as NodeJS.ErrnoException;
    return `cannot read ${file} as JSON (${code ?? name})`;
  }
  const problem = problemWith(new Map(Object.entries(parsed ?? {})));
  return problem === null ? (parsed as Config) : `${file} is not valid: ${problem}`;
}

function main(): void {
  const [flag, file, ...extra] = process.argv.slice(2);
  const config = flag === "--config" && file && extra.length === 0 ? readConfig(file) : USAGE;
  if (typeof config === "string") {
    log(config);
    process.exitCode = EXIT_BAD_CONFIG;
    return;
  }
  const address = `${DASHBOARD_HOST}:${config.dashboard_port}`;
  const server = createServer((request, response) => {
    const updatedAt = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    const state = { schema_version: 1, updated_at: updatedAt, laptops: [], jobs: [], dropped: [] };
    const json = request.url === "/api/state";
    const type = json ? "application/json" : "text/html; charset=utf-8";
    response.writeHead(200, { "cache-control": "no-store", "content-type": type });
    response.end(json ? JSON.stringify(state) : PAGE);
  });
  const poll = setInterval(() => {
    if (!existsSync(config.stop_file)) return;
    clearInterval(poll);
    server.close();
    server.closeAllConnections();
    log("stop file found; stopped");
    rmSync(config.stop_file, { force: true });
  }, STOP_POLL_MS);
  server.once("error", (error: NodeJS.ErrnoException) => {
    clearInterval(poll);
    log(`cannot serve on ${address}: ${error.code ?? error.message}`);
    process.exitCode = EXIT_ERROR;
  });
  server.listen(config.dashboard_port, DASHBOARD_HOST, () => {
    log(`ready on ${address}; stop file ${config.stop_file}`);
  });
}

main();
