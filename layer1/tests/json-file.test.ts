import assert from "node:assert/strict";
import fsPromises, { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, type TestContext, test } from "node:test";
import {
  JsonFileError,
  readJsonFile,
  retryWhileBusy,
  writeFileWhole,
} from "../bridge/src/json-file.ts";
import { FILE_BUSY_RETRY_MS } from "../bridge/src/settings.ts";

async function tempDir(t: TestContext): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "l1-json-file-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

const systemError = (code: string) => Object.assign(new Error(`${code}: simulated`), { code });

/**
 * Makes `name` from fs/promises fail twice with EPERM, as on Windows while a scanner has the file.
 * Its after hook puts the real one back, since t.mock restores only after every after hook.
 */
function busyTwice(t: TestContext, name: "link" | "readFile" | "rename" | "rm") {
  const spy = t.mock.method(fsPromises, name);
  for (const call of [0, 1]) {
    spy.mock.mockImplementationOnce(() => Promise.reject(systemError("EPERM")), call);
  }
  syncBuiltinESMExports();
  t.after(() => {
    spy.mock.restore();
    syncBuiltinESMExports();
  });
  return spy.mock;
}

describe("writeFileWhole", () => {
  test("swaps a new file in whole and leaves no temporary file", async (t) => {
    const dir = await tempDir(t);
    const file = path.join(dir, "data.json");
    await writeFileWhole(file, JSON.stringify({ long: "x".repeat(10_000) }));
    // As bigints: Windows file IDs can exceed 2^53, where two numbers can round to the same value.
    const inode = async () => (await stat(file, { bigint: true })).ino;
    const before = await inode();
    await writeFileWhole(file, '{"short":1}');
    assert.deepEqual(await readJsonFile(file), { short: 1 });
    assert.notEqual(await inode(), before, "the file was rewritten in place");
    assert.deepEqual(await readdir(dir), ["data.json"]);
  });

  test("an exclusive write never replaces a file, and its failure leaves no temporary file", async (t) => {
    const dir = await tempDir(t);
    const file = path.join(dir, "home.json");
    await writeFileWhole(file, '{"first":true}', { exclusive: true });
    await assert.rejects(
      writeFileWhole(file, '{"second":true}', { exclusive: true }),
      (error) => error instanceof JsonFileError && error.code === "EEXIST",
    );
    assert.deepEqual(await readJsonFile(file), { first: true });
    assert.deepEqual(await readdir(dir), ["home.json"]);
  });

  test("writes, reads and removals each wait out a file that Windows reports busy", async (t) => {
    const busy = (["rename", "link", "rm", "readFile"] as const).map((name) => busyTwice(t, name));
    const dir = await tempDir(t);
    await writeFileWhole(path.join(dir, "a.json"), '{"a":1}');
    await writeFileWhole(path.join(dir, "b.json"), '{"b":2}', { exclusive: true });
    assert.deepEqual(await readJsonFile(path.join(dir, "a.json")), { a: 1 });
    const calls = busy.map((mock) => mock.callCount());
    assert.deepEqual(calls, [3, 3, 3, 3], "rename, link, rm and readFile: two busy, then done");
    assert.deepEqual((await readdir(dir)).sort(), ["a.json", "b.json"]);
  });
});

describe("retryWhileBusy", () => {
  test("retries EBUSY, EPERM and EACCES until the action succeeds", async () => {
    const codes = ["EBUSY", "EPERM", "EACCES"];
    let calls = 0;
    const result = await retryWhileBusy(async () => {
      const code = codes[calls++];
      if (code === undefined) return "done";
      throw systemError(code);
    });
    assert.deepEqual([result, calls], ["done", 4]);
  });

  test("gives up after the time bound and reports the error", async () => {
    let calls = 0;
    const started = performance.now();
    const alwaysBusy = async () => {
      calls++;
      throw systemError("EBUSY");
    };
    await assert.rejects(retryWhileBusy(alwaysBusy), { code: "EBUSY" });
    assert.ok(performance.now() - started >= FILE_BUSY_RETRY_MS && calls > 1);
  });

  test("does not retry any other error", async () => {
    let calls = 0;
    const missing = async () => {
      calls++;
      throw systemError("ENOENT");
    };
    await assert.rejects(retryWhileBusy(missing), { code: "ENOENT" });
    assert.equal(calls, 1);
  });
});

describe("readJsonFile", () => {
  test("reports invalid JSON with the file's path but none of its text", async (t) => {
    const file = path.join(await tempDir(t), "bad.json");
    await writeFile(file, "{ not-json", { encoding: "utf8" });
    await assert.rejects(
      readJsonFile(file),
      (error) =>
        error instanceof JsonFileError &&
        error.filePath === file &&
        error.message.includes(file) &&
        !error.message.includes("not-json") &&
        error.cause === undefined,
    );
  });

  test("accepts a byte-order mark, which Windows editors often add", async (t) => {
    const file = path.join(await tempDir(t), "bom.json");
    await writeFile(file, '\uFEFF{"a":1}', { encoding: "utf8" });
    assert.deepEqual(await readJsonFile(file), { a: 1 });
  });
});
