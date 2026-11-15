/**
 * The home laptop's side of Add a laptop (phone-hub.md §6): the joins waiting for approval, the
 * routes POST /v1/join and POST /v1/join/status on the network side, and laptop_approval, which the
 * LAN gateway hands here once openPhoneRequest has opened it. An approval mints the laptop's node
 * ID and join token, adds the token's hash to accepted-workers.json, and only then seals the
 * ticket to the laptop's key. Log lines name join and node IDs only: never a token, a hash, a key,
 * a ticket or a name a laptop chose.
 */
import { type KeyObject, randomUUID } from "node:crypto";
import type { AcceptedWorker, Home } from "./home.ts";
import { AcceptedWorkersError, addAcceptedWorker } from "./home.ts";
import { errorMessage, JsonFileError } from "./json-file.ts";
import type { OpenedRequest } from "./lan-gateway.ts";
import { errorReply, type Reply, type Route } from "./network-server.ts";
import {
  checkedName,
  type Envelope,
  fromBase64url,
  joinToken,
  KEY_BYTES,
  laptopKey,
  PhoneCryptoRefusal,
  seal,
  sharedSecret,
  tokenSha256,
} from "./phone-crypto.ts";
import * as settings from "./settings.ts";
import { utcSeconds } from "./wire.ts";

export interface HubJoinOptions {
  readonly home: Home;
  readonly hubPrivateKey: KeyObject;
  /** The clock, in milliseconds since the Unix epoch; tests pass their own. */
  readonly now?: () => number;
  readonly log?: (line: string) => void;
  /** Adds an approved laptop to accepted-workers.json; tests hold it or make it fail. */
  readonly addWorker?: (worker: AcceptedWorker) => Promise<void>;
}

/** A join as the home laptop's page lists it: no key and no token. */
export type JoinListing = Readonly<{
  joinId: string;
  name: string;
  state: "waiting" | "approving" | "approved" | "declined" | "expired";
  expiresAt: string;
  nodeId: string | null;
}>;

interface Join {
  readonly joinId: string;
  readonly name: string;
  readonly laptopPublic: Buffer;
  /** Whole Unix seconds, as the QR code carries it. */
  readonly exp: number;
  state: "waiting" | "approving" | "approved" | "declined";
  /** The approval in progress, which a second approval of the same join waits for. */
  approving: Promise<Reply> | undefined;
  ticket: Envelope | undefined;
  nodeId: string | null;
  /** When the hub forgets the join. */
  forgetAt: number;
}

/** The refusals of §6.5. Each message is fixed and never repeats the request. */
const REFUSED = {
  badRequest: errorReply(400, "bad_request", "The request is malformed."),
  unsupportedVersion: errorReply(400, "unsupported_version", "This version is not supported."),
  tooMany: errorReply(429, "too_many_joins", "Too many laptops are waiting for approval."),
  unknownJoin: errorReply(404, "unknown_join", "The hub has no such join."),
  expired: errorReply(410, "expired", "This join code expired."),
  declined: errorReply(409, "declined", "A caregiver declined this laptop."),
  forbidden: errorReply(400, "forbidden", "Only a caregiver's phone can approve a laptop."),
  approvalUnknown: errorReply(400, "unknown_join", "The hub has no such join."),
  approvalExpired: errorReply(400, "expired", "This join code expired."),
  mismatch: errorReply(400, "join_mismatch", "The code doesn't match the laptop that asked."),
  internal: errorReply(500, "internal", "Something went wrong in the hub."),
};

const ACCEPTED: Reply = { status: 202, body: { v: 1, accepted: true } };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A `v` that isn't 1: a newer one gets its own code (§1). */
const versionRefusal = (v: unknown) =>
  typeof v === "number" && v > 1 ? REFUSED.unsupportedVersion : REFUSED.badRequest;

