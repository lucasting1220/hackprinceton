import assert from "node:assert/strict";
import { createSecretKey, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { sealAlert, sealMonitoring } from "../bridge/src/home-messages.ts";
import { Outbox, OutboxError } from "../bridge/src/outbox.ts";
import * as settings from "../bridge/src/settings.ts";
import type { Wrapper } from "../bridge/src/wire.ts";

const HOME = { homeId: "home-1", homeKey: createSecretKey(randomBytes(32)) };
const START_MS = Date.UTC(2026, 10, 14, 15, 10, 0);
const DAY_MS = 24 * 60 * 60_000;
const everyone = () => true;

const alert = (title = "Possible fall") =>
  sealAlert(
    {
      alert_id: `a-${randomBytes(4).toString("hex")}`,
      kind: "fall",
      severity: "urgent",
      detected_at: "2026-11-14T15:09:00Z",
      title,
      body: "STUB: a test alert",
      update: false,
    },
    HOME,
  );

async function folder(t: TestContext): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "l1-outbox-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function opener(dir: string) {
  const clock = { ms: START_MS };
  const lines: string[] = [];
  const open = () => Outbox.open(dir, { now: () => clock.ms, log: (line) => lines.push(line) });
  return { clock, lines, open };
}

const ids = (wrappers: readonly Wrapper[]) => wrappers.map((wrapper) => wrapper.msg_id);

test("an append comes back in a page from null with a cursor; from that cursor nothing", async (t) => {
  const { open } = opener(await folder(t));
  const outbox = await open();
  assert.deepEqual(outbox.page(null, 50, everyone), { messages: [], next: null });
  const sent = alert();
  assert.equal(await outbox.append(sent), 1);
  const first = outbox.page(null, 50, everyone);
  assert.deepEqual(first.messages, [sent]);
  assert.match(first.next ?? "", /^l\.[A-Za-z0-9_-]{12}\.1$/);
  assert.deepEqual(outbox.page(first.next, 50, everyone), { messages: [], next: first.next });
});

test("the file is owner-only, holds wrappers and no plaintext, and a second outbox reads it", async (t) => {
  const dir = await folder(t);
  const { open } = opener(dir);
  const outbox = await open();
  const sent = [alert("Secret title one"), alert("Secret title two")];
  for (const wrapper of sent) await outbox.append(wrapper);
  const bytes = await readFile(outbox.file, "utf8");
  assert.ok(!bytes.includes("Secret title"), "the outbox holds a plaintext title");
  assert.ok(!bytes.includes("STUB: a test alert"), "the outbox holds a plaintext body");
  if (process.platform !== "win32") assert.equal((await stat(outbox.file)).mode & 0o777, 0o600);
  const again = await open();
  const page = again.page(null, 50, everyone);
  assert.deepEqual(page.messages, sent);
  assert.equal(page.next, outbox.page(null, 50, everyone).next);
  assert.equal(await again.append(alert()), 3, "numbering goes on from where the first stopped");
});

test("a foreign, malformed or null cursor starts at the oldest kept message", async (t) => {
  const { open } = opener(await folder(t));
  const outbox = await open();
  const sent = [alert(), alert()];
  for (const wrapper of sent) await outbox.append(wrapper);
  const own = outbox.page(null, 50, everyone).next ?? "";
  const otherEpoch = own.replace(/^l\.[^.]+\./, "l.AAAAAAAAAAAA.");
  for (const after of [null, "r.17", "garbage", otherEpoch, own.replace(/\.2$/, ".99"), "l..1"]) {
    const page = outbox.page(after, 50, everyone);
    assert.deepEqual(ids(page.messages), ids(sent), String(after));
    assert.equal(page.next, own);
  }
  assert.deepEqual(
    outbox.page("r.17", 50, () => false),
    { messages: [], next: own },
  );
});

