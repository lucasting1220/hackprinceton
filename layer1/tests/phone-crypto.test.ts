import assert from "node:assert/strict";
import crypto, {
  createHmac,
  createPrivateKey,
  createSecretKey,
  generateKeyPairSync,
  randomBytes,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { describe, mock, test } from "node:test";
import {
  checkedName,
  credentialHash,
  type Envelope,
  fromBase64url,
  open,
  PhoneCryptoRefusal,
  pairingCode,
  pairingProof,
  phoneKey,
  proofMatches,
  type RefusalCode,
  seal,
  sharedSecret,
  toBase64url,
} from "../bridge/src/phone-crypto.ts";

type Strings<K extends string> = Readonly<Record<K, string>>;
/** contracts/vectors.json: the iPhone track's test vectors (CONTRACTS.md §10), byte for byte. */
interface Vectors {
  readonly v: number;
  readonly x25519: readonly Strings<
    "name" | "hub_private" | "hub_public" | "phone_private" | "phone_public" | "shared"
  >[];
  readonly pairing: readonly (Strings<
    "name" | "secret" | "phone_public" | "device_name" | "proof" | "shared" | "phone_key" | "code"
  > & { readonly role: "caregiver" | "resident" })[];
  readonly envelopes: readonly (Strings<
    "name" | "key" | "nonce" | "home_id" | "kid" | "type" | "plaintext"
  > & { readonly envelope: Strings<"kid" | "n" | "c"> & { readonly v: number } })[];
  readonly credential_hash: readonly Strings<"credential" | "sha256_hex">[];
}

const vectorsFile = path.join(import.meta.dirname, "..", "contracts", "vectors.json");
const parsed: unknown = JSON.parse(await readFile(vectorsFile, { encoding: "utf8" }));
const vectors = parsed as Vectors;

function first<T>(list: readonly T[]): T {
  const [item] = list;
  assert.ok(item !== undefined, "the vectors file lists none");
  return item;
}

describe("contracts/vectors.json", () => {
  test("covers every case the iPhone track's CONTRACTS.md §10 lists", () => {
    assert.equal(vectors.v, 1);
    assert.ok(vectors.x25519.length > 0 && vectors.credential_hash.length > 0);
    const roles = new Set(vectors.pairing.map(({ role }) => role));
    assert.deepEqual(roles, new Set(["caregiver", "resident"]));
    const names = vectors.pairing.map(({ device_name: name }) => name);
    assert.ok(
      names.some((name) => name === name.normalize("NFC") && name !== name.normalize("NFD")),
    );
    const cases = vectors.envelopes.map(
      ({ kid, type }) => `${kid === "home" || kid === "pair" ? kid : "device"}/${type}`,
    );
    for (const wanted of ["home/alert", "home/heartbeat", "device/ack", "pair/pair"]) {
      assert.ok(cases.includes(wanted), wanted);
    }
  });
});

const raw = (value: string) => Buffer.from(value, "base64url");
/** A refusal with `code` and that code's fixed message, which therefore can't repeat the input. */
const refused = (code: RefusalCode) => ({
  name: "PhoneCryptoRefusal",
  code,
  message: new PhoneCryptoRefusal(code).message,
});
describe("checkedName", () => {
  test("returns the NFC form, not NFKC, and limits the bytes of that form", () => {
    assert.equal(checkedName("Mama\u{301}'s iPhone"), "Mam\u{E1}'s iPhone");
    assert.equal(checkedName("Sam\u{FB01}"), "Sam\u{FB01}");
    // 64 Hangul syllables sent as 576 bytes of jamo, which NFC composes into 192 bytes.
    assert.equal(checkedName("\u{1112}\u{1161}\u{11AB}".repeat(64)), "\u{D55C}".repeat(64));
  });

  test("counts grapheme clusters, and accepts 64 of them in 256 UTF-8 bytes", () => {
    for (const name of ["g\u{303}".repeat(64), "\u{1F600}".repeat(64)]) {
      assert.equal(checkedName(name), name);
    }
  });

  test("accepts names the app sends that take more than 256 UTF-8 bytes", () => {
    // 33 thumbs with a skin tone (264 bytes) and 11 family emoji (275 bytes).
    for (const name of [
      "\u{1F44D}\u{1F3FD}".repeat(33),
      "\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}".repeat(11),
    ]) {
      assert.ok(Buffer.byteLength(name) > 256);
      assert.equal(checkedName(name), name);
    }
  });

  test("refuses an empty, long, control, bidirectional, ill-formed or non-string name", () => {
    const names = ["", "a".repeat(65), `a${"\u{301}".repeat(600)}`, "Sam\u{7}", "Sam\u{85}"];
    const bidi = ["Sam\u{202E}", "Sam\u{2066}", "Sam\u{200E}", "Sam\u{200F}", "Sam\u{61C}"];
    for (const name of [...names, ...bidi, "Sam\u{D800}", 42]) {
      assert.throws(() => checkedName(name), refused("bad_name"), JSON.stringify(name));
    }
  });

  test("refuses a name too long to fit without normalizing it", () => {
    const normalize = mock.method(String.prototype, "normalize");
    try {
      assert.throws(() => checkedName(`a${"\u{301}".repeat(2048)}`), refused("bad_name"));
      assert.equal(normalize.mock.callCount(), 0);
    } finally {
      normalize.mock.restore();
    }
  });
});

describe("base64url", () => {
  const { hub_public: key } = first(vectors.x25519);
  const { secret } = first(vectors.pairing);

  test("refuses characters outside the URL-safe alphabet, and a value that isn't a string", () => {
    for (const character of ["$", "+", "/", ".", " ", "\n"]) {
      const value = `${character}${key.slice(1)}`;
      assert.throws(() => fromBase64url(value, 32), refused("bad_base64url"), value);
    }
    for (const value of [[key], 1234, null]) {
      assert.throws(() => fromBase64url(value, 32), refused("bad_base64url"), String(value));
    }
  });

  test("refuses bad padding and non-canonical encodings", () => {
    const misplaced = `${key.slice(0, 20)}=${key.slice(20)}`;
    const values = [`${key}==`, `${key}===`, `=${key}`, misplaced, `${secret}=`, "A".repeat(45)];
    for (const value of [...values, `${"A".repeat(42)}B`]) {
      assert.throws(() => fromBase64url(value, 32), refused("bad_base64url"), value);
    }
  });

  test("refuses the wrong number of bytes", () => {
    assert.throws(() => fromBase64url(key, 31), refused("bad_length"));
    assert.throws(() => fromBase64url(key, 33), refused("bad_length"));
    const short = toBase64url(Buffer.alloc(15));
    assert.throws(() => fromBase64url(short, { atLeast: 16 }), refused("bad_length"));
  });

  test("accepts exact padding, and encodes without it", () => {
    assert.deepEqual(fromBase64url(`${key}=`, 32), raw(key));
    assert.deepEqual(fromBase64url(`${secret}==`, 16), raw(secret));
    assert.equal(toBase64url(raw(secret)), secret);
  });
});

test("credentialHash reproduces the credential_hash vector", () => {
  for (const v of vectors.credential_hash) {
    assert.equal(credentialHash(v.credential), v.sha256_hex);
  }
});

/** An X25519 private key from its raw 32 bytes, behind the PKCS #8 DER prefix. */
const privateKey = (value: string) =>
  createPrivateKey({
    key: Buffer.concat([Buffer.from("302e020100300506032b656e04220420", "hex"), raw(value)]),
    format: "der",
    type: "pkcs8",
  });

function flipped(bytes: Buffer, at: number): Buffer {
  const copy = Buffer.from(bytes);
  copy.writeUInt8(copy.readUInt8(at) ^ 1, at);
  return copy;
}

describe("sharedSecret", () => {
  test("derives each x25519 vector's shared secret on the hub side and on the phone side", () => {
    for (const v of vectors.x25519) {
      const hubSide = sharedSecret(privateKey(v.hub_private), raw(v.phone_public));
      const phoneSide = sharedSecret(privateKey(v.phone_private), raw(v.hub_public));
      assert.equal(hubSide.export().toString("base64url"), v.shared, v.name);
      assert.equal(phoneSide.export().toString("base64url"), v.shared, v.name);
    }
  });

  test("refuses low-order public keys, and keys that aren't 32 bytes", () => {
    const hub = privateKey(first(vectors.x25519).hub_private);
    const lowOrder = [
      "00".repeat(32),
      `${"00".repeat(31)}80`,
      `01${"00".repeat(31)}`,
      `ec${"ff".repeat(30)}7f`,
      `ed${"ff".repeat(30)}7f`,
      `ee${"ff".repeat(30)}7f`,
      "e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800",
      "5f9c95bca3508c24b1d0b1559c83ef5b04445cc4581c8e86d8224eddd09f1157",
    ];
    for (const hex of lowOrder) {
      assert.throws(() => sharedSecret(hub, Buffer.from(hex, "hex")), refused("low_order_key"));
    }
    assert.throws(() => sharedSecret(hub, Buffer.alloc(31, 9)), refused("bad_length"));
    assert.throws(() => sharedSecret(hub, Buffer.alloc(33, 9)), refused("bad_length"));
  });

  test("passes on an error it doesn't expect, such as a private key of another kind", () => {
    const { privateKey: ed25519 } = generateKeyPairSync("ed25519");
    const peer = raw(first(vectors.x25519).phone_public);
    assert.throws(() => sharedSecret(ed25519, peer), { code: "ERR_CRYPTO_INCOMPATIBLE_KEY" });
  });
});

describe("pairing proof, phone key and code", () => {
  const inputOf = (v: Vectors["pairing"][number]) => ({
    secret: raw(v.secret),
    phonePublic: raw(v.phone_public),
    role: v.role,
    name: v.device_name,
  });

  test("reproduce each pairing vector, for the caregiver and the resident", () => {
    for (const v of vectors.pairing) {
      const input = inputOf(v);
      const shared = createSecretKey(raw(v.shared));
      assert.equal(pairingProof(input).toString("base64url"), v.proof, v.name);
      assert.ok(proofMatches(raw(v.proof), input), v.name);
      const key = phoneKey(shared, input.secret).export().toString("base64url");
      assert.equal(key, v.phone_key, v.name);
      assert.equal(pairingCode(shared, input.secret), v.code, v.name);
    }
  });

  test("the proof covers the NFC form: a decomposed name gives the composed name's proof", () => {
    const v = first(vectors.pairing.filter(({ device_name: n }) => n !== n.normalize("NFD")));
    const proof = pairingProof({ ...inputOf(v), name: v.device_name.normalize("NFD") });
    assert.equal(proof.toString("base64url"), v.proof);
    // NFC keeps the ligature that NFKC would turn into f and i.
    const input = { ...inputOf(v), name: "Sam\u{FB01}" };
    const message = [input.phonePublic, Buffer.from(`${input.role}\u{0}Sam\u{FB01}`)];
    const expected = createHmac("sha256", input.secret).update(Buffer.concat(message)).digest();
    assert.deepEqual(pairingProof(input), expected);
  });

  test("proofMatches refuses a changed proof and one of the wrong length", () => {
    const v = first(vectors.pairing);
    assert.equal(proofMatches(flipped(raw(v.proof), 31), inputOf(v)), false);
    assert.equal(proofMatches(raw(v.proof).subarray(1), inputOf(v)), false);
    assert.equal(proofMatches(Buffer.concat([raw(v.proof), Buffer.alloc(1)]), inputOf(v)), false);
  });

  test("proofMatches compares with crypto.timingSafeEqual", () => {
    const v = first(vectors.pairing);
    const compare = mock.method(crypto, "timingSafeEqual");
    syncBuiltinESMExports();
    try {
      assert.equal(proofMatches(raw(v.proof), inputOf(v)), true);
      assert.equal(compare.mock.callCount(), 1);
    } finally {
      compare.mock.restore();
      syncBuiltinESMExports();
    }
  });

  test("the code keeps its leading zeros", () => {
    // Checked against WebCrypto's HKDF: the four bytes are f743449b = 4148380827, so 0827.
    assert.equal(pairingCode(createSecretKey(Buffer.alloc(32, 9)), Buffer.alloc(16)), "0827");
  });
});

describe("envelopes", () => {
  const labelOf = (v: Vectors["envelopes"][number]) => ({ homeId: v.home_id, type: v.type });

  test("reproduce each vector's c from its key and nonce, and open back to its plaintext", () => {
    for (const v of vectors.envelopes) {
      const key = createSecretKey(raw(v.key));
      const sealed = seal(Buffer.from(v.plaintext, "utf8"), key, v.kid, labelOf(v), raw(v.nonce));
      assert.deepEqual(sealed, v.envelope, v.name);
      assert.equal(open(v.envelope, key, labelOf(v)).toString("utf8"), v.plaintext, v.name);
    }
  });

  test("refuse to open with a relabelled type, a flipped byte or the wrong key", () => {
    for (const v of vectors.envelopes) {
      const key = createSecretKey(raw(v.key));
      const changed = { ...v.envelope, c: flipped(raw(v.envelope.c), 0).toString("base64url") };
      assert.throws(() => open(changed, key, labelOf(v)), refused("not_authentic"), v.name);
      const otherKey = createSecretKey(randomBytes(32));
      assert.throws(() => open(v.envelope, otherKey, labelOf(v)), refused("not_authentic"), v.name);
      if (v.kid !== "pair") {
        const relabelled = { homeId: v.home_id, type: v.type === "alert" ? "heartbeat" : "alert" };
        assert.throws(() => open(v.envelope, key, relabelled), refused("not_authentic"), v.name);
      }
    }
  });

  test("seal takes each nonce from crypto.randomBytes", () => {
    const key = createSecretKey(Buffer.alloc(32, 1));
    const label = { homeId: "home-1", type: "fetch" };
    const nonce = Buffer.alloc(12, 7);
    const draw = mock.method(crypto, "randomBytes", () => nonce);
    syncBuiltinESMExports();
    try {
      assert.equal(seal(Buffer.from("{}"), key, "device-1", label).n, toBase64url(nonce));
      const sizes = draw.mock.calls.map((call) => call.arguments);
      assert.deepEqual(sizes, [[12]]);
    } finally {
      draw.mock.restore();
      syncBuiltinESMExports();
    }
  });

  test("seal an empty plaintext as the tag alone, which opens to nothing", () => {
    const key = createSecretKey(Buffer.alloc(32, 1));
    const label = { homeId: "home-1", type: "fetch" };
    const envelope = seal(Buffer.alloc(0), key, "device-1", label);
    assert.equal(raw(envelope.c).length, 16);
    assert.equal(open(envelope, key, label).length, 0);
  });

  test("refuse a bad version, a nonce that isn't 12 bytes, a short c, and bad base64url", () => {
    const v = first(vectors.envelopes);
    const key = createSecretKey(raw(v.key));
    const opening = (change: Partial<Envelope>) => () =>
      open({ ...v.envelope, ...change }, key, labelOf(v));
    assert.throws(opening({ v: 0 }), refused("bad_envelope"));
    assert.throws(opening({ v: 2 }), refused("bad_envelope"));
    assert.throws(opening({ n: toBase64url(Buffer.alloc(11)) }), refused("bad_length"));
    assert.throws(opening({ n: toBase64url(Buffer.alloc(13)) }), refused("bad_length"));
    assert.throws(opening({ c: toBase64url(Buffer.alloc(15)) }), refused("bad_length"));
    assert.throws(opening({ n: `${v.envelope.n}$` }), refused("bad_base64url"));
    assert.throws(opening({ c: `${v.envelope.c}$` }), refused("bad_base64url"));
  });

  test("open passes on an error it doesn't expect, such as a key of the wrong size", () => {
    const v = first(vectors.envelopes);
    const short = createSecretKey(Buffer.alloc(16));
    assert.throws(() => open(v.envelope, short, labelOf(v)), { code: "ERR_CRYPTO_INVALID_KEYLEN" });
  });

  test("open refuses a tag that doesn't verify, however OpenSSL reports it", () => {
    // OpenSSL 3, which Node's own builds for Linux and Windows carry, throws a plain "Unsupported
    // state or unable to authenticate data" with no code; OpenSSL 4 adds ERR_OSSL_BAD_DECRYPT.
    const v = first(vectors.envelopes);
    const key = createSecretKey(raw(v.key));
    const probe = crypto.createDecipheriv("chacha20-poly1305", Buffer.alloc(32), Buffer.alloc(12), {
      authTagLength: 16,
    });
    const final = mock.method(Object.getPrototypeOf(probe), "final", () => {
      throw new Error("Unsupported state or unable to authenticate data");
    });
    try {
      assert.throws(() => open(v.envelope, key, labelOf(v)), refused("not_authentic"));
    } finally {
      final.mock.restore();
    }
  });
});
