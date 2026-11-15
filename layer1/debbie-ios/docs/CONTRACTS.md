# Phone ↔ hub contracts (iPhone track)

**Status: PROPOSED.** Everything in this file is a proposal from the iPhone track, following the Layer 1 doc
("Phone ↔ hub messages (proposed)", "Remote connection (AWS)", "Live view", "Handoff to Layer 4"). Where the
Layer 1 doc already fixes something, it is quoted and marked **[L1]**. Everything else is marked **PROPOSED** and
needs the bridge and relay builders to agree. Once the laptop track passes the test vectors in §10, this file is
copied to `layer1/contracts/phone-hub.md`, as the Layer 1 doc says.

**Work by others checked (read-only):** `layer-1@fa56475` on 2026-11-14 at 10:14 EST has no `layer1/contracts/`, `layer1/bridge` or `layer1/cloud`, so nothing is marked ADOPTED yet. This is re-checked at the start of each networking phase; adopted items get the commit hash.

Source of truth: `lucasting1220/hackprinceton@layer-1:docs/layer1-join-and-connect.md` (commit fa56475, identical to the local
file at 09:31 EST; snapshot in `docs/context/upstream/layer1-join-and-connect.local-snapshot.md`). If that doc changes, it wins; update this file to match.

---

## 1. Conventions (PROPOSED)

| Item | Rule |
|---|---|
| Encoding | JSON, UTF-8, `snake_case` field names. Unknown fields are ignored by receivers (forward compatibility). |
| Binary in JSON | base64url, RFC 4648 §5, **no padding** when sending; receivers accept with or without padding. |
| Times in messages | ISO 8601 UTC strings with a `Z` suffix, optionally with fractional seconds: `"2026-11-14T15:12:03Z"`. **Exception [L1]:** the QR code's `exp` and the relay's "hub offline" push use Unix seconds (integers). |
| IDs | `home_id`, `device_id`, `msg_id`, `alert_id`, `request_id`, `session_id`, `join_id`, `node_id`: lowercase UUID v4 strings. |
| Versioning | Every top-level object carries `"v": 1`. A receiver that sees a higher `v` it doesn't understand rejects it with `unsupported_version`. |
| Errors (HTTP) | Non-2xx responses carry `{"v":1,"error":{"code":"<snake_case>","message":"<safe, no secrets>"}}`. |
| Secrets | The home key, phone keys, device credentials, join tokens and QR secrets never appear in logs, URLs or query strings. |

---

## 2. Cryptography

All primitives **[L1]**: X25519, HKDF-SHA256, HMAC-SHA256, ChaCha20-Poly1305 (IETF, 12-byte nonce, 16-byte tag). iPhone: CryptoKit. Bridge: Node's built-in `crypto`. No other algorithms.

### 2.1 Pairing QR code [L1] + PROPOSED details

```json
{"v":1,"addrs":["192.168.1.20:7480","10.0.0.7:7480"],"hub_pub":"<b64url 32 bytes>","secret":"<b64url 16 bytes>","exp":1763140200}
```

- `addrs` **[L1]**: every IPv4 address and port of the bridge's network side. PROPOSED: each entry is the string `"a.b.c.d:port"`. The phone tries them in order (§4.1).
- `hub_pub` **[L1]**: the hub's X25519 public key, 32 raw bytes. `secret` **[L1]**: 16 random bytes. `exp` **[L1]**: Unix seconds, 10 minutes after creation.
- PROPOSED: an optional `"kind":"pair"`. If `kind` is absent, the code is a pairing code. The laptop-join QR (§6) always has `"kind":"join"`.
- PROPOSED: the QR content is the compact JSON above, encoded as a QR code in byte mode with error correction level M. The app rejects a payload over 1,024 bytes.

### 2.2 Pairing request and proof [L1]

`proof = HMAC-SHA256(key = secret, msg = phone_pub ‖ role ‖ 0x00 ‖ name)`

PROPOSED byte-level detail: `secret` is the 16 raw bytes; `phone_pub` is the 32 raw bytes (not base64); `role` is the ASCII bytes of `caregiver` or `resident`; `0x00` is one zero byte; `name` is UTF-8, NFC-normalised, 1–64 Unicode scalars, with no control characters. The output is 32 bytes, base64url in JSON.

