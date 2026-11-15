# Layer 4: Care layer

**Status: draft for team review. Being built; `layer4/HANDOFF.md` lists what is on `main`.** This replaces the earlier "care agent" draft. Items under "Decided" come from the design interviews of Nov 13 and 14. Items under "Proposed" and "Open questions" are not yet agreed.

## Summary

Layer 4 turns raw sensor data into what the caregiver sees. It has two tiers. The lower tier runs the detectors: a fall model on video, speech-to-text with a help check on audio, and a heart-rate check on watch data. The upper tier is not an agent and makes no autonomous judgement: it applies fixed rules to the detectors' signals and hands the result to Layer 1, which delivers it to the caregiver's iPhone.

Data moves one way: every piece of fetched data goes to Layer 3, Layer 3 passes it to Layer 4, Layer 4 computes the decision, and Layer 1 carries it to the phone.

## Decided

| Topic | Decision |
|---|---|
| Shape | Two tiers. Lower: detectors. Upper: a simple rules layer, with no agent |
| What triggers an alert | Fixed rules. Any single signal over its threshold sends an urgent alert; signals are not combined |
| Alert text | A fixed template goes out at once. A language model then writes a fuller version that replaces it on the phone |
| Detectors | Layer 4 owns them all: the fall model, speech-to-text, the help check and the health check |
| Help check | Speech-to-text turns mic audio into text; a language model reads the text and reports whether it is a call for help |
| Health data | Heart rate, sleep, and activity and steps, received from Layer 3. Only heart rate can send an urgent alert. Sleep and activity appear in live status and the daily report |
| Sound detection | A stretch goal. Built last, and nothing depends on it |
| Language model uses | The help check, rewriting alert text, the daily report, and answering caregiver questions |
| Model quality | `quick` for the help check and alert rewrites; `deep` for the daily report and caregiver questions |
| Monitoring health | Layer 4 decides when to raise "monitoring degraded" (a camera, mic or detector has stopped). Layer 1 delivers it |
| Levels | Two. Urgent sends a push notification. Everything else goes only to the daily report |
| Daily report | Produced at a set time each evening from the event log, fanned out across laptops by time block |
| Caregiver questions | Answered only from what is happening right now |
| Live status | Current activity and the latest health readings |
| "Check now" | A silent re-check: Layer 4 immediately sends a fresh live status |
| Speaking to the resident | Never |
| Alert buttons | None. No acknowledge and no false-alarm button; nothing comes back from the phone about an alert |
| Unanswered alerts | Out of scope |
| Who it serves | One caregiver on one iPhone |
| What is stored | An event log only, on the coordinator laptop. No video or audio is stored |
| Where it runs | On worker laptops, as jobs placed by Layer 2. The coordinator laptop runs none of it |
| Reaching Layer 1 | Messages between Layer 4 and Layer 1's bridge are carried by Layer 2's coordinator |
| The iPhone app | Layer 1 builds all of it. Layer 4 only supplies the data for each screen |
| Language | Python |
| Fall model | MediaPipe Pose Landmarker (full model, `pose_landmarker_full.task`) finds the body points in each frame; fixed rules in Layer 4 read them for the current activity and for falls. The lite model read a person lying on the floor as upright in webcam tests. The model file is not in the repository; the job's configuration gives its path. Decided Nov 14 |
| Speech-to-text model | faster-whisper, `base.en`, int8 on the CPU, with its built-in voice detector. Decided Nov 14 |
| Jobs | One job per sensor, each running its own detector and the rules together, because the rules keep no state and Layer 2 carries no messages between jobs. `fall_model` (`layer4/jobs/fall_model/`, sensor camera) reads `feed("camera")`, runs fall detection, the rules, the alert and the event log; only windows with a fall score are logged. It downloads the pose model on first start and checks its SHA-256. `speech_to_text` (`layer4/jobs/speech_to_text/`, sensor mic) reads `feed("mic")`, joins speech into utterances with faster-whisper's voice detector (an utterance ends after 1 second of silence or at 10 seconds), transcribes each with `base.en` on a second thread so reading never waits, and hands the transcript to the help check, then the rules. Transcripts are never logged or stored. `health_check` (`layer4/jobs/health_check/`, no sensor, so any laptop) takes Layer 3's checked watch readings (`contracts/watch-reading.json`) with `receive("watch-readings")`: a heart-rate reading goes to the rules; the latest sleep, steps and heart rate are kept for live status. Decided Nov 15 |

