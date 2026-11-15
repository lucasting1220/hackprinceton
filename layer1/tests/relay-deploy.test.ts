import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { HUB_PATH } from "../bridge/src/relay-protocol.ts";
import { RELAY_MAX_BODY_BYTES } from "../bridge/src/settings.ts";
import { loadRelayConfig } from "../relay/src/config.ts";
import { layer1 } from "./layer1-files.ts";

const DEPLOY = path.join(layer1, "relay", "deploy");
const read = (name: string): string => readFileSync(path.join(DEPLOY, name), "utf8");
const config = await loadRelayConfig(path.join(DEPLOY, "relay.example.json"));
const caddyfile = read("Caddyfile");
const unit = read("debbie-relay.service");
const turn = read("turnserver.conf.template");
const runbook = read("RUNBOOK.md");

/** Where the runbook installs relay.json, which the unit passes to the relay. */
const RELAY_JSON = "/etc/debbie-relay/relay.json";

/** The values of every `name=value` line of the systemd unit with this name. */
function unitValues(name: string): string[] {
  return unit
    .split("\n")
    .filter((line) => line.startsWith(`${name}=`))
    .map((line) => line.slice(name.length + 1).trim());
}

describe("relay deploy files", () => {
  test("Caddy serves the public_url's host and passes everything to 127.0.0.1 at listen_port", () => {
    const host = new URL(config.public_url).host;
    assert.match(caddyfile, new RegExp(`^${host.replaceAll(".", "\\.")} \\{$`, "m"));
    const upstreams = [...caddyfile.matchAll(/reverse_proxy\s+(\S+)/g)].map((match) => match[1]);
    assert.ok(upstreams.length >= 2, "the hub's WebSocket and the phones' API");
    for (const upstream of upstreams) assert.equal(upstream, `127.0.0.1:${config.listen_port}`);
    assert.match(caddyfile, new RegExp(`handle ${HUB_PATH} \\{`), "the hubs' upgrades");
    assert.ok(!/respond\s/.test(caddyfile), "the relay answers /healthz and everything else");
  });

  test("Caddy keeps port 80 closed and limits bodies to the relay's own limit (R5)", () => {
    assert.match(caddyfile, /auto_https disable_redirects/);
    assert.match(caddyfile, /disable_http_challenge/);
    assert.match(caddyfile, new RegExp(`max_size ${RELAY_MAX_BODY_BYTES / 1024}KB`));
  });

  test("the unit runs the relay as its own user with the runbook's relay.json", () => {
    assert.deepEqual(unitValues("User"), ["debbie-relay"]);
    const [execStart] = unitValues("ExecStart");
    assert.equal(
      execStart,
      `/opt/node/bin/node /opt/debbie/layer1/relay/src/main.ts --config ${RELAY_JSON}`,
    );
    assert.ok(runbook.includes(RELAY_JSON));
    assert.deepEqual(unitValues("Restart"), ["on-failure"], "a stop through the stop file stays");
    for (const hardening of ["NoNewPrivileges", "ProtectSystem", "ProtectHome", "PrivateTmp"]) {
      assert.equal(unitValues(hardening).length, 1, `${hardening} is set`);
    }
  });

  test("the unit lets the relay write only where relay.json keeps its database and stop file", () => {
    const writable = unitValues("ReadWritePaths");
    const [stateDir] = unitValues("StateDirectory");
    for (const file of [config.database_file, config.stop_file]) {
      const folder = path.posix.dirname(file);
      assert.deepEqual(writable, [folder], `${file} is writable`);
      assert.equal(path.posix.join("/var/lib", stateDir ?? ""), folder, "systemd creates it");
    }
  });

  test("the unit hands the relay the APNs key at the path relay.json names", () => {
    const credentials = new Map(
      unitValues("LoadCredential").map((value) => {
        const [name = "", source = ""] = value.split(":");
        return [name, source] as const;
      }),
    );
    const keys = Object.values(config.apns?.keys ?? {});
    assert.ok(keys.length > 0);
    for (const key of keys) {
      const name = path.posix.basename(key.key_file);
      assert.equal(key.key_file, `/run/credentials/debbie-relay.service/${name}`);
      assert.equal(credentials.get(name), "/etc/debbie/apns-key.p8");
    }
  });

  test("coturn uses a shared secret for the relay's realm, and the template holds no secret", () => {
    assert.match(turn, /^use-auth-secret$/m);
    assert.match(turn, new RegExp(`^realm=${new URL(config.public_url).hostname}$`, "m"));
    assert.ok(!/static-auth-secret/.test(turn.replace(/^#.*$/gm, "")));
  });

  test("no deploy file holds a secret, and the example holds only placeholder Apple IDs", () => {
    const secrets: ReadonlyArray<readonly [string, RegExp]> = [
      ["a private key", /BEGIN [A-Z ]*PRIVATE KEY/],
      ["a TURN secret", /static-auth-secret\s*=\s*[^\s%]/],
      ["a credential (43 base64url characters)", /(?<![\w-])[A-Za-z0-9_-]{43}(?![\w-])/],
      ["a hex secret", /(?<![0-9a-f])[0-9a-f]{32,}(?![0-9a-f])/i],
      ["a bearer token", /Bearer [A-Za-z0-9_-]{8,}/],
    ];
    for (const file of readdirSync(DEPLOY)) {
      const text = read(file);
      for (const [what, pattern] of secrets) {
        assert.ok(!pattern.test(text), `${file} holds ${what}`);
      }
    }
    assert.equal(config.apns?.team_id, "TEAMID0000");
    assert.equal(config.apns?.topic, "com.example.debbie");
    for (const key of Object.values(config.apns?.keys ?? {})) {
      assert.equal(key.key_id, "KEYID00000");
    }
  });
});
