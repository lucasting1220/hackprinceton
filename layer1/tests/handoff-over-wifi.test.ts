import assert from "node:assert/strict";
import { createSecretKey, randomUUID } from "node:crypto";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { type IncomingMessage, request } from "node:http";
import path from "node:path";
import { text } from "node:stream/consumers";
import { type TestContext, test } from "node:test";
import { loadHome } from "../bridge/src/home.ts";
import { startBridge } from "../bridge/src/main.ts";
import { type Envelope, fromBase64url, open } from "../bridge/src/phone-crypto.ts";
import * as settings from "../bridge/src/settings.ts";
import type { Wrapper } from "../bridge/src/wire.ts";
import { freePort, makeTempDir, STUB, waitFor } from "./coordinator-fixtures.ts";
import { startCoordinatorInbox } from "./coordinator-inbox.ts";
import { FakePhone, FETCH_FIELDS, phoneWrapper } from "./fake-phone.ts";
import { openHomeWrapper } from "./home-reader.ts";
import { pageClient } from "./page-client.ts";

const STOP_WAIT_MS = 15_000;

type Answer = {
  status: number;
  body: { error?: unknown; reason?: unknown; bundle?: unknown; messages?: Wrapper[] };
};

/** A JSON POST with no Origin, as Layer 2's Python client and the app both send. */
function postJson(port: number, target: string, body: unknown): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const sent = request(
      {
        host: "127.0.0.1",
        port,
        method: "POST",
        path: target,
        timeout: 5_000,
        headers: { host: `127.0.0.1:${port}`, "content-type": "application/json" },
      },
      (reply: IncomingMessage) => {
        text(reply).then(
          (raw) => resolve({ status: reply.statusCode ?? 0, body: JSON.parse(raw) }),
          reject,
        );
      },
    );
    sent.on("timeout", () => sent.destroy(new Error("no answer"))).on("error", reject);
    sent.end(JSON.stringify(body));
  });
}

const errorCode = (answer: Answer) => Reflect.get(Object(answer.body.error), "code");

