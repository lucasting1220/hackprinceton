# Phone ↔ hub contract

This is the contract between the Debbie iPhone app and the hub (the coordinator laptop's bridge), as Layer 1 builds it in steps 2 to 4. It is internal to Layer 1 (`CLAUDE.md` section 9), so it changes through `l1/` pull requests, never through the shared `contracts/` folder.

The Layer 1 doc's "Phone ↔ hub messages" wins over this file. This file fills in what the doc leaves to the iPhone track, from the app's `debbie-ios/docs/CONTRACTS.md`, and keeps that file's section numbers. Where the two differ, the bridge builds this file and the app's file is re-synced to it (see "Differences from the app's contract" at the end).

Sections 5 to 8 come with later steps: §6 (add a laptop) with step 3, §5 (the relay API) and §8 (push) with step 5, and §7 (live view) with step 7. A later section lists its own status codes, message types and unknowns in its own tables, and adds no row or column to a table here: the formatter re-pads a whole table when one cell grows wider than its column, rewriting every line of it. It appends its own bullets to "Differences from the app's contract".

## 1. Conventions

| Item           | Rule                                                                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Encoding       | JSON in UTF-8, with `snake_case` field names                                                                                                                                                                 |
| Versions       | The QR code, every HTTP body, wrapper and envelope, and the bundle carry `"v": 1`; a plaintext inside a wrapper has none. A receiver refuses a higher `v` with `unsupported_version`                         |
| Unknown fields | The receiver ignores them                                                                                                                                                                                    |
| Binary values  | base64url (RFC 4648 §5), sent without `=` padding. A receiver accepts padding, refuses any character outside the alphabet, and checks the decoded length this file gives                                     |
| Times          | ISO 8601 in UTC with `Z`. The hub writes whole seconds (`2026-11-14T15:10:00Z`) and accepts fractional seconds. Exception: the QR code's `exp` is whole Unix seconds, a JSON integer (open question Q1)      |
| IDs            | Strings with no meaning in their format. The hub makes `home_id`, `device_id` and its own `msg_id`s as lowercase UUIDs                                                                                       |
| Errors         | An answer other than 2xx carries `{"v":1,"error":{"code":"<snake_case>","message":"<fixed text>"}}`. The message never repeats the request and never holds a secret                                          |
| Secrets        | The hub's private key, a phone's private key, the shared secret, the home key, phone keys, device credentials, the QR secret and the 4-digit code never appear in logs, URLs, query strings or command lines |

## 2. Cryptography

The primitives are the Layer 1 doc's: X25519, HKDF-SHA256, HMAC-SHA256 and ChaCha20-Poly1305 (IETF: 12-byte nonce, 16-byte tag). The app uses CryptoKit and the bridge uses Node's built-in `crypto`. Nothing else.

### 2.1 Pairing QR code

The setup page on 127.0.0.1:7470 shows the code. It holds compact JSON (no spaces) with exactly five fields, drawn in byte mode at error correction level M with a 4-module border: `{"v":1,"addrs":["192.168.1.20:7480"],"hub_pub":"<base64url, 32 bytes>","secret":"<base64url, 16 bytes>","exp":1794669600}`.

- `addrs`: the laptop's IPv4 addresses that aren't internal, each as `"a.b.c.d:7480"`: private ranges (10/8, 172.16/12, 192.168/16) first, then link-local (169.254/16), at most 4. The app refuses plain HTTP to any other address, so the hub leaves them out; with none, the page shows no code. The phone tries them in order.
- `hub_pub`: the hub's X25519 public key, 32 raw bytes. `secret`: 16 random bytes. `exp`: whole Unix seconds as a JSON integer (the app refuses a fraction), 10 minutes after the code is shown. A code works for one phone (§4.2).
- There is no `kind` field; a laptop's join code has `"kind":"join"` (§6). The app refuses a payload over 1,024 bytes, an expired one, and one with a `v` above 1.

### 2.2 Pairing request and proof

The phone makes a new X25519 key pair for each pairing and sends `POST /v1/pair` (§4.2) with `{"v":1,"phone_pub":"<base64url, 32 bytes>","name":"Caregiver's iPhone","role":"caregiver","proof":"<base64url, 32 bytes>"}`.

`proof = HMAC-SHA256(key = secret, msg = phone_pub ‖ role ‖ 0x00 ‖ name)`, 32 bytes. `secret` and `phone_pub` are the raw bytes, `role` is the ASCII of `caregiver` or `resident`, `0x00` is one zero byte, and `name` is the UTF-8 of the name's NFC form.

After NFC normalization the name has 1 to 64 characters (extended grapheme clusters) and at most 1024 UTF-8 bytes. It has no control character (Unicode category Cc) and no bidirectional formatting character (U+061C, U+200E, U+200F, U+202A to U+202E, U+2066 to U+2069). The hub shows and keeps the NFC form.

### 2.3 Key agreement and derivation

```text
shared    = X25519(phone_private, hub_pub) = X25519(hub_private, phone_pub)        32 bytes
phone_key = HKDF-SHA256(ikm = shared, salt = secret, info = "debbie/v1/phone-key", L = 32)
code      = uint32_be(HKDF-SHA256(ikm = shared, salt = secret, info = "debbie/v1/code", L = 4)) mod 10000
```

- `info` strings are the ASCII bytes shown, with no terminator. The code is shown as 4 digits, zero-padded, on the setup page and on the phone. It is never sent.
- Both sides refuse an all-zero `shared`, which a low-order public key gives. The hub answers such a `phone_pub` with `400 bad_request`; Node's `diffieHellman` throws for one, and the bridge treats that the same way.
- Node imports a raw X25519 public key most reliably as a JWK, `{kty: "OKP", crv: "X25519", x}`.

### 2.4 Envelope

An envelope is `{"v":1,"kid":"home","n":"<base64url, 12 bytes>","c":"<base64url>"}`.

- `kid` names the key: `home` for the home key, a device ID for that phone's own key (the phone key), or `pair` for the bundle, which is sealed with the phone key.
- `n` is a fresh random 12-byte nonce for every message, never reused with a key. `c` is the ChaCha20-Poly1305 ciphertext followed by its 16-byte tag, so at least 16 bytes.
- The associated data is the ASCII string `debbie/v1/{home_id}/{kid}/{type}`, where `{type}` is the wrapper's `type` (§3), or `debbie/v1/pair` for the bundle. A message relabelled with another type, home or key fails to open.
- The home key is 32 random bytes, made at Create a home. Only caregiver phones get it.
- CryptoKit's combined sealed box is nonce ‖ ciphertext ‖ tag; split it to fill `n` and `c`. Node: `createCipheriv("chacha20-poly1305", key, n, {authTagLength: 16})`, `setAAD(ad, {plaintextLength})` and `c = update ‖ final ‖ getAuthTag()`. Opening calls `setAuthTag` before `final()`.

### 2.5 Freshness

Every plaintext, the bundle's too, carries `msg_id` and `sent_at`. A plaintext inside a wrapper also carries `type`. The hub refuses a phone's request whose plaintext `sent_at` is more than 30 seconds before or after its own clock (`stale`), and a `msg_id` that phone sent in the last 60 seconds (`duplicate`; up to 1,000 remembered per phone). Phones don't apply the 30-second rule to hub messages, which may wait in the outbox: they drop a `msg_id` they have seen, and keep the last 1,000.

## 3. Routing wrapper

Every encrypted message except the bundle travels inside a cleartext wrapper, so the relay can route it without reading it: `{"v":1,"msg_id":"<uuid>","type":"alert","collapse_id":"<alert_id>","sent_at":"2026-11-14T15:12:03Z","envelope":{…}}`.

- `msg_id` and `type` equal the plaintext's. A receiver that finds a difference drops the message. `type` is bound into the associated data (§2.4).
- `sent_at` is routing data only: the hub judges freshness by the plaintext's `sent_at`.
- `collapse_id` is the `alert_id`, on `alert` messages only (the push collapse ID, §8).
- `to` is the device ID on a hub message sealed with one phone's own key (`reply`), which goes only to that phone. Home-key messages have no `to`.

The hub and the relay check the shape before anything else: `v` is 1; `type` matches `^[a-z][a-z0-9_]{0,31}$`; `msg_id`, `kid` and `to` match `^[A-Za-z0-9._-]{1,64}$`; `sent_at` is ISO 8601 in UTC; `n` decodes to 12 bytes and `c` to at least 16; `collapse_id` is at most 64 bytes and only on `alert`. Unknown fields are dropped, never passed on.

### Message types

| `type`              | Direction                                     | `kid`     | Plaintext fields besides `msg_id`, `sent_at` and `type`      | Built in                 |
| ------------------- | --------------------------------------------- | --------- | ------------------------------------------------------------ | ------------------------ |
| `alert`             | hub → caregivers                              | `home`    | `alert_id, kind, severity, detected_at, title, body, update` | step 4                   |
| `heartbeat`         | hub → caregivers, through the relay only      | `home`    | none                                                         | step 5                   |
| `care_status`       | hub → caregivers                              | `home`    | `activity, heart_rate, sleep, steps, no_heart_data`          | the handoff              |
| `reply`             | hub → one phone (`to`)                        | device ID | `request_id, title, body`                                    | the handoff              |
| `fetch`             | phone → hub, LAN only                         | device ID | `after, limit` (§4.5)                                        | step 2, filled in step 4 |
| `unpair`            | phone → hub                                   | device ID | none                                                         | step 2                   |
| `request`           | caregiver phone → hub                         | device ID | `request_id, kind` (`ask` or `check_now`), `text`            | the handoff              |
| `laptop_approval`   | caregiver phone → hub                         | device ID | `join_id, laptop_pub, name, approve`                         | step 3 (§6)              |
| `live_view_setting` | resident phone → hub                          | device ID | `enabled`                                                    | later                    |
| `live_view_request` | caregiver phone → hub, through the relay only | device ID | `request_id, viewer_client_id`                               | step 7                   |
| `report`            | hub → caregivers                              | `home`    | `report_id, date, title, body`                               | the handoff              |
| `watch_data`        | resident phone → hub, LAN only                | device ID | `heart_rate, sleep, steps` (below)                           | the handoff              |

- `alert` carries Layer 4's fields (the doc's "Handoff to Layer 4"), and the hub passes them on unchanged, including Layer 4's `kind` and `severity` values, except `detected_at`, which it rewrites in UTC whole seconds with `Z` (§1). An alert with `update: true` replaces the alert with the same `alert_id`.
- `heartbeat` tells the relay the home is reachable, every minute (every 20 seconds for the demo). It carries no judgement about monitoring and never enters the outbox, so a LAN page never holds one.
- `care_status` is the live-status type, Layer 4's `POST /v1/status`, and is latest-only: the outbox keeps only the newest. `activity`, `heart_rate`, `sleep` and `steps` are each a JSON object or `null`, passed on as Layer 4 sends them, each with the time its reading was taken so the app can show its age; `no_heart_data` is true or false. The hub checks only that `heart_rate`, when present, has a whole-number `bpm`, because the app drops a status without one. The app reads `heart_rate` as `{bpm, at, trend}`, so Layer 4's live status should use those names inside `heart_rate`.
- `reply` is Layer 4's answer to a `request` (`POST /v1/replies`). The hub remembers which phone sent each `request_id` for an hour, in memory, and seals the reply with that phone's own key with `to` its device ID, so no other phone fetches it. A reply to a request the hub doesn't remember (it restarted, or the phone was removed) gets `400`. The app doesn't decode `reply` yet: it opens every fetched message with the home key, so it drops a reply until it opens `to` messages with its own key.
- `report` is the daily report (`POST /v1/reports`): `date` is the report's day, `YYYY-MM-DD`. The app doesn't decode `report` yet, and ignores it.
- `request` goes to Layer 2's coordinator as `POST /v1/requests` with `{request_id, device_id, kind, text}`. `request_id` is an ID (§3's rule); `text` is at most 1,000 characters, at least one that isn't a space for `ask`, and may be `""` for `check_now`.
- `watch_data` (heart rate, sleep and steps) goes from a phone in resident mode to the hub on the LAN only, and the relay never carries it. Its plaintext holds three lists, each possibly empty: `heart_rate: [{measured_at, bpm}]`, `sleep: [{night_of, asleep_minutes, bedtime_at, wake_at, interruptions}]` and `steps: [{measured_at, steps_today}]`, with times in UTC with `Z` (§1) between 1970-01-02T00:00:00Z and 2999-12-31T00:00:00Z, `night_of` a `YYYY-MM-DD` date in that range, `bpm` and `asleep_minutes` numbers of at least 0 (decimals allowed), and `interruptions` and `steps_today` whole numbers of at least 0. One row that breaks these makes the whole batch `400 bad_request`. The hub posts the rows on with only these fields, as `POST /v1/watch-data` with exactly the body of the repo's `contracts/watch-data.json` (rules in `contracts/README.md`): `schema_version: 1`, `type: "watch_data"` and `device_id` added, the `device_id` always the sending phone's from its envelope; a `device_id`, `type` or `schema_version` in the plaintext is ignored. The app today sends `heart_rate` with `{samples: [{t, bpm}]}` to `POST /v1/lan/heart-rate`, which gets `404`; it moves to `watch_data` on `/v1/lan/commands`.
- Gone for good: `ack` (coherence decision 17: alerts have no acknowledge or false-alarm action), the `monitoring` type, and the heartbeat's monitoring object ("monitoring degraded" is an ordinary Layer 4 alert, decision 15).