## How data flows

```
LAYER 3 (raw data)              LAYER 4, LOWER TIER (detectors)        LAYER 4, UPPER TIER (rules)

camera video ───────────────▶ fall model ──── fall confidence, ─────┐
                                              current activity      │
mic audio ──▶ speech-to-text ──▶ help check ── call for help? ──────┤
                                 (quick model)                      ├──▶ fixed rules ──▶ urgent ──▶ template alert
watch data ─────────────────▶ heart-rate check ── outside limits? ──┤         │                    then model rewrite
(heart rate, sleep, activity)                                       │         └──▶ everything ──▶ event log
                                                                    │                             (coordinator)
Layer 2 status ─────────────▶ monitoring check ── something down? ──┘

upper tier ──▶ Layer 2's coordinator ──▶ Layer 1's bridge ──▶ Vultr relay ──▶ caregiver's iPhone
```

## Components

**Lower tier**

| Component | Input | Output signal | Compute from Layer 2 |
|---|---|---|---|
| Fall model | Raw video from Layer 3 | Fall confidence; current activity (walking, sitting, lying down, not in view) | An always-on job |
| Speech-to-text | Raw audio from Layer 3 | A transcript when someone speaks | An always-on job |
| Help check | Each transcript | Whether it is a call for help | A `quick` request per transcript |
| Heart-rate check | Watch readings from Layer 3 | Whether heart rate is outside its limits | None; plain code in the upper-tier job |
| Monitoring check | Layer 2's status | Whether a camera, mic, laptop or detector has stopped | None; plain code |

**Upper tier**

| Component | What it does | Compute from Layer 2 |
|---|---|---|
| Rules | Compares each signal with its threshold and decides urgent or not | An always-on job (light) |
| Alert sender | Sends the template alert at once, then the model's rewrite as an update to the same alert | A `quick` request per alert |
| Live status | Sends current activity and the latest health readings, on change and on "check now" | None |
| Report writer | Builds the evening report from the event log | A fan-out batch and one combining request, on `deep` |
| Question answering | Answers a caregiver question from the current signals | A `deep` request per question |

## The rules

Each rule looks at one signal. The numbers are proposed defaults in a settings file, not medical guidance, and need the team's review.

| Signal | Rule (proposed values) | Result |
|---|---|---|
| Fall confidence | at or above 0.8 | Urgent: "Possible fall detected at {time}" |
| Help check | reports a call for help | Urgent: "Call for help heard at {time}" |
| Heart rate | above 130 or below 40 beats per minute | Urgent: "Heart rate of {bpm} recorded at {time} on {date}" |
| Monitoring check | a camera, mic or detector stopped for more than 30 seconds | Urgent: "Monitoring is degraded: {what stopped}" |
| Anything else | below its threshold | Event log only |

**Reading the pose** (proposed values, in `settings.py`). A shoulder or hip seen with visibility under 0.5, or a torso shorter than 2% of the frame height, means not in view. Lying down: the torso tilts 60° or more from upright, or looks shorter than half its last upright length (lying toward or away from the camera). Sitting: the hips are within 0.35 torso lengths of the knees, vertically. Otherwise walking; standing counts as walking.

**Falls from the pose** (proposed values, in `settings.py`). A fall is scored once the resident has been lying for 0.5 seconds without a break. The score is the smaller of two marks: how far the hips dropped from standing height, the highest they were while upright in the 3 seconds before lying (full marks at one upright torso length), and how fast they got there, timed from the last upright moment with the hips still within 0.15 torso lengths of standing height (full marks at 1.2 seconds or less, none at 3 seconds or more). Measuring from standing matters because in a real fall the knees often buckle before the torso tips. One fall gives one score; the next needs the resident upright again, because the rules keep no state and would otherwise alert every second. Known limits: a fall that ends slumped sitting on the floor, or out of view behind furniture, is not scored; the help check is the second line.

**Alert lifecycle**
1. A rule fires. The upper tier writes the event to the log and sends the template alert immediately. This step never waits on a language model.
2. It asks the `quick` model to rewrite the alert with context from the last 10 minutes of the event log.
3. When the rewrite arrives, it is sent as an update with the same alert ID, and the phone replaces the first text. If the model is slow or unavailable, the template alert simply stands.

## What leaves the home

