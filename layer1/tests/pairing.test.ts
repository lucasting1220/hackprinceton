import assert from "node:assert/strict";
import { createSecretKey, generateKeyPairSync, type KeyObject, randomBytes } from "node:crypto";
import { format } from "node:util";
import { type TestContext, test } from "node:test";
import {
  type NewPhone,
  Pairing,
  type PairReply,
  type PhoneSaver,
  type QrPayload,
} from "../bridge/src/pairing.ts";
import {
  credentialHash,
  type Envelope,
  fromBase64url,
  toBase64url,
} from "../bridge/src/phone-crypto.ts";
import {
  BUNDLE_COLLECTION_MS,
  HOME_NAME,
  PAIRING_CODE_LIFETIME_MS,
  RELAY_URL,
} from "../bridge/src/settings.ts";
import { FakePhone } from "./fake-phone.ts";

const HOME_ID = "7a8e0c4e-5f1d-4c39-9d7e-1b2a3c4d5e6f";
const ADDRS = ["192.168.1.20:7480", "10.0.0.5:7480"] as const;
const START_MS = Date.UTC(2026, 10, 14, 15, 10, 0);

/** An in-memory phone store that can be told to fail its next add. */
class MemoryPhones implements PhoneSaver {
  readonly phones: NewPhone[] = [];
  failNext = false;

  add(phone: NewPhone): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error("disk full"));
    }
    this.phones.push(phone);
    return Promise.resolve();
  }
}

interface Fixture {
  readonly pairing: Pairing;
  readonly phones: MemoryPhones;
  readonly homeKey: KeyObject;
  readonly hubPublicKey: string;
  readonly clock: { ms: number };
}

function fixture(): Fixture {
  const { privateKey } = generateKeyPairSync("x25519");
  const hubPublicKey = toBase64url(fromBase64url(privateKey.export({ format: "jwk" }).x, 32));
  const homeKey = createSecretKey(randomBytes(32));
  const phones = new MemoryPhones();
  const clock = { ms: START_MS };
  const pairing = new Pairing({
    home: { homeId: HOME_ID, hubPublicKey },
    secrets: { homeKey, hubPrivateKey: privateKey },
    phones,
    now: () => clock.ms,
  });
  return { pairing, phones, homeKey, hubPublicKey, clock };
}

function started(f: Fixture): QrPayload {
  const result = f.pairing.start(ADDRS);
  assert.ok(result.ok);
  return result.qr;
}

function errorCode(reply: PairReply): string | undefined {
  return "error" in reply.body ? reply.body.error.code : undefined;
}

function expect(reply: PairReply, status: number, code?: string): void {
  assert.equal(reply.status, status);
  if (code !== undefined) assert.equal(errorCode(reply), code);
}

function pendingId(f: Fixture): string {
  const view = f.pairing.view();
  assert.equal(view.state, "pending");
  return view.phone.pendingId;
}

function bundleOf(reply: PairReply): Envelope {
  assert.equal(reply.status, 200);
  assert.ok("bundle" in reply.body);
  return reply.body.bundle;
}

test("the QR payload has exactly its five fields, a 16-byte secret and exp 10 minutes ahead", () => {
  const f = fixture();
  const qr = started(f);
  assert.deepEqual(Object.keys(qr).sort(), ["addrs", "exp", "hub_pub", "secret", "v"]);
  assert.equal(qr.v, 1);
  assert.deepEqual(qr.addrs, ADDRS);
  assert.equal(qr.hub_pub, f.hubPublicKey);
  assert.equal(fromBase64url(qr.secret, 16).length, 16);
  assert.equal(qr.exp, (START_MS + PAIRING_CODE_LIFETIME_MS) / 1000);
  assert.ok(Number.isInteger(qr.exp));
  assert.deepEqual(f.pairing.qr(), qr);
});

test("with no addresses there is no code, and a request gets 410", () => {
  const f = fixture();
  assert.deepEqual(f.pairing.start([]), { ok: false, reason: "no_addresses" });
  assert.equal(f.pairing.qr(), undefined);
  assert.deepEqual(f.pairing.view(), { state: "none" });
  const qr = started(fixture());
  expect(f.pairing.handleRequest(new FakePhone(qr).request(), ADDRS[0]), 410, "expired");
});

