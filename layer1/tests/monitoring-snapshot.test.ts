import assert from "node:assert/strict";
import { createSecretKey, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { describe, type TestContext, test } from "node:test";
import { sealMonitoring } from "../bridge/src/home-messages.ts";
import { type ApiStateRead, readApiState } from "../bridge/src/live-view-hub.ts";
import {
  type MonitoringFields,
  MonitoringSnapshots,
  monitoringFields,
  ollamaAnswers,
  parseApiState,
} from "../bridge/src/monitoring-snapshot.ts";
import * as settings from "../bridge/src/settings.ts";
import { openHomeWrapper } from "./home-reader.ts";

const contractFile = path.join(import.meta.dirname, "..", "..", "contracts", "api-state.json");
const example: unknown = JSON.parse(await readFile(contractFile, "utf8"));
/** The example's laptop reported at 03:12:44; one second later it is reporting. */
const NOW = Date.parse("2026-11-14T03:12:45Z");
const LIMIT_MS = settings.MONITORING_REPORTING_LIMIT_S * 1000;

type Laptop = Readonly<{
  node_id: string;
  display_name?: string;
  last_status_at?: string;
  sensors: readonly string[];
}>;
type Job = Readonly<{ job: string; node_id: string; state: string }>;

function apiState(
  laptops: readonly Laptop[],
  jobs: readonly Job[],
  dropped: readonly string[] = [],
): unknown {
  return {
    schema_version: 1,
    updated_at: "2026-11-14T03:12:45Z",
    laptops: laptops.map((laptop) => ({ display_name: laptop.node_id, missing: [], ...laptop })),
    jobs,
    dropped: dropped.map((work) => ({ work, reason: "not enough memory" })),
  };
}

function fields(body: unknown, now = NOW, languageModel = true): MonitoringFields {
  const parsed = parseApiState(body);
  assert.ok(parsed !== undefined);
  return monitoringFields(parsed, now, languageModel);
}

const KITCHEN: Laptop = {
  node_id: "node-a",
  display_name: "Kitchen laptop",
  last_status_at: "2026-11-14T03:12:44.512345Z",
  sensors: ["camera", "mic"],
};
const DEN: Laptop = {
  node_id: "node-b",
  display_name: "Den laptop",
  last_status_at: "2026-11-14T03:12:43Z",
  sensors: [],
};
const RUNNING: readonly Job[] = [
  { job: "capture", node_id: "node-a", state: "running" },
  { job: "fall_model", node_id: "node-b", state: "running" },
  { job: "speech_to_text", node_id: "node-b", state: "running" },
];

describe("monitoring snapshot: the mapping from /api/state", () => {
  test("the contract example: reporting laptop, fall running, but no capture job, so degraded", () => {
    assert.deepEqual(fields(example), {
      state: "degraded",
      laptops: [
        {
          node_id: "node-uuid",
          display_name: "Kitchen laptop",
          reporting: true,
          last_status_at: "2026-11-14T03:12:44Z",
        },
      ],
      camera: "down",
      mic: "down",
      fall_detection: "running",
      sound_detection: "unplaced",
      language_model_available: true,
    });
  });

  test("every laptop reporting, capture and both detections running is ok", () => {
    const snapshot = fields(apiState([KITCHEN, DEN], RUNNING));
    assert.equal(snapshot.state, "ok");
    assert.deepEqual(
      [snapshot.camera, snapshot.mic, snapshot.fall_detection, snapshot.sound_detection],
      ["up", "up", "running", "running"],
    );
    assert.deepEqual(
      snapshot.laptops.map((laptop) => [laptop.node_id, laptop.reporting, laptop.last_status_at]),
      [
        ["node-a", true, "2026-11-14T03:12:44Z"],
        ["node-b", true, "2026-11-14T03:12:43Z"],
      ],
    );
  });

  test("a laptop gone quiet is not reporting, and its camera and jobs no longer count", () => {
    const now = Date.parse("2026-11-14T03:12:43Z") + LIMIT_MS + 1;
    const snapshot = fields(apiState([KITCHEN, DEN], RUNNING), now);
    assert.deepEqual(
      snapshot.laptops.map((laptop) => laptop.reporting),
      [true, false],
    );
    assert.equal(snapshot.state, "degraded");
    assert.equal(snapshot.camera, "up");
    assert.equal(snapshot.fall_detection, "stopped");
    const atLimit = fields(apiState([DEN], []), Date.parse("2026-11-14T03:12:43Z") + LIMIT_MS);
    assert.equal(atLimit.laptops[0]?.reporting, true);
    const camQuiet = fields(
      apiState([KITCHEN], RUNNING),
      Date.parse(KITCHEN.last_status_at ?? "") + LIMIT_MS + 1,
    );
    assert.deepEqual([camQuiet.camera, camQuiet.mic], ["down", "down"]);
  });

  test("a camera whose capture job isn't running is down; a home with no camera has none", () => {
    const restarting = RUNNING.map((job) =>
      job.job === "capture" ? { ...job, state: "restarting" } : job,
    );
    const snapshot = fields(apiState([KITCHEN, DEN], restarting));
    assert.deepEqual([snapshot.camera, snapshot.mic, snapshot.state], ["down", "down", "degraded"]);
    const elsewhere = RUNNING.map((job) =>
      job.job === "capture" ? { ...job, node_id: "node-b" } : job,
    );
    assert.equal(fields(apiState([KITCHEN, DEN], elsewhere)).camera, "down");
    const noSensors = fields(apiState([DEN], RUNNING));
    assert.deepEqual(
      [noSensors.camera, noSensors.mic, noSensors.state],
      ["none", "none", "degraded"],
    );
    const micOnly = fields(apiState([{ ...KITCHEN, sensors: ["mic"] }, DEN], RUNNING));
    assert.deepEqual([micOnly.camera, micOnly.mic], ["none", "up"]);
  });

  test("fall_model dropped or absent is unplaced; placed but not running is stopped", () => {
    const withoutFall = RUNNING.filter((job) => job.job !== "fall_model");
    const dropped = fields(apiState([KITCHEN, DEN], withoutFall, ["fall_model"]));
    assert.deepEqual([dropped.fall_detection, dropped.state], ["unplaced", "degraded"]);
    assert.equal(fields(apiState([KITCHEN, DEN], withoutFall)).fall_detection, "unplaced");
    const starting = RUNNING.map((job) =>
      job.job === "fall_model" ? { ...job, state: "starting" } : job,
    );
    assert.equal(fields(apiState([KITCHEN, DEN], starting)).fall_detection, "stopped");
    const noSound = RUNNING.filter((job) => job.job !== "speech_to_text");
    const sound = fields(apiState([KITCHEN, DEN], noSound, ["speech_to_text"]));
    assert.deepEqual([sound.sound_detection, sound.state], ["unplaced", "ok"]);
  });

  test("no laptops yet is starting, with no camera or mic", () => {
    const snapshot = fields(apiState([], []), NOW, false);
    assert.deepEqual(snapshot, {
      state: "starting",
      laptops: [],
      camera: "none",
      mic: "none",
      fall_detection: "unplaced",
      sound_detection: "unplaced",
      language_model_available: false,
    });
  });

  test("a laptop with no readable status time is not reporting, with last_status_at null", () => {
    const snapshot = fields(apiState([{ node_id: "node-c", sensors: [] }], []));
    assert.deepEqual(snapshot.laptops, [
      { node_id: "node-c", display_name: "node-c", reporting: false, last_status_at: null },
    ]);
  });

  test("a body without a laptops list is not a state", () => {
    for (const body of [null, [], {}, { laptops: "none" }]) {
      assert.equal(parseApiState(body), undefined);
    }
  });
});

/** An HTTP server on 127.0.0.1 that answers every request with `handle`, closed after the test. */
async function server(t: TestContext, handle: Parameters<typeof createServer>[1]): Promise<number> {
  const listening: Server = createServer(handle);
  await new Promise<void>((resolve) => listening.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    listening.closeAllConnections();
    listening.close();
  });
  return (listening.address() as AddressInfo).port;
}

