import assert from "node:assert/strict";
import { createSecretKey, randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import { type TestContext, test } from "node:test";
import type { HomeAlerts } from "../bridge/src/alert-intake.ts";
import { HandoffIntake, parseReport, parseStatus } from "../bridge/src/handoff-intake.ts";
import { Outbox } from "../bridge/src/outbox.ts";
import {
  CoordinatorLink,
  PhoneHandoff,
  PhoneRequests,
  parsePhoneRequest,
  parseWatchData,
} from "../bridge/src/phone-handoff.ts";
import type { PhoneLookup } from "../bridge/src/phones.ts";
import * as settings from "../bridge/src/settings.ts";
import { freePort, makeTempDir } from "./coordinator-fixtures.ts";
import { startCoordinatorInbox } from "./coordinator-inbox.ts";

const paired: PhoneLookup = {
  state: "paired",
  role: "caregiver",
  phoneKey: createSecretKey(randomBytes(32)),
};

test("the coordinator link answers accepted, no_job or unavailable, and gives up at its time limit", async (t: TestContext) => {
  const inbox = await startCoordinatorInbox(t);
  const lines: string[] = [];
  const link = new CoordinatorLink({ port: inbox.port, timeoutMs: 300, log: (l) => lines.push(l) });
  assert.equal(await link.post("/v1/requests", { a: 1 }), "accepted");
  assert.deepEqual(inbox.received.at(-1)?.body, { a: 1 });
  inbox.state.status = 503;
  assert.equal(await link.post("/v1/watch-data", {}), "no_job");
  inbox.state.status = 400;
  assert.equal(await link.post("/v1/requests", {}), "unavailable");
  assert.match(lines.at(-1) ?? "", /answered 400/);
  inbox.state.status = "never";
  const started = Date.now();
  assert.equal(await link.post("/v1/requests", {}), "unavailable");
  assert.ok(Date.now() - started < 3_000);
  assert.match(lines.at(-1) ?? "", /no answer within 300 ms/);
  const nobody = new CoordinatorLink({ port: await freePort(), log: (l) => lines.push(l) });
  assert.equal(await nobody.post("/v1/requests", {}), "unavailable");
});

test("a request ID belongs to the phone that sent it, for the reply window, while it stays paired", () => {
  const clock = { ms: 0 };
  const requests = new PhoneRequests(() => clock.ms);
  let lookup: PhoneLookup = paired;
  assert.ok(requests.remember("r1", "phone-a", () => lookup));
  assert.ok(!requests.remember("r1", "phone-b", () => paired));
  assert.ok(requests.remember("r1", "phone-a", () => lookup));
  const found = requests.askingPhone("r1");
  assert.ok(found.ok);
  assert.equal(found.deviceId, "phone-a");
  lookup = { state: "removed" };
  assert.deepEqual(requests.askingPhone("r1"), {
    ok: false,
    reason: "the phone that asked was removed",
  });
  lookup = paired;
  clock.ms = settings.REQUEST_REPLY_WINDOW_MS + 1;
  assert.equal(requests.askingPhone("r1").ok, false);
  requests.remember("r2", "phone-a", () => paired);
  requests.forget("r2");
  assert.equal(requests.askingPhone("r2").ok, false);
});

test("phone requests and watch data keep only the doc's fields and refuse malformed ones", () => {
  const ask = { request_id: "r1", kind: "ask", text: "How is she?", extra: 1 };
  assert.deepEqual(parsePhoneRequest("d1", ask), {
    request_id: "r1",
    device_id: "d1",
    kind: "ask",
    text: "How is she?",
  });
  assert.ok(parsePhoneRequest("d1", { ...ask, kind: "check_now", text: "" }) !== undefined);
  for (const broken of [
    { ...ask, text: " " },
    { ...ask, kind: "talk" },
    { ...ask, request_id: "has space" },
    { ...ask, text: "x".repeat(settings.REQUEST_TEXT_MAX_CHARS + 1) },
    { request_id: "r1", kind: "ask" },
  ]) {
    assert.equal(parsePhoneRequest("d1", broken), undefined);
  }
  const empty = { heart_rate: [], sleep: [], steps: [] };
  const posted = { schema_version: 1, type: "watch_data", device_id: "d1", ...empty };
  assert.deepEqual(parseWatchData("d1", empty), posted);
  // The device ID is the envelope's; the plaintext can't set it, the type or the version.
  const claimed = { ...empty, device_id: "other", type: "x", schema_version: 9 };
  assert.deepEqual(parseWatchData("d1", claimed), posted);
  for (const broken of [
    { sleep: [], steps: [] },
    { ...empty, heart_rate: [{ measured_at: "2026-11-14T03:12:45+01:00", bpm: 70 }] },
    { ...empty, heart_rate: [{ measured_at: "2026-11-14T03:12:45Z", bpm: -1 }] },
    { ...empty, steps: [{ measured_at: "2026-11-14T03:12:45Z", steps_today: 1.5 }] },
    { ...empty, sleep: [{ night_of: "2026-02-30", asleep_minutes: 1, interruptions: 0 }] },
    { ...empty, heart_rate: [{ measured_at: "1970-01-01T23:59:59Z", bpm: 70 }] },
    { ...empty, steps: [{ measured_at: "2999-12-31T00:00:01Z", steps_today: 1 }] },
    {
      ...empty,
      sleep: [
        {
          night_of: "1970-01-01",
          asleep_minutes: 1,
          bedtime_at: "1970-01-02T00:00:00Z",
          wake_at: "1970-01-02T08:00:00Z",
          interruptions: 0,
        },
      ],
    },
  ]) {
    assert.equal(parseWatchData("d1", broken), undefined);
  }
});

test("a request the coordinator didn't take is forgotten, so the phone may send it again", async (t: TestContext) => {
  const inbox = await startCoordinatorInbox(t);
  inbox.state.status = 503;
  const requests = new PhoneRequests();
  const coordinator = new CoordinatorLink({ port: inbox.port, log: () => undefined });
  const handoff = new PhoneHandoff({ coordinator, requests, log: () => undefined });
  const opened = {
    deviceId: "phone-a",
    role: "caregiver",
    type: "request",
    plaintext: { request_id: "r1", kind: "check_now", text: "" },
  } as const;
  assert.equal((await handoff.forward(opened, () => paired)).status, 503);
  assert.equal(requests.askingPhone("r1").ok, false);
  inbox.state.status = 202;
  assert.equal((await handoff.forward(opened, () => paired)).status, 202);
  assert.equal(requests.askingPhone("r1").ok, true);
});

test("watch data comes from a resident or a caregiver phone, a request only from a caregiver", async (t: TestContext) => {
  const inbox = await startCoordinatorInbox(t);
  const coordinator = new CoordinatorLink({ port: inbox.port, log: () => undefined });
  const handoff = new PhoneHandoff({
    coordinator,
    requests: new PhoneRequests(),
    log: () => undefined,
  });
  const watch = {
    heart_rate: [{ measured_at: "2026-11-14T03:12:45Z", bpm: 72 }],
    sleep: [],
    steps: [{ measured_at: "2026-11-14T03:00:00Z", steps_today: 1834 }],
  };
  for (const role of ["caregiver", "resident"] as const) {
    const deviceId = `${role}-phone`;
    const opened = { deviceId, role, type: "watch_data", plaintext: watch };
    assert.equal((await handoff.forward(opened, () => paired)).status, 202);
    const posted = inbox.received.at(-1);
    assert.equal(posted?.path, "/v1/watch-data");
    assert.deepEqual(posted.body, {
      schema_version: 1,
      type: "watch_data",
      device_id: deviceId,
      ...watch,
    });
  }
  const count = inbox.received.length;
  const ask = { request_id: "r1", kind: "check_now", text: "" };
  const fromResident = {
    deviceId: "resident-phone",
    role: "resident",
    type: "request",
    plaintext: ask,
  } as const;
  const refused = await handoff.forward(fromResident, () => paired);
  assert.equal(refused.status, 400);
  assert.match(JSON.stringify(refused.body), /"unsupported_type"/);
  assert.equal(inbox.received.length, count);
});

test("the intakes reject a broken field by name, answer 503 without a home, and report unlisted fields", async (t: TestContext) => {
  const stateDir = await makeTempDir();
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const lines: string[] = [];
  const home: HomeAlerts = {
    homeId: "home-1",
    homeKey: createSecretKey(randomBytes(32)),
    outbox: await Outbox.open(stateDir, { log: () => undefined }),
  };
  let ready: HomeAlerts | undefined;
  const intake = new HandoffIntake({ ready: () => ready, log: (line) => lines.push(line) });
  assert.deepEqual(
    intake.routes().map((route) => [route.method, route.path, route.guard]),
    [
      ["POST", "/v1/replies", "machine"],
      ["POST", "/v1/reports", "machine"],
      ["POST", "/v1/status", "machine"],
    ],
  );
  const report = { report_id: "rep-1", date: "2026-11-13", title: "Daily report", body: "Calm." };
  const noHome = await intake.accept("/v1/reports", report);
  assert.deepEqual([noHome.status, Reflect.get(noHome.json, "reason")], [503, "no_home"]);
  ready = home;
  const reasons = async (path: "/v1/replies" | "/v1/reports" | "/v1/status", body: unknown) => {
    const answer = await intake.accept(path, body);
    assert.equal(answer.status, 400);
    return Reflect.get(answer.json, "reason");
  };
  assert.equal(await reasons("/v1/reports", []), "report: must be a JSON object");
  assert.equal(
    await reasons("/v1/reports", { ...report, date: "2026-13-01" }),
    "date: must be a date such as 2026-11-14",
  );
  assert.equal(
    await reasons("/v1/reports", { ...report, body: "" }),
    "body: must be 1 to 8000 characters",
  );
  assert.equal(await reasons("/v1/replies", { request_id: "r1", title: "t" }), "body: missing");
  const noHandoff = await intake.accept("/v1/replies", { request_id: "r1", title: "t", body: "b" });
  assert.equal(noHandoff.status, 503);
  const status = {
    activity: null,
    heart_rate: { bpm: 71.5 },
    sleep: null,
    steps: null,
    no_heart_data: false,
  };
  assert.equal(await reasons("/v1/status", status), "heart_rate.bpm: must be a whole number");
  assert.equal(
    await reasons("/v1/status", { ...status, heart_rate: null, steps: 3 }),
    "steps: must be a JSON object or null",
  );
  assert.equal(parseStatus({ ...status, heart_rate: null }).ok, true);
  assert.equal(parseReport({ ...report, report_id: "a b" }).ok, false);

  const accepted = await intake.accept("/v1/reports", {
    ...report,
    schema_version: 1,
    mood: "good",
  });
  assert.equal(accepted.status, 202);
  const shown = intake.section();
  const section = shown === "" ? "" : shown.text;
  assert.match(
    section,
    /Rejected a message from Layer 2 at \/v1\/status: steps: must be a JSON object or null/,
  );
  assert.match(section, /fields the doc doesn&#39;t list: report\.mood/);
  assert.ok(lines.every((line) => !line.includes("Calm.")));
});

test("the outbox keeps only the newest live status, and every other message", async (t: TestContext) => {
  const stateDir = await makeTempDir();
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const outbox = await Outbox.open(stateDir, { log: () => undefined });
  const wrapper = (type: string, n: number) => ({
    v: 1 as const,
    msg_id: `m${n}`,
    type,
    sent_at: "2026-11-14T03:12:45Z",
    envelope: { v: 1, kid: "home", n: "AAAAAAAAAAAAAAAA", c: "AAAAAAAAAAAAAAAAAAAAAA" },
  });
  await outbox.append(wrapper("care_status", 1));
  await outbox.append(wrapper("report", 2));
  await outbox.append(wrapper("care_status", 3));
  await outbox.append(wrapper("report", 4));
  const ids = outbox.page(null, 50, () => true).messages.map((item) => item.msg_id);
  assert.deepEqual(ids, ["m2", "m3", "m4"]);
  const reopened = await Outbox.open(stateDir, { log: () => undefined });
  assert.deepEqual(
    reopened.page(null, 50, () => true).messages.map((item) => item.msg_id),
    ids,
  );
});
