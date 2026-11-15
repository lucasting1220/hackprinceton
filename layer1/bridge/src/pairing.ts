/**
 * The pairing session (phone-hub.md §2.1 to §2.3, §4.2, §4.3 and §4.6): one code at a time, held
 * in memory only. The phone is written to disk through the injected phone store at Confirm, and
 * nothing else is. No secret (the QR secret, the phone key, the home key, the device credential or
 * the 4-digit code) reaches a log line or an error message.
 */
import { type KeyObject, randomBytes, randomUUID } from "node:crypto";
import type { Home, HomeSecrets } from "./home.ts";
import { errorMessage } from "./json-file.ts";
import {
  checkedName,
  credentialHash,
  type Envelope,
  fromBase64url,
  KEY_BYTES,
  PhoneCryptoRefusal,
  pairingCode,
  phoneKey,
  proofMatches,
  type Role,
  seal,
  sharedSecret,
  toBase64url,
} from "./phone-crypto.ts";
import * as settings from "./settings.ts";
import { utcSeconds } from "./wire.ts";

/** A phone to add to the phone list at Confirm. The list never holds the credential itself. */
export interface NewPhone {
  readonly deviceId: string;
  /** The NFC form of the name the phone sent. */
  readonly name: string;
  readonly role: Role;
  /** The phone's own key, a 32-byte secret key. */
  readonly phoneKey: KeyObject;
  /** The SHA-256 of its device credential's UTF-8 bytes, in lowercase hex. */
  readonly credentialSha256: string;
}

/** Where Confirm saves the phone: the phone list, or an in-memory store in tests. */
export interface PhoneSaver {
  add(phone: NewPhone): Promise<void>;
}

/** The QR code's payload (§2.1): exactly these five fields. */
export type QrPayload = Readonly<{
  v: 1;
  addrs: readonly string[];
  hub_pub: string;
  secret: string;
  exp: number;
}>;

export type PairErrorCode =
  | "bad_request"
  | "unsupported_version"
  | "expired"
  | "bad_proof"
  | "in_progress"
  | "declined";

/** A §1 error body. The message is fixed by the code and never repeats the request. */
export type PairErrorBody = Readonly<{
  v: 1;
  error: Readonly<{ code: PairErrorCode; message: string }>;
}>;

export type PairReply =
  | Readonly<{ status: 202; body: Readonly<{ v: 1; status: "awaiting_confirmation" }> }>
  | Readonly<{ status: 200; body: Readonly<{ v: 1; status: "confirmed"; bundle: Envelope }> }>
  | Readonly<{ status: 400 | 403 | 409 | 410; body: PairErrorBody }>;

/** What the setup page may show. It holds no key, no credential and no QR secret. */
export type PairingView =
  | Readonly<{ state: "none" }>
  | Readonly<{ state: "showing"; addrs: readonly string[]; expiresAt: string }>
  | Readonly<{
      state: "pending";
      expiresAt: string;
      phone: Readonly<{ pendingId: string; name: string; role: Role; code: string }>;
      /** True while Confirm is saving the phone. */
      confirming: boolean;
    }>
  | Readonly<{
      state: "confirmed";
      phone: Readonly<{ deviceId: string; name: string; role: Role }>;
      /** Whether the phone has collected its bundle. */
      collected: boolean;
      /** Whether the phone may still collect it (BUNDLE_COLLECTION_MS after Confirm). */
      collecting: boolean;
    }>
  | Readonly<{ state: "expired" | "cancelled" }>;

export type StartResult =
  | Readonly<{ ok: true; qr: QrPayload }>
  | Readonly<{ ok: false; reason: "no_addresses" | "phone_waiting" | "collecting" }>;

export type ConfirmResult =
  | Readonly<{ ok: true; deviceId: string }>
  | Readonly<{
      ok: false;
      reason: "not_pending" | "expired" | "already_confirming" | "save_failed";
      message: string;
    }>;

