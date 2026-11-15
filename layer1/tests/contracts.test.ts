import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { text } from "node:stream/consumers";
import { describe, type TestContext, test } from "node:test";
import { ALERT_FIELDS, parseAlert } from "../bridge/src/alert-intake.ts";
import { createHome, type Home } from "../bridge/src/home.ts";
import { readJsonFile } from "../bridge/src/json-file.ts";
import { workerConfig } from "../bridge/src/laptop.ts";
import * as settings from "../bridge/src/settings.ts";
import { startStub, waitFor } from "./coordinator-fixtures.ts";

const contractsDir = path.join(import.meta.dirname, "..", "..", "contracts");

async function readContract(name: string): Promise<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(
    await readFile(path.join(contractsDir, name), { encoding: "utf8" }),
  );
  assert.ok(
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed),
    `${name} must hold a JSON object`,
  );
  return parsed as Record<string, unknown>;
}

describe("contracts/coordinator.json", () => {
  test("carries every field the bridge fills from settings, with the same type", async () => {
    const example = await readContract("coordinator.json");
    const fromSettings = {
      listen_port: settings.COORDINATOR_LISTEN_PORT,
      dashboard_port: settings.DASHBOARD_PORT,
      client_port: settings.COORDINATOR_CLIENT_PORT,
      ollama_url: settings.OLLAMA_URL,
      bridge_url: settings.BRIDGE_URL,
    };
    for (const [field, value] of Object.entries(fromSettings)) {
      assert.equal(typeof value, typeof example[field], `${field} in contracts/coordinator.json`);
    }
    const ports = [fromSettings.listen_port, fromSettings.dashboard_port, fromSettings.client_port];
    assert.ok(ports.every((port) => Number.isInteger(port) && port >= 1 && port <= 65535));
    assert.equal(new Set(ports).size, ports.length, "the coordinator's three ports must differ");
    const withBridge = [...ports, settings.BRIDGE_LOCAL_PORT];
    assert.ok(withBridge.every((port) => Number.isInteger(port) && port >= 1 && port <= 65535));
    assert.equal(new Set(withBridge).size, withBridge.length, "the bridge's port must differ too");
  });
});

describe("the files createHome writes, checked as Layer 2's models check them", () => {
  async function createdHome(t: TestContext): Promise<Home> {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "l1-contracts-"));
    t.after(() => rm(stateDir, { recursive: true, force: true }));
    return createHome(stateDir);
  }

  /** The written file, once it has exactly the example's fields, each of the same JSON type. */
  async function readLike(filePath: string, contract: string): Promise<Record<string, unknown>> {
    const written = await readJsonFile(filePath);
    const example = await readContract(contract);
    assert.ok(typeof written === "object" && written !== null, `${filePath} must hold an object`);
    const fields = written as Record<string, unknown>;
    const kind = (value: unknown) => (Array.isArray(value) ? "array" : typeof value);
    assert.deepEqual(Object.keys(fields).sort(), Object.keys(example).sort());
    for (const [field, value] of Object.entries(example)) {
      assert.equal(kind(fields[field]), kind(value), `${field} has the wrong type`);
    }
    return fields;
  }

  test("coordinator.json: version 1, three different ports, absolute paths and the bridge's URL", async (t) => {
    const home = await createdHome(t);
    const { schema_version, listen_port, dashboard_port, client_port, bridge_url, ...others } =
      await readLike(home.coordinatorConfigFile, "coordinator.json");
    assert.equal(schema_version, 1);
    const ports = [listen_port, dashboard_port, client_port];
    for (const port of ports) {
      assert.ok(typeof port === "number" && Number.isInteger(port) && port >= 1 && port <= 65535);
    }
    assert.equal(new Set(ports).size, 3, "the three ports must differ");
    for (const [field, value] of Object.entries(others)) {
      if (field.endsWith("_file") || field.endsWith("_dir")) {
        assert.ok(typeof value === "string" && path.isAbsolute(value), `${field} is not absolute`);
      }
    }
    // contracts/README.md: the coordinator reaches the bridge by plain HTTP, on 127.0.0.1 only.
    assert.equal(bridge_url, `http://127.0.0.1:${settings.BRIDGE_LOCAL_PORT}`);
  });

  test("accepted-workers.json: version 1 and an empty workers list", async (t) => {
    const home = await createdHome(t);
    const written = await readLike(home.acceptedWorkersFile, "accepted-workers.json");
    assert.deepEqual(written, { schema_version: 1, workers: [] });
  });
});

