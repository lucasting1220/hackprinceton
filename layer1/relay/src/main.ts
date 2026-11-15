/**
 * The relay's main program: `npm run relay -- --config <relay.json>`. It wires one store, the hub
 * socket, the phone API, Apple's push service, Debbie's pushes and the watchdog, listens on
 * 127.0.0.1 at relay.json's listen_port behind Caddy, and stops cleanly when relay.json's stop_file
 * appears or on SIGTERM: the hub socket first, then the HTTP server, then the store.
 */
import { existsSync } from "node:fs";
import type * as http from "node:http";
import type * as http2 from "node:http2";
import { parseArgs } from "node:util";
import { errorMessage, removePath } from "../../bridge/src/json-file.ts";
import {
  LOCAL_HOST,
  RELAY_LISTEN_TIMEOUT_MS,
  RELAY_PUSH_DRAIN_MS,
  RELAY_STOP_DEADLINE_MS,
  RELAY_STOP_POLL_MS,
  RELAY_SWEEP_INTERVAL_MS,
} from "../../bridge/src/settings.ts";
import { ApnsClient } from "./apns.ts";
import { loadRelayConfig, missingPushSetup, type RelayConfig } from "./config.ts";
import { createHubSocket } from "./hub-socket.ts";
import { isSignalPath, LiveViewSessions } from "./live-view.ts";
import { createPhoneApi, SignInLimiter, signIn } from "./phone-api.ts";
import { Pusher } from "./push.ts";
import { RelayStore } from "./store.ts";
import { TurnSecretError, TurnServers } from "./turn.ts";
import { Watchdog } from "./watchdog.ts";

/** The signals that stop the relay: systemd's stop, and Ctrl+C when run by hand. */
const STOP_SIGNALS = ["SIGTERM", "SIGINT"] as const;

export interface RelayOptions {
  readonly log?: (line: string) => void;
  /** Where each environment's APNs is: Apple's hosts by default, or a test's fake. */
  readonly apnsOrigins?: Readonly<Record<"production" | "sandbox", string>>;
  readonly apnsTls?: http2.SecureClientSessionOptions;
}

export interface RunningRelay {
  /** Where the relay listens: http://127.0.0.1:<listen_port>. */
  readonly url: string;
  /** Stops the relay, once whatever asks; resolves once it has stopped. */
  stop(reason: string): Promise<void>;
  /** Resolves once the relay has stopped, whatever stopped it. */
  readonly stopped: Promise<void>;
}

/** The relay couldn't start, such as with its port already in use. The message says why. */
export class RelayStartError extends Error {
  override name = "RelayStartError";
}

/** Resolves after `ms`, or with `work`, whichever is first; true when `work` finished. */
async function within(work: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([work.then(() => true), late]);
  } finally {
    clearTimeout(timer);
  }
}

/** Listens on 127.0.0.1 at `port`; a busy port is a RelayStartError naming it. */
function listen(server: http.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      done();
      reject(new RelayStartError(`${LOCAL_HOST}:${port} did not start listening in time`));
    }, RELAY_LISTEN_TIMEOUT_MS);
    const onError = (error: NodeJS.ErrnoException) => {
      done();
      reject(
        error.code === "EADDRINUSE"
          ? new RelayStartError(
              `port ${port} on ${LOCAL_HOST} is already in use; stop what uses it or change relay.json's listen_port`,
            )
          : error,
      );
    };
    const onListening = () => {
      done();
      resolve();
    };
    const done = () => {
      clearTimeout(timer);
      server.off("error", onError);
      server.off("listening", onListening);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, LOCAL_HOST);
  });
}

/** Closes the HTTP server: idle connections at once, the rest after the stop deadline. */
async function closeServer(server: http.Server): Promise<boolean> {
  const closed = new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
  server.closeIdleConnections();
  if (await within(closed, RELAY_STOP_DEADLINE_MS)) return true;
  server.closeAllConnections();
  await closed;
  return false;
}

/**
 * coturn's servers for live view, from relay.json's turn block. Without the block, or with a secret
 * file that can't be read, live view offers no STUN or TURN server; the relay runs on and says so.
 */
async function loadTurn(
  config: RelayConfig,
  log: (line: string) => void,
): Promise<TurnServers | undefined> {
  if (config.turn === undefined) {
    log(
      "L1 relay: no turn block in relay.json, so live view works only when both ends share a network",
    );
    return undefined;
  }
  try {
    return await TurnServers.load(config.turn);
  } catch (error) {
    if (!(error instanceof TurnSecretError)) throw error;
    log(`L1 relay: live view has no TURN server: ${error.message}`);
    return undefined;
  }
}

