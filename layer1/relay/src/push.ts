/**
 * Debbie's pushes (phone-hub.md §8): which messages push, their payloads and headers, and the
 * order (R13): the hub socket commits a message and sends its `ack`, then calls `delivered`, which
 * pushes a new alert in the background and marks it pushed once Apple has answered for every
 * target. At start, `repushUnpushed` pushes recent alerts a restart cut off. The relay's own hub
 * offline and back online pushes go through `hubStatus`, one at a time per home, and a home's
 * alert pushes wait for the status push in flight, so "back online" goes before queued alerts.
 */
import {
  APNS_PAYLOAD_MAX_BYTES,
  PUSH_ALERT_EXPIRY_MS,
  PUSH_HUB_STATUS_EXPIRY_MS,
  RELAY_REPUSH_WINDOW_MS,
} from "../../bridge/src/settings.ts";
import { utcSeconds, type Wrapper } from "../../bridge/src/wire.ts";
import type { ApnsNotification, PushOutcome } from "./apns.ts";
import type { PushTarget, RelayStore, StoredMessage } from "./store.ts";

/** The relay's own pushes about the hub (§8.2). */
export type HubStatus = "hub_offline" | "back_online";

/** What pushes one notification to one target: the APNs client, or a test's stand-in. */
export interface PushSender {
  send(target: PushTarget, notification: ApnsNotification): Promise<PushOutcome>;
}

export interface PusherOptions {
  readonly store: RelayStore;
  readonly sender: PushSender;
  readonly now?: () => number;
  readonly log?: (line: string) => void;
}

/**
 * The placeholder the notification extension replaces once it opens `w` (§8.1). The relay can't
 * read the severity, so every alert arrives time-sensitive and the extension may lower it.
 */
const ALERT_APS = {
  alert: { title: "Debbie", body: "New alert from Debbie" },
  "mutable-content": 1,
  "interruption-level": "time-sensitive",
  sound: "default",
  "thread-id": "alerts",
} as const;

const HUB_STATUS_APS = {
  hub_offline: {
    alert: { title: "Can't Reach Home", body: "Debbie can't reach home right now." },
    "mutable-content": 1,
    "interruption-level": "active",
    sound: "default",
    "thread-id": "home-status",
  },
  back_online: {
    alert: { title: "Home Is Back Online", body: "Debbie is hearing from home again." },
    "mutable-content": 1,
    "interruption-level": "passive",
    "thread-id": "home-status",
  },
} as const;

/** A collapse ID that is safe as an HTTP/2 header value: 1 to 64 printable ASCII characters. */
const HEADER_SAFE = /^[\x21-\x7e]{1,64}$/;

/**
 * `value` as an apns-collapse-id header, or undefined when it can't be one. The wrapper check
 * allows any text up to 64 bytes, and a newline or NUL in a header would break the request.
 */
export function collapseHeader(value: string | undefined): string | undefined {
  return value !== undefined && HEADER_SAFE.test(value) ? value : undefined;
}

/** An alert's payload: the wrapper unchanged, or the truncated form over Apple's 4,096 bytes. */
export function alertPayload(homeId: string, wrapper: Wrapper): string {
  const whole = JSON.stringify({ aps: ALERT_APS, debbie: { v: 1, home_id: homeId, w: wrapper } });
  if (Buffer.byteLength(whole, "utf8") <= APNS_PAYLOAD_MAX_BYTES) return whole;
  const debbie = { v: 1, home_id: homeId, msg_id: wrapper.msg_id, truncated: true };
  return JSON.stringify({ aps: ALERT_APS, debbie });
}

/** A hub offline or back online payload, with the hub's last contact in both forms (R6). */
export function hubStatusPayload(status: HubStatus, lastContactMs: number): string {
  const debbie = {
    v: 1,
    type: status,
    last_contact: Math.floor(lastContactMs / 1000),
    last_contact_at: utcSeconds(new Date(lastContactMs)),
  };
  return JSON.stringify({ aps: HUB_STATUS_APS[status], debbie });
}

export function alertNotification(
  homeId: string,
  wrapper: Wrapper,
  nowMs: number,
): ApnsNotification {
  return {
    pushType: "alert",
    priority: 10,
    expiresAtMs: nowMs + PUSH_ALERT_EXPIRY_MS,
    collapseId: collapseHeader(wrapper.collapse_id),
    payload: alertPayload(homeId, wrapper),
    label: `message ${wrapper.msg_id}`,
  };
}