describe("contracts/api-state.json", () => {
  /** Fails unless `actual` has exactly `example`'s keys, and its value types, at every level. */
  function assertSameShape(actual: unknown, example: unknown, where: string): void {
    if (Array.isArray(example)) {
      assert.ok(Array.isArray(actual), `${where} must be a list`);
      for (const item of actual) assertSameShape(item, example[0], `${where}[]`);
    } else if (typeof example === "object" && example !== null) {
      assert.ok(typeof actual === "object" && actual !== null, `${where} must be an object`);
      assert.deepEqual(Object.keys(actual).sort(), Object.keys(example).sort(), `${where} keys`);
      for (const [key, value] of Object.entries(example)) {
        assertSameShape((actual as Record<string, unknown>)[key], value, `${where}.${key}`);
      }
    } else {
      assert.equal(typeof actual, typeof example, `${where} type`);
    }
  }

  test("the stub's /api/state has exactly its keys at every level, in UTC", async (t) => {
    const stub = await startStub(t);
    await waitFor(() => stub.stderr().includes("ready"));
    const url = `http://127.0.0.1:${stub.dashboardPort}/api/state`;
    const state: unknown = await (await fetch(url, { signal: AbortSignal.timeout(2_000) })).json();
    assertSameShape(state, await readContract("api-state.json"), "api-state.json");
    const { updated_at: updatedAt } = state as { updated_at: string };
    assert.match(updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  });
});

describe("the bridge's ports", () => {
  test("7470 and 7480 differ from each other and from coordinator.json's three ports", () => {
    const ports = [
      settings.COORDINATOR_LISTEN_PORT,
      settings.DASHBOARD_PORT,
      settings.COORDINATOR_CLIENT_PORT,
      settings.BRIDGE_LOCAL_PORT,
      settings.BRIDGE_NETWORK_PORT,
    ];
    assert.ok(ports.every((port) => Number.isInteger(port) && port >= 1 && port <= 65535));
    assert.equal(new Set(ports).size, ports.length, "the five ports must differ");
  });
});

describe("contracts/alert.json, the alert Layer 4 sends", () => {
  test("has exactly the intake's fields, and the intake accepts it as it is", async () => {
    const contract: unknown = JSON.parse(
      await readFile(path.join(contractsDir, "alert.json"), "utf8"),
    );
    assert.ok(typeof contract === "object" && contract !== null);
    assert.deepEqual(Object.keys(contract).sort(), [...ALERT_FIELDS].sort());
    const parsed = parseAlert(contract);
    assert.ok(parsed.ok, parsed.ok ? "" : parsed.reason);
    assert.deepEqual(parsed.unknownFields, []);
  });

  test("the stub sends exactly ALERT_FIELDS, with the types the intake accepts", async (t) => {
    const received: unknown[] = [];
    const server = createServer((request, response) => {
      text(request).then(
        (body) => {
          received.push(JSON.parse(body));
          response.writeHead(202, { "content-type": "application/json" }).end("{}");
        },
        (error: unknown) => response.destroy(error instanceof Error ? error : undefined),
      );
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => server.close());
    const { port } = server.address() as AddressInfo;
    const stubFile = path.join(import.meta.dirname, "..", "stubs", "fake-layer2-to-phone.ts");
    const child = spawn(
      process.execPath,
      [stubFile, "--bridge-url", `http://127.0.0.1:${port}`, "--rewrite-after", "0"],
      { stdio: "ignore", timeout: 20_000 },
    );
    const [code] = await once(child, "close");
    assert.equal(code, 0);
    assert.equal(received.length, 2);
    for (const alert of received) {
      assert.ok(typeof alert === "object" && alert !== null);
      assert.deepEqual(Object.keys(alert).sort(), [...ALERT_FIELDS].sort());
      const parsed = parseAlert(alert);
      assert.ok(parsed.ok, parsed.ok ? "" : parsed.reason);
      assert.deepEqual(parsed.unknownFields, []);
    }
  });
});

describe("contracts/worker.json, as a joined laptop's bridge writes it", () => {
  test("has exactly its fields and types, null sensors, and coordinator_url's scheme and path", async () => {
    const stateDir = path.resolve("state");
    const joined = {
      homeId: "home-uuid",
      nodeId: "node-uuid",
      name: "Kitchen laptop",
      hubAddress: "192.168.1.20:7480",
      hubPublicKey: "unused",
      coordinatorPort: settings.COORDINATOR_LISTEN_PORT,
      tokenSha256: "unused",
    };
    const hub = new URL("http://192.168.1.20:7480");
    const written: Record<string, unknown> = workerConfig(stateDir, joined, hub, stateDir);
    const example = await readContract("worker.json");
    assert.deepEqual(Object.keys(written).sort(), Object.keys(example).sort());
    for (const [field, value] of Object.entries(example)) {
      const expected = field === "camera" || field === "mic" ? null : typeof value;
      const actual = written[field] === null ? null : typeof written[field];
      assert.equal(actual, expected, field);
    }
    const { coordinator_url: url } = written;
    const { coordinator_url: exampleUrl } = example;
    assert.equal(url, exampleUrl);
    const parsed = new URL(String(url));
    assert.deepEqual([parsed.protocol, parsed.pathname], ["ws:", "/ws"]);
  });
});