test("pages go oldest first, at most limit and at most 50, and skip what a phone may not have", async (t) => {
  const { open } = opener(await folder(t));
  const outbox = await open();
  const sent: Wrapper[] = [];
  for (let index = 0; index < 60; index += 1) {
    const wrapper = alert();
    sent.push(wrapper);
    await outbox.append(wrapper);
  }
  const one = outbox.page(null, 1, everyone);
  assert.deepEqual(ids(one.messages), ids(sent.slice(0, 1)));
  const two = outbox.page(one.next, 2, everyone);
  assert.deepEqual(ids(two.messages), ids(sent.slice(1, 3)));
  const capped = outbox.page(null, 500, everyone);
  assert.equal(capped.messages.length, settings.MESSAGES_PAGE_MAX);
  const rest = outbox.page(capped.next, 500, everyone);
  assert.deepEqual(ids(rest.messages), ids(sent.slice(50)));
  const none = outbox.page(null, 50, () => false);
  assert.deepEqual(none.messages, []);
  assert.match(none.next ?? "", /\.60$/, "next is the last message examined");
});

test("retention drops by age, at append and at load, and seqs stay", async (t) => {
  const dir = await folder(t);
  const { clock, open } = opener(dir);
  const outbox = await open();
  const old = alert();
  await outbox.append(old);
  clock.ms += DAY_MS;
  const young = alert();
  await outbox.append(young);
  clock.ms = START_MS + 7 * DAY_MS + 1_000;
  assert.deepEqual(ids(outbox.page(null, 50, everyone).messages), ids([young]));
  assert.deepEqual(ids((await open()).page(null, 50, everyone).messages), ids([young]));
  assert.equal(await outbox.append(alert()), 3);
  const saved = JSON.parse(await readFile(outbox.file, "utf8")) as { messages: { seq: number }[] };
  assert.deepEqual(
    saved.messages.map((entry) => entry.seq),
    [2, 3],
  );
});

test("retention keeps the newest maximum, at load and at append", async (t) => {
  const dir = await folder(t);
  const { open } = opener(dir);
  const wrapper = alert();
  const over = settings.OUTBOX_MESSAGES_MAX + 1;
  const messages = Array.from({ length: over }, (_, index) => ({
    seq: index + 1,
    created_at: "2026-11-14T15:10:00Z",
    wrapper,
  }));
  const file = path.join(dir, settings.OUTBOX_FILE_NAME);
  const saved = { schema_version: 1, epoch: "AAAAAAAAAAAA", next_seq: over + 1, messages };
  await writeFile(file, JSON.stringify(saved), "utf8");
  const outbox = await open();
  assert.equal(outbox.page(null, 50, everyone).next, "l.AAAAAAAAAAAA.51", "seq 1 was dropped");
  assert.equal(await outbox.append(alert()), over + 1);
  const kept = JSON.parse(await readFile(file, "utf8")) as { messages: { seq: number }[] };
  assert.equal(kept.messages.length, settings.OUTBOX_MESSAGES_MAX);
  assert.equal(kept.messages[0]?.seq, 3);
});

test("an unreadable file is set aside and reported, and the new outbox has a new epoch", async (t) => {
  const dir = await folder(t);
  const { open, lines } = opener(dir);
  const first = await open();
  await first.append(alert());
  const epoch = first.page(null, 50, everyone).next?.split(".")[1];
  await writeFile(first.file, "{ not json", "utf8");
  const second = await open();
  assert.deepEqual(second.page(null, 50, everyone), { messages: [], next: null });
  const names = await readdir(dir);
  assert.ok(names.includes("outbox.json.unreadable-20261114T151000Z"), names.join(", "));
  const [problem] = second.problems();
  assert.match(problem ?? "", /^The alert store was unreadable .* set aside as .*unreadable-/);
  assert.equal(lines.length, 1);
  await second.append(alert());
  assert.notEqual(second.page(null, 50, everyone).next?.split(".")[1], epoch);
});

