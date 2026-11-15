/**
 * `npm run test:layer2`: Add a laptop against Layer 2's real coordinator and worker on this one
 * laptop (R7). It creates a home in a temporary folder, pairs a test caregiver phone directly into
 * its phone list, joins a second state folder through the Join a home page, approves the join over
 * the LAN gateway, and passes once the worker's status file says connected and the coordinator's
 * GET /api/state lists the new node. Both bridges stop through their stop files. It needs uv and
 * Python 3.12, and prints PASS or FAIL with the reason. It never prints the token.
 */
import { createSecretKey, randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { phoneWrapper } from "../tests/fake-phone.ts";
import { pageClient } from "../tests/page-client.ts";
import { createHome } from "../bridge/src/home.ts";
import { errorMessage } from "../bridge/src/json-file.ts";
import { readWorkerStatus, workerFiles } from "../bridge/src/laptop.ts";
import { startBridge } from "../bridge/src/main.ts";
import { tokenSha256 } from "../bridge/src/phone-crypto.ts";
import { freePort, waitFor } from "../tests/coordinator-fixtures.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
/** Layer 2's first run builds its environment, so each wait is long. */
const WAIT_MS = 180_000;

async function run(dirs: string[]): Promise<void> {
  const [homeDir, laptopDir] = dirs as [string, string];
  const ports = { listen: await freePort(), dashboard: await freePort(), client: await freePort() };
  const home = await createHome(homeDir, { ports });
  const lines: string[] = [];
  const log = (line: string) => {
    lines.push(line);
    console.log(line);
  };
  const common = { repoRoot: REPO_ROOT, port: 0, open: async () => undefined, log };
  const network = { port: 0, addresses: (port: number) => [`127.0.0.1:${port}`] };
  const hub = await startBridge({ ...common, stateDir: homeDir, network });
  const laptop = await startBridge({ ...common, stateDir: laptopDir });
  try {
    const state = hub.phones()?.state();
    if (state?.on !== true) throw new Error("the home laptop's network side is off");
    const phoneKey = createSecretKey(randomBytes(32));
    const phone = { deviceId: "e2e-phone", name: "E2E phone", role: "caregiver" } as const;
    await state.phones.add({ ...phone, phoneKey, credentialSha256: tokenSha256("e2e") });
    const page = pageClient(laptop.url);
    const address = `127.0.0.1:${state.port}`;
    await page.post("/join/start", { address, name: "E2E laptop" });
    let qrText = "";
    await poll(async () => {
      qrText = /<pre>([^<]+)<\/pre>/.exec((await page.get("/join")).page)?.[1] ?? "";
      return qrText !== "";
    }, "the Join a home page never showed a code");
    const qr = JSON.parse(
      qrText.replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n))),
    );
    const { join_id, laptop_pub, name } = qr as Record<string, unknown>;
    const wrapper = phoneWrapper(phoneKey, {
      homeId: home.homeId,
      deviceId: phone.deviceId,
      type: "laptop_approval",
      fields: { join_id, laptop_pub, name, approve: true },
    });
    const approved = await fetch(`http://${address}/v1/lan/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(wrapper),
      signal: AbortSignal.timeout(5_000),
    });
    if (approved.status !== 202) throw new Error(`the approval got ${approved.status}`);
    const statusFile = workerFiles(laptopDir).status;
    let nodeId = "";
    await poll(async () => {
      const status = await readWorkerStatus(statusFile);
      if (status.ok && status.state === "connected") nodeId = status.nodeId;
      return nodeId !== "";
    }, "the worker's status file never said connected");
    await poll(async () => {
      const url = `http://127.0.0.1:${ports.dashboard}/api/state`;
      const api = (await (await fetch(url, { signal: AbortSignal.timeout(2_000) })).json()) as {
        laptops?: { node_id?: string }[];
      };
      return api.laptops?.some((entry) => entry.node_id === nodeId) === true;
    }, "GET /api/state never listed the laptop");
    console.log(`PASS: node ${nodeId} joined and is on Layer 2's dashboard`);
  } finally {
    for (const bridge of [laptop, hub]) {
      await writeFile(bridge.stopFile, "", "utf8");
      await waitFor(() => lines.filter((line) => line === "L1 bridge: stopped").length > 0, 30_000);
      lines.length = 0;
    }
  }
}

/**
 * Polls `check` every second until it is true, failing with `why` after WAIT_MS; a check that
 * throws counts as false, and its latest error is in the failure.
 */
async function poll(check: () => Promise<boolean>, why: string): Promise<void> {
  const deadline = Date.now() + WAIT_MS;
  let lastError = "";
  for (;;) {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = `; last error: ${errorMessage(error)}`;
    }
    if (Date.now() > deadline) throw new Error(`${why}${lastError}`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

if (import.meta.main) {
  const dirs = [
    await mkdtemp(path.join(os.tmpdir(), "l1-e2e-")),
    await mkdtemp(path.join(os.tmpdir(), "l1-e2e-")),
  ];
  try {
    await run(dirs);
  } catch (error) {
    console.log(`FAIL: ${errorMessage(error)}`);
    process.exitCode = 1;
  } finally {
    for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  }
}
