import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  checkDevices,
  deviceCheckCommand,
  deviceListCommand,
  listDevices,
  type ProgramRunner,
  parseDeviceCheck,
  parseDeviceList,
  pickedName,
  pickerChoices,
  runProgram,
  sshHint,
  startedOverSsh,
} from "../bridge/src/sensor-check.ts";
import * as settings from "../bridge/src/settings.ts";

const contract = async (name: string) =>
  readFile(path.join(import.meta.dirname, "..", "..", "contracts", name), "utf8");
const REPO = path.join(path.sep, "repo");

/** A runner that answers every call with `reply`. */
const answering =
  (reply: Awaited<ReturnType<ProgramRunner>>): ProgramRunner =>
  async () =>
    reply;
const exited = (code: number, stdout: string, lastLine = "") =>
  answering({ kind: "exited", code, stdout, lastLine });

test("the device list and check commands are the contract's, through uv in Layer 3's project", () => {
  const project = path.join(REPO, "layer3");
  const head = ["run", "--project", project, "python", "-m", "layer3.capture_job"];
  assert.deepEqual(deviceListCommand(REPO), { file: "uv", args: [...head, "list", "--json"] });
  const config = path.join(REPO, "worker.json");
  assert.deepEqual(deviceCheckCommand(REPO, config), {
    file: "uv",
    args: [...head, "check", "--config", config, "--json"],
  });
});

test("contracts/device-list.json and device-check.json are read field for field", async () => {
  const list = parseDeviceList(await contract("device-list.json"));
  assert.deepEqual(list, {
    ok: true,
    cameras: [
      { name: "j5 WebCam JVCU100", kind: "external", sameName: false },
      { name: "MacBook Air Camera", kind: "built_in", sameName: false },
    ],
    mics: [
      { name: "Audio Streaming", kind: "external", sameName: false },
      { name: "MacBook Air Microphone", kind: "built_in", sameName: false },
    ],
    problems: [],
  });
  const check = parseDeviceCheck(await contract("device-check.json"));
  assert.ok(check?.ok === true);
  assert.equal(check.allOk, false);
  assert.deepEqual(check.camera, {
    name: "j5 WebCam JVCU100",
    result: "ok",
    message: "Camera OK",
    fix: null,
    similar: [],
  });
  assert.equal(check.mic.result, "silent");
  for (const bad of ["", "not json", "[]", '{"schema_version":2,"type":"device_list"}']) {
    assert.equal(parseDeviceList(bad), undefined, bad);
    assert.equal(parseDeviceCheck(bad), undefined, bad);
  }
});

test("the device list: printed, unreadable, failed, not installed or past its time limit", async () => {
  const printed = await contract("device-list.json");
  assert.equal((await listDevices(REPO, exited(0, printed))).ok, true);
  assert.deepEqual(await listDevices(REPO, exited(0, "{}")), {
    ok: false,
    message: "Layer 3's device list printed something other than its contract",
  });
  assert.deepEqual(await listDevices(REPO, exited(2, "", "usage: capture_job")), {
    ok: false,
    message: "Layer 3's device list exited with code 2: usage: capture_job",
  });
  assert.deepEqual(
    await listDevices(REPO, answering({ kind: "failed", message: "uv is not installed" })),
    {
      ok: false,
      message: "can't run Layer 3's device list: uv is not installed",
    },
  );
  let limit = 0;
  const slow: ProgramRunner = async (_file, _args, { timeoutMs }) => {
    limit = timeoutMs;
    return { kind: "timed_out", lastLine: "listing cameras" };
  };
  assert.deepEqual(await listDevices(REPO, slow), {
    ok: false,
    message: "Layer 3's device list didn't finish within 10 s: listing cameras",
  });
  assert.equal(limit, settings.DEVICE_LIST_TIMEOUT_MS);
});

test("the device check: exit 0 and 4 print the result, 2 is an unreadable config", async () => {
  const printed = await contract("device-check.json");
  const failed = await checkDevices(REPO, "worker.json", exited(4, printed));
  assert.ok(failed.ok && !failed.allOk);
  const passed = printed.replace('"ok": false', '"ok": true');
  const good = await checkDevices(REPO, "worker.json", exited(0, passed));
  assert.ok(good.ok && good.allOk);
  assert.deepEqual(await checkDevices(REPO, "worker.json", exited(2, "", "no such file")), {
    ok: false,
    message: "Layer 3's device check couldn't read worker.json: no such file",
  });
  assert.deepEqual(await checkDevices(REPO, "worker.json", exited(1, printed, "Traceback")), {
    ok: false,
    message: "Layer 3's device check exited with code 1: Traceback",
  });
  const late = await checkDevices(
    REPO,
    "worker.json",
    answering({ kind: "timed_out", lastLine: "x" }),
  );
  assert.deepEqual(late, {
    ok: false,
    message: "Layer 3's device check didn't finish within 20 s: x",
  });
});

test("the pickers offer external then unknown devices, and flag a shared name", () => {
  const { offered, flagged } = pickerChoices([
    { name: "Built in", kind: "built_in", sameName: false },
    { name: "Mystery", kind: "unknown", sameName: false },
    { name: "Phone", kind: "continuity", sameName: false },
    { name: "Twin", kind: "external", sameName: true },
    { name: "Twin", kind: "external", sameName: true },
    { name: "Virtual", kind: "virtual", sameName: false },
    { name: "Webcam", kind: "external", sameName: false },
  ]);
  assert.deepEqual(
    offered.map((device) => device.name),
    ["Webcam", "Mystery"],
  );
  assert.deepEqual(flagged, ["Twin"]);
  assert.equal(pickedName("device:Webcam"), "Webcam");
  assert.equal(pickedName("none"), "");
  for (const bad of [null, "", "Webcam", "device:", "device:  "]) {
    assert.equal(pickedName(bad), undefined, String(bad));
  }
});

test("a Mac bridge started over SSH is told to start from Terminal.app on a permission result", async () => {
  const check = parseDeviceCheck(await contract("device-check.json"));
  assert.ok(check !== undefined);
  assert.match(sshHint(check, true, "darwin") ?? "", /Terminal\.app/);
  assert.equal(sshHint(check, false, "darwin"), undefined);
  assert.equal(sshHint(check, true, "win32"), undefined);
  const fine = parseDeviceCheck((await contract("device-check.json")).replace('"silent"', '"ok"'));
  assert.ok(fine !== undefined);
  assert.equal(sshHint(fine, true, "darwin"), undefined);
  assert.equal(startedOverSsh({ SSH_CONNECTION: "10.0.0.2 5 10.0.0.3 22" }), true);
  assert.equal(startedOverSsh({}), false);
});

test("the real runner: output and last error line, a missing program, and its time limit", async () => {
  const cwd = import.meta.dirname;
  const script =
    'process.stdout.write(\'{"a":1}\\n\'); console.error("first"); console.error("last"); process.exit(4)';
  const ran = await runProgram(process.execPath, ["-e", script], { cwd, timeoutMs: 10_000 });
  assert.deepEqual(ran, { kind: "exited", code: 4, stdout: '{"a":1}\n', lastLine: "last" });
  const missing = await runProgram("debbie-no-such-program", [], { cwd, timeoutMs: 10_000 });
  assert.deepEqual(missing, { kind: "failed", message: "debbie-no-such-program is not installed" });
  const hang = 'console.error("waiting"); setInterval(() => {}, 1000)';
  const started = Date.now();
  const late = await runProgram(process.execPath, ["-e", hang], { cwd, timeoutMs: 500 });
  assert.equal(late.kind, "timed_out");
  assert.ok(Date.now() - started < 5_000);
});
