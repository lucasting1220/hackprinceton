/**
 * Everything phones reach once a home exists: the phone list, the pairing session and the network
 * side on port 7480 with POST /v1/pair, the LAN gateway and step 3's join routes and link. main.ts starts it from its home-ready
 * hook on the coordinator. When it can't run, it says why, for the setup page, and the bridge runs
 * on without it.
 */
import type { Home } from "./home.ts";
import { HomeError, readHomeSecrets } from "./home.ts";
import { HubJoin } from "./hub-join.ts";
import { errorMessage } from "./json-file.ts";
import { LanGateway, type OpenedRequest } from "./lan-gateway.ts";
import { LinkHub } from "./link.ts";
import type { LiveViewConsent } from "./live-view-consent.ts";
import { lanAddresses, type NetworkSide, startNetworkSide } from "./network-server.ts";
import type { MessageSource } from "./outbox.ts";
import { Pairing } from "./pairing.ts";
import type { PhoneHandoff } from "./phone-handoff.ts";
import { PhoneRegistry, PhonesError } from "./phones.ts";
import * as settings from "./settings.ts";

export interface PhoneAccessOptions {
  /** settings.BRIDGE_NETWORK_PORT by default; tests pass 0, for a free port. */
  readonly port?: number;
  /** The addresses phones reach this laptop at, for a port; lanAddresses by default. */
  readonly addresses?: (port: number) => string[];
  readonly log?: (line: string) => void;
  /** Step 4's outbox, which the LAN gateway's fetch pages through. */
  readonly outbox?: MessageSource;
  /** The handoff to Layer 2's coordinator, for the LAN gateway's `request` and `watch_data`. */
  readonly handoff?: PhoneHandoff;
  /** The pairing bundle's relay_url, from relay-credential.json; empty without one (step 5). */
  readonly relayUrl?: string;
  /** The resident's live view consent, which the phone's `live_view_setting` changes (step 7). */
  readonly liveView?: LiveViewConsent;
}

/** What the pairing page reads: the parts while the network side runs, or why it doesn't. */
export type PhoneAccessState =
  | Readonly<{
      on: true;
      pairing: Pairing;
      phones: PhoneRegistry;
      port: number;
      /** Add a laptop (step 3): the joins waiting for approval, and the linked laptops. */
      join: HubJoin;
      link: LinkHub;
    }>
  | Readonly<{ on: false; reason: string; retryable: boolean }>;

/** What the relay link uses: the phone list, and the gateway that answers relayed commands. */
export type RelayParts = Readonly<{ phones: PhoneRegistry; gateway: LanGateway }>;

/** The setup page's words for a port in use (the plan's "Failures and what the person sees"). */
const portInUse = (port: number) =>
  `port ${port} is in use by another program. Stop it, then press Pair a phone again`;

export class PhoneAccess {
  readonly #home: Home;
  readonly #options: PhoneAccessOptions;
  readonly #log: (line: string) => void;
  #state: PhoneAccessState;
  #side: NetworkSide | undefined;
  #closed = false;
  /** Starts the network side again with the same phone list and pairing session. */
  #retry: (() => Promise<void>) | undefined;
  /** The phone list and the gateway, for the relay link, even while the network side is off. */
  #forRelay: RelayParts | undefined;

  private constructor(home: Home, options: PhoneAccessOptions, state: PhoneAccessState) {
    this.#home = home;
    this.#options = options;
    this.#log = options.log ?? ((line: string) => console.log(line));
    this.#state = state;
  }