test("every reply, in the contract's order", () => {
  const f = fixture();
  const qr = started(f);
  const phone = new FakePhone(qr);
  const good = phone.request();
  const ask = (body: unknown): PairReply => f.pairing.handleRequest(body, ADDRS[0]);

  // 1. The shape.
  for (const body of [
    null,
    [],
    { ...good, v: 0 },
    { ...good, v: "1" },
    { ...good, role: "admin" },
    { ...good, name: "" },
    { ...good, name: "x".repeat(65) },
    { ...good, name: "Sam\u0007" },
    { ...good, name: "Sam‮" },
    { ...good, phone_pub: "$" },
    { ...good, proof: toBase64url(randomBytes(31)) },
  ]) {
    expect(ask(body), 400, "bad_request");
  }
  expect(ask({ ...good, v: 2 }), 400, "unsupported_version");
  // 3. The proof, before anyone holds the code.
  expect(ask({ ...good, proof: toBase64url(randomBytes(32)) }), 403, "bad_proof");
  expect(ask({ ...good, name: "Another name" }), 403, "bad_proof");
  // A low-order key with a valid proof is refused, and doesn't take the code.
  const lowOrder = new FakePhone(qr, { phonePublic: Buffer.alloc(32) });
  expect(ask(lowOrder.request()), 400, "bad_request");
  // 4. The first phone holds the code; it gets 202 again, and anyone else 409.
  assert.deepEqual(ask(good), { status: 202, body: { v: 1, status: "awaiting_confirmation" } });
  assert.deepEqual(ask({ ...good, extra: "ignored" }).status, 202);
  expect(ask(new FakePhone(qr).request()), 409, "in_progress");
  const otherName = new FakePhone(qr, { name: "Other" });
  expect(ask(otherName.request()), 409, "in_progress");
  const sameKeyOtherRole = { ...good, ...sameKeyAs(qr, phone, "resident") };
  expect(ask(sameKeyOtherRole), 409, "in_progress");
  // Cancel: the pending phone is declined, anyone else expired.
  assert.equal(f.pairing.cancel(), true);
  expect(ask(good), 403, "declined");
  expect(ask(new FakePhone(qr).request()), 410, "expired");
  assert.deepEqual(f.pairing.view(), { state: "cancelled" });
  // 2. The code ran out of time, checked before the proof.
  const g = fixture();
  const late = started(g);
  g.clock.ms += PAIRING_CODE_LIFETIME_MS;
  expect(g.pairing.handleRequest(new FakePhone(late).request(), ADDRS[0]), 410, "expired");
  const badProof = { ...new FakePhone(late).request(), proof: toBase64url(randomBytes(32)) };
  expect(g.pairing.handleRequest(badProof, ADDRS[0]), 410, "expired");
  assert.deepEqual(g.pairing.view(), { state: "expired" });
});

/** The same phone_pub and name with another role, and a proof that matches it. */
function sameKeyAs(qr: QrPayload, phone: FakePhone, role: "resident"): Record<string, unknown> {
  return new FakePhone(qr, { name: phone.name, role, phonePublic: phone.phonePublic }).request();
}

test("the page's code equals the phone's own code, and the view holds no secret", () => {
  const f = fixture();
  const qr = started(f);
  const phone = new FakePhone(qr, { name: "Mamá's iPhone" });
  expect(f.pairing.handleRequest(phone.request(), ADDRS[0]), 202);
  const view = f.pairing.view();
  assert.equal(view.state, "pending");
  assert.equal(view.phone.code, phone.code());
  assert.match(view.phone.code, /^\d{4}$/);
  assert.equal(view.phone.name, "Mamá's iPhone");
  assert.equal(view.phone.role, "caregiver");
  assert.notEqual(view.phone.pendingId, view.phone.code);
  assert.equal(view.expiresAt, "2026-11-14T15:20:00Z");
  assert.equal(f.pairing.qr(), undefined);
  const text = JSON.stringify(view);
  assert.ok(!text.includes(qr.secret));
  assert.ok(!text.includes(toBase64url(phone.key().export())));
  assert.ok(!text.includes(toBase64url(f.homeKey.export())));
});

