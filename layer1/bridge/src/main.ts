import { existsSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { type HomeAlerts, openHomeAlerts } from "./alert-intake.ts";
import { type Home, HomeError, loadHome, resolveStateDir } from "./home.ts";
import { errorMessage, removePath } from "./json-file.ts";
import { KeepAwake, type KeepAwakeOptions } from "./keep-awake.ts";
import { LiveViewConsent } from "./live-view-consent.ts";
import { PhoneAccess, type PhoneAccessOptions } from "./phone-access.ts";
import { readRelayCredential } from "./relay-credential.ts";
import {
  RelayLink,
  type RelayLinkTiming,
  type RemoteAccess,
  remoteAccessText,
} from "./relay-link.ts";
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
  extends Pick<
    SetupServerOptions,
    "stateDir" | "repoRoot" | "port" | "log" | "homeOptions" | "laptop"
  > {
  /** Opens the setup page; the default browser by default (D4). */
  readonly open?: (url: string) => Promise<void>;
  /** The network side's port and addresses; tests pass port 0 and their own addresses. */
  readonly network?: Omit<PhoneAccessOptions, "log">;
  /** The relay link's times; tests pass shorter ones. */
  readonly relayTiming?: Partial<RelayLinkTiming>;
  /** The keep-awake helper's platform or command; tests pass an unsupported or missing one. */
  readonly keepAwake?: Omit<KeepAwakeOptions, "log">;
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
  let alerts: Promise<HomeAlerts | undefined> | undefined;
  let alertsReady: HomeAlerts | undefined;
  let phones: Promise<PhoneAccess | undefined> | undefined;
  let started: PhoneAccess | undefined;
  let stopping: Promise<void> | undefined;
  let remote: RemoteAccess = { state: "not_set_up" };
  let relayLink: RelayLink | undefined;
  let keepAwake: KeepAwake | undefined;
  let liveView: LiveViewConsent | undefined;

  /**
   * The home-ready hook, after a home loads at start and after Create a home: starts the phone
   * side on the coordinator. Steps 4 and 5 start their outbox and relay link here too.
   */
  async function onHomeReady(home: Home): Promise<void> {
    const credential = await readRelayCredential(home.stateDir, home.homeId);
    const relayUrl = credential.state === "ok" ? credential.credential.relayUrl : "";
    const alertsOpened = await openAlerts(home);
    const { outbox, handoff } = alertsOpened ?? {};
    liveView ??= await LiveViewConsent.load(home.stateDir, { log });
    const network = {
      ...options.network,
      log,
      relayUrl,
      liveView,
      ...(outbox === undefined ? {} : { outbox }),
      ...(handoff === undefined ? {} : { handoff }),
    };
    phones ??= PhoneAccess.start(home, network).catch((error: unknown) => {
      log(`L1 bridge: phone pairing could not start: ${errorMessage(error)}`);
      return undefined;
    });
    const access = await phones;
    if (stopping !== undefined) await access?.close();
    else started = access;
    if (stopping === undefined) startRelayLink(credential, alertsOpened, access);
  }

  /** Step 5: the relay link, when relay-credential.json is usable and the home's parts are up. */
  function startRelayLink(
    credential: Awaited<ReturnType<typeof readRelayCredential>>,
    homeAlerts: HomeAlerts | undefined,
    access: PhoneAccess | undefined,
  ): void {
    if (relayLink !== undefined) return;
    if (credential.state !== "ok") {
      remote = credential.state === "none" ? { state: "not_set_up" } : credential;
      if (credential.state === "unusable") {
        log(`L1 bridge: remote access is off: ${remoteAccessText(credential)}`);
      }
      return;
    }
    const parts = access?.relayParts();
    if (homeAlerts === undefined || parts === undefined) {
      remote = { state: "stopped" };
      log("L1 bridge: remote access is off: the phone list or the alerts couldn't start");
      return;
    }
    const { gateway, phones: registry } = parts;
    relayLink = RelayLink.start({
      credential: credential.credential,
      homeKey: homeAlerts.homeKey,
      phones: registry,
      outbox: homeAlerts.outbox,
      commands: (wrapper) => gateway.commands(wrapper, "relay"),
      log,
      ...(options.relayTiming === undefined ? {} : { timing: options.relayTiming }),
    });
  }

  /** Step 4: the home key and the outbox, for the alert intake and the LAN gateway's fetch. */
  async function openAlerts(home: Home): Promise<HomeAlerts | undefined> {
    alerts ??= openHomeAlerts(home, log).catch((error: unknown) => {
      log(`L1 bridge: alerts for phones could not start: ${errorMessage(error)}`);
      return undefined;
    });
    const opened = await alerts;
    if (stopping === undefined) alertsReady = opened;
    return opened;
  }

  // The page's port comes first: a second bridge must exit before it touches the coordinator.
  const server = await startSetupServer({
    ...options,
    log,
    onHomeReady,
    phoneAccess: () => started,
    homeAlerts: () => alertsReady,
    remoteAccess: () => remoteAccessText(relayLink?.status() ?? remote),
    keepAwakeProblem: () => keepAwake?.problem(),
    liveView: () => liveView,
  });
  const stopFile = path.join(options.stateDir, settings.STATE_NAMES.bridgeStop);
  try {
    await removePath(stopFile); // one left from a run that ended before it found it
  } catch (error) {
    await server.close();
    throw error;
  }

  async function shutdown(reason: string): Promise<void> {
    clearInterval(stopFilePoll);
    for (const [signal, handler] of signalHandlers) process.off(signal, handler);
    log(`L1 bridge: ${reason}; stopping`);
    await relayLink?.close();
    await (await phones)?.close().catch((error: unknown) => {
      log(`L1 bridge: could not stop the network side: ${errorMessage(error)}`);
      process.exitCode = 1;
    });
    await server.close().catch((error: unknown) => {
      log(`L1 bridge: could not stop the coordinator: ${errorMessage(error)}`);
      process.exitCode = 1;
    });
    await keepAwake?.stop();
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
    // Before the coordinator starts: the laptop must not sleep while the home is watched.
    keepAwake = await KeepAwake.start({ ...options.keepAwake, log });
    // By role: the home laptop starts its coordinator; a laptop that joined a home, its worker.
    if (home) await server.homeReady(home);
    else await server.resumeLaptop();
    await (options.open ?? ((url) => openInBrowser(url, browserCommand(url))))(server.url);
  } catch (error) {
    requestStop(`could not start: ${errorMessage(error)}`);
    await stopping;
    throw error;
  }
  return {
    url: server.url,
    stopFile,
    /** The phone side, once the home is ready and until the bridge stops. */
    phones: () => started,
    /** The relay link, while relay-credential.json is usable and the bridge runs (step 5). */
    relayLink: () => relayLink,
    /** The helper that keeps this laptop awake, from before the coordinator starts. */
    keepAwake: () => keepAwake,
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
