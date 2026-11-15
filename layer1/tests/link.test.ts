import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { type TestContext, test } from "node:test";
import { type AcceptedWorker, createHome } from "../bridge/src/home.ts";
import { LanGateway } from "../bridge/src/lan-gateway.ts";
import { LinkHub, sealLinkMessage, sendLinkReport } from "../bridge/src/link.ts";
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
  const hub = new LinkHub({ home, seen: gateway, log, workers: async () => workers });
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
  return { hub, target, workers, lines, post, sealed, token };
}

test("a report opens on the home laptop's side, and its sealed reply on the worker's", async (t) => {
  const l = await linked(t);
  assert.deepEqual(await sendLinkReport(l.target, REPORT), { ok: true });
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