export class HubJoin {
  readonly #home: Home;
  readonly #hubPrivateKey: KeyObject;
  readonly #hubPublic: Buffer;
  readonly #now: () => number;
  readonly #log: (line: string) => void;
  readonly #addWorker: (worker: AcceptedWorker) => Promise<void>;
  readonly #joins = new Map<string, Join>();
  /** What the latest failed approval could not do, for the home laptop's page. */
  #problem: string | undefined;

  constructor(options: HubJoinOptions) {
    this.#home = options.home;
    this.#hubPrivateKey = options.hubPrivateKey;
    this.#hubPublic = fromBase64url(options.home.hubPublicKey, KEY_BYTES);
    this.#now = options.now ?? Date.now;
    this.#log = options.log ?? ((line: string) => console.log(line));
    this.#addWorker = options.addWorker ?? ((worker) => addAcceptedWorker(options.home, worker));
  }

  /** POST /v1/join and POST /v1/join/status, for the network side. */
  routes(): Route[] {
    return [
      { method: "POST", path: "/v1/join", handle: (body) => this.request(body) },
      { method: "POST", path: "/v1/join/status", handle: (body) => this.status(body) },
    ];
  }

  /** The joins the hub remembers, newest first, and the latest approval's failure, if any. */
  listing(): { joins: JoinListing[]; problem: string | undefined } {
    this.#sweep();
    const now = this.#now();
    const joins = [...this.#joins.values()].reverse().map(
      (join): JoinListing => ({
        joinId: join.joinId,
        name: join.name,
        state: join.state === "waiting" && this.#expired(join, now) ? "expired" : join.state,
        expiresAt: utcSeconds(new Date(join.exp * 1000)),
        nodeId: join.nodeId,
      }),
    );
    return { joins, problem: this.#problem };
  }

  /** A new laptop's join request (§6.2): its name and a fresh public key. */
  request(body: unknown): Reply {
    if (!isRecord(body)) return REFUSED.badRequest;
    const { v, name: sentName, laptop_pub: sentPublic } = body;
    if (v !== 1) return versionRefusal(v);
    let name: string;
    let laptopPublic: Buffer;
    try {
      name = checkedName(sentName);
      laptopPublic = fromBase64url(sentPublic, KEY_BYTES);
      sharedSecret(this.#hubPrivateKey, laptopPublic); // refuses a low-order key
    } catch (error) {
      if (error instanceof PhoneCryptoRefusal) return REFUSED.badRequest;
      throw error;
    }
    this.#sweep();
    const now = this.#now();
    const waiting = [...this.#joins.values()].filter(
      (join) => join.state !== "approved" && join.state !== "declined" && !this.#expired(join, now),
    );
    if (waiting.length >= settings.JOINS_PENDING_MAX) return REFUSED.tooMany;
    const exp = Math.floor((now + settings.JOIN_CODE_LIFETIME_MS) / 1000);
    const joinId = randomUUID();
    this.#joins.set(joinId, {
      joinId,
      name,
      laptopPublic,
      exp,
      state: "waiting",
      approving: undefined,
      ticket: undefined,
      nodeId: null,
      forgetAt: exp * 1000 + settings.JOIN_CODE_LIFETIME_MS,
    });
    this.#log(`L1 hub-join: a laptop asked to join, join ${joinId}`);
    return {
      status: 202,
      body: { v: 1, join_id: joinId, exp, hub_pub: this.#home.hubPublicKey },
    };
  }

  /** The new laptop's question, every 2 seconds: is the join approved yet (§6.3)? */
  status(body: unknown): Reply {
    if (!isRecord(body)) return REFUSED.badRequest;
    const { v, join_id: joinId } = body;
    if (v !== 1) return versionRefusal(v);
    if (typeof joinId !== "string") return REFUSED.badRequest;
    this.#sweep();
    const join = this.#joins.get(joinId);
    if (join === undefined) return REFUSED.unknownJoin;
    if (join.state === "approved" && join.ticket !== undefined) {
      return { status: 200, body: { v: 1, status: "approved", ticket: join.ticket } };
    }
    if (join.state === "declined") return REFUSED.declined;
    if (this.#expired(join, this.#now())) return REFUSED.expired;
    return { status: 202, body: { v: 1, status: "waiting", exp: join.exp } };
  }

  /**
   * laptop_approval from a phone that openPhoneRequest has checked (§6.5): a caregiver's, for a
   * waiting join whose key and name it matches, before the code expires. 403 is never answered
   * here: the app reads it as "this iPhone was removed".
   */
  async approve(request: OpenedRequest): Promise<Reply> {
    if (request.role !== "caregiver") return REFUSED.forbidden;
    const { join_id: joinId, laptop_pub: laptopPub, name, approve } = request.plaintext;
    if (typeof joinId !== "string" || typeof approve !== "boolean") return REFUSED.badRequest;
    let sentName: string;
    let sentPublic: Buffer;
    try {
      sentName = checkedName(name);
      sentPublic = fromBase64url(laptopPub, KEY_BYTES);
    } catch (error) {
      if (error instanceof PhoneCryptoRefusal) return REFUSED.badRequest;
      throw error;
    }
    this.#sweep();
    const join = this.#joins.get(joinId);
    if (join === undefined) return REFUSED.approvalUnknown;
    if (!join.laptopPublic.equals(sentPublic) || join.name !== sentName) return REFUSED.mismatch;
    if (join.state === "approved") return ACCEPTED; // approved already: nothing new is minted
    if (join.approving !== undefined) return join.approving;
    if (join.state === "declined" || this.#expired(join, this.#now())) {
      return REFUSED.approvalExpired;
    }
    if (!approve) {
      join.state = "declined";
      this.#log(`L1 hub-join: phone ${request.deviceId} declined join ${joinId}`);
      return ACCEPTED;
    }
    join.state = "approving";
    join.approving = this.#mint(join, request.deviceId).finally(() => {
      join.approving = undefined;
    });
    return join.approving;
  }

