import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { sensorName, workerConfig, workerFiles } from "../bridge/src/laptop.ts";
import type { ProgramRunner, RunResult } from "../bridge/src/sensor-check.ts";
import * as settings from "../bridge/src/settings.ts";
import { startSetupServer } from "../bridge/src/setup-server.ts";
import { makeTempDir, waitFor } from "./coordinator-fixtures.ts";
import { pageClient } from "./page-client.ts";

const WORKER_STUB = path.join(import.meta.dirname, "..", "..", ...settings.WORKER_STUB_PATH);
const contract = (name: string) => path.join(import.meta.dirname, "..", "..", "contracts", name);
const CAMERA = "j5 WebCam JVCU100";
const MIC = "Audio Streaming";

test("a typed camera or mic name: trimmed, empty is none, too long or a control character is refused", () => {
  assert.equal(sensorName(`  ${CAMERA} `), CAMERA);
  assert.equal(sensorName("   "), null);
  assert.equal(sensorName("x".repeat(settings.SENSOR_NAME_MAX_CHARS)), "x".repeat(128));
  assert.equal(sensorName("é".repeat(settings.SENSOR_NAME_MAX_CHARS)), "é".repeat(128));
  for (const bad of ["x".repeat(129), "Cam\nera", "Cam\u0000", "Mic\u007f", "Mic\u0085"]) {
    assert.equal(sensorName(bad), undefined, JSON.stringify(bad));
  }
});

/** A laptop that joined a home earlier, in a repository with only the worker stub, its bridge's page resumed. */
async function joinedLaptop(t: TestContext, runProgram: ProgramRunner = noLayer3) {
  const [repoRoot, stateDir] = [await makeTempDir(), await makeTempDir()];
  const stub = path.join(repoRoot, ...settings.WORKER_STUB_PATH);
  await mkdir(path.dirname(stub), { recursive: true });
  await copyFile(WORKER_STUB, stub);
  const files = workerFiles(stateDir);
  const joined = {
    homeId: "home-uuid",
    nodeId: "node-uuid",
    name: "Kitchen laptop",
    hubAddress: "127.0.0.1:9",
    hubPublicKey: "unused",
    coordinatorPort: settings.COORDINATOR_LISTEN_PORT,
    tokenSha256: "unused",
  };
  await mkdir(files.workerStateDir, { recursive: true });
  await writeFile(files.token, "a".repeat(64), "utf8");
  const config = workerConfig(stateDir, joined, new URL("http://127.0.0.1:9"), process.execPath);
  await writeFile(files.config, JSON.stringify(config), "utf8");
  const laptopJson = {
    schema_version: 1,
    home_id: joined.homeId,
    node_id: joined.nodeId,
    display_name: joined.name,
    hub_address: joined.hubAddress,
    hub_public_key: joined.hubPublicKey,
    coordinator_port: joined.coordinatorPort,
    joined_at: "2026-11-14T03:12:45Z",
  };
  await writeFile(files.laptop, JSON.stringify(laptopJson), "utf8");
  const lines: string[] = [];
  const log = (line: string) => lines.push(line);
  const laptop = { findPython: async () => process.execPath, linkReportMs: 60_000, runProgram };
  const server = await startSetupServer({ stateDir, repoRoot, port: 0, log, laptop });
  // close() stops the worker through its stop file.
  t.after(async () => {
    await server.close();
    for (const dir of [repoRoot, stateDir]) await rm(dir, { recursive: true, force: true });
  });
  await server.resumeLaptop();
  const client = pageClient(server.url);
  const deadline = Date.now() + 10_000;
  while (!(await client.get("/join")).page.includes('href="/join/sensors"')) {
    if (Date.now() > deadline) assert.fail("the joined page never showed");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const written = async () =>
    JSON.parse(await readFile(files.config, "utf8")) as Record<string, unknown>;
  const sensors = async () => {
    const { camera, mic } = await written();
    return [camera, mic];
  };
  // The joined page has no form, so the token comes from the camera and mic form.
  const token = /name="token" value="([^"]+)"/.exec((await client.get("/join/sensors")).page)?.[1];
  const post = (fields: Record<string, string>, headers = {}) =>
    client.send(
      "POST",
      "/join/sensors",
      headers,
      new URLSearchParams({ token: token ?? "", ...fields }).toString(),
    );
  return { client, lines, written, sensors, post, files };
}

/** Layer 3 not set up on this laptop: uv can't start it. */
const noLayer3: ProgramRunner = async () => ({ kind: "failed", message: "uv is not installed" });