### 2.3 Key agreement and derivation [L1]

```
shared    = X25519(phone_private, hub_pub)                        // 32 bytes; reject all-zero output
phone_key = HKDF-SHA256(ikm = shared, salt = secret, info = "debbie/v1/phone-key", L = 32)
code      = uint32_be(HKDF-SHA256(ikm = shared, salt = secret, info = "debbie/v1/code", L = 4)) mod 10000,
            shown as 4 digits, zero-padded
```

`info` strings are the ASCII bytes shown, with no terminator. PROPOSED: both sides MUST reject an all-zero shared secret (a low-order public key).

### 2.4 Envelope [L1]

```json
{"v":1,"kid":"home","n":"<b64url 12 bytes>","c":"<b64url ciphertext ‖ 16-byte tag>"}
```

- `kid` **[L1]**: `home` (home key), a `device_id` (that phone's own key) or `pair` (the phone key, during pairing).
- `n` **[L1]**: a fresh random 12-byte nonce for every message. Never reused with the same key.
- Associated data **[L1]**: ASCII `debbie/v1/{home_id}/{kid}/{type}`, or `debbie/v1/pair` during pairing.
- PROPOSED `{type}` values: exactly the `type` of the routing wrapper (§3). Binding the type into the associated data means the relay can't relabel an alert as a status without breaking decryption.
- CryptoKit note **[L1]**: `ChaChaPoly.SealedBox.combined` is `nonce ‖ ciphertext ‖ tag`; split it to fill `n` and `c`. Node: `createCipheriv('chacha20-poly1305', key, n, {authTagLength:16})`, `setAAD(ad, {plaintextLength})`, `c = update ‖ final ‖ getAuthTag()`.

### 2.5 Plaintext freshness [L1]

Every plaintext carries `msg_id` and `sent_at`. Receivers drop repeated `msg_id`s. The hub drops any **command** (phone → hub) whose `sent_at` is more than 30 s old or more than 30 s in the future. PROPOSED: phones don't apply the 30-second rule to hub → phone messages, because alerts may wait in the outbox during an outage; they de-duplicate by `msg_id` only. The phone keeps the last 1,000 `msg_id`s it has seen.

---

## 3. Routing wrapper (PROPOSED)

The relay must see a message's ID (de-duplication [L1]), its class (to decide whether to push, and to run the heartbeat watchdog [L1]) and, for alert updates, the alert ID (the APNs collapse ID [L1]). So every encrypted message travels inside a small cleartext wrapper:

```json
{"v":1,"msg_id":"6f1c…","type":"alert","collapse_id":"<alert_id, alerts only>","sent_at":"2026-11-14T15:12:03Z","envelope":{"v":1,"kid":"home","n":"…","c":"…"}}
```

The `msg_id` and `type` in the wrapper MUST equal the ones in the plaintext. A receiver that finds a mismatch drops the message. `type` is bound into the associated data (§2.4).

PROPOSED: a hub → phone message encrypted with **one phone's own key** (`reply`) carries `"to": "<device_id>"` in the wrapper, so the relay and the LAN gateway deliver it only to that phone. Home-key messages carry no `to`, and go to every caregiver phone in the home. `to` is routing data the relay already knows.

### Message types

| `type` | Direction | Key (`kid`) | Plaintext fields (besides `msg_id`, `sent_at`) | Pushed? |
|---|---|---|---|---|
| `alert` | hub → caregivers | `home` | `alert_id, kind, severity, detected_at, title, body, update` **[L1 Handoff to Layer 4]** | Yes, time-sensitive |
| `heartbeat` | hub → caregivers | `home` | `monitoring` object (§3.2) | No |
| `care_status` | hub → caregivers | `home` | Layer 4's status (§3.3) | No |
| `monitoring` | hub → caregivers | `home` | `state: "degraded" \| "restored"`, `reasons: [string]`, `monitoring` (§3.2) | Yes, active |
| `reply` | hub → one phone | device ID | `request_id, title, body` | No |
| `ack` | phone → hub | device ID | `alert_id, acked_at, false_alarm` | — |
| `request` | phone → hub | device ID | `request_id, kind ("ask" \| "check_now"), text` (§3.4) | — |
| `laptop_approval` | phone → hub | device ID | `join_id, laptop_pub, name, approve` | — |
| `heart_rate` | phone → hub (LAN only) | device ID | `samples: [{t, bpm}]` | — |
| `live_view_setting` | resident phone → hub | device ID | `enabled` | — |
| `live_view_request` | phone → hub, via the relay | device ID | `request_id, viewer_client_id` **[L1 Live view step 1]** | — |
| `unpair` | phone → hub | device ID | none | — |
| `fetch` | phone → hub (LAN only) | device ID | `after` (cursor or null), `limit` | — |

### 3.1 Alert fields (PROPOSED values for the Layer 4 owner)

- `severity`: `"urgent"` (possible fall, call for help, no answer to "Are you okay?"), `"attention"` (needs a look soon: hub offline, monitoring limited, no movement for a long time) or `"info"` (back online, restored, confirmations). The phone treats **any other value as `"urgent"`** and logs a contract error without the content: the costliest failure is a missed emergency (`docs/research/10-caregivers-older-adults-alerting.md` R1).
- `kind`: `"fall"`, `"no_movement"`, `"sound"`, `"call_for_help"`, `"heart_rate_high"`, `"heart_rate_low"`, `"check_in"` or `"other"`. An unknown kind shows the generic alert icon, never nothing.
- `detected_at`: ISO 8601 UTC. `title` ≤ 60 characters and `body` ≤ 240 characters (APNs budget, §5). `update: true` rewrites the alert with the same `alert_id` (title, body or severity may change; `detected_at` doesn't).

### 3.2 `monitoring` object (inside `heartbeat` and `monitoring` messages)

```json
{
  "state": "ok",
  "laptops": [
    {"node_id": "…", "display_name": "Kitchen laptop", "sensors": ["camera"], "last_status_at": "2026-11-14T15:11:58Z", "reporting": true}
  ],
  "camera": "up",
  "mic": "up",
  "detection": {"fall": "running", "sound": "running"},
  "language_model": "available",
  "care_agent": "running"
}
```

- `state`: `"ok"` only when every laptop in `accepted-workers.json` is reporting, the camera and mic laptops are up, and fall and sound detection are running. Otherwise `"degraded"`, or `"starting"` before the first full report.
- `camera` and `mic`: `"up"`, `"down"`, `"declined"` (the resident said no) or `"none"`.
- `detection.*`: `"running"`, `"stopped"` or `"unplaced"`. `language_model`: `"available"` or `"unavailable"`. `care_agent`: `"running"` or `"down"`.
- The phone shows the heartbeat's facts only while the heartbeat is fresh: `sent_at` within 2 × the heartbeat interval (60 s, or 20 s for the demo) **[L1 Health]**. Older than that, the phone shows "can't confirm" instead of any all-clear.

### 3.3 `care_status` (Layer 4's `POST /v1/status`, PROPOSED fields)

```json
{"heart_rate": {"bpm": 72, "at": "2026-11-14T15:05:00Z", "trend": "steady"}, "no_heart_data": false, "no_heart_data_since": null}
```

`trend` is `"steady"`, `"rising"` or `"falling"`. `heart_rate` is null when there is none.

---

### 3.4 Requests and replies (PROPOSED; screens come later, per brief §5.3)

The Layer 1 doc's local calls are `POST /v1/requests {request_id, device_id, kind, text}` (Layer 1 → Layer 4) and `POST /v1/replies {request_id, title, body}` (Layer 4 → Layer 1). Requests are asynchronous: the phone gets an ID at once and fetches the reply later, because the relay's HTTP calls end after 30 s **[L1 Handoff to Layer 4]**.

| Step | Bytes |
|---|---|
| Phone sends | wrapper `{"v":1,"msg_id":"…","type":"request","sent_at":"…","envelope":<kid = device_id>}`; plaintext `{"msg_id":"…","sent_at":"…","type":"request","request_id":"<uuid>","kind":"ask","text":"How did Mum sleep?"}`, to `POST /v1/commands` (relay) or `POST /v1/lan/commands` |
| Accepted | `202 {"v":1,"accepted":true}` (the phone already holds `request_id`) |
| `kind` | `"ask"` = a question in plain words, which Layer 4 answers. `"check_now"` = ask the home to check on the resident now; Layer 4 decides what that means. `text` is empty for `check_now`, and 1–500 characters for `ask` |
| Hub replies | wrapper `{"v":1,"msg_id":"…","type":"reply","to":"<device_id>","sent_at":"…","envelope":<kid = device_id>}`; plaintext `{"msg_id":"…","sent_at":"…","type":"reply","request_id":"…","title":"Slept through the night","body":"No movement alerts between 11 PM and 7 AM."}` |
| Phone fetches | the reply arrives in its normal message fetch (§4, §5), matched by `request_id`. It isn't pushed |

### 3.5 Removed phone (PROPOSED)

When a phone is unpaired on the coordinator's setup page, "the hub tells the relay, which rejects that phone's credential from then on" **[L1 When things fail]**.
- Relay: every call with a revoked credential returns `401 {"v":1,"error":{"code":"device_removed"}}`. An unknown or malformed credential returns `401 {"v":1,"error":{"code":"unauthorized"}}`, so the phone can tell "removed" from "something's wrong".
- LAN gateway: a request whose `kid` is a removed device returns `403 {"v":1,"error":{"code":"device_removed"}}`.
- Phone: on `device_removed` from either route, it shows the first-class state "This iPhone was removed from the home" (brief §5.1.4), stops all requests, and offers **Pair Again**, which wipes the Keychain items as Unpair does.

## 4. LAN gateway (bridge network side, port 7480 [L1])

Plain HTTP on the home network **[L1]**. The phone never sends its device credential here **[L1]**: each request body is an envelope encrypted with the phone's own key (`kid` = its device ID), so the hub knows who is asking and that the request is fresh.

| Method + path | Body | Response |
|---|---|---|
| `GET /v1/hello` | none | `200 {"v":1,"service":"debbie-bridge"}`, used only for reachability |
| `POST /v1/pair` | §4.2 | §4.2 |
| `POST /v1/lan/messages` | envelope, type `fetch`, plaintext `{msg_id, sent_at, after: "<cursor or null>", limit: 50}` | `200 {"v":1,"messages":[wrapper…],"next":"<cursor>","hub":{"online":true,"last_contact_at":"…"}}` |
| `POST /v1/lan/commands` | a wrapper (§3) holding one of the phone → hub types | `202 {"v":1,"accepted":true}`, or an error |
| `POST /v1/lan/heart-rate` | a wrapper with type `heart_rate` | `200 {"v":1,"accepted":<count>}` |

Bonjour **[L1 Discovery, layer-1 fa56475]**: the coordinator's bridge advertises its network side as `_debbie._tcp` on port 7480, with the first 8 characters of the hub's public key (base64url) in its TXT record, so phones can tell homes apart. PROPOSED: the TXT key is `hub` (for example `hub=Qm9vZ2xl`). The app's Info.plist lists `NSBonjourServices = [_debbie._tcp]`, and the app only uses a service whose `hub` value matches the first 8 characters of the `hub_pub` it stored at pairing.

### 4.1 Address choice and switching networks

1. On launch and on every network-path change, if the phone is on Wi-Fi, it tries `GET /v1/hello` on each stored LAN address (from the bundle, refreshed by Bonjour), with a 1.5 s timeout.
2. The first success becomes the LAN route. A caregiver phone falls back to the relay when every address fails, or when it isn't on Wi-Fi. Moving between Wi-Fi and cellular never needs re-pairing **[L1 When things fail]**.
3. A resident phone only has the LAN route: heart rate stays on the home network **[L1 What the relay can see]**.

### 4.2 Pairing exchange

`POST /v1/pair`, sent to the QR's `addrs` in order:

```json
{"v":1,"phone_pub":"<b64url 32>","name":"Caregiver's iPhone","role":"caregiver","proof":"<b64url 32>"}
```

| Response | Meaning |
|---|---|
| `202 {"v":1,"status":"awaiting_confirmation"}` | The proof is valid and the laptop is showing the 4-digit code. The phone shows its own code and resends the same request every 2 s (plus up to 0.5 s of jitter) until something else comes back **[L1: the same phone key may resend]** |
| `200 {"v":1,"status":"confirmed","bundle":<envelope kid "pair">}` | Confirmed at the laptop. The bundle is encrypted with `phone_key`, associated data `debbie/v1/pair` |
| `403 {"v":1,"error":{"code":"bad_proof"}}` | The proof doesn't verify (wrong or stale QR code) |
| `403 {"v":1,"error":{"code":"declined"}}` | The person at the laptop pressed Cancel |
| `409 {"v":1,"error":{"code":"in_progress"}}` | PROPOSED: another phone key already holds this QR code. The first phone with a valid proof wins until Cancel |
| `410 {"v":1,"error":{"code":"expired"}}` | The QR code has expired or was already used **[L1: single-use, 10 minutes]** |

Bundle plaintext (PROPOSED):

```json
{
  "v": 1, "msg_id": "…", "sent_at": "…",
  "home_id": "…", "device_id": "…", "role": "caregiver",
  "device_credential": "<b64url 32 bytes>",
  "relay_url": "https://<api-id>.execute-api.<region>.amazonaws.com",
  "home_key": "<b64url 32 bytes, caregivers only>",
  "home_name": "Home",
  "lan": {"addrs": ["192.168.1.20:7480"]}
}
```

The phone stores the result in its shared Keychain access group, readable after the first unlock **[L1 Pair a phone step 6]**. That covers `home_key`, `phone_key`, `device_credential`, the private key, and IDs and addresses.

---

## 5. Relay API (HTTPS, API Gateway HTTP API [L1])

Base URL: the bundle's `relay_url`. Every call carries the device credential **[L1]**:

```
X-Debbie-Device: <device_id>
Authorization: Bearer <device_credential>
```

The relay stores only `SHA-256(UTF-8 credential)` in lowercase hex (as with `token_sha256` [L1]), and compares in constant time.

| Method + path | Body | Response |
|---|---|---|
| `GET /v1/home` | none | `200 {"v":1,"home_id":"…","hub":{"online":true,"last_contact_at":"…"}}` |
| `GET /v1/messages?after=<cursor>&limit=50` | none | `200 {"v":1,"messages":[wrapper…],"next":"<cursor>"}`, kept 7 days **[L1]** |
| `POST /v1/commands` | wrapper (§3), phone → hub types except `heart_rate` | `202 {"v":1,"accepted":true}` |
| `POST /v1/push-tokens` | `{"v":1,"token":"<hex>","environment":"production" \| "sandbox","bundle_id":"<app bundle id>"}` | `204` |
| `POST /v1/live-view/sessions` | wrapper with type `live_view_request` | `202 {"v":1,"session_id":"…","state":"requested"}` **[L1: a session ID at once]** |
| `GET /v1/live-view/sessions/{id}` | none | §7 |
| `DELETE /v1/live-view/sessions/{id}` | none | `204`; the hub closes the sender **[L1]** |
| `POST /v1/unpair` | none | `204`. The relay rejects this credential from now on and forwards an `unpair` notice to the hub **[L1 When things fail]** |

Timeouts: the phone gives up on a relay call after 10 s and on a LAN call after 3 s, then shows the "can't reach home" state with the last contact time **[L1]**.

---

## 6. Add a laptop (PROPOSED; the Layer 1 doc gives the flow, not the bytes)

The new laptop's QR code:

```json
{"v":1,"kind":"join","join_id":"…","name":"Kitchen laptop","laptop_pub":"<b64url 32>","exp":1763140200}
```

The phone shows `name` and asks "Add Kitchen laptop to your home?". On **Add**, a caregiver phone sends a `laptop_approval` command: to `POST /v1/lan/commands` on home Wi-Fi, otherwise to the relay's `POST /v1/commands` **[L1 Add a laptop step 4]**. The plaintext includes `laptop_pub`, so the hub approves only the laptop that made the join request with that `join_id`. Resident phones can't approve.

---

## 7. Live view (PROPOSED shapes around [L1 Live view])

Session resource returned by `GET /v1/live-view/sessions/{id}`:

```json
{
  "v": 1, "session_id": "…", "state": "ready",
  "expires_at": "2026-11-14T15:17:03Z",
  "viewer": {
    "signaling_url": "wss://…kinesisvideo…/?X-Amz-ChannelARN=…&X-Amz-ClientId=…&X-Amz-Signature=…",
    "client_id": "<viewer_client_id>",
    "ice_servers": [
      {"urls": ["stun:stun.kinesisvideo.us-east-1.amazonaws.com:443"]},
      {"urls": ["turns:…:443?transport=tcp"], "username": "…", "credential": "…"}
    ]
  }
}
```

- Relay `state` values: `requested`, `denied` (with `reason: "live_view_off"`), `ready`, `ended` (with `reason: "stopped" | "expired" | "resident_turned_off"`) and `failed` (with `reason`). `viewer` is present only in `ready`.
- The phone polls every 1 s while `requested`. PROPOSED: it shows "Home didn't answer" if the state isn't `ready` or `denied` within 15 s.
- App-side states (all reachable and tested): `requesting → denied | ready → connecting → playing → ending → ended`, and `failed` from any state.
- Video only, receive-only, no audio **[L1]**. Sessions last up to 5 minutes **[L1]**. **Keep watching** starts a new session **[L1]**.
- KVS signalling messages, as a viewer over `signaling_url`: see `docs/research/11b-engineering-webrtc-testing-perf.md` and §7.1 (filled in after research).

---

## 8. Push (APNs via SNS [L1])

Alert push, built by the relay from the hub's `alert` wrapper:

```json
{
  "aps": {
    "alert": {"title": "Debbie", "body": "New alert from Debbie"},
    "mutable-content": 1,
    "interruption-level": "time-sensitive",
    "sound": "default",
    "thread-id": "alerts"
  },
  "debbie": {"v": 1, "home_id": "…", "w": <the §3 wrapper, unchanged>}
}
```

- **[L1]** Placeholder text plus `mutable-content: 1`, the time-sensitive interruption level, and the encrypted alert as a custom key. The Notification Service Extension decrypts it with the home key from the shared Keychain, then replaces the title and body. If decryption fails, or the 30-second budget runs out, the safe generic text stays: "New alert from Debbie. Open the app to see what happened."
- **[L1]** Updates use the alert's ID as `apns-collapse-id` (SNS: `AWS.SNS.MOBILE.APNS.COLLAPSE_ID`). PROPOSED APNs headers for alert pushes: `apns-push-type: alert`, `apns-priority: 10`.
- PROPOSED tiering (`docs/research/10-caregivers-older-adults-alerting.md` R2–R4; `11a-engineering-architecture.md` R12): the relay can't read severity, so **every** alert push arrives `time-sensitive`. After decrypting, the Notification Service Extension sets the real level from `severity`: `urgent` → `.timeSensitive`; `attention` → `.active`; `info` → `.passive`. It may only **lower** the level, never raise it. An `update: true` message is presented silently (`.passive`, no sound) **only if** the extension finds a delivered notification with the same identifier (`alert_id`); otherwise it is presented at its full tier. Reasoning: while a phone is offline, APNs may keep only the latest notification, so an update can be the first one the caregiver sees (`docs/research/13-platform-extras.md` R4, with `10-…` R4).
- PROPOSED: the extension sets `threadIdentifier` (`alerts` for urgent, `home-status` for the rest) and `categoryIdentifier` (`debbie.urgent`, `debbie.attention` or `debbie.info`). It never adds attachments, heart-rate numbers or images.
- **[L1]** The wrapper stays under about 2 KB, so the whole payload fits the 4 KB APNs limit. A longer alert carries only `{"v":1,"home_id":"…","msg_id":"…","truncated":true}`, and the app fetches the full message.
- Hub offline push, written by the relay itself **[L1]** (nothing private):
  ```json
  {"aps":{"alert":{"title":"Can't Reach Home","body":"Debbie can't reach home right now."},"mutable-content":1,"interruption-level":"active","thread-id":"home-status"},"debbie":{"v":1,"type":"hub_offline","last_contact":1763140320}}
  ```
  PROPOSED: `interruption-level` is `active`, not time-sensitive. A flaky home connection would otherwise teach caregivers to switch Time Sensitive off for Debbie, which also silences fall alerts (`10-…` R2). The extension rewrites the body as "Debbie hasn't heard from home since 3:12 PM", in the phone's time zone **[L1]**. PROPOSED: "hub offline" and "back online" share the collapse ID `hub-status-{home_id}`, so "back online" replaces "hub offline" instead of stacking. `back_online` uses `interruption-level: "passive"` with no sound (recovery needs no interruption; note 10 R4). A relay-written "monitoring degraded" notice isn't needed: the hub sends it encrypted as a `monitoring` message (§3), pushed as `time-sensitive` and lowered to `.active` by the extension.

### 8.1 Push environment (what the relay must match)

- Builds signed for TestFlight or the App Store use APNs **production**. Their entitlement is `aps-environment = production`, so the relay must send through the **`APNS`** SNS platform application **[L1]**.
- Builds run from Xcode with a development profile use APNs **sandbox** (`aps-environment = development`), so the relay must send through **`APNS_SANDBOX`** **[L1]**.
- **Not built yet** (the 14:50 audit found no token registration in the app): the app will report its environment with every token (`POST /v1/push-tokens`). In the Simulator it reports `sandbox`. Otherwise it reads `aps-environment` from its embedded provisioning profile (`development` → `sandbox`, `production` → `production`). TestFlight and App Store installs have no embedded profile, so they report `production`. A token sent to the wrong environment fails with `BadDeviceToken`, so the relay must keep each token's environment, create the SNS endpoint under the matching platform application, and never retry a `BadDeviceToken` (`docs/research/12-delivery-fastlane.md` R16).
- Sources: `docs/research/12-delivery-fastlane.md` (Apple's push-environment documentation [S24], [S27]).

---

## 9. What the app does with unknowns (PROPOSED)

| Situation | App behaviour |
|---|---|
| Heartbeat older than 2 intervals | Monitoring shows "Can't confirm" with the age of the last heartbeat. Never "All good" |
| Relay says `online: false` | "Can't reach home", with the last contact time from the relay |
| LAN and relay both unreachable | "Can't reach home", with the last contact this phone saw |
| Decryption fails | The message is dropped and counted. The Settings diagnostics show the count. Contents are never shown or logged |
| Unknown `type`, `kind` or `severity` | Ignored (`type`), or the generic presentation (`kind`), or treated as `warning` (`severity`) |

---

## 10. Test vectors

Generated by `DebbieCryptoTests` (CryptoKit) and checked independently by `tools/contracts/verify-vectors.mjs` (Node built-in `crypto` only). The values below are filled in during Phase 4, when the crypto module and its tests exist. The bridge team runs:

```sh
node tools/contracts/verify-vectors.mjs docs/contracts/vectors.json   # exit 0 = byte-for-byte compatible
```

File format (`docs/contracts/vectors.json`), all binary values base64url without padding:

```json
{
  "v": 1,
  "generated_by": "DebbieCryptoTests/VectorTests",
  "x25519":   [{"name": "…", "phone_private": "…", "hub_private": "…", "phone_public": "…", "hub_public": "…", "shared": "…"}],
  "pairing":  [{"name": "…", "secret": "…", "phone_public": "…", "role": "caregiver", "device_name": "…", "proof": "…", "shared": "…", "phone_key": "…", "code": "0427"}],
  "envelopes":[{"name": "…", "key": "…", "nonce": "…", "home_id": "…", "kid": "home", "type": "alert", "ad": "debbie/v1/…/home/alert", "plaintext": "<exact UTF-8 JSON string>", "envelope": {"v": 1, "kid": "home", "n": "…", "c": "…"}}],
  "credential_hash": [{"credential": "…", "sha256_hex": "…"}]
}
```

The set must cover: a caregiver and a resident pairing, a device name with non-ASCII characters (NFC), an `alert` and a `heartbeat` under the home key, a phone-key command (`ack`) with `kid` = device ID, and the pairing bundle (`kid` = `pair`). The Node verifier also checks that each envelope fails to open under a relabelled `type`.
