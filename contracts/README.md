# Contracts between layers

Each file here is an example of something two layers both depend on. The file is the truth; code follows it. Any layer may change a file through its own `ALL:` pull request, merged before the code that uses the change (see `CLAUDE.md`, section 9); no other owner's approval is needed. Every file carries `schema_version`; a change that existing code cannot read raises it.

## Layer 1 and Layer 2

Agreed Nov 14 from Layer 1's asks L1 to L5, L7 and L8. Layer 1 writes the config files; Layer 2's coordinator and worker read them.

| File | Written by | Read by | What it is |
|---|---|---|---|
| `coordinator.json` | Layer 1 | Layer 2 coordinator | The coordinator's configuration |
| `worker.json` | Layer 1 | Layer 2 worker, Layer 3 capture | A worker's configuration |
| `accepted-workers.json` | Layer 1 | Layer 2 coordinator | Hashes of the join tokens the coordinator accepts |
| `worker-status.json` | Layer 2 worker | Layer 1 bridge | Whether the worker is connected, rejected or disconnected |
| `check-output.json` | Layer 2 `check` command | Layer 1 bridge | What a laptop is missing, printed by `check --config <file> --json` |
| `api-state.json` | Layer 2 coordinator, at `GET /api/state` on `dashboard_port` | Layer 1 hub connector | Every laptop seen since the coordinator started (with `last_status_at`, so readers can tell which went quiet), running jobs, dropped work |
| `hello.json` | Layer 2 worker | Layer 2 coordinator | First message on a worker's connection. Layer 1 depends only on the token being its credential |
| `welcome-accepted.json`, `welcome-rejected.json` | Layer 2 coordinator | Layer 2 worker | The reply to `hello`. Its outcome reaches Layer 1 through the worker status file |

### Rules that go with these files

