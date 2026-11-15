// STUB of Layer 2's coordinator handing a Layer 4 alert to the bridge (to_phone).
/**
 * `node stubs/fake-layer2-to-phone.ts [--kind fall|help|heart_rate|monitoring]
 * [--rewrite-after <seconds>] [--bridge-url <url>]`, run by `npm run stub:alert`. It POSTs one alert
 * with exactly the fields Layer 4 sends (layer4/src/layer4/alerts.py) to coordinator.json's
 * bridge_url + /v1/alerts, as Layer 2's coordinator will: a fresh alert_id, detected_at now,
 * Layer 4's title for the kind and a body starting "STUB:", so it can never pass for a real alert.
 * With --rewrite-after it then sends the rewrite, as Layer 4's does: the same alert_id, kind,
 * severity, detected_at and title, a body starting "STUB rewrite:" and update true. It prints the
 * alert_id and each answer, and exits 0 when every send got 202, else 1. It listens on nothing and
 * imports nothing from bridge/.
 */
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

/** coordinator.json's bridge_url, as createHome writes it (CLAUDE.md's port 7470). */
const BRIDGE_URL = "http://127.0.0.1:7470";
const ALERTS_PATH = "/v1/alerts";
const SEND_TIMEOUT_MS = 5_000;
const EXIT_FAILED = 1;
/** Layer 4's titles (layer4/src/layer4/rules.py). */
const TITLES = {
  fall: "Possible fall",
  help: "Call for help",
  heart_rate: "Heart rate alert",
  monitoring: "Monitoring degraded",
} as const;
type Kind = keyof typeof TITLES;
const USAGE =
  "usage: fake-layer2-to-phone.ts [--kind fall|help|heart_rate|monitoring] [--rewrite-after <seconds>] [--bridge-url <url>]";

function log(message: string): void {
  process.stdout.write(`STUB layer2-to-phone: ${message}\n`);
}

const isKind = (value: string): value is Kind => Object.hasOwn(TITLES, value);

/** Sends one alert; true when the bridge answered 202. */
async function send(bridgeUrl: string, alert: Record<string, unknown>): Promise<boolean> {
  try {
    const response = await fetch(new URL(ALERTS_PATH, bridgeUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(alert),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    log(`${response.status} ${await response.text()}`);
    return response.status === 202;
  } catch (error) {
    log(`could not reach the bridge at ${bridgeUrl}: ${String(error)}`);
    return false;
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      kind: { type: "string", default: "fall" },
      "rewrite-after": { type: "string" },
      "bridge-url": { type: "string", default: BRIDGE_URL },
    },
  });
  const { kind, "bridge-url": bridgeUrl } = values;
  const rewriteAfter = Number(values["rewrite-after"] ?? 0);
  if (!isKind(kind) || !Number.isFinite(rewriteAfter) || rewriteAfter < 0) {
    log(USAGE);
    process.exitCode = EXIT_FAILED;
    return;
  }
  const alert = {
    type: "alert",
    schema_version: 1,
    alert_id: randomUUID(),
    kind,
    severity: "urgent",
    detected_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    title: TITLES[kind],
    body: `STUB: a test ${kind} alert from the Layer 2 stub, not a real event`,
    update: false,
  };
  log(`sending alert ${alert.alert_id} (${kind}) to ${bridgeUrl}`);
  let ok = await send(bridgeUrl, alert);
  if (values["rewrite-after"] !== undefined) {
    await sleep(rewriteAfter * 1000);
    log(`sending the rewrite of alert ${alert.alert_id}`);
    const rewrite = { ...alert, body: `STUB rewrite: the ${kind} alert's new text`, update: true };
    ok = (await send(bridgeUrl, rewrite)) && ok;
  }
  if (!ok) process.exitCode = EXIT_FAILED;
}

main().catch((error: unknown) => {
  log(`failed: ${String(error)}`);
  process.exitCode = EXIT_FAILED;
});