| Leaves the home (through Layer 1's relay, encrypted) | Stays in the home |
|---|---|
| Alert text | All detection and all model processing |
| The daily report | The event log |
| Answers to questions | Raw mic audio and transcripts |
| Live status | Raw watch readings |
| Live video, once the resident has consented | Any recording: none is kept |

## Contracts with the other layers

Proposals for each layer's owner to agree.

**Layer 3 to Layer 4.** Three raw feeds: camera frames, mic audio, and watch readings (heart rate, sleep, activity and steps, each with the time it was measured).

**Layer 4 to Layer 2.** Layer 4 describes its always-on jobs (fall model, speech-to-text, upper tier) so Layer 2 can place them on workers. It uses `ask(prompt, quality)` for model requests, `fan_out(job, items)` for the report, `status()` for the monitoring check, and reads and writes the event log on the coordinator.

**Layer 4 and Layer 1.** Layer 2's coordinator carries these between Layer 1's bridge and Layer 4. The field names follow Layer 1's doc.

| Message | Direction | Fields |
|---|---|---|
| Alert | Layer 4 to Layer 1 | `alert_id, kind, severity, detected_at, title, body, update` |
| Reply to a question | Layer 4 to Layer 1 | `request_id, title, body` |
| Live status | Layer 4 to Layer 1 | current activity; latest heart rate, sleep, activity and steps, each with its age |
| Daily report | Layer 4 to Layer 1 | the report text and its date. Layer 1's doc has no call for this yet |
| Request | Layer 1 to Layer 4 | `request_id, device_id, kind, text`, where `kind` is `ask` or `check_now` |

Not used: acknowledgments and false-alarm marks. Watch readings go from the app to Layer 3, not to Layer 4.

## Proposed, not yet confirmed

1. **The threshold values** in "The rules".
2. **A word-match fallback for the help check.** If the `quick` model is unavailable, a transcript containing "help" still counts as a call for help, so a stopped model cannot silence one.
3. **Speech-to-text runs only when someone is speaking,** gated by a lightweight voice detector.
4. **The alert rewrite sees the last 10 minutes** of the event log.
5. **Report time is a setting,** so it can be set a few minutes ahead for the demo.

## Risks

| Risk | What it would break | Mitigation |
|---|---|---|
| Single-signal rules raise false alarms (sitting down hard, the television saying "help") | The caregiver's trust in alerts | Tune thresholds against staged tests; combined rules are a later improvement |
| The `quick` model is unavailable | Spoken calls for help go undetected; alerts keep their template text | The word-match fallback |
| Questions and the report use the `deep` model, which may be split or not loaded | A slow answer or report | Measure it; fall back to `quick` with a note |
| Watch readings arrive in bursts when the phone is unlocked | A heart-rate alert may describe a reading that is hours old | The alert states the reading's time |
| Speech-to-text mishears on a laptop mic across a room | Missed or false calls for help | Test with the real mic at realistic distance |
| Every message to the phone passes through Layer 2's coordinator | Alerts stop if that hop fails | Layer 2 treats it as safety work; Layer 1's cloud check reports the home offline |

## Not in scope

- An agent or any autonomous judgement
- Speaking to or listening for replies from the resident
- Acknowledging alerts, false-alarm feedback, or following up an unanswered alert
- More than one caregiver
- Combining signals in a rule
- Storing video or audio
- Any part of the iPhone app

## Build order

| Step | What | Depends on |
|---|---|---|
| 1 | Upper tier: rules on hand-written test signals; template alerts; event log | Layer 2 steps 1 and 2 |
| 2 | Fall model on Layer 3's camera feed | Layer 3 capture |
| 3 | Alerts reach the phone through Layer 2's coordinator and Layer 1 | Layer 1, Layer 2 step 7 |
| 4 | Speech-to-text and help check | Layer 3 capture, Layer 2 step 3 |
| 5 | Alert rewrite by the `quick` model | 3, Layer 2 step 3 |
| 6 | Heart-rate check, live status, "check now", monitoring check | Layer 3 watch data |
| 7 | Caregiver questions | Layer 2 step 3 |
| 8 | Daily report with fan-out | Layer 2 step 6 |
| 9 | Sound detection (stretch) | everything above |

## Open questions

1. The threshold values, and who signs them off.
2. Which fall model and which speech-to-text model to use: decided Nov 14, see "Decided".
3. How the daily report reaches the app; Layer 1 needs to add a call.
4. Sign-off on the contracts by the Layer 1, 2 and 3 owners.