export interface PairingOptions {
  readonly home: Pick<Home, "homeId" | "hubPublicKey">;
  readonly secrets: HomeSecrets;
  readonly phones: PhoneSaver;
  /** The clock, in milliseconds since the Unix epoch; tests pass their own. */
  readonly now?: () => number;
  /** The bundle's relay_url, from relay-credential.json; empty while remote access isn't set up. */
  readonly relayUrl?: string;
}

const MESSAGES: Readonly<Record<PairErrorCode, string>> = {
  bad_request: "The pairing request is malformed.",
  unsupported_version: "This version of the pairing request is not supported.",
  expired: "This code was already used or has expired.",
  bad_proof: "The pairing request does not match the code.",
  in_progress: "Another phone is pairing with this code.",
  declined: "The pairing was cancelled on the home laptop.",
};

/** A phone that holds the code. */
interface Holder {
  readonly pendingId: string;
  readonly phonePublic: Buffer;
  readonly name: string;
  readonly role: Role;
  readonly phoneKey: KeyObject;
  readonly code: string;
  readonly reachedAddress: string;
}

interface Confirmed {
  readonly deviceId: string;
  readonly envelope: Envelope;
  readonly confirmedAt: number;
  collected: boolean;
}

/** One code, from start to its end. */
interface Session {
  readonly secret: Buffer;
  readonly addrs: readonly string[];
  readonly exp: number;
  state: "showing" | "pending" | "confirming" | "confirmed" | "cancelled";
  holder?: Holder;
  confirmed?: Confirmed;
}

/** A checked pairing request (§2.2). */
interface PairRequest {
  readonly phonePublic: Buffer;
  readonly proof: Buffer;
  readonly role: Role;
  readonly name: string;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function refusal(status: 400 | 403 | 409 | 410, code: PairErrorCode): PairReply {
  return { status, body: { v: 1, error: { code, message: MESSAGES[code] } } };
}

/** Check 1, the shape: the request, or the reply that refuses it. */
function parseRequest(body: unknown): PairRequest | PairReply {
  if (!isRecord(body)) return refusal(400, "bad_request");
  const { v, phone_pub, proof, role, name } = body;
  if (typeof v === "number" && v > 1) return refusal(400, "unsupported_version");
  if (v !== 1 || (role !== "caregiver" && role !== "resident")) return refusal(400, "bad_request");
  try {
    return {
      phonePublic: fromBase64url(phone_pub, KEY_BYTES),
      proof: fromBase64url(proof, KEY_BYTES),
      role,
      name: checkedName(name),
    };
  } catch (error) {
    if (error instanceof PhoneCryptoRefusal) return refusal(400, "bad_request");
    throw error;
  }
}

/** The pairing session behind the setup page and POST /v1/pair. */
export class Pairing {
  readonly #home: PairingOptions["home"];
  readonly #secrets: HomeSecrets;
  readonly #phones: PhoneSaver;
  readonly #now: () => number;
  /** The bundle's relay_url: empty while remote access isn't set up. */
  readonly relayUrl: string;
  #session: Session | undefined;

  constructor(options: PairingOptions) {
    this.#home = options.home;
    this.#secrets = options.secrets;
    this.#phones = options.phones;
    this.#now = options.now ?? Date.now;
    this.relayUrl = options.relayUrl ?? "";
  }

