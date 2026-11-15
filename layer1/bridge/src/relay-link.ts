/**
 * The hub's link to the relay (step 5): the coordinator's bridge keeps one WebSocket open to the
 * relay's /v1/hub with the hub credential, and over it sends the phone list, the outbox's sealed
 * messages and a heartbeat, and answers phones' commands through the LAN gateway's command switch.
 * Node's built-in WebSocket, so bridge/ needs no `ws`. Log lines start "L1 relay link:" and name
 * message and device IDs, types and codes only: never the credential or a message's contents.
 *
 *   connect ─open─▶ welcome ─▶ remove revoked phones, send phones, drain the outbox, heartbeats
 *      ▲  └─refused before open─▶ ask the relay's status: 401 ─▶ rejected, retry every 5 minutes
 *      │                                                 else ─▶ back off 1, 2, 5, 10, 15 s
 *      └──── closed (4002 means the credential was replaced: rejected) ◀── no heartbeat ack in 10 s
 */
import { type KeyObject, randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { sealHeartbeat } from "./home-messages.ts";
import { errorMessage } from "./json-file.ts";
import type { Reply } from "./network-server.ts";
import type { OutboxEntry } from "./outbox.ts";
import type { RelayPhone } from "./phones.ts";
import type { RelayCredential } from "./relay-credential.ts";
import {
  type CommandFrame,
  encodeFrame,
  HUB_CLOSE,
  HUB_PATH,
  type HubFrame,
  type PhoneEntry,
  parseRelayFrame,
} from "./relay-protocol.ts";
import * as settings from "./settings.ts";
import { utcSeconds, type Wrapper } from "./wire.ts";

/** What the link needs of the phone list: phones.ts's PhoneRegistry. */
export interface RelayLinkPhones {
  relayList(): RelayPhone[];
  remove(deviceId: string): Promise<void>;
  onChange(listener: () => void): () => void;
}

/** What the link needs of the outbox: outbox.ts's Outbox. */
export interface RelayLinkOutbox {
  pending(limit: number, notBefore?: string): readonly OutboxEntry[];
  markRelayed(msgId: string): Promise<void>;
  markRefused(msgId: string): Promise<void>;
  onAdded(listener: () => void): () => void;
}

/** Answers a relayed command as the LAN gateway does: lan-gateway.ts's commands(…, "relay"). */
export type RelayCommands = (wrapper: Wrapper) => Promise<Reply>;

/** The link's times and limits; settings.ts's by default, tests pass shorter ones. */
export interface RelayLinkTiming {
  readonly backoffMs: readonly number[];
  readonly backoffResetMs: number;
  readonly rejectedRetryMs: number;
  readonly heartbeatMs: number;
  readonly ackTimeoutMs: number;
  readonly connectTimeoutMs: number;
  readonly inFlightMax: number;
}

export interface RelayLinkOptions {
  readonly credential: RelayCredential;
  /** Seals the heartbeat, through home-messages.ts. Never log it. */
  readonly homeKey: KeyObject;
  readonly phones: RelayLinkPhones;
  readonly outbox: RelayLinkOutbox;
  readonly commands: RelayCommands;
  readonly log?: (line: string) => void;
  /** The clock, in milliseconds since the Unix epoch; tests pass their own. */
  readonly now?: () => number;
  readonly timing?: Partial<RelayLinkTiming>;
}

/** The link's state for the setup page. `at` is when the next try starts, in milliseconds. */
export type RelayLinkStatus =
  | Readonly<{ state: "connecting" }>
  | Readonly<{ state: "connected"; since: string }>
  | Readonly<{ state: "retrying"; at: number; reason: string }>
  | Readonly<{ state: "rejected" }>
  | Readonly<{ state: "stopped" }>;

/** The setup page's remote access line: no credential file, one that can't be used, or the link. */
export type RemoteAccess =
  | Readonly<{ state: "not_set_up" }>
  | Readonly<{ state: "unusable"; file: string; reason: string }>
  | RelayLinkStatus;

/** The words after "Remote access: " on the setup page. Never the credential. */
export function remoteAccessText(access: RemoteAccess, now: number = Date.now()): string {
  switch (access.state) {
    case "not_set_up":
      return "not set up";
    case "unusable":
      return `the credential file ${access.file} can't be used (${access.reason}); import it again`;
    case "connecting":
      return "connecting to the relay";
    case "connected":
      return `connected to the relay since ${access.since}`;
    case "retrying": {
      const seconds = Math.max(1, Math.ceil((access.at - now) / 1000));
      return `can't reach the relay (${access.reason}); retrying in ${seconds} s`;
    }
    case "rejected":
      return "the relay rejected this home's credential: run the provisioning command again";
    case "stopped":
      return "stopped";
  }
}

const DEFAULT_TIMING: RelayLinkTiming = {
  backoffMs: settings.RELAY_LINK_BACKOFF_MS,
  backoffResetMs: settings.RELAY_LINK_BACKOFF_RESET_MS,
  rejectedRetryMs: settings.RELAY_LINK_REJECTED_RETRY_MS,
  heartbeatMs: settings.RELAY_HEARTBEAT_INTERVAL_MS,
  ackTimeoutMs: settings.RELAY_LINK_ACK_TIMEOUT_MS,
  connectTimeoutMs: settings.RELAY_LINK_CONNECT_TIMEOUT_MS,
  inFlightMax: settings.RELAY_LINK_IN_FLIGHT_MAX,
};

/** The relay's hub socket URL for its public URL: https → wss, http → ws. */
export function hubSocketUrl(relayUrl: string): URL {
  const url = new URL(HUB_PATH, relayUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url;
}

/**
 * The HTTP status the relay gives a WebSocket upgrade with `authorization`, which the built-in
 * WebSocket doesn't report: 101 when it would upgrade, undefined when it doesn't answer in time.
 */
export function upgradeStatus(
  url: URL,
  authorization: string,
  timeoutMs: number,
): Promise<number | undefined> {
  const target = new URL(url);
  target.protocol = url.protocol === "wss:" ? "https:" : "http:";
  const send = target.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve) => {
    const request = send(target, {
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": randomBytes(16).toString("base64"),
        Authorization: authorization,
      },
      timeout: timeoutMs,
    });
    request.once("upgrade", (_response, socket) => {
      socket.destroy();
      resolve(101);
    });
    request.once("response", (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.once("timeout", () => request.destroy());
    request.once("error", () => resolve(undefined));
    request.end();
  });
}

const toEntry = (phone: RelayPhone): PhoneEntry =>
  phone.removed
    ? { device_id: phone.deviceId, removed: true }
    : {
        device_id: phone.deviceId,
        role: phone.role,
        credential_sha256: phone.credentialSha256,
        removed: false,
      };

/** A reply's §1 error code, or "internal" when it has none. */
function replyCode(reply: Reply): string {
  const error: unknown = Reflect.get(reply.body, "error");
  const code = typeof error === "object" && error !== null ? Reflect.get(error, "code") : undefined;
  return typeof code === "string" ? code : "internal";
}

export class RelayLink {
  readonly #credential: RelayCredential;
  readonly #homeKey: KeyObject;
  readonly #phones: RelayLinkPhones;
  readonly #outbox: RelayLinkOutbox;
  readonly #commands: RelayCommands;
  readonly #log: (line: string) => void;
  readonly #now: () => number;
  readonly #timing: RelayLinkTiming;
  readonly #url: URL;
  readonly #unsubscribe: Array<() => void> = [];
  #status: RelayLinkStatus = { state: "connecting" };
  #ws: WebSocket | undefined;
  /** Whether the current connection has had its welcome, after which it may send. */
  #welcomed = false;
  #openedAt = 0;
  #attempt = 0;
  #closed = false;
  #retryTimer: NodeJS.Timeout | undefined;
  #heartbeatTimer: NodeJS.Timeout | undefined;
  #ackTimer: NodeJS.Timeout | undefined;
  #pumpTimer: NodeJS.Timeout | undefined;
  /** Heartbeats sent and not yet acknowledged; the ack timer runs from the oldest. */
  readonly #heartbeats = new Set<string>();
  /** Outbox messages sent on this connection and not yet acknowledged. */
  readonly #inFlight = new Set<string>();
  /** Outbox messages the relay couldn't store, and when each may be sent again. */
  readonly #retryAfter = new Map<string, number>();

  constructor(options: RelayLinkOptions) {
    this.#credential = options.credential;
    this.#homeKey = options.homeKey;
    this.#phones = options.phones;
    this.#outbox = options.outbox;
    this.#commands = options.commands;
    this.#log = options.log ?? ((line: string) => console.log(line));
    this.#now = options.now ?? Date.now;
    this.#timing = { ...DEFAULT_TIMING, ...options.timing };
    this.#url = hubSocketUrl(options.credential.relayUrl);
  }

  /** Starts a link and its first connection. */
  static start(options: RelayLinkOptions): RelayLink {
    const link = new RelayLink(options);
    link.#unsubscribe.push(
      link.#phones.onChange(() => link.#sendPhones()),
      link.#outbox.onAdded(() => link.#pump()),
    );
    link.#connect();
    return link;
  }

  status(): RelayLinkStatus {
    return this.#status;
  }

  /** Ends the link and its connection; resolves once the connection closed, or after a wait. */
  async close(): Promise<void> {
    this.#closed = true;
    for (const stop of this.#unsubscribe.splice(0)) stop();
    clearTimeout(this.#retryTimer);
    clearTimeout(this.#pumpTimer);
    this.#stopHeartbeat();
    this.#status = { state: "stopped" };
    const ws = this.#ws;
    this.#ws = undefined;
    if (ws === undefined || ws.readyState === WebSocket.CLOSED) return;
    let timer: NodeJS.Timeout | undefined;
    await new Promise<void>((resolve) => {
      ws.addEventListener("close", () => resolve());
      timer = setTimeout(resolve, this.#timing.connectTimeoutMs);
      ws.close(1000, "bridge stopping");
    });
    clearTimeout(timer);
  }

  #connect(): void {
    if (this.#closed) return;
    this.#status = { state: "connecting" };
    this.#welcomed = false;
    const ws = new WebSocket(this.#url, {
      headers: { Authorization: this.#credential.authorization() },
    });
    this.#ws = ws;
    let opened = false;
    let reason: string | undefined;
    const connectTimer = setTimeout(() => {
      reason = "the relay didn't answer in time";
      ws.close();
    }, this.#timing.connectTimeoutMs);
    ws.addEventListener("open", () => {
      clearTimeout(connectTimer);
      opened = true;
      this.#openedAt = this.#now();
      this.#status = { state: "connected", since: utcSeconds(new Date(this.#openedAt)) };
      this.#log(`L1 relay link: connected to ${this.#url.host}`);
    });
    ws.addEventListener("message", (event) => {
      if (ws !== this.#ws) return;
      if (typeof event.data !== "string") {
        this.#log("L1 relay link: the relay sent a frame that isn't text; ignored");
        return;
      }
      this.#onFrame(ws, event.data);
    });
    ws.addEventListener("close", (event) => {
      clearTimeout(connectTimer);
      if (ws !== this.#ws) return;
      this.#onClose(opened, event.code, reason).catch((error: unknown) => {
        this.#log(`L1 relay link: reconnecting failed: ${errorMessage(error)}`);
      });
    });
  }

  async #onClose(opened: boolean, code: number, reason: string | undefined): Promise<void> {
    this.#ws = undefined;
    this.#welcomed = false;
    this.#stopHeartbeat();
    clearTimeout(this.#pumpTimer);
    this.#inFlight.clear();
    this.#retryAfter.clear();
    if (this.#closed) return;
    if (code === HUB_CLOSE.credentialRevoked) {
      this.#rejected();
      return;
    }
    if (!opened && reason === undefined) {
      const status = await upgradeStatus(
        this.#url,
        this.#credential.authorization(),
        this.#timing.connectTimeoutMs,
      );
      if (this.#closed) return;
      if (status === 401) {
        this.#rejected();
        return;
      }
      reason = status === undefined ? "no answer" : `it answered ${status}`;
    }
    if (opened && this.#now() - this.#openedAt >= this.#timing.backoffResetMs) this.#attempt = 0;
    const { backoffMs } = this.#timing;
    const delay = backoffMs[Math.min(this.#attempt, backoffMs.length - 1)] ?? 0;
    this.#attempt += 1;
    const why = reason ?? `the connection closed with code ${code}`;
    this.#log(`L1 relay link: ${why}; connecting again in ${delay} ms`);
    this.#retry(delay, why);
  }

  #rejected(): void {
    this.#log("L1 relay link: the relay rejected this home's credential; run provisioning again");
    this.#retry(this.#timing.rejectedRetryMs, "rejected");
    this.#status = { state: "rejected" };
  }

  #retry(delay: number, reason: string): void {
    this.#status = { state: "retrying", at: this.#now() + delay, reason };
    clearTimeout(this.#retryTimer);
    this.#retryTimer = setTimeout(() => this.#connect(), delay);
  }

  #send(ws: WebSocket, frame: HubFrame): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(encodeFrame(frame));
  }

  #onFrame(ws: WebSocket, text: string): void {
    const parsed = parseRelayFrame(text);
    if (!parsed.ok) {
      const what = parsed.known
        ? `a ${parsed.type ?? "frame"} with a bad ${parsed.field}`
        : "an unknown frame";
      this.#log(`L1 relay link: the relay sent ${what}; ignored`);
      return;
    }
    const { frame } = parsed;
    switch (frame.type) {
      case "welcome":
        this.#welcome(ws, frame.home_id, frame.revoked).catch((error: unknown) => {
          this.#log(`L1 relay link: could not apply the welcome: ${errorMessage(error)}`);
        });
        return;
      case "ack":
        this.#acked(frame.msg_id);
        return;
      case "nack":
        this.#nacked(frame.msg_id, frame.error);
        return;
      case "command":
        this.#command(ws, frame).catch((error: unknown) => {
          this.#log(
            `L1 relay link: command ${frame.wrapper.msg_id} failed: ${errorMessage(error)}`,
          );
        });
        return;
      case "phone_unpaired":
        this.#log(`L1 relay link: phone ${frame.device_id} unpaired itself through the relay`);
        this.#phones.remove(frame.device_id).catch((error: unknown) => {
          this.#log(
            `L1 relay link: could not remove phone ${frame.device_id}: ${errorMessage(error)}`,
          );
        });
        return;
    }
  }

  /** Marks the revoked phones removed, then sends the phone list, the outbox and heartbeats. */
  async #welcome(ws: WebSocket, homeId: string, revoked: readonly string[]): Promise<void> {
    if (homeId !== this.#credential.homeId) {
      this.#log(`L1 relay link: the relay welcomed home ${homeId}, not this home; closing`);
      ws.close();
      return;
    }
    for (const deviceId of revoked) {
      // A removal that can't be saved is logged; the relay refuses that phone already.
      await this.#phones.remove(deviceId).catch((error: unknown) => {
        this.#log(`L1 relay link: could not remove phone ${deviceId}: ${errorMessage(error)}`);
      });
    }
    if (ws !== this.#ws) return;
    this.#welcomed = true;
    this.#sendPhones();
    this.#heartbeat();
    this.#pump();
  }

  #sendPhones(): void {
    const ws = this.#ws;
    if (ws === undefined || !this.#welcomed) return;
    const phones = this.#phones.relayList().map(toEntry);
    this.#send(ws, { type: "phones", v: 1, phones });
  }

  /** Sends pending outbox messages, oldest first, up to inFlightMax unacknowledged. */
  #pump(): void {
    const ws = this.#ws;
    if (ws === undefined || !this.#welcomed) return;
    const { inFlightMax } = this.#timing;
    const limit = inFlightMax + this.#inFlight.size + this.#retryAfter.size;
    const now = this.#now();
    for (const { wrapper } of this.#outbox.pending(limit, this.#credential.issuedAt)) {
      if (this.#inFlight.size >= inFlightMax) break;
      const id = wrapper.msg_id;
      if (this.#inFlight.has(id) || (this.#retryAfter.get(id) ?? 0) > now) continue;
      this.#retryAfter.delete(id);
      this.#inFlight.add(id);
      this.#send(ws, { type: "deliver", v: 1, wrapper });
    }
  }

  #acked(msgId: string): void {
    if (this.#heartbeats.has(msgId)) {
      this.#heartbeatAnswered();
      return;
    }
    if (!this.#inFlight.has(msgId)) return;
    this.#outbox
      .markRelayed(msgId)
      .catch((error: unknown) => {
        this.#log(`L1 relay link: could not mark message ${msgId} relayed: ${errorMessage(error)}`);
      })
      .finally(() => {
        this.#inFlight.delete(msgId);
        this.#pump();
      });
  }

  #nacked(msgId: string, error: "invalid" | "too_large" | "storage"): void {
    if (this.#heartbeats.has(msgId)) {
      this.#heartbeatAnswered();
      this.#log(`L1 relay link: the relay refused heartbeat ${msgId}: ${error}`);
      return;
    }
    if (!this.#inFlight.has(msgId)) return;
    if (error === "storage") {
      const { backoffMs } = this.#timing;
      const delay = backoffMs.at(-1) ?? 0;
      this.#log(
        `L1 relay link: the relay couldn't store message ${msgId}; retrying in ${delay} ms`,
      );
      this.#inFlight.delete(msgId);
      this.#retryAfter.set(msgId, this.#now() + delay);
      clearTimeout(this.#pumpTimer);
      this.#pumpTimer = setTimeout(() => this.#pump(), delay);
      return;
    }
    this.#log(`L1 relay link: the relay refused message ${msgId}: ${error}; it won't be resent`);
    this.#outbox
      .markRefused(msgId)
      .catch((failure: unknown) => {
        this.#log(
          `L1 relay link: could not mark message ${msgId} refused: ${errorMessage(failure)}`,
        );
      })
      .finally(() => {
        this.#inFlight.delete(msgId);
        this.#pump();
      });
  }

  /** Sends a heartbeat now and every heartbeatMs; one unacknowledged in ackTimeoutMs ends the link. */
  #heartbeat(): void {
    const ws = this.#ws;
    if (ws === undefined || !this.#welcomed) return;
    const wrapper = sealHeartbeat({ homeId: this.#credential.homeId, homeKey: this.#homeKey });
    if (this.#heartbeats.size === 0) {
      this.#ackTimer = setTimeout(() => {
        this.#log("L1 relay link: the relay didn't acknowledge a heartbeat; reconnecting");
        ws.close(4000, "no heartbeat ack");
      }, this.#timing.ackTimeoutMs);
    }
    this.#heartbeats.add(wrapper.msg_id);
    this.#send(ws, { type: "deliver", v: 1, wrapper });
    clearTimeout(this.#heartbeatTimer);
    this.#heartbeatTimer = setTimeout(() => this.#heartbeat(), this.#timing.heartbeatMs);
  }

  /** The relay answered a heartbeat, so the connection is alive. */
  #heartbeatAnswered(): void {
    clearTimeout(this.#ackTimer);
    this.#heartbeats.clear();
  }

  #stopHeartbeat(): void {
    clearTimeout(this.#heartbeatTimer);
    this.#heartbeatAnswered();
  }

  /**
   * A phone's command: `from` must be the envelope's kid, then the LAN gateway's opener and switch
   * answer it on the relay route, and that answer goes back as command_result.
   */
  async #command(ws: WebSocket, frame: CommandFrame): Promise<void> {
    const { from, wrapper } = frame;
    let status = 400;
    let code: string | null = "bad_envelope";
    if (from === wrapper.envelope.kid) {
      const reply = await this.#commands(wrapper).catch((error: unknown) => {
        this.#log(`L1 relay link: command ${wrapper.msg_id} failed: ${errorMessage(error)}`);
        return { status: 500, body: { v: 1, error: { code: "internal" } } };
      });
      status = reply.status;
      code = status === 202 ? null : replyCode(reply);
      if (status !== 202 && (status < 400 || status > 599)) status = 500;
    }
    this.#log(
      `L1 relay link: command ${wrapper.msg_id} from ${from}: ${status} ${code ?? ""}`.trimEnd(),
    );
    this.#send(ws, { type: "command_result", v: 1, msg_id: wrapper.msg_id, status, code });
  }
}
