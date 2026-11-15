import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  type LaptopFacts,
  laptopCheckSection,
  laptopWarnings,
  readLaptopFacts,
} from "../bridge/src/laptop-check.ts";
import * as settings from "../bridge/src/settings.ts";
import { startSetupServer } from "../bridge/src/setup-server.ts";
import { makeTempDir } from "./coordinator-fixtures.ts";
import { pageClient } from "./page-client.ts";

const GIB = 1024 ** 3;
const ROOMY: LaptopFacts = {
  cores: 8,
  memoryBytes: 16 * GIB,
  freeDiskBytes: 200 * GIB,
  platform: "darwin",
  osName: "macOS 25.2.0",
};

test("Check this laptop: no warnings on a roomy Mac, and each shortfall warns", () => {
  assert.deepEqual(laptopWarnings(ROOMY), []);
  const section = laptopCheckSection(ROOMY).text;
  assert.ok(section.includes("<h2>Check this laptop</h2>"), section);
  assert.ok(
    section.includes(
      "CPU cores: 8. Memory: 16 GB. Free disk: 200 GB. Operating system: macOS 25.2.0.",
    ),
  );
  assert.ok(section.includes("No warnings."));

  const small = {
    ...ROOMY,
    memoryBytes: 8 * GIB,
    freeDiskBytes: 2 * GIB,
    platform: "linux",
    osName: "Linux 6.1",
  };
  const warnings = laptopWarnings(small);
  assert.equal(warnings.length, 3);
  assert.match(
    warnings[0] ?? "",
    new RegExp(
      `8 GB of memory\\. Layer 2 needs at least ${settings.WORKER_MIN_MEMORY_GB} GB on a worker`,
    ),
  );
  assert.match(warnings[1] ?? "", /Only 2 GB of disk is free/);
  assert.match(warnings[2] ?? "", /built for macOS and Windows; this laptop runs Linux 6\.1/);
  assert.equal(laptopCheckSection(small).text.split("<li>Warning: ").length, 4);

  const unread = laptopWarnings({ ...ROOMY, freeDiskBytes: undefined });
  assert.deepEqual(unread, ["This laptop's free disk space couldn't be read."]);
  assert.ok(
    laptopCheckSection({ ...ROOMY, freeDiskBytes: undefined }).text.includes("Free disk: unknown."),
  );
});

test("this laptop's own facts are read, from a state folder that doesn't exist yet", async () => {
  const dir = await makeTempDir();
  const facts = await readLaptopFacts(path.join(dir, "not", "yet"));
  await rm(dir, { recursive: true, force: true });
  assert.ok(facts.cores >= 1 && facts.memoryBytes > 0, JSON.stringify(facts));
  assert.ok(facts.freeDiskBytes !== undefined && facts.freeDiskBytes > 0);
  assert.equal(facts.platform, process.platform);
});

test("the welcome page shows Check this laptop's warnings above Create a home and Join a home, which still work", async (t) => {
  const [stateDir, repoRoot] = [await makeTempDir(), await makeTempDir()];
  const small = { ...ROOMY, memoryBytes: 8 * GIB };
  const lines: string[] = [];
  const server = await startSetupServer({
    stateDir,
    repoRoot,
    port: 0,
    log: (line: string) => lines.push(line),
    laptopFacts: async () => small,
  });
  t.after(async () => {
    await server.close();
    for (const dir of [stateDir, repoRoot]) await rm(dir, { recursive: true, force: true });
  });
  const client = pageClient(server.url);
  const welcome = (await client.get("/")).page;
  const check = welcome.indexOf("<h2>Check this laptop</h2>");
  assert.ok(check > 0, welcome);
  assert.ok(welcome.includes("Warning: This laptop has 8 GB of memory."), welcome);
  assert.ok(check < welcome.indexOf("Create a home") && check < welcome.indexOf('href="/join"'));
  assert.equal((await client.get("/join")).statusCode, 200);
});
