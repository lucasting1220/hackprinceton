import assert from "node:assert/strict";
import { createSecretKey, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  type AlertFields,
  canonicalJson,
  sealAlert,
  sealCareStatus,
  sealHeartbeat,
} from "../bridge/src/home-messages.ts";
import { fromBase64url, open, PhoneCryptoRefusal } from "../bridge/src/phone-crypto.ts";
import { openHomeWrapper } from "./home-reader.ts";

interface EnvelopeVector {
  readonly name: string;
  readonly key: string;
  readonly nonce: string;
  readonly home_id: string;
  readonly plaintext: string;
  readonly envelope: Readonly<{ v: number; kid: string; n: string; c: string }>;
}

const vectorsFile = path.join(import.meta.dirname, "..", "contracts", "vectors.json");
const { envelopes } = JSON.parse(await readFile(vectorsFile, { encoding: "utf8" })) as {
  envelopes: readonly EnvelopeVector[];
};

function vector(name: string): EnvelopeVector {
  const found = envelopes.find((item) => item.name === name);
  assert.ok(found !== undefined, `contracts/vectors.json has no ${name}`);
  return found;
}

const HOME = {
  homeId: "7a8e0c4e-5f1d-4c39-9d7e-1b2a3c4d5e6f",
  homeKey: createSecretKey(randomBytes(32)),
};

const ALERT: AlertFields = {
  alert_id: "3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b",
  kind: "fall",
  severity: "urgent",
  detected_at: "2026-11-14T03:12:45Z",
  title: "Possible fall",
  body: "Possible fall detected at 3:12 AM",
  update: false,
};

test("an alert seals byte for byte as the app's alert-home-key vector", () => {
  const v = vector("alert-home-key");
  const fields = JSON.parse(v.plaintext) as Record<string, unknown>;
  const { msg_id, sent_at, type, ...alert } = fields;
  assert.equal(type, "alert");
  const home = { homeId: v.home_id, homeKey: createSecretKey(fromBase64url(v.key, 32)) };
  const choices = {
    msgId: String(msg_id),
    sentAt: new Date(String(sent_at)),
    nonce: fromBase64url(v.nonce, 12),
  };
  const wrapper = sealAlert(alert as AlertFields, home, choices);
  assert.equal(canonicalJson(fields), v.plaintext);
  assert.deepEqual(wrapper.envelope, v.envelope);
  assert.deepEqual(wrapper, {
    v: 1,
    msg_id: "m1",
    type: "alert",
    sent_at: "2026-11-14T15:12:04Z",
    collapse_id: "a1",
    envelope: v.envelope,
  });
});

test("the heartbeat seals byte for byte as the app's heartbeat-home-key vector", () => {
  const v = vector("heartbeat-home-key");
  const { msg_id, sent_at } = JSON.parse(v.plaintext) as Record<string, string>;
  const home = { homeId: v.home_id, homeKey: createSecretKey(fromBase64url(v.key, 32)) };
  const choices = {
    msgId: msg_id ?? "",
    sentAt: new Date(sent_at ?? ""),
    nonce: fromBase64url(v.nonce, 12),
  };
  const wrapper = sealHeartbeat(home, choices);
  assert.deepEqual(wrapper.envelope, v.envelope);
  assert.equal(wrapper.collapse_id, undefined);
});

test("the wrapper carries the plaintext's msg_id, type and sent_at, and collapse_id is the alert_id", () => {
  const wrapper = sealAlert(ALERT, HOME);
  assert.equal(wrapper.collapse_id, ALERT.alert_id);
  assert.match(wrapper.msg_id, /^[0-9a-f-]{36}$/);
  assert.match(wrapper.sent_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  const plaintext = openHomeWrapper(wrapper, HOME.homeKey, HOME.homeId);
  assert.deepEqual(plaintext, {
    ...ALERT,
    msg_id: wrapper.msg_id,
    sent_at: wrapper.sent_at,
    type: "alert",
  });
});

test("an alert doesn't open as care_status or for another home", () => {
  const { envelope } = sealAlert(ALERT, HOME);
  for (const label of [
    { homeId: HOME.homeId, type: "care_status" },
    { homeId: "another-home", type: "alert" },
  ]) {
    assert.throws(() => open(envelope, HOME.homeKey, label), PhoneCryptoRefusal);
  }
});

test("two seals of one alert use different nonces and msg_ids", () => {
  const [first, second] = [sealAlert(ALERT, HOME), sealAlert(ALERT, HOME)];
  assert.notEqual(first.envelope.n, second.envelope.n);
  assert.notEqual(first.msg_id, second.msg_id);
});

test("care_status carries its fields, and no field replaces msg_id, sent_at or type", () => {
  const wrapper = sealCareStatus({ status: "ok", type: "alert", msg_id: "forged" }, HOME);
  assert.equal(wrapper.type, "care_status");
  assert.equal(wrapper.collapse_id, undefined);
  const plaintext = openHomeWrapper(wrapper, HOME.homeKey, HOME.homeId);
  assert.deepEqual(plaintext, {
    status: "ok",
    msg_id: wrapper.msg_id,
    sent_at: wrapper.sent_at,
    type: "care_status",
  });
});