  /**
   * Loads the phone list and the home's secrets, makes the pairing session and starts the network
   * side. A phone list or key file that can't be read, or a port in use, leaves it off with the
   * reason; it never overwrites the phone list.
   */
  static async start(home: Home, options: PhoneAccessOptions = {}): Promise<PhoneAccess> {
    const log = options.log ?? ((line: string) => console.log(line));
    const off = (reason: string) => {
      log(`L1 phones: phone pairing isn't available: ${reason}`);
      return new PhoneAccess(home, options, { on: false, reason, retryable: false });
    };
    let phones: PhoneRegistry;
    try {
      phones = await PhoneRegistry.load(home.stateDir);
    } catch (error) {
      if (!(error instanceof PhonesError)) throw error;
      return off(`the phone list can't be read: ${error.message}. Move the file away`);
    }
    let pairing: Pairing;
    let join: HubJoin;
    try {
      const secrets = await readHomeSecrets(home.stateDir);
      const { relayUrl } = options;
      pairing = new Pairing({
        home,
        secrets,
        phones,
        ...(relayUrl === undefined ? {} : { relayUrl }),
      });
      join = new HubJoin({ home, hubPrivateKey: secrets.hubPrivateKey, log });
    } catch (error) {
      if (!(error instanceof HomeError)) throw error;
      return off(`the home's keys can't be read: ${error.message}`);
    }
    const access = new PhoneAccess(home, options, { on: false, reason: "", retryable: true });
    await access.#listen(pairing, phones, join);
    access.#retry = () => access.#listen(pairing, phones, join);
    return access;
  }

  state(): PhoneAccessState {
    return this.#state;
  }

  /** The addresses phones reach this laptop at, while the network side runs. */
  addresses(): string[] {
    const state = this.#state;
    if (!state.on) return [];
    return (this.#options.addresses ?? lanAddresses)(state.port);
  }

  /** Tries the network side again, if it is off only because its port was in use. */
  async retry(): Promise<void> {
    const state = this.#state;
    if (state.on || !state.retryable || this.#closed) return;
    await this.#retry?.();
  }

  /** The phone list and the gateway's command switch, for step 5's relay link. */
  relayParts(): RelayParts | undefined {
    return this.#forRelay;
  }

  /** Stops the network side. */
  async close(): Promise<void> {
    this.#closed = true;
    const side = this.#side;
    this.#side = undefined;
    if (side !== undefined) await side.close();
  }

  async #listen(pairing: Pairing, phones: PhoneRegistry, join: HubJoin): Promise<void> {
    const port = this.#options.port ?? settings.BRIDGE_NETWORK_PORT;
    const { outbox, handoff, liveView } = this.#options;
    const handlers = {
      laptop_approval: (request: OpenedRequest) => join.approve(request),
      ...(liveView === undefined
        ? {}
        : { live_view_setting: (request: OpenedRequest) => liveView.handle(request) }),
    };
    const gateway = new LanGateway({
      homeId: this.#home.homeId,
      phones,
      log: this.#log,
      handlers,
      ...(outbox === undefined ? {} : { outbox }),
      ...(handoff === undefined ? {} : { handoff }),
    });
    this.#forRelay = { phones, gateway };
    const link = new LinkHub({ home: this.#home, seen: gateway, log: this.#log });
    const pair = {
      method: "POST",
      path: "/v1/pair",
      handle: (body: unknown, localAddress: string) => pairing.handleRequest(body, localAddress),
    } as const;
    try {
      this.#side = await startNetworkSide(
        this.#home.hubPublicKey,
        [pair, ...gateway.routes(), ...join.routes(), ...link.routes()],
        port,
      );
    } catch (error) {
      if (!(error instanceof Error && "code" in error)) throw error;
      const reason =
        error.code === "EADDRINUSE"
          ? portInUse(port)
          : `the network side can't start: ${errorMessage(error)}`;
      this.#log(`L1 phones: phone pairing isn't available: ${reason}`);
      this.#state = { on: false, reason, retryable: true };
      return;
    }
    if (this.#closed) {
      await this.#side.close();
      return;
    }
    this.#state = { on: true, pairing, phones, port: this.#side.port, join, link };
    this.#log(`L1 phones: the network side listens on port ${this.#side.port}`);
  }
}