  /**
   * Shows a new code for these "a.b.c.d:7480" addresses, ending the old one, unless a phone waits
   * for Confirm or a confirmed phone may still collect a bundle it hasn't. With no address, no code.
   */
  start(addresses: readonly string[]): StartResult {
    const session = this.#session;
    if (session !== undefined && this.#inTime(session)) {
      if (session.state === "pending" || session.state === "confirming") {
        return { ok: false, reason: "phone_waiting" };
      }
      if (session.state === "confirmed" && session.confirmed?.collected !== true) {
        return { ok: false, reason: "collecting" };
      }
    }
    if (addresses.length === 0) {
      this.#session = undefined;
      return { ok: false, reason: "no_addresses" };
    }
    const exp = Math.floor((this.#now() + settings.PAIRING_CODE_LIFETIME_MS) / 1000);
    const secret = randomBytes(settings.PAIRING_SECRET_BYTES);
    const addrs = [...addresses];
    this.#session = { secret, addrs, exp, state: "showing" };
    console.log("L1 pairing: new code shown");
    return { ok: true, qr: this.#qr(this.#session) };
  }

  /** The QR payload while a code is showing and no phone holds it, for the page to draw. */
  qr(): QrPayload | undefined {
    const session = this.#session;
    if (session?.state !== "showing" || !this.#inTime(session)) return undefined;
    return this.#qr(session);
  }

  /** Answers POST /v1/pair, with the checks in §4.2's order. */
  handleRequest(body: unknown, reachedAddress: string): PairReply {
    const request = parseRequest(body);
    if ("status" in request) return request;
    const session = this.#session;
    if (session === undefined || !this.#inTime(session)) return refusal(410, "expired");
    const { phonePublic, role, name } = request;
    if (!proofMatches(request.proof, { secret: session.secret, phonePublic, role, name })) {
      return refusal(403, "bad_proof");
    }
    const same = session.holder !== undefined && samePhone(session.holder, request);
    switch (session.state) {
      case "showing":
        return this.#hold(session, request, reachedAddress);
      case "pending":
      case "confirming":
        if (!same) return refusal(409, "in_progress");
        return { status: 202, body: { v: 1, status: "awaiting_confirmation" } };
      case "cancelled":
        return same ? refusal(403, "declined") : refusal(410, "expired");
      case "confirmed": {
        if (!same || session.confirmed === undefined) return refusal(410, "expired");
        if (!session.confirmed.collected) {
          session.confirmed.collected = true;
          console.log(`L1 pairing: phone ${session.confirmed.deviceId} collected its bundle`);
        }
        const bundle = session.confirmed.envelope;
        return { status: 200, body: { v: 1, status: "confirmed", bundle } };
      }
    }
  }

  /** The page's state, without secrets beyond the 4-digit code the page shows. */
  view(): PairingView {
    const session = this.#session;
    if (session === undefined) return { state: "none" };
    const expiresAt = utcSeconds(new Date(session.exp * 1000));
    const { holder, confirmed } = session;
    if (session.state === "confirmed" && holder !== undefined && confirmed !== undefined) {
      return {
        state: "confirmed",
        phone: { deviceId: confirmed.deviceId, name: holder.name, role: holder.role },
        collected: confirmed.collected,
        collecting: this.#inTime(session),
      };
    }
    if (session.state === "cancelled") return { state: "cancelled" };
    if (!this.#inTime(session)) return { state: "expired" };
    if (holder === undefined) return { state: "showing", addrs: session.addrs, expiresAt };
    const { pendingId, name, role, code } = holder;
    return {
      state: "pending",
      expiresAt,
      phone: { pendingId, name, role, code },
      confirming: session.state === "confirming",
    };
  }

  /**
   * Confirms the pending phone named by `pendingId`: seals its bundle, saves the phone, and only
   * then marks the code confirmed. If the save fails, nothing is kept and the phone stays pending.
   */
  async confirm(pendingId: string): Promise<ConfirmResult> {
    const session = this.#session;
    const holder = session?.holder;
    if (session?.state === "confirming") {
      return { ok: false, reason: "already_confirming", message: "Confirm is already saving." };
    }
    if (session?.state !== "pending" || holder === undefined || holder.pendingId !== pendingId) {
      return { ok: false, reason: "not_pending", message: "No phone is waiting for this Confirm." };
    }
    if (!this.#inTime(session)) {
      return { ok: false, reason: "expired", message: "This code expired." };
    }
    session.state = "confirming";
    const deviceId = randomUUID();
    const credential = toBase64url(randomBytes(settings.DEVICE_CREDENTIAL_BYTES));
    const confirmedAt = this.#now();
    const envelope = this.#seal(session, holder, deviceId, credential, confirmedAt);
    try {
      await this.#phones.add({
        deviceId,
        name: holder.name,
        role: holder.role,
        phoneKey: holder.phoneKey,
        credentialSha256: credentialHash(credential),
      });
    } catch (error) {
      if (this.#session === session) session.state = "pending";
      console.error(`L1 pairing: could not save the phone: ${errorMessage(error)}`);
      const message = `Couldn't save the phone (${errorMessage(error)}). Press Confirm again.`;
      return { ok: false, reason: "save_failed", message };
    }
    session.confirmed = { deviceId, envelope, confirmedAt, collected: false };
    session.state = "confirmed";
    console.log(`L1 pairing: phone ${deviceId} confirmed as ${holder.role}`);
    return { ok: true, deviceId };
  }

  /** Cancel on the setup page: ends the code. False when there is none to end, or while saving. */
  cancel(): boolean {
    const session = this.#session;
    if (session === undefined || session.state === "confirming" || session.state === "confirmed") {
      return false;
    }
    session.state = "cancelled";
    console.log("L1 pairing: code cancelled");
    return true;
  }

  /** Whether the code still works: until exp, or a confirmed one for the collection window. */
  #inTime(session: Session): boolean {
    const now = this.#now();
    if (session.state === "confirmed" && session.confirmed !== undefined) {
      return now < session.confirmed.confirmedAt + settings.BUNDLE_COLLECTION_MS;
    }
    return now < session.exp * 1000;
  }

  #qr(session: Session): QrPayload {
    return {
      v: 1,
      addrs: session.addrs,
      hub_pub: this.#home.hubPublicKey,
      secret: toBase64url(session.secret),
      exp: session.exp,
    };
  }

  /** The first request of a phone with a valid proof: it now holds the code. */
  #hold(session: Session, request: PairRequest, reachedAddress: string): PairReply {
    let shared: KeyObject;
    try {
      shared = sharedSecret(this.#secrets.hubPrivateKey, request.phonePublic);
    } catch (error) {
      if (error instanceof PhoneCryptoRefusal) return refusal(400, "bad_request");
      throw error;
    }
    session.holder = {
      pendingId: randomUUID(),
      phonePublic: request.phonePublic,
      name: request.name,
      role: request.role,
      phoneKey: phoneKey(shared, session.secret),
      code: pairingCode(shared, session.secret),
      reachedAddress,
    };
    session.state = "pending";
    console.log(`L1 pairing: a ${request.role} phone is waiting for Confirm`);
    return { status: 202, body: { v: 1, status: "awaiting_confirmation" } };
  }

  /** The §4.3 bundle, sealed with the phone key under kid `pair`. */
  #seal(session: Session, holder: Holder, deviceId: string, credential: string, at: number) {
    const { addrs } = session;
    const lan = {
      addrs: [holder.reachedAddress, ...addrs.filter((addr) => addr !== holder.reachedAddress)],
    };
    const bundle = {
      v: 1,
      msg_id: randomUUID(),
      sent_at: utcSeconds(new Date(at)),
      home_id: this.#home.homeId,
      device_id: deviceId,
      role: holder.role,
      device_credential: credential,
      relay_url: this.relayUrl,
      ...(holder.role === "caregiver"
        ? { home_key: toBase64url(this.#secrets.homeKey.export()) }
        : {}),
      home_name: settings.HOME_NAME,
      lan,
    };
    const plaintext = Buffer.from(JSON.stringify(bundle), "utf8");
    const envelope = seal(plaintext, holder.phoneKey, "pair", {
      homeId: this.#home.homeId,
      type: "pair",
    });
    plaintext.fill(0);
    return envelope;
  }
}

/** The same phone: the same public key bytes, NFC name and role (§4.2). */
function samePhone(holder: Holder, request: PairRequest): boolean {
  return (
    holder.phonePublic.equals(request.phonePublic) &&
    holder.name === request.name &&
    holder.role === request.role
  );
}
