import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { type AddressInfo, createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import * as settings from "../bridge/src/settings.ts";

/** The repository's stub coordinator. */
export const STUB = path.join(import.meta.dirname, "..", "..", ...settings.COORDINATOR_STUB_PATH);

/** Fields to set in coordinator.json, or a rewrite of its JSON text. */
type ConfigChanges = Record<string, unknown> | ((json: string) => string);

/** A temporary folder with a space in its name, which a command run through a shell would split. */
export function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "l1 launcher-"));
}

/** Polls `check` until it is true, failing after `ms`. */
export async function waitFor(check: () => boolean, ms = 5_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`still false after ${ms} ms`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

export async function freePort(): Promise<number> {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  server.close();
  await once(server, "close");
  return port;
}

/**
 * Writes coordinator.json into `dir`: the contract's example with this folder's paths and a free
 * dashboard port, then `changes`.
 */
export async function writeConfig(dir: string, changes: ConfigChanges = {}) {
  const contract = path.join(import.meta.dirname, "..", "..", "contracts", "coordinator.json");
  const example: unknown = JSON.parse(await readFile(contract, { encoding: "utf8" }));
  const configFile = path.join(dir, "coordinator.json");
  const stopFile = path.join(dir, "coordinator.stop");
  const dashboardPort = await freePort();
  const config = {
    ...(example as object),
    dashboard_port: dashboardPort,
    accepted_workers_file: path.join(dir, "accepted-workers.json"),
    state_dir: path.join(dir, "coordinator"),
    stop_file: stopFile,
    ...(typeof changes === "function" ? {} : changes),
  };
  const json = JSON.stringify(config);
  const text = typeof changes === "function" ? changes(json) : json;
  await writeFile(configFile, text, { encoding: "utf8" });
  return { configFile, stopFile, dashboardPort };
}

/** Runs the repository's stub on a config from writeConfig; it is ended after the test. */
export async function startStub(t: TestContext, changes: ConfigChanges = {}) {
  const dir = await makeTempDir();
  const config = await writeConfig(dir, changes);
  const child = spawn(process.execPath, [STUB, "--config", config.configFile], {
    stdio: ["ignore", "ignore", "pipe"],
    timeout: 20_000,
  });
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  const closed = once(child, "close");
  t.after(async () => {
    child.kill();
    await closed;
    await rm(dir, { recursive: true, force: true });
  });
  return { ...config, exitCode: closed.then(([code]: unknown[]) => code), stderr: () => stderr };
}
