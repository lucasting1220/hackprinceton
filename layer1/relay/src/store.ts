/**
 * The relay's SQLite database, and the only module that touches it: homes, devices, push tokens,
 * push health and messages. It holds credential hashes and sealed wrappers, never a credential, the
 * home key or a phone key. Times are integer milliseconds in the database.
 */
import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from "node:sqlite";
import type { Role } from "../../bridge/src/phone-crypto.ts";
import {
  LATEST_ONLY_TYPES,
  MESSAGE_RETENTION_MS,
  RELAY_DB_BUSY_TIMEOUT_MS,
  RELAY_DB_SCHEMA_VERSION,
  RELAY_SWEEP_BATCH,
} from "../../bridge/src/settings.ts";
import { parseWrapper, type Wrapper } from "../../bridge/src/wire.ts";

export type Environment = "production" | "sandbox";
export const ENVIRONMENTS: readonly Environment[] = ["production", "sandbox"];

export interface HomeRecord {
  readonly homeId: string;
  readonly createdAtMs: number;
  readonly hubConnected: boolean;
  readonly lastContactAtMs: number | null;
  readonly offlineNotifiedAtMs: number | null;
}

export interface DeviceRecord {
  readonly deviceId: string;
  readonly homeId: string;
  readonly role: Role;
  readonly credentialSha256: string;
  readonly revokedAtMs: number | null;
}

/** One phone of the hub's `phones` list: a removed phone carries only its ID. */
export type PhoneListEntry =
  | Readonly<{ device_id: string; removed: true }>
  | Readonly<{ device_id: string; role: Role; credential_sha256: string; removed: false }>;

/** What a phone list changed: devices it revoked, and device IDs refused as another home's. */
export interface SyncResult {
  readonly revoked: string[];
  readonly refused: string[];
}

export interface PushTarget {
  readonly deviceId: string;
  readonly environment: Environment;
  readonly token: string;
}

export interface PushHealth {
  readonly environment: Environment;
  readonly lastOkAtMs: number | null;
  readonly lastError: string | null;
  readonly lastErrorAtMs: number | null;
}

export interface DeviceCounts {
  readonly caregivers: number;
  readonly residents: number;
  readonly revoked: number;
}

/** A stored message's sequence number, and whether the home already had its msg_id. */
export interface StoredMessage {
  readonly seq: number;
  readonly duplicate: boolean;
}

export interface PageQuery {
  readonly homeId: string;
  readonly deviceId: string;
  readonly role: Role;
  /** The phone's cursor; anything but this relay's `r.<seq>` starts at the 7-day window. */
  readonly after: string | null | undefined;
  readonly limit: number;
  readonly nowMs: number;
}

export interface MessagePage {
  readonly messages: Wrapper[];
  readonly next: string | null;
}

/** A stored alert whose push never went out, which the relay pushes when it starts (R13). */
export interface UnpushedAlert {
  readonly homeId: string;
  readonly seq: number;
  readonly wrapper: Wrapper;
}

/** A database that this relay can't use, such as one with a newer schema. */
export class RelayStoreError extends Error {
  override name = "RelayStoreError";
}