/** A port nothing listens on: one a server had, closed again. */
async function closedPort(): Promise<number> {
  const listening = createServer();
  await new Promise<void>((resolve) => listening.listen(0, "127.0.0.1", resolve));
  const { port } = listening.address() as AddressInfo;
  await new Promise<void>((resolve) => listening.close(() => resolve()));
  return port;
}

describe("monitoring snapshot: its sources", () => {
  test("Ollama that answers is available; an error answer or a closed port is not", async (t) => {
    const port = await server(t, (_request, response) => response.end("Ollama is running"));
    assert.equal(await ollamaAnswers(`http://127.0.0.1:${port}`), true);
    const failing = await server(t, (_request, response) => {
      response.statusCode = 500;
      response.end();
    });
    assert.equal(await ollamaAnswers(`http://127.0.0.1:${failing}`), false);
    assert.equal(await ollamaAnswers(`http://127.0.0.1:${await closedPort()}`), false);
  });

  test("readApiState reads the body, and names the status of any other answer", async (t) => {
    const port = await server(t, (_request, response) => {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(example));
    });
    assert.deepEqual(await readApiState(port, 1_000), { ok: true, body: example });
    const failing = await server(t, (_request, response) => {
      response.statusCode = 503;
      response.end();
    });
    assert.deepEqual(await readApiState(failing, 1_000), {
      ok: false,
      reason: "Layer 2's /api/state answered 503",
    });
    const closed = await readApiState(await closedPort(), 1_000);
    assert.equal(closed.ok, false);
  });
});

