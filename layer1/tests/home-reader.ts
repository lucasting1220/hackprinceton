/**
 * The app's side of home-key messages, for tests: it checks a fetched §3 wrapper as the app does
 * and opens it with the home key, the wrapper's type in the associated data.
 */
import assert from "node:assert/strict";
import type { KeyObject } from "node:crypto";
import { open } from "../bridge/src/phone-crypto.ts";
import type { Wrapper } from "../bridge/src/wire.ts";

/** A home-key message's plaintext, with the fields these tests read by name. */
export type HomePlaintext = {
  readonly [field: string]: unknown;
  readonly msg_id?: unknown;
  readonly alert_id?: unknown;
  readonly kind?: unknown;
  readonly severity?: unknown;
  readonly title?: unknown;
  readonly body?: unknown;
  readonly update?: unknown;
  readonly confidence?: unknown;
};

/** The plaintext of a home-key wrapper, once its msg_id, type and sent_at match the wrapper's. */
export function openHomeWrapper(
  wrapper: Wrapper,
  homeKey: KeyObject,
  homeId: string,
): HomePlaintext {
  assert.equal(wrapper.envelope.kid, "home");
  const bytes = open(wrapper.envelope, homeKey, { homeId, type: wrapper.type });
  const plaintext = JSON.parse(bytes.toString("utf8")) as HomePlaintext;
  const { msg_id: msgId, type, sent_at: sentAt } = plaintext;
  assert.deepEqual([msgId, type, sentAt], [wrapper.msg_id, wrapper.type, wrapper.sent_at]);
  return plaintext;
}
