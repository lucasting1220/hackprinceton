import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, createSecretKey, type KeyObject } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { format } from "node:util";
import { createHome, HomeError, HomeExistsError } from "../bridge/src/home.ts";
import { readJsonFile, writeFileWhole } from "../bridge/src/json-file.ts";
import { BRIDGE_URL, OLLAMA_URL, STATE_NAMES } from "../bridge/src/settings.ts";

async function stateDir(t: TestContext): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "l1-home-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

const systemError = (code: string) => Object.assign(new Error(`${code}: simulated`), { code });

/** A writer that fails on accepted-workers.json, the last file a creation writes. */
const failingLastWrite: typeof writeFileWhole = async (file, content, options) => {
  if (path.basename(file) !== STATE_NAMES.acceptedWorkers) {
    return writeFileWhole(file, content, options);
  }
  throw systemError("ENOSPC");
};

const publicKeyOf = (key: KeyObject) => createPublicKey(key).export({ format: "jwk" }).x;

/** The home key and the hub's private key, read straight from the files a creation wrote. */
async function keysIn(dir: string): Promise<{ homeKey: KeyObject; hubPrivateKey: KeyObject }> {
  const read = (name: string) => readFile(path.join(dir, STATE_NAMES.keysDir, name));
  const der = await read(STATE_NAMES.hubPrivateKey);
  const hubPrivateKey = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  return { homeKey: createSecretKey(await read(STATE_NAMES.homeKey)), hubPrivateKey };
}

/** Matches a HomeError whose message ends with `text`: the advice the person is given. */
const advising = (text: string) => (error: unknown) =>
  error instanceof HomeError && error.message.endsWith(text);

test("creating returns the home and writes its JSON files, keys and private key files", async (t) => {
  const dir = await stateDir(t);
  const ports = { listen: 17443, dashboard: 17450, client: 17451 };
  const createdAt = "2026-11-14T03:12:45.000Z";
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(createdAt) });
  const home = await createHome(dir, { ports });
  assert.equal(home.dashboardPort, 17450);
  const at = (name: string) => path.join(dir, name);
  const saved = { schema_version: 1, home_id: home.homeId, hub_public_key: home.hubPublicKey };
  assert.deepEqual(await readJsonFile(at(STATE_NAMES.home)), { ...saved, created_at: createdAt });
  assert.deepEqual(await readJsonFile(home.coordinatorConfigFile), {
    schema_version: 1,
    home_id: home.homeId,
    listen_port: 17443,
    dashboard_port: 17450,
    client_port: 17451,
    ollama_url: OLLAMA_URL,
    bridge_url: BRIDGE_URL,
    accepted_workers_file: at(STATE_NAMES.acceptedWorkers),
    state_dir: at(STATE_NAMES.coordinatorStateDir),
    stop_file: at(STATE_NAMES.coordinatorStop),
  });
  const { homeKey, hubPrivateKey } = await keysIn(dir);
  assert.equal(homeKey.symmetricKeySize, 32);
  assert.equal(publicKeyOf(hubPrivateKey), home.hubPublicKey);
  if (process.platform !== "win32") {
    // Windows keeps no such modes: the user profile's permissions protect the state folder there.
    const mode = async (...names: string[]) => (await stat(path.join(dir, ...names))).mode & 0o777;
    assert.equal(await mode(STATE_NAMES.keysDir), 0o700);
    assert.equal(await mode(STATE_NAMES.keysDir, STATE_NAMES.homeKey), 0o600);
    assert.equal(await mode(STATE_NAMES.keysDir, STATE_NAMES.hubPrivateKey), 0o600);
  }
});

test("two creations at once make one home and one refusal", async (t) => {
  const dir = await stateDir(t);
  const creations = Promise.allSettled([createHome(dir), createHome(dir)]);
  const [first, second] = await creations;
  assert.ok(first.status === "fulfilled");
  assert.ok(second.status === "rejected" && second.reason instanceof HomeExistsError);
  const { homeKey, hubPrivateKey } = await keysIn(dir);
  assert.equal(publicKeyOf(hubPrivateKey), first.value.hubPublicKey);
  await assert.rejects(createHome(dir), HomeExistsError);
  assert.ok((await keysIn(dir)).homeKey.equals(homeKey), "the home key changed");
});

test("a creation waits for the one in progress, and succeeds where that one failed", async (t) => {
  const dir = await stateDir(t);
  const failing = createHome(dir, { writeFile: failingLastWrite });
  const [first, second] = await Promise.allSettled([failing, createHome(dir)]);
  assert.ok(first.status === "rejected" && advising("so try again")(first.reason));
  assert.ok(second.status === "fulfilled");
});

test("a creation whose last write fails leaves nothing behind, and a retry works", async (t) => {
  const dir = await stateDir(t);
  const tryAgain = advising("ENOSPC: simulated; its files were removed, so try again");
  await assert.rejects(createHome(dir, { writeFile: failingLastWrite }), tryAgain);
  assert.deepEqual(await readdir(dir), []);
  await createHome(dir);
});

test("a creation that cannot be undone names the folder to delete", async (t) => {
  const dir = await stateDir(t);
  const remove = () => Promise.reject(systemError("EROFS"));
  const stuck = advising(`undoing it failed too (EROFS: simulated), so delete the folder ${dir}`);
  await assert.rejects(createHome(dir, { writeFile: failingLastWrite, remove }), stuck);
});

test("a creation over files left from an earlier home names the folder to delete", async (t) => {
  const dir = await stateDir(t);
  await createHome(dir);
  const privateKeyFile = path.join(dir, STATE_NAMES.keysDir, STATE_NAMES.hubPrivateKey);
  const keyFile = path.join(dir, STATE_NAMES.keysDir, STATE_NAMES.homeKey);
  await rm(keyFile);
  const homeFile = path.join(dir, STATE_NAMES.home);
  await rm(homeFile);
  const leftover = `${privateKeyFile} is left from an earlier home, so delete the folder ${dir}`;
  await assert.rejects(createHome(dir), advising(leftover));
});

test("no secret reaches a log line or the returned home", async (t) => {
  const dir = await stateDir(t);
  const lines: string[] = [];
  for (const method of ["log", "info", "warn", "error"] as const) {
    t.mock.method(console, method, (...args: unknown[]) => lines.push(format(...args)));
  }
  const home = await createHome(dir);
  await assert.rejects(createHome(dir), HomeExistsError);
  t.mock.restoreAll();
  const { homeKey, hubPrivateKey } = await keysIn(dir);
  const der = hubPrivateKey.export({ format: "der", type: "pkcs8" });
  const secrets = [homeKey.export(), der, der.subarray(-32)].flatMap((bytes) =>
    (["hex", "base64", "base64url"] as const).map((encoding) => bytes.toString(encoding)),
  );
  assert.ok(lines.length > 0 && lines.every((line) => line.startsWith("L1 home: ")));
  for (const text of [...lines, JSON.stringify(home)]) {
    assert.ok(!secrets.some((secret) => text.includes(secret)), "a secret leaked");
  }
});
