/**
 * The app's side of pairing, for tests: its own X25519 key pair, the proof, the 4-digit code it
 * shows, and opening the bundle with its phone key, all through phone-crypto.ts.
 */
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import type { QrPayload } from "../bridge/src/pairing.ts";
import {
  type Envelope,
  fromBase64url,
  KEY_BYTES,
  open,
  pairingCode,
  pairingProof,
  phoneKey,
  type Role,
  sharedSecret,
  toBase64url,
} from "../bridge/src/phone-crypto.ts";

export interface FakePhoneOptions {
  readonly name?: string;
  readonly role?: Role;
  /** A raw public key to send instead of its own, such as a low-order point. */
  readonly phonePublic?: Uint8Array;
}

export class FakePhone {
  readonly name: string;
  readonly role: Role;
  readonly phonePublic: Buffer;
  readonly #privateKey: KeyObject;
  readonly #qr: QrPayload;

  constructor(qr: QrPayload, options: FakePhoneOptions = {}) {
    const { privateKey, publicKey } = generateKeyPairSync("x25519");
    this.#privateKey = privateKey;
    this.#qr = qr;
    this.name = options.name ?? "Caregiver's iPhone";
    this.role = options.role ?? "caregiver";
    const own = fromBase64url(publicKey.export({ format: "jwk" }).x, KEY_BYTES);
    this.phonePublic = Buffer.from(options.phonePublic ?? own);
  }

  get #secret(): Buffer {
    return fromBase64url(this.#qr.secret, 16);
  }

  /** The POST /v1/pair body (§2.2). */
  request(): Record<string, unknown> {
    const proof = pairingProof({
      secret: this.#secret,
      phonePublic: this.phonePublic,
      role: this.role,
      name: this.name,
    });
    return {
      v: 1,
      phone_pub: toBase64url(this.phonePublic),
      name: this.name,
      role: this.role,
      proof: toBase64url(proof),
    };
  }

  #shared(): KeyObject {
    return sharedSecret(this.#privateKey, fromBase64url(this.#qr.hub_pub, KEY_BYTES));
  }

  /** The 4-digit code the phone shows. */
  code(): string {
    return pairingCode(this.#shared(), this.#secret);
  }

  /** The phone key, as the app derives it. */
  key(): KeyObject {
    return phoneKey(this.#shared(), this.#secret);
  }

  /** Opens the bundle under kid `pair`, as the app does, and parses it. */
  openBundle(envelope: Envelope, homeId = ""): unknown {
    if (envelope.kid !== "pair") throw new Error("the bundle's kid is not pair");
    return JSON.parse(open(envelope, this.key(), { homeId, type: "pair" }).toString("utf8"));
  }
}
