import assert from "node:assert/strict";
import { createSecretKey } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { fromBase64url, KEY_BYTES, open } from "../bridge/src/phone-crypto.ts";
import {
  encodeFrame,
  type FrameRefusal,
  type ParsedFrame,
  parseHubFrame,
  parseRelayFrame,
} from "../bridge/src/relay-protocol.ts";
import { layer1 } from "./layer1-files.ts";

type Json = Readonly<Record<string, unknown>>;

/** A field of a JSON object, read by name. */
function get(value: unknown, name: string): unknown {
  assert.ok(typeof value === "object" && value !== null);
  return Object.getOwnPropertyDescriptor(value, name)?.value;
}

const readJson = async (name: string): Promise<Json> =>
  JSON.parse(await readFile(path.join(layer1, "contracts", name), { encoding: "utf8" }));

const example = await readJson("hub-relay-messages.json");
const frames = get(example, "frames") as readonly Json[];
const vectors = await readJson("vectors.json");

const HUB_TYPES = ["phones", "deliver", "command_result"];
const RELAY_TYPES = ["welcome", "ack", "nack", "command", "phone_unpaired"];

/** The example frame of a type, changed by `change`, as text. */
function frame(type: string, change: Json = {}): string {
  const found = frames.find((one) => get(one, "type") === type);
  assert.ok(found, `hub-relay-messages.json has a ${type} frame`);
  return JSON.stringify({ ...found, ...change });
}

function refusal(parsed: ParsedFrame<unknown>): FrameRefusal {
  assert.equal(parsed.ok, false);
  return parsed as FrameRefusal;
}

describe("contracts/hub-relay-messages.json", () => {
  test("holds schema_version 1 and an example of every frame", () => {
    assert.equal(get(example, "schema_version"), 1);
    const types = new Set(frames.map((one) => get(one, "type")));
    assert.deepEqual([...types].sort(), [...HUB_TYPES, ...RELAY_TYPES].sort());
  });

  test("each frame parses on its side and re-encodes to exactly its fields", () => {
    for (const one of frames) {
      const text = JSON.stringify(one);
      const hubSide = HUB_TYPES.includes(String(get(one, "type")));
      const parsed = hubSide ? parseHubFrame(text) : parseRelayFrame(text);
      assert.ok(parsed.ok, `${String(get(one, "type"))}: ${JSON.stringify(parsed)}`);
      assert.deepEqual(JSON.parse(encodeFrame(parsed.frame)), one);
    }
  });

  test("the deliver example is the alert vector, and the command opens with its phone's key", () => {
    const envelopes = get(vectors, "envelopes") as readonly Json[];
    const alert = envelopes.find((one) => get(one, "name") === "alert-home-key");
    const deliver = JSON.parse(frame("deliver")) as { wrapper: Json };
    assert.deepEqual(get(deliver.wrapper, "envelope"), get(alert, "envelope"));
    const pairing = (get(vectors, "pairing") as readonly Json[])[0];
    const key = createSecretKey(fromBase64url(String(get(pairing, "phone_key")), KEY_BYTES));
    const command = JSON.parse(frame("command")) as { wrapper: { envelope: never; type: string } };
    const label = { homeId: String(get(alert, "home_id")), type: command.wrapper.type };
    const plaintext = JSON.parse(open(command.wrapper.envelope, key, label).toString("utf8"));
    assert.equal(plaintext.type, "unpair");
  });
});