test("the joined laptop's camera and mic form saves into worker.json and restarts the worker", async (t) => {
  const { client, lines, written, sensors, post } = await joinedLaptop(t);
  const starts = () => lines.filter((line) => line.includes("starting the STUB")).length;
  const form = await client.get("/join/sensors");
  assert.equal(form.statusCode, 200);
  assert.ok(form.page.includes("device list: uv is not installed), so type the names."), form.page);
  assert.ok(!form.page.includes('http-equiv="refresh"'), "the form page reloads");
  assert.ok(form.page.includes(CAMERA) && form.page.includes(MIC), "no example names");
  assert.match(form.page, /<input type="checkbox" name="consent" value="yes">/);

  // Without the page's token, nothing changes.
  const forged = new URLSearchParams({ token: "wrong", camera: CAMERA, mic: MIC, consent: "yes" });
  assert.equal((await client.send("POST", "/join/sensors", {}, forged.toString())).statusCode, 403);
  const noOrigin = { origin: "http://evil.example" };
  const fields = { camera: CAMERA, mic: MIC, consent: "yes" };
  assert.equal((await post(fields, noOrigin)).statusCode, 403);
  assert.deepEqual(await sensors(), [null, null]);

  // With the resident's consent: both names, and the worker restarts.
  const before = starts();
  const saved = await post(fields);
  assert.equal(saved.statusCode, 200);
  assert.ok(saved.page.includes("device check: uv is not installed."), saved.page);
  const config = await written();
  assert.deepEqual(await sensors(), [CAMERA, MIC]);
  await waitFor(() => starts() === before + 1, 10_000);
  assert.ok(lines.some((line) => line.includes("camera and mic saved; restarting the worker")));
  assert.ok((await client.get("/join")).page.includes(`Camera: ${CAMERA}. Mic: ${MIC}.`));
  const example = JSON.parse(await readFile(contract("worker.json"), "utf8")) as object;
  assert.deepEqual(Object.keys(config).sort(), Object.keys(example).sort());
  for (const [field, value] of Object.entries(example)) {
    assert.equal(typeof config[field], typeof value, field);
  }

  // Without consent, both are null, whatever was typed.
  await post({ camera: CAMERA, mic: MIC });
  assert.deepEqual(await sensors(), [null, null]);

  // An empty field means none.
  await post({ camera: "", mic: MIC, consent: "yes" });
  assert.deepEqual(await sensors(), [null, MIC]);

  // Bad names are refused and change nothing; the page shows the current values.
  for (const bad of ["x".repeat(settings.SENSOR_NAME_MAX_CHARS + 1), "Cam\nera", "Cam\u0007"]) {
    const refused = await post({ camera: bad, mic: MIC, consent: "yes" });
    assert.equal(refused.statusCode, 400, JSON.stringify(bad));
    assert.ok(refused.page.includes("at most 128 characters"), refused.page);
    assert.ok(refused.page.includes(`value="${MIC}"`), refused.page);
    assert.deepEqual(await sensors(), [null, MIC]);
  }

  // A name is shown escaped.
  const odd = `<b>"Cam's"</b>`;
  await post({ camera: odd, mic: "", consent: "yes" });
  assert.deepEqual(await sensors(), [odd, null]);
  const shown = (await client.get("/join/sensors")).page;
  assert.ok(!shown.includes(odd), "a name reached the page unescaped");
  assert.ok(shown.includes("&#60;b&#62;&#34;Cam&#39;s&#34;&#60;/b&#62;"), shown);
});

/** Layer 3's capture program, faked: `list` prints `listed`, `check` prints what `checked` gives. */
function fakeLayer3(listed: object, checked: () => RunResult) {
  const calls: { args: readonly string[]; cwd: string; timeoutMs: number }[] = [];
  const run: ProgramRunner = async (file, args, { cwd, timeoutMs }) => {
    assert.equal(file, "uv");
    calls.push({ args, cwd, timeoutMs });
    if (args.includes("list")) {
      return { kind: "exited", code: 0, stdout: `${JSON.stringify(listed)}\n`, lastLine: "" };
    }
    return checked();
  };
  return { run, calls };
}

const deviceCheck = (micResult: string, micMessage: string, fix: string | null) => ({
  schema_version: 1,
  type: "device_check",
  checked_at: "2026-11-15T03:13:02Z",
  ok: micResult === "ok",
  camera: { name: CAMERA, result: "ok", message: "Camera OK", fix: null, similar: [] },
  mic: { name: MIC, result: micResult, message: micMessage, fix, similar: [] },
});

