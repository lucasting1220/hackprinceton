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

After NFC normalization the name has 1 to 64 characters (extended grapheme clusters) and at most 256 UTF-8 bytes. It has no control character (Unicode category Cc) and no bidirectional formatting character (U+061C, U+200E, U+200F, U+202A to U+202E, U+2066 to U+2069). The hub shows and keeps the NFC form.

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
| `care_status`       | hub → caregivers                              | `home`    | Layer 4's live status                                        | later                    |
| `reply`             | hub → one phone (`to`)                        | device ID | `request_id, title, body`                                    | later                    |
| `fetch`             | phone → hub, LAN only                         | device ID | `after, limit` (§4.5)                                        | step 2, filled in step 4 |
| `unpair`            | phone → hub                                   | device ID | none                                                         | step 2                   |
| `request`           | caregiver phone → hub                         | device ID | `request_id, kind` (`ask` or `check_now`), `text`            | later                    |
| `laptop_approval`   | caregiver phone → hub                         | device ID | `join_id, laptop_pub, name, approve`                         | step 3 (§6)              |
| `live_view_setting` | resident phone → hub                          | device ID | `enabled`                                                    | later                    |
| `live_view_request` | caregiver phone → hub, through the relay only | device ID | `request_id, viewer_client_id`                               | step 7                   |

- `alert` carries Layer 4's fields (the doc's "Handoff to Layer 4"), and the hub passes them on unchanged, including Layer 4's `kind` and `severity` values, except `detected_at`, which it rewrites in UTC whole seconds with `Z` (§1). An alert with `update: true` replaces the alert with the same `alert_id`.
- `heartbeat` tells the relay the home is reachable, every minute (every 20 seconds for the demo). It carries no judgement about monitoring and never enters the outbox, so a LAN page never holds one.
- `care_status` is the live-status type, Layer 4's `POST /v1/status`. Its fields are set when the step that carries live status lands. The daily report gets its type in its own step.
- Watch data (heart rate, sleep and steps) goes from a phone in resident mode to the hub on the LAN only, and the relay never carries it. Step 8 names its type, path and fields.
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
   - `request`, `laptop_approval` and `live_view_setting` on `/v1/lan/commands` get `501 not_supported` until the step that builds each.
   - Anything else gets `400 unsupported_type`: `ack`, an unknown type, `fetch` on `/v1/lan/commands`, a command on `/v1/lan/messages`, or a type that travels only through the relay.

Checks 2 to 7 also run for commands that reach the hub through the relay (§5), with check 7 as for `/v1/lan/commands` and one memory of message IDs per phone, so the hub answers a command the same way on either route and a request can't be replayed by switching routes.

### 4.5 Fetch page

The `fetch` plaintext carries `after`, a cursor string or `null`, and `limit`, a whole number of at least 1. A `limit` above 50 counts as 50. Anything else gets `400 bad_request`. The answer is `200 {"v":1,"messages":[…],"next":"l.<epoch>.<seq>","hub":{"online":true,"last_contact_at":"2026-11-14T15:12:05Z"}}`.

- `messages` holds the outbox's wrappers (§3) for this phone that come after `after`, oldest first, at most `limit`. A caregiver phone gets the home-key wrappers and those whose `to` is its device ID. A resident phone holds no home key, so it gets only those whose `to` is its device ID. The hub keeps a message for at most 7 days.
- A cursor is `l.<epoch>.<seq>`, opaque to phones. `l.` marks the LAN route, `<epoch>` names one outbox, and `<seq>` numbers a message in it; a seq never repeats.
- An `after` that is `null`, lacks `l.` (such as the relay's `r.` cursors), names another epoch or can't be read starts at the oldest kept message. It is never refused, because the app keeps one cursor for both routes.
- `next` is the cursor of the last message the hub examined for this page, whether it returned it or skipped it as not for this phone. With none examined, it is the cursor given, or this outbox's newest cursor when the given one wasn't this outbox's.
- `hub` is the hub's own state. On the LAN it is always online, with `last_contact_at` set to now.
- Until step 4 fills the outbox, every page is empty with `next` `null`. A phone keeps its cursor when `next` is `null`.

### 4.6 Statuses and error codes

On `/v1/lan/messages` and `/v1/lan/commands`, 403 means only that the phone is unknown or removed, because the app reads any 403 there as "This iPhone was removed from the home". A repeat is 409, a type that a later step adds is 501, and any other fault the hub finds in a request that passed the HTTP rules (§4) is 400. Every error carries the §1 error body except 408.

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
| 501    | `not_supported`          | `/v1/lan/commands` | `request`, `laptop_approval` or `live_view_setting`, before the step that builds it                       |

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
- **Name.** 1 to 64 Unicode scalars. This file: 1 to 64 characters and at most 256 UTF-8 bytes, with no control or bidirectional formatting characters (§2.2).
- **`ack`.** A phone → hub type. This file: gone (coherence decision 17). The hub answers `400 unsupported_type`.
- **Heartbeat and `monitoring`.** The heartbeat carries a monitoring object, `monitoring` is a type, and the mock puts heartbeats in the LAN page. This file: the heartbeat is `{msg_id, sent_at, type}` and travels through the relay only, so a LAN page never holds one (§3). "Monitoring degraded" is a Layer 4 alert (decision 15).
- **`heart_rate`.** `POST /v1/lan/heart-rate`. This file: watch data (heart rate, sleep and steps) comes in step 8. Until then that path gets `404 not_found`.
- **Relay.** AWS. This file: the team's Vultr server (§5, step 5). `relay_url` is `""` until remote access is set up.
- **Unknown severity.** CONTRACTS.md §9 says `warning`, while its §3.1 and the app's `Severity(wire:)` say `urgent`. This file: `urgent` (§9).
- **`v` in a plaintext.** CONTRACTS.md §1 puts `"v": 1` on every top-level object. This file: a plaintext inside a wrapper has none (§1), as the app and its vectors already do.
- **Checks on hub messages.** The app opens a hub message without comparing the plaintext's `msg_id` and `type` with the wrapper's, and its base64url decoder takes `+`, `/` and stray `=`. This file: a mismatch drops the message (§3); without that check the relay could resend an old message under a new wrapper `msg_id`, because the associated data doesn't cover `msg_id`. Base64url is decoded strictly, with each length checked (§1).
- **No answer from either route.** The app shows "Can't connect to Debbie" and "Trying again every 30 seconds.", with no time. This file: "can't reach home" with the last contact time (§9), as the doc's "When things fail" asks.
