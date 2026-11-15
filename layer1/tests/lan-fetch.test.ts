import assert from "node:assert/strict";
import { createSecretKey, type KeyObject, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { sealAlert } from "../bridge/src/home-messages.ts";
import { LanGateway, type PhoneDirectory } from "../bridge/src/lan-gateway.ts";
import type { Reply } from "../bridge/src/network-server.ts";
import { Outbox } from "../bridge/src/outbox.ts";
import type { PhoneLookup, PhoneRole } from "../bridge/src/phones.ts";
import type { Wrapper } from "../bridge/src/wire.ts";
import { FETCH_FIELDS, phoneWrapper } from "./fake-phone.ts";
import { openHomeWrapper } from "./home-reader.ts";

const HOME_ID = "7a8e0c4e-5f1d-4c39-9d7e-1b2a3c4d5e6f";
const HOME = { homeId: HOME_ID, homeKey: createSecretKey(randomBytes(32)) };

/** The fetch's answer, as the app decodes it. */
interface Page {
  readonly v: number;
  readonly messages: readonly Wrapper[];
  readonly next: string | null;
  readonly hub: { readonly online: boolean; readonly last_contact_at: string };
}

/** A gateway over a real outbox in a temporary folder, with an in-memory phone list. */
async function fixture(t: TestContext) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "l1-lan-fetch-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const outbox = await Outbox.open(dir);
  const paired = new Map<string, { role: PhoneRole; phoneKey: KeyObject }>();
  const removed = new Set<string>();
  const phones: PhoneDirectory = {
    lookup(deviceId: string): PhoneLookup {
      const phone = paired.get(deviceId);
      if (phone !== undefined) return { state: "paired", ...phone };
      return { state: removed.has(deviceId) ? "removed" : "unknown" };
    },
    async remove(deviceId: string): Promise<void> {
      if (paired.delete(deviceId)) removed.add(deviceId);
    },
  };
  const gateway = new LanGateway({ homeId: HOME_ID, phones, outbox, log: () => undefined });
  /** Pairs a phone; its fetch, built as the app builds it (HomeService.swift), goes to the gateway. */
  const pair = (deviceId: string, role: PhoneRole = "caregiver") => {
    const phoneKey = createSecretKey(randomBytes(32));
    paired.set(deviceId, { role, phoneKey });
    return (fields: Record<string, unknown> = FETCH_FIELDS) =>
      gateway.messages(
        phoneWrapper(phoneKey, { homeId: HOME_ID, deviceId, type: "fetch", fields }),
      );
  };
  const alert = async (title: string) => {
    const fields = {
      alert_id: `a-${title.length}-${randomBytes(4).toString("hex")}`,
      kind: "fall",
      severity: "urgent",
      detected_at: "2026-11-14T03:12:45Z",
      title,
      body: "STUB: a test alert",
      update: false,
    };
    await outbox.append(sealAlert(fields, HOME));
  };
  return { outbox, phones, removed, pair, alert };
}

function page(reply: Reply): Page {
  assert.equal(reply.status, 200);
  return reply.body as Page;
}

test("with an empty outbox, a fetch gets an empty page", async (t) => {
  const f = await fixture(t);
  const body = page(f.pair("phone-a")());
  assert.deepEqual([body.v, body.messages, body.next, body.hub.online], [1, [], null, true]);
});

test("a caregiver's fetch gets the alerts in the app's shape, and the phone opens them with the home key", async (t) => {
  const f = await fixture(t);
  await f.alert("Possible fall");
  await f.alert("Call for help");
  const body = page(f.pair("phone-a")());
  assert.deepEqual(Object.keys(body).sort(), ["hub", "messages", "next", "v"]);
  const titles = body.messages.map(
    (wrapper) => openHomeWrapper(wrapper, HOME.homeKey, HOME_ID).title,
  );
  assert.deepEqual(titles, ["Possible fall", "Call for help"]);
  assert.match(body.next ?? "", /^l\.[A-Za-z0-9_-]{12}\.2$/);
});

test("a resident gets no messages, and next at the newest", async (t) => {
  const f = await fixture(t);
  await f.alert("Possible fall");
  await f.alert("Call for help");
  const body = page(f.pair("phone-r", "resident")());
  assert.deepEqual(body.messages, []);
  assert.equal(body.next, page(f.pair("phone-a")()).next);
});

test("pages with limit 1 follow the cursor; a relay cursor starts at the oldest", async (t) => {
  const f = await fixture(t);
  await f.alert("one");
  await f.alert("two");
  const fetch = f.pair("phone-a");
  const first = page(fetch({ after: null, limit: 1 }));
  const second = page(fetch({ after: first.next, limit: 1 }));
  const third = page(fetch({ after: second.next, limit: 1 }));
  const title = (body: Page) =>
    body.messages.map((wrapper) => openHomeWrapper(wrapper, HOME.homeKey, HOME_ID).title);
  assert.deepEqual([title(first), title(second), title(third)], [["one"], ["two"], []]);
  assert.equal(third.next, second.next);
  assert.deepEqual(title(page(fetch({ after: "r.42", limit: 50 }))), ["one", "two"]);
});

test("a bad after or limit gets 400, never 403; an unknown or removed phone gets 403 with an alert waiting", async (t) => {
  const f = await fixture(t);
  await f.alert("Possible fall");
  const fetch = f.pair("phone-a");
  for (const fields of [{ after: 3, limit: 10 }, { after: null, limit: 0 }, { after: null }]) {
    const reply = fetch(fields);
    assert.equal(reply.status, 400, JSON.stringify(fields));
  }
  await f.phones.remove("phone-a");
  const removed = fetch();
  assert.equal(removed.status, 403);
  assert.ok(!JSON.stringify(removed.body).includes("messages"));
  const stranger = f.pair("phone-b");
  f.removed.clear();
  await f.phones.remove("phone-b");
  f.removed.delete("phone-b"); // forgotten entirely, as when the phone list was lost
  assert.equal(stranger().status, 403);
});
