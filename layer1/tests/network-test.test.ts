import assert from "node:assert/strict";
import { once } from "node:events";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { createServer } from "node:net";
import { test } from "node:test";
import {
  checkCoordinator,
  checkHello,
  checkRelay,
  exitCode,
  main,
  type Outcome,
  outcomeLine,
  parseArgs,
  USAGE,
} from "../scripts/network-test.ts";
import { freePort } from "./coordinator-fixtures.ts";

const SHORT_TIMEOUT_MS = 200;

/** An HTTP server on 127.0.0.1 and port 0 that answers every request with `status` and `body`. */
async function fakeServer(status: number, body: string): Promise<http.Server> {
  const server = http.createServer((_request, response) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(body);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server;
}

function portOf(server: { address(): unknown }): number {
  return (server.address() as AddressInfo).port;
}

async function closeServer(server: http.Server): Promise<void> {
  server.closeAllConnections();
  server.close();
  await once(server, "close");
}

test("hello passes when the bridge answers 200 with the hello of phone-hub.md §4.1", async () => {
  const hello = JSON.stringify({ v: 1, service: "debbie-bridge", hub: "abcdEFGH" });
  const server = await fakeServer(200, hello);
  try {
    const outcome = await checkHello("127.0.0.1", portOf(server));
    assert.equal(outcome.status, "PASS", outcome.detail);
    assert.match(outcomeLine(outcome), /^PASS hello .*\/v1\/hello answered \(hub tag abcdEFGH\)$/);
  } finally {
    await closeServer(server);
  }
});

test("hello fails when the answer isn't the bridge's hello", async () => {
  const server = await fakeServer(200, JSON.stringify({ v: 1, service: "something-else" }));
  try {
    const outcome = await checkHello("127.0.0.1", portOf(server));
    assert.equal(outcome.status, "FAIL");
    assert.match(outcome.detail, /not with the bridge's hello\. Is the bridge running/);
  } finally {
    await closeServer(server);
  }
});

test("hello fails as refused on a closed port, with the hint", async () => {
  const outcome = await checkHello("127.0.0.1", await freePort());
  assert.equal(outcome.status, "FAIL");
  assert.match(outcomeLine(outcome), /^FAIL hello .*the connection was refused\. Is the bridge/);
  assert.match(outcome.detail, /macOS firewall prompt/);
});

test("hello fails on the timeout when the server never answers", async () => {
  const server = http.createServer(() => undefined);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const started = performance.now();
    const outcome = await checkHello("127.0.0.1", portOf(server), SHORT_TIMEOUT_MS);
    assert.equal(outcome.status, "FAIL");
    assert.match(outcome.detail, /no answer within 0\.2 s/);
    assert.ok(performance.now() - started < 5_000);
  } finally {
    await closeServer(server);
  }
});

test("coordinator passes when the port accepts a connection, and fails as refused when closed", async () => {
  const server = createServer((socket) => socket.destroy());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const passed = await checkCoordinator("127.0.0.1", portOf(server));
    assert.equal(passed.status, "PASS", passed.detail);
  } finally {
    server.close();
    await once(server, "close");
  }
  const failed = await checkCoordinator("127.0.0.1", await freePort());
  assert.equal(failed.status, "FAIL");
  assert.match(failed.detail, /refused\. Is Layer 2's coordinator running/);
});

test("relay passes on {v:1,ok:true} and fails on any other body", async () => {
  const good = await fakeServer(200, JSON.stringify({ v: 1, ok: true }));
  const wrong = await fakeServer(200, JSON.stringify({ v: 1, ok: false }));
  try {
    const passed = await checkRelay(`http://127.0.0.1:${portOf(good)}`);
    assert.equal(passed.status, "PASS", passed.detail);
    assert.match(passed.detail, /\/healthz answered/);
    const failed = await checkRelay(`http://127.0.0.1:${portOf(wrong)}/`);
    assert.equal(failed.status, "FAIL");
    assert.match(failed.detail, /not with \{"v":1,"ok":true\}\. Does this laptop have internet/);
  } finally {
    await closeServer(good);
    await closeServer(wrong);
  }
});

test("relay is skipped without --relay, saying how to pass it", async () => {
  const outcome = await checkRelay(undefined);
  assert.equal(outcome.status, "SKIP");
  assert.match(outcomeLine(outcome), /^SKIP relay .*--relay <relay URL>/);
});

test("bad arguments are refused with the usage and exit code 2", async () => {
  const refused = [
    [],
    ["--coordinator"],
    ["--coordinator", "http://192.168.1.20"],
    ["--coordinator", "192.168.1.20:7480"],
    ["--coordinator", "192.168.1"],
    ["--coordinator", "192.168.1.20", "--relay", "http://relay.example.com"],
    ["--coordinator", "192.168.1.20", "--relay", "relay.example.com"],
    ["--coordinator", "192.168.1.20", "--port", "1"],
  ];
  for (const argv of refused) {
    assert.ok("error" in parseArgs(argv), argv.join(" "));
    const lines: string[] = [];
    assert.equal(await main(argv, (line) => lines.push(line)), 2, argv.join(" "));
    assert.equal(lines.at(-1), USAGE);
  }
  assert.deepEqual(parseArgs(["--coordinator", "coordinator.local"]), {
    coordinator: "coordinator.local",
    relay: undefined,
  });
  assert.deepEqual(
    parseArgs(["--coordinator", "10.0.0.5", "--relay", "https://relay.example.com"]),
    { coordinator: "10.0.0.5", relay: "https://relay.example.com" },
  );
});

test("the exit code is 0 when every check that ran passed and 1 when any failed", () => {
  const pass: Outcome = { status: "PASS", check: "hello", detail: "" };
  const skipped: Outcome = { status: "SKIP", check: "relay", detail: "" };
  const fail: Outcome = { status: "FAIL", check: "coordinator", detail: "" };
  assert.equal(exitCode([pass, skipped]), 0);
  assert.equal(exitCode([pass, fail, skipped]), 1);
});