export function hubStatusNotification(
  homeId: string,
  status: HubStatus,
  lastContactMs: number,
  nowMs: number,
): ApnsNotification {
  return {
    pushType: "alert",
    priority: status === "hub_offline" ? 10 : 5,
    expiresAtMs: nowMs + PUSH_HUB_STATUS_EXPIRY_MS,
    collapseId: collapseHeader(`hub-status-${homeId}`),
    payload: hubStatusPayload(status, lastContactMs),
    label: `${status} of home ${homeId}`,
  };
}

export class Pusher {
  readonly #store: RelayStore;
  readonly #sender: PushSender;
  readonly #now: () => number;
  readonly #log: (line: string) => void;
  readonly #inFlight = new Set<Promise<void>>();
  /** Per home, the end of its status pushes; it never rejects. */
  readonly #statusChain = new Map<string, Promise<void>>();

  constructor(options: PusherOptions) {
    this.#store = options.store;
    this.#sender = options.sender;
    this.#now = options.now ?? Date.now;
    this.#log = options.log ?? ((line) => console.log(line));
  }

  /**
   * Called after a delivered message was committed and acknowledged: a new alert is pushed in the
   * background, and a repeat or any other type is not.
   */
  delivered(homeId: string, wrapper: Wrapper, stored: StoredMessage): void {
    if (wrapper.type !== "alert" || stored.duplicate) return;
    this.#track(this.pushAlert(homeId, stored.seq, wrapper), `message ${wrapper.msg_id}`);
  }

  /** Pushes an alert to the home's caregivers, then marks it pushed. */
  async pushAlert(homeId: string, seq: number, wrapper: Wrapper): Promise<void> {
    await this.#statusChain.get(homeId);
    const notification = alertNotification(homeId, wrapper, this.#now());
    if (wrapper.collapse_id !== undefined && notification.collapseId === undefined) {
      this.#log(
        `L1 relay: message ${wrapper.msg_id}'s collapse_id can't be a header, so it is pushed without one`,
      );
    }
    await this.#sendAll(homeId, notification);
    this.#store.markPushed(seq, this.#now());
  }

  /**
   * Pushes a hub status to the home's caregivers in the background, after the home's earlier
   * status pushes; the home's alert pushes started meanwhile wait for it.
   */
  hubStatus(homeId: string, status: HubStatus, lastContactMs: number): void {
    const previous = this.#statusChain.get(homeId) ?? Promise.resolve();
    const work = previous.then(() =>
      this.#sendAll(homeId, hubStatusNotification(homeId, status, lastContactMs, this.#now())),
    );
    this.#track(work, `${status} of home ${homeId}`);
    const done = () => {
      if (this.#statusChain.get(homeId) === chain) this.#statusChain.delete(homeId);
    };
    const chain: Promise<void> = work.then(done, done);
    this.#statusChain.set(homeId, chain);
  }

  /** At start: pushes, in the background, recent alerts that were stored but never pushed (R13). */
  repushUnpushed(): number {
    const alerts = this.#store.unpushedAlerts(this.#now() - RELAY_REPUSH_WINDOW_MS);
    for (const { homeId, seq, wrapper } of alerts) {
      this.#log(
        `L1 relay: message ${wrapper.msg_id} of home ${homeId} was never pushed, so it is pushed now`,
      );
      this.#track(this.pushAlert(homeId, seq, wrapper), `message ${wrapper.msg_id}`);
    }
    return alerts.length;
  }

  /** Resolves once every push started so far has finished. */
  async settled(): Promise<void> {
    while (this.#inFlight.size > 0) await Promise.all(this.#inFlight);
  }

  async #sendAll(homeId: string, notification: ApnsNotification): Promise<void> {
    const targets = this.#store.pushTargets(homeId);
    const outcomes = await Promise.all(
      targets.map((target) => this.#sender.send(target, notification)),
    );
    const sent = outcomes.filter((outcome) => outcome.result === "sent").length;
    this.#log(
      `L1 relay: ${notification.label} of home ${homeId} pushed to ${sent} of ${targets.length} devices`,
    );
  }

  /** Keeps a background push for `settled`, and logs a failure no caller is left to see. */
  #track(work: Promise<void>, label: string): void {
    const tracked: Promise<void> = work.then(
      () => {
        this.#inFlight.delete(tracked);
      },
      (error: unknown) => {
        this.#inFlight.delete(tracked);
        const kind = error instanceof Error ? error.name : typeof error;
        this.#log(`L1 relay: the push of ${label} stopped with an error (${kind})`);
      },
    );
    this.#inFlight.add(tracked);
  }
}
