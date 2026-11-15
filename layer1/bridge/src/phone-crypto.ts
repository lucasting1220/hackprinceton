/**
 * The phone ↔ hub contract's cryptography (the iPhone track's CONTRACTS.md §1 and §2), byte for
 * byte as the app's CryptoKit code does it, and nothing else: no I/O, so step 5's relay can import
 * it, and the laptop join's derivations (§6). Keys stay key objects wherever node:crypto takes one; the QR secret stays bytes because HKDF
 * takes it as the salt.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPublicKey,
  createSecretKey,
  diffieHellman,
  hkdfSync,
  type KeyObject,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/** Raw X25519 public keys, the pairing proof, the phone key and the home key are 32 bytes. */
export const KEY_BYTES = 32;
/** ChaCha20-Poly1305 (IETF): a 12-byte nonce and a 16-byte tag. */
export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;
/** A name is at most 64 characters (grapheme clusters) and 1024 UTF-8 bytes. */
const NAME_MAX_CHARACTERS = 64;
const NAME_MAX_BYTES = 1024;

export type Role = "caregiver" | "resident";

/** The §2.4 envelope: `c` is the ciphertext followed by the 16-byte tag. */
export type Envelope = Readonly<{ v: number; kid: string; n: string; c: string }>;

/** What the associated data binds besides the kid; neither is used when the kid is `pair`. */
export type Label = Readonly<{ homeId: string; type: string }>;

/** What the pairing proof covers (§2.2). */
export type ProofInput = Readonly<{
  secret: Uint8Array;
  phonePublic: Uint8Array;
  role: Role;
  name: string;
}>;

const REFUSALS = {
  bad_base64url: "The value is not strict base64url.",
  bad_length: "The value has the wrong number of bytes.",
  bad_name: "The name is not a well-formed string of allowed length and characters.",
  low_order_key: "The public key is a low-order point.",
  bad_envelope: "The envelope's version is not 1.",
  not_authentic: "The envelope does not open with this key and associated data.",
} as const;

export type RefusalCode = keyof typeof REFUSALS;

/** A refused input. Its message is fixed by its code and never repeats the input or a key. */
export class PhoneCryptoRefusal extends Error {
  override name = "PhoneCryptoRefusal";
  readonly code: RefusalCode;

  constructor(code: RefusalCode) {
    super(REFUSALS[code]);
    this.code = code;
  }
}

/** Unpadded base64url (RFC 4648 §5), the way the contract sends binary. */
export function toBase64url(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64url");
}

const BASE64URL = /^([A-Za-z0-9_-]*)(={0,2})$/;

/**
 * Strict base64url, unlike Node's decoder, which skips characters it doesn't know: the URL-safe
 * alphabet only, canonical, unpadded or exactly padded, and `bytes` long or at least `atLeast`.
 */
