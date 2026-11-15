import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { layer1, layer1Files } from "./layer1-files.ts";

const LOAD_CHECK_TIMEOUT_MS = 10_000;

test("every .ts and .mts file outside tests/ loads under Node's type stripping", () => {
  // tests/ is left out because the test runner loads it anyway. Declaration files are left out
  // because Node never loads them; like TypeScript, this treats any name containing ".d." as one.
  const files = layer1Files().filter(
    (file) =>
      /\.m?ts$/.test(file) &&
      !path.basename(file).includes(".d.") &&
      file.split(path.sep)[0] !== "tests",
  );
  assert.ok(files.length > 0, "found no .ts or .mts file outside tests/ to load");
  // `node --check` passes any .ts file on Node 24 without stripping its types. Instead a child Node
  // imports them all: it strips, parses and links every module before it evaluates any, and it
  // evaluates imports in order, so the first import exits before any of these files runs. That holds
  // for ES modules: every .ts and .mts file while package.json says "type": "module". Node compiles
  // CommonJS only when it runs it, so this check cannot see a syntax error there and leaves out .cts.
  const urls = files.map((file) => pathToFileURL(path.join(layer1, file)).href);
  const entry = ["data:text/javascript,process.exit(0)", ...urls]
    .map((url) => `import ${JSON.stringify(url)};`)
    .join("\n");
  const result = spawnSync(process.execPath, ["--input-type=module"], {
    input: entry,
    encoding: "utf8",
    timeout: LOAD_CHECK_TIMEOUT_MS,
  });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
});
