import assert from "node:assert/strict";
import { createSecretKey, randomBytes, randomUUID } from "node:crypto";
import fsPromises, { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { format } from "node:util";
import { readJsonFile } from "../bridge/src/json-file.ts";
import { type NewPhone, PhoneRegistry, type PhoneRole, PhonesError } from "../bridge/src/phones.ts";
import { PHONE_KEY_BYTES, PRIVATE_FILE_MODE, STATE_NAMES } from "../bridge/src/settings.ts";

const PAIRED_AT = "2026-11-14T15:10:00Z";
const REMOVED_AT = "2026-11-14T16:00:00Z";

/** A temporary state folder, and where phones.json goes in it. */
async function stateDir(t: TestContext): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "l1-phones-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, file: path.join(dir, STATE_NAMES.phones) };
}

const newPhone = (name: string, role: PhoneRole): NewPhone => ({
  deviceId: randomUUID(),
  name,
  role,
  phoneKey: createSecretKey(randomBytes(PHONE_KEY_BYTES)),
  credentialSha256: randomBytes(32).toString("hex"),
});

/** The phone as phones.json holds it. */
const saved = (phone: NewPhone) => ({
  device_id: phone.deviceId,
  name: phone.name,
  role: phone.role,
  paired_at: PAIRED_AT,
  phone_key: phone.phoneKey.export().toString("base64url"),
  credential_sha256: phone.credentialSha256,
});

/** phones.json's content, and the same as text. */
const content = (phones: unknown[], removed: unknown[] = []) => ({
  schema_version: 1,
  phones,
  removed,
});
const fileOf = (phones: unknown[], removed: unknown[] = []) =>
  JSON.stringify(content(phones, removed));

test("phones added together are all saved, listed without keys or hashes, and reloaded", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(PAIRED_AT) });
  const { dir, file } = await stateDir(t);
  const registry = await PhoneRegistry.load(dir);
  assert.deepEqual(registry.list(), []);
  const sam = newPhone("Sam's iPhone", "caregiver");
  const ann = newPhone("Ann's iPhone", "resident");
  await Promise.all([registry.add(sam), registry.add(ann)]);
  const listed = [
    { deviceId: sam.deviceId, name: sam.name, role: "caregiver", pairedAt: PAIRED_AT },
    { deviceId: ann.deviceId, name: ann.name, role: "resident", pairedAt: PAIRED_AT },
  ];
  assert.deepEqual(registry.list(), listed);
  assert.deepEqual(await readJsonFile(file), content([saved(sam), saved(ann)]));
  if (process.platform !== "win32") {
    // Windows keeps no such modes: the profile's permissions protect the state folder there.
    assert.equal((await stat(file)).mode & 0o777, PRIVATE_FILE_MODE);
  }
  const reloaded = await PhoneRegistry.load(dir);
  assert.deepEqual(reloaded.list(), listed);
  const found = reloaded.lookup(ann.deviceId);
  assert.ok(found.state === "paired" && found.role === "resident");
  assert.ok(found.phoneKey.equals(ann.phoneKey));
  assert.deepEqual(reloaded.lookup(randomUUID()), { state: "unknown" });
});

test("removing a phone, twice at once, keeps its device ID as removed and drops its key", async (t) => {
  const { dir, file } = await stateDir(t);
  const registry = await PhoneRegistry.load(dir);
  const sam = newPhone("Sam's iPhone", "caregiver");
  await registry.add(sam);
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(REMOVED_AT) });
  await Promise.all([registry.remove(sam.deviceId), registry.remove(sam.deviceId)]);
  const removed = content([], [{ device_id: sam.deviceId, removed_at: REMOVED_AT }]);
  assert.deepEqual(await readJsonFile(file), removed);
  assert.deepEqual(registry.list(), []);
  assert.deepEqual(registry.lookup(sam.deviceId), { state: "removed" });
  await registry.remove(sam.deviceId);
  await registry.remove(randomUUID());
  assert.deepEqual(await readJsonFile(file), removed);
  assert.deepEqual((await PhoneRegistry.load(dir)).lookup(sam.deviceId), { state: "removed" });
});

