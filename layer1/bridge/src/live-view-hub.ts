/**
 * The hub's side of live view (phone-hub.md §7.5): for the relay's live_view_start it opens the
 * caregiver's request with the LAN gateway's checks, checks the resident's consent, finds the camera
 * laptop through Layer 2's GET /api/state and the bridge link, queues live_view_open for that laptop
 * and answers. It tracks the one open session, and ends it when the relay ends it, the resident turns
 * live view off, or the camera laptop's link goes quiet or reports its sender lost.
 *
 *   live_view_start ─▶ open + checks ─▶ consent ─▶ camera laptop ─▶ queue live_view_open ─▶ answer null
 *                         │ refused       │ off       │ none
 *                         ▼               ▼           ▼
 *                     its code      live_view_off   no_camera
 *
 * The sender token is a secret: it goes only into the queued command, never into a log line.
 */
import { errorMessage } from "./json-file.ts";
import { errorKind, type LinkedLaptop, type LinkReport } from "./link.ts";
import type { OpenResult } from "./lan-gateway.ts";
import type { LinkCommand } from "./live-view-commands.ts";
import type { ConsentChanger } from "./live-view-consent.ts";
import type { Reply } from "./network-server.ts";
import type { LiveViewStartFrame } from "./relay-protocol.ts";
import * as settings from "./settings.ts";
import type { Wrapper } from "./wire.ts";

/** What the hub needs of the bridge link: link.ts's LinkHub. */
export interface LiveViewLink {
  queue(nodeId: string, command: LinkCommand): void;
  linked(): ReadonlyMap<string, LinkedLaptop>;
  onReport(listener: (nodeId: string, report: LinkReport) => void): () => void;
}

/** What the hub needs of the resident's consent: live-view-consent.ts's LiveViewConsent. */
export interface LiveViewSwitch {
  enabled(): boolean;
  set(enabled: boolean, changer: ConsentChanger): Promise<void>;
  onChange(listener: (enabled: boolean) => void): () => void;
}

/** The laptops Layer 2 lists with a camera, most recently heard first, or why it can't say. */
export type CameraLaptops =
  | Readonly<{ ok: true; nodeIds: readonly string[] }>
  | Readonly<{ ok: false; reason: string }>;

export interface LiveViewHubTiming {
  /** A camera laptop's link quiet this long can't start a session, and ends one as lost. */
  readonly quietMs: number;
  /** How often a running session's link is checked. */
  readonly checkMs: number;
}

export interface LiveViewHubOptions {
  /** §4.4's checks 1 to 6 on the phone's wrapper: the LAN gateway's openPhoneRequest. */
  readonly open: (wrapper: Wrapper) => OpenResult;
  readonly consent: LiveViewSwitch;
  readonly link: LiveViewLink;
  /** Layer 2's camera laptops; cameraLaptopsFrom(the dashboard port) in the bridge. */
  readonly cameraLaptops: () => Promise<CameraLaptops>;
  /** relay-credential.json's relay_url, whose origin serves signaling. */
  readonly relayUrl: string;
  /** Sends live_view_end to the relay, through the relay link while it is connected. */
  readonly endToRelay: (sessionId: string, reason: string) => void;
  readonly now?: () => number;
  readonly log?: (line: string) => void;
  readonly timing?: Partial<LiveViewHubTiming>;
}

interface Session {
  readonly id: string;
  readonly nodeId: string;
  readonly expiryTimer: NodeJS.Timeout;
  readonly checkTimer: NodeJS.Timeout;
}