  /** Mints the node ID and token, lists the hash, then seals the ticket; on failure, 500. */
  async #mint(join: Join, deviceId: string): Promise<Reply> {
    const nodeId = randomUUID();
    const token = joinToken();
    const entry = { node_id: nodeId, display_name: join.name, token_sha256: tokenSha256(token) };
    try {
      await this.#addWorker(entry);
    } catch (error) {
      if (!(error instanceof AcceptedWorkersError || error instanceof JsonFileError)) throw error;
      join.state = "waiting";
      this.#problem = `couldn't add a laptop to the home: ${errorMessage(error)}`;
      this.#log(`L1 hub-join: join ${join.joinId} not approved: ${errorMessage(error)}`);
      return REFUSED.internal;
    }
    const now = this.#now();
    const ticket = {
      v: 1,
      msg_id: randomUUID(),
      sent_at: utcSeconds(new Date(now)),
      type: "join_ticket",
      home_id: this.#home.homeId,
      node_id: nodeId,
      display_name: join.name,
      join_token: token,
      coordinator_port: this.#home.listenPort,
    };
    const shared = sharedSecret(this.#hubPrivateKey, join.laptopPublic);
    const key = laptopKey(shared, join.joinId, this.#hubPublic, join.laptopPublic);
    const bytes = Buffer.from(JSON.stringify(ticket), "utf8");
    join.ticket = seal(bytes, key, "join", { homeId: "", type: "join_ticket" });
    bytes.fill(0);
    join.state = "approved";
    join.nodeId = nodeId;
    join.forgetAt = now + settings.JOIN_CODE_LIFETIME_MS;
    this.#problem = undefined;
    this.#log(`L1 hub-join: phone ${deviceId} approved join ${join.joinId} as node ${nodeId}`);
    return ACCEPTED;
  }

  #expired(join: Join, now: number): boolean {
    return join.state === "waiting" && now >= join.exp * 1000;
  }

  /** Forgets joins past their time, and declined ones with them. */
  #sweep(): void {
    const now = this.#now();
    for (const [joinId, join] of this.#joins) {
      if (now >= join.forgetAt) this.#joins.delete(joinId);
    }
  }
}
