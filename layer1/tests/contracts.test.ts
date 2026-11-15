import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import * as settings from "../bridge/src/settings.ts";

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
    };
    for (const [field, value] of Object.entries(fromSettings)) {
      assert.equal(typeof value, typeof example[field], `${field} in contracts/coordinator.json`);
    }
    const ports = [fromSettings.listen_port, fromSettings.dashboard_port, fromSettings.client_port];
    assert.ok(ports.every((port) => Number.isInteger(port) && port >= 1 && port <= 65535));
    assert.equal(new Set(ports).size, ports.length, "the coordinator's three ports must differ");
  });
});