test("Check sensors: pickers from Layer 3's device list, then its device check says Camera OK and Mic OK or why", async (t) => {
  const listed = JSON.parse(await readFile(contract("device-list.json"), "utf8")) as {
    cameras: object[];
    mics: object[];
  };
  listed.cameras.unshift(
    { name: "Generic Camera", kind: "unknown", same_name: false },
    { name: "Twin Cam", kind: "external", same_name: true },
    { name: "Twin Cam", kind: "external", same_name: true },
    { name: "Phone Camera", kind: "continuity", same_name: false },
    { name: "OBS Virtual Camera", kind: "virtual", same_name: false },
  );
  let checkReply: RunResult = {
    kind: "exited",
    code: 0,
    stdout: `${JSON.stringify(deviceCheck("ok", "Mic OK", null))}\n`,
    lastLine: "",
  };
  const layer3 = fakeLayer3(listed, () => checkReply);
  const { client, sensors, post, files, lines } = await joinedLaptop(t, layer3.run);

  const form = (await client.get("/join/sensors")).page;
  const listCall = layer3.calls.find((call) => call.args.includes("list"));
  assert.ok(listCall !== undefined);
  assert.deepEqual(listCall.args.slice(-4), ["-m", "layer3.capture_job", "list", "--json"]);
  assert.equal(listCall.timeoutMs, settings.DEVICE_LIST_TIMEOUT_MS);
  // External first, then unknown; never built-in, Continuity, virtual or a shared name.
  const offered = [...form.matchAll(/<option value="device:([^"]+)">/g)].map((m) => m[1]);
  assert.deepEqual(offered, [CAMERA, "Generic Camera", MIC]);
  assert.ok(form.includes("Two or more cameras are named <strong>Twin Cam</strong>"), form);
  assert.ok(!form.includes(" selected>j5") && form.includes("disabled selected>Choose the camera"));
  assert.ok(form.includes('<input type="checkbox" name="consent" value="yes">'), form);
  assert.ok(!form.includes('name="camera" maxlength'), "the typed fallback was shown");

  // Nothing picked is refused and changes nothing.
  const unpicked = await post({ picked: "yes", consent: "yes" });
  assert.equal(unpicked.statusCode, 400);
  assert.ok(unpicked.page.includes("Choose a camera and a mic"), unpicked.page);
  assert.deepEqual(await sensors(), [null, null]);

  const picks = { picked: "yes", camera: `device:${CAMERA}`, mic: `device:${MIC}`, consent: "yes" };
  const ok = await post(picks);
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(await sensors(), [CAMERA, MIC]);
  const checkCall = layer3.calls.find((call) => call.args.includes("check"));
  assert.ok(checkCall !== undefined);
  assert.deepEqual(checkCall.args.slice(-4), ["check", "--config", files.config, "--json"]);
  assert.equal(checkCall.timeoutMs, settings.DEVICE_CHECK_TIMEOUT_MS);
  assert.ok(ok.page.includes("Camera: <strong>Camera OK</strong>"), ok.page);
  assert.ok(ok.page.includes("Mic: <strong>Mic OK</strong>"), ok.page);
  assert.ok(ok.page.includes("Saved and checked."), ok.page);
  assert.ok(lines.includes("L1 laptop: Layer 3's device check passed"));

  // A failed mic: its message and the setting to change.
  const silentMic = deviceCheck("silent", "The mic opened but recorded only silence", "Allow it");
  checkReply = { kind: "exited", code: 4, stdout: JSON.stringify(silentMic), lastLine: "" };
  const silent = await post(picks);
  assert.ok(silent.page.includes("the check found a problem"), silent.page);
  assert.ok(
    silent.page.includes("Mic: The mic opened but recorded only silence. Allow it."),
    silent.page,
  );

  // A check that runs past its time limit says so; the names stay saved.
  checkReply = { kind: "timed_out", lastLine: "opening the camera" };
  const late = await post(picks);
  assert.ok(late.page.includes("finish within 20 s: opening the camera"), late.page);
  assert.deepEqual(await sensors(), [CAMERA, MIC]);

  // No sensors on this laptop: both none, and no check runs.
  const checks = () => layer3.calls.filter((call) => call.args.includes("check")).length;
  const before = checks();
  const none = await post({ picked: "yes", camera: "none", mic: "none" });
  assert.equal(none.statusCode, 303);
  assert.deepEqual(await sensors(), [null, null]);
  assert.equal(checks(), before);
});
