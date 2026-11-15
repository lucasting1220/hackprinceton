import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { type TestContext, test } from "node:test";
import type { LiveViewOpen } from "../bridge/src/live-view-commands.ts";
import {
  type BrowserProcess,
  findBrowser,
  LiveSender,
  senderBrowserArgs,
} from "../bridge/src/live-sender.ts";
import { senderPageCsp } from "../bridge/src/live-sender-page.ts";
import * as settings from "../bridge/src/settings.ts";
import { startSetupServer } from "../bridge/src/setup-server.ts";
import { utcSeconds } from "../bridge/src/wire.ts";
import { makeTempDir, waitFor } from "./coordinator-fixtures.ts";

const CHROME = settings.LIVE_SENDER_MACOS_BROWSER;

/** A browser that records its start and its kill, and can close by itself. */
class FakeBrowsers {
  readonly started: Array<{ file: string; args: readonly string[] }> = [];
  readonly killed: number[] = [];
  readonly #exits: Array<(how: string) => void> = [];

  readonly spawn = (file: string, args: readonly string[]): BrowserProcess => {
    const index = this.started.length;
    this.started.push({ file, args });
    let exit: (how: string) => void = () => undefined;
    const exited = new Promise<string>((resolve) => {
      exit = resolve;
    });
    this.#exits.push(exit);
    return {
      kill: () => {
        this.killed.push(index);
        exit("it ended with SIGTERM");
      },
      exited,
    };
  };

  /** Browser `index` closes by itself, as when the person closes its window. */
  closeByItself(index: number): void {
    this.#exits[index]?.("it ended with 0");
  }
}

function openCommand(expiresInMs = 300_000): LiveViewOpen {
  const id = randomUUID();
  return {
    type: "live_view_open",
    session_id: id,
    sender_token: randomBytes(32).toString("base64url"),
    signaling_url: `wss://relay.example.com${settings.LIVE_VIEW_PATH}/${id}/signal`,
    expires_at: utcSeconds(new Date(Date.now() + expiresInMs)),
  };
}

async function sender(t: TestContext, find: () => string | undefined = () => CHROME) {
  const stateDir = await makeTempDir();
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const workerConfigFile = path.join(stateDir, "worker.json");
  await writeFile(workerConfigFile, JSON.stringify({ frame_feed_port: 7999 }), "utf8");
  const browsers = new FakeBrowsers();
  const lost: string[] = [];
  const logs: string[] = [];
  const live = new LiveSender({
    stateDir,
    pageUrl: "http://127.0.0.1:7470/live-sender",
    workerConfigFile,
    onLost: (sessionId) => lost.push(sessionId),
    log: (line) => logs.push(line),
    spawn: browsers.spawn,
    findBrowser: find,
  });
  t.after(() => live.close());
  return { live, browsers, lost, logs, stateDir };
}

test("Chrome at its macOS place, Chrome then Edge in Windows' program folders, none elsewhere", () => {
  const only = (file: string) => (candidate: string) => candidate === file;
  assert.equal(findBrowser("darwin", {}, only(CHROME)), CHROME);
  assert.equal(
    findBrowser("darwin", {}, () => false),
    undefined,
  );
  const chrome = "D:\\Apps\\Google\\Chrome\\Application\\chrome.exe";
  assert.equal(findBrowser("win32", { ProgramFiles: "D:\\Apps" }, only(chrome)), chrome);
  const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  assert.equal(findBrowser("win32", {}, only(edge)), edge);
  const both = (file: string) => file.endsWith("chrome.exe") || file.endsWith("msedge.exe");
  assert.match(findBrowser("win32", {}, both) ?? "", /chrome\.exe$/);
  assert.equal(
    findBrowser("linux", {}, () => true),
    undefined,
  );
});

test("the sender window's arguments: one app window, its own profile, no throttling", () => {
  const state = path.join("/state", "debbie");
  assert.deepEqual(senderBrowserArgs("http://127.0.0.1:7470/live-sender", state), [
    "--app=http://127.0.0.1:7470/live-sender",
    `--user-data-dir=${path.join(state, "live-sender-browser")}`,
    "--kiosk",
    "--no-first-run",
    "--no-default-browser-check",
    "--autoplay-policy=no-user-gesture-required",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
  ]);
});

