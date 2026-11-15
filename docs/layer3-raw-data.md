# Layer 3: Raw data

**Status: build steps 1, 2, 4 and 5 are built, steps 3 and 6 in part, step 7 not started (Nov 15); see "What is built".** Items under "Decided" come from Lucas's design interviews of Nov 13 and 14 and the Layer 3 owner's decisions of Nov 14 and 15. Items under "Open questions" are not yet agreed.

## What is built

As of Nov 15, on `main`, with the pull request numbers. Layer 3's checks pass on `main` on macOS (format, lint, types and 296 tests), and CI runs them on Windows and macOS for every pull request.

| Build step | State | Pull requests |
|---|---|---|
| 1. Capture opens the webcam and delivers stamped frames to a test reader | Done on a Mac with the real webcam (`python -m layer3.frame_reader --config <worker.json>`). Not run on a Windows laptop; CI runs the tests there with a fake camera | #38 |
| 2. Capture delivers stamped mic audio | Done on a Mac with the webcam's mic (`python -m layer3.audio_reader --config <worker.json>`). Not run on a Windows laptop; CI runs the tests there with a fake mic | #52 |
| 3. Failure handling: report, retry, recover | In part. A camera or mic that fails is reopened every 3 seconds and resumes by itself, and the failure is logged. Not built: reporting "camera down", "mic down" or "declined" to Layer 2. Not run: unplugging the real webcam | #95, #96 |
| 4. Capture runs as a Layer 2 job and feeds Layer 4 through `feed()` | Built. `layer3/jobs/capture/job.json` starts `python -m layer3.capture_job`, which serves `/camera` and `/mic` as `contracts/frame-feed.json` describes. Tested with fake devices; not yet run with the real webcam | #86, #95, #96 |
| 5. Local video feed for Layer 1's live view | Built. The capture job serves `/live`, the JPEG only, to the live-view page's origin. Tested with a fake camera; not yet run with the real webcam | #96 |
| 6. Watch data receiver | In part. `layer3/src/layer3/watch_receiver.py` takes a batch shaped as `contracts/watch-data.json`, removes repeats, refuses malformed readings, and returns each new reading with `last_received_at`. `layer3/jobs/watch_data/job.json` starts `python -m layer3.watch_job`, which takes each batch from `receive("watch-data")`, keeps one receiver for its life, and passes each new reading on with `pass_on("watch-readings", ...)` as `contracts/watch-reading.json`. Tested with fake readings, a stub of Layer 2, and Layer 2's real job client against a stand-in gateway; not yet run under a real coordinator. Not built: passing `last_received_at` on while no reading arrives | #104, #111, #113, #117 |
| 7. Forwarding frames and audio to a model on another laptop | Not started | |

**Device list and device check** for Layer 1's setup page (ask T6), as `contracts/device-list.json` and `contracts/device-check.json` describe: `python -m layer3.capture_job list --json` and `python -m layer3.capture_job check --config <worker.json> --json`. On macOS each device's kind comes from AVFoundation; on Windows only from words in its name, else `unknown`. Run on the demo Mac with the j5 webcam: the list labels `j5 WebCam JVCU100` and `Audio Streaming` external and the MacBook Air's own camera and mic built in, and the check gives Camera OK and Mic OK in about 3 seconds. Not run on Windows; CI runs the tests there with fakes. Layer 1's setup page does not call them yet.

**To see the watch receiver work:** from `layer3/`, run `uv run python stubs/watch_demo.py`. It sends 7 sample readings through the `watch_data` job's receiving and passing on, on a stub of Layer 2 (`layer3/stubs/fake_layer2_client.py`) and passes on 6; the seventh is a repeat.

**Not yet built:**

- Reporting device state (up, down, declined) to Layer 2. Layer 2's job client has no call for a job's state yet.
- Passing `last_received_at` on while no reading arrives. Today it travels only with a new reading.
- Step 7, forwarding to another laptop.

## Summary

Layer 3 collects the raw data and hands it on. It opens the webcam and its built-in mic, receives the watch data that the iPhone app sends, and passes all three to Layer 4. What it passes on is untouched apart from a timestamp and the rounding of watch counts to whole numbers; a watch reading that is malformed or a repeat is not passed on. It runs no AI and makes no decisions.

Data moves one way: every piece of fetched data goes to Layer 3, Layer 3 passes it to Layer 4, Layer 4 computes the decision, and Layer 1 carries the result to the caregiver's iPhone.

## Decided

