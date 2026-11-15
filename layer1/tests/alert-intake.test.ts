import assert from "node:assert/strict";
import { createSecretKey, randomBytes } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { type IncomingMessage, request } from "node:http";
import { text } from "node:stream/consumers";
import { type TestContext, test } from "node:test";
import {
  ALERT_FIELDS,
  type HomeAlerts,
  normalizeUtc,
  parseAlert,
} from "../bridge/src/alert-intake.ts";
import { createHome } from "../bridge/src/home.ts";
import { startNetworkSide } from "../bridge/src/network-server.ts";
import { Outbox } from "../bridge/src/outbox.ts";
import { startSetupServer } from "../bridge/src/setup-server.ts";
import * as settings from "../bridge/src/settings.ts";
import type { Wrapper } from "../bridge/src/wire.ts";
import { makeTempDir } from "./coordinator-fixtures.ts";
import { openHomeWrapper } from "./home-reader.ts";

/** An alert exactly as Layer 4 builds it (layer4/src/layer4/alerts.py, CONTRACT-DRAFTS.md §1). */
const ALERT = {
  type: "alert",
  schema_version: 1,
  alert_id: "6f1c2a8e-3b7d-4f0a-9c55-2e8d1a4b7f90",
  kind: "heart_rate",
  severity: "urgent",
  detected_at: "2026-11-14T03:12:00Z",
  title: "Heart rate alert",
  body: "Heart rate of 142 recorded at 10:12 PM on Nov 13",
  update: false,
} as const;

const everyone = () => true;

/** The setup server for a home, on a free port; without `withHome` its alerts aren't ready. */
async function serve(t: TestContext, withHome = true) {
  const [repoRoot, stateDir] = [await makeTempDir(), await makeTempDir()];
  t.after(async () => {
    await server.close();
    for (const dir of [repoRoot, stateDir]) await rm(dir, { recursive: true, force: true });
  });
  const home = await createHome(stateDir);
  const lines: string[] = [];
  const alerts: HomeAlerts = {
    homeId: home.homeId,
    homeKey: createSecretKey(randomBytes(32)),
    outbox: await Outbox.open(stateDir, { log: (line) => lines.push(line) }),
  };
  const server = await startSetupServer({
    stateDir,
    repoRoot,
    port: 0,
    log: (line) => lines.push(line),
    homeAlerts: () => (withHome ? alerts : undefined),
  });
  const { port } = new URL(server.url);
  /** A request to the local side as Layer 2's Python client sends it: JSON and no Origin. */
  const send = (method: string, body: string, headers: Record<string, string> = {}) =>
    new Promise<
      IncomingMessage & { json: { readonly [field: string]: unknown; reason?: unknown } }
    >((resolve, reject) => {
      const sent = request(
        {
          host: "127.0.0.1",
          port,
          method,
          path: "/v1/alerts",
          timeout: 5_000,
          headers: { host: `127.0.0.1:${port}`, "content-type": "application/json", ...headers },
        },
        (reply) => {
          text(reply).then((raw) => {
            const json =
              reply.headers["content-type"] === "application/json" ? JSON.parse(raw) : {};
            resolve(Object.assign(reply, { json }));
          }, reject);
        },
      );
      sent.on("timeout", () => sent.destroy(new Error("no answer"))).on("error", reject);
      sent.end(body);
    });
  const post = (alert: unknown, headers: Record<string, string> = {}) =>
    send("POST", JSON.stringify(alert), headers);
  const saved = () => alerts.outbox.page(null, 50, everyone).messages;
  return { server, alerts, lines, send, post, saved, port };
}

test("Layer 4's alert gets 202, and the phone's plaintext has its fields, msg_id, sent_at and type", async (t) => {
  const s = await serve(t);
  const reply = await s.post(ALERT);
  assert.equal(reply.statusCode, 202);
  assert.deepEqual(reply.json, { type: "accepted", schema_version: 1 });
  const [wrapper] = s.saved();
  assert.ok(wrapper !== undefined);
  assert.equal(wrapper.collapse_id, ALERT.alert_id);
  const plaintext = openHomeWrapper(wrapper, s.alerts.homeKey, s.alerts.homeId);
  const { type, schema_version, ...fields } = ALERT;
  assert.deepEqual(plaintext, {
    ...fields,
    msg_id: wrapper.msg_id,
    sent_at: wrapper.sent_at,
    type: "alert",
  });
  assert.deepEqual(
    Object.keys(plaintext).sort(),
    [...ALERT_FIELDS.filter((field) => field !== "schema_version"), "msg_id", "sent_at"].sort(),
  );
});