/** The sender page's signaling socket for a session, on the relay's origin (§7.4). */
export function signalingUrl(relayUrl: string, sessionId: string): string | undefined {
  if (!URL.canParse(relayUrl)) return undefined;
  const url = new URL(`${settings.LIVE_VIEW_PATH}/${sessionId}/signal`, relayUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** contracts/api-state.json's laptops whose sensors include the camera, newest status first. */
export function parseCameraLaptops(state: unknown): string[] | undefined {
  const laptops: unknown = isRecord(state) ? Reflect.get(state, "laptops") : undefined;
  if (!Array.isArray(laptops)) return undefined;
  const cameras: Array<{ nodeId: string; at: string }> = [];
  for (const laptop of laptops) {
    if (!isRecord(laptop)) continue;
    const { node_id: nodeId, sensors, last_status_at: at } = laptop;
    if (typeof nodeId !== "string" || !Array.isArray(sensors) || !sensors.includes("camera")) {
      continue;
    }
    cameras.push({ nodeId, at: typeof at === "string" ? at : "" });
  }
  cameras.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return cameras.map((camera) => camera.nodeId);
}

/** Asks Layer 2's dashboard on this laptop for its camera laptops, within a time limit. */
export async function cameraLaptopsFrom(dashboardPort: number): Promise<CameraLaptops> {
  const url = `http://${settings.LOCAL_HOST}:${dashboardPort}/api/state`;
  let body: unknown;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(settings.LIVE_VIEW_API_STATE_TIMEOUT_MS),
    });
    if (response.status !== 200) {
      await response.body?.cancel();
      return { ok: false, reason: `Layer 2's /api/state answered ${response.status}` };
    }
    body = await response.json();
  } catch (error) {
    const expected =
      error instanceof TypeError ||
      error instanceof SyntaxError ||
      (error instanceof DOMException && ["TimeoutError", "AbortError"].includes(error.name));
    if (!expected) throw error;
    return { ok: false, reason: `can't read Layer 2's /api/state (${errorKind(error)})` };
  }
  const nodeIds = parseCameraLaptops(body);
  if (nodeIds === undefined) return { ok: false, reason: "Layer 2's /api/state has no laptops" };
  return { ok: true, nodeIds };
}

/** A reply's §1 error code, or "internal" when it has none. */
function replyCode(reply: Reply): string {
  const error: unknown = Reflect.get(reply.body, "error");
  const code: unknown = isRecord(error) ? Reflect.get(error, "code") : undefined;
  return typeof code === "string" ? code : "internal";
}

export class LiveViewHub {
  readonly #options: LiveViewHubOptions;
  readonly #now: () => number;
  readonly #log: (line: string) => void;
  readonly #timing: LiveViewHubTiming;
  readonly #unsubscribe: Array<() => void>;
  #session: Session | undefined;

  constructor(options: LiveViewHubOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#log = options.log ?? ((line: string) => console.log(line));
    this.#timing = {
      quietMs: settings.LIVE_VIEW_LINK_QUIET_MS,
      checkMs: settings.LIVE_VIEW_LINK_CHECK_MS,
      ...options.timing,
    };
    this.#unsubscribe = [
      options.consent.onChange((enabled) => this.#consentChanged(enabled)),
      options.link.onReport((nodeId, report) => this.#reported(nodeId, report)),
    ];
  }

  /** The open session's ID and camera laptop, or undefined. */
  session(): Readonly<{ id: string; nodeId: string }> | undefined {
    const session = this.#session;
    return session === undefined ? undefined : { id: session.id, nodeId: session.nodeId };
  }

