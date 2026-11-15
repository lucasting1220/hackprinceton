import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { sensorName, workerConfig, workerFiles } from "../bridge/src/laptop.ts";
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
async function joinedLaptop(t: TestContext) {
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
  const laptop = { findPython: async () => process.execPath, linkReportMs: 60_000 };
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
  return { client, lines, written, sensors, post };
}

test("the joined laptop's camera and mic form saves into worker.json and restarts the worker", async (t) => {
  const { client, lines, written, sensors, post } = await joinedLaptop(t);
  const starts = () => lines.filter((line) => line.includes("starting the STUB")).length;
  const form = await client.get("/join/sensors");
  assert.equal(form.statusCode, 200);
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
  assert.equal(saved.statusCode, 303);
  assert.equal(saved.headers.location, "/join");
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
