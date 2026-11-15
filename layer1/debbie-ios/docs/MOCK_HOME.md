# Mock home (development only)

**What it is.** A small Node program in `MockHome/` that plays the coordinator laptop's bridge and the AWS relay,
speaking exactly the PROPOSED contracts in `docs/CONTRACTS.md`. The iPhone app talks to it through its **real**
transports (the same HTTP clients, crypto and Keychain code the app uses with the real bridge and relay). The
only difference is configuration. It is clearly labelled as a mock and is never part of any app build: it is a
separate process on a Mac. Nothing in it ships in Debug or Release builds of the app.

**Why this form** (decision D-009, sources in `docs/research/11a-engineering-architecture.md` R2/R20 and
`11b-engineering-webrtc-testing-perf.md`):
- It exercises the real networking, crypto and pairing code paths, not a test double.
- It runs every §5.1 flow end to end in the Simulator (which shares the Mac's network, so `http://127.0.0.1` works).
- It is written in the bridge team's language with only Node's built-in modules, so its crypto and endpoints are a
  working reference for them (and a second, independent implementation of the test vectors).

## Processes and ports

| Port (default) | Role in the mock | Real equivalent (Layer 1) |
|---|---|---|
| 7580 (base + 10) | LAN gateway + pairing (`/v1/hello`, `/v1/pair`, `/v1/lan/*`); 7582 (base + 12) when "moved" | Bridge network side, 7480 |
| 7581 (base + 11) | Relay API (`/v1/home`, `/v1/messages`, `/v1/commands`, `/v1/push-tokens`, `/v1/live-view/*`, `/v1/unpair`) and the KVS-style signalling WebSocket (`/kvs`) | API Gateway + KVS signalling |
| 7570 (base) | Control panel (web page) and control API, on 127.0.0.1 only | Bridge local side, 7470 (setup page with **Confirm**) |

**Ports.** The base is 7570 unless `DEBBIE_MOCK_PORT_BASE` says otherwise; the server, `smoke.mjs` (its own default, 7670), Debug app builds and the UI tests all read that one variable. Until build 8 the mock used the real bridge's own ports (7470, 7480), so with the bridge running on the same Mac the UI tests reached the bridge and skipped, and a mock that failed to start left its Bonjour advertisement behind (the build-8 review). The mock now advertises only once every port is listening, and exits 1 if any port is taken.

**Binding.** Every port listens on **127.0.0.1 only** (binding brief §6): the mock is never reachable from any network. It advertises its LAN gateway by Bonjour exactly like the real bridge, as `_debbie._tcp` on its LAN port at 127.0.0.1 with TXT `hub=<first 8 base64url characters of the mock hub key>`, via `dns-sd -P`. The "gateway moved" control re-registers it on another port, so the app's rediscovery path is tested. (Lead decision X37.)

**Not the demo home.** Trying a TestFlight build on a real iPhone uses the separate **on-device demo home** inside the app (binding brief §6), not this mock.

## Control panel and API (127.0.0.1:7570)

The page shows the pairing QR code (and the payload text, for the Simulator's paste field), the 4-digit code with
**Confirm** and **Cancel**, the paired phones, and buttons for every state the brief asks for. Each button calls the
control API, so UI tests can drive the same actions:

| Control | `POST /control/…` | Effect |
|---|---|---|
| New pairing code | `pairing/new` | New QR payload (10-minute expiry) |
| Confirm / Cancel pairing | `pairing/confirm`, `pairing/cancel` | Completes or declines the pending pairing |
| Trigger alert | `alert` `{kind, severity, title, body}` | Encrypts an `alert` with the home key into the outbox (LAN + relay), and writes the matching push payload |
| Update alert | `alert/update` `{alert_id, title, body}` | Same `alert_id`, `update: true` |
| Late delivery | `alert/late` `{minutes}` | An alert whose `detected_at` is N minutes before it is released, so the app shows both times |
| Hub offline / online | `hub/offline`, `hub/online` | Relay reports `online:false` with the last contact; LAN stops answering |
| Monitoring degraded / restored | `monitoring/degraded` `{reasons}`, `monitoring/ok` | Heartbeat contents + a `monitoring` message |
| Heartbeat stale | `heartbeat/stop`, `heartbeat/start` | Stops heartbeats so the app must show "unknown" |
| Removed phone | `phone/remove` `{device_id}` | Relay answers `401 device_removed`; LAN answers `403 device_removed` (CONTRACTS §3.5) |
| Gateway unreachable / moved | `lan/unreachable`, `lan/moved`, `lan/blackhole`, `lan/restore` | Closes the LAN listener; or moves it to another port and re-registers Bonjour; or accepts and never answers |
| Live view consent | `live/allow`, `live/deny` | Resident's setting |
| Live view outcome | `live/next` `{outcome: "ready" \| "denied" \| "fail" \| "timeout" \| "go_away" \| "status_error" \| "reconnect_ice"}` | Scripts the next session (requesting → denied / ready → connecting → playing, or failed) |
| End live view | `live/end` `{reason: "expired" \| "stopped" \| "resident_turned_off" \| "lost"}` | Ends the active session with that reason |
| Add-a-laptop QR | `laptop/new` `{name}` | Creates a pending join request and its QR payload |
| Push to Simulator | `push` `{udid}` | Runs `xcrun simctl push` with the latest encrypted alert payload |
| Reset | `reset` | Forgets everything |
| State | `GET /control/state` | JSON snapshot for tests (never includes keys) |

## Live view in the mock

The relay facade issues sessions and a `signaling_url` pointing at the mock's own WebSocket, which relays
KVS-format messages between the app (viewer) and the control panel page in a desktop browser (master). That
page streams an animated canvas through the browser's WebRTC, the same shape as Layer 1's real sender. If no
master page is open, the scripted outcomes above still drive every app state (requesting, denied, ready,
connecting, playing, ending, ended, failed).

## Running it

```sh
node MockHome/server.mjs              # 127.0.0.1 only; prints the panel URL; Ctrl-C to stop
open http://127.0.0.1:7570            # control panel
tools/ci/mock-ui-tests.sh             # the UI tests that need the mock, on a mock of their own; fails on any skip
```

Debug builds of the app use the mock when launched with `-DebbieTransport mock` (or the Developer menu).

**Other ports.** To run a second mock, move it with one variable (control at the base, the LAN gateway 10 above it,
the relay 11, the moved gateway 12):

```sh
DEBBIE_MOCK_PORT_BASE=7770 node MockHome/server.mjs --auto-confirm
TEST_RUNNER_DEBBIE_MOCK_PORT_BASE=7770 tools/ci/xcb.sh …   # xcodebuild gives the UI tests DEBBIE_MOCK_PORT_BASE; they pass it to the app
```
Release builds have no switch to it and can't reach it: it listens on 127.0.0.1 only, and Release builds require HTTPS for the relay.