test("a failed write rejects, changes nothing, is reported, and the next append works", async (t) => {
  const dir = await folder(t);
  const { open } = opener(dir);
  const outbox = await open();
  const kept = alert();
  await outbox.append(kept);
  await rm(outbox.file);
  await mkdir(outbox.file); // a folder where the file goes: neither read nor rename can work
  await assert.rejects(outbox.append(alert()), OutboxError);
  assert.deepEqual(ids(outbox.page(null, 50, everyone).messages), ids([kept]));
  assert.match(outbox.problems()[0] ?? "", /^Alerts can't be saved: /);
  await rm(outbox.file, { recursive: true });
  assert.equal(await outbox.append(alert()), 2);
  assert.deepEqual(outbox.problems(), []);
});

test("ten appends at once get ten different seqs, and the file holds all ten", async (t) => {
  const dir = await folder(t);
  const outbox = await opener(dir).open();
  const seqs = await Promise.all(Array.from({ length: 10 }, () => outbox.append(alert())));
  assert.deepEqual(
    [...seqs].sort((a, b) => a - b),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
  const again = await opener(dir).open();
  assert.equal(again.page(null, 50, everyone).messages.length, 10);
});

test("pending lists unmarked messages oldest first, from a time and up to a limit", async (t) => {
  const { clock, open } = opener(await folder(t));
  const outbox = await open();
  const sent = [alert("one"), alert("two"), alert("three")];
  for (const wrapper of sent) {
    await outbox.append(wrapper);
    clock.ms += 60_000;
  }
  const pending = (limit: number, from?: string) =>
    ids(outbox.pending(limit, from).map((entry) => entry.wrapper));
  assert.deepEqual(pending(10), ids(sent));
  assert.deepEqual(pending(2), ids(sent.slice(0, 2)));
  assert.deepEqual(pending(10, "2026-11-14T15:11:00Z"), ids(sent.slice(1)));
});

test("relayed and refused marks are saved, kept for the LAN, and never pending again", async (t) => {
  const dir = await folder(t);
  const { open } = opener(dir);
  const outbox = await open();
  const [relayed, refused, waiting] = [alert(), alert(), alert()];
  for (const wrapper of [relayed, refused, waiting]) await outbox.append(wrapper);
  await outbox.markRelayed(relayed.msg_id);
  await outbox.markRefused(refused.msg_id);
  await outbox.markRelayed("not-in-the-outbox");
  await outbox.markRelayed(refused.msg_id); // a refused message stays refused
  for (const box of [outbox, await open()]) {
    assert.deepEqual(ids(box.pending(10).map((entry) => entry.wrapper)), ids([waiting]));
    assert.deepEqual(ids(box.page(null, 50, everyone).messages), ids([relayed, refused, waiting]));
    assert.match(box.problems().join("\n"), /The relay refused 1 message\(s\)/);
  }
  const file = JSON.parse(await readFile(outbox.file, "utf8")) as {
    messages: { relay?: string }[];
  };
  assert.deepEqual(
    file.messages.map((entry) => entry.relay),
    ["relayed", "refused", undefined],
  );
});

test("an outbox written before relay states loads with every message pending; a bad state doesn't", async (t) => {
  const dir = await folder(t);
  const { open, lines } = opener(dir);
  const first = await open();
  const sent = alert();
  await first.append(sent);
  assert.deepEqual(ids((await open()).pending(10).map((entry) => entry.wrapper)), ids([sent]));
  const file = JSON.parse(await readFile(first.file, "utf8")) as { messages: object[] };
  const broken = { ...file, messages: file.messages.map((entry) => ({ ...entry, relay: "gone" })) };
  await writeFile(first.file, JSON.stringify(broken), "utf8");
  assert.deepEqual((await open()).pending(10), []);
  assert.match(lines.join("\n"), /set aside/);
});

test("onAdded hears each saved append until it is stopped", async (t) => {
  const { open } = opener(await folder(t));
  const outbox = await open();
  let heard = 0;
  const stop = outbox.onAdded(() => {
    heard += 1;
  });
  await outbox.append(alert());
  stop();
  await outbox.append(alert());
  assert.equal(heard, 1);
});

test("the outbox keeps only the newest monitoring snapshot, and every alert", async (t) => {
  const { open } = opener(await folder(t));
  const outbox = await open();
  const first = alert();
  await outbox.append(first);
  const snapshots = ["starting", "degraded", "ok"].map((state) => sealMonitoring({ state }, HOME));
  for (const snapshot of snapshots) await outbox.append(snapshot);
  const second = alert();
  await outbox.append(second);
  const kept = outbox.page(null, 50, everyone).messages;
  assert.deepEqual(ids(kept), ids([first, snapshots[2] ?? first, second]));
});