for (const role of ["caregiver", "resident"] as const) {
  test(`after Confirm a ${role} gets 200 and a bundle with exactly §4.3's fields`, async () => {
    const f = fixture();
    const qr = started(f);
    const phone = new FakePhone(qr, { role });
    const reached = ADDRS[1];
    expect(f.pairing.handleRequest(phone.request(), reached), 202);
    const result = await f.pairing.confirm(pendingId(f));
    assert.ok(result.ok);
    const reply = f.pairing.handleRequest(phone.request(), reached);
    const envelope = bundleOf(reply);
    assert.equal(envelope.kid, "pair");
    const bundle = phone.openBundle(envelope);
    assert.ok(typeof bundle === "object" && bundle !== null);
    const fields = [
      "v",
      "msg_id",
      "sent_at",
      "home_id",
      "device_id",
      "role",
      "device_credential",
      "relay_url",
      ...(role === "caregiver" ? ["home_key"] : []),
      "home_name",
      "lan",
    ];
    assert.deepEqual(Object.keys(bundle).sort(), fields.sort());
    const get = (name: string): unknown => Reflect.get(bundle, name);
    assert.equal(get("v"), 1);
    assert.match(String(get("msg_id")), /^[0-9a-f-]{36}$/);
    assert.equal(get("sent_at"), "2026-11-14T15:10:00Z");
    assert.equal(get("home_id"), HOME_ID);
    assert.equal(get("device_id"), result.deviceId);
    assert.equal(get("role"), role);
    assert.equal(get("relay_url"), RELAY_URL);
    assert.equal(get("home_name"), HOME_NAME);
    assert.deepEqual(get("lan"), { addrs: [ADDRS[1], ADDRS[0]] });
    const credential = get("device_credential");
    assert.equal(fromBase64url(credential, 32).length, 32);
    if (role === "caregiver") {
      assert.equal(get("home_key"), toBase64url(f.homeKey.export()));
    }
    assert.equal(f.phones.phones.length, 1);
    const saved = f.phones.phones[0];
    assert.ok(saved !== undefined);
    assert.equal(saved.deviceId, result.deviceId);
    assert.equal(saved.name, phone.name);
    assert.equal(saved.role, role);
    assert.equal(
      typeof credential === "string" && credentialHash(credential),
      saved.credentialSha256,
    );
    assert.ok(saved.phoneKey.equals(phone.key()));
    // The same envelope every time; anyone else gets 410.
    assert.deepEqual(f.pairing.handleRequest(phone.request(), reached), reply);
    expect(f.pairing.handleRequest(new FakePhone(qr).request(), reached), 410, "expired");
    const view = f.pairing.view();
    assert.equal(view.state, "confirmed");
    assert.equal(view.collected, true);
    assert.equal(view.collecting, true);
  });
}

test("a wrong or stale pending ID confirms nothing", async () => {
  const f = fixture();
  const qr = started(f);
  const first = new FakePhone(qr);
  expect(f.pairing.handleRequest(first.request(), ADDRS[0]), 202);
  const staleId = pendingId(f);
  const wrong = await f.pairing.confirm("not-the-id");
  assert.deepEqual(wrong.ok ? undefined : wrong.reason, "not_pending");
  assert.equal(f.pairing.cancel(), true);
  assert.deepEqual(f.pairing.start(ADDRS).ok, true);
  const qr2 = f.pairing.qr();
  assert.ok(qr2 !== undefined);
  expect(f.pairing.handleRequest(new FakePhone(qr2).request(), ADDRS[0]), 202);
  const stale = await f.pairing.confirm(staleId);
  assert.equal(stale.ok, false);
  assert.equal(f.phones.phones.length, 0);
  assert.equal(f.pairing.view().state, "pending");
});

test("Confirm after the code expired confirms nothing", async () => {
  const f = fixture();
  const qr = started(f);
  expect(f.pairing.handleRequest(new FakePhone(qr).request(), ADDRS[0]), 202);
  const id = pendingId(f);
  f.clock.ms += PAIRING_CODE_LIFETIME_MS;
  const result = await f.pairing.confirm(id);
  assert.deepEqual(result.ok ? undefined : result.reason, "expired");
  assert.equal(f.phones.phones.length, 0);
});

test("two Confirms make one phone", async () => {
  const f = fixture();
  const qr = started(f);
  expect(f.pairing.handleRequest(new FakePhone(qr).request(), ADDRS[0]), 202);
  const id = pendingId(f);
  const [one, two] = await Promise.all([f.pairing.confirm(id), f.pairing.confirm(id)]);
  assert.equal(one.ok, true);
  assert.deepEqual(two.ok ? undefined : two.reason, "already_confirming");
  const again = await f.pairing.confirm(id);
  assert.equal(again.ok, false);
  assert.equal(f.phones.phones.length, 1);
});

