/**
 * TURN logins for live view (phone-hub.md §7), in coturn's `use-auth-secret` form: the username is
 * the login's expiry in Unix seconds, a colon and the session ID; the password is the base64 of
 * HMAC-SHA1(shared secret, username). coturn refuses the login once that time has passed. The
 * shared secret is read once from the file relay.json names and is never logged or returned.
 */
import { createHmac, createSecretKey, type KeyObject } from "node:crypto";
import { readFileBytes } from "../../bridge/src/json-file.ts";
import type { TurnConfig } from "./config.ts";

/** One ICE server for WebRTC: STUN with no login, or TURN with the session's login. */
export type IceServer = Readonly<{
  urls: readonly string[];
  username?: string;
  credential?: string;
}>;

/** A TURN secret file that can't be used. The message names the file, never its contents. */
export class TurnSecretError extends Error {
  override name = "TurnSecretError";
}

/** The login coturn checks for one session, valid until `expiresAtMs`. */
export function turnLogin(
  secret: KeyObject,
  sessionId: string,
  expiresAtMs: number,
): { username: string; credential: string } {
  const username = `${Math.floor(expiresAtMs / 1000)}:${sessionId}`;
  const credential = createHmac("sha1", secret).update(username, "utf8").digest("base64");
  return { username, credential };
}

/** coturn's servers for live view: STUN, and TURN over UDP and TCP with the session's login. */
export class TurnServers {
  readonly #config: TurnConfig;
  readonly #secret: KeyObject;

  private constructor(config: TurnConfig, secret: KeyObject) {
    this.#config = config;
    this.#secret = secret;
  }

  /**
   * Reads the shared secret as coturn reads its `static-auth-secret` line: the file's text without
   * its trailing line breaks (RUNBOOK.md step 7 writes that line from the same file).
   */
  static async load(config: TurnConfig): Promise<TurnServers> {
    const file = config.secret_file;
    let bytes: Buffer;
    try {
      bytes = await readFileBytes(file);
    } catch (error) {
      throw new TurnSecretError(`${file} can't be read`, { cause: error });
    }
    let end = bytes.length;
    while (end > 0 && (bytes[end - 1] === 0x0a || bytes[end - 1] === 0x0d)) end -= 1;
    try {
      if (end === 0) throw new TurnSecretError(`${file} is empty`);
      return new TurnServers(config, createSecretKey(bytes.subarray(0, end)));
    } finally {
      bytes.fill(0);
    }
  }

  /** The ICE servers for one session, with a TURN login that ends at `expiresAtMs`. */
  iceServers(sessionId: string, expiresAtMs: number): IceServer[] {
    const { host, port } = this.#config;
    const login = turnLogin(this.#secret, sessionId, expiresAtMs);
    return [
      { urls: [`stun:${host}:${port}`] },
      {
        urls: [`turn:${host}:${port}?transport=udp`, `turn:${host}:${port}?transport=tcp`],
        ...login,
      },
    ];
  }
}
