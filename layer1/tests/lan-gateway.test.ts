import assert from "node:assert/strict";
import { createSecretKey, type KeyObject, randomBytes } from "node:crypto";
import { type TestContext, test } from "node:test";
import { LanGateway, type PhoneDirectory } from "../bridge/src/lan-gateway.ts";
import { type Reply, startNetworkSide } from "../bridge/src/network-server.ts";
import type { PhoneLookup, PhoneRole } from "../bridge/src/phones.ts";
import * as settings from "../bridge/src/settings.ts";
import { utcSeconds } from "../bridge/src/wire.ts";
import { FETCH_FIELDS, type PhoneMessage, phoneWrapper } from "./fake-phone.ts";

const HOME_ID = "7a8e0c4e-5f1d-4c39-9d7e-1b2a3c4d5e6f";
const START_MS = Date.UTC(2026, 10, 14, 15, 10, 0);
const at = (ms: number) => utcSeconds(new Date(ms));

/** An in-memory phone list. */
class MemoryDirectory implements PhoneDirectory {
  readonly paired = new Map<string, { role: PhoneRole; phoneKey: KeyObject }>();
  readonly removed = new Set<string>();

  lookup(deviceId: string): PhoneLookup {
    const phone = this.paired.get(deviceId);
    if (phone !== undefined) return { state: "paired", ...phone };
    return { state: this.removed.has(deviceId) ? "removed" : "unknown" };
  }

  async remove(deviceId: string): Promise<void> {
    if (this.paired.delete(deviceId)) this.removed.add(deviceId);
  }
}

function fixture() {
  const phones = new MemoryDirectory();
  const clock = { ms: START_MS };
  const lines: string[] = [];
  const gateway = new LanGateway({
    homeId: HOME_ID,
    phones,
    now: () => clock.ms,
    log: (line) => lines.push(line),
  });
  const pair = (deviceId: string, role: PhoneRole = "caregiver") => {
    const phoneKey = createSecretKey(randomBytes(32));
    phones.paired.set(deviceId, { role, phoneKey });
    /** A wrapper from this phone, sent now by the test's clock. */
    return (type: string, changes: Partial<PhoneMessage> = {}) =>
      phoneWrapper(phoneKey, {
        homeId: HOME_ID,
        deviceId,
        type,
        sentAt: at(clock.ms),
        ...(type === "fetch" ? { fields: FETCH_FIELDS } : {}),
        ...changes,
      });
  };
  return { gateway, phones, clock, lines, pair };
}

function refused(reply: Reply, status: number, code: string): void {
  assert.equal(reply.status, status);
  assert.deepEqual(Reflect.get(Reflect.get(reply.body, "error"), "code"), code);
}

test("a paired phone's fetch gets the empty page, a caregiver's and a resident's", () => {
  const f = fixture();
  for (const [id, role] of [
    ["phone-a", "caregiver"],
    ["phone-b", "resident"],
  ] as const) {
    const reply = f.gateway.messages(f.pair(id, role)("fetch"));
    assert.equal(reply.status, 200);
    const hub = { online: true, last_contact_at: "2026-11-14T15:10:00Z" };
    assert.deepEqual(reply.body, { v: 1, messages: [], next: null, hub });
  }
});

test("only an unknown or a removed phone gets 403", async () => {
  const f = fixture();
  const fetch = f.pair("phone-a")("fetch");
  f.phones.paired.clear();
  refused(f.gateway.messages(fetch), 403, "unknown_device");
  const other = f.pair("phone-b");
  await f.phones.remove("phone-b"); // as Remove on the setup page does
  refused(f.gateway.messages(other("fetch")), 403, "device_removed");
});

test("the wrong key, a relabelled type or a mismatched plaintext gets 400 bad_envelope", () => {
  const f = fixture();
  const send = f.pair("phone-a");
  const stranger = fixture().pair("phone-a"); // the same device ID with another key
  refused(f.gateway.messages(stranger("fetch")), 400, "bad_envelope");
  refused(f.gateway.messages(send("fetch", { sealedType: "unpair" })), 400, "bad_envelope");
  const typed = send("unpair", { wrapperType: "fetch", sealedType: "fetch" });
  refused(f.gateway.messages(typed), 400, "bad_envelope");
  refused(f.gateway.messages(send("fetch", { wrapperMsgId: "other-id" })), 400, "bad_envelope");
  const badTime = send("fetch", { fields: { ...FETCH_FIELDS, sent_at: "yesterday" } });
  refused(f.gateway.messages(badTime), 400, "bad_envelope");
});

