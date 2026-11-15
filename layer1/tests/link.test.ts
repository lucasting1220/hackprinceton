import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { type TestContext, test } from "node:test";
import { type AcceptedWorker, createHome } from "../bridge/src/home.ts";
import { LanGateway } from "../bridge/src/lan-gateway.ts";
import { linkReportInterval } from "../bridge/src/laptop.ts";
import { type LinkReport, LinkHub, sealLinkMessage, sendLinkReport } from "../bridge/src/link.ts";
import type { LiveViewOpen } from "../bridge/src/live-view-commands.ts";
import { LINK_CAMERA_REPORT_MS, LINK_REPORT_MS } from "../bridge/src/settings.ts";
import { startNetworkSide } from "../bridge/src/network-server.ts";
import { joinToken, linkKey, tokenSha256 } from "../bridge/src/phone-crypto.ts";
import { makeTempDir } from "./coordinator-fixtures.ts";

const REPORT = { state: "connected", missing: [{ id: "ollama", reason: "off", required: false }] };

/** The home laptop's link on a network side at a free port, and a worker the home accepts. */
async function linked(t: TestContext) {
  const stateDir = await makeTempDir();
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const home = await createHome(stateDir);
  const token = joinToken();
  const worker: AcceptedWorker = {
    node_id: "node-1",
    display_name: "Kitchen laptop",
    token_sha256: tokenSha256(token),
  };
  const workers = [worker];
  const lines: string[] = [];
  const log = (line: string) => lines.push(line);
  const phones = { lookup: () => ({ state: "unknown" }) as const, remove: async () => undefined };
  const gateway = new LanGateway({ homeId: home.homeId, phones, log });
  const clock = { now: Date.now() };
  const hub = new LinkHub({
    home,
    seen: gateway,
    log,
    workers: async () => workers,
    now: () => clock.now,
  });
  const side = await startNetworkSide(home.hubPublicKey, hub.routes(), 0);
  t.after(() => side.close());
  const target = {
    hubUrl: `http://127.0.0.1:${side.port}`,
    homeId: home.homeId,
    nodeId: worker.node_id,
    tokenSha256: worker.token_sha256,
  };
  const post = async (body: unknown) => {
    const response = await fetch(`${target.hubUrl}/v1/link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    });
    const answer = (await response.json()) as { error?: { code?: string } };
    return [response.status, answer.error?.code];
  };
  const sealed = (now = Date.now()) =>
    sealLinkMessage(
      linkKey(worker.token_sha256, worker.node_id),
      { homeId: home.homeId, nodeId: worker.node_id, type: "link_report" },
      REPORT,
      now,
    );
  return { hub, target, workers, lines, post, sealed, token, clock };
}

test("a report opens on the home laptop's side, and its sealed reply on the worker's", async (t) => {
  const l = await linked(t);
  assert.deepEqual(await sendLinkReport(l.target, REPORT), { ok: true, commands: [], ignored: 0 });
  const seen = l.hub.linked().get("node-1");
  assert.deepEqual([seen?.state, seen?.missing], [REPORT.state, REPORT.missing]);
  // A report sealed with another token's key is refused.
  const other = { ...l.target, tokenSha256: tokenSha256(joinToken()) };
  assert.deepEqual(await sendLinkReport(other, REPORT), {
    ok: false,
    removed: false,
    reason: "the home laptop answered 400",
  });
  const logged = l.lines.join("\n");
  assert.ok(!logged.includes(l.token) && !logged.includes(l.target.tokenSha256));
});

test("a removed node gets 403 unknown_node; stale, repeated and altered reports are refused", async (t) => {
  const l = await linked(t);
  const report = l.sealed();
  assert.deepEqual(await l.post(report), [200, undefined]);
  assert.deepEqual(await l.post(report), [409, "duplicate"]);
  assert.deepEqual(await l.post(l.sealed(Date.now() - 60_000)), [400, "stale"]);
  const fresh = l.sealed();
  const flipped = Buffer.from(fresh.envelope.c, "base64url");
  flipped[0] = (flipped[0] ?? 0) ^ 1;
  const altered = { ...fresh, envelope: { ...fresh.envelope, c: flipped.toString("base64url") } };
  assert.deepEqual(await l.post(altered), [400, "bad_envelope"]);
  assert.deepEqual(await l.post({ ...l.sealed(), type: "link_reply" }), [400, "unsupported_type"]);
  l.workers.length = 0; // removed from accepted-workers.json
  assert.deepEqual(await l.post(l.sealed()), [403, "unknown_node"]);
  assert.deepEqual(await sendLinkReport(l.target, REPORT), {
    ok: false,
    removed: true,
    reason: "this laptop is no longer part of the home",
  });
  assert.equal(l.hub.linked().has("node-1"), false);
});

const SESSION = "6f1c2b9e-0c1d-4a55-9a36-9f2b6a4d7e10";
const OPEN: LiveViewOpen = {
  type: "live_view_open",
  session_id: SESSION,
  sender_token: "T".repeat(43),
  signaling_url: `wss://relay.example.com/v1/live-view/sessions/${SESSION}/signal`,
  expires_at: "2999-01-01T00:00:00Z",
};

test("queued commands ride the laptop's next reply once, and the token is never logged", async (t) => {
  const l = await linked(t);
  l.hub.queue("node-1", OPEN);
  l.hub.queue("node-2", { type: "live_view_close", session_id: "other", reason: "stopped" });
  assert.deepEqual(await sendLinkReport(l.target, REPORT), {
    ok: true,
    commands: [OPEN],
    ignored: 0,
  });
  assert.deepEqual(await sendLinkReport(l.target, REPORT), { ok: true, commands: [], ignored: 0 });
  assert.ok(l.lines.some((line) => line.includes("sent node node-1 live_view_open")));
  assert.ok(!l.lines.join("\n").includes(OPEN.sender_token));
});

test("a close for a session whose open wasn't delivered yet drops both", async (t) => {
  const l = await linked(t);
  l.hub.queue("node-1", OPEN);
  l.hub.queue("node-1", { type: "live_view_close", session_id: SESSION, reason: "stopped" });
  assert.deepEqual(await sendLinkReport(l.target, REPORT), { ok: true, commands: [], ignored: 0 });
  l.hub.queue("node-1", { type: "live_view_close", session_id: SESSION, reason: "stopped" });
  const delivered = await sendLinkReport(l.target, REPORT);
  assert.deepEqual(delivered.ok && delivered.commands.map((command) => command.type), [
    "live_view_close",
  ]);
});

test("a report's live_view_lost reaches the listeners; a malformed one is refused", async (t) => {
  const l = await linked(t);
  const heard: Array<[string, LinkReport]> = [];
  l.hub.onReport((nodeId, report) => heard.push([nodeId, report]));
  const lost = { ...REPORT, live_view_lost: SESSION };
  assert.equal((await sendLinkReport(l.target, lost)).ok, true);
  assert.deepEqual(heard, [["node-1", lost]]);
  const bad = sealLinkMessage(
    linkKey(l.target.tokenSha256, "node-1"),
    { homeId: l.target.homeId, nodeId: "node-1", type: "link_report" },
    { ...REPORT, live_view_lost: "has space" },
    Date.now(),
  );
  assert.deepEqual(await l.post(bad), [400, "bad_request"]);
});

test("a malformed command in a reply is counted and dropped, the rest kept", async (t) => {
  const l = await linked(t);
  l.hub.queue("node-1", { ...OPEN, sender_token: "short" });
  l.hub.queue("node-1", { type: "live_view_close", session_id: "s2", reason: "stopped" });
  const outcome = await sendLinkReport(l.target, REPORT);
  assert.deepEqual(outcome, {
    ok: true,
    commands: [{ type: "live_view_close", session_id: "s2", reason: "stopped" }],
    ignored: 1,
  });
});

test("a start reaches the camera laptop within about a second: it reports every LINK_CAMERA_REPORT_MS", async (t) => {
  assert.equal(linkReportInterval({ camera: null, mic: "Mic" }), LINK_REPORT_MS);
  const interval = linkReportInterval({ camera: "FaceTime HD Camera", mic: null });
  assert.equal(interval, LINK_CAMERA_REPORT_MS);
  assert.ok(interval <= 1_000);
  // On an injected clock: a command queued between two reports rides the next one, at most one
  // interval (plus the request's own time) after it was queued.
  const l = await linked(t);
  const start = l.clock.now;
  assert.equal((await sendLinkReport(l.target, REPORT, () => l.clock.now)).ok, true);
  l.clock.now = start + 300;
  l.hub.queue("node-1", OPEN);
  const queuedAt = l.clock.now;
  l.clock.now = start + interval;
  const next = await sendLinkReport(l.target, REPORT, () => l.clock.now);
  assert.deepEqual(next.ok && next.commands, [OPEN]);
  assert.ok(l.clock.now - queuedAt <= interval);
  assert.equal(
    l.hub.linked().get("node-1")?.reportedAt,
    new Date(start + interval).toISOString().replace(/\.\d{3}Z$/, "Z"),
  );
});
