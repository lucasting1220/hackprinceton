/**
 * Everything phones reach once a home exists: the phone list, the pairing session and the network
 * side on port 7480 with POST /v1/pair and the LAN gateway. main.ts starts it from its home-ready
 * hook on the coordinator. When it can't run, it says why, for the setup page, and the bridge runs
 * on without it.
 */
import type { Home } from "./home.ts";
import { HomeError, readHomeSecrets } from "./home.ts";
import { errorMessage } from "./json-file.ts";
import { LanGateway } from "./lan-gateway.ts";
import { lanAddresses, type NetworkSide, startNetworkSide } from "./network-server.ts";
import type { MessageSource } from "./outbox.ts";
import { Pairing } from "./pairing.ts";
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
}

/** What the pairing page reads: the parts while the network side runs, or why it doesn't. */
export type PhoneAccessState =
  | Readonly<{ on: true; pairing: Pairing; phones: PhoneRegistry; port: number }>
  | Readonly<{ on: false; reason: string; retryable: boolean }>;

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
    try {
      const secrets = await readHomeSecrets(home.stateDir);
      pairing = new Pairing({ home, secrets, phones });
    } catch (error) {
      if (!(error instanceof HomeError)) throw error;
      return off(`the home's keys can't be read: ${error.message}`);
    }
    const access = new PhoneAccess(home, options, { on: false, reason: "", retryable: true });
    await access.#listen(pairing, phones);
    access.#retry = () => access.#listen(pairing, phones);
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

  /** Stops the network side. */
  async close(): Promise<void> {
    this.#closed = true;
    const side = this.#side;
    this.#side = undefined;
    if (side !== undefined) await side.close();
  }

  async #listen(pairing: Pairing, phones: PhoneRegistry): Promise<void> {
    const port = this.#options.port ?? settings.BRIDGE_NETWORK_PORT;
    const { outbox } = this.#options;
    const gateway = new LanGateway({
      homeId: this.#home.homeId,
      phones,
      log: this.#log,
      ...(outbox === undefined ? {} : { outbox }),
    });
    const pair = {
      method: "POST",
      path: "/v1/pair",
      handle: (body: unknown, localAddress: string) => pairing.handleRequest(body, localAddress),
    } as const;
    try {
      this.#side = await startNetworkSide(
        this.#home.hubPublicKey,
        [pair, ...gateway.routes()],
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
    this.#state = { on: true, pairing, phones, port: this.#side.port };
    this.#log(`L1 phones: the network side listens on port ${this.#side.port}`);
  }
}