test("Layer 4's replies, reports and status reach phones over the LAN, and phones' requests and watch data reach the coordinator", async (t: TestContext) => {
  const [repoRoot, stateDir] = [await makeTempDir(), await makeTempDir()];
  const stub = path.join(repoRoot, ...settings.COORDINATOR_STUB_PATH);
  await mkdir(path.dirname(stub), { recursive: true });
  await copyFile(STUB, stub);
  const inbox = await startCoordinatorInbox(t);
  const ports = {
    listen: settings.COORDINATOR_LISTEN_PORT,
    dashboard: await freePort(),
    client: inbox.port,
  };
  const lines: string[] = [];
  const bridge = await startBridge({
    stateDir,
    repoRoot,
    port: 0,
    homeOptions: { ports },
    open: async () => undefined,
    log: (line) => lines.push(line),
    network: { port: 0, addresses: (port) => [`127.0.0.1:${port}`] },
  });
  t.after(async () => {
    await bridge.stop("the test ended");
    for (const dir of [repoRoot, stateDir]) await rm(dir, { recursive: true, force: true });
  });
  const localPort = Number(new URL(bridge.url).port);

  // No home yet: every intake answers 503 no_home.
  const early = await postJson(localPort, "/v1/reports", {});
  assert.equal(early.status, 400);
  const noHome = await postJson(localPort, "/v1/status", {
    activity: null,
    heart_rate: null,
    sleep: null,
    steps: null,
    no_heart_data: true,
  });
  assert.deepEqual([noHome.status, noHome.body.reason], [503, "no_home"]);

  const page = pageClient(bridge.url);
  assert.equal((await page.post("/home")).statusCode, 200);
  const home = await loadHome(stateDir);
  assert.ok(home !== undefined);
  const state = bridge.phones()?.state();
  assert.ok(state?.on === true);
  const lan = state.port;

  /** Pairs a phone of `role` as step 2 does; its device ID, its own key and its home key. */
  const pair = async (role: "caregiver" | "resident") => {
    assert.equal((await page.post("/pairing/start")).statusCode, 303);
    const payload = bridge.phones()?.state();
    assert.ok(payload?.on === true);
    const qr = payload.pairing.qr();
    assert.ok(qr !== undefined);
    const phone = new FakePhone(qr, { role, name: `${role} phone` });
    assert.equal((await postJson(lan, "/v1/pair", phone.request())).status, 202);
    const pending = (await page.get("/pairing")).page;
    const pendingId = /name="pending_id" value="([^"]+)"/.exec(pending)?.[1] ?? "";
    assert.equal((await page.post("/pairing/confirm", { pending_id: pendingId })).statusCode, 303);
    const collected = await postJson(lan, "/v1/pair", phone.request());
    const bundle = phone.openBundle(collected.body.bundle as Envelope) as {
      device_id: string;
      home_key?: string;
    };
    const send = (type: string, fields: Record<string, unknown>, target = "/v1/lan/commands") =>
      postJson(
        lan,
        target,
        phoneWrapper(phone.key(), {
          homeId: home.homeId,
          deviceId: bundle.device_id,
          type,
          fields,
        }),
      );
    return { deviceId: bundle.device_id, key: phone.key(), homeKey: bundle.home_key, send };
  };
  const caregiver = await pair("caregiver");
  const resident = await pair("resident");
  assert.ok(caregiver.homeKey !== undefined);
  const homeKey = createSecretKey(fromBase64url(caregiver.homeKey, 32));

  // A caregiver's request goes to the coordinator's POST /v1/requests with the doc's four fields.
  const ask = { request_id: randomUUID(), kind: "ask", text: "Did she sleep well?" };
  const asked = await caregiver.send("request", ask);
  assert.deepEqual([asked.status, asked.body], [202, { v: 1, accepted: true }]);
  assert.deepEqual(inbox.received.at(-1), {
    path: "/v1/requests",
    host: `127.0.0.1:${inbox.port}`,
    body: { ...ask, device_id: caregiver.deviceId },
  });

  // A resident's watch data goes to POST /v1/watch-data, each row with only the doc's fields.
  const watch = {
    heart_rate: [{ measured_at: "2026-11-14T03:12:45Z", bpm: 72, source: "watch" }],
    sleep: [
      {
        night_of: "2026-11-13",
        asleep_minutes: 412,
        bedtime_at: "2026-11-13T22:40:00Z",
        wake_at: "2026-11-14T06:10:00Z",
        interruptions: 2,
      },
    ],
    steps: [{ measured_at: "2026-11-14T03:00:00Z", steps_today: 1834 }],
  };
  const watched = await resident.send("watch_data", watch);
  assert.equal(watched.status, 202);
  const [heart] = watch.heart_rate;
  assert.ok(heart !== undefined);
  assert.deepEqual(inbox.received.at(-1)?.body, {
    device_id: resident.deviceId,
    heart_rate: [{ measured_at: heart.measured_at, bpm: heart.bpm }],
    sleep: watch.sleep,
    steps: watch.steps,
  });

  // Each role sends only its own type; a malformed request never reaches the coordinator.
  const count = inbox.received.length;
  assert.equal(errorCode(await caregiver.send("watch_data", watch)), "unsupported_type");
  assert.equal(
    errorCode(await resident.send("request", { ...ask, request_id: "r-2" })),
    "unsupported_type",
  );
  const badKind = await caregiver.send("request", { ...ask, request_id: "r-3", kind: "chat" });
  assert.deepEqual([badKind.status, errorCode(badKind)], [400, "bad_request"]);
  assert.equal(inbox.received.length, count);

  // Layer 4 answers through the coordinator: a reply, a report and two live statuses.
  const reply = {
    type: "reply",
    schema_version: 1,
    request_id: ask.request_id,
    title: "Sleep",
    body: "7 hours.",
  };
  const report = {
    report_id: "rep-1",
    date: "2026-11-13",
    title: "Daily report",
    body: "A calm day.",
  };
  const status = (bpm: number) => ({
    activity: { state: "sitting", at: "2026-11-14T03:12:00Z" },
    heart_rate: { bpm, at: "2026-11-14T03:12:45Z" },
    sleep: null,
    steps: { steps_today: 1834, at: "2026-11-14T03:00:00Z" },
    no_heart_data: false,
  });
  for (const [target, body] of [
    ["/v1/replies", reply],
    ["/v1/reports", report],
    ["/v1/status", status(70)],
    ["/v1/status", status(72)],
  ] as const) {
    const answer = await postJson(localPort, target, body);
    assert.deepEqual([answer.status, answer.body], [202, { type: "accepted", schema_version: 1 }]);
  }
  const unknown = await postJson(localPort, "/v1/replies", { ...reply, request_id: "never-asked" });
  assert.deepEqual(
    [unknown.status, unknown.body.reason],
    [400, `request_id: no phone sent this request since the bridge started`],
  );

  // The caregiver fetches the reply (sealed with its own key, to it alone), the report and the
  // newest status only; the resident gets none of them.
  const fetchFrom = async (who: typeof caregiver) =>
    (await who.send("fetch", FETCH_FIELDS, "/v1/lan/messages")).body.messages ?? [];
  const fetched = await fetchFrom(caregiver);
  assert.deepEqual(
    fetched.map((wrapper) => wrapper.type),
    ["reply", "report", "care_status"],
  );
  const [replyWrapper, reportWrapper, statusWrapper] = fetched;
  assert.ok(
    replyWrapper !== undefined && reportWrapper !== undefined && statusWrapper !== undefined,
  );
  assert.deepEqual(
    [replyWrapper.to, replyWrapper.envelope.kid],
    [caregiver.deviceId, caregiver.deviceId],
  );
  const replyPlain: unknown = JSON.parse(
    open(replyWrapper.envelope, caregiver.key, { homeId: home.homeId, type: "reply" }).toString(
      "utf8",
    ),
  );
  const { type: _replyType, schema_version: _replyVersion, ...replyFields } = reply;
  assert.deepEqual(replyPlain, {
    ...replyFields,
    msg_id: replyWrapper.msg_id,
    sent_at: replyWrapper.sent_at,
    type: "reply",
  });
  assert.deepEqual(openHomeWrapper(reportWrapper, homeKey, home.homeId), {
    ...report,
    msg_id: reportWrapper.msg_id,
    sent_at: reportWrapper.sent_at,
    type: "report",
  });
  assert.deepEqual(openHomeWrapper(statusWrapper, homeKey, home.homeId), {
    ...status(72),
    msg_id: statusWrapper.msg_id,
    sent_at: statusWrapper.sent_at,
    type: "care_status",
  });
  assert.deepEqual(await fetchFrom(resident), []);

  // The coordinator has no job for it: 503 no_job, never 403.
  inbox.state.status = 503;
  const noJob = await caregiver.send("request", {
    ...ask,
    request_id: "r-4",
    kind: "check_now",
    text: "",
  });
  assert.deepEqual([noJob.status, errorCode(noJob)], [503, "no_job"]);
  assert.equal(errorCode(await resident.send("watch_data", watch)), "no_job");

  // The coordinator is down: 503 coordinator_down.
  await inbox.close();
  const down = await caregiver.send("request", { ...ask, request_id: "r-5" });
  assert.deepEqual([down.status, errorCode(down)], [503, "coordinator_down"]);
  assert.equal(errorCode(await resident.send("watch_data", watch)), "coordinator_down");

  // Stopped through its stop file; no log line holds a request's text, a reply or a reading.
  await writeFile(bridge.stopFile, "", "utf8");
  await waitFor(() => lines.includes("L1 bridge: stopped"), STOP_WAIT_MS);
  for (const line of lines) {
    for (const secret of [ask.text, reply.body, report.body, "1834", "sitting"]) {
      assert.ok(!line.includes(secret), line);
    }
  }
});
