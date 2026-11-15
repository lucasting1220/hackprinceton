/**
 * The hubs' WebSocket at /v1/hub (phone-hub.md §5, hub-relay-messages.json): the hub signs in with
 * its hub credential on the upgrade request, one connection per home, its phone list, its delivered
 * wrappers (stored, then acknowledged) and the phones' commands it answers. It never logs a
 * credential or a message's contents: only home, device and message IDs, types and codes.
 */
import type * as http from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { credentialHash } from "../../bridge/src/phone-crypto.ts";
import {
  encodeFrame,
  HUB_CLOSE,
  HUB_PATH,
  type NackError,
  parseHubFrame,
  type RelayFrame,
} from "../../bridge/src/relay-protocol.ts";
import {
  RELAY_COMMAND_TIMEOUT_MS,
  RELAY_HUB_MAX_FRAME_BYTES,
  RELAY_HUB_PING_INTERVAL_MS,
  RELAY_HUB_SILENT_CLOSE_MS,
  RELAY_MAX_BODY_BYTES,
} from "../../bridge/src/settings.ts";
import type { Wrapper } from "../../bridge/src/wire.ts";
import { type RelayStore, RelayStoreError } from "./store.ts";

/** What became of a phone's command at the hub. */
export type CommandOutcome =
  | Readonly<{ kind: "offline" }>
  | Readonly<{ kind: "timeout" }>
  | Readonly<{ kind: "accepted" }>
  | Readonly<{ kind: "refused"; status: number; code: string }>;

/** Passes a phone's command to its home's hub; the phone API's view of the hub socket. */
export interface CommandForwarder {
  forward(homeId: string, from: string, wrapper: Wrapper): Promise<CommandOutcome>;
}

export interface HubSocket extends CommandForwarder {
  /** For the HTTP server's `upgrade` event: signs the hub in, or answers 401 or 404 and closes. */
  handleUpgrade(request: http.IncomingMessage, socket: Duplex, head: Buffer): void;
  /** Tells the home's hub, if connected, that a phone unpaired itself (phone API's onUnpair). */
  phoneUnpaired(homeId: string, deviceId: string): void;
  connected(homeId: string): boolean;
  /** Ends every hub connection (code 1001) and answers their waiting commands as offline. */
  close(): void;
}

export interface HubSocketOptions {
  readonly store: RelayStore;
  /** The clock, in milliseconds; tests pass their own. */
  readonly now?: () => number;
  readonly log?: (line: string) => void;
  /**
   * A hub was heard from: its connection opened, or a frame or pong arrived. The watchdog owns the
   * last contact time; without one, the time is recorded in the store.
   */
  readonly onContact?: (homeId: string, atMs: number) => void;
  /** A new message was stored and acknowledged (never a duplicate): pushes start here (R13). */
  readonly onStored?: (homeId: string, wrapper: Wrapper, seq: number) => void;
  readonly pingIntervalMs?: number;
  readonly silentCloseMs?: number;
  readonly commandTimeoutMs?: number;
}

const BEARER = /^Bearer ([A-Za-z0-9_-]{1,256})$/;

interface Waiting {
  readonly settle: (outcome: CommandOutcome) => void;
}

