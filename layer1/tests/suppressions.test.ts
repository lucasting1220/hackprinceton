import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { layer1, layer1Files } from "./layer1-files.ts";

// Joined from parts so that this file does not match itself. Compared without case, because tsc
// also obeys the no-check comment in capitals.
const forbidden = [
  ["@ts", "ignore"],
  ["@ts", "expect-error"],
  ["@ts", "nocheck"],
  ["biome", "ignore"],
].map((parts) => parts.join("-"));

// Every file, whatever its extension: Biome also reads JavaScript, CSS, SCSS, HTML, JSON, Markdown
// and YAML files, among others, and tsc checks any .mts or .cts file that a .ts file imports.
test("no file suppresses a type check or a lint rule (CLAUDE.md section 5)", () => {
  const found: string[] = [];
  for (const file of layer1Files()) {
    const lines = readFileSync(path.join(layer1, file), { encoding: "utf8" }).split("\n");
    for (const [index, line] of lines.entries()) {
      const token = forbidden.find((suppression) => line.toLowerCase().includes(suppression));
      if (token !== undefined) {
        found.push(`${file}:${index + 1} uses ${token}`);
      }
    }
  }
  assert.deepEqual(found, [], "fix the code instead of suppressing the check");
});