/** A poller with a fake clock, a fake /api/state and a recorded send. */
function poller(first: ApiStateRead) {
  const clock = { ms: NOW };
  const state = { read: first, languageModel: true, accept: true };
  const sent: MonitoringFields[] = [];
  const lines: string[] = [];
  const snapshots = new MonitoringSnapshots({
    readState: async () => state.read,
    languageModel: async () => state.languageModel,
    send: async (fields) => {
      if (state.accept) sent.push(fields);
      return state.accept;
    },
    now: () => clock.ms,
    log: (line) => lines.push(line),
  });
  return { clock, state, sent, lines, snapshots };
}

/** KITCHEN and DEN both last heard at `at`, with every job running. */
const heardAt = (at: string) =>
  apiState(
    [KITCHEN, DEN].map((laptop) => ({ ...laptop, last_status_at: at })),
    RUNNING,
  );

describe("monitoring snapshot: when it is sent", () => {
  test("sent first, then on a change, and else again only after MONITORING_SNAPSHOT_MAX_S", async () => {
    const { clock, state, sent, snapshots } = poller({
      ok: true,
      body: heardAt("2026-11-14T03:12:44Z"),
    });
    await snapshots.poll();
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.state, "ok");
    clock.ms += 2_000;
    state.read = { ok: true, body: heardAt("2026-11-14T03:12:46Z") };
    await snapshots.poll();
    assert.equal(sent.length, 1, "a newer last_status_at alone is not a change");
    state.languageModel = false;
    await snapshots.poll();
    assert.equal(sent.length, 2, "Ollama going away is a change");
    assert.equal(sent[1]?.language_model_available, false);
    const changedAt = clock.ms;
    clock.ms = changedAt + settings.MONITORING_SNAPSHOT_MAX_S * 1000 - 1;
    state.read = { ok: true, body: heardAt(new Date(clock.ms - 1_000).toISOString()) };
    await snapshots.poll();
    assert.equal(sent.length, 2);
    clock.ms += 1;
    await snapshots.poll();
    assert.equal(sent.length, 3, "an unchanged snapshot is sent again after the most time");
    assert.equal(sent[2]?.laptops[0]?.last_status_at, sent[2]?.laptops[1]?.last_status_at);
  });

  test("a failed read logs once, maps the last body again, and laptops go quiet with time", async () => {
    const { clock, state, sent, lines, snapshots } = poller({
      ok: true,
      body: heardAt("2026-11-14T03:12:44Z"),
    });
    await snapshots.poll();
    state.read = { ok: false, reason: "can't read Layer 2's /api/state (ECONNREFUSED)" };
    for (let i = 0; i < 3; i += 1) {
      clock.ms += 1_000;
      await snapshots.poll();
    }
    assert.equal(sent.length, 1, "nothing changed while the last body is still fresh");
    assert.deepEqual(lines, [
      "L1 monitoring: can't read Layer 2's /api/state (ECONNREFUSED); the snapshot uses the last answer",
    ]);
    clock.ms = Date.parse("2026-11-14T03:12:44Z") + LIMIT_MS + 1;
    await snapshots.poll();
    assert.equal(sent.length, 2);
    assert.equal(sent[1]?.state, "degraded");
    assert.deepEqual(
      sent[1]?.laptops.map((laptop) => laptop.reporting),
      [false, false],
    );
    state.read = { ok: true, body: heardAt(new Date(clock.ms).toISOString()) };
    await snapshots.poll();
    assert.equal(sent.at(-1)?.state, "ok");
    assert.equal(lines.at(-1), "L1 monitoring: reading Layer 2's /api/state again");
    assert.equal(lines.length, 2);
  });

  test("nothing is sent before the first good read; a send that fails is tried on the next poll", async () => {
    const { state, sent, snapshots } = poller({
      ok: false,
      reason: "Layer 2's /api/state answered 503",
    });
    await snapshots.poll();
    state.read = { ok: true, body: { laptops: "none" } };
    await snapshots.poll();
    assert.equal(sent.length, 0);
    state.read = { ok: true, body: heardAt("2026-11-14T03:12:44Z") };
    state.accept = false;
    await snapshots.poll();
    state.accept = true;
    await snapshots.poll();
    assert.equal(sent.length, 1);
  });

  test("start polls at once and stop ends the polling", async (t) => {
    const { sent, snapshots } = poller({ ok: true, body: heardAt("2026-11-14T03:12:44Z") });
    t.after(() => snapshots.stop());
    snapshots.start();
    await snapshots.stop();
    assert.equal(sent.length, 1);
  });
});