test("each field missing, of the wrong type or breaking its rule gets 400 naming it, and nothing is saved", async (t) => {
  const s = await serve(t);
  const missing = ALERT_FIELDS.map((field): [Record<string, unknown>, string] => {
    const rest: Record<string, unknown> = { ...ALERT };
    delete rest[field];
    return [rest, `${field}: missing`];
  });
  const broken: [Record<string, unknown>, string][] = [
    [{ type: "status" }, "type: must be alert"],
    [{ schema_version: 2 }, "schema_version: must be 1"],
    [{ alert_id: "has space" }, "alert_id: must be an ID of 1 to 64 letters, digits, - or _"],
    [{ alert_id: "a".repeat(65) }, "alert_id: must be an ID of 1 to 64 letters, digits, - or _"],
    [{ alert_id: 7 }, "alert_id: must be an ID of 1 to 64 letters, digits, - or _"],
    [{ kind: "Fall" }, "kind: must be a lowercase word"],
    [{ severity: "" }, "severity: must be a lowercase word"],
    [
      { detected_at: "Nov 14" },
      "detected_at: must be an ISO 8601 time with a zone, such as 2026-11-14T03:12:45Z",
    ],
    [{ title: "" }, "title: must be 1 to 200 characters"],
    [{ title: "x".repeat(201) }, "title: must be 1 to 200 characters"],
    [{ title: 3 }, "title: must be text"],
    [{ title: "lone \ud800 surrogate" }, "title: must be well-formed Unicode"],
    [{ body: "x".repeat(2_001) }, "body: must be 1 to 2000 characters"],
    [{ update: "false" }, "update: must be true or false"],
  ];
  const cases = [
    ...missing,
    ...broken.map(([change, reason]) => [{ ...ALERT, ...change }, reason] as const),
  ];
  for (const [alert, reason] of cases) {
    const reply = await s.post(alert);
    assert.equal(reply.statusCode, 400, reason);
    assert.deepEqual(reply.json, { type: "rejected", schema_version: 1, reason });
  }
  assert.equal((await s.post([ALERT])).json.reason, "alert: must be a JSON object");
  assert.deepEqual(s.saved(), []);
});

test("the text limits count characters, not bytes: 200 emoji pass", async (t) => {
  const s = await serve(t);
  const reply = await s.post({ ...ALERT, title: "👵".repeat(200), body: "é".repeat(2_000) });
  assert.equal(reply.statusCode, 202);
});

test("detected_at becomes UTC whole seconds, the same instant; other forms are refused", () => {
  assert.equal(normalizeUtc("2026-11-14T03:12:45.123456+00:00"), "2026-11-14T03:12:45Z");
  assert.equal(normalizeUtc("2026-11-13T22:12:45-05:00"), "2026-11-14T03:12:45Z");
  assert.equal(normalizeUtc("2026-11-14T03:12:45Z"), "2026-11-14T03:12:45Z");
  for (const value of [
    "2026-11-14 03:12:45Z",
    "2026-11-14T03:12:45",
    "Nov 14",
    "2026-02-30T03:12:45Z",
    "2026-11-14T24:00:00Z",
    "2026-11-14T03:12:45+24:00",
    1_763_090_000,
  ]) {
    assert.equal(normalizeUtc(value), undefined, String(value));
  }
  const parsed = parseAlert({ ...ALERT, detected_at: "2026-11-13T22:12:45.5-05:00" });
  assert.ok(parsed.ok);
  assert.equal(parsed.alert.detected_at, "2026-11-14T03:12:45Z");
});