test("an unreadable or invalid phones.json is reported with its path and never overwritten", async (t) => {
  const { dir, file } = await stateDir(t);
  const sam = saved(newPhone("Sam's iPhone", "caregiver"));
  const shortKey = fileOf([{ ...sam, phone_key: sam.phone_key.slice(1) }]);
  const broken = [
    "{ not-json",
    JSON.stringify({ schema_version: 2, phones: [], removed: [] }),
    fileOf([{ ...sam, role: "owner" }]),
    fileOf([{ ...sam, credential_sha256: sam.credential_sha256.toUpperCase() }]),
    fileOf([sam], [{ device_id: sam.device_id, removed_at: REMOVED_AT }]),
    shortKey,
  ];
  const reported = (error: unknown) =>
    error instanceof PhonesError &&
    error.message.startsWith(`${file}: `) &&
    [sam.name, sam.phone_key.slice(1), sam.credential_sha256].every(
      (value) => !error.message.toLowerCase().includes(value.toLowerCase()),
    );
  for (const text of broken) {
    await writeFile(file, text, { encoding: "utf8" });
    await assert.rejects(PhoneRegistry.load(dir), reported);
    assert.equal(await readFile(file, { encoding: "utf8" }), text);
  }
  // A file damaged after loading: adding and removing are refused, and the file is left as it is.
  await writeFile(file, fileOf([sam]), { encoding: "utf8" });
  const registry = await PhoneRegistry.load(dir);
  await writeFile(file, shortKey, { encoding: "utf8" });
  await assert.rejects(registry.add(newPhone("Ann's iPhone", "resident")), reported);
  await assert.rejects(registry.remove(sam.device_id), reported);
  assert.equal(await readFile(file, { encoding: "utf8" }), shortKey);
});

test("a failed write leaves the list in memory and on disk as it was", async (t) => {
  const { dir, file } = await stateDir(t);
  const registry = await PhoneRegistry.load(dir);
  const sam = newPhone("Sam's iPhone", "caregiver");
  await registry.add(sam);
  const listed = registry.list();
  const before = await readFile(file);
  const diskFull = Object.assign(new Error("ENOSPC: simulated"), { code: "ENOSPC" });
  const rename = t.mock.method(fsPromises, "rename", () => Promise.reject(diskFull));
  syncBuiltinESMExports();
  t.after(() => {
    rename.mock.restore();
    syncBuiltinESMExports();
  });
  await assert.rejects(registry.add(newPhone("Ann's iPhone", "resident")), /ENOSPC/);
  await assert.rejects(registry.remove(sam.deviceId), /ENOSPC/);
  assert.deepEqual(registry.list(), listed);
  assert.equal(registry.lookup(sam.deviceId).state, "paired");
  assert.deepEqual(await readFile(file), before);
  assert.deepEqual(await readdir(dir), [STATE_NAMES.phones]);
});

test("log lines name device IDs and roles, never a name, key or hash", async (t) => {
  const lines: string[] = [];
  for (const method of ["log", "info", "warn", "error"] as const) {
    t.mock.method(console, method, (...args: unknown[]) => lines.push(format(...args)));
  }
  const { dir } = await stateDir(t);
  const registry = await PhoneRegistry.load(dir);
  const sam = newPhone("Sam's iPhone", "caregiver");
  await registry.add(sam);
  await registry.remove(sam.deviceId);
  t.mock.restoreAll();
  assert.deepEqual(lines, [
    `L1 phones: phone ${sam.deviceId} paired as caregiver`,
    `L1 phones: phone ${sam.deviceId} removed`,
  ]);
});

test("the relay's list has each paired phone's role and hash, then the removed; onChange hears each save", async (t) => {
  const { dir } = await stateDir(t);
  const registry = await PhoneRegistry.load(dir);
  let changes = 0;
  const stop = registry.onChange(() => {
    changes += 1;
  });
  const [kept, gone] = [newPhone("Sam", "caregiver"), newPhone("Ana", "resident")];
  await registry.add(kept);
  await registry.add(gone);
  await registry.remove(gone.deviceId);
  await registry.remove(gone.deviceId); // removing it again changes nothing
  assert.equal(changes, 3);
  assert.deepEqual(registry.relayList(), [
    {
      deviceId: kept.deviceId,
      removed: false,
      role: "caregiver",
      credentialSha256: kept.credentialSha256,
    },
    { deviceId: gone.deviceId, removed: true },
  ]);
  stop();
  await registry.add(newPhone("Lee", "caregiver"));
  assert.equal(changes, 3);
});