test("the wrapper's shape comes first: 400 bad_request, or unsupported_version", () => {
  const f = fixture();
  const fetch = f.pair("phone-a")("fetch");
  refused(f.gateway.messages({ ...fetch, msg_id: "no spaces" }), 400, "bad_request");
  refused(f.gateway.messages({ ...fetch, v: 2 }), 400, "unsupported_version");
  refused(f.gateway.messages([]), 400, "bad_request");
  const unknownKid = { ...fetch, envelope: { ...fetch.envelope, kid: "nobody" } };
  refused(f.gateway.messages(unknownKid), 403, "unknown_device");
});

test("31 seconds old or ahead is stale, 29 passes, and the clock is logged once a minute", () => {
  const f = fixture();
  const send = f.pair("phone-a");
  const skew = settings.PHONE_CLOCK_SKEW_MS;
  refused(f.gateway.messages(send("fetch", { sentAt: at(START_MS - 31_000) })), 400, "stale");
  refused(f.gateway.messages(send("fetch", { sentAt: at(START_MS + 31_000) })), 400, "stale");
  refused(f.gateway.messages(send("fetch", { sentAt: at(START_MS - 31_000) })), 400, "stale");
  assert.equal(f.gateway.messages(send("fetch", { sentAt: at(START_MS - 29_000) })).status, 200);
  assert.equal(f.gateway.messages(send("fetch", { sentAt: at(START_MS + 29_000) })).status, 200);
  assert.deepEqual(f.lines, [
    `L1 lan-gateway: refused requests from phone-a: its clock is more than ${skew / 1000} s behind`,
  ]);
  f.clock.ms += settings.STALE_LOG_INTERVAL_MS;
  refused(f.gateway.messages(send("fetch", { sentAt: at(f.clock.ms + 40_000) })), 400, "stale");
  assert.equal(f.lines.length, 2);
  assert.match(f.lines[1] ?? "", /from phone-a: its clock is more than 30 s ahead$/);
});

test("a repeated msg_id gets 409 duplicate for 60 seconds, and at most 1,000 are kept", () => {
  const f = fixture();
  const send = f.pair("phone-a");
  const first = send("fetch", { msgId: "m-1" });
  assert.equal(f.gateway.messages(first).status, 200);
  refused(f.gateway.messages(first), 409, "duplicate");
  // Another phone may use the same msg_id.
  assert.equal(f.gateway.messages(f.pair("phone-b")("fetch", { msgId: "m-1" })).status, 200);
  f.clock.ms += settings.PHONE_SEEN_IDS_MS;
  assert.equal(f.gateway.messages(send("fetch", { msgId: "m-1" })).status, 200);
  for (let index = 0; index < settings.PHONE_SEEN_IDS_MAX; index += 1) {
    assert.equal(f.gateway.messages(send("fetch", { msgId: `n-${index}` })).status, 200);
  }
  // m-1 was the oldest of 1,001, so it is forgotten; the newest is still remembered.
  assert.equal(f.gateway.messages(send("fetch", { msgId: "m-1" })).status, 200);
  refused(f.gateway.messages(send("fetch", { msgId: "n-999" })), 409, "duplicate");
});

test("a fetch's after and limit are checked", () => {
  const f = fixture();
  const send = f.pair("phone-a");
  const fetch = (fields: Record<string, unknown>) => f.gateway.messages(send("fetch", { fields }));
  assert.equal(fetch({ after: "r.1.2", limit: 500 }).status, 200);
  refused(fetch({ after: null, limit: 0 }), 400, "bad_request");
  refused(fetch({ after: null, limit: 1.5 }), 400, "bad_request");
  refused(fetch({ after: 3, limit: 10 }), 400, "bad_request");
  refused(fetch({ limit: 10 }), 400, "bad_request");
});

test("unpair removes the phone (202, then 403); later types 501; others 400", async () => {
  const f = fixture();
  const send = f.pair("phone-a");
  refused(await f.gateway.commands(send("laptop_approval")), 501, "not_supported");
  // Step 7 builds live_view_setting, so a gateway without its handler doesn't take it.
  refused(await f.gateway.commands(send("live_view_setting")), 400, "unsupported_type");
  // Without a link to the coordinator, the handoff's types get 503, never 501 or 403.
  for (const type of ["request", "watch_data"]) {
    refused(await f.gateway.commands(send(type)), 503, "coordinator_down");
  }
  for (const type of ["ack", "fetch", "alert", "live_view_request", "zebra"]) {
    refused(await f.gateway.commands(send(type)), 400, "unsupported_type");
  }
  refused(f.gateway.messages(send("unpair")), 400, "unsupported_type");
  const unpaired = await f.gateway.commands(send("unpair"));
  assert.deepEqual(unpaired, { status: 202, body: { v: 1, accepted: true } });
  assert.equal(f.phones.lookup("phone-a").state, "removed");
  refused(f.gateway.messages(send("fetch")), 403, "device_removed");
  refused(await f.gateway.commands(send("unpair")), 403, "device_removed");
});

