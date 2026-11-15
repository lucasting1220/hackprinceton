/**
 * Live view at the relay (phone-hub.md §7): a caregiver's request makes a session, which the hub
 * answers through its WebSocket; one signaling WebSocket per session carries the WebRTC connection
 * details between the phone and the sender page on the camera laptop. Sessions live in memory: a
 * restart ends them, and the phone starts another. It never logs a token, a login, a credential or
 * a signaling message: only home, device and session IDs, states and reasons.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type * as http from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import type {
  LiveViewAnswerFrame,
  LiveViewEndFrame,
  LiveViewStartFrame,
} from "../../bridge/src/relay-protocol.ts";
import {
  LIVE_VIEW_CLOSE,
  LIVE_VIEW_ENDED_KEPT_MS,
  LIVE_VIEW_HELLO_TIMEOUT_MS,
  LIVE_VIEW_PATH,
  LIVE_VIEW_SENDER_TOKEN_BYTES,
  LIVE_VIEW_SESSION_MS,
  LIVE_VIEW_SIGNAL_MAX_BYTES,
  LIVE_VIEW_SIGNAL_MESSAGES_MAX,
  LIVE_VIEW_START_WAIT_MS,
} from "../../bridge/src/settings.ts";
import { utcSeconds, type Wrapper } from "../../bridge/src/wire.ts";
import type { IceServer, TurnServers } from "./turn.ts";

/** What the sessions need of the hub socket: the home's hub, if it is connected. */
export interface LiveViewHub {
  /** Sends the frame to the home's hub; false when no hub is connected. */
  send(homeId: string, frame: LiveViewStartFrame | LiveViewEndFrame): boolean;
}

/** Signs a phone in from its upgrade request's headers (phone-api.ts's signIn). */
export type PhoneSignIn = (
  headers: http.IncomingHttpHeaders,
) => Readonly<{ ok: true; deviceId: string }> | Readonly<{ ok: false }>;

export interface LiveViewOptions {
  readonly hub: LiveViewHub;
  /** The relay's public URL, for the viewer's `signaling_url`. */
  readonly publicUrl: string;
  /** coturn's servers; without them, sessions offer no ICE server (one network only). */
  readonly turn?: TurnServers;
  readonly signIn: PhoneSignIn;
  /** The clock, in milliseconds; tests pass their own. */
  readonly now?: () => number;
  readonly log?: (line: string) => void;
  /** The session's times; tests shorten them. */
  readonly timing?: Partial<LiveViewTiming>;
}

export interface LiveViewTiming {
  readonly sessionMs: number;
  readonly startWaitMs: number;
  readonly endedKeptMs: number;
  readonly helloTimeoutMs: number;
}

const DEFAULT_TIMING: LiveViewTiming = {
  sessionMs: LIVE_VIEW_SESSION_MS,
  startWaitMs: LIVE_VIEW_START_WAIT_MS,
  endedKeptMs: LIVE_VIEW_ENDED_KEPT_MS,
  helloTimeoutMs: LIVE_VIEW_HELLO_TIMEOUT_MS,
};

/** A session's state, as the phone's status call reads it (§7.2). */
export type SessionState = "requested" | "ready" | "denied" | "ended" | "failed";

/** What the phone needs to join signaling once the session is ready (§7.2). */
export type ViewerDetails = Readonly<{
  signaling_url: string;
  client_id: string;
  ice_servers: readonly IceServer[];
}>;

/** The phone's status call's answer body (§7.2); `viewer` only while ready. */
export type SessionStatus = Readonly<{
  v: 1;
  session_id: string;
  state: SessionState;
  reason: string | null;
  expires_at: string;
  viewer?: ViewerDetails;
}>;

/** The hub's refusal that means the resident's switch is off: the app's "denied" (§7.2). */
const CONSENT_OFF = "live_view_off";
/** The reasons a sender's `bye` may give; any other `bye` or a dropped sender is `lost`. */
const SENDER_REASONS: readonly string[] = ["resident_turned_off"];

type Role = "viewer" | "sender";

interface Peer {
  readonly ws: WebSocket;
  sent: number;
}

interface Session {
  readonly id: string;
  readonly homeId: string;
  readonly deviceId: string;
  readonly expiresAtMs: number;
  readonly iceServers: readonly IceServer[];
  readonly senderTokenSha256: Buffer;
  state: SessionState;
  reason: string | null;
  accepted: boolean;
  readonly peers: Partial<Record<Role, Peer>>;
  readonly timers: NodeJS.Timeout[];
}

