import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { createHome, type Home } from "../bridge/src/home.ts";
import { writeFileWhole } from "../bridge/src/json-file.ts";
import { startBridge } from "../bridge/src/main.ts";
import { credentialHash, toBase64url } from "../bridge/src/phone-crypto.ts";
import { relayCredentialFile } from "../bridge/src/relay-credential.ts";
import * as settings from "../bridge/src/settings.ts";
import { utcSeconds } from "../bridge/src/wire.ts";
import { freePort, makeTempDir, STUB, waitFor } from "./coordinator-fixtures.ts";
import { pageClient } from "./page-client.ts";
import { startHubRelay } from "./relay-hub-fixtures.ts";

/** How long a bridge may take to stop once its stop file appears. */
const STOP_WAIT_MS = 15_000;

/**
 * A home in a temporary state folder, with the coordinator stub in a temporary repository; the
 * bridge's after hook removes both once the bridge has stopped.
 */
async function homeFolders() {
  const [repoRoot, stateDir] = [await makeTempDir(), await makeTempDir()];
  const stub = path.join(repoRoot, ...settings.COORDINATOR_STUB_PATH);
  await mkdir(path.dirname(stub), { recursive: true });
  await copyFile(STUB, stub);
  const { COORDINATOR_LISTEN_PORT: listen, COORDINATOR_CLIENT_PORT: client } = settings;
  const homeOptions = { ports: { listen, dashboard: await freePort(), client } };
  const home = await createHome(stateDir, homeOptions);
  return { repoRoot, stateDir, homeOptions, home };
}

/** The bridge on port 0 for `folders`; the test stops it through its stop file. */
async function bridgeFor(t: TestContext, folders: Awaited<ReturnType<typeof homeFolders>>) {
  const lines: string[] = [];
  const bridge = await startBridge({
    ...folders,
    port: 0,
    open: async () => undefined,
    log: (line) => lines.push(line),
    network: { port: 0, addresses: (port) => [`127.0.0.1:${port}`] },
    relayTiming: { backoffMs: [50], heartbeatMs: 300 },
  });
  t.after(async () => {
    await writeFile(bridge.stopFile, "", "utf8");
    await waitFor(() => lines.includes("L1 bridge: stopped"), STOP_WAIT_MS);
    for (const dir of [folders.repoRoot, folders.stateDir]) {
      await rm(dir, { recursive: true, force: true });
    }
  });
  return { bridge, lines, page: pageClient(bridge.url) };
}

/** Writes the credential file `admin provision` would print for `home` at `relayUrl`. */
async function writeCredential(home: Home, relayUrl: string, hubCredential: string) {
  const file = {
    schema_version: 1,
    home_id: home.homeId,
    relay_url: relayUrl,
    hub_credential: hubCredential,
    issued_at: utcSeconds(new Date()),
  };
  await writeFileWhole(relayCredentialFile(home.stateDir), JSON.stringify(file));
}

test("with a credential file the bridge links to the relay, shows it, and pairs phones with relay_url", async (t) => {
  const relay = await startHubRelay(t);
  const folders = await homeFolders();
  const hubCredential = toBase64url(randomBytes(settings.HUB_CREDENTIAL_BYTES));
  relay.store.createHome(folders.home.homeId, credentialHash(hubCredential), Date.now());
  await writeCredential(folders.home, relay.url, hubCredential);
  const { bridge, lines, page } = await bridgeFor(t, folders);

  await waitFor(() => relay.hub.connected(folders.home.homeId), 5_000);
  await waitFor(() => bridge.relayLink()?.status().state === "connected");
  const shown = (await page.get("/")).page;
  assert.match(shown, /Remote access: connected to the relay since \d{4}-\d{2}-\d{2}T/);
  assert.ok(!shown.includes(hubCredential), "the credential is on the page");
  const state = bridge.phones()?.state();
  assert.ok(state?.on === true);
  assert.equal(state.pairing.relayUrl, relay.url);
  assert.ok(!lines.join("\n").includes(hubCredential), "the credential reached a log line");
});

test("without a credential file remote access isn't set up and pairing has no relay_url", async (t) => {
  const folders = await homeFolders();
  const { bridge, page } = await bridgeFor(t, folders);
  assert.match((await page.get("/")).page, /Remote access: not set up/);
  assert.equal(bridge.relayLink(), undefined);
  const state = bridge.phones()?.state();
  assert.ok(state?.on === true);
  assert.equal(state.pairing.relayUrl, "");
});

test("a credential file for another home starts no link, and the page names the file and why", async (t) => {
  const folders = await homeFolders();
  const other = { ...folders.home, homeId: "another-home" };
  await writeCredential(other, "https://relay.example.com", "F".repeat(43));
  const { bridge, page, lines } = await bridgeFor(t, folders);
  const shown = (await page.get("/")).page;
  const file = relayCredentialFile(folders.stateDir);
  assert.ok(shown.includes(`the credential file ${file} can&#39;t be used`), shown);
  assert.match(shown, /home_id isn&#39;t this home&#39;s/);
  assert.equal(bridge.relayLink(), undefined);
  assert.ok(!`${shown}${lines.join("\n")}`.includes("F".repeat(43)));
});
