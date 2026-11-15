/**
 * `npm run net:test -- --coordinator <address> [--relay <relay URL>]`: the network test for the demo
 * network (docs/layer1-join-and-connect.md, prerequisites and build step 0). Run it on each laptop:
 * it checks, from this laptop, that the coordinator laptop's bridge answers GET /v1/hello, that
 * Layer 2's coordinator accepts a connection on its worker port, and, with --relay, that the relay
 * answers GET /healthz. It prints one PASS, FAIL or SKIP line per check, then the step to do on
 * each iPhone. It exits 0 when every check that ran passed, 1 when one failed and 2 on bad
 * arguments. It reads no state folder and no credential file.
 */
import { isIPv4, Socket } from "node:net";
import { errorMessage } from "../bridge/src/json-file.ts";
import * as settings from "../bridge/src/settings.ts";

/** One check's result, printed as one line. */
export interface Outcome {
  readonly status: "PASS" | "FAIL" | "SKIP";
  readonly check: "hello" | "coordinator" | "relay";
  /** PASS and SKIP: what was seen. FAIL: the reason, then a one-line hint. */
  readonly detail: string;
}

/** The validated arguments. */
export interface Options {
  /** The coordinator laptop's IPv4 address or host name, with no scheme or port. */
  readonly coordinator: string;
  /** The relay's https URL, or undefined to skip the relay check. */
  readonly relay: string | undefined;
}

export const USAGE = "Usage: npm run net:test -- --coordinator <address> [--relay <relay URL>]";

const HINTS = {
  hello:
    "Is the bridge running on the coordinator laptop, was the macOS firewall prompt allowed, and are both laptops on the same network, one that doesn't isolate its clients?",
  coordinator:
    "Is Layer 2's coordinator running on the coordinator laptop (its setup page says so), or is a firewall blocking the port?",
  relay: "Does this laptop have internet access, and is the relay URL right?",
};

const HOST_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;
const HOST_NAME_MAX = 253;

/** Whether `value` is an IPv4 address or a host name, with no scheme, port or path. */
export function isAddress(value: string): boolean {
  if (isIPv4(value)) return true;
  if (value.length === 0 || value.length > HOST_NAME_MAX) return false;
  const labels = value.split(".");
  if (!labels.every((label) => HOST_LABEL.test(label))) return false;
  // All digits, such as 192.168.1, is a mistyped IPv4 address rather than a host name.
  return !labels.every((label) => /^\d+$/.test(label));
}

/**
 * Reads `--coordinator <address>` (required) and `--relay <https URL>` (optional). Returns the
 * options, or the reason the arguments are refused.
 */
export function parseArgs(argv: readonly string[]): Options | { readonly error: string } {
  let coordinator: string | undefined;
  let relay: string | undefined;
  for (let index = 0; index < argv.length; index += 2) {
    const [flag, value] = [argv[index], argv[index + 1]];
    if (value === undefined || value.startsWith("--")) return { error: `${flag} needs a value` };
    if (flag === "--coordinator" && coordinator === undefined) coordinator = value;
    else if (flag === "--relay" && relay === undefined) relay = value;
    else return { error: `${flag} is not an argument this script takes, or was given twice` };
  }
  if (coordinator === undefined) return { error: "--coordinator is required" };
  if (!isAddress(coordinator)) {
    return { error: "--coordinator must be an IPv4 address or host name, with no http:// or port" };
  }
  if (relay !== undefined && !isRelayUrl(relay)) {
    return { error: "--relay must be an https:// URL, such as https://relay.example.com" };
  }
  return { coordinator, relay };
}

function isRelayUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  const plain = url.username === "" && url.password === "" && url.search === "" && url.hash === "";
  return url.protocol === "https:" && plain;
}

/** The URL of the bridge's hello on `address`. */
export function helloUrl(address: string, port: number = settings.BRIDGE_NETWORK_PORT): string {
  return `http://${address}:${port}/v1/hello`;
}

/** Why a request or connection failed, in a few words. */
function failure(error: unknown, timeoutMs: number): string {
  if (error instanceof Error && error.name === "TimeoutError") {
    return `no answer within ${timeoutMs / 1_000} s`;
  }
  const cause = error instanceof Error ? error.cause : undefined;
  const code = cause instanceof Error && "code" in cause ? String(cause.code) : undefined;
  if (code === "ECONNREFUSED") return "the connection was refused";
  return code ?? errorMessage(error);
}

function fail(check: Outcome["check"], reason: string): Outcome {
  return { status: "FAIL", check, detail: `${reason}. ${HINTS[check]}` };
}

/** Whether `body` is the hello of phone-hub.md §4.1: {"v":1,"service":"debbie-bridge","hub":<tag>}. */
function isHello(body: unknown): body is { hub: string } {
  if (typeof body !== "object" || body === null) return false;
  const { v, service, hub } = body as Record<string, unknown>;
  const tag = typeof hub === "string" && hub.length === settings.HUB_TAG_CHARS;
  return v === 1 && service === "debbie-bridge" && tag;
}