## 4. LAN gateway (port 7480)

The hub's network side listens on port 7480 (`BRIDGE_NETWORK_PORT`) on every IPv4 interface of the coordinator laptop, in plain HTTP on the home network. Workers' bridges never offer pairing. Nothing on this port can confirm or cancel a pairing, remove another phone, or post an alert: those happen only on 127.0.0.1:7470. A paired phone can remove only itself, with an `unpair` sealed with its own key (§4.4). After pairing, a phone never sends its device credential here. It proves who it is by sealing each request with its own key.

| Method and path         | Body                                    | Answer                                                       |
| ----------------------- | --------------------------------------- | ------------------------------------------------------------ |
| `GET /v1/hello`         | none                                    | `200 {"v":1,"service":"debbie-bridge","hub":"<tag>"}` (§4.1) |
| `POST /v1/pair`         | the pairing request (§2.2)              | §4.2                                                         |
| `POST /v1/lan/messages` | a wrapper of type `fetch`               | the page (§4.5)                                              |
| `POST /v1/lan/commands` | a wrapper holding a phone → hub command | `202 {"v":1,"accepted":true}`, or an error                   |

The HTTP rules come first, in this order. An unknown path gets `404 not_found` and a wrong method `405 method_not_allowed`. A POST body must be `application/json` (else `415 unsupported_media_type`), at most 16 KiB (else `413 too_large`) and valid JSON (else `400 bad_json`). Headers must arrive within 5 seconds and the whole request within 10, or the hub answers `408` with no body and closes the connection. Every other answer is JSON with `Cache-Control: no-store` and no CORS headers. Step 3 adds the routes that join laptops.

