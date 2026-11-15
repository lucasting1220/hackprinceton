import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, type TestContext, test } from "node:test";
import { credentialHash, fromBase64url } from "../bridge/src/phone-crypto.ts";
import { HUB_CREDENTIAL_BYTES } from "../bridge/src/settings.ts";
import { runAdmin } from "../relay/src/admin.ts";
import {
  loadRelayConfig,
  missingPushSetup,
  parseRelayConfig,
  pushConfigured,
  RelayConfigError,
} from "../relay/src/config.ts";
import { RelayStore } from "../relay/src/store.ts";
import { configJson, tempDir } from "./relay-fixtures.ts";

const layer1 = path.join(import.meta.dirname, "..");
const NOW = new Date(Date.UTC(2026, 10, 14, 15, 10, 0));

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function setup(t: TestContext, overrides: Record<string, unknown> = {}) {
  const dir = await tempDir(t);
  const configFile = path.join(dir, "relay.json");
  await writeFile(configFile, JSON.stringify(configJson(dir, overrides)), { encoding: "utf8" });
  const admin = async (...args: string[]): Promise<Run> => {
    let stdout = "";
    let stderr = "";
    const code = await runAdmin(args, {
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        stderr += text;
      },
      now: () => NOW,
    });
    return { code, stdout, stderr };
  };
  return { dir, configFile, admin, database: path.join(dir, "relay.db") };
}

function record(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value));
  return { ...value };
}

const kind = (value: unknown) => (Array.isArray(value) ? "array" : typeof value);

/** A field of a JSON object or a database row, read by name. */
function field(value: unknown, name: string): unknown {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value));
  return Object.getOwnPropertyDescriptor(value, name)?.value;
}

describe("relay admin: provision", () => {
  test("prints exactly one JSON line shaped like the contract and stores only the hash", async (t) => {
    const { configFile, admin, database } = await setup(t);
    const run = await admin("provision", "--config", configFile, "--home-id", "home-a");
    assert.equal(run.code, 0, run.stderr);
    assert.equal(run.stdout.split("\n").length, 2, "one line, then the newline");
    const file = record(JSON.parse(run.stdout));
    const contract = record(
      JSON.parse(
        await readFile(path.join(layer1, "contracts", "relay-credential.json"), {
          encoding: "utf8",
        }),
      ),
    );
    assert.deepEqual(Object.keys(file).sort(), Object.keys(contract).sort());
    for (const [field, value] of Object.entries(contract)) {
      assert.equal(kind(file[field]), kind(value), field);
    }
    assert.equal(field(file, "home_id"), "home-a");
    assert.equal(field(file, "relay_url"), "http://127.0.0.1:7490");
    assert.equal(field(file, "issued_at"), "2026-11-14T15:10:00Z");
    const credential = String(field(file, "hub_credential"));
    assert.equal(credential.length, 43);
    assert.equal(fromBase64url(credential, HUB_CREDENTIAL_BYTES).length, HUB_CREDENTIAL_BYTES);
    assert.ok(!run.stderr.includes(credential));
    const store = RelayStore.open(database);
    t.after(() => store.close());
    assert.equal(store.homeByHubCredential(credentialHash(credential))?.homeId, "home-a");
    const bytes = await readFile(database);
    assert.ok(!bytes.includes(credential), "the database never holds the credential");
  });

  test("a second provision is refused without --replace, and --replace cuts the old one off", async (t) => {
    const { configFile, admin, database } = await setup(t);
    const args = ["provision", "--config", configFile, "--home-id", "home-a"];
    const first = await admin(...args);
    const old = String(field(record(JSON.parse(first.stdout)), "hub_credential"));
    const again = await admin(...args);
    assert.equal(again.code, 2);
    assert.equal(again.stdout, "");
    assert.match(again.stderr, /--replace/);
    const replaced = await admin(...args, "--replace");
    assert.equal(replaced.code, 0, replaced.stderr);
    const fresh = String(field(record(JSON.parse(replaced.stdout)), "hub_credential"));
    assert.notEqual(fresh, old);
    for (const run of [first, again, replaced]) {
      assert.ok(!run.stderr.includes(old) && !run.stderr.includes(fresh));
    }
    const store = RelayStore.open(database);
    t.after(() => store.close());
    assert.equal(store.homeByHubCredential(credentialHash(old)), undefined);
    assert.equal(store.homeByHubCredential(credentialHash(fresh))?.homeId, "home-a");
  });

  test("--replace for a home that doesn't exist is refused", async (t) => {
    const { configFile, admin } = await setup(t);
    const run = await admin("provision", "--config", configFile, "--home-id", "nope", "--replace");
    assert.equal(run.code, 1);
    assert.equal(run.stdout, "");
  });

  test("bad arguments print the usage and change nothing", async (t) => {
    const { configFile, admin } = await setup(t);
    for (const args of [
      [],
      ["provision", "--config", configFile],
      ["provision", "--config", configFile, "--home-id", "has space"],
      ["status"],
      ["status", "--config", configFile, "--replace"],
      ["remove", "--config", configFile],
      ["provision", "--config", configFile, "--home-id", "a", "--secret", "x"],
    ]) {
      const run = await admin(...args);
      assert.equal(run.code, 1, args.join(" "));
      assert.equal(run.stdout, "");
      assert.match(run.stderr, /usage:/);
    }
  });

  test("status prints homes, phones and push health, and no secret", async (t) => {
    const { configFile, admin } = await setup(t, { apns: undefined });
    const provisioned = await admin("provision", "--config", configFile, "--home-id", "home-a");
    const credential = String(field(record(JSON.parse(provisioned.stdout)), "hub_credential"));
    const run = await admin("status", "--config", configFile);
    assert.equal(run.code, 0, run.stderr);
    const status = record(JSON.parse(run.stdout));
    assert.deepEqual(field(status, "homes"), [
      {
        home_id: "home-a",
        hub_connected: false,
        last_contact_at: null,
        offline_notified_at: null,
        phones: { caregivers: 0, residents: 0, revoked: 0 },
      },
    ]);
    assert.equal(
      field(record(field(record(field(status, "push")), "sandbox")), "configured"),
      false,
    );
    assert.match(run.stderr, /pushes to production phones are off/);
    assert.ok(!run.stdout.includes(credential) && !run.stderr.includes(credential));
    assert.ok(!run.stdout.includes(credentialHash(credential)));
  });

  test("a config file that can't be read is reported by path", async (t) => {
    const { dir, admin } = await setup(t);
    const missing = path.join(dir, "missing.json");
    const run = await admin("status", "--config", missing);
    assert.equal(run.code, 1);
    assert.ok(run.stderr.includes(missing));
  });
});

