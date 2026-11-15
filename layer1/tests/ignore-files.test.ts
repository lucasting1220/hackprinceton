import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { layer1 } from "./layer1-files.ts";

// Biome reads only the repository's root .gitignore, not layer1/.gitignore. Without a matching "!"
// entry in biome.json, lint and format would read a folder that git and the guard tests leave out.
test("biome.json leaves out every entry of layer1/.gitignore", () => {
  const read = (name: string): string =>
    readFileSync(path.join(layer1, name), { encoding: "utf8" });
  const ignored = read(".gitignore")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => `!${line.replace(/^\/|\/$/g, "")}`);
  const biome = JSON.parse(read("biome.json")) as { files: { includes: string[] } };
  assert.deepEqual(
    ignored.filter((entry) => !biome.files.includes.includes(entry)),
    [],
    "add these to files.includes in biome.json",
  );
});