### 4.1 Hello and address choice

`GET /v1/hello` answers `200 {"v":1,"service":"debbie-bridge","hub":"<tag>"}`. The tag is the first 8 characters of `hub_pub` in base64url, so a phone can tell its own home's gateway from another. In this answer and in the Bonjour TXT record, `hub` is that tag; in a message page (§4.5) it is the hub's state object. The whole key is always `hub_pub`. A phone sends this request with a 1.5-second timeout before it uses the LAN route, and uses that route only when the tag matches the first 8 characters of its stored `hub_pub`.

A phone uses the first address in its bundle's `lan.addrs`. The doc's Bonjour record (`_debbie._tcp` on port 7480, TXT `hub=<tag>`) isn't built in steps 2 to 5, so until it is, a phone reaches the hub only at that address. A caregiver phone that can't reach it uses the relay (§5). A resident phone uses the LAN route, and the relay only for what §5 allows a resident, such as its `unpair` and `live_view_setting` commands.

### 4.2 Pairing exchange

The phone sends its request (§2.2) to the QR code's `addrs` in order. Until it gets an answer other than 202, it resends the same request every 2 seconds, plus up to 0.5 seconds of jitter. The hub checks, in this order:

1. The shape: a JSON object with `v` 1, `phone_pub` and `proof` of exactly 32 bytes each, `role` `caregiver` or `resident`, and a name as §2.2 says. Else `400 bad_request`, or `400 unsupported_version` for a `v` above 1. Unknown fields are ignored.
2. The code is in time: an unconfirmed code until its `exp`, a confirmed one for 60 seconds after Confirm, even past `exp`. Else, or when no code was shown, `410 expired`.
3. The proof matches, compared in constant time. Else `403 bad_proof`.
4. The code's state. "The same phone" means the same `phone_pub` bytes, NFC `name` and `role` as the phone that holds the code.

| The code's state         | The same phone                                                                      | Any other request                                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Shown, no phone holds it |                                                                                     | `202 {"v":1,"status":"awaiting_confirmation"}`, and this phone now holds the code. A low-order `phone_pub` gets `400 bad_request` instead |
| Waiting for Confirm      | `202 {"v":1,"status":"awaiting_confirmation"}`                                      | `409 in_progress`                                                                                                                         |
| Cancelled at the laptop  | `403 declined`                                                                      | `410 expired`                                                                                                                             |
| Confirmed                | `200 {"v":1,"status":"confirmed","bundle":<envelope>}`, the same envelope each time | `410 expired`: the code is used up                                                                                                        |

While a phone waits, the setup page shows its name, its role and the 4-digit code. Only the person at the laptop can press Confirm or Cancel.

### 4.3 Bundle

At Confirm the hub seals the bundle with the phone key (`kid` `pair`, associated data `debbie/v1/pair`, a fresh nonce) and serves the envelope in the 200 answer. The bundle is a JSON object with these fields. The app's decoder needs every one except `home_key`, and pairing fails without one (open question Q2).

| Field               | Value                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `v`                 | `1`                                                                                                                                                                       |
| `msg_id`, `sent_at` | A new lowercase UUID, and the time at Confirm (§1)                                                                                                                        |
| `home_id`           | The home's ID                                                                                                                                                             |
| `device_id`         | A new lowercase UUID for this phone                                                                                                                                       |
| `role`              | The request's `role`                                                                                                                                                      |
| `device_credential` | 32 random bytes in base64url. The phone shows this string only to the relay, over HTTPS (§5). The hub keeps only the SHA-256 of its UTF-8 bytes, in lowercase hex         |
| `relay_url`         | The relay's HTTPS address, or `""` until remote access is set up. A phone paired with `""` reaches home only on home Wi-Fi, and must pair again once remote access exists |
| `home_key`          | The home key in base64url, for caregivers only. A resident's bundle has no `home_key` field                                                                               |
| `home_name`         | `"Home"`, until the setup page asks for a name                                                                                                                            |
| `lan`               | `{"addrs": [...]}`: the QR code's addresses, starting with the one this phone's request arrived on, because the app uses the first                                        |

### 4.4 Requests from paired phones

`POST /v1/lan/messages` and `POST /v1/lan/commands` each take one wrapper (§3) whose envelope the phone sealed with its own key: `kid` is its device ID, and the associated data is `debbie/v1/{home_id}/{device_id}/{type}`. After the HTTP rules, the hub checks, in this order:

1. The wrapper's shape (§3), else `400 bad_request`, or `400 unsupported_version` for a `v` above 1.
2. `kid` is a phone this home paired. An unknown one gets `403 unknown_device`. One removed on the setup page, or by its own `unpair`, gets `403 device_removed`.
3. The envelope opens with that phone's key, else `400 bad_envelope`.
4. The plaintext is a JSON object whose `type` and `msg_id` equal the wrapper's and whose `sent_at` is an ISO 8601 time in UTC, else `400 bad_envelope`.
5. Its `sent_at` is within 30 seconds of the hub's clock, either way, else `400 stale`.
6. Its `msg_id` hasn't come from this phone in the last 60 seconds, else `409 duplicate`.
7. Then the type, by path:
   - `fetch` on `/v1/lan/messages` gets the page (§4.5).
   - `unpair` on `/v1/lan/commands`: the hub marks the phone removed and answers `202 {"v":1,"accepted":true}`.
   - `request` from a caregiver phone and `watch_data` from a resident phone, on `/v1/lan/commands`, go to Layer 2's coordinator on `127.0.0.1` at `coordinator.json`'s `client_port`, with a 2-second time limit. The hub answers `202 {"v":1,"accepted":true}` once the coordinator answers 202, `503 no_job` when it answers 503 (no job takes that kind now), and `503 coordinator_down` when it can't be reached in time or answers anything else. The other role's type gets `400 unsupported_type`, and a malformed plaintext `400 bad_request`.
   - `laptop_approval` on `/v1/lan/commands` goes to Add a laptop (§6.5).
   - `live_view_setting` on `/v1/lan/commands` gets `501 not_supported` until the step that builds it.
   - Anything else gets `400 unsupported_type`: `ack`, an unknown type, `fetch` on `/v1/lan/commands`, a command on `/v1/lan/messages`, or a type that travels only through the relay.

