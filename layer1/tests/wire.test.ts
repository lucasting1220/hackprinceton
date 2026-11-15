import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import type { Envelope } from "../bridge/src/phone-crypto.ts";
import { parseWrapper, utcSeconds, type Wrapper, type WrapperField } from "../bridge/src/wire.ts";

type Vector = Readonly<{ name: string; type: string; plaintext: string; envelope: Envelope }>;
const vectorsFile = path.join(import.meta.dirname, "..", "contracts", "vectors.json");
const vectors: unknown = JSON.parse(await readFile(vectorsFile, { encoding: "utf8" }));
const { envelopes } = vectors as { readonly envelopes: readonly Vector[] };

/** A JSON body as the bridge reads it, so a field set to undefined is a missing field. */
const json = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

/** A vector's envelope wrapped as HomeService.swift's lanRequest wraps it, keys sorted. */
function appWrapper({ type, plaintext, envelope }: Vector): unknown {
  const { msg_id, sent_at } = JSON.parse(plaintext) as Readonly<Record<string, unknown>>;
  return json({ envelope, msg_id, sent_at, type, v: 1 });
}

const alert = envelopes.find(({ type }) => type === "alert");
assert.ok(alert, "contracts/vectors.json has an alert envelope");
const base = appWrapper(alert) as Wrapper;
const env = (change: object) => ({ ...base, envelope: { ...base.envelope, ...change } });
const b64 = (bytes: number) => Buffer.alloc(bytes, 1).toString("base64url");
// A zone that isn't UTC, so a time written in local time can't pass for UTC on any machine.
Object.assign(process.env, { TZ: "Asia/Kolkata" });

test("parseWrapper parses each vector envelope, wrapped the way the app wraps it", () => {
  assert.ok(envelopes.length > 0);
  for (const vector of envelopes) {
    const sent = appWrapper(vector);
    assert.deepEqual(parseWrapper(sent), { ok: true, wrapper: sent }, vector.name);
  }
});

test("parseWrapper accepts each edge, keeps to and collapse_id, and drops unknown fields", () => {
  const edges: Wrapper[] = [
    { ...base, msg_id: "A-z_0.9".padEnd(64, "x") },
    { ...base, type: "a".repeat(32) },
    { ...base, sent_at: "2024-02-29T23:59:59Z" },
    { ...base, sent_at: "2026-11-14T15:12:04.5Z" },
    { ...base, sent_at: "2026-11-14T15:12:04.123456789Z" },
    { ...base, sent_at: utcSeconds(new Date()) },
    { ...base, to: "0f9e8d7c-6b5a-4938-8271-605f4e3d2c1b", collapse_id: "\u{E9}".repeat(32) },
    env({ c: b64(16) }),
  ];
  for (const sent of edges) assert.deepEqual(parseWrapper(sent), { ok: true, wrapper: sent });
  assert.deepEqual(parseWrapper({ ...env({ extra: 1 }), extra: 1 }), { ok: true, wrapper: base });
});