/** The messages peers exchange through signaling; the relay passes on nothing else. */
const PEER_TYPES: readonly string[] = ["offer", "answer", "candidate", "bye"];
const SIGNAL_PATH = new RegExp(`^${LIVE_VIEW_PATH}/([0-9a-f-]{36})/signal$`);

const sha256 = (text: string): Buffer => createHash("sha256").update(text, "utf8").digest();
const utf8 = new TextDecoder("utf-8", { fatal: true });

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Answers an upgrade request with a bare status and closes the socket. */
function refuseUpgrade(socket: Duplex, status: 401 | 403 | 404 | 410, reason: string): void {
  socket.once("finish", () => socket.destroy());
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

/** Whether `pathname` is a session's signaling path, for the HTTP server's upgrade event. */
export const isSignalPath = (pathname: string): boolean => SIGNAL_PATH.test(pathname);

export class LiveViewSessions {
  readonly #hub: LiveViewHub;
  readonly #publicUrl: string;
  readonly #turn: TurnServers | undefined;
  readonly #signIn: PhoneSignIn;
  readonly #now: () => number;
  readonly #log: (line: string) => void;
  readonly #timing: LiveViewTiming;
  readonly #sessions = new Map<string, Session>();
  /** Each home's live session, at most one: the camera laptop has one sender window. */
  readonly #byHome = new Map<string, Session>();
  readonly #server = new WebSocketServer({
    noServer: true,
    maxPayload: LIVE_VIEW_SIGNAL_MAX_BYTES,
    perMessageDeflate: false,
  });

  constructor(options: LiveViewOptions) {
    this.#hub = options.hub;
    this.#publicUrl = options.publicUrl;
    this.#turn = options.turn;
    this.#signIn = options.signIn;
    this.#now = options.now ?? Date.now;
    this.#log = options.log ?? ((line: string) => console.log(line));
    this.#timing = { ...DEFAULT_TIMING, ...options.timing };
  }

  /**
   * A caregiver's request (§7.1): ends the home's earlier session, makes a new one and sends the
   * hub `live_view_start` with the phone's sealed request. Undefined when the hub is offline.
   */
  start(homeId: string, deviceId: string, wrapper: Wrapper): SessionStatus | undefined {
    const earlier = this.#byHome.get(homeId);
    const id = randomUUID();
    const expiresAtMs = this.#now() + this.#timing.sessionMs;
    const senderToken = randomBytes(LIVE_VIEW_SENDER_TOKEN_BYTES).toString("base64url");
    const frame: LiveViewStartFrame = {
      type: "live_view_start",
      v: 1,
      session_id: id,
      from: deviceId,
      wrapper,
      expires_at: utcSeconds(new Date(expiresAtMs)),
      sender_token: senderToken,
    };
    if (!this.#hub.send(homeId, frame)) return undefined;
    if (earlier !== undefined) this.#end(earlier, "replaced", true);
    const session: Session = {
      id,
      homeId,
      deviceId,
      expiresAtMs,
      iceServers: this.#turn?.iceServers(id, expiresAtMs) ?? [],
      senderTokenSha256: sha256(senderToken),
      state: "requested",
      reason: null,
      accepted: false,
      peers: {},
      timers: [],
    };
    this.#sessions.set(id, session);
    this.#byHome.set(homeId, session);
    session.timers.push(
      setTimeout(() => {
        if (session.state !== "requested") return;
        this.#finish(session, "failed", session.accepted ? "no_sender" : "hub_timeout");
        this.#tellHub(session);
      }, this.#timing.startWaitMs),
      setTimeout(() => this.#end(session, "expired", true), expiresAtMs - this.#now()),
    );
    for (const timer of session.timers) timer.unref();
    this.#log(`L1 relay: live view session ${id} for device ${deviceId} of home ${homeId} started`);
    return this.#status(session);
  }

  /** The session's status for the phone that started it (§7.2); undefined for any other. */
  status(deviceId: string, sessionId: string): SessionStatus | undefined {
    const session = this.#sessions.get(sessionId);
    if (session === undefined || session.deviceId !== deviceId) return undefined;
    return this.#status(session);
  }

  /** The caregiver's Stop (§7.3); false when the session isn't the phone's. */
  stop(deviceId: string, sessionId: string): boolean {
    const session = this.#sessions.get(sessionId);
    if (session === undefined || session.deviceId !== deviceId) return false;
    this.#end(session, "stopped", true);
    return true;
  }

  /**
   * The hub's `live_view_answer`: the resident's switch being off is `denied`, any other refusal
   * `failed`, and accepted waits for the sender.
   */
  hubAnswered(homeId: string, frame: LiveViewAnswerFrame): void {
    const session = this.#ofHome(homeId, frame.session_id, "answer");
    if (session === undefined || session.state !== "requested") return;
    if (!frame.accepted) {
      const reason = frame.reason ?? "refused";
      this.#finish(session, reason === CONSENT_OFF ? "denied" : "failed", reason);
      return;
    }
    session.accepted = true;
    this.#readyIfJoined(session);
  }

  /** The hub's `live_view_end`, such as the resident turning live view off. */
  hubEnded(homeId: string, frame: LiveViewEndFrame): void {
    const session = this.#ofHome(homeId, frame.session_id, "end");
    if (session !== undefined) this.#end(session, frame.reason, false);
  }

  /** The home's hub disconnected: its session can't be stopped from home any more, so it fails. */
  hubDisconnected(homeId: string): void {
    const session = this.#byHome.get(homeId);
    if (session !== undefined && this.#live(session))
      this.#finish(session, "failed", "hub_offline");
  }

  /** For the HTTP server's `upgrade` event on a signaling path (§7.4). */
  handleUpgrade(request: http.IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(request.url ?? "/", "http://relay.invalid");
    const sessionId = SIGNAL_PATH.exec(url.pathname)?.[1] ?? "";
    const session = this.#sessions.get(sessionId);
    if (session === undefined) {
      refuseUpgrade(socket, 404, "Not Found");
      return;
    }
    const phone = request.headers.authorization !== undefined;
    if (phone) {
      const signed = this.#signIn(request.headers);
      if (!signed.ok) {
        refuseUpgrade(socket, 401, "Unauthorized");
        return;
      }
      if (signed.deviceId !== session.deviceId) {
        refuseUpgrade(socket, 403, "Forbidden");
        return;
      }
    }
    if (!this.#live(session)) {
      refuseUpgrade(socket, 410, "Gone");
      return;
    }
    this.#server.handleUpgrade(request, socket, head, (ws) => {
      ws.on("error", (error) => {
        this.#log(`L1 relay: a signaling socket of session ${session.id} failed: ${error.name}`);
      });
      if (phone) this.#join(session, "viewer", ws);
      else this.#awaitHello(session, ws);
    });
  }

  /** Ends every session, as the relay stops. */
  close(): void {
    for (const session of this.#byHome.values()) {
      if (this.#live(session)) this.#finish(session, "failed", "relay_stopping");
    }
    for (const session of this.#sessions.values()) this.#clearTimers(session);
    this.#sessions.clear();
    this.#server.close();
  }

  #status(session: Session): SessionStatus {
    const status: SessionStatus = {
      v: 1,
      session_id: session.id,
      state: session.state,
      reason: session.reason,
      expires_at: utcSeconds(new Date(session.expiresAtMs)),
    };
    if (session.state !== "ready") return status;
    const signaling = new URL(`${LIVE_VIEW_PATH}/${session.id}/signal`, this.#publicUrl);
    signaling.protocol = signaling.protocol === "https:" ? "wss:" : "ws:";
    const viewer = {
      signaling_url: signaling.href,
      client_id: session.deviceId,
      ice_servers: session.iceServers,
    };
    return { ...status, viewer };
  }

  /** Whether the session is still under way: requested or ready. */
  #live(session: Session): boolean {
    return session.state === "requested" || session.state === "ready";
  }

  /** The home's session with this ID; a frame about another is logged and ignored. */
  #ofHome(homeId: string, sessionId: string, what: string): Session | undefined {
    const session = this.#sessions.get(sessionId);
    if (session?.homeId === homeId) return session;
    this.#log(`L1 relay: home ${homeId}'s hub sent a live view ${what} for an unknown session`);
    return undefined;
  }

  /** The sender's first message must be its hello with the session's token, in time. */
  #awaitHello(session: Session, ws: WebSocket): void {
    const timer = setTimeout(
      () => ws.close(LIVE_VIEW_CLOSE.refused, "no hello"),
      this.#timing.helloTimeoutMs,
    );
    timer.unref();
    ws.once("message", (data, isBinary) => {
      clearTimeout(timer);
      const { type, token } = (isBinary ? undefined : parseMessage(data)) ?? {};
      if (type !== "hello") this.#log(`L1 relay: a sender's first message wasn't its hello`);
      const presented = typeof token === "string" ? sha256(token) : Buffer.alloc(32);
      const matches = timingSafeEqual(presented, session.senderTokenSha256);
      if (!matches || !this.#live(session)) {
        this.#log(`L1 relay: refused a sender for live view session ${session.id}`);
        ws.close(LIVE_VIEW_CLOSE.refused, "refused");
        return;
      }
      this.#join(session, "sender", ws);
    });
  }

  #join(session: Session, role: Role, ws: WebSocket): void {
    const previous = session.peers[role];
    const peer: Peer = { ws, sent: 0 };
    session.peers[role] = peer;
    if (previous !== undefined) previous.ws.close(LIVE_VIEW_CLOSE.replaced, "replaced");
    send(ws, {
      type: "welcome",
      ice_servers: session.iceServers,
      expires_at: utcSeconds(new Date(session.expiresAtMs)),
    });
    this.#log(`L1 relay: the ${role} joined live view session ${session.id}`);
    const other = session.peers[role === "viewer" ? "sender" : "viewer"];
    if (other !== undefined) {
      send(other.ws, { type: "peer", state: "joined" });
      send(ws, { type: "peer", state: "joined" });
    }
    if (role === "sender") this.#readyIfJoined(session);
    ws.on("message", (data, isBinary) => this.#relay(session, role, peer, data, isBinary));
    ws.on("close", () => this.#left(session, role, peer));
  }

  /** Passes one message on to the other peer, if it is one of PEER_TYPES; `bye` ends the session. */
  #relay(
    session: Session,
    role: Role,
    peer: Peer,
    data: WebSocket.RawData,
    isBinary: boolean,
  ): void {
    if (session.peers[role] !== peer) return;
    peer.sent += 1;
    if (peer.sent > LIVE_VIEW_SIGNAL_MESSAGES_MAX) {
      this.#log(`L1 relay: the ${role} of session ${session.id} sent too many messages; closed`);
      peer.ws.close(LIVE_VIEW_CLOSE.refused, "too many messages");
      return;
    }
    const message = isBinary ? undefined : parseMessage(data);
    const { type } = message ?? {};
    if (message === undefined || typeof type !== "string" || !PEER_TYPES.includes(type)) return;
    const other = session.peers[role === "viewer" ? "sender" : "viewer"];
    if (other !== undefined) send(other.ws, message);
    if (type !== "bye") return;
    const { reason } = message;
    const given = typeof reason === "string" && SENDER_REASONS.includes(reason) ? reason : "lost";
    this.#end(session, role === "viewer" ? "stopped" : given, true);
  }

  #left(session: Session, role: Role, peer: Peer): void {
    if (session.peers[role] !== peer) return;
    delete session.peers[role];
    const other = session.peers[role === "viewer" ? "sender" : "viewer"];
    if (other !== undefined) send(other.ws, { type: "peer", state: "left" });
    // The sender's window closing ends the session; a phone may come back, until the time is up.
    if (role === "sender" && session.state === "ready") this.#end(session, "lost", true);
  }

  #readyIfJoined(session: Session): void {
    if (session.state !== "requested" || !session.accepted || session.peers.sender === undefined)
      return;
    session.state = "ready";
    this.#log(`L1 relay: live view session ${session.id} is ready`);
  }

  /** Ends a requested or ready session; `tellHub` sends the hub `live_view_end`. */
  #end(session: Session, reason: string, tellHub: boolean): void {
    if (!this.#live(session)) return;
    this.#finish(session, "ended", reason);
    if (tellHub) this.#tellHub(session);
  }

  /** Sends the hub `live_view_end` with the session's reason, so the sender window closes. */
  #tellHub(session: Session): void {
    this.#hub.send(session.homeId, {
      type: "live_view_end",
      v: 1,
      session_id: session.id,
      reason: session.reason ?? "ended",
    });
  }

  #finish(session: Session, state: "ended" | "denied" | "failed", reason: string): void {
    session.state = state;
    session.reason = reason;
    this.#clearTimers(session);
    if (this.#byHome.get(session.homeId) === session) this.#byHome.delete(session.homeId);
    for (const peer of Object.values(session.peers)) {
      send(peer.ws, { type: "end", reason });
      peer.ws.close(LIVE_VIEW_CLOSE.ended, "ended");
    }
    const forget = setTimeout(() => this.#sessions.delete(session.id), this.#timing.endedKeptMs);
    forget.unref();
    session.timers.push(forget);
    this.#log(`L1 relay: live view session ${session.id} ${state}: ${reason}`);
  }

  #clearTimers(session: Session): void {
    for (const timer of session.timers.splice(0)) clearTimeout(timer);
  }
}

/** A signaling message as a JSON object, or undefined. */
function parseMessage(data: WebSocket.RawData): Readonly<Record<string, unknown>> | undefined {
  try {
    const value: unknown = JSON.parse(
      utf8.decode(Array.isArray(data) ? Buffer.concat(data) : new Uint8Array(data)),
    );
    return isRecord(value) ? value : undefined;
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) return undefined;
    throw error;
  }
}

function send(ws: WebSocket, message: object): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}
