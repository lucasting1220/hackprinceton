import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { type AddressInfo, createServer } from "node:net";
import { describe, test } from "node:test";
import { STUB, startStub, waitFor } from "./coordinator-fixtures.ts";

const LOG = "STUB layer2-coordinator: ";
const WHOLE = "must be a whole number from 1 to 65535";

/** Writes a port in coordinator.json's text with `suffix`, so 7443 becomes 7443.0 or 7443e0. */
function rewritePort(key: string, suffix: string) {
  return (json: string) => json.replace(new RegExp(`"${key}":\\d+`), `$&${suffix}`);
}

describe("the stub coordinator", () => {
  test("serves a page labelled STUB, and exits 0 once its stop file appears", async (t) => {
    const stub = await startStub(t);
    await waitFor(() => stub.stderr().includes("ready"));
    const url = `http://127.0.0.1:${stub.dashboardPort}/`;
    const page = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    assert.match(await page.text(), /STUB/);
    await writeFile(stub.stopFile, "", { encoding: "utf8" });
    assert.equal(await stub.exitCode, 0);
    assert.equal(existsSync(stub.stopFile), false, "the stub removes its stop file");
    const ready = `${LOG}ready on 127.0.0.1:${stub.dashboardPort}; stop file ${stub.stopFile}\n`;
    assert.equal(stub.stderr(), `${ready}${LOG}stop file found; stopped\n`);
  });

  test("exits 2 on a config that does not match the contract, naming the field", async (t) => {
    for (const [changes, problem] of [
      [{ extra: 1 }, "extra: not a coordinator.json field"],
      [{ home_id: undefined }, "home_id: missing"],
      [{ schema_version: 2 }, "schema_version: must be 1"],
      [{ ollama_url: 11434 }, "ollama_url: must be text"],
      [{ bridge_url: undefined }, "bridge_url: missing"],
      [{ bridge_url: 7470 }, "bridge_url: must be text"],
      [{ listen_port: 0 }, `listen_port: ${WHOLE}`],
      // JSON.parse reads these as whole numbers, but Layer 2 refuses a fraction or an exponent.
      [rewritePort("listen_port", ".0"), `listen_port: ${WHOLE}`],
      [rewritePort("dashboard_port", "e0"), `dashboard_port: ${WHOLE}`],
      [rewritePort("client_port", "E0"), `client_port: ${WHOLE}`],
      [{ client_port: 7443 }, "listen_port, dashboard_port and client_port must all differ"],
      [{ state_dir: "coordinator" }, "state_dir: must be an absolute path"],
    ] as const) {
      const stub = await startStub(t, changes);
      assert.equal(await stub.exitCode, 2);
      assert.equal(stub.stderr(), `${LOG}${stub.configFile} is not valid: ${problem}\n`);
    }
    const notJson = await startStub(t, () => "{");
    assert.equal(await notJson.exitCode, 2);
    const reason = `cannot read ${notJson.configFile} as JSON (SyntaxError)`;
    assert.equal(notJson.stderr(), `${LOG}${reason}\n`);
    for (const args of [[], ["--settings", "c.json"], ["--config", "c.json", "extra"]]) {
      const run = spawnSync(process.execPath, [STUB, ...args], {
        encoding: "utf8",
        timeout: 10_000,
      });
      assert.equal(run.status, 2, args.join(" "));
      assert.ok(run.stderr.startsWith(`${LOG}usage:`), args.join(" "));
    }
  });

  test("exits 1 with the reason when its port is taken", async (t) => {
    const taken = createServer().listen(0, "127.0.0.1");
    t.after(() => taken.close());
    await new Promise((resolve) => taken.once("listening", resolve));
    const { port } = taken.address() as AddressInfo;
    const stub = await startStub(t, { dashboard_port: port });
    assert.equal(await stub.exitCode, 1);
    assert.equal(stub.stderr(), `${LOG}cannot serve on 127.0.0.1:${port}: EADDRINUSE\n`);
  });
});