- **Paths** in config files are absolute.
- **Token:** 64 lowercase hex characters, in `token_file` with no newline, readable only by the user running the bridge. `token_sha256` is the SHA-256 of those 64 characters, in lowercase hex. The example token in `hello.json` hashes to the example in `accepted-workers.json`. Tokens never appear in logs or on command lines, and neither program logs a whole `hello`.
- **Token check:** the coordinator re-reads `accepted-workers.json` on every `hello` and finds the laptop's `node_id` from the token's hash. On an unknown token it sends `welcome-rejected` and closes the connection.
- **Reconnecting:** a `hello` from a laptop the coordinator already knows replaces that laptop's old connection. A disconnected worker keeps running, writes `disconnected` to its status file, and retries every few seconds, re-reading `coordinator_url` from `worker.json` before each try.
- **Status file `state`:** `connected` (only after an accepting `welcome`), `rejected` or `disconnected`.
- **Sensors:** `camera` and `mic` in `worker.json` name the only devices that may be used, or are `null` when there is none or the resident declined it. Built-in cameras and mics are not used unless named.
- **`check`:** installs nothing. It covers the config file, the token file, the Python version and whether Ollama answers. It does not open the camera or mic: Layer 3, which owns them, provides its own device check for the setup page's "Camera OK" and "Mic OK" (decided Nov 14; replaces that part of Layer 1's ask L1). `ok` is false only when a required item is missing, and then `check` exits with code 4. Ollama and llama.cpp are never required.
- **Start commands** (Layer 1's launcher runs exactly these; `<repo>` is the absolute path of this repository, and `uv` runs them in the Python 3.12 environment from `layer2/uv.lock`):
  - `uv run --project <repo>/layer2 layer2-coordinator --config <coordinator.json>`
  - `uv run --project <repo>/layer2 layer2-worker --config <worker.json>`
  - `uv run --project <repo>/layer2 layer2-worker check --config <worker.json> --json`
- **Exit codes** for the coordinator and worker: 0 stopped normally, 2 bad config, 3 token rejected, 1 anything else. A missing item never makes a program exit.
- **Stop file:** when the file named by `stop_file` appears, the program stops its jobs and exits within 10 seconds.
- **Ollama:** programs use the Ollama server already running at `ollama_url`; they never start their own.
- **Bridge:** the coordinator sends Layer 1's messages for phones to the bridge at `bridge_url` (plain HTTP, 127.0.0.1 only).
- **Transport:** plain WebSocket between workers and the coordinator on the demo network (the phone hotspot).
- **Writing files:** every JSON file is written whole, to a temporary file in the same folder and then renamed over the old one, retried if Windows reports the file busy.
- **Times** are ISO 8601 in UTC and field names for times end in `_at`.
- **Coordinator URL:** `coordinator_url` in `worker.json` is the coordinator's WebSocket URL including its path, `ws://<coordinator address>:<listen_port>/ws`, because the coordinator serves workers only at `/ws`.

## Layers 3 and 4 and Layer 2: jobs

Added Nov 14 from the Layer 2 doc's "Layers 3 and 4 to Layer 2: jobs". Layers 3 and 4 write one description file per job; Layer 2 reads them to plan where each job runs and to start it.

| File | Written by | Read by | What it is |
|---|---|---|---|
| `job.json` | Layer 3 and Layer 4, one per job | Layer 2 coordinator (planning) and worker (starting) | A job's description |

### Rules that go with this file

- **Where:** `<repo>/layer3/jobs/<name>/job.json` and `<repo>/layer4/jobs/<name>/job.json`. `name` equals the folder name: lowercase letters, digits and underscores, starting with a letter, at most 64 characters. Names are unique across both layers.
- **`start_command`:** the program and its arguments, run without a shell, with the job's folder as the working directory. Relative paths in it are relative to that folder.
- **Environment:** Layer 2 adds `LAYER2_JOB` (the job's name), `LAYER2_NODE_ID`, `LAYER2_GATEWAY`, `LAYER2_GATEWAY_TOKEN`, `LAYER2_FRAME_FEED` (the frame feed's address on this laptop) and `LAYER2_WORKER_CONFIG` (the absolute path of this laptop's `worker.json`, which the capture job reads for `camera`, `mic` and `frame_feed_port`). A job reaches Layer 2 only through `layer2.job_client`, which reads them.
- **`kind`:** `always-on` (runs until Layer 2 stops it; restarted if it exits) or `per-item` (fan-out, Layer 2 build step 6).
- **`memory_gb`:** the memory the job needs, for the planner's budget.
- **`sensor`:** `camera`, `mic` or `null`. A job with a sensor runs on a laptop holding it; when no laptop has it (none attached, or the resident declined it), the job is listed under `dropped` in `api-state.json`.
- **Job states** in `api-state.json` `jobs[].state`: `starting`, `running` or `restarting`.
- **Stopping:** Layer 2 terminates a job's process and kills it after 5 seconds, so jobs must not rely on cleanup that takes longer.

## Layer 3 to Layers 4 and 1: the frame feed

Proposed Nov 15 (Layer 2 build step 7's `feed()`; Layer 1's ask T5). How camera frames and mic audio get from Layer 3's capture job to Layer 4's fall model and speech-to-text, and to Layer 1's live view.

| File | Written by | Read by | What it is |
|---|---|---|---|
| `frame-feed.json` | Layer 3 capture job (serves it) | Layer 4 through `layer2.feed()`; Layer 1's live-view sender | The local server's paths and each message's format |

### Rules that go with this file

- **Where:** Layer 3's capture job serves one WebSocket server on `127.0.0.1` at the laptop's `frame_feed_port` from `worker.json` (7460 in the example). It accepts connections from 127.0.0.1 only. `/live` also accepts only the live-view sender page's origin.
- **Same laptop, version 1:** readers run on the laptop holding the camera and mic. Layer 2's plan puts the capture job, the fall model and speech-to-text there. Forwarding to another laptop comes later, inside `layer2.feed()`, without changing Layer 3 or Layer 4.
- **`/live`:** one binary message per frame, the JPEG only (Layer 1's ask T5, unchanged apart from the path).
- **`/camera`:** one binary message per frame: 8 bytes, a big-endian signed integer, `captured_at` in microseconds since 1970-01-01 UTC; then the JPEG, 640 by 480, quality 80.
- **`/mic`:** one binary message per chunk: the same 8-byte `captured_at`, then 0.5 seconds of 16 kHz, one-channel, 16-bit little-endian PCM (16,000 bytes).
- **Timestamps** use the capturing laptop's clock, in UTC (settles CLAUDE.md's undecided item on timestamps for frames and audio). **Audio chunks** are 0.5 seconds (settles the chunk-length item).
- **Never slow capture down:** frames and chunks are encoded only while a client is connected to that path. A client that falls behind skips to the newest frame or chunk; nothing queues.
- **Layer 4 reads only through `layer2.feed("camera")` or `layer2.feed("mic")`,** which yields items with `data` (the JPEG or PCM bytes) and `captured_at` (UTC), reconnecting if the capture job restarts. Layer 4 decodes the JPEG.
- **Watch readings** are not part of this file; they reach Layer 3 through `layer2.receive("watch-data")`.

## Layer 4 to Layer 1: alerts

Added Nov 15 from the field list that the Layer 1, Layer 4 and phone-hub documents already agree on (Layer 1 doc "Handoff to Layer 4", Layer 4 doc, `layer1/contracts/phone-hub.md` §3). This is the alert on the demo path: fall detected, alert on the caregiver's phone.

| File | Written by | Read by | What it is |
|---|---|---|---|
| `alert.json` | Layer 4 | Layer 1 bridge, carried unchanged by Layer 2's coordinator | One alert for the caregivers' phones |

### Rules that go with this file

- **Path:** Layer 4 calls `layer2.to_phone("alerts", alert)`. Layer 2 posts the object unchanged to the bridge at `POST <bridge_url>/v1/alerts`. The bridge answers 2xx once the alert is in its outbox; `to_phone` then returns. Any other answer, or no answer, makes `to_phone` raise `Layer2Error`, and Layer 4 retries with the same `alert_id`. The bridge treats a repeated `alert_id` with the same `update` value as the same alert.
- **`kind`:** `fall`, `help`, `heart_rate` or `monitoring`. The phone shows a generic alert for a kind it does not know.
- **`severity`:** always `urgent` in version 1. Nothing below a threshold is sent.
- **`detected_at`:** when the event happened (for heart rate, the reading's `measured_at`; for monitoring, when the thing stopped), in UTC to whole seconds with `Z`.
- **`title` and `body`:** plain text written by Layer 4, shown on the phone as received. A clock time in `body` uses the local time zone of the laptop that runs Layer 4; every laptop in a home is in the same place, so version 1 adds no time zone field.
- **`update`:** `false` for the template alert, sent at once without waiting on a model. A model's rewrite follows as a second message with the same `alert_id` and `update: true`; only `title` and `body` may differ, and the phone replaces the earlier text.
- **Privacy:** an alert never holds video, audio or a transcript.

## Layer 1 to Layer 3: watch data

Added Nov 15 from the field list that the Layer 1 doc ("Handoff to Layer 4"), `layer1/contracts/phone-hub.md` §3 and the Layer 3 doc already agree on. One batch of watch readings from the resident's phone, on its way to Layer 3's watch data receiver.

| File | Written by | Read by | What it is |
|---|---|---|---|
| `watch-data.json` | Layer 1 bridge | Layer 3's watch data receiver, carried unchanged by Layer 2's coordinator | One batch of heart-rate, sleep and steps readings |

### Rules that go with this file

- **Path:** the bridge posts the object to the coordinator at `POST /v1/watch-data` on `client_port`. The coordinator answers 202 once the worker whose job takes `watch-data` has it, or 503 when no job takes it. Layer 3 gets the same object from `layer2.receive("watch-data")`.
- **On the wire:** `device_id` and the three lists `heart_rate`, `sleep` and `steps`, each of which may be empty, with only the fields in the example on each row. `schema_version` and `type` are optional in version 1: the bridge sends both, and Layer 3 takes a batch with or without them.
- **Times:** `measured_at`, `bedtime_at` and `wake_at` are in UTC and carry their time zone, between 1970-01-02 and 2999-12-31, the range Layer 4 accepts. `night_of` is a `YYYY-MM-DD` date in the same range.
- **Counts:** `bpm` and `asleep_minutes` are numbers and may be decimals; `interruptions` and `steps_today` are whole numbers; none is below 0. Layer 3 passes every count on as a whole number, rounding a decimal to the nearest, halves up, and refuses a `bpm` below 1, because Layer 4 takes a whole number above 0.
- **`measured_at` for steps** is the moment the count was read, so a later count on the same day is a new reading.
- **Repeats:** Layer 3 passes a reading on once. The same kind with the same measured time is a repeat; a sleep record's measured time is its `wake_at`.
- **What Layer 3 refuses:** a reading that breaks a rule above is refused and counted, and the rest of the batch is still read. The bridge already answers the phone 400 for a batch that is malformed as a whole.
- **Names Layer 3 does not read:** it reads only the three lists. `device_id`, `type`, `schema_version`, `msg_id` and `sent_at` are expected and not read; any other top-level name is logged as a warning.
- **What Layer 3 passes on** is `watch-reading.json`, one message per new reading (see below).

## Layer 3 to Layer 4: watch readings

Added Nov 15. One watch reading that Layer 3's watch data receiver has checked and found new, on its way to Layer 4's health check.

| File | Written by | Read by | What it is |
|---|---|---|---|
| `watch-reading.json` | Layer 3's `watch_data` job | Layer 4's `health_check` job, carried unchanged by Layer 2 | One new heart-rate, sleep or steps reading |

### Rules that go with this file

- **Path:** Layer 3 calls `layer2.pass_on("watch-readings", reading)`; Layer 4 gets the same object from `layer2.receive("watch-readings")`. Layer 2 carries it the way it carries the bridge's `watch-data`: the first job to call `receive("watch-readings")` takes that kind. `pass_on` raises `Layer2Error` when no job takes it; Layer 3 logs that and goes on, so a reading can be lost while Layer 4's job is down (`last_received_at` on the next reading shows the gap). `pass_on` is Layer 2's to add; the name is a proposal.
- **One message per reading,** sent in the order Layer 3 read them from the batch. Repeats are already dropped by Layer 3 (see "Layer 1 to Layer 3: watch data", Repeats).
- **Common fields:** `schema_version` 1, `type` `watch_reading`, `kind` (`heart_rate`, `sleep` or `steps`), and `last_received_at`, when Layer 3 last received a new reading of any kind.
- **Fields by `kind`,** only these:
  - `heart_rate`: `measured_at` and `bpm`, a whole number above 0 (the example).
  - `sleep`: `night_of` (`YYYY-MM-DD`), `asleep_minutes`, `bedtime_at`, `wake_at` and `interruptions`, whole numbers not below 0 for the counts.
  - `steps`: `measured_at` and `steps_today`, a whole number not below 0.
- **Times** are ISO 8601 in UTC, written with `Z`, between 1970-01-02 and 2999-12-31. Counts are already whole numbers: Layer 3 rounds them (see "Layer 1 to Layer 3: watch data", Counts).
- **Privacy:** readings are passed on and judged, never sent anywhere else by Layer 3.
