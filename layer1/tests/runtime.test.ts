import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

test("the checks run on the Node major version that .nvmrc pins", async () => {
  const nvmrc = path.join(import.meta.dirname, "..", ".nvmrc");
  const pinned = (await readFile(nvmrc, { encoding: "utf8" })).trim();
  // 24, 24.22 or 24.22.3, with or without the leading "v" that `node -v > .nvmrc` writes.
  const major = /^v?(\d+)(?:\.\d+){0,2}$/.exec(pinned)?.[1];
  assert.ok(
    major !== undefined,
    `layer1/.nvmrc holds "${pinned}": it must hold a Node version number such as 24 or v24.22.3, not an alias`,
  );
  const running = process.versions.node;
  assert.equal(
    running.split(".")[0],
    major,
    `running Node ${running}, but layer1/.nvmrc pins ${pinned}: put Node ${major} first on PATH`,
  );
});