test("a field the list doesn't name is ignored and reported once, on the page and in the log", async (t) => {
  const s = await serve(t);
  for (const id of ["a-1", "a-2"]) {
    const reply = await s.post({ ...ALERT, alert_id: id, confidence: 0.9 });
    assert.equal(reply.statusCode, 202);
  }
  const [wrapper] = s.saved();
  assert.ok(wrapper !== undefined);
  const plaintext = openHomeWrapper(wrapper, s.alerts.homeKey, s.alerts.homeId);
  assert.equal(plaintext.confidence, undefined);
  const reported = s.lines.filter((line) => line.includes("doesn't list"));
  assert.deepEqual(reported, [
    "L1 alerts: Layer 2 sent a field the contract doesn't list: confidence",
  ]);
  const page = await getPage(s.port);
  assert.match(page, /<h2>Alerts for phones<\/h2>/);
  assert.match(page, /Layer 2 sent fields the contract doesn&#39;t list: confidence/);
});

test("the machine guard: Origin 403, a foreign Host 403, text/plain 415, too large 413, OPTIONS and GET 405", async (t) => {
  const s = await serve(t);
  const body = JSON.stringify(ALERT);
  const origin = await s.send("POST", body, { origin: `http://127.0.0.1:${s.port}` });
  assert.deepEqual([origin.statusCode, origin.json.reason], [403, "origin_not_allowed"]);
  assert.equal((await s.send("POST", body, { host: "rebound.example" })).statusCode, 403);
  const plain = await s.send("POST", body, { "content-type": "text/plain" });
  assert.equal(plain.statusCode, 415);
  const big = JSON.stringify({ ...ALERT, pad: "x".repeat(settings.JSON_REQUEST_MAX_BYTES) });
  assert.equal((await s.send("POST", big)).statusCode, 413);
  assert.equal((await s.send("POST", "{not json")).statusCode, 400);
  for (const method of ["OPTIONS", "GET"]) {
    const reply = await s.send(method, "", { "access-control-request-method": "POST" });
    assert.equal(reply.statusCode, 405, method);
    const cors = Object.keys(reply.headers).filter((name) => name.startsWith("access-control-"));
    assert.deepEqual(cors, [], method);
  }
  assert.deepEqual(s.saved(), []);
});

test("the page's forms still need their token and an Origin, while /v1/alerts refuses any Origin", async (t) => {
  const s = await serve(t);
  const form = { "content-type": "application/x-www-form-urlencoded" };
  const noOrigin = await new Promise<number>((resolve, reject) => {
    const sent = request(
      {
        host: "127.0.0.1",
        port: s.port,
        method: "POST",
        path: "/home",
        headers: form,
        timeout: 5_000,
      },
      (reply) => {
        reply.resume();
        resolve(reply.statusCode ?? 0);
      },
    );
    sent.on("error", reject);
    sent.end("token=wrong");
  });
  assert.equal(noOrigin, 403);
  assert.equal((await s.post(ALERT, { origin: "null" })).statusCode, 403);
  assert.equal((await s.post(ALERT)).statusCode, 202);
});

test("no home gets 503 no_home, and nothing is saved", async (t) => {
  const s = await serve(t, false);
  const reply = await s.post(ALERT);
  assert.equal(reply.statusCode, 503);
  assert.deepEqual(reply.json, { type: "unavailable", schema_version: 1, reason: "no_home" });
  assert.deepEqual(s.saved(), []);
});

test("an outbox that can't be written gets 503 outbox_unwritable, shown on the setup page", async (t) => {
  const s = await serve(t);
  await mkdir(s.alerts.outbox.file);
  const reply = await s.post(ALERT);
  assert.equal(reply.statusCode, 503);
  assert.deepEqual(reply.json, {
    type: "unavailable",
    schema_version: 1,
    reason: "outbox_unwritable",
  });
  assert.match(await getPage(s.port), /Alerts can&#39;t be saved: /);
  await rm(s.alerts.outbox.file, { recursive: true });
  assert.equal((await s.post(ALERT)).statusCode, 202, "a resend after the fix is saved");
  assert.equal(s.saved().length, 1);
});

test("the same alert twice, even at once, is saved once; its update is saved too", async (t) => {
  const s = await serve(t);
  const answers = await Promise.all([s.post(ALERT), s.post(ALERT)]);
  assert.deepEqual(
    answers.map((reply) => reply.statusCode),
    [202, 202],
  );
  assert.equal((await s.post(ALERT)).statusCode, 202);
  assert.equal(s.saved().length, 1);
  const rewrite = { ...ALERT, body: "A rewritten body", update: true };
  assert.equal((await s.post(rewrite)).statusCode, 202);
  const [, update] = s.saved() as Wrapper[];
  assert.ok(update !== undefined);
  const plaintext = openHomeWrapper(update, s.alerts.homeKey, s.alerts.homeId);
  assert.deepEqual(
    [plaintext.alert_id, plaintext.body, plaintext.update],
    [ALERT.alert_id, "A rewritten body", true],
  );
});

test("a retry with the same alert_id and update is the same alert, even if its text differs", async (t) => {
  const s = await serve(t);
  assert.equal((await s.post(ALERT)).statusCode, 202);
  assert.equal((await s.post({ ...ALERT, body: "Text from a second try" })).statusCode, 202);
  assert.equal(s.saved().length, 1);
});

test("logs never hold the title or the body", async (t) => {
  const s = await serve(t);
  await s.post(ALERT);
  await s.post({ ...ALERT, title: "x".repeat(300) });
  await rm(s.alerts.outbox.file);
  await mkdir(s.alerts.outbox.file);
  await s.post({ ...ALERT, alert_id: "other" });
  assert.ok(
    s.lines.some((line) =>
      line.startsWith(
        `L1 alerts: accepted alert ${ALERT.alert_id} (heart_rate, urgent, update false) as message `,
      ),
    ),
  );
  for (const line of s.lines) {
    assert.ok(
      !line.includes(ALERT.title) && !line.includes(ALERT.body) && !line.includes("xxx"),
      line,
    );
  }
});

test("POST /v1/alerts on the network side gets 404", async (t) => {
  const side = await startNetworkSide("test-hub-key", [], 0);
  t.after(() => side.close());
  const response = await fetch(`http://127.0.0.1:${side.port}/v1/alerts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ALERT),
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(response.status, 404);
  await response.body?.cancel();
});

/** The setup page's home page, as a browser gets it. */
function getPage(port: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sent = request(
      {
        host: "127.0.0.1",
        port,
        path: "/",
        headers: { host: `127.0.0.1:${port}` },
        timeout: 5_000,
      },
      (reply) => {
        text(reply).then(resolve, reject);
      },
    );
    sent.on("error", reject);
    sent.end();
  });
}