export function fromBase64url(
  value: unknown,
  bytes: number | { readonly atLeast: number },
): Buffer {
  if (typeof value !== "string") throw new PhoneCryptoRefusal("bad_base64url");
  const [, body, padding = ""] = BASE64URL.exec(value) ?? [];
  if (body === undefined || (padding !== "" && (body.length + padding.length) % 4 !== 0)) {
    throw new PhoneCryptoRefusal("bad_base64url");
  }
  const decoded = Buffer.from(body, "base64url");
  if (decoded.toString("base64url") !== body) throw new PhoneCryptoRefusal("bad_base64url");
  const fits =
    typeof bytes === "number" ? decoded.length === bytes : decoded.length >= bytes.atLeast;
  if (!fits) throw new PhoneCryptoRefusal("bad_length");
  return decoded;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const CONTROL_OR_BIDI = /[\p{Cc}\p{Bidi_Control}]/u;

/**
 * A phone's or laptop's name in the NFC form the proof covers: well-formed Unicode, 1 to 64
 * characters counted as grapheme clusters, at most 256 UTF-8 bytes, and no control or
 * bidirectional-formatting character.
 */
export function checkedName(name: unknown): string {
  // A name's NFC form has at least 2 UTF-8 bytes for every 3 of its UTF-16 units (a decomposed
  // U+01D5 has exactly that), so a name of over 2 * NAME_MAX_BYTES units can't fit. It is refused
  // before NFC, whose time grows with the square of a run of combining marks.
  if (typeof name !== "string" || name.length > 2 * NAME_MAX_BYTES || !name.isWellFormed()) {
    throw new PhoneCryptoRefusal("bad_name");
  }
  const nfc = name.normalize("NFC");
  if (Buffer.byteLength(nfc, "utf8") > NAME_MAX_BYTES || CONTROL_OR_BIDI.test(nfc)) {
    throw new PhoneCryptoRefusal("bad_name");
  }
  const characters = [...graphemes.segment(nfc)].length;
  if (characters < 1 || characters > NAME_MAX_CHARACTERS) throw new PhoneCryptoRefusal("bad_name");
  return nfc;
}

/** SHA-256 of the device credential string's UTF-8 bytes, in lowercase hex (§5). */
export function credentialHash(credential: string): string {
  return createHash("sha256").update(credential, "utf8").digest("hex");
}

/** The `code` Node puts on its errors, if there is one. */
function codeOf(error: unknown): unknown {
  return error instanceof Error && "code" in error ? error.code : undefined;
}

/**
 * X25519 between a private key and the other side's raw public key: the hub's with a phone's (or a
 * test phone's with the hub's). A low-order key, which makes OpenSSL fail, and an all-zero result
 * (§2.3) are refused.
 */
export function sharedSecret(privateKey: KeyObject, peerPublic: Uint8Array): KeyObject {
  if (peerPublic.length !== KEY_BYTES) throw new PhoneCryptoRefusal("bad_length");
  const publicKey = createPublicKey({
    key: { kty: "OKP", crv: "X25519", x: toBase64url(peerPublic) },
    format: "jwk",
  });
  let shared: Buffer;
  try {
    shared = diffieHellman({ privateKey, publicKey });
  } catch (error) {
    if (codeOf(error) === "ERR_OSSL_FAILED_DURING_DERIVATION") {
      throw new PhoneCryptoRefusal("low_order_key");
    }
    throw error;
  }
  if (shared.every((byte) => byte === 0)) throw new PhoneCryptoRefusal("low_order_key");
  const key = createSecretKey(shared);
  shared.fill(0);
  return key;
}

/** proof = HMAC-SHA256(secret, phone_pub ‖ role ‖ 0x00 ‖ NFC(name)) (§2.2). */
export function pairingProof({ secret, phonePublic, role, name }: ProofInput): Buffer {
  return createHmac("sha256", secret)
    .update(phonePublic)
    .update(role, "utf8")
    .update(new Uint8Array([0]))
    .update(name.normalize("NFC"), "utf8")
    .digest();
}

/** Whether `proof` is the pairing proof of `input`, compared in constant time. */
export function proofMatches(proof: Uint8Array, input: ProofInput): boolean {
  const expected = pairingProof(input);
  return proof.length === expected.length && timingSafeEqual(proof, expected);
}

/** phone_key = HKDF-SHA256(shared, salt = secret, info = "debbie/v1/phone-key", 32) (§2.3). */
export function phoneKey(shared: KeyObject, secret: Uint8Array): KeyObject {
  const raw = Buffer.from(hkdfSync("sha256", shared, secret, "debbie/v1/phone-key", KEY_BYTES));
  const key = createSecretKey(raw);
  raw.fill(0);
  return key;
}

/**
 * The 4-digit code: HKDF-SHA256(shared, salt = secret, info = "debbie/v1/code", 4 bytes) read as
 * a big-endian integer, mod 10000, zero-padded (§2.3).
 */
export function pairingCode(shared: KeyObject, secret: Uint8Array): string {
  const four = Buffer.from(hkdfSync("sha256", shared, secret, "debbie/v1/code", 4));
  return String(four.readUInt32BE(0) % 10_000).padStart(4, "0");
}

/** Kids whose associated data is fixed: the bundle's and a laptop's join ticket's (§6.4). */
const FIXED_KIDS: ReadonlySet<string> = new Set(["pair", "join"]);

/** `debbie/v1/pair` or `debbie/v1/join`, else `debbie/v1/{home_id}/{kid}/{type}` (§2.4, §6.4). */
function associatedData(kid: string, { homeId, type }: Label): Buffer {
  return Buffer.from(
    FIXED_KIDS.has(kid) ? `debbie/v1/${kid}` : `debbie/v1/${homeId}/${kid}/${type}`,
  );
}

/**
 * Seals `plaintext` into a §2.4 envelope under `key` with a fresh random nonce. Only the vector
 * tests pass `nonce`: a nonce used twice with one key breaks the cipher.
 */
export function seal(
  plaintext: Uint8Array,
  key: KeyObject,
  kid: string,
  label: Label,
  nonce: Uint8Array = randomBytes(NONCE_BYTES),
): Envelope {
  const cipher = createCipheriv("chacha20-poly1305", key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(associatedData(kid, label), { plaintextLength: plaintext.length });
  const sealed = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return { v: 1, kid, n: toBase64url(nonce), c: toBase64url(sealed) };
}

/**
 * Opens a §2.4 envelope under `key`, with associated data from its own kid and `label`. A malformed
 * envelope is refused, and so is one that doesn't authenticate (another key, a changed byte or
 * another type); no plaintext leaves here before it authenticates.
 */
export function open(envelope: Envelope, key: KeyObject, label: Label): Buffer {
  if (envelope.v !== 1) throw new PhoneCryptoRefusal("bad_envelope");
  const nonce = fromBase64url(envelope.n, NONCE_BYTES);
  const sealed = fromBase64url(envelope.c, { atLeast: TAG_BYTES });
  const tagAt = sealed.length - TAG_BYTES;
  const decipher = createDecipheriv("chacha20-poly1305", key, nonce, { authTagLength: TAG_BYTES });
  decipher.setAAD(associatedData(envelope.kid, label), { plaintextLength: tagAt });
  decipher.setAuthTag(sealed.subarray(tagAt));
  const unverified = decipher.update(sealed.subarray(0, tagAt));
  let verified: Buffer;
  try {
    // With the tag set, final() fails only when the tag doesn't verify. OpenSSL 4 reports that as
    // ERR_OSSL_BAD_DECRYPT, but OpenSSL 3, which Node's own builds for Linux and Windows carry,
    // throws a plain "Unsupported state or unable to authenticate data" with no code.
    verified = decipher.final();
  } catch {
    unverified.fill(0);
    throw new PhoneCryptoRefusal("not_authentic");
  }
  return Buffer.concat([unverified, verified]);
}

/** A join token's length in bytes (contracts/README.md: 64 lowercase hex characters). */
const JOIN_TOKEN_BYTES = 32;

/** A new join token: 32 random bytes as 64 lowercase hex characters. Never log it. */
export function joinToken(): string {
  return randomBytes(JOIN_TOKEN_BYTES).toString("hex");
}

/** token_sha256: the SHA-256 of the token's 64 characters, in lowercase hex, as Layer 2 hashes it. */
export function tokenSha256(token: string): string {
  return createHash("sha256").update(token, "ascii").digest("hex");
}

/** The raw 32-byte X25519 public key of a private key. */
export function rawPublicKey(privateKey: KeyObject): Buffer {
  return fromBase64url(createPublicKey(privateKey).export({ format: "jwk" }).x, KEY_BYTES);
}

/**
 * The key that seals a laptop's join ticket (§6.4): HKDF-SHA256(ikm = X25519(hub, laptop), salt =
 * join_id, info = "debbie/v1/laptop-key" ‖ hub_pub ‖ laptop_pub, 32), so it opens under no other
 * pair of keys.
 */
export function laptopKey(
  shared: KeyObject,
  joinId: string,
  hubPublic: Uint8Array,
  laptopPublic: Uint8Array,
): KeyObject {
  const info = Buffer.concat([Buffer.from("debbie/v1/laptop-key"), hubPublic, laptopPublic]);
  const raw = Buffer.from(hkdfSync("sha256", shared, Buffer.from(joinId, "utf8"), info, KEY_BYTES));
  const key = createSecretKey(raw);
  raw.fill(0);
  return key;
}

/**
 * The bridge link's key (§6.6): HKDF-SHA256(ikm = SHA-256 of the join token, the 32 bytes that
 * token_sha256 spells, salt = node_id, info = "debbie/v1/link-key", 32). Both bridges derive it:
 * the laptop from its token, the hub from accepted-workers.json.
 */
export function linkKey(tokenSha256Hex: string, nodeId: string): KeyObject {
  const hash = Buffer.from(tokenSha256Hex, "hex");
  if (hash.length !== KEY_BYTES) throw new PhoneCryptoRefusal("bad_length");
  const raw = Buffer.from(
    hkdfSync("sha256", hash, Buffer.from(nodeId, "utf8"), "debbie/v1/link-key", KEY_BYTES),
  );
  hash.fill(0);
  const key = createSecretKey(raw);
  raw.fill(0);
  return key;
}
