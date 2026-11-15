import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chmod, readFile, stat, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { type TestContext, test } from "node:test";
import { createHome } from "../bridge/src/home.ts";
import {
  ImportRefusal,
  importRelayCredential,
  parseRelayCredential,
  readRelayCredential,
  relayCredentialFile,
} from "../bridge/src/relay-credential.ts";
import * as settings from "../bridge/src/settings.ts";
import { freePort } from "./coordinator-fixtures.ts";
import { tempDir } from "./relay-fixtures.ts";

const CREDENTIAL = "Q".repeat(43);

/** A state folder holding a home, and the credential file `admin provision` would print for it. */
async function homeWithFile(t: TestContext) {
  const stateDir = await tempDir(t);
  const { COORDINATOR_LISTEN_PORT: listen, COORDINATOR_CLIENT_PORT: client } = settings;
  const home = await createHome(stateDir, {
    ports: { listen, dashboard: await freePort(), client },
  });
  const file = {
    schema_version: 1,
    home_id: home.homeId,
    relay_url: "https://relay.example.com",
    hub_credential: CREDENTIAL,
    issued_at: "2026-11-14T15:10:00Z",
  };
  return { stateDir, home, file };
}

test("the contract's example parses for its home, and each broken field is named, never echoed", async () => {
  const example: unknown = JSON.parse(
    await readFile(new URL("../contracts/relay-credential.json", import.meta.url), "utf8"),
  );
  const homeId = String(Reflect.get(Object(example), "home_id"));
  const parsed = parseRelayCredential(example, homeId);
  assert.ok(typeof parsed !== "string", String(parsed));
  assert.equal(parsed.relayUrl, "https://relay.example.com");
  assert.equal(parsed.issuedAt, "2026-11-14T15:10:00Z");
  assert.match(parsed.authorization(), /^Bearer [A-Za-z0-9_-]{43}$/);
  const broken = (changes: Record<string, unknown>) =>
    parseRelayCredential({ ...Object(example), ...changes }, homeId);
  assert.equal(broken({ home_id: "another" }), "home_id isn't this home's");
  assert.match(String(broken({ relay_url: "http://relay.example.com" })), /^relay_url/);
  assert.equal(typeof broken({ relay_url: "http://127.0.0.1:7490" }), "object");
  assert.match(String(broken({ hub_credential: "short" })), /^hub_credential/);
  assert.match(String(broken({ issued_at: "yesterday" })), /^issued_at/);
  assert.match(String(broken({ schema_version: 2 })), /^schema_version/);
  const text = JSON.stringify(Object(parsed));
  assert.ok(!text.includes(String(Reflect.get(Object(example), "hub_credential"))));
});

test("no file means not set up; a good owner-only file is read", async (t) => {
  const { stateDir, home, file } = await homeWithFile(t);
  assert.deepEqual(await readRelayCredential(stateDir, home.homeId), { state: "none" });
  await importRelayCredential(Readable.from([JSON.stringify(file)]), stateDir);
  const read = await readRelayCredential(stateDir, home.homeId);
  assert.ok(read.state === "ok");
  assert.equal(read.credential.relayUrl, "https://relay.example.com");
  assert.equal(read.credential.authorization(), `Bearer ${CREDENTIAL}`);
});

test("a file others may read, broken JSON or another home's is unusable, with the file named", async (t) => {
  const { stateDir, home, file } = await homeWithFile(t);
  const path = relayCredentialFile(stateDir);
  await writeFile(path, JSON.stringify(file), { encoding: "utf8", mode: 0o600 });
  // Windows has no owner-only bits; the profile's permissions guard the state folder there.
  if (process.platform !== "win32") {
    await chmod(path, 0o644);
    const open = await readRelayCredential(stateDir, home.homeId);
    assert.ok(open.state === "unusable");
    assert.equal(open.file, path);
    assert.match(open.reason, /other accounts on this laptop may read it/);
    await chmod(path, 0o600);
  }
  await writeFile(path, "{", "utf8");
  const broken = await readRelayCredential(stateDir, home.homeId);
  assert.ok(broken.state === "unusable" && broken.reason === "not valid JSON", String(broken));
  await writeFile(path, JSON.stringify({ ...file, home_id: "another" }), "utf8");
  const other = await readRelayCredential(stateDir, home.homeId);
  assert.ok(other.state === "unusable" && other.reason === "home_id isn't this home's");
});

test("import writes the file whole and owner-only with only the contract's fields", async (t) => {
  const { stateDir, file } = await homeWithFile(t);
  const written = await importRelayCredential(
    Readable.from([JSON.stringify({ ...file, extra: "dropped" })]),
    stateDir,
  );
  assert.equal(written, relayCredentialFile(stateDir));
  assert.deepEqual(JSON.parse(await readFile(written, "utf8")), file);
  if (process.platform !== "win32") assert.equal((await stat(written)).mode & 0o777, 0o600);
});

test("a bad or oversized import leaves no file and echoes nothing of the input", async (t) => {
  const { stateDir, file } = await homeWithFile(t);
  const refusals: Array<[string, string, RegExp]> = [
    ["another home", JSON.stringify({ ...file, home_id: "another" }), /home_id/],
    ["plain http", JSON.stringify({ ...file, relay_url: "http://relay.example.com" }), /https/],
    ["short", JSON.stringify({ ...file, hub_credential: "abc" }), /43 base64url/],
    ["oversized", JSON.stringify({ ...file, pad: "x".repeat(5_000) }), /over 4096 bytes/],
    ["not JSON", `${CREDENTIAL} and more`, /isn't one JSON object/],
  ];
  for (const [what, input, reason] of refusals) {
    const error = await importRelayCredential(Readable.from([input]), stateDir).then(
      () => assert.fail(`${what} was saved`),
      (failure: unknown) => failure,
    );
    assert.ok(error instanceof ImportRefusal, what);
    assert.match(error.message, reason, what);
    assert.ok(!error.message.includes(CREDENTIAL) && !error.message.includes("abc"), what);
    assert.equal(existsSync(relayCredentialFile(stateDir)), false, what);
  }
});

test("an import whose input never ends gives up after its time limit", async (t) => {
  const { stateDir } = await homeWithFile(t);
  const endless = new Readable({ read: () => undefined });
  const late = importRelayCredential(endless, stateDir, 100);
  await assert.rejects(late, /no complete credential file arrived in time/);
  assert.equal(existsSync(relayCredentialFile(stateDir)), false);
});

test("import refuses a folder with no home", async (t) => {
  const stateDir = await tempDir(t);
  await assert.rejects(
    importRelayCredential(Readable.from(["{}"]), stateDir),
    /there is no home in/,
  );
});