| Topic | Decision |
|---|---|
| Role | Raw data only. No detection models, no rules, no language model |
| Camera and mic | One j5create USB HD webcam with 360° rotation. Its built-in mic is the only mic, so video and audio always come from the same laptop |
| Camera count | One, fixed. Nothing identifies or switches between cameras |
| Aiming | The camera is pointed by hand at setup and left. Nothing in the system turns it or knows which way it faces |
| Capture job | Layer 3 builds one capture program that opens both the camera and the mic |
| Where capture runs | On the worker laptop the webcam is plugged into. Layer 2's worker program starts and stops it |
| When capture runs | Always, for as long as the worker runs |
| Video format | 640 by 480 at 15 frames per second, as a default setting |
| Audio format | 16 kHz, one channel, as a default setting |
| How raw | Every frame and all audio are passed on exactly as captured, each stamped with the time. Layer 3 does not skip silence or still frames |
| Timestamps | Frames and audio use the capturing laptop's clock, in UTC. Watch readings keep the time the watch measured them |
| Audio chunk length | Half a second |
| Camera or mic failure | The capture job reports the failure to Layer 2, keeps trying to reopen the device every 3 seconds, and resumes by itself |
| Forwarding | When Layer 2's planner puts the fall model or speech-to-text on a different laptop, the capture job forwards the video or audio there through Layer 2 |
| Compression | On the same laptop, frames are handed over as captured. When video is forwarded to another laptop, each frame is sent as a JPEG, because uncompressed video at this size is about 14 MB per second. Audio is sent as captured |
| Video for live view | The capture job also provides the local video feed that Layer 1's live-view sender reads |
| Watch data | Heart rate; last night's sleep (total, bedtime, wake time and interruptions); steps so far today |
| Watch data source | Layer 1's iPhone app reads it from Apple Health and sends it. Layer 3 receives it at home |
| Watch data timing | Readings arrive in bursts when the resident's iPhone is unlocked. That is acceptable |
| Repeated readings | Layer 3 removes them. A repeat is a reading of the same kind with the same measured time; a sleep record's measured time is its wake-up time. Layer 4 never receives the same reading twice while the receiver runs: the receiver remembers the newest 20,000 measured times of each kind and, once it has had to forget some, treats a reading measured at or before the newest time it forgot as passed on already, with a warning. That time is never later than the moment the batch arrived, so readings dated in the future cannot block the readings measured after that. A reading dated later than the moment its batch arrived is the one exception to "never twice": once forgotten, it can pass again. The receiver stores nothing, so after a restart a reading sent again passes once more |
| Watch counts | Heart rate, minutes asleep, interruptions and steps are passed on as whole numbers. A decimal is rounded to the nearest whole number, halves up |
| Malformed watch readings | A reading is refused and counted, with the first few of a batch logged, and never stops the rest of its batch, when a time has no time zone or falls outside 1970-01-02 to 2999-12-31, a count is not a number or is below its minimum (1 for heart rate, 0 for the others), the night is not a date, or the entry is not a JSON object. A kind that is not a list, and a top-level name other than `heart_rate`, `sleep`, `steps`, `device_id`, `type`, `schema_version`, `msg_id` and `sent_at`, are refused the same way |
| Gaps in watch data | Layer 3 always passes on the time a new reading last arrived. A gap is never an alert; Layer 4 shows it in live status |
| Output | Three raw feeds to Layer 4: camera frames, mic audio, and watch readings |
| Storage | None. No video or audio is stored anywhere |
| Sensors the resident declined | A camera or mic declined at setup is not opened |
| Never dropped | Layer 2 treats the capture job as safety work: its plan may never leave it out |
| Language | Python |

## How data flows

```
j5create webcam ──▶ capture job ──┬──▶ camera frames ──▶ Layer 4 fall model
(video + mic)       (on the laptop ├──▶ mic audio ──────▶ Layer 4 speech-to-text
                     it plugs into)└──▶ local video feed ──▶ Layer 1 live-view sender

resident's iPhone ──▶ Layer 1 bridge ──▶ Layer 2 coordinator ──▶ watch data receiver ──▶ watch readings ──▶ Layer 4
(Apple Health)                                                   (removes repeats)
```

## Components

| Component | What it does | Runs on |
|---|---|---|
| Capture job | Opens the camera and mic named in the laptop's config; stamps and hands out frames and audio; reports and recovers from device failures | The laptop holding the webcam |
| Local video feed | Serves the camera frames to Layer 1's live-view sender on the same laptop | The camera laptop |
| Watch data receiver | Takes in the readings the app sends, removes repeats, and passes them on with the time each was measured and the time a new reading last arrived | A worker, placed by Layer 2 |

## When a device fails

| Situation | What Layer 3 does | What the caregiver sees |
|---|---|---|
| The webcam is unplugged, frozen, or blocked by the operating system | Reports "camera down" to Layer 2 in its job state; retries every few seconds; reports "camera up" when it recovers | Layer 4's monitoring check raises "monitoring degraded" after 30 seconds |
| The mic stops or returns only silence at the device level | The same, as "mic down" | The same |
| The resident declined the camera or mic at setup | Does not open it; reports it as "declined", not as a failure | Shown as declined, not as a fault |
| No watch data arrives | Nothing fails. The time of the last reading keeps being passed on | "No heart data since {time}" in live status |

## Contracts with the other layers

Five files in `contracts/` are agreed: `worker.json` (its `camera`, `mic` and `frame_feed_port` fields), `job.json`, `frame-feed.json`, `watch-data.json` and `watch-reading.json`. Layer 3's code follows the first four; nothing in Layer 3 writes `watch-reading.json` yet. Where this section and a contract file differ, the file wins. The rest is still a proposal for each layer's owner to agree.

