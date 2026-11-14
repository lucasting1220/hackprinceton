# Layer 1: Join and connect

**Status: draft for team review. Nothing is built.** This replaces our first Layer 1 draft. It is written against Lucas's Layer 2 draft (`docs/layer2-device-management.md` on branch `layer-2`, commit `6d74cc4`), the team's concept and roadmap, and the team's layer notes. "Decided" lists the Layer 1 team's decisions; a row tagged with an ask also needs that owner's agreement. The asks and the handoff sections are proposals: names, fields and ports can change once, together, at hour 0. "Open questions" are not settled.

**Edited by Lucas, Nov 14:** watch data now covers sleep and steps as well as heart rate (the "Watch data" row, `POST /v1/watch-data`, build step 8 and its acceptance test). Nothing else in this copy has been changed; the other changes it needs are listed in `coherence-review.md`.

## Summary

Layer 1 turns a few spare laptops and the family's iPhones into one paired home that a caregiver can reach from anywhere.

- Each laptop gets a setup page. The first laptop creates the home and becomes the coordinator laptop (Layer 2's "central agent"). Each extra laptop joins as a worker once a caregiver approves it by scanning a QR code.
- Layer 1 starts Lucas's coordinator and worker programs. It hands each worker the coordinator's address and a join token: the "address and a credential" in Layer 2's handoff.
- Layer 1 builds the iPhone app, in its own `debbie-ios` project, and Layer 4 adds the care screens. The app pairs with the home by QR code. Its resident mode sends Apple Watch heart rate, sleep and steps from HealthKit to Layer 4.
- Remote access goes through a small AWS relay. The home only makes outgoing connections (to the relay, and to AWS's video service during a live view), so there is no VPN app and no router setup. Messages between the home and phones are end-to-end encrypted, so the relay can't read them.
- When the resident has allowed it, a caregiver can open a live view of the home camera. Video goes straight from the laptop to the phone, or through AWS's TURN server when it must, encrypted either way.

Output: paired laptops running Layer 2; a caregiver phone that gets alerts anywhere and survives network changes without re-pairing; and a live view on request.

## Who builds what

| Piece | Owner |
|---|---|
| Setup page, launcher, pairing of laptops and phones, join tokens | Layer 1 |
| Hardware check, keep-awake step, sensor check, resident consent screen | Layer 1 |
| Setting up the demo laptops from one component list | Layer 1, with requirement lists from Lucas (ask L9) and the Layer 3 owner (ask T3) |
| Coordinator and worker programs, planner, jobs, 2-second status, dashboard | Layer 2 (Lucas) |
| Camera and mic capture job | Layer 2 (Layer 2's "Kinds of work") |
| Detection models: fall, sound, health analysis | Layer 3 |
| Rule-based alerts, care logic, language model use, acknowledgments, escalation | Layer 4 (proposed, ask F1) |
| iPhone app (`debbie-ios`): pairing, connection, push, live viewer, resident mode, and the status header on the home screen | Layer 1 |
| Care screens inside the app: alerts, status (including the heart-rate trend and "no heart data"), history | Layer 4 (proposed, ask F4) |
| AWS relay: CDK stack, Lambdas, IoT, DynamoDB, push, offline watchdog, provisioning script | Layer 1 |
| Hub connector on the coordinator laptop: AWS connection, encryption, outbox, health reports | Layer 1 |
| Live-view sender on the camera laptop | Layer 1, fed by a local frame feed from Lucas's capture job (ask L6) |

Layer 1 builds no scheduler, cluster heartbeat, care engine or second dashboard. Its setup page links to Lucas's dashboard.

## Decided

| Topic | Decision |
|---|---|
| Laptops | The demo uses several laptops: one coordinator laptop and one or more workers, as in Layer 2. The first laptop set up becomes the coordinator, so start with the laptop that stays plugged in. The external webcam and mic plug into a worker (the camera laptop) |
| Laptop pairing | Layer 1 gives each worker a join token and writes the accepted tokens to a file the coordinator reads. The worker sends its token in `hello`; Lucas's coordinator only checks it and replies accept or reject (ask L2) |
| Approving a laptop | The new laptop shows a QR code. A paired caregiver scans it in the app and approves |
| Phone pairing | The coordinator laptop shows a single-use QR code that expires after 10 minutes. The person at that laptop confirms a 4-digit code that also shows on the phone. A phone pairs as a caregiver (it gets the home key) or as a resident (heart rate only). A caregiver phone can also turn on resident mode, so one iPhone can play both roles in the demo |
| Caregiver identity | For the demo, the device credential a phone receives when it pairs. The hub vouches for each phone to the relay. Caregiver accounts (Cognito sign-in) come after the hackathon |
| Encryption | Messages between the hub and phones are end-to-end encrypted with keys exchanged during pairing (see "Phone ↔ hub messages"). The relay sees only routing data: IDs, roles, times, sizes, which phones belong to a home, and when a live view starts |
| Push | Amazon SNS to Apple's push service. The push carries the encrypted alert, and the app's notification extension decrypts it on the phone, so the notification says what happened |
| Live video | In the demo. Layer 1 builds the sender: a browser window on the camera laptop that uses AWS's Kinesis Video Streams (KVS) WebRTC JavaScript library and gets its frames from Lucas's capture job (ask L6). Video only, no audio. Sessions last up to 5 minutes |
| Live-view consent | Off until the resident turns it on during setup. The resident can turn it off at any time: on the coordinator's setup page, on the camera laptop's live notice, or in resident mode. The camera laptop shows a full-screen notice while someone is watching |
| iPhone app | Layer 1 owns the Xcode project, `debbie-ios`, kept outside this repository. Layer 4 adds the care screens there (ask F4). One app, with a caregiver role and a resident mode |
| Watch data | In the demo. Resident mode reads heart rate, last night's sleep (total, bedtime, wake time and interruptions) and steps so far today from HealthKit (synced from the Watch) and sends them to Layer 4 over home Wi-Fi. HealthKit can't be read while the phone is locked, so readings arrive in bursts after an unlock. The app sends everything since its last check, and the resident screen has a "Sync now" button |
| Sound detection | Proposed: runs on a laptop mic, as in Layer 2. Phones are not sensors (ask T2) |
| Component list | Layer 1 keeps one list of what each laptop role needs, including Python, Ollama and its models, and llama.cpp. For the demo, laptops are set up by hand from it |
| Languages | Node/TypeScript for the laptop bridge and the AWS stack, Swift for the app |
| Accounts | The team has a paid Apple Developer account, an AWS account with credits, one iPhone and an Apple Watch |

## Asks

### To Lucas (Layer 2)

Each ask is small and sized to sit next to Layer 2's build steps 1 and 2. "Needed by" counts hours from when the team starts building. If an ask doesn't suit Lucas's code, he names an alternative and we adapt.

| # | Ask | Why | Needed by |
|---|---|---|---|
| L1 | Entry points that start the coordinator and the worker from a config file, plus a `check` mode (details in "Handoff to Layer 2"). `check` opens only the camera and mic named in `worker.json`, reads one frame and about a second of audio, and reports the mic as failing if the audio is all zeros | Layer 1 starts the programs, and the setup page shows what's missing and whether OS permissions work | Hour 10 |
| L2 | The coordinator re-reads `accepted-workers.json` on each `hello`, looks up the token's hash, and replies with a `welcome` that accepts or rejects. Neither program logs the token or whole `hello` messages | Laptop pairing | Hour 10 |
| L3 | The worker writes a small status file: connected, rejected or disconnected, plus anything missing | The setup page shows "Joined" only after acceptance | Hour 10 |
| L4 | When its connection drops, the worker keeps running, writes `disconnected`, and retries every few seconds, re-reading `coordinator_url` from `worker.json` before each try. A `hello` from a laptop the coordinator already knows replaces that laptop's old connection | Switching to the hotspot, or restarting the coordinator, without re-pairing | Hour 10 |
| L5 | The dashboard's data as JSON at a local URL (proposed shape in "Handoff to Layer 2") | The hub connector reports monitoring health and finds the camera laptop. It's written in Node, so it can't use the Python client's `status()` | Hour 18 |
| L6 | On the camera laptop, the capture job serves `ws://127.0.0.1:<frame_feed_port>`: each frame one binary JPEG message, up to 15 per second, about 640×480, encoded only while a client is connected, accepting only the sender page's origin | Live view without a second program fighting over the webcam | Hour 20 |
| L7 | Could the worker use the Ollama server that Ollama's own app runs at `ollama_url`, rather than starting its own? Two servers on one laptop would compete for the port and memory | One Ollama server per laptop | Hour 10 |
| L8 | Programs never exit because something is missing; they run what they can and report the rest, as Layer 2 already says. Exit codes and a stop file as in "Handoff to Layer 2" | The launcher restarts only real crashes, and Windows gets a clean stop without signals | Hour 10 |
| L9 | A short requirements list: Python version, pip packages, Ollama model tags for the planner and `quick` models, and the llama.cpp build if Layer 2's step 7 stays | Every demo laptop set up the same way | Hour 2 |
| L10 | The client endpoint Layer 4 uses listens on 127.0.0.1 only, at `client_port`. And a check: Layer 1's bridge and Layer 4 also run on the coordinator laptop (ask F2). Does that leave room for the planner model and the split-model lender? | Nobody on the venue Wi-Fi can subscribe to fall events, and the coordinator laptop doesn't run out of memory | Hour 16 |

We no longer ask Lucas for an enrollment API, phone credentials, an artifact manifest or the video sender. TLS between workers and the coordinator can wait until after the hackathon.

### To the Layer 4 owner

| # | Ask |
|---|---|
| F1 | Own the rule-based alert path. Fixed thresholds and timers send an alert as soon as a rule fires. The language model only adds wording later, as an update to the same alert. The concept requires that an alert never waits on the language model |
| F2 | Run on the coordinator laptop, listening on 127.0.0.1 only, and give Layer 1 a start command; Layer 1's launcher starts and restarts it. Use language models through Layer 2's `ask()` rather than loading one on this laptop, so the coordinator laptop stays light |
| F3 | Agree the local calls in "Handoff to Layer 4" |
| F4 | Build the care screens (alerts; status, including the heart-rate trend and "no heart data"; history) in Layer 1's `debbie-ios` project, through pull requests |

### To the Layer 3 owner

| # | Ask |
|---|---|
| T1 | Join the hour-0 agreement. Lucas's doc also needs your sign-off |
| T2 | Confirm that sound detection runs on a laptop mic, and correct "Every phone listens…" in the team notes |
| T3 | Send a pinned list of Python packages and model files, so every demo laptop is set up the same way |
| T4 | Say whether any script opens the camera or mic itself instead of using Lucas's capture job; live view and the sensor check depend on it |

## Parts

```
Caregiver iPhone ◀──── push ─────┐
     │ HTTPS                      │
     ▼                            │
┌──────────── AWS relay (Layer 1) ─────────┐
│ API · IoT Core · DynamoDB · SNS push     │
│ offline watchdog · KVS signaling, TURN   │
└──────────────────▲───────────────────────┘
                   │ one outgoing connection
┌──────────── COORDINATOR LAPTOP ──────────┐
│ Layer 1 bridge: setup, pairing, launcher,│◀── Resident mode:
│   hub connector, LAN gateway             │    heart rate over
│ Layer 2 coordinator and planner (Lucas)  │    home Wi-Fi
│ Ollama · Layer 4 care agent (ask F2)     │
└──────────────────┬───────────────────────┘
                   │ Layer 2 control (Lucas) and bridge link (Layer 1)
┌──────────── WORKER LAPTOPS ──────────────┐
│ Layer 2 worker and capture job (Lucas)   │
│ Layer 3 jobs · Ollama                    │──▶ live video to the caregiver
│ Layer 1 bridge: setup, launcher,         │    iPhone, direct or via TURN
│   live-view sender (camera laptop only)  │
└──────────────────────────────────────────┘
```

| Process | Built by | Started by | Runs on |
|---|---|---|---|
| Layer 1 bridge | Layer 1 | The person setting up, from Terminal (later, at login) | Every laptop |
| Coordinator program | Lucas | Layer 1 launcher, which restarts it after a crash | Coordinator laptop |
| Worker program | Lucas | Layer 1 launcher, which restarts it after a crash | Each worker laptop |
| Capture job, with the frame feed (ask L6) | Lucas | Lucas's worker | The camera laptop and the mic laptop |
| Layer 3 jobs | Layer 3 | Lucas's worker | Wherever the planner places them |
| Ollama server | Ollama, installed by Layer 1 | Ollama's own app, at login | Every laptop that runs a model |
| Planner and worker models | Lucas | Lucas's programs, through Ollama | Coordinator and worker laptops |
| llama.cpp split-model parts | Lucas | Lucas's programs | See "Questions for Lucas" |
| Layer 4 care agent | Layer 4 | Layer 1 launcher (ask F2) | Coordinator laptop |
| Live-view sender | Layer 1 | Layer 1 bridge, only during a live view | The camera laptop |

Each process has one supervisor: Layer 1 restarts what it starts, and Lucas restarts what he starts (Question 4 asks whether his worker restarts a job that exits).

### Ports (proposed)

| Port | What listens | Reachable from |
|---|---|---|
| 7443 | Lucas's coordinator: worker control and media | The local network |
| 7450 | Lucas's dashboard, with its JSON at `/api/state` (ask L5) | Lucas decides; Layer 1 reads the JSON from 127.0.0.1 |
| 7451 | The client endpoint Layer 4 uses (ask L10) | 127.0.0.1 only |
| 7460 | The frame feed on the camera laptop (ask L6) | 127.0.0.1 only |
| 7470 | Layer 1 bridge, local side: the setup page, the Confirm button, and the calls Layer 4 makes | 127.0.0.1 only |
| 7480 | Layer 1 bridge, network side: phone pairing requests, the LAN gateway, laptop join requests, bridge links | The local network |
| 7490 | Layer 4's API | 127.0.0.1 only |
| 11434 | Ollama | 127.0.0.1 only |

Nothing on the network side can confirm a pairing or post an alert. Those happen only on 127.0.0.1, so someone else on the venue Wi-Fi can't pair a phone or fake an alert.

**Discovery.** The coordinator's bridge advertises its network side by mDNS (Bonjour) as `_debbie._tcp` on port 7480, with the first 8 characters of the hub's public key (base64url) in its TXT record, so phones and laptops can tell homes apart.

## Setting up a home

### Create a home (first laptop)
1. Run the setup command from Terminal (see "Network permissions"). The setup page opens in the browser. Choose **Create a home**.
2. **Check this laptop**: CPU, memory, disk, OS, camera and mic. This laptop coordinates, so a camera or mic on it won't be used.
3. **Keep this laptop awake**: the person approves, and the bridge keeps the laptop and its screen awake while it runs (`caffeinate -dis -w <bridge pid>` on macOS; on Windows, screen and sleep set to Never when plugged in). Lids stay open during the demo.
4. The bridge creates the home ID, the home key and its own key pair, and shows the home ID. Remote access shows as "not set up" until the team runs the provisioning script with that home ID (build step 5); the bridge loads the certificate the next time it starts.
5. It writes `coordinator.json` and an empty `accepted-workers.json`, starts Lucas's coordinator, and starts Layer 4.
6. **Pair the caregiver's phone** (below). Pair the resident's iPhone the same way, choosing Resident, or, if the team has one iPhone, turn on resident mode on the caregiver's phone.
7. **Resident consent**: the resident agrees to each sensor (camera, mic, heart rate) and chooses whether a caregiver may open a live view. A "no" to the camera or mic leaves that device unconfigured (its `worker.json` field is `null`), and the setup page says what won't run; Question 3 asks Lucas how his plan should show it. A "no" to heart rate leaves resident mode off.
8. **Home created. Add a laptop.** The page links to Lucas's dashboard, which shows zero workers. Nothing claims monitoring is active yet.

### Pair a phone
1. The coordinator's setup page shows a pairing QR code (format in "Phone ↔ hub messages"): the bridge's network addresses, the hub's public key and a one-time secret. It expires after 10 minutes and is used up once the pairing is confirmed.
2. The app asks for Local Network access first. It then scans the code, makes its own key pair, and sends its public key, a name (for example "Caregiver's iPhone") and its role, with a proof that it saw the QR code.
3. The laptop and the phone show the same 4-digit code, and the person at the laptop clicks **Confirm**. Only someone at the coordinator laptop can confirm.
4. The bridge sends back, encrypted with the phone's own key: the home ID, a device ID and device credential, the relay's address and, for caregivers, the home key.
5. The hub tells the relay about the new phone (device ID, role and a hash of its credential) over its own AWS connection. From then on, the relay accepts that phone.
6. The phone keeps its keys and credential in a Keychain access group shared with its notification extension, readable after the first unlock, so the extension can decrypt alerts while the phone is locked.

### Add a laptop
1. On the new laptop, run the setup command and choose **Join a home**. Then **Check this laptop** (Layer 2 needs at least 16 GB on a worker) and **Keep this laptop awake**.
2. The bridge finds the coordinator's bridge on the local network by mDNS. If that fails, the person types the address shown on the coordinator's setup page.
3. It sends a join request (the laptop's name and public key) to the coordinator's bridge and shows an **Add this laptop** QR code.
4. A caregiver taps **Add a laptop** in the app, scans the code and approves. The approval goes to the coordinator's bridge over home Wi-Fi, or through the relay when the phone isn't on the home network.
5. The coordinator's bridge gives the laptop a node ID and a join token, encrypted to its key. It adds the token's hash to `accepted-workers.json` before sending the token.
6. **Check sensors** (on the camera or mic laptop): the person picks the external webcam and mic, and the bridge runs Lucas's `check` through the same launch path the demo uses. The page shows **Camera OK** and **Mic OK**, or names the setting to change.
7. The bridge writes `worker.json` and the token file, deletes any old status and stop files, and starts Lucas's worker. It shows **Joined** only when the worker's status file says the coordinator accepted it.
8. The bridge keeps a link to the coordinator's bridge, signed in with its join token, used to start and stop live view and to report setup progress.

### Network permissions
- **iPhone**: the app declares local-network use and the Bonjour service it looks for, and allows plain HTTP to local addresses (from iOS 17, App Transport Security blocks connections to IP addresses otherwise). It brings up the Local Network prompt before pairing, and retries, because iOS may refuse the first request while that prompt is showing.
- **Mac**: start the bridge from Terminal.app or over SSH. From macOS 15, programs started from other apps (VS Code, Cursor, iTerm) can't reach the local network or use mDNS until that app is allowed under Privacy & Security → Local Network.
- **Windows coordinator**: allow Node and Python through the firewall and set the network to Private, or the other laptops can't reach it.
- **Camera and mic**: on macOS the permission belongs to the app that started the bridge, so start it the same way every time.

### Screens
- **Laptop:** Welcome (Create or Join) · Check this laptop · Keep awake · Pairing QR and code, with Confirm · Resident consent · Find the home · Add-this-laptop QR · Check sensors · Starting · Joined or Home created, with a link to Lucas's dashboard · Paired phones (remove) · Live view on/off · the live notice on the camera laptop. Troubleshooting names what's missing, a wrong network, a denied permission or a rejected token, and never shows secrets.
- **Phone:** Scan to pair · Show code (confirm on the laptop) · Home: Layer 1's status header with three states (Connection: relay reachable and the hub's last contact; Monitoring: from the heartbeat; Language model: from Layer 4's health), the Live view button, and Layer 4's alerts, status and history screens · Add a laptop · Resident mode (permission for heart rate, sleep and steps; last reading; Sync now; live view on/off) · Settings (unpair).

## Handoff to Layer 2

These are proposals for Lucas: he can rename any field or change any behaviour, and we'll match it. Layer 1 writes the config files and Lucas's programs read them. All paths are absolute. Once agreed, example files go in `layer1/contracts/`.

`coordinator.json`:
```json
{
  "schema_version": 1,
  "home_id": "home-uuid",
  "listen_port": 7443,
  "dashboard_port": 7450,
  "client_port": 7451,
  "ollama_url": "http://127.0.0.1:11434",
  "accepted_workers_file": "/abs/path/accepted-workers.json",
  "state_dir": "/abs/path/coordinator",
  "stop_file": "/abs/path/coordinator.stop"
}
```

`accepted-workers.json`:
```json
{ "workers": [ { "node_id": "node-uuid", "display_name": "Kitchen laptop", "token_sha256": "hex" } ] }
```

`worker.json`:
```json
{
  "schema_version": 1,
  "home_id": "home-uuid",
  "node_id": "node-uuid",
  "display_name": "Kitchen laptop",
  "coordinator_url": "ws://192.168.1.20:7443",
  "token_file": "/abs/path/worker-token",
  "camera": "Logitech C920",
  "mic": "Logitech C920",
  "frame_feed_port": 7460,
  "ollama_url": "http://127.0.0.1:11434",
  "python": "/abs/path/python",
  "status_file": "/abs/path/worker-status.json",
  "stop_file": "/abs/path/worker.stop",
  "state_dir": "/abs/path/worker"
}
```

- **Token.** 64 lowercase hex characters, written to `token_file` with no newline and readable only by the user running the bridge. `token_sha256` is the SHA-256 of those characters, in lowercase hex. Tokens never appear in logs or on command lines.
- **`hello`** stays as Layer 2 defines it: the token goes in as the credential, and `display_name` as the laptop name. The coordinator finds the laptop's `node_id` from the token's hash. It replies `{"type": "welcome", "accepted": true, "node_id": "…"}`, or `{"type": "welcome", "accepted": false, "reason": "unknown_token"}` and then closes the connection.
- **Sensors.** `camera` and `mic` name the only devices the worker may report and capture (a name or index Lucas's code can open), or are `null` when there is none or the resident declined it. Built-in cameras and mics aren't used unless named.
- **`python`** is the interpreter Lucas's worker uses for Layer 3 jobs.
- **Files.** Every JSON file is written whole: to a temporary file, then renamed (retried if Windows reports the file busy). Times are ISO 8601 in UTC.
- **Worker status file:** `{"node_id": "…", "state": "connected", "missing": [], "updated_at": "…"}`, where `state` is `connected`, `rejected` or `disconnected`, and `missing` items look like `check`'s.
- **`check --config worker.json --json`** prints `{"ok": true, "missing": [{"id": "ollama", "reason": "not reachable at http://127.0.0.1:11434", "required": false}]}` and installs nothing. `ok` is false only when a required item is missing, and then `check` exits with 4. Ollama and llama.cpp are not required for fall and sound detection.
- **Exit codes** for the coordinator and worker: 0 stopped normally, 2 bad config, 3 token rejected, 1 anything else. Missing items never stop them (ask L8). The launcher restarts a program only after code 1, and shows the reason for 2 and 3.
- **Stop file.** When it appears, the program stops its jobs and exits within 10 seconds; after that, Layer 1 ends the process.
- **Dashboard JSON** (ask L5): `GET http://127.0.0.1:7450/api/state` returns `{"updated_at": "…", "laptops": [{"node_id": "…", "display_name": "…", "last_status_at": "…", "sensors": ["camera", "mic"], "missing": []}], "jobs": [{"job": "fall_detection", "node_id": "…", "state": "running"}], "dropped": [{"work": "…", "reason": "…"}]}`, using Layer 2's job names and its `dropped` list. The hub connector judges staleness itself, from `last_status_at` and the laptops in `accepted-workers.json`.
- **Transport.** Workers reach the coordinator over plain WebSocket on the demo network (see Question 1 about which network). TLS with a pinned certificate is for after the hackathon, at Lucas's discretion.
- **Network changes.** If the coordinator's address changes, for example after switching to the hotspot, the worker bridges find it again by mDNS and rewrite `coordinator_url`, and the worker picks it up on its next retry (ask L4). If mDNS fails, the person types the new address on the worker's setup page. The laptop keeps its node ID and token.

## Handoff to Layer 4

These are proposals for the Layer 4 owner. Layer 4 runs on the coordinator laptop (ask F2) and listens on 127.0.0.1:7490. Layer 1's bridge receives Layer 4's calls on 127.0.0.1:7470. Layer 1 passes both addresses, plus Lucas's client endpoint (`http://127.0.0.1:7451`), in Layer 4's start command. Every call is JSON over HTTP on the same laptop.

| From → to | Call | Fields |
|---|---|---|
| Layer 4 → Layer 1 | `POST /v1/alerts` | `alert_id, kind, severity, detected_at, title, body, update` |
| Layer 4 → Layer 1 | `POST /v1/replies` | `request_id, title, body` |
| Layer 4 → Layer 1 | `POST /v1/status` | the care status the app shows: latest heart rate and trend, `no_heart_data`, and anything else the care screens need |
| Layer 1 → Layer 4 | `POST /v1/acks` | `alert_id, device_id, acked_at, false_alarm` |
| Layer 1 → Layer 4 | `POST /v1/requests` | `request_id, device_id, kind, text` |
| Layer 1 → Layer 4 | `POST /v1/watch-data` | `device_id, heart_rate: [{measured_at, bpm}], sleep: [{night_of, asleep_minutes, bedtime_at, wake_at, interruptions}], steps: [{measured_at, steps_today}]` |
| Layer 1 → Layer 4 | `GET /v1/health` | returns `ok, rules_running, language_model_available` |

- Request `kind` is `ask` (a question in plain words, which Layer 4 answers) or `check_now` (the caregiver asks the home to check on the resident now; Layer 4 decides what that means, for example asking "Are you okay?" aloud).
- Layer 4 sends an alert the moment a rule fires. If the language model later writes better wording, Layer 4 sends it with the same `alert_id` and `update: true`, and the phone replaces the first notification.
- The hub connector encrypts each alert once with the home key and keeps it in an outbox on disk until the relay confirms it (the MQTT acknowledgment), resending after an outage. The LAN gateway serves the same encrypted message to phones on home Wi-Fi.
- Requests are asynchronous: the phone gets an ID at once and fetches the reply later, because AWS's HTTP API ends any request after 30 seconds.

## Phone ↔ hub messages (proposed)

Both tracks build to this, and any change is agreed by both. The iPhone track drafts the remaining details and the test vectors in `debbie-ios/docs/CONTRACTS.md`. Once the laptop track's code passes the same vectors, they're copied to `layer1/contracts/phone-hub.md`.

- **QR code**: JSON `{v: 1, addrs, hub_pub, secret, exp}`. `addrs` lists every IPv4 address and port of the bridge's network side; `hub_pub` is the hub's 32-byte X25519 public key and `secret` 16 random bytes, both base64url; `exp` is a Unix time.
- **Pairing request**: `{v, phone_pub, name, role, proof}`. `role` is `caregiver` or `resident`, and `proof = HMAC-SHA256(secret, phone_pub ‖ role ‖ 0x00 ‖ name in UTF-8)`. The same phone key may resend its request until the person confirms.
- **Keys**: `shared = X25519(phone, hub)`. The phone's own key is `HKDF-SHA256(shared, salt = secret, info = "debbie/v1/phone-key", 32 bytes)`. The 4-digit code is the first 4 bytes of `HKDF-SHA256(shared, salt = secret, info = "debbie/v1/code", 4 bytes)` read as a big-endian number, mod 10000, zero-padded.
- **Envelope** for every encrypted message: `{v: 1, kid, n, c}`, base64url. `kid` is `home` for the home key, the device ID for a phone's own key, or `pair` during pairing. `n` is a random 12-byte nonce, and `c` is the ChaCha20-Poly1305 ciphertext followed by its 16-byte tag. The associated data is `debbie/v1/{home_id}/{kid}/{type}`, or `debbie/v1/pair` during pairing.
- **Freshness**: every plaintext carries `msg_id` and `sent_at`. Receivers drop repeated `msg_id`s and any command older than 30 seconds.
- **Credentials**: a phone shows its device credential only to the relay, over HTTPS. On the LAN gateway it proves who it is by encrypting each request with its own key, so the credential never crosses the local network.
- **Library notes**: CryptoKit's combined sealed box is nonce, ciphertext, tag; split it to fill `n` and `c`. Node imports a raw X25519 public key most reliably as a JWK, `{kty: "OKP", crv: "X25519", x}`.

## Remote connection (AWS)

The hub keeps one outgoing connection to AWS IoT Core. Nothing in the home accepts connections from the internet, and laptop-to-laptop traffic stays on the local network.

| Part | Job |
|---|---|
| IoT Core | The hub's connection: MQTT over TLS on port 443 (which needs the ALPN setting AWS's IoT Device SDK adds), with a clean session so commands queued while the hub was offline aren't replayed. One policy for every home, keyed on the IoT thing name: connect only as itself, publish to `homes/{home_id}/hub/events`, and subscribe and receive on `homes/{home_id}/hub/commands`. An IoT rule sends hub events to the relay's Lambda, which takes `home_id` from the topic, never from the message |
| API Gateway HTTP API + Lambda | The phone's API: send a request or acknowledgment, fetch messages, start or stop a live view, register for push. Each call carries the phone's device credential |
| DynamoDB | One table: phones per home, encrypted messages (kept 7 days), the hub's last contact time, live-view sessions. The relay drops duplicate message IDs |
| SNS → APNs | Push to caregiver phones with the team's APNs key, through two platform applications: APNS for TestFlight builds and APNS_SANDBOX for builds run from Xcode. Phones register their push token together with its environment |
| EventBridge + Lambda | The offline watchdog, once a minute |
| Kinesis Video Streams WebRTC | Signaling and TURN for live view: one signaling channel per home, with recording and storage off. The Lambda's role may get endpoints, get ICE servers, and connect as sender or viewer on Debbie's channels only |
| CDK (TypeScript) | Defines everything in one region, with a budget alert |

For the demo, the team runs a provisioning script once the CDK stack exists (build step 5). Given the home ID that Create a home shows, it creates an IoT thing named after it, with a certificate attached to the shared policy, and the home's video channel. It saves the files on the coordinator laptop, where the bridge picks them up on its next start. No AWS access keys go on a home laptop or a phone, or into the repo. After the hackathon, the hub enrolls itself with a certificate request approved from a paired caregiver's phone.

Every command carries its send time, and the hub ignores commands older than 30 seconds.

### Push
- Every alert push carries `aps.alert` with placeholder text ("New alert from Debbie"), `mutable-content: 1`, the time-sensitive interruption level (with the Time Sensitive Notifications capability), and the encrypted alert as a custom key. The app's notification extension decrypts it and replaces the text.
- APNs payloads are capped at 4 KB, so the encrypted alert stays under about 2 KB; the app fetches anything longer when it's opened.
- An update (`update: true`) is sent with the alert's ID as its collapse ID, so it replaces the first notification instead of adding a second.
- The relay writes the "hub offline" push itself, with the last contact as a Unix time that the extension shows in the phone's time zone ("Debbie hasn't heard from home since 3:12 PM"). It contains nothing private.

### What the relay can see

| Data | Readable by the relay? |
|---|---|
| Alert, status and reply contents | No, they're encrypted |
| Message IDs, roles, times and sizes; which phones belong to which home | Yes |
| Whether the hub is online (its last contact time) | Yes |
| Live video | Not by watching traffic: video is encrypted between the laptop and the phone, even through TURN. The relay does set up each session, so the laptop's on-screen notice, not encryption, is what shows someone is watching |
| When a live view started and which phone asked | Yes |
| Raw watch readings (heart rate, sleep, steps) | Not sent; they stay on the home network. An alert or status that mentions them is encrypted like any other message |
| Push text | No. The push carries ciphertext that the phone decrypts |

### Health and offline alerts
- The hub connector sends an encrypted heartbeat every minute. It includes monitoring health from Lucas's dashboard JSON (ask L5): which laptops report, whether the camera and mic laptops are up, and whether fall and sound detection are running.
- If the camera or mic laptop's status goes stale, or fall or sound detection stops for more than 30 seconds (longer than Layer 2's few-second gap while a job moves), the hub connector sends an encrypted "monitoring degraded" notice. A sleeping worker must never look healthy.
- The watchdog runs every minute. When a hub has been silent for 3 minutes, it pushes "hub offline", and "back online" when it returns. For the demo, use a 20-second heartbeat and a 1-minute limit so the push arrives within about 2 minutes; rehearse it or record it.

## Live view

1. The caregiver taps **Live view**. The app sends a live-view request encrypted with its own key (a request ID, the time and a fresh viewer client ID) and gets a session ID back at once.
2. A Lambda checks that this phone is a caregiver for the home. For the home's channel, it gets the signaling endpoints and the ICE servers (KVS's STUN address, plus TURN addresses with a username and password that last 5 minutes), and pre-signs a 5-minute sender URL. It sends "start live view" to the hub with the sender URL, the ICE servers and the phone's encrypted request, unopened.
3. The hub connector opens the request, which must decrypt with a paired caregiver's key, be under 30 seconds old and not have been seen before. Then it checks the resident's setting. If live view is off, it replies "denied" and the app says so. If it's on, it tells the camera laptop's bridge, over the bridge link, to open the sender and which viewer client ID it may answer.
4. The sender is one Chrome or Edge window that the bridge starts with its own profile, in kiosk mode (Edge on Windows, where every laptop has it). The window is the full-screen **Live: your caregiver is watching** notice, with a **Turn off live view** button, and it holds the canvas being streamed, shown as a preview. It reads frames from Lucas's frame feed (ask L6), draws them on the canvas, and streams the canvas through the KVS JavaScript library, which takes the pre-signed URL through a custom request signer. Nothing may cover this window, because Chrome stops streaming a hidden canvas.
5. When the sender is connected, the hub replies "ready". Only then does the Lambda pre-sign the viewer URL, which the phone fetches with its session ID along with the ICE servers. Video goes straight from laptop to phone when the networks allow, and otherwise through TURN, encrypted either way.
6. The session ends after 5 minutes, when the caregiver taps **Stop**, or when the resident turns live view off. The bridge closes the sender window's process at once. **Keep watching** starts a new session.

Notes:
- Video only: no room audio and no talk-back.
- The coordinator laptop never encodes video.
- AWS offers KVS WebRTC libraries for C, JavaScript, Android and iOS, but not Python, which is why the sender is a browser window. The frame feed is a WebSocket rather than an image URL so the browser can stream the canvas without cross-origin errors.
- The app's viewer uses Google's WebRTC library built for iOS. Google no longer publishes iOS builds, so the app uses a maintained community build. It opens the pre-signed URL as a WebSocket and exchanges KVS's JSON signaling messages, so phones never hold AWS keys.
- KVS limits that shape this design: one sender per channel, up to 10 viewers, sender connections of at most an hour, and TURN credentials that last 5 minutes. Hence 5-minute sessions.
- The riskiest part, KVS through TURN to an iPhone on cellular, is tested first, in build step 0b.
- Cost: AWS lists $0.03 per active channel per month, $2.25 per million signaling messages and $0.12 per 1,000 TURN minutes (US East), plus data transfer. Measure the real cost per home during the hackathon before quoting a number in the pitch.

## Privacy claim

Suggested pitch wording, for now: "AI monitoring runs inside the home, and video and audio are never uploaded for analysis. A caregiver can open an encrypted live view only when the resident has turned it on, and the laptop shows when someone is watching. Alerts are end-to-end encrypted, so our relay can't read them."

Say "never recorded" only if Lucas agrees to Question 2 (detection events instead of a day of recordings). This replaces the concept's "video and audio never leave the house", and the concept should be updated to match (Open question 1).

## When things fail

| Failure | What happens |
|---|---|
| Phone moves from Wi-Fi to cellular | The app switches from the LAN gateway to the relay. No re-pairing |
| Home internet drops | Monitoring carries on locally. Alerts wait in the outbox and arrive on reconnect. The watchdog pushes "hub offline" |
| Camera or mic laptop sleeps or crashes | Its status goes stale in Lucas's dashboard JSON, and the hub connector sends "monitoring degraded" |
| Coordinator laptop restarts | Starting the bridge again relaunches Lucas's coordinator and Layer 4. Workers reconnect by themselves (ask L4). Pairings, tokens and keys are files and survive |
| Network change (venue Wi-Fi to hotspot) | Worker bridges find the coordinator's bridge again by mDNS, or the person types its new address on the worker's setup page; nothing is re-paired. Caregiver phones use the relay meanwhile. Heart rate pauses until the resident's phone finds the bridge again by Bonjour |
| Relay unreachable from the phone | The app shows "can't reach home" with the last contact time. It never shows an all-clear it can't confirm |
| Live view stopped, expired or turned off | The sender window closes immediately |
| A phone is unpaired (in its Settings, or removed on the coordinator's setup page) | The hub tells the relay, which rejects that phone's credential from then on |

Target: reconnect within 30 seconds once both ends have a working connection. Record the measured times.

## Prerequisites (check at hour 0)

| Item | State |
|---|---|
| Apple Developer account | Exists. App ID, push capability and APNs key (.p8, with its key ID and team ID) still to create |
| AWS account | Exists, with credits. Region, `cdk bootstrap`, balance and expiry still to check |
| iPhones | One, paired with the Apple Watch. A second (a teammate's, added as an internal TestFlight tester) would let the caregiver and the resident be separate phones |
| Demo phone settings | Focus and Do Not Disturb off; notifications allowed |
| Chrome or Edge on the camera laptop | To check |
| Demo laptops listed: OS, chip, memory, and which one gets the webcam and mic | To do |
| Network test on venue Wi-Fi and the hotspot: phone to coordinator laptop, and laptop to laptop | To do, with Lucas |

With one iPhone, it pairs as a caregiver and turns on resident mode. Do the heart-rate step on home Wi-Fi first, then switch the phone to cellular for the alert, "hub offline" and live-view steps.

## Build order (hackathon)

Two tracks run side by side: laptop and cloud (bridge, hub connector, relay, sender), and iPhone (the `debbie-ios` app, built from its own kickoff brief).

| Step | What | Depends on |
|---|---|---|
| 0 | Hour 0–1: agree the handoff files and ports with Lucas, the local calls with the Layer 4 owner, and the frame feed; get the Layer 3 owner's answers to T1–T4; check prerequisites; run the network test | none |
| 0b | Hours 1–6, the riskiest outside services first: (a) as soon as the app has a build with push enabled, one push to it through SNS, then one decrypted by the notification extension on a locked phone; (b) AWS's KVS WebRTC JavaScript sample page as sender on the camera laptop and as viewer in Safari on the iPhone over cellular, with TURN forced (using a developer's temporary AWS credentials, for this test only). If (a) fails by hour 6, the app fetches alerts while it's open and the push tests are marked BLOCKED. If (b) fails by hour 8, tell the whole team before doing more video work | 0 |
| 1 | Create a home: bridge, setup page, start Lucas's coordinator (a labelled stub until his step 1 lands), dashboard link | 0 |
| 2 | Pair a phone: QR code, matching code, encrypted handover; the app keeps its keys in the shared Keychain | 1 |
| 3 | Add a laptop: join request, approval from the phone, token, Lucas's worker accepted and shown on his dashboard | 2, Layer 2 step 1, asks L1–L4 |
| 4 | Alert on the phone over home Wi-Fi: a stub Layer 4 posts an alert, the hub connector encrypts it, the LAN gateway serves it, and the app decrypts and shows it | 2 |
| 5 | Relay: CDK stack, provisioning the hub, an alert pushed to a locked phone on cellular and decrypted by the notification extension, heartbeat, offline watchdog | 0b, 4 |
| 6 | A real alert end to end: Layer 3 detects a staged fall, Layer 4's rule fires, the push arrives, with Ollama stopped | 5, Layer 2 step 2 with the capture job and `subscribe()`, Layers 3 and 4 |
| 7 | Live view on cellular: Lucas's frame feed to the sender window, through KVS, to the app's viewer, with consent, the on-screen notice, the 5-minute limit, Stop and Turn off live view | 0b, 5, ask L6 |
| 8 | Resident watch data (heart rate, sleep, steps): HealthKit to the LAN gateway to Layer 4 | 2, Layer 4 |
| 9 | Hardware check, keep-awake, sensor check and resident consent screens | 3 |
| 10 | Three full rehearsals and a backup recording | all |

Targets for about 30 hours (compress if there's less): phone paired by hour 8, second laptop joined by hour 12, alert on the phone by hour 16, push and watchdog by hour 20, live view and a real alert end to end by hour 24, then rehearse.

If time runs short, cut in this order: mDNS discovery (type the address), the app's home Wi-Fi route for caregivers (relay only), background heart-rate delivery (keep Sync now), decryption inside the push (show "New alert" and decrypt in the app), and the "monitoring degraded" notice (keep the dashboard). Keep pairing, the alert path, live view and the watchdog.

## Acceptance tests

[demo] marks the tests the demo depends on.

- [demo] Create a home: Lucas's dashboard shows zero workers, and nothing claims monitoring is active.
- [demo] Pair the caregiver phone, then restart the coordinator laptop: the phone is still paired.
- [demo] Add a second laptop with phone approval: it appears on Lucas's dashboard with 2-second updates.
- A wrong join token is rejected, and the setup page says so. A pairing QR code can't be confirmed twice.
- Nothing on the bridge's network side can confirm a pairing or post an alert.
- [demo] An alert reaches a locked phone on cellular within 10 seconds and the notification names what happened, while the DynamoDB table and the logs hold only ciphertext.
- [demo] With Ollama stopped, a staged fall still produces an alert.
- [demo] Cut the coordinator laptop's internet: "hub offline" arrives; on reconnect, "back online" and the queued alerts arrive.
- Close the camera laptop: "monitoring degraded" arrives.
- [demo] Live view over cellular with TURN forced starts within 10 seconds, shows the notice on the camera laptop, ends on Stop, on Turn off live view and at 5 minutes, and is refused when the resident has it off.
- [demo] A heart-rate reading, a sleep record and a step count from resident mode each reach Layer 4.
- [demo] Camera and mic permissions work through the launch path used on stage.
- [demo] The network test passes on the demo network.
- Anything unavailable (video, Layer 4, a sensor) is shown as unavailable, never as ready.

Record PASS, FAIL, BLOCKED or NOT RUN with the commit, device and evidence. Stubs help development but don't count as integration.

## After the hackathon

Kept from the first draft, but not built tonight:
- Installer: one command with a bundled Node runtime (Node's single-executable builds don't support Intel Macs), packaged Python per platform, download URLs and checksums in the component list, resumable downloads, disk checks and atomic activation.
- Enrollment in Layer 1's bridge: invitations bound to one laptop's key, safe retries, revocation that closes live sessions, and recovery.
- TLS with a pinned certificate between workers and the coordinator.
- Caregiver accounts (Cognito), several caregivers, and a second contact for escalation (with the Layer 4 owner).
- The hub enrolling itself from a certificate request, certificate rotation, and a new home key when a phone is removed.
- Signed commands from phone to hub, and checking the viewer's DTLS fingerprint (sent encrypted by the phone) before the sender answers.
- Per-sensor opt-out that Layer 2's plan understands, and pausing monitoring.
- Starting before login, running with the lid closed, battery health, temperature (Lucas would add it to status), and control of OS updates.
- A one-laptop home, where the coordinator also runs a worker, and an 8 GB profile with no language model (the concept's Tier A). Both need Lucas's agreement.
- Watch live mode (a short workout session for readings every few seconds) and Apple's fall-detection entitlement.
- Live-view audio or talk-back, with the audio-consent notice the concept calls for.

## Questions for Lucas

These come from reading Layer 2 next to the concept. They're questions, not changes.

1. **Demo network.** Should the whole demo cluster run on the hotspot? On venue Wi-Fi, plain WebSocket would carry join tokens and any forwarded video and audio, and llama.cpp's README calls its RPC server "fragile and insecure" and says never to run it on an open network. If we stay on venue Wi-Fi, could fall and sound detection stay on the sensor laptop, as your rule-based plan already does, and Layer 2's step 7 (the split model) be left out?
2. **Daily review of recordings.** The concept discards video and audio after processing. Could the daily report use detection events and their times instead of a day of recordings?
3. **Detection that can't run.** If fall or sound detection can't be placed, or the resident declines the camera or mic, what should the plan and the dashboard JSON say? We'd show the caregiver "monitoring degraded" or "declined" rather than a rejected plan.
4. **The capture job.** When will it land? Does it keep the webcam when fall detection runs on the same laptop? Does the worker restart a Layer 3 job or the capture job when it exits?
5. **Ollama down.** Can you confirm that an unreachable Ollama sends the planner straight to the rule-based plan?

## Open questions

1. **Whole team:** update the concept to match decisions made since it was written: several pooled laptops instead of one, 16 GB workers (from Layer 2), the privacy claim above, and Layer 2's daily review of recordings (Question 2).
2. **Other owners:** Lucas, the Layer 4 owner and the Layer 3 owner answer their asks and the questions above at hour 0.
3. **Team:** list the demo laptops, and pick the demo network after the hour-0 test.

## Glossary

- **Coordinator laptop:** runs Lucas's coordinator and its planner model (through Ollama), Layer 1's bridge with the hub connector, and Layer 4. Layer 2 calls it the "central agent".
- **Worker laptop:** runs Lucas's worker and Layer 3 jobs.
- **Camera laptop, mic laptop:** the worker the external webcam (or mic) is plugged into. Built-in cameras and mics aren't used unless named in `worker.json`.
- **Home** (`home_id`): one coordinator, its workers and the paired phones. The same thing as Layer 2's cluster.
- **Hub:** the coordinator laptop's bridge, acting for the whole home. It holds the home key and its own key pair, pairs phones, and reaches the relay through the hub connector.
- **Bridge:** Layer 1's Node program on every laptop. On the coordinator laptop it also pairs phones and laptops, serves phones on home Wi-Fi (the **LAN gateway**), and encrypts messages for phones and holds the AWS connection (the **hub connector**).
- **Relay:** Layer 1's AWS services that connect phones to the hub. Live video may instead pass through KVS's TURN server, which is separate.
- **Live-view sender:** the kiosk browser window on the camera laptop that streams to a phone and shows the live notice.
- **Home key:** the key the hub uses to encrypt messages for caregiver phones.
- **A phone's own key:** the key each phone shares only with the hub, from pairing.
- **Device credential:** what a paired phone presents to the relay, over HTTPS only.
- **Join token:** what a worker sends in `hello`.

## Instructions for Claude Code

This doc covers two tracks. The iPhone track works in the `debbie-ios` folder from its own kickoff brief, which points back here. For the laptop and cloud track:

Read this doc and Lucas's `docs/layer2-device-management.md` (branch `layer-2`). Build only Layer 1, in the order of "Build order (hackathon)", and nothing listed under "After the hackathon". Use clearly labelled stubs for Lucas's programs and for Layer 4 until their code exists, then switch to the real thing. Match "Phone ↔ hub messages" exactly, and pass the iPhone track's test vectors. Never write to another layer's directories or branches. Keep secrets out of the repo and the logs: AWS credentials, the APNs key, join tokens, device credentials and the home key. Run the [demo] acceptance tests and record the results.

Code layout (can change once, together, before coding):
- `layer1/bridge`: Node/TypeScript setup page, launcher, pairing, hub connector, LAN gateway and the live-view sender page
- `layer1/cloud`: the CDK app, the Lambdas and the provisioning script
- `layer1/contracts`: the shared example files and test vectors from "Handoff to Layer 2", "Handoff to Layer 4" and "Phone ↔ hub messages"
- `layer1/tests`
- The iPhone app lives in its own `debbie-ios` project, with its notification extension and live viewer. Layer 4 adds its screens there through pull requests.

## References

- Layer 2 draft: `docs/layer2-device-management.md`, branch `layer-2`, commit `6d74cc4`
- The team's concept and roadmap ("Local AI Home Caregiver") and layer notes, shared outside the repo
- Node single-executable applications: https://nodejs.org/api/single-executable-applications.html
- llama.cpp RPC: https://github.com/ggml-org/llama.cpp/blob/master/tools/rpc/README.md
- AWS IoT protocols and ports: https://docs.aws.amazon.com/iot/latest/developerguide/protocols.html
- AWS IoT publish and subscribe policies: https://docs.aws.amazon.com/iot/latest/developerguide/pub-sub-policy.html
- KVS WebRTC, how it works: https://docs.aws.amazon.com/kinesisvideostreams-webrtc-dg/latest/devguide/kvswebrtc-how-it-works.html
- KVS WebRTC SDKs: https://docs.aws.amazon.com/kinesisvideostreams-webrtc-dg/latest/devguide/webrtc-sdks.html
- KVS WebRTC limits: https://docs.aws.amazon.com/kinesisvideostreams-webrtc-dg/latest/devguide/kvswebrtc-limits.html
- KVS GetIceServerConfig: https://docs.aws.amazon.com/kinesisvideostreams/latest/dg/API_signaling_GetIceServerConfig.html
- KVS WebRTC JavaScript SDK: https://github.com/awslabs/amazon-kinesis-video-streams-webrtc-sdk-js
- KVS pricing: https://aws.amazon.com/kinesis/video-streams/pricing/
- SNS and APNs: https://docs.aws.amazon.com/sns/latest/dg/sns-apple-authentication-methods.html
- SNS message attributes (APNs collapse ID): https://docs.aws.amazon.com/sns/latest/dg/sns-message-attributes.html
- Modifying notifications in an extension: https://developer.apple.com/documentation/usernotifications/modifying-content-in-newly-delivered-notifications
- APNs payloads: https://developer.apple.com/documentation/usernotifications/generating-a-remote-notification
- Local network privacy (TN3179): https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy
- API Gateway HTTP API quotas (30-second limit): https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-quotas.html