describe("relay config", () => {
  test("relay/deploy/relay.example.json loads, with both push environments", async () => {
    const config = await loadRelayConfig(
      path.join(layer1, "relay", "deploy", "relay.example.json"),
    );
    assert.equal(pushConfigured(config, "production"), true);
    assert.equal(pushConfigured(config, "sandbox"), true);
    assert.deepEqual(missingPushSetup(config), []);
  });

  test("a silent limit under three heartbeats is refused, naming both values", async (t) => {
    const dir = await tempDir(t);
    assert.throws(
      () => parseRelayConfig(configJson(dir, { hub_silent_limit_s: 59 }), "relay.json"),
      (error: unknown) =>
        error instanceof RelayConfigError &&
        error.message.includes("hub_silent_limit_s") &&
        error.message.includes("59") &&
        error.message.includes("60"),
    );
    assert.equal(
      parseRelayConfig(configJson(dir, { hub_silent_limit_s: 60 }), "relay.json")
        .hub_silent_limit_s,
      60,
    );
  });

  test("bad fields are refused by name", async (t) => {
    const dir = await tempDir(t);
    const cases: [Record<string, unknown>, string][] = [
      [{ schema_version: 2 }, "schema_version"],
      [{ listen_port: 0 }, "listen_port"],
      [{ listen_port: "7490" }, "listen_port"],
      [{ public_url: "http://relay.example.com" }, "public_url"],
      [{ public_url: "https://relay.example.com/path" }, "public_url"],
      [{ database_file: "relay.db" }, "database_file"],
      [{ stop_file: 5 }, "stop_file"],
      [{ watchdog_tick_s: 0 }, "watchdog_tick_s"],
      [{ apns: { topic: "", team_id: "TEAMID0000", keys: {} } }, "apns.topic"],
      [{ apns: { topic: "a.b", team_id: "team", keys: {} } }, "apns.team_id"],
      [
        { apns: { topic: "a.b", team_id: "TEAMID0000", keys: { sandbox: { key_id: "x" } } } },
        "apns.keys.sandbox.key_id",
      ],
      [
        {
          apns: {
            topic: "a.b",
            team_id: "TEAMID0000",
            keys: { sandbox: { key_id: "KEYID00002", key_file: "k.p8" } },
          },
        },
        "apns.keys.sandbox.key_file",
      ],
    ];
    for (const [overrides, field] of cases) {
      assert.throws(
        () => parseRelayConfig(configJson(dir, overrides), "relay.json"),
        (error: unknown) =>
          error instanceof RelayConfigError && error.message.startsWith(`relay.json: ${field} `),
        field,
      );
    }
  });

  test("a missing APNs key turns that environment's pushes off and is reported", async (t) => {
    const dir = await tempDir(t);
    const config = parseRelayConfig(
      configJson(dir, { apns: { topic: "a.b", team_id: "TEAMID0000", keys: {} } }),
      "relay.json",
    );
    assert.equal(pushConfigured(config, "sandbox"), false);
    assert.equal(missingPushSetup(config).length, 2);
  });
});