const SCHEMA = `
CREATE TABLE homes (
  home_id TEXT PRIMARY KEY,
  hub_credential_sha256 TEXT NOT NULL UNIQUE,
  created_at_ms INTEGER NOT NULL,
  hub_connected INTEGER NOT NULL DEFAULT 0,
  last_contact_at_ms INTEGER,
  offline_notified_at_ms INTEGER
) STRICT;
CREATE TABLE devices (
  device_id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL REFERENCES homes ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('caregiver', 'resident')),
  credential_sha256 TEXT NOT NULL,
  revoked_at_ms INTEGER
) STRICT;
CREATE TABLE push_tokens (
  device_id TEXT NOT NULL REFERENCES devices ON DELETE CASCADE,
  environment TEXT NOT NULL CHECK (environment IN ('production', 'sandbox')),
  token TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (device_id, environment),
  UNIQUE (environment, token)
) STRICT;
CREATE TABLE messages (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  home_id TEXT NOT NULL REFERENCES homes ON DELETE CASCADE,
  msg_id TEXT NOT NULL,
  type TEXT NOT NULL,
  to_device TEXT,
  received_at_ms INTEGER NOT NULL,
  wrapper TEXT NOT NULL,
  pushed_at_ms INTEGER,
  UNIQUE (home_id, msg_id)
) STRICT;
CREATE INDEX messages_by_home ON messages (home_id, seq);
CREATE INDEX messages_by_age ON messages (received_at_ms);
CREATE TABLE push_health (
  environment TEXT PRIMARY KEY CHECK (environment IN ('production', 'sandbox')),
  last_ok_at_ms INTEGER,
  last_error TEXT,
  last_error_at_ms INTEGER
) STRICT;
`;

/** The relay's cursors: `r.` and a sequence number (phone-hub.md §5.3). */
const RELAY_CURSOR = /^r\.(\d{1,15})$/;

export function relayCursor(seq: number): string {
  return `r.${seq}`;
}

/** The sequence number in one of this relay's cursors, or undefined for any other value. */
export function parseRelayCursor(after: unknown): number | undefined {
  if (typeof after !== "string") return undefined;
  const digits = RELAY_CURSOR.exec(after)?.[1];
  return digits === undefined ? undefined : Number(digits);
}

type Row = Record<string, SQLOutputValue>;

function column(row: Row, name: string): SQLOutputValue {
  if (!(name in row)) throw new RelayStoreError(`the query has no column ${name}`);
  return row[name] ?? null;
}

function text(row: Row, name: string): string {
  const value = column(row, name);
  if (typeof value !== "string") throw new RelayStoreError(`column ${name} is not text`);
  return value;
}

function optionalText(row: Row, name: string): string | null {
  return column(row, name) === null ? null : text(row, name);
}

function integer(row: Row, name: string): number {
  const value = column(row, name);
  if (typeof value !== "number" && typeof value !== "bigint") {
    throw new RelayStoreError(`column ${name} is not an integer`);
  }
  return Number(value);
}

function optionalInteger(row: Row, name: string): number | null {
  return column(row, name) === null ? null : integer(row, name);
}

function role(value: string): Role {
  if (value === "caregiver" || value === "resident") return value;
  throw new RelayStoreError("a device has an unknown role");
}

function environment(value: string): Environment {
  if (value === "production" || value === "sandbox") return value;
  throw new RelayStoreError("a push token has an unknown environment");
}

function homeRecord(row: Row): HomeRecord {
  return {
    homeId: text(row, "home_id"),
    createdAtMs: integer(row, "created_at_ms"),
    hubConnected: integer(row, "hub_connected") === 1,
    lastContactAtMs: optionalInteger(row, "last_contact_at_ms"),
    offlineNotifiedAtMs: optionalInteger(row, "offline_notified_at_ms"),
  };
}

function deviceRecord(row: Row): DeviceRecord {
  return {
    deviceId: text(row, "device_id"),
    homeId: text(row, "home_id"),
    role: role(text(row, "role")),
    credentialSha256: text(row, "credential_sha256"),
    revokedAtMs: optionalInteger(row, "revoked_at_ms"),
  };
}

const HOME_COLUMNS =
  "home_id, created_at_ms, hub_connected, last_contact_at_ms, offline_notified_at_ms";
const DEVICE_COLUMNS = "device_id, home_id, role, credential_sha256, revoked_at_ms";

export class RelayStore {
  readonly #db: DatabaseSync;

  private constructor(db: DatabaseSync) {
    this.#db = db;
  }

