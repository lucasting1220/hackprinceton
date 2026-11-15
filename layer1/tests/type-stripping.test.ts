import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { layer1, layer1Files } from "./layer1-files.ts";

const LOAD_CHECK_TIMEOUT_MS = 10_000;

test("Layer 1's code is all .ts files outside dot-folders, the only ones tsc and npm test pick up", () => {
  // tsconfig.json checks **/*.ts and npm test runs **/*.test.ts. Neither looks inside a folder whose
  // name starts with a dot, and neither picks up a .mts, .cts or .tsx file that no .ts file imports,
  // a .test.mts file, an upper-case .TS file or any JavaScript file.
  const code = /\.[cm]?[jt]sx?$/i;
  const inDotFolder = (file: string): boolean =>
    file
      .split(path.sep)
      .slice(0, -1)
      .some((folder) => folder.startsWith("."));
  const unseen = layer1Files().filter(
    (file) => code.test(file) && (!file.endsWith(".ts") || inDotFolder(file)),
  );
  assert.deepEqual(
    unseen,
    [],
    "make these .ts files outside dot-folders, which tsc checks and npm test runs",
  );
});

test("every .ts, .mts and .cts file outside tests/ loads under Node's type stripping", () => {
  // tests/ is left out because the test runner loads it anyway. Declaration files are left out
  // because Node never loads them; like TypeScript, this treats any name containing ".d." as one.
  // .mts and .cts files are loaded too, in case one gets past the test above.
  const files = layer1Files().filter(
    (file) =>
      /\.[cm]?ts$/.test(file) &&
      !path.basename(file).includes(".d.") &&
      file.split(path.sep)[0] !== "tests",
  );
  assert.ok(files.length > 0, "found no .ts, .mts or .cts file outside tests/ to load");
  // `node --check` cannot do this: on Node 24 it does not strip types, so it rejects valid typed
  // code such as `const x: number = 1;`. Instead a child Node imports every file. It loads every
  // ES module before it runs any, stripping types as it loads, so a syntax error or an enum fails
  // there. It runs imports in order, so the first import exits before any of these files runs. A
  // .cts file is CommonJS, which Node compiles only when it runs, so this can miss an error in one,
  // such as a decorator; the test above keeps .cts files out.
  const urls = files.map((file) => pathToFileURL(path.join(layer1, file)).href);
  const entry = ["data:text/javascript,process.exit(0)", ...urls]
    .map((url) => `import ${JSON.stringify(url)};`)
    .join("\n");
  // The child does not get NODE_OPTIONS, which may turn on --experimental-transform-types or a
  // loader that accepts what type stripping rejects, such as an enum. The name is compared without
  // case, as Windows does.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => name.toUpperCase() !== "NODE_OPTIONS"),
  );
  const result = spawnSync(process.execPath, ["--input-type=module"], {
    input: entry,
    encoding: "utf8",
    env,
    timeout: LOAD_CHECK_TIMEOUT_MS,
  });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
});
