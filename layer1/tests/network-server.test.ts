import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { createHome } from "../bridge/src/home.ts";
import {
  lanAddresses,
  type NetworkSide,
  type Route,
  startNetworkSide,
} from "../bridge/src/network-server.ts";
import * as settings from "../bridge/src/settings.ts";

const CLIENT_TIMEOUT_MS = 5_000;
const MAX_BYTES = settings.JSON_REQUEST_MAX_BYTES;

/** A route that answers with the body and the address it was given. */
const echo: Route = {
  method: "POST",
  path: "/v1/echo",
  handle: (body, localAddress) => ({ status: 201, body: { body, localAddress } }),
};

/** The network side on a free port, closed when the test ends. */
async function started(t: TestContext, routes = [echo], hubPublicKey = "test-hub-key") {
  const side = await startNetworkSide(hubPublicKey, routes, 0);
  t.after(() => side.close());
  return side;
}

/** A request over 127.0.0.1, answered with its status, its headers and its JSON body. */
async function call(side: NetworkSide, method: string, urlPath: string, init: RequestInit = {}) {
  const url = `http://127.0.0.1:${side.port}${urlPath}`;
  const signal = AbortSignal.timeout(CLIENT_TIMEOUT_MS);
  const response = await fetch(url, { method, signal, ...init });
  const body: unknown = await response.json();
  return { status: response.status, headers: response.headers, body };
}

type Body = NonNullable<RequestInit["body"]>;
const post = (side: NetworkSide, urlPath: string, body: Body, type = "application/json") =>
  call(side, "POST", urlPath, { headers: { "Content-Type": type }, body, duplex: "half" });

/** Every reply is JSON that no cache keeps, with no CORS header. */
function assertPlainJson(headers: Headers): void {
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(headers.get("cache-control"), "no-store");
  assert.ok(![...headers.keys()].some((name) => name.startsWith("access-control-")));
}

test("listens on every IPv4 interface, with the JSON request time limits", async (t) => {
  const { server, port } = await started(t);
  assert.deepEqual(server.address(), { address: "0.0.0.0", family: "IPv4", port });
  assert.equal(server.headersTimeout, settings.JSON_REQUEST_HEADERS_TIMEOUT_MS);
  assert.equal(server.requestTimeout, settings.JSON_REQUEST_TIMEOUT_MS);
  // How often Node checks both times; @types/node declares no property for it.
  const checkEvery: unknown = Reflect.get(server, "connectionsCheckingInterval");
  assert.equal(checkEvery, settings.JSON_REQUEST_TIMEOUT_CHECK_MS);
});

test("GET /v1/hello answers with the first 8 characters of the home's hub key", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "l1-network-"));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const home = await createHome(stateDir);
  const hello = await call(await started(t, [], home.hubPublicKey), "GET", "/v1/hello");
  assert.equal(hello.status, 200);
  const hub = home.hubPublicKey.slice(0, 8);
  assert.deepEqual(hello.body, { v: 1, service: "debbie-bridge", hub });
  assertPlainJson(hello.headers);
});

test("a route gets the JSON body, up to the limit, and the address it arrived on", async (t) => {
  const side = await started(t);
  const answer = await post(side, "/v1/echo", '{"name":"Sam"}', "application/json; charset=utf-8");
  assert.equal(answer.status, 201);
  assert.deepEqual(answer.body, { body: { name: "Sam" }, localAddress: `127.0.0.1:${side.port}` });
  const full = JSON.stringify({ pad: "x".repeat(MAX_BYTES - '{"pad":""}'.length) });
  assert.equal((await post(side, "/v1/echo", full)).status, 201);
});

