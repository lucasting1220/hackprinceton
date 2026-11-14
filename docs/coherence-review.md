# Cross-layer decisions and coherence review

**Status: decisions made by Lucas on Nov 14, for the team. The Layer 2 and Layer 4 docs have been updated to match. The Layer 1 doc has not, and there is no Layer 3 spec yet.**

## What was reviewed

| Layer | Document | Version |
|---|---|---|
| 1 | `docs/layer1-join-and-connect.md` | branch `layer-1`, commit `fa56475` |
| 2 | `docs/layer2-device-management.md` | updated Nov 14 |
| 3 | "Local AI Home Caregiver: Concept and Build Roadmap" (PDF) | dated Nov 13. This is the whole-product concept, not a Layer 3 spec |
| 4 | `docs/layer4-care-layer.md` | updated Nov 14; replaces the "care agent" draft |

## Which document wins

- Lucas's Layer 2 and Layer 4 docs are the reference for how the system works.
- The Layer 1 doc is the reference for joining, connecting, the AWS relay and the iPhone app. Where it describes what other layers do, it is not to be followed.
- The concept PDF is background. Where it differs from the layer docs, the layer docs win.

## The data path

Every piece of fetched data goes to Layer 3. Layer 3 passes it to Layer 4. Layer 4 computes the decision. Layer 1 carries the decision to the iPhone. Layer 1 makes no decisions of its own.

## Decisions

| # | Topic | Decision |
|---|---|---|
| 1 | What triggers an alert | Fixed rules in Layer 4. Any single signal over its threshold alerts at once. There is no agent and no model judgement |
| 2 | Alert text | A fixed template first; a language model's rewrite then replaces it on the phone |
| 3 | Where detectors live | Layer 4 owns the fall model, speech-to-text, the help check and the heart-rate check |
| 4 | What Layer 3 is | Raw data only: the camera and mic capture job, and receiving watch data |
| 5 | Where Layer 4 runs | On workers, placed by Layer 2. The coordinator laptop manages hardware and stores data |
| 6 | Layer 1 to Layer 4 | Layer 2's coordinator carries messages between Layer 1's bridge and Layer 4 |
| 7 | Remote link | Layer 1's AWS relay. No tunnel |
| 8 | Live video | The resident consents once at setup; after that the caregiver can open it at any time |
| 9 | Speaking to the resident | Never |
| 10 | "Check now" | A silent re-check that returns a fresh live status |
| 11 | Sound detection | A stretch goal; nothing depends on it |
| 12 | Watch data | Heart rate, sleep, and activity and steps. The app reads and sends it; Layer 3 receives it. Readings arriving in bursts when the phone is unlocked is acceptable |
| 13 | Health rules | Only heart rate can alert. Sleep and activity appear in live status and the daily report |
| 14 | Capture job | Layer 3 builds it, including the video feed Layer 1 needs for live view |
| 15 | "Monitoring degraded" | Layer 4 decides; Layer 1 delivers. "Home is offline" stays in Layer 1's cloud check |
| 16 | The iPhone app | Layer 1 builds all of it. Layer 4 supplies the data |
| 17 | Alert buttons | None: no acknowledge, no false-alarm |
| 18 | Language model uses | The help check, alert rewrites, the daily report, caregiver questions, and Layer 2's planner |

## Changes the Layer 1 doc needs

For the Layer 1 owner. Section names are from the Layer 1 doc.

| Where | Change |
|---|---|
| "Who builds what" | Detection models move from Layer 3 to Layer 4. The capture job moves from Layer 2 to Layer 3. Care screens move from Layer 4 to Layer 1. Layer 4 has rules, not "care logic, acknowledgments, escalation" |
| Asks F1 to F4 | F1 is met (alerts are rule-based). F2 is declined: Layer 4 runs on workers, not the coordinator laptop, and Layer 1's launcher does not start it. F4 is reversed: Layer 1 builds the care screens |
| Ask L6 | The frame feed for live view comes from Layer 3's capture job, not Layer 2 |
| Ask L10 | Layer 4 is not on the coordinator laptop, so its endpoint is not a local one |
| "Handoff to Layer 4" | Calls go through Layer 2's coordinator, not directly to `127.0.0.1:7490`. Remove `POST /v1/acks`. `POST /v1/heart-rate` becomes watch data (heart rate, sleep, activity and steps) and goes to Layer 3. Add a way to deliver the daily report |
| "Health and offline alerts" | The bridge stops deciding "monitoring degraded"; Layer 4 raises it as an alert. The one-minute heartbeat and the cloud's "hub offline" stay |
| "Live view" and "Decided" | Consent once at setup, then always available |
| Request `kind` | `check_now` is a silent re-check; nothing is spoken |
| Heart rate rows | Done in the copy in this folder: resident mode sends heart rate, sleep and steps as `POST /v1/watch-data`. Still to change: the readings go to Layer 3, not Layer 4 |
| Sound detection rows | Sound detection is a stretch goal; do not depend on it |
| Phone screens | Remove acknowledge and false-alarm actions |
| Questions for Lucas 1 to 5 | Answered in the Layer 2 doc: use the hotspot; the report uses the event log; declined sensors appear as `dropped` with reason `declined`; the worker restarts jobs; an unreachable Ollama goes straight to the rule-based plan |
| Glossary | "Coordinator laptop" no longer runs Layer 4 |

## Still open

| Item | Owner |
|---|---|
| A Layer 3 spec: the capture job, the video feed for live view, receiving watch data, and the three feeds handed to Layer 4 | Layer 3 owner |
| The Layer 1 owner's agreement to the changes above | Lucas and the Layer 1 owner |
| Lucas's confirmation of the proposed answers to Layer 1's ten asks (in the Layer 2 doc) | Lucas |
| The rule threshold values (in the Layer 4 doc) | Lucas, with the team |
| Whether the camera laptop still shows an on-screen notice during live view | Layer 1 owner |
| How the daily report is delivered to the app | Layer 1 and Layer 4 owners |
| Updating or retiring the concept PDF, which still describes one hub laptop, spoken check-ins and "video never leaves the house" | Whole team |

## Privacy claim, as the decisions now stand

All detection and all model processing happen inside the home. No video or audio is stored. Alerts are encrypted between the home and the caregiver's phone. Once the resident has consented, the caregiver can open a live view of the camera at any time.
