import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLinkCommand } from "../bridge/src/live-view-commands.ts";

const SESSION = "6f1c2b9e-0c1d-4a55-9a36-9f2b6a4d7e10";
const OPEN = {
  type: "live_view_open",
  session_id: SESSION,
  sender_token: "A".repeat(43),
  signaling_url: `wss://relay.example.com/v1/live-view/sessions/${SESSION}/signal`,
  expires_at: "2026-11-15T15:25:00Z",
} as const;
const CLOSE = { type: "live_view_close", session_id: SESSION, reason: "stopped" } as const;

test("live_view_open and live_view_close parse with exactly their fields", () => {
  assert.deepEqual(parseLinkCommand(OPEN), OPEN);
  assert.deepEqual(parseLinkCommand(CLOSE), CLOSE);
  const local = `ws://127.0.0.1:7490/v1/live-view/sessions/${SESSION}/signal`;
  assert.deepEqual(parseLinkCommand({ ...OPEN, signaling_url: local }), {
    ...OPEN,
    signaling_url: local,
  });
});

test("a command with a missing, extra or bad field is refused", () => {
  const { sender_token: _token, ...noToken } = OPEN;
  const bad: unknown[] = [
    null,
    [],
    "live_view_open",
    { ...OPEN, type: "live_view_start" },
    noToken,
    { ...OPEN, extra: 1 },
    { ...CLOSE, sender_token: OPEN.sender_token },
    { ...OPEN, session_id: "has space" },
    { ...OPEN, sender_token: "short" },
    { ...OPEN, sender_token: `${"A".repeat(42)}+` },
    { ...OPEN, expires_at: "tomorrow" },
    { ...OPEN, signaling_url: "not a url" },
    { ...OPEN, signaling_url: `https://relay.example.com/v1/live-view/sessions/${SESSION}/signal` },
    { ...OPEN, signaling_url: "wss://relay.example.com/v1/live-view/sessions/other/signal" },
    { ...OPEN, signaling_url: `${OPEN.signaling_url}?token=x` },
    { ...OPEN, signaling_url: OPEN.signaling_url.replace("wss://", "wss://user:pw@") },
    { ...OPEN, signaling_url: `wss://r.example/${"a".repeat(3_000)}` },
    { ...CLOSE, reason: "Not A Code" },
    { ...CLOSE, reason: 3 },
  ];
  for (const value of bad) assert.equal(parseLinkCommand(value), undefined, JSON.stringify(value));
});
