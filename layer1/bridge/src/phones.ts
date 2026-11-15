/**
 * The paired phones, and the only reader and writer of phones.json in the state folder. The file
 * holds each phone's own key, so it is a secret: written whole and owner-only through json-file.ts,
 * never logged and never served. A removed phone keeps its device ID without its key, so its
 * requests are refused as removed rather than unknown.
 */
import { createSecretKey, type KeyObject } from "node:crypto";
import path from "node:path";
import { errorMessage, JsonFileError, readJsonFile, updateJsonFile } from "./json-file.ts";
import { PHONE_KEY_BYTES, STATE_NAMES } from "./settings.ts";

export type PhoneRole = "caregiver" | "resident";

/** A phone to add to the list. */
export interface NewPhone {
  readonly deviceId: string;
  readonly name: string;
  readonly role: PhoneRole;
  /** The phone's own key, which opens its requests: a secret key of PHONE_KEY_BYTES bytes. */
  readonly phoneKey: KeyObject;
  /** The SHA-256 of its device credential in lowercase hex; the list never holds the credential. */
  readonly credentialSha256: string;
}

/** A paired phone as the setup page lists it: no key and no credential hash. */
export interface PhoneListing extends Pick<NewPhone, "deviceId" | "name" | "role"> {
  /** When it was paired, in UTC to the second. */
  readonly pairedAt: string;
}

/** A device ID's phone: paired, with the role and the key for its requests; removed; or unknown. */
export type PhoneLookup =
  | { readonly state: "paired"; readonly role: PhoneRole; readonly phoneKey: KeyObject }
  | { readonly state: "removed" | "unknown" };

/** phones.json can't be read or a change would break its rules. Names the file, never a value. */
export class PhonesError extends Error {
  override name = "PhonesError";
}

type Phone = NewPhone & PhoneListing;

/** The list in memory, with each key as a key object, which prints no key material. */
interface Phones {
  readonly paired: readonly Phone[];
  readonly removed: readonly { readonly deviceId: string; readonly removedAt: string }[];
}