test("parseWrapper refuses each broken rule, naming the field and never its value", () => {
  const refusals: (readonly [string, unknown, WrapperField, "unsupported_version"?])[] = [
    ["a string", "wrapper", "wrapper"],
    ["an array", [base], "wrapper"],
    ["a null envelope", { ...base, envelope: null }, "envelope"],
    ["no v", { ...base, v: undefined }, "v"],
    ["no msg_id", { ...base, msg_id: undefined }, "msg_id"],
    ["no type", { ...base, type: undefined }, "type"],
    ["no sent_at", { ...base, sent_at: undefined }, "sent_at"],
    ["no envelope", { ...base, envelope: undefined }, "envelope"],
    ["no envelope.v", env({ v: undefined }), "envelope.v"],
    ["no kid", env({ kid: undefined }), "envelope.kid"],
    ["no n", env({ n: undefined }), "envelope.n"],
    ["no c", env({ c: undefined }), "envelope.c"],
    ["v 0", { ...base, v: 0 }, "v"],
    ["v as a string", { ...base, v: "1" }, "v"],
    ["envelope.v as a string", env({ v: "1" }), "envelope.v"],
    ["a newer v", { ...base, v: 2 }, "v", "unsupported_version"],
    ["a newer v with no msg_id", { ...base, v: 2, msg_id: undefined }, "v", "unsupported_version"],
    ["a newer envelope.v", env({ v: 2 }), "envelope.v", "unsupported_version"],
    ["v 2 with a 24-byte n", env({ v: 2, n: b64(24) }), "envelope.v", "unsupported_version"],
    ["an empty msg_id", { ...base, msg_id: "" }, "msg_id"],
    ["a 65-character msg_id", { ...base, msg_id: "m".repeat(65) }, "msg_id"],
    ["a msg_id with a slash", { ...base, msg_id: "m/1" }, "msg_id"],
    ["a msg_id with a backslash", { ...base, msg_id: "m\\1" }, "msg_id"],
    ["a msg_id with a newline", { ...base, msg_id: "m1\nm2" }, "msg_id"],
    ["a kid with a space", env({ kid: "home key" }), "envelope.kid"],
    ["a to with a colon", { ...base, to: "device:1" }, "to"],
    ["a type with a capital", { ...base, type: "Alert" }, "type"],
    ["a type that starts with a digit", { ...base, type: "1alert" }, "type"],
    ["a type with a hyphen", { ...base, type: "care-status" }, "type"],
    ["a type with a newline", { ...base, type: "alert\nx" }, "type"],
    ["a 33-character type", { ...base, type: "a".repeat(33) }, "type"],
    ["sent_at at +00:00", { ...base, sent_at: "2026-11-14T15:12:04+00:00" }, "sent_at"],
    ["sent_at in another zone", { ...base, sent_at: "2026-11-14T10:12:04-05:00" }, "sent_at"],
    ["sent_at without a zone", { ...base, sent_at: "2026-11-14T15:12:04" }, "sent_at"],
    ["sent_at with a lowercase z", { ...base, sent_at: "2026-11-14T15:12:04z" }, "sent_at"],
    ["sent_at on two lines", { ...base, sent_at: `${base.sent_at}\n${base.sent_at}` }, "sent_at"],
    ["an empty fraction", { ...base, sent_at: "2026-11-14T15:12:04.Z" }, "sent_at"],
    ["a letter in the fraction", { ...base, sent_at: "2026-11-14T15:12:04.5aZ" }, "sent_at"],
    ["a comma before the fraction", { ...base, sent_at: "2026-11-14T15:12:04,5Z" }, "sent_at"],
    ["sent_at on February 30", { ...base, sent_at: "2026-02-30T15:12:04Z" }, "sent_at"],
    ["sent_at at second 60", { ...base, sent_at: "2026-11-14T23:59:60Z" }, "sent_at"],
    ["a heartbeat's collapse_id", { ...base, type: "heartbeat", collapse_id: "a1" }, "collapse_id"],
    ["a reply's collapse_id", { ...base, type: "reply", collapse_id: "a1" }, "collapse_id"],
    ["a 65-byte collapse_id", { ...base, collapse_id: "a".repeat(65) }, "collapse_id"],
    ["66 bytes in 33 characters", { ...base, collapse_id: "\u{E9}".repeat(33) }, "collapse_id"],
    ["a lone surrogate in collapse_id", { ...base, collapse_id: "a\u{D800}" }, "collapse_id"],
    ["a null collapse_id", { ...base, collapse_id: null }, "collapse_id"],
    ["an 11-byte n", env({ n: b64(11) }), "envelope.n"],
    ["a 13-byte n", env({ n: b64(13) }), "envelope.n"],
    ["an n outside base64url", env({ n: `${b64(12)}$` }), "envelope.n"],
    ["a 15-byte c", env({ c: b64(15) }), "envelope.c"],
    ["a c outside base64url", env({ c: `${b64(16)}$` }), "envelope.c"],
  ];
  for (const [label, sent, field, code = "bad_request"] of refusals) {
    assert.deepEqual(parseWrapper(json(sent)), { ok: false, code, field }, label);
  }
});

test("utcSeconds writes UTC to the whole second with Z", () => {
  const date = new Date(Date.UTC(2026, 10, 14, 15, 10, 0, 999));
  assert.equal(utcSeconds(date), "2026-11-14T15:10:00Z");
});