/** Starts the relay with `config`; it runs until its stop file appears, SIGTERM, or `stop`. */
export async function startRelay(
  config: RelayConfig,
  options: RelayOptions = {},
): Promise<RunningRelay> {
  const log = options.log ?? ((line: string) => console.log(line));
  await removePath(config.stop_file); // one left from a run that ended before it found it
  const store = RelayStore.open(config.database_file);
  // No hub is connected to a relay that is only starting, whatever the last run recorded.
  for (const home of store.homes()) store.setHubConnected(home.homeId, false);
  for (const line of missingPushSetup(config)) log(line);

  const apns = new ApnsClient({
    store,
    apns: config.apns,
    log,
    ...(options.apnsOrigins === undefined ? {} : { origins: options.apnsOrigins }),
    ...(options.apnsTls === undefined ? {} : { tls: options.apnsTls }),
  });
  const pusher = new Pusher({ store, sender: apns, log });
  const watchdog = new Watchdog({ store, pusher, config, log });
  const turn = await loadTurn(config, log);
  let liveView: LiveViewSessions | undefined;
  const hub = createHubSocket({
    store,
    log,
    onContact: (homeId) => watchdog.contact(homeId),
    onStored: (homeId, wrapper, seq) =>
      pusher.delivered(homeId, wrapper, { seq, duplicate: false }),
    onLiveView: (homeId, frame) =>
      frame.type === "live_view_answer"
        ? liveView?.hubAnswered(homeId, frame)
        : liveView?.hubEnded(homeId, frame),
    onDisconnect: (homeId) => liveView?.hubDisconnected(homeId),
  });
  liveView = new LiveViewSessions({
    hub,
    log,
    publicUrl: config.public_url,
    signIn: (headers) => {
      const signed = signIn(store, headers);
      return signed.ok ? { ok: true, deviceId: signed.device.deviceId } : { ok: false };
    },
    ...(turn === undefined ? {} : { turn }),
  });
  const server = createPhoneApi({
    store,
    config,
    log,
    commands: hub,
    liveView,
    limiter: new SignInLimiter(),
    onUnpair: (homeId, deviceId) => hub.phoneUnpaired(homeId, deviceId),
  });
  server.on("upgrade", (request, socket, head) => {
    const { pathname } = new URL(request.url ?? "/", "http://relay.invalid");
    if (isSignalPath(pathname)) liveView?.handleUpgrade(request, socket, head);
    else hub.handleUpgrade(request, socket, head);
  });
  try {
    await listen(server, config.listen_port);
  } catch (error) {
    liveView.close();
    hub.close();
    store.close();
    throw error;
  }

  const sweep = (): void => {
    try {
      const deleted = store.sweep(Date.now());
      if (deleted > 0) log(`L1 relay: deleted ${deleted} messages past the 7-day window`);
    } catch (error) {
      log(`L1 relay: the 7-day sweep failed: ${errorMessage(error)}`);
    }
  };
  sweep();
  const sweepTimer = setInterval(sweep, RELAY_SWEEP_INTERVAL_MS);
  watchdog.start();
  const repushed = pusher.repushUnpushed();
  if (repushed > 0) log(`L1 relay: ${repushed} alerts cut off by the last stop are pushed now`);

  let stopping: Promise<void> | undefined;
  const stopped = Promise.withResolvers<void>();

  async function shutdown(reason: string): Promise<void> {
    clearInterval(stopFilePoll);
    clearInterval(sweepTimer);
    for (const [signal, handler] of signalHandlers) process.off(signal, handler);
    log(`L1 relay: ${reason}; stopping`);
    watchdog.stop();
    liveView?.close();
    hub.close();
    if (!(await closeServer(server))) {
      log("L1 relay: phone requests still open at the deadline were cut off");
    }
    if (!(await within(pusher.settled(), RELAY_PUSH_DRAIN_MS))) {
      log("L1 relay: pushes still in flight are left to the next start's re-push");
    }
    apns.close();
    store.close();
    await removePath(config.stop_file).catch((error: unknown) => {
      log(`L1 relay: could not remove ${config.stop_file}: ${errorMessage(error)}`);
      process.exitCode = 1;
    });
    log("L1 relay: stopped");
  }

  /** Starts the shutdown once, whatever asks; a failure is logged and sets exit code 1. */
  function requestStop(reason: string): void {
    stopping ??= shutdown(reason)
      .catch((error: unknown) => {
        log(`L1 relay: stopping failed: ${errorMessage(error)}`);
        process.exitCode = 1;
      })
      .finally(() => stopped.resolve());
  }

  const signalHandlers = STOP_SIGNALS.map((signal) => {
    const handler = () => requestStop(`${signal} received`);
    process.on(signal, handler);
    return [signal, handler] as const;
  });
  const stopFilePoll = setInterval(() => {
    if (existsSync(config.stop_file)) requestStop(`${config.stop_file} found`);
  }, RELAY_STOP_POLL_MS);

  const bound = server.address();
  const url =
    bound !== null && typeof bound === "object"
      ? `http://${bound.address}:${bound.port}`
      : `http://${LOCAL_HOST}:${config.listen_port}`;
  log(`L1 relay: listening on ${url}, for ${config.public_url}`);
  return {
    url,
    stop(reason) {
      requestStop(reason);
      return stopping ?? stopped.promise;
    },
    stopped: stopped.promise,
  };
}

/** `npm run relay -- --config <relay.json>`. */
async function main(): Promise<void> {
  const { values } = parseArgs({ options: { config: { type: "string" } }, strict: true });
  if (values.config === undefined) throw new RelayStartError("--config <relay.json> is required");
  const relay = await startRelay(await loadRelayConfig(values.config));
  await relay.stopped;
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(`L1 relay: could not start: ${errorMessage(error)}`);
    process.exitCode = 1;
  });
}