test("the phone may collect its bundle for 60 seconds after Confirm, even past exp", async () => {
  const f = fixture();
  const qr = started(f);
  const phone = new FakePhone(qr);
  expect(f.pairing.handleRequest(phone.request(), ADDRS[0]), 202);
  f.clock.ms += PAIRING_CODE_LIFETIME_MS - 1000;
  assert.ok((await f.pairing.confirm(pendingId(f))).ok);
  assert.deepEqual(f.pairing.start(ADDRS), { ok: false, reason: "collecting" });
  f.clock.ms += BUNDLE_COLLECTION_MS - 1;
  bundleOf(f.pairing.handleRequest(phone.request(), ADDRS[0]));
  f.clock.ms += 1;
  expect(f.pairing.handleRequest(phone.request(), ADDRS[0]), 410, "expired");
  const view = f.pairing.view();
  assert.equal(view.state, "confirmed");
  assert.equal(view.collecting, false);
  assert.equal(f.pairing.start(ADDRS).ok, true);
});

test("a phone waiting for Confirm keeps the code from being replaced", () => {
  const f = fixture();
  const qr = started(f);
  expect(f.pairing.handleRequest(new FakePhone(qr).request(), ADDRS[0]), 202);
  assert.deepEqual(f.pairing.start(ADDRS), { ok: false, reason: "phone_waiting" });
  f.clock.ms += PAIRING_CODE_LIFETIME_MS;
  assert.equal(f.pairing.start(ADDRS).ok, true);
});

test("a failed save keeps the phone pending, and a second Confirm works", async () => {
  const f = fixture();
  const qr = started(f);
  const phone = new FakePhone(qr);
  expect(f.pairing.handleRequest(phone.request(), ADDRS[0]), 202);
  const id = pendingId(f);
  f.phones.failNext = true;
  const failed = await f.pairing.confirm(id);
  assert.equal(failed.ok, false);
  assert.ok(!failed.ok);
  assert.equal(failed.reason, "save_failed");
  assert.equal(failed.message, "Couldn't save the phone (disk full). Press Confirm again.");
  assert.equal(f.phones.phones.length, 0);
  assert.equal(pendingId(f), id);
  expect(f.pairing.handleRequest(phone.request(), ADDRS[0]), 202);
  assert.ok((await f.pairing.confirm(id)).ok);
  assert.equal(f.phones.phones.length, 1);
  bundleOf(f.pairing.handleRequest(phone.request(), ADDRS[0]));
});

function captureLogs(t: TestContext): string[] {
  const lines: string[] = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    t.mock.method(console, method, (...args: unknown[]) => lines.push(format(...args)));
  }
  return lines;
}

test("no secret reaches a log line or a confirm message", async (t) => {
  const lines = captureLogs(t);
  const f = fixture();
  const qr = started(f);
  const phone = new FakePhone(qr);
  f.pairing.handleRequest({ ...phone.request(), proof: toBase64url(randomBytes(32)) }, ADDRS[0]);
  f.pairing.handleRequest(phone.request(), ADDRS[0]);
  const id = pendingId(f);
  const code = phone.code();
  f.phones.failNext = true;
  const failed = await f.pairing.confirm(id);
  assert.ok((await f.pairing.confirm(id)).ok);
  const bundle = phone.openBundle(bundleOf(f.pairing.handleRequest(phone.request(), ADDRS[0])));
  const credential = String(Reflect.get(Object(bundle), "device_credential"));
  t.mock.restoreAll();
  assert.ok(lines.length > 0);
  const secrets = [qr.secret, toBase64url(phone.key().export()), toBase64url(f.homeKey.export())]
    .flatMap((text) => [text, fromBase64url(text, { atLeast: 1 }).toString("hex")])
    .concat([credential, phone.name]);
  const text = [...lines, failed.ok ? "" : failed.message].join("\n");
  for (const secret of secrets) assert.ok(!text.includes(secret));
  assert.doesNotMatch(text, new RegExp(`\\b${code}\\b`));
});

test("once the phone has collected its bundle, a new code can be shown at once", async () => {
  const f = fixture();
  const phone = new FakePhone(started(f));
  expect(f.pairing.handleRequest(phone.request(), ADDRS[0]), 202);
  assert.ok((await f.pairing.confirm(pendingId(f))).ok);
  assert.deepEqual(f.pairing.start(ADDRS), { ok: false, reason: "collecting" });
  bundleOf(f.pairing.handleRequest(phone.request(), ADDRS[0]));
  assert.equal(f.pairing.start(ADDRS).ok, true);
});
