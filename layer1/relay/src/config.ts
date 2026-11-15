/**
 * relay.json, which lives on the server only: read and checked. Paths are absolute, the relay binds
 * 127.0.0.1 behind Caddy, and the APNs block may be missing, which turns pushes off but never stops
 * the relay.
 */
import path from "node:path";
import { readJsonFile } from "../../bridge/src/json-file.ts";
import {
  RELAY_CONFIG_SCHEMA_VERSION,
  RELAY_HEARTBEAT_INTERVAL_MS,
} from "../../bridge/src/settings.ts";
import { ENVIRONMENTS, type Environment } from "./store.ts";

export interface ApnsKey {
  readonly key_id: string;
  readonly key_file: string;
}

export interface ApnsConfig {
  readonly topic: string;
  readonly team_id: string;
  readonly keys: Readonly<Partial<Record<Environment, ApnsKey>>>;
}

export interface RelayConfig {
  readonly schema_version: number;
  readonly listen_port: number;
  readonly public_url: string;
  readonly database_file: string;
  readonly stop_file: string;
  readonly hub_silent_limit_s: number;
  readonly watchdog_tick_s: number;
  readonly apns?: ApnsConfig;
}

/** A relay.json that can't be used. The message names the file and the field, never a value. */
export class RelayConfigError extends Error {
  override name = "RelayConfigError";
}

/** Apple's team and key IDs are 10 upper-case letters and digits. */
const APPLE_ID = /^[A-Z0-9]{10}$/;
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "[::1]"]);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether `value` is https://, or http:// to a loopback host (for tests on one machine). */
export function isRelayUrl(value: unknown): value is string {
  if (typeof value !== "string" || !URL.canParse(value)) return false;
  const url = new URL(value);
  const plainLoopback = url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  const clean = url.username === "" && url.password === "" && url.search === "" && url.hash === "";
  return (url.protocol === "https:" || plainLoopback) && clean && url.pathname === "/";
}

/** Reads and checks relay.json. Every problem throws a RelayConfigError naming the field. */
export async function loadRelayConfig(file: string): Promise<RelayConfig> {
  return parseRelayConfig(await readJsonFile(file), file);
}

export function parseRelayConfig(value: unknown, file: string): RelayConfig {
  const fail = (field: string, rule: string): never => {
    throw new RelayConfigError(`${file}: ${field} ${rule}`);
  };
  if (!isRecord(value)) return fail("the file", "must hold a JSON object");
  const integer = (field: string, min: number, max: number): number => {
    const found = value[field];
    if (typeof found !== "number" || !Number.isInteger(found) || found < min || found > max) {
      return fail(field, `must be a whole number from ${min} to ${max}`);
    }
    return found;
  };
  const absolute = (where: Readonly<Record<string, unknown>>, field: string, label = field) => {
    const found = where[field];
    if (typeof found !== "string" || !path.isAbsolute(found)) {
      return fail(label, "must be an absolute path");
    }
    return found;
  };
  const { schema_version: schemaVersion, public_url: publicUrl, apns } = value;
  if (schemaVersion !== RELAY_CONFIG_SCHEMA_VERSION) {
    fail("schema_version", `must be ${RELAY_CONFIG_SCHEMA_VERSION}`);
  }
  if (!isRelayUrl(publicUrl)) {
    return fail("public_url", "must be an https:// origin (http:// only for a loopback host)");
  }
  const heartbeatS = RELAY_HEARTBEAT_INTERVAL_MS / 1000;
  const silentLimit = integer("hub_silent_limit_s", 1, 86_400);
  if (silentLimit < 3 * heartbeatS) {
    fail(
      "hub_silent_limit_s",
      `is ${silentLimit}, but must be at least three of the hub's ${heartbeatS}-second heartbeats (${3 * heartbeatS})`,
    );
  }
  const config: RelayConfig = {
    schema_version: RELAY_CONFIG_SCHEMA_VERSION,
    listen_port: integer("listen_port", 1, 65_535),
    public_url: publicUrl,
    database_file: absolute(value, "database_file"),
    stop_file: absolute(value, "stop_file"),
    hub_silent_limit_s: silentLimit,
    watchdog_tick_s: integer("watchdog_tick_s", 1, 3_600),
  };
  if (apns === undefined) return config;
  if (!isRecord(apns)) return fail("apns", "must be an object");
  const { topic, team_id: teamId, keys } = apns;
  if (typeof topic !== "string" || topic === "") return fail("apns.topic", "must be a bundle ID");
  if (typeof teamId !== "string" || !APPLE_ID.test(teamId)) {
    return fail("apns.team_id", "must be 10 upper-case letters and digits");
  }
  if (!isRecord(keys)) return fail("apns.keys", "must be an object");
  const parsedKeys: Partial<Record<Environment, ApnsKey>> = {};
  for (const env of ENVIRONMENTS) {
    const key = keys[env];
    if (key === undefined) continue;
    if (!isRecord(key)) return fail(`apns.keys.${env}`, "must be an object");
    const { key_id: keyId } = key;
    if (typeof keyId !== "string" || !APPLE_ID.test(keyId)) {
      return fail(`apns.keys.${env}.key_id`, "must be 10 upper-case letters and digits");
    }
    parsedKeys[env] = {
      key_id: keyId,
      key_file: absolute(key, "key_file", `apns.keys.${env}.key_file`),
    };
  }
  return { ...config, apns: { topic, team_id: teamId, keys: parsedKeys } };
}

/** Whether pushes to this environment are set up. A missing key turns them off, never the relay. */
export function pushConfigured(config: RelayConfig, env: Environment): boolean {
  return config.apns?.keys[env] !== undefined;
}

/** One line per environment whose pushes are off, for the log and `admin status`. */
export function missingPushSetup(config: RelayConfig): string[] {
  return ENVIRONMENTS.filter((env) => !pushConfigured(config, env)).map((env) =>
    config.apns === undefined
      ? `L1 relay: no apns block in relay.json, so pushes to ${env} phones are off`
      : `L1 relay: no APNs key for ${env} in relay.json, so pushes to ${env} phones are off`,
  );
}