/** Check 1: GET /v1/hello on the coordinator laptop's bridge answers 200 with the hello. */
export async function checkHello(
  address: string,
  port: number = settings.BRIDGE_NETWORK_PORT,
  timeoutMs: number = settings.NETWORK_TEST_HELLO_TIMEOUT_MS,
): Promise<Outcome> {
  const url = helloUrl(address, port);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const text = await response.text();
    if (response.status !== 200) return fail("hello", `${url} answered ${response.status}`);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      return fail("hello", `${url} answered with something other than JSON`);
    }
    if (!isHello(body)) return fail("hello", `${url} answered, but not with the bridge's hello`);
    return { status: "PASS", check: "hello", detail: `${url} answered (hub tag ${body.hub})` };
  } catch (error) {
    return fail("hello", `${url}: ${failure(error, timeoutMs)}`);
  }
}

/** Check 2: a TCP connection to Layer 2's coordinator on its worker-control port. */
export async function checkCoordinator(
  address: string,
  port: number = settings.COORDINATOR_LISTEN_PORT,
  timeoutMs: number = settings.NETWORK_TEST_COORDINATOR_TIMEOUT_MS,
): Promise<Outcome> {
  const target = `${address}:${port}`;
  const socket = new Socket();
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const timeout = new Error("timed out");
        timeout.name = "TimeoutError";
        reject(timeout);
      }, timeoutMs);
      socket.once("connect", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(new Error(error.message, { cause: error }));
      });
      socket.connect(port, address);
    });
    return { status: "PASS", check: "coordinator", detail: `${target} accepted a connection` };
  } catch (error) {
    return fail("coordinator", `${target}: ${failure(error, timeoutMs)}`);
  } finally {
    socket.destroy();
  }
}

/** Check 3: the relay's GET /healthz answers {"v":1,"ok":true}; SKIP without a relay URL. */
export async function checkRelay(
  relay: string | undefined,
  timeoutMs: number = settings.NETWORK_TEST_RELAY_TIMEOUT_MS,
): Promise<Outcome> {
  if (relay === undefined) {
    return {
      status: "SKIP",
      check: "relay",
      detail: "no relay URL given; add --relay <relay URL> to check it",
    };
  }
  const url = new URL("healthz", relay.endsWith("/") ? relay : `${relay}/`).href;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const text = await response.text();
    if (response.status !== 200) return fail("relay", `${url} answered ${response.status}`);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      return fail("relay", `${url} answered with something other than JSON`);
    }
    const fields: Record<string, unknown> =
      typeof body === "object" && body !== null ? { ...body } : {};
    const { v, ok } = fields;
    if (v !== 1 || ok !== true || Object.keys(fields).length !== 2) {
      return fail("relay", `${url} answered, but not with {"v":1,"ok":true}`);
    }
    return { status: "PASS", check: "relay", detail: `${url} answered {"v":1,"ok":true}` };
  } catch (error) {
    return fail("relay", `${url}: ${failure(error, timeoutMs)}`);
  }
}

/** The line printed for one outcome. */
export function outcomeLine(outcome: Outcome): string {
  return `${outcome.status} ${outcome.check} ${outcome.detail}`;
}

/** 0 when every check that ran passed (a SKIP did not run), 1 when any failed. */
export function exitCode(outcomes: readonly Outcome[]): 0 | 1 {
  return outcomes.some((outcome) => outcome.status === "FAIL") ? 1 : 0;
}

/** The phone step, which the script can't do itself. */
export function phoneStep(address: string): string[] {
  return [
    `Now on each iPhone, on the same Wi-Fi as this laptop: open ${helloUrl(address)} in Safari.`,
    `  It works if Safari shows a short JSON page that includes "service":"debbie-bridge".`,
    "  Anything else (Safari can't open the page, or it times out) means the phone can't reach the coordinator laptop on this network.",
  ];
}

/** Runs the network test with `argv` (the arguments after `--`) and returns the exit code. */
export async function main(
  argv: readonly string[],
  log: (line: string) => void = console.log,
): Promise<number> {
  const options = parseArgs(argv);
  if ("error" in options) {
    log(`Bad arguments: ${options.error}.`);
    log(USAGE);
    return 2;
  }
  const outcomes: Outcome[] = [];
  for (const check of [
    () => checkHello(options.coordinator),
    () => checkCoordinator(options.coordinator),
    () => checkRelay(options.relay),
  ]) {
    const outcome = await check();
    outcomes.push(outcome);
    log(outcomeLine(outcome));
  }
  for (const line of phoneStep(options.coordinator)) log(line);
  return exitCode(outcomes);
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
