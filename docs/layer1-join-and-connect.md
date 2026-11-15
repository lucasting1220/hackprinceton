# Layer 1: Join and connect

**Status: draft for team review. Nothing is built.** This replaces our first Layer 1 draft. It is written against the other layer docs on `main` and the decisions in `docs/coherence-review.md`. "Decided" lists the Layer 1 team's decisions; a row tagged with an ask also needs that owner's agreement. The asks and the handoff sections are proposals: names, fields and ports can change once, together, at hour 0. "Open questions" are not settled.

**Corrected by Lucas, Nov 14,** to match the cross-layer decisions in `docs/coherence-review.md`. This doc is the reference for joining, connecting, the relay and the iPhone app. Layer 1 makes no decisions about care or monitoring: it connects devices and delivers what Layer 4 sends. How the other layers work is defined in their own docs, not here.

**Changed Nov 14: Vultr replaces AWS.** The relay is now one server the team runs on Vultr, with no AWS services. The hub now reaches the relay with a hub credential instead of a device certificate; nothing else in this doc changed with that switch.

## Summary

Layer 1 turns a few spare laptops and the family's iPhones into one paired home that a caregiver can reach from anywhere.

- Each laptop gets a setup page. The first laptop creates the home and becomes the coordinator laptop (Layer 2's "central agent"). Each extra laptop joins as a worker once a caregiver approves it by scanning a QR code.
- Layer 1 starts Lucas's coordinator and worker programs. It hands each worker the coordinator's address and a join token: the "address and a credential" in Layer 2's handoff.
- Layer 1 builds the whole iPhone app, in its own `debbie-ios` project, including the care screens, which show data that Layer 4 supplies. The app pairs with the home by QR code. Its resident mode sends Apple Watch heart rate, sleep and steps from HealthKit to Layer 3.
- Remote access goes through a small relay that the team runs on one Vultr server. The home only makes outgoing connections (to the relay, and to the relay's TURN server during a live view), so there is no VPN app and no router setup. Messages between the home and phones are end-to-end encrypted, so the relay can't read them.
- Once the resident has consented at setup, a caregiver can open a live view of the home camera at any time. Video goes straight from the laptop to the phone, or through the relay's TURN server when it must, encrypted either way.

Output: paired laptops running Layer 2; a caregiver phone that gets alerts anywhere and survives network changes without re-pairing; and a live view on request.

## Who builds what

| Piece | Owner |
|---|---|
| Setup page, launcher, pairing of laptops and phones, join tokens | Layer 1 |
| Hardware check, keep-awake step, sensor check, resident consent screen | Layer 1 |
| Setting up the demo laptops from one component list | Layer 1, with requirement lists from Lucas (ask L9) and the Layer 3 and Layer 4 owners (ask T3) |
| Coordinator and worker programs, planner, jobs, 2-second status, dashboard | Layer 2 (Lucas) |
| Camera and mic capture job, with the frame feed for live view; receiving watch data at home | Layer 3 |
| Detectors: fall model, speech-to-text, help check, heart-rate check | Layer 4 |
| Rule-based alerts, "monitoring degraded", the daily report, answers to questions, live status | Layer 4 |
| iPhone app (`debbie-ios`): pairing, connection, push, live viewer, resident mode, and every screen, including the care screens (alerts, live status, the daily report, the question box) | Layer 1, with the care screens' data from Layer 4 |
| Relay on Vultr: the relay service, its database, push to Apple, offline watchdog, TURN server, server setup and provisioning | Layer 1 |
| Hub connector on the coordinator laptop: relay connection, encryption, outbox, health reports | Layer 1 |
| Live-view sender on the camera laptop | Layer 1, fed by a local frame feed from Layer 3's capture job (ask T5) |

Layer 1 builds no scheduler, cluster heartbeat, care engine or second dashboard, and it decides nothing about care or monitoring. Its setup page links to Lucas's dashboard.

## Decided

| Topic | Decision |
|---|---|
| Laptops | The demo uses several laptops: one coordinator laptop and one or more workers, as in Layer 2. The first laptop set up becomes the coordinator, so start with the laptop that stays plugged in. The external webcam plugs into a worker, the camera laptop: in the demo, a MacBook Air (24 GB). The webcam's built-in mic is the only mic, and macOS lists the two as separate devices with different names (camera `j5 WebCam JVCU100`, mic `Audio Streaming`). The HP (Windows) is planned as a worker with no sensors, so its `camera` and `mic` are `null`, pending its memory check (Layer 2 needs at least 16 GB on a worker) |
| Laptop pairing | Layer 1 gives each worker a join token and writes the accepted tokens to a file the coordinator reads. The worker sends its token in `hello`; Lucas's coordinator only checks it and replies accept or reject (ask L2) |
| Approving a laptop | The new laptop shows a QR code. A paired caregiver scans it in the app and approves |
| Phone pairing | The coordinator laptop shows a single-use QR code that expires after 10 minutes. The person at that laptop confirms a 4-digit code that also shows on the phone. A phone pairs as a caregiver (it gets the home key) or as a resident (heart rate only). A caregiver phone can also turn on resident mode, so one iPhone can play both roles in the demo |
| Caregiver identity | For the demo, the device credential a phone receives when it pairs. The hub vouches for each phone to the relay. Caregiver accounts with a sign-in come after the hackathon |
| Encryption | Messages between the hub and phones are end-to-end encrypted with keys exchanged during pairing (see "Phone ↔ hub messages"). The relay sees only routing data: IDs, roles, times, sizes, which phones belong to a home, and when a live view starts |
| Push | The relay sends pushes straight to Apple's push service (APNs) with the team's APNs key. The push carries the encrypted alert, and the app's notification extension decrypts it on the phone, so the notification says what happened |
| Live video | In the demo. Layer 1 builds the sender: a browser window on the camera laptop that uses the browser's own WebRTC and gets its frames from Layer 3's capture job (ask T5). Video only, no audio. Each session lasts up to 5 minutes, and the caregiver can start another at once |
| Live-view consent | The resident consents once during setup; after that a caregiver can open a live view at any time. The resident can still turn it off: on the coordinator's setup page, on the camera laptop's live notice, or in resident mode. The camera laptop shows a full-screen notice while someone is watching |
| iPhone app | Layer 1 owns the Xcode project, `debbie-ios`, kept outside this repository. Layer 1 builds every screen; Layer 4 supplies the data for the care screens (ask F4). One app, with a caregiver role and a resident mode |
| Watch data | In the demo. Resident mode reads heart rate, last night's sleep (total, bedtime, wake time and interruptions) and steps so far today from HealthKit (synced from the Watch) and sends them to Layer 3 over home Wi-Fi. HealthKit can't be read while the phone is locked, so readings arrive in bursts after an unlock. The app sends everything since its last check, and the resident screen has a "Sync now" button |
| Sound detection | A stretch goal owned by Layer 4. Nothing in Layer 1 depends on it. Phones are not sensors |
| Component list | Layer 1 keeps one list of what each laptop role needs, including Python, Ollama and its models, and llama.cpp. For the demo, laptops are set up by hand from it |
| Languages | Node/TypeScript for the laptop bridge and the relay, Swift for the app |
| Accounts | The team has a paid Apple Developer account, a Vultr account, one iPhone and an Apple Watch |

## Asks

### To Lucas (Layer 2)

Each ask is small and sized to sit next to Layer 2's build steps 1 and 2. "Needed by" counts hours from when the team starts building. If an ask doesn't suit Lucas's code, he names an alternative and we adapt. Lucas's proposed answers are in the Layer 2 doc.

| # | Ask | Why | Needed by |
|---|---|---|---|
| L1 | Entry points that start the coordinator and the worker from a config file, plus a `check` mode (details in "Handoff to Layer 2"). Decided Nov 14 (`contracts/README.md`): `check` covers the config file, the token file, Python and Ollama, and does not open the camera or mic; Layer 3, which owns them, provides the device check behind the setup page's **Camera OK** and **Mic OK** | Layer 1 starts the programs, and the setup page shows what's missing and whether OS permissions work | Hour 10 |
| L2 | The coordinator re-reads `accepted-workers.json` on each `hello`, looks up the token's hash, and replies with a `welcome` that accepts or rejects. Neither program logs the token or whole `hello` messages | Laptop pairing | Hour 10 |
| L3 | The worker writes a small status file: connected, rejected or disconnected, plus anything missing | The setup page shows "Joined" only after acceptance | Hour 10 |
| L4 | When its connection drops, the worker keeps running, writes `disconnected`, and retries every few seconds, re-reading `coordinator_url` from `worker.json` before each try. A `hello` from a laptop the coordinator already knows replaces that laptop's old connection | Switching to the hotspot, or restarting the coordinator, without re-pairing | Hour 10 |
| L5 | The dashboard's data as JSON at a local URL (proposed shape in "Handoff to Layer 2") | The hub connector finds the camera laptop and shows which laptops are connected. It's written in Node, so it can't use the Python client's `status()` | Hour 18 |
| L6 | Moved to Layer 3, which owns the capture job: see ask T5 | | |
| L7 | Could the worker use the Ollama server that Ollama's own app runs at `ollama_url`, rather than starting its own? Two servers on one laptop would compete for the port and memory | One Ollama server per laptop | Hour 10 |
| L8 | Programs never exit because something is missing; they run what they can and report the rest, as Layer 2 already says. Exit codes and a stop file as in "Handoff to Layer 2" | The launcher restarts only real crashes, and Windows gets a clean stop without signals | Hour 10 |
| L9 | A short requirements list: Python version, pip packages, Ollama model tags for the planner and `quick` models, and the llama.cpp build if Layer 2's step 7 stays | Every demo laptop set up the same way | Hour 2 |
| L10 | A local endpoint on 127.0.0.1 at `client_port`, where the bridge hands Lucas's coordinator the requests and watch data arriving from phones, and where the coordinator hands the bridge the messages Layer 4 sends for phones. And a check: Layer 1's bridge also runs on the coordinator laptop. Does that leave room for the planner model and the split-model lender? | Layer 4 runs on workers, so the coordinator carries its messages; and the coordinator laptop mustn't run out of memory | Hour 16 |

We no longer ask Lucas for an enrollment API, phone credentials, an artifact manifest or the video sender. TLS between workers and the coordinator can wait until after the hackathon.

### To Layer 4

| # | Ask |
|---|---|
| F1 | Decided: alerts are rule-based. A fixed rule sends a template alert as soon as it fires, and a language model's rewrite follows as an update to the same alert. An alert never waits on the language model |
| F2 | Decided: Layer 4 runs on worker laptops, not the coordinator laptop, and Layer 1 does not start it. Lucas's coordinator carries every message between the bridge and Layer 4 |
| F3 | Agree the local calls in "Handoff to Layer 4" |
| F4 | Supply the data for the care screens (alerts, live status, the daily report, replies) through the messages in "Handoff to Layer 4". Layer 1 builds the screens |

### To Layer 3

| # | Ask |
|---|---|
| T1 | Join the hour-0 agreement. Lucas's doc also needs your sign-off |
| T2 | Agree the watch data fields in "Handoff to Layer 4" (`POST /v1/watch-data`) |
| T3 | Layers 3 and 4: send a pinned list of Python packages and model files, so every demo laptop is set up the same way |
| T4 | Decided: only the capture job opens the camera and mic. Everything else, including live view, reads from it |
| T5 | On the camera laptop, the capture job serves `ws://127.0.0.1:<frame_feed_port>`: each frame one binary JPEG message, up to 15 per second at 640×480, encoded only while a client is connected, accepting only the sender page's origin. Needed by hour 20, for live view without a second program fighting over the webcam |

## Parts

```
Caregiver iPhone ◀──── push ─────┐
     │ HTTPS                      │
     ▼                            │
┌──────────── Relay on Vultr (Layer 1) ────┐
│ relay service · SQLite · push to Apple   │
│ offline watchdog · TURN server           │
└──────────────────▲───────────────────────┘
                   │ one outgoing connection
┌──────────── COORDINATOR LAPTOP ──────────┐
│ Layer 1 bridge: setup, pairing, launcher,│◀── Resident mode:
│   hub connector, LAN gateway             │    watch data over
│ Layer 2 coordinator and planner (Lucas)  │    home Wi-Fi
│ Ollama (planner model) · event log       │
└──────────────────┬───────────────────────┘
                   │ Layer 2 control (Lucas) and bridge link (Layer 1)
┌──────────── WORKER LAPTOPS ──────────────┐
│ Layer 2 worker (Lucas)                   │
│ Layer 3 capture · Layer 4 jobs · Ollama  │──▶ live video to the caregiver
│ Layer 1 bridge: setup, launcher,         │    iPhone, direct or via TURN
│   live-view sender (camera laptop only)  │
└──────────────────────────────────────────┘
```

| Process | Built by | Started by | Runs on |
|---|---|---|---|
| Layer 1 bridge | Layer 1 | The person setting up, from Terminal (later, at login, except on the camera laptop, which always starts it from Terminal.app) | Every laptop |
| Coordinator program | Lucas | Layer 1 launcher, which restarts it after a crash | Coordinator laptop |
| Worker program | Lucas | Layer 1 launcher, which restarts it after a crash | Each worker laptop |
| Capture job, with the frame feed (ask T5) | Layer 3 | Lucas's worker | The camera laptop |
| Layer 4 jobs: fall model, speech-to-text, rules | Layer 4 | Lucas's worker | Wherever the planner places them |
| Ollama server | Ollama, installed by Layer 1 | Ollama's own app, at login | Every laptop that runs a model |
| Planner and worker models | Lucas | Lucas's programs, through Ollama | Coordinator and worker laptops |
| llama.cpp split-model parts | Lucas | Lucas's programs | See "Questions for Lucas" |
| Live-view sender | Layer 1 | Layer 1 bridge, only during a live view | The camera laptop |

Each process has one supervisor: Layer 1 restarts what it starts, and Lucas restarts what he starts (his worker restarts a job that exits).

### Ports (proposed)

| Port | What listens | Reachable from |
|---|---|---|
| 7443 | Lucas's coordinator: worker control and media | The local network |
| 7450 | Lucas's dashboard, with its JSON at `/api/state` (ask L5) | Lucas decides; Layer 1 reads the JSON from 127.0.0.1 |
| 7451 | Lucas's coordinator: local calls from the bridge (ask L10) | 127.0.0.1 only |
| 7460 | Layer 3's frame feed on the camera laptop (ask T5) | 127.0.0.1 only |
| 7470 | Layer 1 bridge, local side: the setup page, the Confirm button, and the messages for phones that the coordinator hands over | 127.0.0.1 only |
| 7480 | Layer 1 bridge, network side: phone pairing requests, the LAN gateway, laptop join requests, bridge links | The local network |
| 11434 | Ollama | 127.0.0.1 only |

Nothing on the network side can confirm a pairing or post an alert. Those happen only on 127.0.0.1, so someone else on the venue Wi-Fi can't pair a phone or fake an alert.

**Discovery.** The coordinator's bridge advertises its network side by mDNS (Bonjour) as `_debbie._tcp` on port 7480, with the first 8 characters of the hub's public key (base64url) in its TXT record, so phones and laptops can tell homes apart.

## Setting up a home

### Create a home (first laptop)
1. Run the setup command from Terminal (see "Network permissions"). The setup page opens in the browser. Choose **Create a home**.
2. **Check this laptop**: CPU, memory, disk, OS, camera and mic. This laptop coordinates, so a camera or mic on it won't be used.
3. **Keep this laptop awake**: the person approves, and the bridge keeps the laptop and its screen awake while it runs (`caffeinate -dis -w <bridge pid>` on macOS; on Windows, screen and sleep set to Never when plugged in). Lids stay open during the demo.
4. The bridge creates the home ID, the home key and its own key pair, and shows the home ID. Remote access shows as "not set up" until the team runs the provisioning command on the relay server with that home ID (build step 5), which saves a hub credential on the coordinator laptop; the bridge picks it up the next time it starts.
5. It writes `coordinator.json` and an empty `accepted-workers.json`, and starts Lucas's coordinator.
6. **Pair the caregiver's phone** (below). Pair the resident's iPhone the same way, choosing Resident, or, if the team has one iPhone, turn on resident mode on the caregiver's phone.
7. **Resident consent**: the resident agrees to each sensor (camera, mic, watch data) and, once, gives or withholds consent to live view. A "no" to the camera or mic leaves that device unconfigured (its `worker.json` field is `null`), and the setup page says what won't run; Layer 2's plan lists its jobs as dropped with the reason `declined`. A "no" to watch data leaves resident mode off.
8. **Home created. Add a laptop.** The page links to Lucas's dashboard, which shows zero workers. Nothing claims monitoring is active yet.

### Pair a phone
1. The coordinator's setup page shows a pairing QR code (format in "Phone ↔ hub messages"): the bridge's network addresses, the hub's public key and a one-time secret. It expires after 10 minutes and is used up once the pairing is confirmed.
2. The app asks for Local Network access first. It then scans the code, makes its own key pair, and sends its public key, a name (for example "Caregiver's iPhone") and its role, with a proof that it saw the QR code.
3. The laptop and the phone show the same 4-digit code, and the person at the laptop clicks **Confirm**. Only someone at the coordinator laptop can confirm.
4. The bridge sends back, encrypted with the phone's own key: the home ID, a device ID and device credential, the relay's address and, for caregivers, the home key.
5. The hub tells the relay about the new phone (device ID, role and a hash of its credential) over its own relay connection. From then on, the relay accepts that phone. A phone paired before the hub has a relay connection (before build step 5, or while the hub is offline) is registered when the hub next connects: on every connection, the hub sends the relay its full list of paired phones.
6. The phone keeps its keys and credential in a Keychain access group shared with its notification extension, readable after the first unlock, so the extension can decrypt alerts while the phone is locked.

### Add a laptop
1. On the new laptop, run the setup command and choose **Join a home**. Then **Check this laptop** (Layer 2 needs at least 16 GB on a worker) and **Keep this laptop awake**.
2. The bridge finds the coordinator's bridge on the local network by mDNS. If that fails, the person types the address shown on the coordinator's setup page.
3. It sends a join request (the laptop's name and public key) to the coordinator's bridge and shows an **Add this laptop** QR code.
4. A caregiver taps **Add a laptop** in the app, scans the code and approves. The approval goes to the coordinator's bridge over home Wi-Fi, or through the relay when the phone isn't on the home network.
5. The coordinator's bridge gives the laptop a node ID and a join token, encrypted to its key. It adds the token's hash to `accepted-workers.json` before sending the token.
6. **Check sensors**: the person picks the camera and the mic from the device names Layer 3's device list reports, or picks **No sensors on this laptop** (the HP). The pickers offer only external devices: never a built-in camera or mic (the demo MacBook Air's `MacBook Air Camera` and `MacBook Air Microphone`, for example), a Continuity Camera iPhone, or a virtual device, and they never preselect one. The camera and the mic are picked separately and never assumed to match, because they are separate devices with different names (on the demo camera laptop, `j5 WebCam JVCU100` and `Audio Streaming`); each is identified by its name, never by an index or the camera's Unique ID. The bridge then runs Layer 3's device check through the same launch path the demo uses, and the page shows **Camera OK** and **Mic OK**, or names the setting to change.
7. The bridge writes `worker.json` and the token file, deletes any old status and stop files, and starts Lucas's worker. It shows **Joined** only when the worker's status file says the coordinator accepted it.
8. The bridge keeps a link to the coordinator's bridge, signed in with its join token, used to start and stop live view and to report setup progress.

### Network permissions
- **iPhone**: the app declares local-network use and the Bonjour service it looks for, and allows plain HTTP to local addresses (from iOS 17, App Transport Security blocks connections to IP addresses otherwise). It brings up the Local Network prompt before pairing, and retries, because iOS may refuse the first request while that prompt is showing.
- **Mac**: start the bridge from Terminal.app or over SSH; on the camera laptop, only from Terminal.app, since an SSH session has no app to hold the camera and mic permission. From macOS 15, programs started from other apps (VS Code, Cursor, iTerm) can't reach the local network or use mDNS until that app is allowed under Privacy & Security → Local Network.
- **Windows coordinator**: allow Node and Python through the firewall and set the network to Private, or the other laptops can't reach it.
- **Camera and mic**: on macOS the permission belongs to the app that started the bridge, so start it the same way every time.

### Screens
- **Laptop:** Welcome (Create or Join) · Check this laptop · Keep awake · Pairing QR and code, with Confirm · Resident consent · Find the home · Add-this-laptop QR · Check sensors · Starting · Joined or Home created, with a link to Lucas's dashboard · Paired phones (remove) · Live view on/off · the live notice on the camera laptop. Troubleshooting names what's missing, a wrong network, a denied permission or a rejected token, and never shows secrets.
- **Phone:** Scan to pair · Show code (confirm on the laptop) · Home: the connection header (relay reachable, and the hub's last contact), the Live view button, the Check now button (a silent re-check that refreshes live status), and the care screens built from Layer 4's data: alerts (read-only, with no acknowledge or false-alarm action), live status, the daily report and the question box · Add a laptop · Resident mode (permission for heart rate, sleep and steps; last reading; Sync now; live view on/off) · Settings (unpair).

## Handoff to Layer 2

These are proposals for Lucas: he can rename any field or change any behaviour, and we'll match it. Layer 1 writes the config files and Lucas's programs read them. All paths are absolute. Once agreed, example files go in the top-level `contracts/` folder.

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
  "camera": "j5create USB HD Webcam",
  "mic": "j5create USB HD Webcam",
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
- **Sensors.** `camera` and `mic` name the only devices the worker may report and capture (a device name exactly as Layer 3's device list reports it, never an index), or are `null` when there is none or the resident declined it. Built-in cameras and mics aren't used unless named.
- **`python`** is the interpreter Lucas's worker uses for Layer 3 and Layer 4 jobs.
- **Files.** Every JSON file is written whole: to a temporary file, then renamed (retried if Windows reports the file busy). Times are ISO 8601 in UTC.
- **Worker status file:** `{"node_id": "…", "state": "connected", "missing": [], "updated_at": "…"}`, where `state` is `connected`, `rejected` or `disconnected`, and `missing` items look like `check`'s.
- **`check --config worker.json --json`** prints `{"ok": true, "missing": [{"id": "ollama", "reason": "not reachable at http://127.0.0.1:11434", "required": false}]}` and installs nothing. `ok` is false only when a required item is missing, and then `check` exits with 4. Ollama and llama.cpp are not required for fall detection.
- **Exit codes** for the coordinator and worker: 0 stopped normally, 2 bad config, 3 token rejected, 1 anything else. Missing items never stop them (ask L8). The launcher restarts a program only after code 1, and shows the reason for 2 and 3.
- **Stop file.** When it appears, the program stops its jobs and exits within 10 seconds; after that, Layer 1 ends the process.
- **Dashboard JSON** (ask L5): `GET http://127.0.0.1:7450/api/state` returns `{"updated_at": "…", "laptops": [{"node_id": "…", "display_name": "…", "last_status_at": "…", "sensors": ["camera", "mic"], "missing": []}], "jobs": [{"job": "fall_model", "node_id": "…", "state": "running"}], "dropped": [{"work": "…", "reason": "…"}]}`, using Layer 2's job names and its `dropped` list. The hub connector uses it only to find the camera laptop and to show which laptops are connected; it makes no judgement about monitoring.
- **Transport.** Workers reach the coordinator over plain WebSocket on the demo network (see Question 1 about which network). TLS with a pinned certificate is for after the hackathon, at Lucas's discretion.
- **Network changes.** If the coordinator's address changes, for example after switching to the hotspot, the worker bridges find it again by mDNS and rewrite `coordinator_url`, and the worker picks it up on its next retry (ask L4). If mDNS fails, the person types the new address on the worker's setup page. The laptop keeps its node ID and token.

## Handoff to Layer 4

These are proposals for Lucas, as owner of Layers 3 and 4. Layer 4 runs on worker laptops, so the bridge never calls it directly. Lucas's coordinator, on the same laptop as the bridge, carries every message: the bridge posts to the coordinator on `127.0.0.1:7451`, and the coordinator posts to the bridge on `127.0.0.1:7470`. Every call is JSON over HTTP on the coordinator laptop.

| From → to | Call | Fields |
|---|---|---|
| Layer 4 → Layer 1 | `POST /v1/alerts` | `alert_id, kind, severity, detected_at, title, body, update` |
| Layer 4 → Layer 1 | `POST /v1/replies` | `request_id, title, body` |
| Layer 4 → Layer 1 | `POST /v1/status` | live status: current activity; latest heart rate, sleep and steps, each with its age; `no_heart_data` |
| Layer 4 → Layer 1 | `POST /v1/reports` | `report_id, date, title, body` (the daily report) |
| Layer 1 → Layer 4 | `POST /v1/requests` | `request_id, device_id, kind, text` |
| Layer 1 → Layer 3 | `POST /v1/watch-data` | `device_id, heart_rate: [{measured_at, bpm}], sleep: [{night_of, asleep_minutes, bedtime_at, wake_at, interruptions}], steps: [{measured_at, steps_today}]` |

- Request `kind` is `ask` (a question in plain words, which Layer 4 answers) or `check_now` (a silent re-check: Layer 4 sends a fresh live status at once; nothing is spoken in the home).
- Layer 4 sends a template alert the moment a rule fires. When the language model's rewrite is ready, Layer 4 sends it with the same `alert_id` and `update: true`, and the phone replaces the first notification.
- "Monitoring degraded" is an ordinary alert that Layer 4 decides to send. The bridge delivers it and adds nothing.
- Nothing about an alert comes back from the phone: there are no acknowledgments and no false-alarm marks.
- The hub connector encrypts each message once with the home key and keeps it in an outbox on disk until the relay confirms it (the relay's acknowledgment message), resending after an outage. The LAN gateway serves the same encrypted message to phones on home Wi-Fi.
- Requests are asynchronous: the phone gets an ID at once and fetches the reply later, because a reply (for example an answer from the deep model) can take longer than a phone request should wait.

## Phone ↔ hub messages (proposed)

Both tracks build to this, and any change is agreed by both. The iPhone track drafts the remaining details and the test vectors in `debbie-ios/docs/CONTRACTS.md`. Once the laptop track's code passes the same vectors, they're copied to `layer1/contracts/phone-hub.md`.

- **QR code**: JSON `{v: 1, addrs, hub_pub, secret, exp}`. `addrs` lists every IPv4 address and port of the bridge's network side; `hub_pub` is the hub's 32-byte X25519 public key and `secret` 16 random bytes, both base64url; `exp` is a Unix time.
- **Pairing request**: `{v, phone_pub, name, role, proof}`. `role` is `caregiver` or `resident`, and `proof = HMAC-SHA256(secret, phone_pub ‖ role ‖ 0x00 ‖ name in UTF-8)`. The same phone key may resend its request until the person confirms.
- **Keys**: `shared = X25519(phone, hub)`. The phone's own key is `HKDF-SHA256(shared, salt = secret, info = "debbie/v1/phone-key", 32 bytes)`. The 4-digit code is the first 4 bytes of `HKDF-SHA256(shared, salt = secret, info = "debbie/v1/code", 4 bytes)` read as a big-endian number, mod 10000, zero-padded.
- **Envelope** for every encrypted message: `{v: 1, kid, n, c}`, base64url. `kid` is `home` for the home key, the device ID for a phone's own key, or `pair` during pairing. `n` is a random 12-byte nonce, and `c` is the ChaCha20-Poly1305 ciphertext followed by its 16-byte tag. The associated data is `debbie/v1/{home_id}/{kid}/{type}`, or `debbie/v1/pair` during pairing.
- **Freshness**: every plaintext carries `msg_id` and `sent_at`. Receivers drop repeated `msg_id`s and any command older than 30 seconds.
- **Credentials**: a phone shows its device credential only to the relay, over HTTPS. On the LAN gateway it proves who it is by encrypting each request with its own key, so the credential never crosses the local network.
- **Library notes**: CryptoKit's combined sealed box is nonce, ciphertext, tag; split it to fill `n` and `c`. Node imports a raw X25519 public key most reliably as a JWK, `{kty: "OKP", crv: "X25519", x}`.

## Remote connection (Vultr)

The relay is one Vultr Cloud Compute server that the team runs. The hub keeps one outgoing connection to it. Nothing in the home accepts connections from the internet, and laptop-to-laptop traffic stays on the local network.

| Part | Job |
|---|---|
| Relay service (Node/TypeScript) | The hub's connection: one WebSocket over TLS on port 443, opened by the hub and signed in with the hub's credential. The relay takes the `home_id` from that credential, never from a message. Commands are not queued for an offline hub. Also the phone's API (send a request, fetch messages, start or stop a live view, register for push), where each call carries the phone's device credential, and live-view signaling |
| SQLite, on the server | Phones per home, encrypted messages (kept 7 days), the hub's last contact time, live-view sessions. The relay drops duplicate message IDs |
| Push to Apple | The relay sends to Apple's push service directly over HTTP/2 with the team's APNs key: the sandbox endpoint for builds run from Xcode, the production endpoint for TestFlight builds. Phones register their push token together with which of the two it belongs to |
| Offline watchdog | A timer inside the relay service, once a minute |
| TURN server (coturn) | Relays live video when the laptop and the phone can't connect directly. It runs on the same server and hands out credentials that last 5 minutes, signed with a secret it shares with the relay service |
| HTTPS certificate | A free Let's Encrypt certificate for the relay's domain name (to buy; see "Prerequisites"), renewed automatically by a reverse proxy such as Caddy in front of the relay service |
| Vultr firewall | Opens only 443 (HTTPS and the hub's WebSocket), the TURN ports, and SSH from the team's own addresses |

For the demo, the team runs a provisioning command on the relay server once it is set up (build step 5). Given the home ID that Create a home shows, it creates the home's record and a hub credential, and saves the credential file on the coordinator laptop, where the bridge picks it up on its next start. The Vultr API key never goes on a home laptop or a phone, or into the repo. After the hackathon, the hub enrolls itself with a request approved from a paired caregiver's phone.

Every command carries its send time, and the hub ignores commands older than 30 seconds.

**One server is a single point of failure.** If the Vultr server is down, alerts wait in the hub's outbox and the "hub offline" warning cannot be sent. That is accepted for the demo.

### Push
- Every alert push carries `aps.alert` with placeholder text ("New alert from Debbie"), `mutable-content: 1`, the time-sensitive interruption level (with the Time Sensitive Notifications capability), and the encrypted alert as a custom key. The app's notification extension decrypts it and replaces the text.
- APNs payloads are capped at 4 KB, so the encrypted alert stays under about 2 KB; the app fetches anything longer when it's opened.
- An update (`update: true`) is sent with the alert's ID as its collapse ID (the `apns-collapse-id` header), so it replaces the first notification instead of adding a second.
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
- The hub connector sends an encrypted heartbeat every minute, so the relay knows the home is reachable. The heartbeat carries no judgement about monitoring.
- Whether monitoring is degraded (a camera, mic, laptop or detector has stopped) is decided by Layer 4, which sends it as an alert like any other. The bridge only delivers it.
- The watchdog runs every minute. When a hub has been silent for 3 minutes, it pushes "hub offline", and "back online" when it returns. This is a connection check, and nothing in the home could send it. For the demo, use a 20-second heartbeat and a 1-minute limit so the push arrives within about 2 minutes; rehearse it or record it.

## Live view

1. The caregiver taps **Live view**. The app sends a live-view request encrypted with its own key (a request ID, the time and a fresh viewer client ID) and gets a session ID back at once.
2. The relay checks that this phone is a caregiver for the home. It creates the session, makes TURN credentials that last 5 minutes, and sends "start live view" to the hub with the session ID, the TURN and STUN addresses with those credentials, and the phone's encrypted request, unopened.
3. The hub connector opens the request, which must decrypt with a paired caregiver's key, be under 30 seconds old and not have been seen before. Then it checks the resident's consent. If the resident has not consented, or has turned live view off, it replies "denied" and the app says so. If it's on, it tells the camera laptop's bridge, over the bridge link, to open the sender and which viewer client ID it may answer.
4. The sender is one Chrome or Edge window that the bridge starts with its own profile, in kiosk mode (Edge on Windows, where every laptop has it). The window is the full-screen **Live: your caregiver is watching** notice, with a **Turn off live view** button, and it holds the canvas being streamed, shown as a preview. It reads frames from Layer 3's frame feed (ask T5), draws them on the canvas, and streams the canvas with the browser's own WebRTC, exchanging connection details with the phone through the relay's signaling WebSocket for that session. Nothing may cover this window, because Chrome stops streaming a hidden canvas.
5. When the sender is connected to signaling, the hub replies "ready", and the phone joins the same session's signaling with its session ID and receives the TURN and STUN addresses. Video goes straight from laptop to phone when the networks allow, and otherwise through the TURN server, encrypted either way.
6. The session ends after 5 minutes, when the caregiver taps **Stop**, or when the resident turns live view off. The bridge closes the sender window's process at once. **Keep watching** starts a new session.

Notes:
- Video only: no room audio and no talk-back.
- The coordinator laptop never encodes video.
- The sender is a browser window because browsers have WebRTC built in on both Mac and Windows, with nothing to install. The frame feed is a WebSocket rather than an image URL so the browser can stream the canvas without cross-origin errors.
- The app's viewer uses Google's WebRTC library built for iOS. Google no longer publishes iOS builds, so the app uses a maintained community build. It talks to the relay's signaling WebSocket, so phones hold no server keys.
- The 5-minute session is kept so a forgotten live view doesn't stream all day. It is a setting, not a limit of the server.
- The riskiest part, video through the TURN server to an iPhone on cellular, is tested first, in build step 0b.
- Cost: Vultr bills the server by the hour, and TURN traffic counts toward its bandwidth allowance. Measure the real traffic per live view during the hackathon before quoting a cost in the pitch.

## Privacy claim

Suggested pitch wording, for now: "AI monitoring runs inside the home, and video and audio are never uploaded for analysis. Nothing is recorded. Once the resident has consented, a caregiver can open an encrypted live view at any time, and the laptop shows when someone is watching. Alerts are end-to-end encrypted, so our relay can't read them."

No video or audio is stored: the daily report is written from the event log. This replaces the concept's "video and audio never leave the house", and the concept should be updated to match (Open question 1).

## When things fail

| Failure | What happens |
|---|---|
| Phone moves from Wi-Fi to cellular | The app switches from the LAN gateway to the relay. No re-pairing |
| Home internet drops | Monitoring carries on locally. Alerts wait in the outbox and arrive on reconnect. The watchdog pushes "hub offline" |
| Camera laptop sleeps or crashes | Layer 4 raises "monitoring degraded" and the bridge delivers it |
| Coordinator laptop restarts | Starting the bridge again relaunches Lucas's coordinator. Workers reconnect by themselves (ask L4). Pairings, tokens and keys are files and survive |
| Network change (venue Wi-Fi to hotspot) | Worker bridges find the coordinator's bridge again by mDNS, or the person types its new address on the worker's setup page; nothing is re-paired. Caregiver phones use the relay meanwhile. Watch data pauses until the resident's phone finds the bridge again by Bonjour |
| Relay unreachable from the phone | The app shows "can't reach home" with the last contact time. It never shows an all-clear it can't confirm |
| Live view stopped, expired or turned off | The sender window closes immediately |
| A phone is unpaired (in its Settings, or removed on the coordinator's setup page) | The hub tells the relay, which rejects that phone's credential from then on |

Target: reconnect within 30 seconds once both ends have a working connection. Record the measured times.

## Prerequisites (check at hour 0)

| Item | State |
|---|---|
| Apple Developer account | Exists. App ID, push capability and APNs key (.p8, with its key ID and team ID) still to create |
| Vultr account | Exists. Check the balance or credits, choose a region near the demo, create the server and its firewall |
| Domain name | To buy. Point a name such as `relay.<domain>` at the Vultr server before build step 5 |
| iPhones | One, paired with the Apple Watch. A second (a teammate's, added as an internal TestFlight tester) would let the caregiver and the resident be separate phones |
| Demo phone settings | Focus and Do Not Disturb off; notifications allowed |
| Chrome or Edge on the camera laptop (the MacBook Air) | To check |
| Demo laptops listed: OS, chip, memory, and which one gets the webcam | Partly done. The MacBook Air (24 GB) gets the webcam. The HP (Windows) is a worker with no sensors; its memory is still to confirm, since Layer 2 needs at least 16 GB on a worker. The coordinator laptop is still to choose |
| Network test on venue Wi-Fi and the hotspot: phone to coordinator laptop, and laptop to laptop | To do, with Lucas |
| Continuity Camera off on every iPhone signed in to the camera laptop's Apple ID, so macOS doesn't offer one as a camera or mic | To do |
| The bridge started from Terminal.app on the camera laptop, the same way every time, because macOS gives the camera and mic permission to the app that started it | To do |

With one iPhone, it pairs as a caregiver and turns on resident mode. Do the watch data step on home Wi-Fi first, then switch the phone to cellular for the alert, "hub offline" and live-view steps.

## Build order (hackathon)

Two tracks run side by side: laptop and cloud (bridge, hub connector, relay, sender), and iPhone (the `debbie-ios` app, built from its own kickoff brief).

| Step | What | Depends on |
|---|---|---|
| 0 | Hour 0–1: agree with Lucas the handoff files and ports, the messages in "Handoff to Layer 4", and the frame feed (asks T1–T5); check prerequisites; run the network test | none |
| 0b | Hours 1–6, the riskiest outside services first: (a) as soon as the app has a build with push enabled, one push to it sent straight to Apple with the team's APNs key, then one decrypted by the notification extension on a locked phone; (b) a minimal WebRTC test page as sender on the camera laptop and as viewer in Safari on the iPhone over cellular, through coturn on the Vultr server with TURN forced. If (a) fails by hour 6, the app fetches alerts while it's open and the push tests are marked BLOCKED. If (b) fails by hour 8, tell the whole team before doing more video work | 0 |
| 1 | Create a home: bridge, setup page, start Lucas's coordinator (a labelled stub until his step 1 lands), dashboard link | 0 |
| 2 | Pair a phone: QR code, matching code, encrypted handover; the app keeps its keys in the shared Keychain | 1 |
| 3 | Add a laptop: join request, approval from the phone, token, Lucas's worker accepted and shown on his dashboard | 2, Layer 2 step 1, asks L1–L4 |
| 4 | Alert on the phone over home Wi-Fi: a stub coordinator hands over an alert as if from Layer 4, the hub connector encrypts it, the LAN gateway serves it, and the app decrypts and shows it | 2 |
| 5 | Relay: the Vultr server, its domain and certificate, the relay service, provisioning the hub, an alert pushed to a locked phone on cellular and decrypted by the notification extension, heartbeat, offline watchdog | 0b, 4 |
| 6 | A real alert end to end: Layer 3 captures a staged fall, Layer 4's fall model and rule fire, the push arrives, with Ollama stopped | 5, Layer 2 steps 2 and 7, Layers 3 and 4 |
| 7 | Live view on cellular: Layer 3's frame feed to the sender window, through the relay's signaling and TURN server, to the app's viewer, with consent, the on-screen notice, the 5-minute limit, Stop and Turn off live view | 0b, 5, ask T5 |
| 8 | Resident watch data (heart rate, sleep, steps): HealthKit to the LAN gateway, then through Lucas's coordinator to Layer 3 | 2, Layer 2 step 7, Layer 3 |
| 9 | Hardware check, keep-awake, sensor check and resident consent screens | 3 |
| 10 | Three full rehearsals and a backup recording | all |

Targets for about 30 hours (compress if there's less): phone paired by hour 8, second laptop joined by hour 12, alert on the phone by hour 16, push and watchdog by hour 20, live view and a real alert end to end by hour 24, then rehearse.

If time runs short, cut in this order: mDNS discovery (type the address), the app's home Wi-Fi route for caregivers (relay only), background watch data delivery (keep Sync now), and decryption inside the push (show "New alert" and decrypt in the app). Keep pairing, the alert path, live view and the watchdog.

## Acceptance tests

[demo] marks the tests the demo depends on.

- [demo] Create a home: Lucas's dashboard shows zero workers, and nothing claims monitoring is active.
- [demo] Pair the caregiver phone, then restart the coordinator laptop: the phone is still paired.
- [demo] Add a second laptop with phone approval: it appears on Lucas's dashboard with 2-second updates.
- A wrong join token is rejected, and the setup page says so. A pairing QR code can't be confirmed twice.
- Nothing on the bridge's network side can confirm a pairing or post an alert.
- [demo] An alert reaches a locked phone on cellular within 10 seconds and the notification names what happened, while the relay's database and logs hold only ciphertext.
- [demo] With Ollama stopped, a staged fall still produces an alert.
- [demo] Cut the coordinator laptop's internet: "hub offline" arrives; on reconnect, "back online" and the queued alerts arrive.
- Close the camera laptop: Layer 4's "monitoring degraded" alert is delivered to the phone.
- [demo] Live view over cellular with TURN forced starts within 10 seconds, shows the notice on the camera laptop, ends on Stop, on Turn off live view and at 5 minutes, and is refused when the resident has not consented or has turned it off.
- [demo] A heart-rate reading, a sleep record and a step count from resident mode each reach Layer 3.
- [demo] Camera and mic permissions work through the launch path used on stage.
- [demo] The network test passes on the demo network.
- Anything unavailable (video, a sensor, the connection to the home) is shown as unavailable, never as ready.

Record PASS, FAIL, BLOCKED or NOT RUN with the commit, device and evidence. Stubs help development but don't count as integration.

## After the hackathon

Kept from the first draft, but not built tonight:
- Installer: one command with a bundled Node runtime (Node's single-executable builds don't support Intel Macs), packaged Python per platform, download URLs and checksums in the component list, resumable downloads, disk checks and atomic activation.
- Enrollment in Layer 1's bridge: invitations bound to one laptop's key, safe retries, revocation that closes live sessions, and recovery.
- TLS with a pinned certificate between workers and the coordinator.
- Caregiver accounts with a sign-in, and several caregivers.
- The hub enrolling itself from a certificate request, certificate rotation, and a new home key when a phone is removed.
- Signed commands from phone to hub, and checking the viewer's DTLS fingerprint (sent encrypted by the phone) before the sender answers.
- Per-sensor opt-out that Layer 2's plan understands, and pausing monitoring.
- Starting before login, running with the lid closed, battery health, temperature (Lucas would add it to status), and control of OS updates.
- A one-laptop home, where the coordinator also runs a worker, and an 8 GB profile with no language model (the concept's Tier A). Both need Lucas's agreement.
- Watch live mode (a short workout session for readings every few seconds) and Apple's fall-detection entitlement.
- Live-view audio or talk-back, with the audio-consent notice the concept calls for.

## Questions for Lucas (answered Nov 14)

| Question | Answer |
|---|---|
| 1. Should the whole demo run on the hotspot? | Yes. It avoids sending tokens and a split model's traffic over an open network |
| 2. Could the daily report use detection events instead of recordings? | Yes, and it is decided: only an event log is kept, and no video or audio is stored |
| 3. What does the plan say when detection can't run or a sensor is declined? | The plan lists the work under `dropped` with a reason, including `declined`, and `/api/state` carries it |
| 4. Who builds the capture job, and what restarts a job that exits? | Layer 3 builds it, and only it opens the webcam. Lucas's worker restarts any job that exits |
| 5. Does an unreachable Ollama send the planner to the rule-based plan? | Yes, at once |

## Open questions

1. **Whole team:** update the concept to match decisions made since it was written: several pooled laptops instead of one, 16 GB workers (from Layer 2), and the privacy claim above.
2. **Lucas:** confirm the proposed answers to asks L1–L10 (in the Layer 2 doc) and the asks to Layers 3 and 4.
3. **Team:** list the demo laptops, and pick the demo network after the hour-0 test.

## Glossary

- **Coordinator laptop:** runs Lucas's coordinator and its planner model (through Ollama), Layer 1's bridge with the hub connector, and the event log. It runs nothing from Layers 3 or 4.
- **Worker laptop:** runs Lucas's worker, Layer 3's capture and Layer 4's jobs.
- **Camera laptop:** the worker the external webcam is plugged into. The webcam's built-in mic is the only mic. Built-in laptop cameras and mics aren't used unless named in `worker.json`.
- **Home** (`home_id`): one coordinator, its workers and the paired phones. The same thing as Layer 2's cluster.
- **Hub:** the coordinator laptop's bridge, acting for the whole home. It holds the home key and its own key pair, pairs phones, and reaches the relay through the hub connector.
- **Bridge:** Layer 1's Node program on every laptop. On the coordinator laptop it also pairs phones and laptops, serves phones on home Wi-Fi (the **LAN gateway**), and encrypts messages for phones and holds the relay connection (the **hub connector**).
- **Relay:** Layer 1's server on Vultr that connects phones to the hub. It also runs the TURN server that live video may pass through.
- **Live-view sender:** the kiosk browser window on the camera laptop that streams to a phone and shows the live notice.
- **Home key:** the key the hub uses to encrypt messages for caregiver phones.
- **A phone's own key:** the key each phone shares only with the hub, from pairing.
- **Device credential:** what a paired phone presents to the relay, over HTTPS only.
- **Join token:** what a worker sends in `hello`.

## Instructions for Claude Code

This doc covers two tracks. The iPhone track works in the `debbie-ios` folder from its own kickoff brief, which points back here. For the laptop and cloud track:

Read `CLAUDE.md` first, then this doc and `docs/layer2-device-management.md`. Build only Layer 1, in the order of "Build order (hackathon)", and nothing listed under "After the hackathon". Use clearly labelled stubs for Lucas's programs until their code exists, then switch to the real thing. Match "Phone ↔ hub messages" exactly, and pass the iPhone track's test vectors. Never write to another layer's directories or branches. Keep secrets out of the repo and the logs: the Vultr API key, the TURN shared secret, the hub credential, the APNs key, join tokens, device credentials and the home key. Run the [demo] acceptance tests and record the results.

Code layout (can change once, together, before coding):
- `layer1/bridge`: Node/TypeScript setup page, launcher, pairing, hub connector, LAN gateway and the live-view sender page
- `layer1/relay`: the relay service, the TURN server and reverse proxy configuration, the server setup steps and the provisioning command
- `layer1/contracts`: the phone-to-hub test vectors from "Phone ↔ hub messages". Example files shared with other layers ("Handoff to Layer 2", "Handoff to Layer 4") go in the top-level `contracts/` folder
- `layer1/tests`
- The iPhone app lives in its own `debbie-ios` project, with its notification extension, live viewer and every screen.

## References

- The other layer docs and `docs/coherence-review.md`, on `main`
- The team's concept and roadmap ("Local AI Home Caregiver") and layer notes, shared outside the repo
- Node single-executable applications: https://nodejs.org/api/single-executable-applications.html
- llama.cpp RPC: https://github.com/ggml-org/llama.cpp/blob/master/tools/rpc/README.md
- Vultr documentation: https://docs.vultr.com/
- coturn: https://github.com/coturn/coturn
- Caddy automatic HTTPS: https://caddyserver.com/docs/automatic-https
- Sending notification requests to APNs: https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns
- Modifying notifications in an extension: https://developer.apple.com/documentation/usernotifications/modifying-content-in-newly-delivered-notifications
- APNs payloads: https://developer.apple.com/documentation/usernotifications/generating-a-remote-notification
- Local network privacy (TN3179): https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy
