import assert from "node:assert/strict";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { type IncomingMessage, request } from "node:http";
import path from "node:path";
import { text } from "node:stream/consumers";
import { type TestContext, test } from "node:test";
import { createHome, loadHome } from "../bridge/src/home.ts";
import { readJsonFile } from "../bridge/src/json-file.ts";
import { browserCommand, openInBrowser, startSetupServer } from "../bridge/src/setup-server.ts";
import * as settings from "../bridge/src/settings.ts";
import { freePort, makeTempDir, STUB, waitFor } from "./coordinator-fixtures.ts";

/** A setup server on a free port for an empty state folder, in a repository whose stub is `stub`. */
async function serve(t: TestContext, stub?: string) {
  const [repoRoot, stateDir] = [await makeTempDir(), await makeTempDir()];
  const stubFile = path.join(repoRoot, ...settings.COORDINATOR_STUB_PATH);
  await mkdir(path.dirname(stubFile), { recursive: true });
  await writeFile(stubFile, stub ?? (await readFile(STUB, "utf8")), "utf8");
  const { COORDINATOR_LISTEN_PORT: listen, COORDINATOR_CLIENT_PORT: client } = settings;
  const dashboard = await freePort(); // the only port the stub opens
  const lines: string[] = [];
  const homeOptions = { ports: { listen, dashboard, client } };
  const log = (line: string) => lines.push(line);
  const server = await startSetupServer({ stateDir, repoRoot, port: 0, homeOptions, log });
  t.after(async () => {
    await server.close();
    for (const dir of [repoRoot, stateDir]) await rm(dir, { recursive: true, force: true });
  });
  const { port } = new URL(server.url);
  const browser = { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` };
  /** Sends a request as the browser would from the setup page, with `headers` changed. */
  const send = (method: string, target: string, headers = {}, body = "") =>
    new Promise<IncomingMessage & { page: string }>((resolve, reject) => {
      const options = { host: "127.0.0.1", port, method, path: target, timeout: 5_000 };
      const sent = request({ ...options, headers: { ...browser, ...headers } }, (reply) => {
        text(reply).then((page) => resolve(Object.assign(reply, { page })), reject);
      });
      sent.on("timeout", () => sent.destroy(new Error("no answer"))).on("error", reject);
      sent.end(body);
    });
  const token = async () => /name="token" value="([^"]+)"/.exec((await send("GET", "/")).page)?.[1];
  const post = (sent = "", headers = {}) => send("POST", "/home", headers, `token=${sent}`);
  return { server, stateDir, dashboard, lines, send, token, post };
}

test("answers on 127.0.0.1 only for its own Host, and a POST only from its page", async (t) => {
  const s = await serve(t);
  assert.equal(new URL(s.server.url).hostname, "127.0.0.1");
  const port = Number(new URL(s.server.url).port);
  const welcome = await s.send("GET", "/");
  assert.match(welcome.page, /<button>Create a home<\/button>/);
  assert.match(welcome.page, /<button disabled>Join a home<\/button> Coming in build step 3/);
  const h = welcome.headers;
  const security = [h["content-security-policy"], h["referrer-policy"], h["cache-control"]];
  const csp = "default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'";
  assert.deepEqual([welcome.statusCode, ...security], [200, csp, "same-origin", "no-store"]);
  assert.equal((await s.send("GET", "/", { host: `localhost:${port}` })).statusCode, 200);
  for (const host of [`rebound.example:${port}`, "rebound.example", "127.0.0.1:1"]) {
    assert.equal((await s.send("GET", "/", { host })).statusCode, 403, host);
  }
  const token = await s.token();
  for (const origin of ["http://other.example", "null", ""]) {
    assert.equal((await s.post(token, { origin })).statusCode, 403, origin);
  }
  assert.equal((await s.post()).statusCode, 403, "no token");
  const large = `token=${token}&${"x".repeat(settings.SETUP_MAX_BODY_BYTES)}`;
  assert.equal((await s.send("POST", "/home", {}, large)).statusCode, 413);
  assert.equal(await loadHome(s.stateDir), undefined, "no home was created");
  assert.ok(token && s.lines.every((line) => !line.includes(token)), "a log line holds the token");
  const again = startSetupServer({ stateDir: s.stateDir, repoRoot: s.stateDir, port });
  const message = `127.0.0.1:${port} is in use, probably by another bridge: stop it, then start again`;
  await assert.rejects(again, { message });
});

test("a POST with the token of an earlier bridge run gets a page that says to reload", async (t) => {
  const earlier = await serve(t);
  const token = await earlier.token();
  await earlier.server.close();
  const stale = await (await serve(t)).post(token);
  assert.equal(stale.statusCode, 403);
  assert.match(stale.page, /from an earlier run of the bridge\.\n<a href="\/">Reload it<\/a>/);
});

test("Create a home shows the home and starts the stub, which its dashboard link reaches", async (t) => {
  const s = await serve(t);
  const created = await s.post(await s.token());
  const home = await loadHome(s.stateDir);
  assert.ok(home !== undefined && created.statusCode === 200);
  const dashboard = `http://127.0.0.1:${s.dashboard}/`;
  const shown = [home.homeId, "Remote access: not set up", "Coordinator: STUB", `"${dashboard}"`];
  for (const part of shown) assert.ok(created.page.includes(part), part);
  const config = (await readJsonFile(home.coordinatorConfigFile)) as { bridge_url?: unknown };
  assert.equal(config.bridge_url, s.server.url.slice(0, -1), "bridge_url is this page's address");
  const reopened = await s.send("GET", "/home"); // the address Create a home leaves in the browser
  assert.ok(reopened.statusCode === 200 && reopened.page.includes(home.homeId), "GET /home");
  await waitFor(() => s.lines.some((line) => line.includes("ready on")));
  const state = await fetch(`${dashboard}api/state`, { signal: AbortSignal.timeout(2_000) });
  assert.equal(((await state.json()) as { schema_version: number }).schema_version, 1);
  await s.server.close();
  await assert.rejects(fetch(dashboard, { signal: AbortSignal.timeout(2_000) }), "still running");
  await s.server.startCoordinator(home); // as a creation still under way at close() would
  assert.equal(s.lines.filter((line) => line.includes("starting the STUB")).length, 1);
});

test("two creates at once give one home and one 409, and a later create gets 409", async (t) => {
  const s = await serve(t, "");
  const token = await s.token();
  const replies = [...(await Promise.all([s.post(token), s.post(token)])), await s.post(token)];
  assert.deepEqual(replies.map((reply) => reply.statusCode).sort(), [200, 409, 409]);
  const home = await loadHome(s.stateDir); // it checks that the keys on disk belong to home.json
  assert.ok(home !== undefined && replies.every((reply) => reply.page.includes(home.homeId)));
  const keys = await readdir(path.join(s.stateDir, settings.STATE_NAMES.keysDir));
  assert.deepEqual(keys.sort(), [settings.STATE_NAMES.homeKey, settings.STATE_NAMES.hubPrivateKey]);
});

test("after a crash, the page shows the coordinator's last error line, escaped", async (t) => {
  const crash = `process.stderr.write("<b>crash</b> & 'gone'\\n"); process.exitCode = 1;`;
  const s = await serve(t, crash);
  await s.post(await s.token());
  await waitFor(() => s.lines.some((line) => line.includes("the coordinator crashed")));
  const { page } = await s.send("GET", "/");
  const shown = "a crash; last error: &#60;b&#62;crash&#60;/b&#62; &#38; &#39;gone&#39;</p>";
  assert.ok(page.includes("Coordinator: STUB (Layer 2&#39;s") && page.includes(shown), page);
});

test("unreadable home files, and a coordinator that cannot start, are shown", async (t) => {
  const s = await serve(t);
  const token = await s.token();
  const homeFile = path.join(s.stateDir, settings.STATE_NAMES.home);
  await writeFile(homeFile, "{", "utf8");
  const problem = `home files unreadable: ${homeFile}: not valid JSON`;
  assert.ok((await s.send("GET", "/")).page.includes(problem));
  const refused = await s.post(token);
  assert.deepEqual([refused.statusCode, refused.page.includes(problem)], [409, true]);
  await rm(homeFile);
  await mkdir(path.join(s.stateDir, settings.STATE_NAMES.coordinatorStop)); // its stop file's place
  const created = await s.post(token);
  assert.equal(created.statusCode, 200);
  assert.match(created.page, /Coordinator: cannot start; last error: Path is a directory/);
  assert.ok(s.lines.some((line) => line.startsWith("L1 setup: cannot start the coordinator: ")));
});

test("home files that become readable while the bridge runs say to restart it", async (t) => {
  const s = await serve(t);
  await createHome(s.stateDir); // as when someone repairs them after the bridge started
  const { page } = await s.send("GET", "/");
  assert.match(page, /Coordinator: not started; restart the bridge to start it</);
});

test("opens the page with open or explorer.exe, and a failure is reported, not thrown", async () => {
  const url = "http://127.0.0.1:7470/";
  assert.deepEqual(browserCommand(url, "darwin"), { file: "open", args: [url], okCodes: [0] });
  const explorer = { file: "explorer.exe", args: [url], okCodes: [0, 1] };
  assert.deepEqual(browserCommand(url, "win32"), explorer);
  const [missing, node] = [path.join(import.meta.dirname, "no-such-opener"), process.execPath];
  const lines: string[] = [];
  const log = (line: string) => lines.push(line);
  await openInBrowser(url, { file: missing, args: [], okCodes: [0] }, log);
  await openInBrowser(url, { file: node, args: ["-e", "process.exit(3)"], okCodes: [0] }, log);
  await openInBrowser(url, { file: node, args: ["-e", "process.exit(1)"], okCodes: [0, 1] }, log);
  assert.deepEqual(lines, [
    `L1 setup: cannot run ${missing}: spawn ${missing} ENOENT; open ${url} in a browser`,
    `L1 setup: ${node} ended with 3; open ${url} in a browser`,
  ]);
});