test("live_view_open serves the page and starts the window; live_view_close kills it", async (t) => {
  const s = await sender(t);
  assert.equal(s.live.reply(), undefined);
  const open = openCommand();
  await s.live.handle(open);
  assert.deepEqual(s.browsers.started, [
    { file: CHROME, args: senderBrowserArgs("http://127.0.0.1:7470/live-sender", s.stateDir) },
  ]);
  const reply = s.live.reply();
  assert.match(reply?.page ?? "", new RegExp(open.session_id));
  assert.equal(
    reply?.csp,
    senderPageCsp({
      sessionId: open.session_id,
      senderToken: open.sender_token,
      signalingUrl: open.signaling_url,
      expiresAt: open.expires_at,
      frameFeedPort: 7999,
      liveViewTimeLimitS: settings.LIVE_VIEW_SESSION_MS / 1000,
    }),
  );
  assert.match(
    reply?.csp ?? "",
    /connect-src ws:\/\/127\.0\.0\.1:7999 wss:\/\/relay\.example\.com/,
  );
  await s.live.handle(open); // a repeat changes nothing
  assert.equal(s.browsers.started.length, 1);
  await s.live.handle({ type: "live_view_close", session_id: "other", reason: "stopped" });
  assert.deepEqual(s.browsers.killed, []);
  await s.live.handle({ type: "live_view_close", session_id: open.session_id, reason: "stopped" });
  assert.deepEqual(s.browsers.killed, [0]);
  assert.equal(s.live.reply(), undefined);
  assert.deepEqual(s.lost, [], "closed on purpose, so not lost");
  assert.ok(!s.logs.join("\n").includes(open.sender_token));
});

test("a newer session's open kills the older window first", async (t) => {
  const s = await sender(t);
  const first = openCommand();
  const second = openCommand();
  await s.live.handle(first);
  await s.live.handle(second);
  assert.deepEqual(s.browsers.killed, [0]);
  assert.equal(s.browsers.started.length, 2);
  assert.equal(s.live.sessionId(), second.session_id);
});

test("at expires_at the window is killed and the page gone", async (t) => {
  const s = await sender(t);
  await s.live.handle(openCommand(1_200));
  assert.notEqual(s.live.reply(), undefined);
  await waitFor(() => s.browsers.killed.length === 1, 5_000);
  assert.equal(s.live.reply(), undefined);
  await s.live.handle(openCommand(-1_000));
  assert.equal(s.browsers.started.length, 1, "an open that already ended starts nothing");
});

test("no browser: a clear line, no page, and the hub is told the session is lost", async (t) => {
  const s = await sender(t, () => undefined);
  const open = openCommand();
  await s.live.handle(open);
  assert.deepEqual(s.lost, [open.session_id]);
  assert.equal(s.live.reply(), undefined);
  assert.ok(s.logs.some((line) => line.includes("no Chrome (or Edge on Windows) found")));
});

test("a window that closes by itself is reported lost", async (t) => {
  const s = await sender(t);
  const open = openCommand();
  await s.live.handle(open);
  s.browsers.closeByItself(0);
  await waitFor(() => s.lost.length === 1);
  assert.deepEqual(s.lost, [open.session_id]);
  assert.equal(s.live.reply(), undefined);
});

test("GET /live-sender is served only while a session is open, under its own policy", async (t) => {
  const [repoRoot, stateDir] = [await makeTempDir(), await makeTempDir()];
  const browsers = new FakeBrowsers();
  const lines: string[] = [];
  const server = await startSetupServer({
    stateDir,
    repoRoot,
    port: 0,
    log: (line) => lines.push(line),
    liveSender: { spawn: browsers.spawn, findBrowser: () => CHROME },
  });
  t.after(async () => {
    await server.close();
    for (const dir of [repoRoot, stateDir]) await rm(dir, { recursive: true, force: true });
  });
  const url = new URL(settings.LIVE_SENDER_PATH, server.url);
  const get = () => fetch(url, { signal: AbortSignal.timeout(5_000) });
  const before = await get();
  await before.body?.cancel();
  assert.equal(before.status, 404);
  const open = openCommand();
  await server.liveSender.handle(open);
  assert.equal(browsers.started[0]?.args[0], `--app=${url.href}`);
  const during = await get();
  const page = await during.text();
  assert.equal(during.status, 200);
  assert.match(page, new RegExp(open.session_id));
  const csp = during.headers.get("content-security-policy") ?? "";
  assert.match(csp, /script-src 'sha256-/);
  assert.match(csp, new RegExp(`ws://127\\.0\\.0\\.1:${settings.FRAME_FEED_PORT}`));
  await server.liveSender.handle({
    type: "live_view_close",
    session_id: open.session_id,
    reason: "stopped",
  });
  const after = await get();
  await after.body?.cancel();
  assert.equal(after.status, 404);
  assert.ok(!lines.join("\n").includes(open.sender_token));
});
