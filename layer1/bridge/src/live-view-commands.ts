/**
 * The commands the home laptop's bridge sends a worker laptop's bridge in link_reply.commands
 * (phone-hub.md §6.6): open the live view sender page for a session, or close it. The sender token
 * in live_view_open is a secret: it goes only to the camera laptop's bridge, and nothing logs it.
 */
import * as settings from "./settings.ts";
import { isUtcTime } from "./wire.ts";

export interface LiveViewOpen {
  readonly type: "live_view_open";
  readonly session_id: string;
  readonly sender_token: string;
  readonly signaling_url: string;
  readonly expires_at: string;
}

export interface LiveViewClose {
  readonly type: "live_view_close";
  readonly session_id: string;
  readonly reason: string;
}

export type LinkCommand = LiveViewOpen | LiveViewClose;

/** IDs as phone-hub.md §1 has them, the relay's sender token (32 bytes in base64url) and codes. */
const ID = /^[A-Za-z0-9._-]{1,64}$/;
const SENDER_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const CODE = /^[a-z][a-z0-9_]{0,63}$/;
/** The signaling URL is the relay's own, under its live view path (§7.4). */
const SIGNAL_PATH = new RegExp(`^${settings.LIVE_VIEW_PATH}/([A-Za-z0-9._-]{1,64})/signal$`);

const OPEN_FIELDS = ["type", "session_id", "sender_token", "signaling_url", "expires_at"];
const CLOSE_FIELDS = ["type", "session_id", "reason"];

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether `value` has exactly `fields`, no more and no fewer. */
function hasExactly(value: Readonly<Record<string, unknown>>, fields: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => Object.hasOwn(value, field));
}

/** A ws: or wss: URL whose path is this session's signaling path, with no query or credentials. */
function isSignalingUrl(value: unknown, sessionId: string): value is string {
  if (
    typeof value !== "string" ||
    value.length > settings.LIVE_VIEW_COMMAND_URL_MAX_CHARS ||
    !URL.canParse(value)
  ) {
    return false;
  }
  const url = new URL(value);
  const match = SIGNAL_PATH.exec(url.pathname);
  return (
    (url.protocol === "wss:" || url.protocol === "ws:") &&
    url.username === "" &&
    url.password === "" &&
    url.search === "" &&
    url.hash === "" &&
    match?.[1] === sessionId
  );
}

/** A command from link_reply.commands, or undefined when it breaks §6.6's shape in any way. */
export function parseLinkCommand(value: unknown): LinkCommand | undefined {
  if (!isRecord(value)) return undefined;
  const { type, session_id: sessionId } = value;
  if (typeof sessionId !== "string" || !ID.test(sessionId)) return undefined;
  if (type === "live_view_open" && hasExactly(value, OPEN_FIELDS)) {
    const { sender_token: token, signaling_url: url, expires_at: expiresAt } = value;
    if (typeof token !== "string" || !SENDER_TOKEN.test(token)) return undefined;
    if (!isSignalingUrl(url, sessionId) || !isUtcTime(expiresAt)) return undefined;
    return {
      type,
      session_id: sessionId,
      sender_token: token,
      signaling_url: url,
      expires_at: expiresAt,
    };
  }
  if (type === "live_view_close" && hasExactly(value, CLOSE_FIELDS)) {
    const { reason } = value;
    if (typeof reason !== "string" || !CODE.test(reason)) return undefined;
    return { type, session_id: sessionId, reason };
  }
  return undefined;
}
