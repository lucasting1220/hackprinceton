import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

test("the checks run on the Node major version that .nvmrc pins", async () => {
  const nvmrc = path.join(import.meta.dirname, "..", ".nvmrc");
  const pinned = (await readFile(nvmrc, { encoding: "utf8" })).trim();
  const running = process.versions.node;
  assert.equal(
    running.split(".")[0],
    pinned.split(".")[0],
    `running Node ${running}, but layer1/.nvmrc pins ${pinned}: put Node ${pinned} first on PATH`,
  );
});