  /** Opens (or creates) the database at `file`, or ":memory:" for tests. */
  static open(file: string): RelayStore {
    const db = new DatabaseSync(file);
    try {
      // busy_timeout before WAL: the reverse order has failed on Node 24 under a lock.
      db.exec(`PRAGMA busy_timeout = ${RELAY_DB_BUSY_TIMEOUT_MS}`);
      db.exec("PRAGMA journal_mode = WAL");
      // An acknowledged message must survive a power cut: the hub never sends it again.
      db.exec("PRAGMA synchronous = FULL");
      db.exec("PRAGMA foreign_keys = ON");
      const store = new RelayStore(db);
      store.#migrate();
      return store;
    } catch (error) {
      db.close();
      throw error;
    }
  }

  close(): void {
    this.#db.close();
  }

  /** A pragma's value, for the tests of the settings. */
  pragma(name: "busy_timeout" | "journal_mode" | "synchronous" | "foreign_keys" | "user_version") {
    const row = this.#db.prepare(`PRAGMA ${name}`).get();
    return row === undefined ? undefined : Object.values(row)[0];
  }

  #migrate(): void {
    const version = Number(this.pragma("user_version"));
    if (version === RELAY_DB_SCHEMA_VERSION) return;
    if (version !== 0) {
      throw new RelayStoreError(
        `the database's schema version is ${version}, and this relay knows ${RELAY_DB_SCHEMA_VERSION}`,
      );
    }
    this.#transaction(() => {
      this.#db.exec(SCHEMA);
      this.#db.exec(`PRAGMA user_version = ${RELAY_DB_SCHEMA_VERSION}`);
    });
  }

  #transaction<T>(work: () => T): T {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      if (this.#db.isTransaction) this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  #get(sql: string, ...values: SQLInputValue[]): Row | undefined {
    return this.#db.prepare(sql).get(...values);
  }

  #all(sql: string, ...values: SQLInputValue[]): Row[] {
    return this.#db.prepare(sql).all(...values);
  }

  #run(sql: string, ...values: SQLInputValue[]): number {
    return Number(this.#db.prepare(sql).run(...values).changes);
  }

  // Homes

  /** Adds a home with its hub credential's hash; false if the home exists. */
  createHome(homeId: string, hubCredentialSha256: string, nowMs: number): boolean {
    const sql =
      "INSERT INTO homes (home_id, hub_credential_sha256, created_at_ms) VALUES (?, ?, ?) ON CONFLICT (home_id) DO NOTHING";
    return this.#run(sql, homeId, hubCredentialSha256, nowMs) === 1;
  }

  /** Gives a home a new hub credential hash, so the old credential stops working; false if none. */
  replaceHubCredential(homeId: string, hubCredentialSha256: string): boolean {
    const sql = "UPDATE homes SET hub_credential_sha256 = ? WHERE home_id = ?";
    return this.#run(sql, hubCredentialSha256, homeId) === 1;
  }

  home(homeId: string): HomeRecord | undefined {
    const row = this.#get(`SELECT ${HOME_COLUMNS} FROM homes WHERE home_id = ?`, homeId);
    return row === undefined ? undefined : homeRecord(row);
  }

  /** The home whose hub credential has this hash: the only way a hub's home is found. */
  homeByHubCredential(hubCredentialSha256: string): HomeRecord | undefined {
    const sql = `SELECT ${HOME_COLUMNS} FROM homes WHERE hub_credential_sha256 = ?`;
    const row = this.#get(sql, hubCredentialSha256);
    return row === undefined ? undefined : homeRecord(row);
  }

  homes(): HomeRecord[] {
    return this.#all(`SELECT ${HOME_COLUMNS} FROM homes ORDER BY home_id`).map(homeRecord);
  }

  setHubConnected(homeId: string, connected: boolean): void {
    this.#run("UPDATE homes SET hub_connected = ? WHERE home_id = ?", connected ? 1 : 0, homeId);
  }

  recordContact(homeId: string, atMs: number): void {
    this.#run("UPDATE homes SET last_contact_at_ms = ? WHERE home_id = ?", atMs, homeId);
  }

  /** Records that a "hub offline" push went out at `atMs`, or clears it with null. */
  setOfflineNotified(homeId: string, atMs: number | null): void {
    this.#run("UPDATE homes SET offline_notified_at_ms = ? WHERE home_id = ?", atMs, homeId);
  }

  // Devices

  device(deviceId: string): DeviceRecord | undefined {
    const row = this.#get(`SELECT ${DEVICE_COLUMNS} FROM devices WHERE device_id = ?`, deviceId);
    return row === undefined ? undefined : deviceRecord(row);
  }

  /** The home's revoked device IDs, which `welcome` tells the hub. */
  revokedDevices(homeId: string): string[] {
    const sql =
      "SELECT device_id FROM devices WHERE home_id = ? AND revoked_at_ms IS NOT NULL ORDER BY device_id";
    return this.#all(sql, homeId).map((row) => text(row, "device_id"));
  }

  deviceCounts(homeId: string): DeviceCounts {
    const sql = `SELECT
        SUM(revoked_at_ms IS NULL AND role = 'caregiver') AS caregivers,
        SUM(revoked_at_ms IS NULL AND role = 'resident') AS residents,
        SUM(revoked_at_ms IS NOT NULL) AS revoked
      FROM devices WHERE home_id = ?`;
    const row = this.#get(sql, homeId);
    const count = (name: string) => (row === undefined ? 0 : (optionalInteger(row, name) ?? 0));
    return {
      caregivers: count("caregivers"),
      residents: count("residents"),
      revoked: count("revoked"),
    };
  }

  /**
   * Replaces the home's devices with the hub's full phone list, in one transaction. A phone that is
   * missing or removed is revoked, and a revocation is never undone. A device ID that belongs to
   * another home is refused and left alone.
   */
  syncDevices(homeId: string, phones: readonly PhoneListEntry[], nowMs: number): SyncResult {
    return this.#transaction(() => {
      const revoked: string[] = [];
      const refused: string[] = [];
      const listed = new Set<string>();
      for (const phone of phones) {
        const existing = this.device(phone.device_id);
        if (existing !== undefined && existing.homeId !== homeId) {
          refused.push(phone.device_id);
          continue;
        }
        listed.add(phone.device_id);
        if (phone.removed) {
          if (existing !== undefined && this.#revoke(phone.device_id, nowMs)) {
            revoked.push(phone.device_id);
          }
        } else if (existing === undefined) {
          const sql =
            "INSERT INTO devices (device_id, home_id, role, credential_sha256) VALUES (?, ?, ?, ?)";
          this.#run(sql, phone.device_id, homeId, phone.role, phone.credential_sha256);
        } else if (existing.revokedAtMs === null) {
          const sql = "UPDATE devices SET role = ?, credential_sha256 = ? WHERE device_id = ?";
          this.#run(sql, phone.role, phone.credential_sha256, phone.device_id);
        }
      }
      const active = "SELECT device_id FROM devices WHERE home_id = ? AND revoked_at_ms IS NULL";
      for (const row of this.#all(active, homeId)) {
        const deviceId = text(row, "device_id");
        if (!listed.has(deviceId) && this.#revoke(deviceId, nowMs)) revoked.push(deviceId);
      }
      return { revoked, refused };
    });
  }

  /** Revokes a device and deletes its push tokens; false if it was already revoked or unknown. */
  revokeDevice(deviceId: string, nowMs: number): boolean {
    return this.#transaction(() => this.#revoke(deviceId, nowMs));
  }

  #revoke(deviceId: string, nowMs: number): boolean {
    const sql =
      "UPDATE devices SET revoked_at_ms = ? WHERE device_id = ? AND revoked_at_ms IS NULL";
    const changed = this.#run(sql, nowMs, deviceId) === 1;
    this.#run("DELETE FROM push_tokens WHERE device_id = ?", deviceId);
    return changed;
  }

  // Push tokens and push health

  /** Saves a device's token for an environment. A token moves to the device that sent it last. */
  setPushToken(deviceId: string, env: Environment, token: string, nowMs: number): void {
    this.#transaction(() => {
      const moved =
        "DELETE FROM push_tokens WHERE environment = ? AND token = ? AND device_id <> ?";
      this.#run(moved, env, token, deviceId);
      const sql = `INSERT INTO push_tokens (device_id, environment, token, updated_at_ms) VALUES (?, ?, ?, ?)
        ON CONFLICT (device_id, environment) DO UPDATE SET token = excluded.token, updated_at_ms = excluded.updated_at_ms`;
      this.#run(sql, deviceId, env, token, nowMs);
    });
  }

  /** Deletes a token Apple refused, wherever it is. */
  deletePushToken(env: Environment, token: string): void {
    this.#run("DELETE FROM push_tokens WHERE environment = ? AND token = ?", env, token);
  }

  /** The environment of the device's most recently registered token, if it has one. */
  pushEnvironment(deviceId: string): Environment | undefined {
    const sql =
      "SELECT environment FROM push_tokens WHERE device_id = ? ORDER BY updated_at_ms DESC, environment LIMIT 1";
    const row = this.#get(sql, deviceId);
    return row === undefined ? undefined : environment(text(row, "environment"));
  }

  /** Every token of the home's caregiver devices that aren't revoked: where alerts are pushed. */
  pushTargets(homeId: string): PushTarget[] {
    const sql = `SELECT t.device_id, t.environment, t.token FROM push_tokens t
      JOIN devices d ON d.device_id = t.device_id
      WHERE d.home_id = ? AND d.role = 'caregiver' AND d.revoked_at_ms IS NULL
      ORDER BY t.device_id, t.environment`;
    return this.#all(sql, homeId).map((row) => ({
      deviceId: text(row, "device_id"),
      environment: environment(text(row, "environment")),
      token: text(row, "token"),
    }));
  }

  /** Records Apple's answer for an environment: success, or the reason it refused. */
  recordPushResult(env: Environment, error: string | null, atMs: number): void {
    const sql =
      error === null
        ? `INSERT INTO push_health (environment, last_ok_at_ms) VALUES (?, ?)
           ON CONFLICT (environment) DO UPDATE SET last_ok_at_ms = excluded.last_ok_at_ms`
        : `INSERT INTO push_health (environment, last_error, last_error_at_ms) VALUES (?, ?, ?)
           ON CONFLICT (environment) DO UPDATE SET last_error = excluded.last_error, last_error_at_ms = excluded.last_error_at_ms`;
    if (error === null) this.#run(sql, env, atMs);
    else this.#run(sql, env, error, atMs);
  }

  pushHealth(env: Environment): PushHealth {
    const sql =
      "SELECT last_ok_at_ms, last_error, last_error_at_ms FROM push_health WHERE environment = ?";
    const row = this.#get(sql, env);
    return {
      environment: env,
      lastOkAtMs: row === undefined ? null : optionalInteger(row, "last_ok_at_ms"),
      lastError: row === undefined ? null : optionalText(row, "last_error"),
      lastErrorAtMs: row === undefined ? null : optionalInteger(row, "last_error_at_ms"),
    };
  }

  // Messages

  /**
   * Stores a checked wrapper for the home. A msg_id the home already has is a duplicate and isn't
   * stored again. For a latest-only type, the home's older messages of that type are deleted.
   */
  storeMessage(homeId: string, wrapper: Wrapper, receivedAtMs: number): StoredMessage {
    return this.#transaction(() => {
      const insert = `INSERT INTO messages (home_id, msg_id, type, to_device, received_at_ms, wrapper)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (home_id, msg_id) DO NOTHING RETURNING seq`;
      const json = JSON.stringify(wrapper);
      const to = wrapper.to ?? null;
      const row = this.#get(insert, homeId, wrapper.msg_id, wrapper.type, to, receivedAtMs, json);
      if (row === undefined) {
        const sql = "SELECT seq FROM messages WHERE home_id = ? AND msg_id = ?";
        const found = this.#get(sql, homeId, wrapper.msg_id);
        if (found === undefined) throw new RelayStoreError("a duplicate message was not found");
        return { seq: integer(found, "seq"), duplicate: true };
      }
      const seq = integer(row, "seq");
      if (LATEST_ONLY_TYPES.includes(wrapper.type)) {
        const older = "DELETE FROM messages WHERE home_id = ? AND type = ? AND seq < ?";
        this.#run(older, homeId, wrapper.type, seq);
      }
      return { seq, duplicate: false };
    });
  }

  /**
   * One page of the home's messages for a phone, oldest first, after its cursor: home-key messages
   * and its own `to` messages for a caregiver, only its own `to` messages for a resident. A cursor
   * that isn't this relay's, or is past any it issued, starts at the 7-day window.
   */
  messagePage({ homeId, deviceId, role, after, limit, nowMs }: PageQuery): MessagePage {
    const parsed = parseRelayCursor(after);
    const own = parsed !== undefined && parsed <= this.#lastSeq();
    const afterSeq = own ? parsed : 0;
    const forPhone =
      role === "caregiver" ? "(to_device IS NULL OR to_device = ?)" : "to_device = ?";
    const sql = `SELECT seq, wrapper FROM messages
      WHERE home_id = ? AND seq > ? AND received_at_ms >= ? AND ${forPhone}
      ORDER BY seq LIMIT ?`;
    const rows = this.#all(sql, homeId, afterSeq, nowMs - MESSAGE_RETENTION_MS, deviceId, limit);
    const messages = rows.map((row) => storedWrapper(text(row, "wrapper")));
    const last = rows.at(-1);
    if (last !== undefined) return { messages, next: relayCursor(integer(last, "seq")) };
    if (own) return { messages, next: relayCursor(parsed) };
    const newest = this.#get("SELECT MAX(seq) AS seq FROM messages WHERE home_id = ?", homeId);
    const seq = newest === undefined ? null : optionalInteger(newest, "seq");
    return { messages, next: seq === null ? null : relayCursor(seq) };
  }

  /** The highest sequence number this database has issued, 0 before the first message. */
  #lastSeq(): number {
    const row = this.#get("SELECT seq FROM sqlite_sequence WHERE name = 'messages'");
    return row === undefined ? 0 : integer(row, "seq");
  }

  /** Records that Apple has answered every push of message `seq`, so a restart won't push it again. */
  markPushed(seq: number, atMs: number): void {
    this.#run("UPDATE messages SET pushed_at_ms = ? WHERE seq = ?", atMs, seq);
  }

  /** Alerts received since `sinceMs` and never pushed, oldest first. */
  unpushedAlerts(sinceMs: number): UnpushedAlert[] {
    const sql = `SELECT seq, home_id, wrapper FROM messages
      WHERE type = 'alert' AND pushed_at_ms IS NULL AND received_at_ms >= ? ORDER BY seq`;
    return this.#all(sql, sinceMs).map((row) => ({
      homeId: text(row, "home_id"),
      seq: integer(row, "seq"),
      wrapper: storedWrapper(text(row, "wrapper")),
    }));
  }

  /** Deletes messages older than the 7-day window, in batches; returns how many. */
  sweep(nowMs: number): number {
    const sql = `DELETE FROM messages WHERE seq IN
      (SELECT seq FROM messages WHERE received_at_ms < ? ORDER BY seq LIMIT ?)`;
    let total = 0;
    for (;;) {
      const deleted = this.#run(sql, nowMs - MESSAGE_RETENTION_MS, RELAY_SWEEP_BATCH);
      total += deleted;
      if (deleted < RELAY_SWEEP_BATCH) return total;
    }
  }
}

function storedWrapper(json: string): Wrapper {
  const parsed = parseWrapper(JSON.parse(json));
  if (!parsed.ok) throw new RelayStoreError(`a stored message has a bad ${parsed.field}`);
  return parsed.wrapper;
}
