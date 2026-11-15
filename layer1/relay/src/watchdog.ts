/**
 * The hub watchdog (phone-hub.md §8.2), the one owner of each home's last contact time and its
 * offline flag. Every frame and pong from a hub is a contact. A home whose hub has been silent
 * longer than relay.json's hub_silent_limit_s gets one "hub offline" push; its next contact gets
 * one "back online" push. The flag is in the database, so a restart neither repeats nor loses a
 * push, and a home whose hub never made contact is not watched.
 */
import type { RelayConfig } from "./config.ts";
import type { HubStatus } from "./push.ts";
import type { RelayStore } from "./store.ts";

/** What sends the hub status pushes: the Pusher, or a test's stand-in. */
export interface StatusPusher {
  hubStatus(homeId: string, status: HubStatus, lastContactMs: number): void;
}

export interface WatchdogOptions {
  readonly store: RelayStore;
  readonly pusher: StatusPusher;
  /** relay.json's two limits, in seconds. */
  readonly config: Pick<RelayConfig, "hub_silent_limit_s" | "watchdog_tick_s">;
  readonly now?: () => number;
  readonly log?: (line: string) => void;
}

export class Watchdog {
  readonly #store: RelayStore;
  readonly #pusher: StatusPusher;
  readonly #silentLimitMs: number;
  readonly #tickMs: number;
  readonly #now: () => number;
  readonly #log: (line: string) => void;
  #timer: NodeJS.Timeout | undefined;

  constructor(options: WatchdogOptions) {
    this.#store = options.store;
    this.#pusher = options.pusher;
    this.#silentLimitMs = options.config.hub_silent_limit_s * 1000;
    this.#tickMs = options.config.watchdog_tick_s * 1000;
    this.#now = options.now ?? Date.now;
    this.#log = options.log ?? ((line) => console.log(line));
  }

  /** Records a frame or pong from the home's hub; after a "hub offline" push, pushes "back online". */
  contact(homeId: string): void {
    const home = this.#store.home(homeId);
    if (home === undefined) return;
    const now = this.#now();
    this.#store.recordContact(homeId, now);
    if (home.offlineNotifiedAtMs === null) return;
    this.#store.setOfflineNotified(homeId, null);
    this.#log(`L1 relay: the hub of home ${homeId} is back, so "back online" is pushed`);
    this.#pusher.hubStatus(homeId, "back_online", now);
  }

  /** One check of every watched home; returns the homes that got a "hub offline" push. */
  tick(): string[] {
    const now = this.#now();
    const notified: string[] = [];
    for (const home of this.#store.homes()) {
      const last = home.lastContactAtMs;
      if (last === null || home.offlineNotifiedAtMs !== null) continue;
      if (now - last <= this.#silentLimitMs) continue;
      // Recorded before the push, so a restart can't send it twice.
      this.#store.setOfflineNotified(home.homeId, now);
      const silentS = Math.floor((now - last) / 1000);
      this.#log(
        `L1 relay: the hub of home ${home.homeId} has been silent ${silentS} s, so "hub offline" is pushed`,
      );
      this.#pusher.hubStatus(home.homeId, "hub_offline", last);
      notified.push(home.homeId);
    }
    return notified;
  }

  /** Checks every watchdog_tick_s until `stop`. */
  start(): void {
    if (this.#timer !== undefined) return;
    this.#timer = setInterval(() => this.tick(), this.#tickMs);
  }

  stop(): void {
    clearInterval(this.#timer);
    this.#timer = undefined;
  }
}