describe("relay-protocol: refusals", () => {
  test("text that isn't a JSON object, and a missing type, are refused by field", () => {
    for (const text of ["", "{", "[]", "null", '"phones"']) {
      assert.equal(refusal(parseHubFrame(text)).field, "frame");
    }
    assert.equal(refusal(parseHubFrame('{"v":1}')).field, "type");
  });

  test("another side's type, an unknown type and a newer v are unknown, so they're ignored", () => {
    for (const text of [frame("welcome"), frame("deliver", { type: "later_type" })]) {
      const parsed = refusal(parseHubFrame(text));
      assert.equal(parsed.known, false);
    }
    assert.equal(refusal(parseHubFrame(frame("phones", { v: 2 }))).known, false);
    assert.equal(refusal(parseRelayFrame(frame("deliver"))).known, false);
    const missing = refusal(parseHubFrame(frame("phones", { v: undefined })));
    assert.deepEqual([missing.known, missing.field], [true, "v"]);
  });

  test("a deliver with a bad wrapper names the field and keeps a readable msg_id for its nack", () => {
    const deliver = JSON.parse(frame("deliver")) as { wrapper: Json };
    const bad = refusal(
      parseHubFrame(frame("deliver", { wrapper: { ...deliver.wrapper, sent_at: "yesterday" } })),
    );
    assert.deepEqual([bad.type, bad.field, bad.msgId], ["deliver", "wrapper.sent_at", "m1"]);
    const noId = refusal(
      parseHubFrame(frame("deliver", { wrapper: { ...deliver.wrapper, msg_id: "a b" } })),
    );
    assert.deepEqual([noId.field, noId.msgId], ["wrapper.msg_id", undefined]);
  });

  test("phone entries: a removed one keeps only its ID; a bad role or hash is refused", () => {
    const listed = (phones: unknown) => parseHubFrame(frame("phones", { phones }));
    const removed = listed([{ device_id: "d1", removed: true, role: "caregiver", extra: 1 }]);
    assert.ok(removed.ok);
    assert.deepEqual(removed.frame, {
      type: "phones",
      v: 1,
      phones: [{ device_id: "d1", removed: true }],
    });
    const good = { device_id: "d2", role: "resident", credential_sha256: "a".repeat(64) };
    assert.ok(listed([{ ...good, removed: false }]).ok);
    const cases: Array<[unknown, string]> = [
      [{ ...good, role: "admin", removed: false }, "phones.role"],
      [{ ...good, credential_sha256: "A".repeat(64), removed: false }, "phones.credential_sha256"],
      [{ ...good, removed: "no" }, "phones.removed"],
      [{ ...good, device_id: "", removed: false }, "device_id"],
    ];
    for (const [entry, field] of cases) assert.equal(refusal(listed([entry])).field, field);
    assert.equal(refusal(listed("all")).field, "phones");
  });

  test("command_result: 202 carries a null code, an error status 400 to 599 carries a code", () => {
    const result = (status: unknown, code: unknown) =>
      parseHubFrame(frame("command_result", { status, code }));
    assert.ok(result(202, null).ok);
    assert.ok(result(501, "not_supported").ok);
    const cases: Array<[unknown, unknown, string]> = [
      [202, "accepted", "code"],
      [400, null, "code"],
      [400, "Bad Thing", "code"],
      [200, null, "status"],
      [302, "moved", "status"],
      [600, "huge", "status"],
      [400.5, "stale", "status"],
      ["400", "stale", "status"],
    ];
    for (const [status, code, field] of cases) {
      assert.equal(refusal(result(status, code)).field, field, `${String(status)} ${String(code)}`);
    }
  });

  test("relay frames: a bad nack error, revoked list or command sender is refused", () => {
    const cases: Array<[string, Json, string]> = [
      ["nack", { error: "disk_full" }, "error"],
      ["welcome", { revoked: ["ok", 3] }, "revoked"],
      ["welcome", { home_id: null }, "home_id"],
      ["command", { from: "x".repeat(65) }, "from"],
      ["phone_unpaired", { device_id: 7 }, "device_id"],
    ];
    for (const [type, change, field] of cases) {
      assert.equal(refusal(parseRelayFrame(frame(type, change))).field, field, type);
    }
  });

  test("unknown fields are dropped", () => {
    const parsed = parseRelayFrame(frame("ack", { secret: "x" }));
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.frame, { type: "ack", v: 1, msg_id: "m1" });
  });
});