interface Connection {
  readonly homeId: string;
  readonly credentialSha256: string;
  readonly ws: WebSocket;
  readonly waiting: Map<string, Waiting>;
  lastHeardMs: number;
  loggedUnknown: boolean;
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** The class of what was thrown: all a log line says of a failure. */
const errorClass = (error: unknown): string =>
  error instanceof Error ? error.constructor.name : typeof error;

/** Whether the store failed to write, as with a full disk, rather than this code being wrong. */
function isStorageError(error: unknown): boolean {
  if (error instanceof RelayStoreError) return true;
  return error instanceof Error && "code" in error && error.code === "ERR_SQLITE_ERROR";
}

/** Answers an upgrade request with a bare status and closes the socket. */
function refuseUpgrade(socket: Duplex, status: 401 | 404, reason: string): void {
  socket.once("finish", () => socket.destroy());
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

export function createHubSocket(options: HubSocketOptions): HubSocket {
  const { store } = options;
  const now = options.now ?? Date.now;
  const log = options.log ?? ((line: string) => console.log(line));
  const onContact =
    options.onContact ?? ((homeId: string, atMs: number) => store.recordContact(homeId, atMs));
  const pingIntervalMs = options.pingIntervalMs ?? RELAY_HUB_PING_INTERVAL_MS;
  const silentCloseMs = options.silentCloseMs ?? RELAY_HUB_SILENT_CLOSE_MS;
  const commandTimeoutMs = options.commandTimeoutMs ?? RELAY_COMMAND_TIMEOUT_MS;
  const connections = new Map<string, Connection>();
  const server = new WebSocketServer({
    noServer: true,
    maxPayload: RELAY_HUB_MAX_FRAME_BYTES,
    perMessageDeflate: false,
  });

  const send = (connection: Connection, frame: RelayFrame): void => {
    if (connection.ws.readyState !== WebSocket.OPEN) return;
    // ws calls back with null, not undefined, when the frame was sent.
    connection.ws.send(encodeFrame(frame), (error?: Error | null) => {
      if (error !== undefined && error !== null) {
        log(
          `L1 relay: a ${frame.type} frame to home ${connection.homeId} failed: ${errorClass(error)}`,
        );
      }
    });
  };

  const heard = (connection: Connection): void => {
    connection.lastHeardMs = now();
    onContact(connection.homeId, connection.lastHeardMs);
  };

  const nack = (connection: Connection, msgId: string, error: NackError): void => {
    log(`L1 relay: refused message ${msgId} of home ${connection.homeId}: ${error}`);
    send(connection, { type: "nack", v: 1, msg_id: msgId, error });
  };

  /** Size cap and the kid rule, then stored before the ack; a repeat is acknowledged again. */
  const deliver = (connection: Connection, wrapper: Wrapper): void => {
    const { homeId } = connection;
    if (Buffer.byteLength(JSON.stringify(wrapper)) > RELAY_MAX_BODY_BYTES) {
      nack(connection, wrapper.msg_id, "too_large");
      return;
    }
    const kid = wrapper.envelope.kid;
    if (wrapper.to === undefined ? kid !== "home" : kid !== wrapper.to) {
      nack(connection, wrapper.msg_id, "invalid");
      return;
    }
    let stored: ReturnType<RelayStore["storeMessage"]>;
    try {
      stored = store.storeMessage(homeId, wrapper, now());
    } catch (error) {
      if (!isStorageError(error)) throw error;
      log(
        `L1 relay: storing message ${wrapper.msg_id} of home ${homeId} failed: ${errorClass(error)}`,
      );
      nack(connection, wrapper.msg_id, "storage");
      return;
    }
    send(connection, { type: "ack", v: 1, msg_id: wrapper.msg_id });
    if (!stored.duplicate) options.onStored?.(homeId, wrapper, stored.seq);
  };

  const onFrame = (connection: Connection, data: WebSocket.RawData, isBinary: boolean): void => {
    const { homeId } = connection;
    // A replaced credential ends the connection at its next frame (`admin provision --replace`).
    if (store.homeByHubCredential(connection.credentialSha256)?.homeId !== homeId) {
      log(`L1 relay: the hub credential of home ${homeId} was replaced; closing its connection`);
      connection.ws.close(HUB_CLOSE.credentialRevoked, "credential revoked");
      return;
    }
    heard(connection);
    let text: string;
    try {
      if (isBinary) throw new TypeError("binary frame");
      text = utf8.decode(Array.isArray(data) ? Buffer.concat(data) : data);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      log(`L1 relay: home ${homeId}'s hub sent a frame that isn't UTF-8 text; ignored`);
      return;
    }
    const parsed = parseHubFrame(text);
    if (!parsed.ok) {
      if (parsed.type === "deliver" && parsed.msgId !== undefined) {
        nack(connection, parsed.msgId, "invalid");
      } else if (!parsed.known) {
        if (!connection.loggedUnknown) {
          log(`L1 relay: home ${homeId}'s hub sent a frame this relay doesn't know; ignored`);
        }
        connection.loggedUnknown = true;
      } else {
        log(
          `L1 relay: home ${homeId}'s hub sent a ${parsed.type ?? "frame"} with a bad ${parsed.field}`,
        );
      }
      return;
    }
    const { frame } = parsed;
    switch (frame.type) {
      case "phones": {
        const { revoked, refused } = store.syncDevices(homeId, frame.phones, now());
        log(
          `L1 relay: home ${homeId} lists ${frame.phones.length} phones; ${revoked.length} newly revoked`,
        );
        for (const deviceId of refused) {
          log(
            `L1 relay: home ${homeId} listed device ${deviceId}, which is another home's; refused`,
          );
        }
        return;
      }
      case "deliver":
        deliver(connection, frame.wrapper);
        return;
      case "command_result": {
        const waiting = connection.waiting.get(frame.msg_id);
        if (waiting === undefined) {
          log(
            `L1 relay: home ${homeId}'s hub answered command ${frame.msg_id}, which isn't waiting`,
          );
          return;
        }
        waiting.settle(
          frame.code === null
            ? { kind: "accepted" }
            : { kind: "refused", status: frame.status, code: frame.code },
        );
        return;
      }
    }
  };

  const closed = (connection: Connection, code: number): void => {
    for (const waiting of connection.waiting.values()) waiting.settle({ kind: "offline" });
    if (connections.get(connection.homeId) !== connection) return;
    connections.delete(connection.homeId);
    store.setHubConnected(connection.homeId, false);
    log(`L1 relay: the hub of home ${connection.homeId} disconnected (code ${code})`);
  };

  const attach = (ws: WebSocket, homeId: string, credentialSha256: string): void => {
    const connection: Connection = {
      homeId,
      credentialSha256,
      ws,
      waiting: new Map(),
      lastHeardMs: now(),
      loggedUnknown: false,
    };
    const previous = connections.get(homeId);
    connections.set(homeId, connection);
    if (previous !== undefined) {
      log(`L1 relay: a newer connection replaces the hub connection of home ${homeId}`);
      previous.ws.close(HUB_CLOSE.replaced, "replaced");
    }
    store.setHubConnected(homeId, true);
    log(`L1 relay: the hub of home ${homeId} connected`);
    heard(connection);
    const pinger = setInterval(() => {
      if (now() - connection.lastHeardMs >= silentCloseMs) {
        log(`L1 relay: the hub of home ${homeId} missed its pongs; ending its connection`);
        ws.terminate();
      } else {
        ws.ping();
      }
    }, pingIntervalMs);
    pinger.unref();
    ws.on("message", (data, isBinary) => {
      try {
        onFrame(connection, data, isBinary);
      } catch (error) {
        log(`L1 relay: a frame from home ${homeId}'s hub failed: ${errorClass(error)}; closing`);
        ws.close(1011, "internal error");
      }
    });
    ws.on("pong", () => heard(connection));
    ws.on("error", (error) => {
      log(`L1 relay: the hub connection of home ${homeId} failed: ${errorClass(error)}`);
    });
    ws.on("close", (code) => {
      clearInterval(pinger);
      closed(connection, code);
    });
    send(connection, {
      type: "welcome",
      v: 1,
      home_id: homeId,
      revoked: store.revokedDevices(homeId),
    });
  };

  return {
    handleUpgrade(request, socket, head) {
      const url = new URL(request.url ?? "/", "http://relay.invalid");
      if (url.pathname !== HUB_PATH) {
        refuseUpgrade(socket, 404, "Not Found");
        return;
      }
      const credential = BEARER.exec(request.headers.authorization ?? "")?.[1];
      const hash = credential === undefined ? undefined : credentialHash(credential);
      const home = hash === undefined ? undefined : store.homeByHubCredential(hash);
      if (hash === undefined || home === undefined) {
        log("L1 relay: refused a hub sign-in with a missing or unknown credential");
        refuseUpgrade(socket, 401, "Unauthorized");
        return;
      }
      server.handleUpgrade(request, socket, head, (ws) => attach(ws, home.homeId, hash));
    },

    forward(homeId, from, wrapper) {
      const connection = connections.get(homeId);
      if (connection === undefined || connection.ws.readyState !== WebSocket.OPEN) {
        return Promise.resolve({ kind: "offline" });
      }
      const msgId = wrapper.msg_id;
      if (connection.waiting.has(msgId)) {
        return Promise.resolve({ kind: "refused", status: 409, code: "duplicate" });
      }
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          log(`L1 relay: the hub of home ${homeId} didn't answer command ${msgId} in time`);
          settle({ kind: "timeout" });
        }, commandTimeoutMs);
        const settle = (outcome: CommandOutcome): void => {
          clearTimeout(timer);
          connection.waiting.delete(msgId);
          resolve(outcome);
        };
        connection.waiting.set(msgId, { settle });
        send(connection, { type: "command", v: 1, from, wrapper });
      });
    },

    phoneUnpaired(homeId, deviceId) {
      const connection = connections.get(homeId);
      if (connection === undefined) return;
      send(connection, { type: "phone_unpaired", v: 1, device_id: deviceId });
    },

    connected(homeId) {
      return connections.has(homeId);
    },

    close() {
      for (const connection of [...connections.values()]) {
        connection.ws.close(1001, "relay stopping");
        closed(connection, 1001);
      }
      server.close();
    },
  };
}
