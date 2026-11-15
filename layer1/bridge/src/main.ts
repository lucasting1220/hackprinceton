import { existsSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { HomeError, loadHome, resolveStateDir } from "./home.ts";
import { errorMessage, removePath } from "./json-file.ts";
import {
  browserCommand,
  openInBrowser,
  type SetupServerOptions,
  startSetupServer,
} from "./setup-server.ts";
import * as settings from "./settings.ts";

/** This file is <repo>/layer1/bridge/src/main.ts, whatever folder the bridge is started from. */
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

/** The stop signals: Ctrl+C, a stop request, and the terminal closing. */
const STOP_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

export interface BridgeOptions
  extends Pick<SetupServerOptions, "stateDir" | "repoRoot" | "port" | "log"> {
  /** Opens the setup page; the default browser by default (D4). */
  readonly open?: (url: string) => Promise<void>;
}

let outputGuarded = false;

/**
 * Once the terminal closes (its window, or an SSH session), writes fail with EIO or EPIPE, which
 * would crash the bridge before it stops the coordinator. Nothing is left to report them on.
 */
function guardOutput(): void {
  if (outputGuarded) return;
  outputGuarded = true;
  for (const output of [process.stdout, process.stderr]) {
    output.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EIO" && error.code !== "EPIPE") throw error;
    });
  }
}

/**
 * Starts the setup page and the home's coordinator, and opens the page. A stop signal, or the stop
 * file `bridge.stop` appearing in the state folder (CLAUDE.md section 10), ends both.
 */
export async function startBridge(options: BridgeOptions) {
  guardOutput();
  const log = options.log ?? ((line: string) => console.log(line));
  const home = await loadHome(options.stateDir).catch((error: unknown) => {
    if (!(error instanceof HomeError)) throw error;
    log(`L1 bridge: ${error.message}`); // the setup page shows it too
  });
  // The page's port comes first: a second bridge must exit before it touches the coordinator.
  const server = await startSetupServer({ ...options, log });
  const stopFile = path.join(options.stateDir, settings.STATE_NAMES.bridgeStop);
  try {
    await removePath(stopFile); // one left from a run that ended before it found it
  } catch (error) {
    await server.close();
    throw error;
  }
  let stopping: Promise<void> | undefined;

  async function shutdown(reason: string): Promise<void> {
    clearInterval(stopFilePoll);
    for (const [signal, handler] of signalHandlers) process.off(signal, handler);
    log(`L1 bridge: ${reason}; stopping`);
    await server.close().catch((error: unknown) => {
      log(`L1 bridge: could not stop the coordinator: ${errorMessage(error)}`);
      process.exitCode = 1;
    });
    await removePath(stopFile).catch((error: unknown) => {
      log(`L1 bridge: could not remove ${stopFile}: ${errorMessage(error)}`);
      process.exitCode = 1;
    });
    log("L1 bridge: stopped");
  }

  /** Closes the page, stops the coordinator and removes the stop file, once whatever asks. */
  function requestStop(reason: string): void {
    stopping ??= shutdown(reason);
  }

  const signalHandlers = STOP_SIGNALS.map((signal) => {
    const handler = () => requestStop(`${signal} received`);
    process.on(signal, handler);
    return [signal, handler] as const;
  });
  const stopFilePoll = setInterval(() => {
    if (existsSync(stopFile)) requestStop(`${settings.STATE_NAMES.bridgeStop} found`);
  }, settings.BRIDGE_STOP_POLL_MS);

  log(`L1 bridge: the setup page is at ${server.url}`);
  try {
    if (home) await server.startCoordinator(home);
    await (options.open ?? ((url) => openInBrowser(url, browserCommand(url))))(server.url);
  } catch (error) {
    requestStop(`could not start: ${errorMessage(error)}`);
    await stopping;
    throw error;
  }
  return {
    url: server.url,
    stopFile,
    /** The shutdown a stop signal or the stop file starts; resolves once it is done. */
    stop(reason: string): Promise<void> {
      requestStop(reason);
      return stopping ?? Promise.resolve();
    },
  };
}

/** `npm start -- [--state-dir <absolute folder>]`. */
async function main(): Promise<void> {
  const { values } = parseArgs({ options: { "state-dir": { type: "string" } } });
  await startBridge({ stateDir: resolveStateDir(values["state-dir"]), repoRoot: REPO_ROOT });
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(`L1 bridge: ${errorMessage(error)}`);
    process.exitCode = 1;
  });
}