test("the HTTP rules, in order, refuse with JSON errors", async (t) => {
  const side = await started(t);
  const big = new Uint8Array(MAX_BYTES + 1);
  const wrongMethod = await post(side, "/v1/hello", "x", "text/plain");
  const cases = [
    ["not_found", 404, await post(side, "/v1/nope", "x", "text/plain")],
    ["not_found", 404, await call(side, "GET", "/")],
    ["method_not_allowed", 405, wrongMethod],
    ["method_not_allowed", 405, await call(side, "OPTIONS", "/v1/echo")],
    ["unsupported_media_type", 415, await post(side, "/v1/echo", big, "text/plain")],
    ["unsupported_media_type", 415, await call(side, "POST", "/v1/echo", { body: big })],
    ["too_large", 413, await post(side, "/v1/echo", big)],
    ["too_large", 413, await post(side, "/v1/echo", new Blob([big]).stream())],
    ["bad_json", 400, await post(side, "/v1/echo", '{"v":1,')],
    ["bad_json", 400, await post(side, "/v1/echo", new Uint8Array([0x22, 0xff, 0x22]))],
  ] as const;
  for (const [code, status, answer] of cases) {
    assert.equal(answer.status, status, code);
    const shape = new RegExp(`^\\{"v":1,"error":\\{"code":"${code}","message":"[^"]+"\\}\\}$`);
    assert.match(JSON.stringify(answer.body), shape);
    assertPlainJson(answer.headers);
  }
  assert.equal(wrongMethod.headers.get("allow"), "GET");
  const pages = ["/", "/pairing/start", "/pairing/confirm", "/pairing/cancel", "/phones/remove"];
  for (const page of pages) {
    assert.equal((await post(side, page, "{}")).status, 404, `the setup page's ${page}`);
  }
});

test("anything unexpected answers 500 internal and logs only the error's class", async (t) => {
  const secret = "the phone key";
  const failing: Route = {
    method: "POST",
    path: "/v1/fail",
    handle: () => Promise.reject(new RangeError(secret)),
  };
  const side = await started(t, [failing]);
  const logged = t.mock.method(console, "error", () => undefined);
  const answer = await post(side, "/v1/fail", JSON.stringify({ secret }));
  assert.equal(answer.status, 500);
  assert.match(JSON.stringify(answer.body), /"code":"internal"/);
  const lines = logged.mock.calls.map((logCall) => logCall.arguments);
  assert.deepEqual(lines, [["L1 network-server: a request failed with RangeError"]]);
});

test("a busy port fails start with EADDRINUSE; later server errors are only logged", async (t) => {
  const side = await started(t);
  await assert.rejects(startNetworkSide("", [], side.port), { code: "EADDRINUSE" });
  const logged = t.mock.method(console, "error", () => undefined);
  assert.ok(side.server.emit("error", new Error("accept failed")));
  const lines = logged.mock.calls.map((logCall) => logCall.arguments);
  assert.deepEqual(lines, [["L1 network-server: the server failed with Error"]]);
});

const v4 = (address: string, internal = false) => ({ address, family: "IPv4" as const, internal });
const v6 = (address: string) => ({ address, family: "IPv6" as const, internal: false });

test("the address list: private addresses, then link-local ones, with the port, at most 4", () => {
  const interfaces = {
    lo0: [v4("127.0.0.1", true), v6("::1")],
    en5: [v4("169.254.7.1")],
    en0: [v6("fe80::1"), v4("192.168.1.20")],
    utun3: [v4("100.64.0.2"), v4("8.8.8.8"), v4("172.32.0.1"), v4("172.15.0.1")],
    en1: [v4("172.20.10.2")],
    vmnet8: [v4("10.0.0.5")],
    gone: undefined,
  };
  const listed = ["192.168.1.20:7480", "172.20.10.2:7480", "10.0.0.5:7480", "169.254.7.1:7480"];
  assert.deepEqual(lanAddresses(7480, interfaces), listed);
  const many = ["169.254.0.9", "10.0.0.1", "10.0.0.2", "10.0.0.3", "10.0.0.4", "10.0.0.5"];
  const firstFour = many.slice(1, 5).map((address) => `${address}:1`);
  assert.deepEqual(lanAddresses(1, { en0: many.map((address) => v4(address)) }), firstFour);
  const port = `:${settings.BRIDGE_NETWORK_PORT}`;
  assert.ok(lanAddresses().every((address) => address.endsWith(port)));
});