describe("monitoring snapshot: the sealed message", () => {
  test("opens with the home key to exactly the app's MonitoringSnapshot fields and values", () => {
    const home = { homeId: "home-1", homeKey: createSecretKey(randomBytes(32)) };
    const sentAt = new Date("2026-11-14T03:12:46Z");
    const { last_status_at: _gone, ...quiet } = DEN;
    const snapshot = fields(apiState([KITCHEN, quiet], RUNNING));
    const wrapper = sealMonitoring(snapshot, home, { sentAt });
    assert.equal(wrapper.type, "monitoring");
    assert.equal(wrapper.collapse_id, undefined);
    assert.equal(wrapper.to, undefined);
    const plaintext = openHomeWrapper(wrapper, home.homeKey, home.homeId);
    const {
      sent_at: sentAtField,
      state,
      camera,
      mic,
      fall_detection: fall,
      sound_detection: sound,
      language_model_available: languageModel,
      laptops,
    } = plaintext;
    assert.deepEqual(Object.keys(plaintext).sort(), [
      "camera",
      "fall_detection",
      "language_model_available",
      "laptops",
      "mic",
      "msg_id",
      "sent_at",
      "sound_detection",
      "state",
      "type",
    ]);
    assert.equal(sentAtField, "2026-11-14T03:12:46Z");
    assert.ok(["ok", "degraded", "starting"].includes(String(state)));
    for (const sensor of [camera, mic]) {
      assert.ok(["up", "down", "declined", "none"].includes(String(sensor)));
    }
    for (const detection of [fall, sound]) {
      assert.ok(["running", "stopped", "unplaced"].includes(String(detection)));
    }
    assert.equal(typeof languageModel, "boolean");
    assert.ok(Array.isArray(laptops));
    assert.deepEqual(laptops, [
      {
        node_id: "node-a",
        display_name: "Kitchen laptop",
        reporting: true,
        last_status_at: "2026-11-14T03:12:44Z",
      },
      { node_id: "node-b", display_name: "Den laptop", reporting: false, last_status_at: null },
    ]);
    assert.equal(state, "degraded");
  });
});