**Layer 3 to Layer 2.** Each Layer 3 job is a folder with its script and a short description file (name, start command, kind, memory needed, sensor needed), as in the Layer 2 doc. The capture job reads which camera and mic to open from the `camera` and `mic` fields of the laptop's `worker.json`; a `null` field means there is none or the resident declined it. Device state (up, down, declined) is reported in the job's state, which Layer 2 includes in its 2-second status.

**Layer 3 to Layer 4.** Layer 4 receives `camera` and `mic` through Layer 2's `feed(name)` call, wherever its job is running. Watch readings take a different path: Layer 3's `watch_data` job passes each new reading on with `layer2.pass_on("watch-readings", message)`, one `contracts/watch-reading.json` message per reading, and Layer 4 gets it from `layer2.receive("watch-readings")`. A reading Layer 2 cannot pass on is logged and dropped.

| Feed | Each item carries |
|---|---|
| `camera` | one frame, 640 by 480, and `captured_at` |
| `mic` | a short chunk of audio at 16 kHz in one channel, and `captured_at` |
| `watch-readings` | one reading (below), plus `last_received_at`, the time a new reading of any kind last arrived |

Watch readings:

| Kind | Fields |
|---|---|
| `heart_rate` | `measured_at`, `bpm` |
| `sleep` | `night_of`, `asleep_minutes`, `bedtime_at`, `wake_at`, `interruptions` |
| `steps` | `measured_at`, `steps_today` |

**Layer 3 to Layer 1.** The local video feed on the camera laptop. Layer 1's doc proposes it as a WebSocket on `127.0.0.1` port 7460, one JPEG per message, up to 15 frames per second at 640 by 480, encoded only while a client is connected. As built, it is the `/live` path of the capture job's server, on the laptop's `frame_feed_port` (`contracts/frame-feed.json`).

**Layer 1 to Layer 3.** Watch readings from the app, carried by Layer 1's bridge and Layer 2's coordinator. The Layer 1 doc defines this as `POST /v1/watch-data`, with the same fields as the table above. Every time must carry a time zone. The example file is `contracts/watch-data.json`, and a Layer 3 job gets each batch from `layer2.receive("watch-data")`.

**Layer 3 to Layer 1: the setup page.** The capture program's `list` and `check` modes print `contracts/device-list.json` and `contracts/device-check.json` for the Check sensors step. Only the capture program opens the camera and mic (ask T4), and `check` runs before the worker starts.

## Proposed, not yet confirmed

Nothing is waiting here. Timestamps, the audio chunk length, the retry interval and recognising a repeat were settled on Nov 15 (`CLAUDE.md` section 2) and are in the "Decided" table.

## Risks

| Risk | What it would break | Mitigation |
|---|---|---|
| The camera can only be opened by one program at a time | The fall model and live view competing for it | Only the capture job opens it; everything else reads from the capture job |
| Mac and Windows name and open cameras differently, and each asks for permission differently | Capture on one of the two | Test on one Mac and one Windows laptop from step 1 |
| The built-in mic picks up speech poorly across a room | Layer 4's help check | Test at realistic distance early; an external mic would need the "one device" decision revisited |
| Forwarding video to another laptop over Wi-Fi | Fall detection speed | Layer 2's fallback plan keeps the fall model on the camera laptop |
| The camera is bumped or turned away after setup | Fall detection sees the wrong area with no error | Out of scope; the caregiver can notice it in live view |

## Not in scope

- Any detection, rule or language model (Layer 4)
- Reading Apple Health inside the iPhone app (Layer 1)
- Deciding which laptop a model runs on (Layer 2)
- Recording or storing video or audio
- More than one camera, or turning the camera
- Skipping silence or still frames
- A pause switch for monitoring
- Sound detection, which is a stretch goal owned by Layer 4

## Build order

| Step | What | Depends on |
|---|---|---|
| 1 | Capture job opens the webcam on a Mac and on a Windows laptop and delivers stamped frames to a test reader | none |
| 2 | Capture job delivers stamped mic audio | 1 |
| 3 | Failure handling: report, retry, recover (test by unplugging the webcam) | 1 |
| 4 | Capture runs as a Layer 2 job and feeds Layer 4 through `feed()` | Layer 2 step 2 |
| 5 | Local video feed for Layer 1's live view | 1 |
| 6 | Watch data receiver, with repeats removed and the last-received time | Layer 1's app sending readings, Layer 2 step 7 |
| 7 | Forwarding frames and audio to a model on another laptop | Layer 2 step 5 |

## Open questions

1. Whether the default video and audio formats suit the fall model and speech-to-text model, once Layer 4 chooses them.
2. How the j5create webcam and its mic are named on Windows, for the `camera` and `mic` fields in `worker.json`. On the demo Mac the webcam is `j5 WebCam JVCU100` and its mic is `Audio Streaming`.
