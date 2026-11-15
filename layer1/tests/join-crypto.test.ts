import assert from "node:assert/strict";
import { createSecretKey, generateKeyPairSync, webcrypto } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, type TestContext, test } from "node:test";
import { acceptedWorkers, addAcceptedWorker, createHome, loadHome } from "../bridge/src/home.ts";
import {
  joinToken,
  laptopKey,
  linkKey,
  open,
  PhoneCryptoRefusal,
  rawPublicKey,
  seal,
  sharedSecret,
  tokenSha256,
} from "../bridge/src/phone-crypto.ts";
import { makeTempDir } from "./coordinator-fixtures.ts";

const contractsDir = path.join(import.meta.dirname, "..", "..", "contracts");
const readContract = async (name: string): Promise<unknown> =>
  JSON.parse(await readFile(path.join(contractsDir, name), "utf8"));

/** HKDF-SHA256 through WebCrypto, an implementation apart from the bridge's hkdfSync. */
async function webHkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array): Promise<Buffer> {
  const base = await webcrypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const params = { name: "HKDF", hash: "SHA-256", salt, info };
  return Buffer.from(await webcrypto.subtle.deriveBits(params, base, 256));
}

const fixed = (byte: number) => Buffer.alloc(32, byte);

describe("the join's cryptography (phone-hub.md §6.4 and §6.6)", () => {
  test("the token is 64 lowercase hex characters, hashed as Layer 2 hashes it", async () => {
    const token = joinToken();
    assert.match(token, /^[0-9a-f]{64}$/);
    assert.notEqual(joinToken(), token);
    // contracts/README.md: the example token in hello.json hashes to accepted-workers.json's.
    const hello = (await readContract("hello.json")) as { token: string };
    const accepted = (await readContract("accepted-workers.json")) as {
      workers: { token_sha256: string }[];
    };
    assert.equal(tokenSha256(hello.token), accepted.workers[0]?.token_sha256);
  });

  test("laptop_key and link_key equal WebCrypto's HKDF over the contract's inputs", async () => {
    const [shared, hubPub, laptopPub] = [fixed(1), fixed(2), fixed(3)];
    const info = Buffer.concat([Buffer.from("debbie/v1/laptop-key"), hubPub, laptopPub]);
    const expected = await webHkdf(shared, Buffer.from("join-1"), info);
    const derived = laptopKey(createSecretKey(shared), "join-1", hubPub, laptopPub);
    assert.deepEqual(derived.export(), expected);
    const hash = tokenSha256("0".repeat(64));
    const linkExpected = await webHkdf(
      Buffer.from(hash, "hex"),
      Buffer.from("node-1"),
      Buffer.from("debbie/v1/link-key"),
    );
    assert.deepEqual(linkKey(hash, "node-1").export(), linkExpected);
    assert.throws(() => linkKey("abcd", "node-1"), PhoneCryptoRefusal);
  });

  test("a ticket opens on the laptop's side only, under kid join and its fixed associated data", () => {
    const hub = generateKeyPairSync("x25519").privateKey;
    const laptop = generateKeyPairSync("x25519").privateKey;
    const [hubPub, laptopPub] = [rawPublicKey(hub), rawPublicKey(laptop)];
    const sealing = laptopKey(sharedSecret(hub, laptopPub), "join-1", hubPub, laptopPub);
    const opening = laptopKey(sharedSecret(laptop, hubPub), "join-1", hubPub, laptopPub);
    const label = { homeId: "", type: "join_ticket" };
    const ticket = seal(Buffer.from("{}"), sealing, "join", label);
    assert.equal(open(ticket, opening, { homeId: "another", type: "other" }).toString(), "{}");
    const wrongJoin = laptopKey(sharedSecret(laptop, hubPub), "join-2", hubPub, laptopPub);
    assert.throws(() => open(ticket, wrongJoin, label), PhoneCryptoRefusal);
    const swapped = laptopKey(sharedSecret(laptop, hubPub), "join-1", laptopPub, hubPub);
    assert.throws(() => open(ticket, swapped, label), PhoneCryptoRefusal);
    const flipped = Buffer.from(ticket.c, "base64url");
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    const altered = { ...ticket, c: flipped.toString("base64url") };
    assert.throws(() => open(altered, opening, label), PhoneCryptoRefusal);
    assert.throws(() => open({ ...ticket, kid: "pair" }, opening, label), PhoneCryptoRefusal);
    assert.throws(() => sharedSecret(hub, Buffer.alloc(32)), PhoneCryptoRefusal);
  });
});

describe("accepted-workers.json, written by the bridge", () => {
  async function home(t: TestContext) {
    const stateDir = await makeTempDir();
    t.after(() => rm(stateDir, { recursive: true, force: true }));
    return createHome(stateDir);
  }
  const worker = (index: number) => ({
    node_id: `node-${index}`,
    display_name: `Laptop ${index}`,
    token_sha256: tokenSha256(String(index).repeat(64).slice(0, 64)),
  });

  test("two additions started together both land, in Layer 2's shape", async (t) => {
    const h = await home(t);
    await Promise.all([addAcceptedWorker(h, worker(1)), addAcceptedWorker(h, worker(2))]);
    assert.deepEqual(await acceptedWorkers(h), [worker(1), worker(2)]);
    const written: unknown = JSON.parse(await readFile(h.acceptedWorkersFile, "utf8"));
    assert.deepEqual(written, { schema_version: 1, workers: [worker(1), worker(2)] });
  });

  test("a repeated node_id or hash is refused and the file is left as it was", async (t) => {
    const h = await home(t);
    await addAcceptedWorker(h, worker(1));
    const before = await readFile(h.acceptedWorkersFile, "utf8");
    const sameNode = { ...worker(2), node_id: "node-1" };
    const sameHash = { ...worker(3), token_sha256: worker(1).token_sha256 };
    for (const entry of [sameNode, sameHash]) {
      await assert.rejects(addAcceptedWorker(h, entry), { name: "AcceptedWorkersError" });
    }
    assert.equal(await readFile(h.acceptedWorkersFile, "utf8"), before);
  });

  test("a file that breaks the rules is reported, never overwritten, and names no hash", async (t) => {
    const h = await home(t);
    for (const text of [
      '{"schema_version":2,"workers":[]}',
      '{"schema_version":1,"workers":[],"extra":1}',
      `{"schema_version":1,"workers":[{"node_id":"a","display_name":"b","token_sha256":"${"A".repeat(64)}"}]}`,
    ]) {
      await writeFile(h.acceptedWorkersFile, text, "utf8");
      const refused = addAcceptedWorker(h, worker(1));
      await assert.rejects(
        refused,
        (error: Error) => !error.message.includes(worker(1).token_sha256),
      );
      assert.equal(await readFile(h.acceptedWorkersFile, "utf8"), text);
    }
  });

  test("Home.listenPort comes from coordinator.json", async (t) => {
    const h = await home(t);
    const config = JSON.parse(await readFile(h.coordinatorConfigFile, "utf8")) as object;
    await writeFile(h.coordinatorConfigFile, JSON.stringify({ ...config, listen_port: 7999 }));
    assert.equal((await loadHome(h.stateDir))?.listenPort, 7999);
  });
});