Checks 2 to 7 also run for commands that reach the hub through the relay (§5), with check 7 as for `/v1/lan/commands` and one memory of message IDs per phone, so the hub answers a command the same way on either route and a request can't be replayed by switching routes.

### 4.5 Fetch page

The `fetch` plaintext carries `after`, a cursor string or `null`, and `limit`, a whole number of at least 1. A `limit` above 50 counts as 50. Anything else gets `400 bad_request`. The answer is `200 {"v":1,"messages":[…],"next":"l.<epoch>.<seq>","hub":{"online":true,"last_contact_at":"2026-11-14T15:12:05Z"}}`.

- `messages` holds the outbox's wrappers (§3) for this phone that come after `after`, oldest first, at most `limit`. A caregiver phone gets the home-key wrappers and those whose `to` is its device ID. A resident phone holds no home key, so it gets only those whose `to` is its device ID. The hub keeps a message for at most 7 days.
- A cursor is `l.<epoch>.<seq>`, opaque to phones. `l.` marks the LAN route, `<epoch>` names one outbox, and `<seq>` numbers a message in it; a seq never repeats.
- An `after` that is `null`, lacks `l.` (such as the relay's `r.` cursors), names another epoch or can't be read starts at the oldest kept message. It is never refused, because the app keeps one cursor for both routes.
- `next` is the cursor of the last message the hub examined for this page, whether it returned it or skipped it as not for this phone. With none examined, it is the cursor given, or this outbox's newest cursor when the given one wasn't this outbox's.
- `hub` is the hub's own state. On the LAN it is always online, with `last_contact_at` set to now.
- While the outbox has never held a message, every page is empty with `next` `null`. A phone keeps its cursor when `next` is `null`.

### 4.6 Statuses and error codes

On `/v1/lan/messages` and `/v1/lan/commands`, 403 means only that the phone is unknown or removed, because the app reads any 403 there as "This iPhone was removed from the home". A repeat is 409, a type that a later step adds is 501, a request the coordinator didn't take is 503, and any other fault the hub finds in a request that passed the HTTP rules (§4) is 400. Every error carries the §1 error body except 408.

| Status | Code                     | Where              | Meaning                                                                                                   |
| ------ | ------------------------ | ------------------ | --------------------------------------------------------------------------------------------------------- |
| 400    | `bad_json`               | any POST           | The body isn't valid JSON                                                                                 |
| 400    | `bad_request`            | any POST           | A missing or malformed field, a bad name, a low-order key, or a bad `after` or `limit`                    |
| 400    | `unsupported_version`    | any POST           | `v` is above 1                                                                                            |
| 400    | `bad_envelope`           | LAN requests       | The envelope doesn't open with the phone's key, or the plaintext's `type`, `msg_id` or `sent_at` is wrong |
| 400    | `stale`                  | LAN requests       | `sent_at` is more than 30 seconds from the hub's clock                                                    |
| 400    | `unsupported_type`       | LAN requests       | A type this path never takes                                                                              |
| 403    | `bad_proof`              | `/v1/pair`         | The proof doesn't match the code                                                                          |
| 403    | `declined`               | `/v1/pair`         | The person at the laptop pressed Cancel                                                                   |
| 403    | `unknown_device`         | LAN requests       | `kid` isn't a phone this home paired                                                                      |
| 403    | `device_removed`         | LAN requests       | The phone was removed on the setup page, or unpaired itself                                               |
| 404    | `not_found`              | any                | No such path                                                                                              |
| 405    | `method_not_allowed`     | any                | The path exists, but not for this method                                                                  |
| 408    | none                     | any                | The headers took over 5 seconds or the request over 10; no body                                           |
| 409    | `in_progress`            | `/v1/pair`         | Another phone holds this code                                                                             |
| 409    | `duplicate`              | LAN requests       | This phone sent this `msg_id` in the last 60 seconds                                                      |
| 410    | `expired`                | `/v1/pair`         | No code was shown, it ran out of time, or it was cancelled or confirmed for another phone                 |
| 413    | `too_large`              | any POST           | The body is over 16 KiB                                                                                   |
| 415    | `unsupported_media_type` | any POST           | The body isn't `application/json`                                                                         |
| 500    | `internal`               | any                | Something unexpected. The hub logs the error's class, never the request                                   |
| 501    | `not_supported`          | `/v1/lan/commands` | `live_view_setting`, before the step that builds it                                                       |
| 503    | `no_job`                 | `/v1/lan/commands` | The coordinator has no job that takes this `request` or `watch_data` now; try again later                 |
| 503    | `coordinator_down`       | `/v1/lan/commands` | The coordinator didn't answer within 2 seconds, or answered something else; try again later               |

## 5. Relay API

The relay is a server the team runs on Vultr, at the bundle's `relay_url` (`https://relay.<domain>`), not AWS. Caddy terminates TLS and passes requests to the relay on the server's 127.0.0.1. The relay stores and passes on wrappers (§3) unopened: it never holds the home key or a phone key, and it keeps only SHA-256 hashes of device and hub credentials. Pushes go straight to APNs (§8), and live view uses the relay's own signaling and the team's TURN server (§7, step 7).

The hub connects to the relay over a WebSocket at `/v1/hub`, signing in with its hub credential. Phones never use that path, and its frames are Layer 1's own (`layer1/contracts/hub-relay-messages.json`). The relay learns the home's phones from the hub's full phone list, sent on every connection and after every pairing or removal; a phone the hub removed is never let back in.

### 5.1 Sign-in and HTTP rules

Every call except `GET /healthz` carries two headers: `X-Debbie-Device: <device_id>` and `Authorization: Bearer <device_credential>`. The relay hashes the credential as the hub does (SHA-256 of its UTF-8 bytes, in lowercase hex, §4.3) and compares the digests in constant time.

- A missing header, an unknown device or a wrong credential gets `401 unauthorized`. A device the hub removed, or that unpaired itself, gets `401 device_removed`, but only when its credential is right.
- After 20 failed sign-ins from one address within a minute, that address gets `429 too_many_attempts` for a minute on every call but `GET /healthz`, whatever it sends.
- An unknown path gets `404 not_found` and a wrong method `405 method_not_allowed`. A POST body must be `application/json` (else `415 unsupported_media_type`), at most 64 KiB (else `413 too_large`) and valid JSON (else `400 bad_json`). Headers must arrive within 10 seconds and the whole request within 15.
- Every answer is JSON with `Cache-Control: no-store`, and every error carries the §1 error body.

### 5.2 Calls

| Method and path                                  | Who may call                               | Answer                                                  |
| ------------------------------------------------ | ------------------------------------------ | ------------------------------------------------------- |
| `GET /healthz`                                   | anyone, with no sign-in                    | `200 {"v":1,"ok":true}`                                 |
| `GET /v1/home`                                   | every phone                                | `200 {"v":1,"home_id":"…","hub":{…},"push":{…}}` (§5.4) |
| `GET /v1/messages?after=<cursor>&limit=<number>` | every phone                                | the page (§5.3)                                         |
| `POST /v1/commands`                              | caregivers; residents for two types (§5.5) | `202 {"v":1,"accepted":true}`, or an error (§5.5)       |
| `POST /v1/push-tokens`                           | caregivers                                 | `204` (§5.6)                                            |
| `POST /v1/unpair`                                | every phone                                | `204` (§5.7)                                            |

A resident phone's route is the home network (§4.1). At the relay it may read its home and its own messages, unpair, and send the two commands §5.5 names; anything else gets `403 forbidden`. The live-view session calls are §7's, with step 7.

### 5.3 Message page

`GET /v1/messages` answers `200 {"v":1,"messages":[…],"next":"r.<seq>","hub":{"online":true,"last_contact_at":"2026-11-14T15:12:05Z"}}`, with `hub` as in §5.4, so a page tells the app whether home is reachable just as a LAN page does (§4.5).

- `limit` is a whole number of at least 1, 50 when absent. A `limit` above 50 counts as 50. Anything else gets `400 bad_request`.
- `messages` holds the wrappers the hub delivered, exactly as §3 shapes them, oldest first, at most `limit`. A caregiver phone gets the home-key wrappers and those whose `to` is its device ID. A resident phone gets only those whose `to` is its device ID. The relay keeps a message for 7 days.
- A cursor is `r.<seq>`, opaque to phones. `r.` marks the relay's route, and `<seq>` never repeats.
- An `after` that is absent, lacks `r.` (such as the LAN's `l.` cursors), can't be read or is past any cursor the relay has issued starts at the oldest kept message. It is never refused, because the app keeps one cursor for both routes and drops repeats by `msg_id`.
- `next` is the cursor of the last message returned. With none returned, it is the cursor given when that is the relay's, else the home's newest cursor, or `null` when the relay holds no message for the home. A phone keeps its cursor when `next` is `null`.
- For `heartbeat` and `care_status`, the relay keeps only the newest message of each type per home. A `msg_id` the hub delivers twice is kept once.

### 5.4 Home state

`GET /v1/home` answers `200 {"v":1,"home_id":"…","hub":{"online":false,"last_contact_at":"2026-11-14T15:12:05Z"},"push":{"state":"ok","since":"2026-11-14T15:10:00Z"}}`.

- `hub.online` is true only while the hub's connection to the relay is open, so a reconnect can show a few seconds of "can't reach home" but never an all-clear the relay can't confirm. `last_contact_at` is the last time the relay heard from the hub, or `null` if it never has.
- `push` describes pushes in the caller's APNs environment: that of the push token it registered most recently, or `production` when it has none. `state` is `not_configured` when the relay has no APNs key for that environment, `failing` when Apple's latest answer for that environment was a refusal, and `ok` otherwise. `since` is the time of the latest push Apple accepted (`ok`) or refused (`failing`), or `null`. The app tells the caregiver that notifications aren't working when `state` isn't `ok`, because alerts then reach the phone only when the app is opened.

### 5.5 Commands

`POST /v1/commands` takes one wrapper (§3) whose envelope the phone sealed with its own key, as `POST /v1/lan/commands` does. The relay checks the shape (§3) and its own rules, forwards the wrapper unopened to the hub, and waits up to 5 seconds for the hub's answer. It answers `202 {"v":1,"accepted":true}` when the hub accepted the command.

The relay's own refusals:

- `envelope.kid` isn't the caller's `X-Debbie-Device`: `403 forbidden`.
- `heart_rate` and `fetch`, which travel on the LAN only: `400 lan_only`. Watch readings never reach the relay.
- A resident sending anything but `live_view_setting` and `unpair`, which includes `laptop_approval`: `403 forbidden`.
- Any type but `request`, `laptop_approval`, `live_view_setting` and `unpair`: `400 unsupported_type`.
- The hub isn't connected: `503 hub_offline`. Commands are never queued for an offline hub.
- The hub doesn't answer within 5 seconds: `504 hub_timeout`.

Any other answer is the hub's, passed through with its status and code unchanged, so a command gets the same answer on either route: §4.4's checks 2 to 7, such as `400 stale`, `400 bad_envelope`, `409 duplicate` and `501 not_supported`, and step 3's approval refusals. The one exception is the hub's `403`, which becomes the relay's `401`: `device_removed`, after which the relay also refuses that device, or `unauthorized` for the hub's `unknown_device`.

### 5.6 Push tokens

`POST /v1/push-tokens` takes `{"v":1,"token":"<hex>","environment":"production","bundle_id":"<the app's bundle ID>"}` and answers `204`.

- `token` is the APNs device token in hex, 64 to 200 characters; the relay keeps it in lower case. `environment` is `production` or `sandbox`, the APNs environment of the app's build. A bad or missing field gets `400 bad_request`, and a `v` above 1 `400 unsupported_version`.
- `bundle_id` must equal the app ID the relay pushes to, else `400 wrong_app`.
- A phone has at most one token per environment, and a token belongs to the phone that registered it last. Resident phones get no alert pushes, so they get `403 forbidden`.
- The relay never logs a push token.

### 5.7 Unpair

`POST /v1/unpair` takes no body (any body is ignored) and answers `204`. The relay refuses the device from then on with `401 device_removed`, deletes its push tokens and, when the hub is connected, tells the hub, which marks the phone removed as for its `unpair` command (§4.4).

### 5.8 Statuses and error codes

The relay's codes follow §4.6's rules, except that 401 means the device can't sign in, and 403 that a signed-in device may not do what it asked.

| Status | Code                     | Where                   | Meaning                                                                              |
| ------ | ------------------------ | ----------------------- | ------------------------------------------------------------------------------------ |
| 400    | `bad_json`               | any POST                | The body isn't valid JSON                                                            |
| 400    | `bad_request`            | any call                | A missing or malformed field, a bad wrapper, or a bad `limit`                        |
| 400    | `unsupported_version`    | any POST                | `v` is above 1                                                                       |
| 400    | `wrong_app`              | `/v1/push-tokens`       | `bundle_id` isn't the app the relay pushes to                                        |
| 400    | `lan_only`               | `/v1/commands`          | `heart_rate` or `fetch`, which travel on the LAN only                                |
| 400    | `unsupported_type`       | `/v1/commands`          | A type the relay never forwards                                                      |
| 401    | `unauthorized`           | any call but `/healthz` | A missing header, an unknown device or a wrong credential                            |
| 401    | `device_removed`         | any call but `/healthz` | The phone was removed or unpaired itself; sent only with its own credential          |
| 403    | `forbidden`              | any call but `/healthz` | A resident's call that §5.2 doesn't allow, or a command whose `kid` isn't the caller |
| 404    | `not_found`              | any                     | No such path                                                                         |
| 405    | `method_not_allowed`     | any                     | The path exists, but not for this method                                             |
| 413    | `too_large`              | any POST                | The body is over 64 KiB                                                              |
| 415    | `unsupported_media_type` | any POST                | The body isn't `application/json`                                                    |
| 429    | `too_many_attempts`      | any call but `/healthz` | 20 failed sign-ins from this address in a minute; try again after a minute           |
| 500    | `internal`               | any                     | Something unexpected. The relay logs the error's class, never the request            |
| 503    | `hub_offline`            | `/v1/commands`          | The hub isn't connected to the relay                                                 |
| 504    | `hub_timeout`            | `/v1/commands`          | The hub didn't answer within 5 seconds                                               |

`/v1/commands` also passes on the hub's own answers (§5.5).

## 6. Add a laptop

A new laptop joins the home through the hub's network side (§4), and a caregiver's phone approves it. Only the hub and the new laptop's bridge speak §6.2, §6.3 and §6.6; the app reads the join QR code (§6.1) and sends `laptop_approval` (§6.5). Workers' bridges never offer pairing or Pair a phone. The new laptop finds the hub by the address the person types from the home laptop's page (`a.b.c.d`, `a.b.c.d:port`, a host name or an IPv6 address; port 7480 by default): there is no discovery yet.

### 6.1 Join QR code

The new laptop's setup page shows a code holding compact JSON with exactly seven fields, drawn as in §2.1 (byte mode, level M, 4-module border): `{"v":1,"kind":"join","join_id":"<uuid>","name":"Kitchen laptop","laptop_pub":"<base64url, 32 bytes>","exp":1794669600,"hub_pub":"<base64url, 32 bytes>"}`.

- `join_id`, `exp` and `hub_pub` are the hub's answer to the join request (§6.2). `exp` is whole Unix seconds as a JSON integer, 10 minutes after the request, as in §2.1.
- `name` is the laptop's name in NFC, under §2.2's rules. `laptop_pub` is the X25519 public key the laptop made for this join; it keeps the private key in memory only.
- `hub_pub` is the hub's whole public key, as the pairing QR code carries it. The app compares it with the `hub_pub` it stored at pairing and refuses a code from another home. `hub` stays the 8-character tag of §4.1.
- Both setup pages show the home code, the first 8 characters of `hub_pub`, so the person can check that the new laptop reached the right home.

### 6.2 Join request

The new laptop's bridge sends `POST /v1/join` with `{"v":1,"name":"Kitchen laptop","laptop_pub":"<base64url, 32 bytes>"}`. The hub checks the name (§2.2) and the key (32 bytes, not a low-order point), else `400 bad_request`. It keeps at most 8 joins waiting for approval, else `429 too_many_joins`, and answers `202 {"v":1,"join_id":"<uuid>","exp":1794669600,"hub_pub":"<base64url, 32 bytes>"}`. Waiting joins live in the hub's memory only, so a restarted hub answers `unknown_join` and the laptop shows a new code.

### 6.3 Join status

The new laptop's bridge asks every 2 seconds with `POST /v1/join/status` and `{"v":1,"join_id":"<uuid>"}`:

| Answer                                                | When                                                           |
| ----------------------------------------------------- | -------------------------------------------------------------- |
| `202 {"v":1,"status":"waiting","exp":1794669600}`     | No caregiver has answered yet                                  |
| `200 {"v":1,"status":"approved","ticket":<envelope>}` | A caregiver approved; the ticket (§6.4) is kept for 10 minutes |
| `409 declined`                                        | A caregiver declined                                           |
| `410 expired`                                         | The code ran out before anyone approved it                     |
| `404 unknown_join`                                    | The hub doesn't know the join, for example after it restarted  |

### 6.4 Join ticket

On approval the hub makes a node ID (a UUID) and a join token (32 random bytes as 64 lowercase hex characters, `contracts/README.md`), adds `{node_id, display_name, token_sha256}` to `accepted-workers.json`, and only once that file is written seals the ticket to the laptop's key:

```text
shared     = X25519(hub_private, laptop_pub) = X25519(laptop_private, hub_pub)        32 bytes, never all zero
laptop_key = HKDF-SHA256(ikm = shared, salt = UTF-8 join_id, info = "debbie/v1/laptop-key" ‖ hub_pub ‖ laptop_pub, L = 32)
```

- `hub_pub` and `laptop_pub` in `info` are the raw 32 bytes each. Binding both keys means the ticket opens under no other pair of keys.
- The ticket is a §2.4 envelope with `kid` `join` and the associated data `debbie/v1/join` (the laptop doesn't know `home_id` yet), sealed with `laptop_key` and a fresh nonce.
- Its plaintext is `{"v":1,"msg_id":"<uuid>","sent_at":"2026-11-14T15:12:03Z","type":"join_ticket","home_id":"<uuid>","node_id":"<uuid>","display_name":"Kitchen laptop","join_token":"<64 hex>","coordinator_port":7443}`. `coordinator_port` is `coordinator.json`'s `listen_port`; the laptop writes `coordinator_url` as `ws://<the address it reached the hub at>:<coordinator_port>/ws`.
- The token appears only in the ticket's plaintext and in the laptop's token file, never in a log, a URL, a page or a command line. The hub keeps only its hash.

### 6.5 Approval

The app sends `laptop_approval` to `POST /v1/lan/commands` (or through the relay, §5) as a §3 wrapper sealed with the phone's own key. Its plaintext is `{"msg_id":"<uuid>","sent_at":"2026-11-14T15:12:03Z","type":"laptop_approval","join_id":"<uuid>","laptop_pub":"<base64url, 32 bytes>","name":"Kitchen laptop","approve":true}`, copied from the join QR code. After §4.4's checks 1 to 6, the hub checks, in this order:

1. The phone is a caregiver's, else `400 forbidden`.
2. `join_id` is a string, `approve` a boolean, `name` a valid name (§2.2) and `laptop_pub` 32 bytes, else `400 bad_request`.
3. The hub has a join with that `join_id`, else `400 unknown_join`.
4. Its `laptop_pub` and its NFC name equal the plaintext's, else `400 join_mismatch`.
5. An approved join answers `202` again and mints nothing. Two approvals at once mint one token.
6. The code hasn't expired and wasn't declined, else `400 expired`.
7. `approve: false` declines the join (`202`). `approve: true` mints and seals the ticket (§6.4) and answers `202 {"v":1,"accepted":true}`. If `accepted-workers.json` can't be written, or already breaks Layer 2's rules, the join stays waiting, no ticket exists, and the answer is `500 internal`; the home laptop's page names the file.

403 is never an approval's answer: on the LAN it means only an unknown or removed phone (§4.6), and a repeat is `409 duplicate` from check 6.

### 6.6 Bridge link

A joined laptop's bridge sends `POST /v1/link` to the hub every 5 seconds with a §3 wrapper of type `link_report`, sealed with the link key under `kid` = its node ID and the associated data `debbie/v1/{home_id}/{node_id}/link_report`:

```text
link_key = HKDF-SHA256(ikm = SHA-256(join_token) as 32 raw bytes, salt = UTF-8 node_id, info = "debbie/v1/link-key", L = 32)
```

- The hub derives the key from the node's `token_sha256` in `accepted-workers.json`, so it treats that hash as a secret: never logged and never shown. A node not in that file gets `403 unknown_node`, and the laptop's page says it is no longer part of the home.
- The report's plaintext is `{"msg_id","sent_at","type":"link_report","state":"connected","missing":[{"id","reason","required"}]}`: the laptop's setup state (lowercase letters and `_`, at most 32) and what it is missing, as `contracts/check-output.json` lists it.
- The hub checks the wrapper's shape (`400 bad_request`), the type (`400 unsupported_type`), the node, the envelope and the plaintext's `type`, `msg_id` and `sent_at` (`400 bad_envelope`), the 30-second clock rule (`400 stale`), a repeated `msg_id` (`409 duplicate`, in the same memory as phones' IDs) and the report's fields (`400 bad_request`).
- It answers `200` with a `link_reply` wrapper sealed the same way (associated data `.../link_reply`), whose plaintext is `{"msg_id","sent_at","type":"link_reply","in_reply_to":"<the report's msg_id>","commands":[]}`. `commands` stays empty until step 7 carries live view over it; the hub may then hold the request open.

### 6.7 Statuses and error codes

| Status | Code             | Where                         | Meaning                                                             |
| ------ | ---------------- | ----------------------------- | ------------------------------------------------------------------- |
| 202    | none             | `/v1/join`, `laptop_approval` | The join is waiting; the approval or decline was taken              |
| 400    | `forbidden`      | `laptop_approval`             | A resident's phone approved                                         |
| 400    | `unknown_join`   | `laptop_approval`             | The hub has no such join                                            |
| 400    | `expired`        | `laptop_approval`             | The code ran out, or the join was declined                          |
| 400    | `join_mismatch`  | `laptop_approval`             | The key or name differs from the join's                             |
| 403    | `unknown_node`   | `/v1/link`                    | The node isn't in `accepted-workers.json`                           |
| 404    | `unknown_join`   | `/v1/join/status`             | The hub has no such join                                            |
| 409    | `declined`       | `/v1/join/status`             | A caregiver declined                                                |
| 410    | `expired`        | `/v1/join/status`             | The code ran out                                                    |
| 429    | `too_many_joins` | `/v1/join`                    | 8 joins are already waiting                                         |
| 500    | `internal`       | `laptop_approval`             | `accepted-workers.json` couldn't be written; the join stays waiting |

| `type`        | Direction           | `kid`   | Plaintext fields besides `msg_id`, `sent_at` and `type`           |
| ------------- | ------------------- | ------- | ----------------------------------------------------------------- |
| `join_ticket` | hub → new laptop    | `join`  | `v, home_id, node_id, display_name, join_token, coordinator_port` |
| `link_report` | worker laptop → hub | node ID | `state, missing`                                                  |
| `link_reply`  | hub → worker laptop | node ID | `in_reply_to, commands`                                           |

## 8. Push

The relay sends pushes straight to APNs over HTTP/2, each through its token's environment: `production` (TestFlight and App Store builds) or `sandbox` (builds run from Xcode). A token Apple refuses as `Unregistered`, `BadDeviceToken` or `DeviceTokenNotForTopic` is deleted and never retried, until the app registers again. Every push carries `apns-topic`, the app's bundle ID.

### 8.1 Alert

When the relay stores a new `alert` wrapper (not a repeat), it pushes it to every caregiver phone of the home that has a push token: `{"aps":{"alert":{"title":"Debbie","body":"New alert from Debbie"},"mutable-content":1,"interruption-level":"time-sensitive","sound":"default","thread-id":"alerts"},"debbie":{"v":1,"home_id":"…","w":<the §3 wrapper, unchanged>}}`.

- Headers: `apns-push-type: alert`, `apns-priority: 10`, `apns-expiration` 24 hours ahead, and `apns-collapse-id` set to the wrapper's `collapse_id`, the `alert_id`, so an update replaces the first notification.
- The notification extension opens `w` with the home key, checks its `msg_id` and `type` against the plaintext's (§3), and replaces the placeholder title and body. If it can't, the placeholder stays.
- A payload over 4,096 bytes carries only `"debbie":{"v":1,"home_id":"…","msg_id":"…","truncated":true}`, and the app fetches the message when opened (§5.3).
- The relay acknowledges the message to the hub before it pushes, so a slow APNs never holds up the hub. An alert the relay stored in the last 10 minutes but never pushed, because it restarted in between, is pushed when it starts.
- When Apple keeps failing, the alert is still kept and fetchable, and `GET /v1/home` reports the failure (§5.4).

### 8.2 Hub offline and back online

The relay writes these two pushes itself, with nothing private in them. Both carry `apns-collapse-id: hub-status-<home_id>`, so "back online" replaces "hub offline", and expire after an hour.

- **Hub offline.** When the relay hasn't heard from a hub that was connected for the configured limit (the doc's 180 seconds; 60 for the demo), it pushes once to the home's caregiver phones: title "Can't Reach Home", `"interruption-level":"active"`, `"thread-id":"home-status"`, `"mutable-content":1`, and `"debbie":{"v":1,"type":"hub_offline","last_contact":1794669525,"last_contact_at":"2026-11-14T15:18:45Z"}`. `last_contact` is the same time in whole Unix seconds, which the app's built extension reads, and stays until the app reads `last_contact_at`.
- **Back online.** The next contact from that hub pushes title "Home Is Back Online", `"interruption-level":"passive"`, no sound, `apns-priority: 5`, and `"debbie":{"v":1,"type":"back_online","last_contact":…,"last_contact_at":"…"}`. It goes out before the alerts the hub queued meanwhile arrive.
- The relay keeps this state in its database, so a restart neither repeats nor loses either push. A home whose hub has never connected is not watched.
- The exact payloads of §8.1 and §8.2, built from `vectors.json`, are `layer1/contracts/push-alert.json`, `push-hub-offline.json` and `push-back-online.json`, which come with the relay's push code.

## 9. What each side does with unknowns

| Situation                             | Hub                                                                         | App                                                                                                                                       |
| ------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| An unknown field                      | Ignores it, and drops it from a wrapper it passes on                        | Ignores it                                                                                                                                |
| A `v` above 1                         | `400 unsupported_version`                                                   | Refuses a QR code that has one                                                                                                            |
| An unknown `type`                     | `400 unsupported_type`, or `501 not_supported` for a type a later step adds | Ignores the message                                                                                                                       |
| An unknown alert `kind` or `severity` | Passes it on unchanged                                                      | Shows the generic alert for a `kind`, and treats a `severity` as `urgent`, because a missed emergency costs most                          |
| A message that doesn't open           | `400 bad_envelope`                                                          | Drops it, and never shows or logs its contents                                                                                            |
| A repeated `msg_id`                   | `409 duplicate`                                                             | Drops it                                                                                                                                  |
| A cursor it didn't make               | Starts at the oldest kept message (§4.5)                                    |                                                                                                                                           |
| An error it can't place               |                                                                             | While pairing, any code but `expired`, `in_progress` and `declined` shows "Can't find the home laptop". On the LAN, any 403 means removed |
| No answer from the hub or the relay   |                                                                             | Shows "can't reach home" with the last contact time, never an all-clear it can't confirm                                                  |

## 10. Test vectors

`layer1/contracts/vectors.json` is a byte-identical copy of the app's `docs/contracts/vectors.json`, which the app's CryptoKit tests generate. Never edit the copy: when the app's file changes, copy it again. Its binary values are base64url without padding.

It holds one X25519 pair; a caregiver pairing and a resident pairing whose name has non-ASCII characters; four envelopes, `alert-home-key`, `heartbeat-home-key`, `ack-phone-key` (`kid` a device ID) and `pairing-bundle` (`kid` `pair`); and one credential hash. The bridge's tests recompute every value with Node's built-in `crypto`, as the app's `tools/contracts/verify-vectors.mjs` does: the shared secret from both sides; each proof (from the NFC form of the name), phone key and code; each envelope's associated data, its `c` from its key and nonce, and its plaintext; that a relabelled type, or for `pair` a flipped byte, fails to open; and the credential hash.

`ack-phone-key` stays as a phone-key test, though the hub no longer takes `ack` (§3). `pairing-bundle` holds 6 of the bundle's 11 fields, so a separate bridge test checks the bundle's fields against §4.3.

## Open questions

**Q1 (Lucas).** `CLAUDE.md` section 9 says every message has a `type`, every file a `schema_version`, and times are ISO 8601 in fields ending `_at`. This format, which the app already speaks, uses `v`, a pairing request with no `type`, and the QR code's Unix-time `exp`. Section 9 defines a contract as anything two layers both depend on, and this one is internal to Layer 1, so the recommendation is that those rules don't apply here. Until Lucas answers, the build follows this file and keeps `v` and `exp`.

**Q2 (answered Nov 14).** The Layer 1 owner agreed that the bridge sends the whole bundle in §4.3, including `v`, `msg_id`, `sent_at`, `role`, `home_name` and `lan.addrs`, which the app's decoder needs. The doc's "Pair a phone" step 4 now lists them.

**Q3 (Layer 1 owner).** The doc's "Phone ↔ hub messages" says `addrs` lists every IPv4 address of the bridge's network side, as the app's CONTRACTS.md §2.1 does. The app refuses plain HTTP to any address outside the private and link-local ranges, so §2.1 here lists at most 4 of those. Until the owner answers, the bridge follows §2.1, and the doc's line waits for that answer.

## Differences from the app's contract

The bridge builds this file. These points differ from the app's `docs/CONTRACTS.md`, its code or its mock home (`MockHome/server.mjs`), and the iPhone track re-syncs them to this file:

- **Pairing answers.** The mock answers `202 awaiting` and `410 declined`. This file: `202 awaiting_confirmation` and `403 declined`, as CONTRACTS.md §4.2 has them.
- **Freshness.** The mock accepts requests within 5 minutes. This file: 30 seconds either way (§2.5).
- **Bundle values.** The mock makes `d-` device IDs, 24-byte credentials and a `null` `home_key` for residents. This file: UUIDs, 32 bytes, and no `home_key` field for residents.
- **LAN commands.** The mock answers `200 {"v":1,"ok":true}`. This file: `202 {"v":1,"accepted":true}`.
- **`GET /v1/hello`.** CONTRACTS.md has `service` only, the mock `hub` only, and the app checks only for a 200. This file: both fields, and a phone uses the LAN route only when `hub` matches the first 8 characters of its stored `hub_pub` (§4.1), so another home's gateway at the same address can't make it show "removed".
- **Name.** 1 to 64 Unicode scalars. This file: 1 to 64 characters and at most 1024 UTF-8 bytes, with no control or bidirectional formatting characters (§2.2).
- **`ack`.** A phone → hub type. This file: gone (coherence decision 17). The hub answers `400 unsupported_type`.
- **Heartbeat and `monitoring`.** The heartbeat carries a monitoring object, `monitoring` is a type, and the mock puts heartbeats in the LAN page. This file: the heartbeat is `{msg_id, sent_at, type}` and travels through the relay only, so a LAN page never holds one (§3). "Monitoring degraded" is a Layer 4 alert (decision 15).
- **`heart_rate`.** `POST /v1/lan/heart-rate` with `{samples: [{t, bpm}]}`. This file: `watch_data` on `POST /v1/lan/commands`, with heart rate, sleep and steps (§3). `/v1/lan/heart-rate` gets `404 not_found`.
- **`reply`, `report` and `care_status`.** The app opens every fetched message with the home key and decodes only `alert`, `heartbeat` and `care_status`, as `{heart_rate: {bpm, at, trend}, no_heart_data}`. This file: `reply` is sealed with the asking phone's own key and has `to`, `report` is new, and `care_status` also carries `activity`, `sleep` and `steps` (§3).
- **Relay.** AWS. This file: the team's Vultr server (§5, step 5). `relay_url` is `""` until remote access is set up.
- **Unknown severity.** CONTRACTS.md §9 says `warning`, while its §3.1 and the app's `Severity(wire:)` say `urgent`. This file: `urgent` (§9).
- **`v` in a plaintext.** CONTRACTS.md §1 puts `"v": 1` on every top-level object. This file: a plaintext inside a wrapper has none (§1), as the app and its vectors already do.
- **Checks on hub messages.** The app opens a hub message without comparing the plaintext's `msg_id` and `type` with the wrapper's, and its base64url decoder takes `+`, `/` and stray `=`. This file: a mismatch drops the message (§3); without that check the relay could resend an old message under a new wrapper `msg_id`, because the associated data doesn't cover `msg_id`. Base64url is decoded strictly, with each length checked (§1).
- **No answer from either route.** The app shows "Can't connect to Debbie" and "Trying again every 30 seconds.", with no time. This file: "can't reach home" with the last contact time (§9), as the doc's "When things fail" asks.
- **Relay host.** CONTRACTS.md §5 and §8 describe API Gateway and SNS. This file: the team's own relay on Vultr, pushing straight to APNs in each token's environment (§5, §8).
- **Relay pages.** CONTRACTS.md's `GET /v1/messages` has no `hub`, and its cursors are plain. This file: every page carries `hub`, as a LAN page does, and the relay's cursors start with `r.`; a cursor from the other route starts at the oldest kept message (§5.3). The app keeps one cursor per route.
- **Push state.** `GET /v1/home` also carries `push` for the caller's environment (§5.4), and the app tells the caregiver when pushes aren't working.
- **Relay commands.** CONTRACTS.md answers only `202`. This file: the relay's own `403 forbidden`, `400 lan_only`, `400 unsupported_type`, `503 hub_offline` and `504 hub_timeout`, the hub's answers passed through, and a hub `403` turned into `401` (§5.5). A resident may send only `live_view_setting` and `unpair` through the relay.
- **Relay sign-in.** The relay answers `401` for a device it can't sign in (`device_removed` only with the right credential) and `429 too_many_attempts` after repeated failures (§5.1), and has an unsigned `GET /healthz`.
- **Hub-status pushes.** The hub-offline push carries `last_contact` in Unix seconds, and the app's monitoring notice comes from a `monitoring` message. This file: both pushes also carry `last_contact_at` in ISO 8601, and "monitoring degraded" is an ordinary alert (§3, §8.2).
- **Join QR code.** The app's `JoinQR` has no `hub_pub`. This file: the code carries `hub_pub`, the whole hub key, and the app refuses a code whose `hub_pub` differs from the one it paired with (§6.1). The app should also refuse a join payload over 1,024 bytes, as it does a pairing one.
- **Approval answers.** The mock answers `200 {"v":1,"ok":true}` and the app falls back to the relay on any answer outside 2xx. This file: `202 {"v":1,"accepted":true}`, and refusals are `400` with `forbidden`, `unknown_join`, `expired` or `join_mismatch`, or `409 duplicate` (§6.5); the app should fall back to the relay only when the LAN gateway can't be reached or answers 5xx.