  /** Answers the relay's live_view_start: null when accepted, else the refusal's code. */
  async start(frame: LiveViewStartFrame): Promise<string | null> {
    const reason = await this.#check(frame);
    const id = frame.session_id;
    if (typeof reason === "string") {
      this.#log(`L1 live view: refused session ${id} from ${frame.from}: ${reason}`);
      return reason;
    }
    const url = signalingUrl(this.#options.relayUrl, id);
    if (url === undefined) {
      this.#log(`L1 live view: refused session ${id}: the relay's URL can't be used`);
      return "not_supported";
    }
    this.#end("replaced", false);
    const nodeId = reason.nodeId;
    this.#options.link.queue(nodeId, {
      type: "live_view_open",
      session_id: id,
      sender_token: frame.sender_token,
      signaling_url: url,
      expires_at: frame.expires_at,
    });
    const untilEnd = Math.max(0, Date.parse(frame.expires_at) - this.#now());
    this.#session = {
      id,
      nodeId,
      expiryTimer: setTimeout(() => this.#end("expired", false), untilEnd),
      checkTimer: setInterval(() => this.#checkLink(), this.#timing.checkMs),
    };
    this.#log(`L1 live view: session ${id} from ${frame.from} accepted; camera laptop ${nodeId}`);
    return null;
  }

  /** The relay ended a session; resident_turned_off from the sender window also turns consent off. */
  ended(sessionId: string, reason: string): void {
    if (this.#session?.id === sessionId) this.#end(reason, false);
    this.#log(`L1 live view: the relay ended session ${sessionId}: ${reason}`);
    const consent = this.#options.consent;
    if (reason !== "resident_turned_off" || !consent.enabled()) return;
    consent.set(false, { by: "sender_window" }).catch((error: unknown) => {
      const why = errorMessage(error);
      this.#log(`L1 live view: couldn't turn live view off after the sender window: ${why}`);
    });
  }

  /** Stops its timers and listeners; the relay ends any session when the hub goes away. */
  close(): void {
    for (const stop of this.#unsubscribe.splice(0)) stop();
    const session = this.#session;
    this.#session = undefined;
    clearTimeout(session?.expiryTimer);
    clearInterval(session?.checkTimer);
  }

  /** The request's checks in §7.5's order: the refusal's code, or the camera laptop. */
  async #check(frame: LiveViewStartFrame): Promise<string | Readonly<{ nodeId: string }>> {
    const { wrapper, from } = frame;
    if (wrapper.envelope.kid !== from) return "bad_envelope";
    const opened = this.#options.open(wrapper);
    if (!opened.ok) return replyCode(opened.reply);
    const { request } = opened;
    if (request.type !== "live_view_request") return "unsupported_type";
    if (request.role !== "caregiver") return "forbidden";
    if (!this.#options.consent.enabled()) return "live_view_off";
    const cameras = await this.#options.cameraLaptops();
    if (!cameras.ok) {
      this.#log(`L1 live view: no camera laptop: ${cameras.reason}`);
      return "no_camera";
    }
    const nodeId = cameras.nodeIds.find((id) => !this.#quiet(id));
    if (nodeId === undefined) {
      const listed = cameras.nodeIds.length;
      const why = listed === 0 ? "Layer 2 lists none" : `none of ${listed} has a live bridge link`;
      this.#log(`L1 live view: no camera laptop: ${why}`);
      return "no_camera";
    }
    // The resident may have turned live view off while Layer 2 answered.
    if (!this.#options.consent.enabled()) return "live_view_off";
    return { nodeId };
  }

  /** Whether laptop `nodeId`'s link has been quiet past the limit, or never reported. */
  #quiet(nodeId: string): boolean {
    const laptop = this.#options.link.linked().get(nodeId);
    if (laptop === undefined) return true;
    return this.#now() - Date.parse(laptop.reportedAt) > this.#timing.quietMs;
  }

  #checkLink(): void {
    const session = this.#session;
    if (session === undefined || !this.#quiet(session.nodeId)) return;
    this.#log(`L1 live view: camera laptop ${session.nodeId}'s link went quiet`);
    this.#end("lost", true);
  }

  #consentChanged(enabled: boolean): void {
    if (!enabled) this.#end("resident_turned_off", true);
  }

  #reported(nodeId: string, report: LinkReport): void {
    const session = this.#session;
    if (session === undefined || session.nodeId !== nodeId) return;
    if (report.live_view_lost !== session.id) return;
    this.#log(`L1 live view: camera laptop ${nodeId} lost session ${session.id}`);
    this.#end("lost", true);
  }

  /** Forgets the session, closes its sender window and, when the hub ended it, tells the relay. */
  #end(reason: string, tellRelay: boolean): void {
    const session = this.#session;
    if (session === undefined) return;
    this.#session = undefined;
    clearTimeout(session.expiryTimer);
    clearInterval(session.checkTimer);
    this.#options.link.queue(session.nodeId, {
      type: "live_view_close",
      session_id: session.id,
      reason,
    });
    if (tellRelay) {
      this.#log(`L1 live view: ended session ${session.id}: ${reason}`);
      this.#options.endToRelay(session.id, reason);
    }
  }
}
