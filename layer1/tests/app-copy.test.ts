import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { appCopy, layer1Files } from "./layer1-files.ts";

test("the iPhone app's copy keeps its CLAUDE.md as APP_CLAUDE.md, so its rules don't load here", () => {
  // Claude Code reads a folder's CLAUDE.md as instructions when it works on files there. The app's
  // says to commit only locally, never push and treat this repository as read-only, which are the
  // app repository's rules, not this one's (README.md, "The iPhone app").
  const copy = layer1Files().filter((file) => file.split(path.sep)[0] === appCopy);
  assert.ok(
    copy.includes(path.join(appCopy, "APP_CLAUDE.md")),
    "found no debbie-ios/APP_CLAUDE.md, the app's own rules",
  );
  const loaded = copy.filter((file) => /^claude(\.local)?\.md$/i.test(path.basename(file)));
  assert.deepEqual(loaded, [], "rename these to APP_CLAUDE.md");
});