const DEVICE_ID = /^[A-Za-z0-9._-]{1,64}$/;
const UTC_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export class PhoneRegistry {
  readonly #file: string;
  #phones: Phones;

  private constructor(file: string, phones: Phones) {
    this.#file = file;
    this.#phones = phones;
  }

  /**
   * The phone list in `stateDir`, empty when there is no phones.json. A file that can't be read or
   * breaks the rules throws a PhonesError naming it, and the registry never overwrites it.
   */
  static async load(stateDir: string): Promise<PhoneRegistry> {
    const file = path.join(stateDir, STATE_NAMES.phones);
    const data = await readJsonFile(file).catch((error: unknown) => {
      if (error instanceof JsonFileError && error.code === "ENOENT") return undefined;
      throw new PhonesError(errorMessage(error), { cause: error });
    });
    return new PhoneRegistry(file, parse(file, data));
  }

  /** The paired phones, in the order they were paired. */
  list(): PhoneListing[] {
    return this.#phones.paired.map(({ deviceId, name, role, pairedAt }) => ({
      deviceId,
      name,
      role,
      pairedAt,
    }));
  }

  lookup(deviceId: string): PhoneLookup {
    const phone = this.#phones.paired.find((paired) => paired.deviceId === deviceId);
    if (phone !== undefined) return { state: "paired", role: phone.role, phoneKey: phone.phoneKey };
    const removed = this.#phones.removed.some((entry) => entry.deviceId === deviceId);
    return { state: removed ? "removed" : "unknown" };
  }

  /** Adds a phone, paired now. Adds started together all land. */
  async add(phone: NewPhone): Promise<void> {
    const added: Phone = { ...phone, pairedAt: utcNow() };
    await this.#change(({ paired, removed }) => ({ paired: [...paired, added], removed }));
    console.log(`L1 phones: phone ${added.deviceId} paired as ${added.role}`);
  }

  /** Moves a paired phone to the removed list and drops its key. Removing it again does nothing. */
  async remove(deviceId: string): Promise<void> {
    if (this.lookup(deviceId).state !== "paired") return;
    await this.#change(({ paired, removed }) => {
      if (!paired.some((phone) => phone.deviceId === deviceId)) return { paired, removed };
      const kept = paired.filter((phone) => phone.deviceId !== deviceId);
      return { paired: kept, removed: [...removed, { deviceId, removedAt: utcNow() }] };
    });
    console.log(`L1 phones: phone ${deviceId} removed`);
  }

  /**
   * Applies `change` to the list the file holds now, in the file's update queue, and writes the
   * result if it meets the file's rules. Memory changes only once the write has succeeded.
   */
  async #change(change: (phones: Phones) => Phones): Promise<void> {
    let next = this.#phones;
    await updateJsonFile(this.#file, (current) => {
      const content = toJson(change(parse(this.#file, current)));
      next = parse(this.#file, content);
      return content;
    });
    this.#phones = next;
  }
}

/** The list in phones.json's parsed `data`, or none when there is no file. A broken rule throws. */
function parse(file: string, data: unknown): Phones {
  if (data === undefined) return { paired: [], removed: [] };
  const get = <T>(entry: unknown, at: string, name: string, ok: (v: unknown) => v is T): T => {
    const value: unknown =
      typeof entry === "object" && entry !== null ? Reflect.get(entry, name) : null;
    if (!ok(value)) throw new PhonesError(`${file}: ${at}${name} is missing or invalid`);
    return value;
  };
  get(data, "", "schema_version", (value): value is 1 => value === 1);
  const paired = get(data, "", "phones", isList).map((entry, index): Phone => {
    const at = `phones[${index}].`;
    return {
      deviceId: get(entry, at, "device_id", matches(DEVICE_ID)),
      name: get(entry, at, "name", isName),
      role: get(entry, at, "role", isRole),
      pairedAt: get(entry, at, "paired_at", matches(UTC_SECONDS)),
      phoneKey: createSecretKey(Buffer.from(get(entry, at, "phone_key", isKey), "base64url")),
      credentialSha256: get(entry, at, "credential_sha256", matches(SHA256_HEX)),
    };
  });
  const removed = get(data, "", "removed", isList).map((entry, index) => {
    const at = `removed[${index}].`;
    return {
      deviceId: get(entry, at, "device_id", matches(DEVICE_ID)),
      removedAt: get(entry, at, "removed_at", matches(UTC_SECONDS)),
    };
  });
  const deviceIds = [...paired, ...removed].map((entry) => entry.deviceId);
  if (new Set(deviceIds).size < deviceIds.length) {
    throw new PhonesError(`${file}: a device_id is used twice`);
  }
  return { paired, removed };
}

/** The list as phones.json holds it. */
function toJson({ paired, removed }: Phones) {
  return {
    schema_version: 1,
    phones: paired.map((phone) => ({
      device_id: phone.deviceId,
      name: phone.name,
      role: phone.role,
      paired_at: phone.pairedAt,
      phone_key: phone.phoneKey.export().toString("base64url"),
      credential_sha256: phone.credentialSha256,
    })),
    removed: removed.map((entry) => ({ device_id: entry.deviceId, removed_at: entry.removedAt })),
  };
}

/** Canonical base64url, without padding, of PHONE_KEY_BYTES bytes. */
function isKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const bytes = Buffer.from(value, "base64url");
  return bytes.length === PHONE_KEY_BYTES && bytes.toString("base64url") === value;
}

const matches =
  (pattern: RegExp) =>
  (value: unknown): value is string =>
    typeof value === "string" && pattern.test(value);
const isList = (value: unknown): value is unknown[] => Array.isArray(value);
const isName = (value: unknown): value is string => typeof value === "string" && value !== "";
const isRole = (value: unknown): value is PhoneRole =>
  value === "caregiver" || value === "resident";
/** The time now in UTC to the second, as phones.json writes times: 2026-11-14T15:10:00Z. */
const utcNow = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