test("through the relay, a command takes the same switch: handlers, the handoff, and lan_only", async () => {
  const phones = new MemoryDirectory();
  const handled: string[] = [];
  const gateway = new LanGateway({
    homeId: HOME_ID,
    phones,
    now: () => START_MS,
    log: () => undefined,
    handlers: {
      laptop_approval: async (request) => {
        handled.push(`${request.deviceId} ${request.type}`);
        return { status: 202, body: { v: 1, accepted: true } };
      },
    },
  });
  const phoneKey = createSecretKey(randomBytes(32));
  phones.paired.set("phone-r", { role: "caregiver", phoneKey });
  const send = (type: string) =>
    phoneWrapper(phoneKey, {
      homeId: HOME_ID,
      deviceId: "phone-r",
      type,
      sentAt: at(START_MS),
      ...(type === "fetch" ? { fields: FETCH_FIELDS } : {}),
    });
  const approved = await gateway.commands(send("laptop_approval"), "relay");
  assert.deepEqual(approved, { status: 202, body: { v: 1, accepted: true } });
  assert.deepEqual(handled, ["phone-r laptop_approval"]);
  for (const type of ["request", "watch_data"]) {
    refused(await gateway.commands(send(type), "relay"), 503, "coordinator_down");
  }
  refused(await gateway.commands(send("live_view_setting"), "relay"), 400, "unsupported_type");
  for (const type of ["heart_rate", "fetch"]) {
    refused(await gateway.commands(send(type), "relay"), 400, "lan_only");
  }
  assert.deepEqual((await gateway.commands(send("unpair"), "relay")).status, 202);
  assert.equal(phones.lookup("phone-r").state, "removed");
});

test("openPhoneRequest, with no HTTP, gives the plaintext or the same refusals", () => {
  const f = fixture();
  const send = f.pair("phone-a", "resident");
  const fetch = send("fetch", { msgId: "m-1" });
  const opened = f.gateway.openPhoneRequest(fetch);
  assert.ok(opened.ok);
  assert.deepEqual(opened.request, {
    deviceId: "phone-a",
    role: "resident",
    type: "fetch",
    plaintext: { msg_id: "m-1", sent_at: at(START_MS), type: "fetch", ...FETCH_FIELDS },
  });
  const again = f.gateway.openPhoneRequest(fetch);
  assert.ok(!again.ok);
  refused(again.reply, 409, "duplicate");
  const stale = f.gateway.openPhoneRequest(send("unpair", { sentAt: at(START_MS - 60_000) }));
  assert.ok(!stale.ok);
  refused(stale.reply, 400, "stale");
});

test("the routes answer over HTTP, and nothing but device IDs is logged", async (t: TestContext) => {
  const f = fixture();
  f.clock.ms = Date.now();
  const lines: string[] = [];
  const realGateway = new LanGateway({
    homeId: HOME_ID,
    phones: f.phones,
    log: (line) => lines.push(line),
  });
  const side = await startNetworkSide("test-hub-key", realGateway.routes(), 0);
  t.after(() => side.close());
  const send = f.pair("phone-a");
  const post = async (path: string, body: unknown) => {
    const response = await fetch(`http://127.0.0.1:${side.port}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    });
    return { status: response.status, body: (await response.json()) as object };
  };
  assert.equal((await post("/v1/lan/messages", send("fetch"))).status, 200);
  const stale = send("fetch", { sentAt: at(Date.now() - 120_000) });
  refused(await post("/v1/lan/messages", stale), 400, "stale");
  assert.equal((await post("/v1/lan/commands", send("unpair"))).status, 202);
  refused(await post("/v1/lan/messages", send("fetch")), 403, "device_removed");
  assert.equal(lines.length, 2);
  for (const line of lines) {
    assert.match(line, /^L1 lan-gateway: (refused requests from|phone) phone-a[: ]/);
    assert.ok(!line.includes(stale.envelope.c) && !line.includes(stale.msg_id), line);
  }
});
