# Cross-layer decisions and coherence review

**Status: decisions made by Lucas on Nov 14, for the team. All four layer docs have been updated to match.**

## The documents

| Layer | Document |
|---|---|
| 1 | `docs/layer1-join-and-connect.md`, corrected Nov 14 |
| 2 | `docs/layer2-device-management.md` |
| 3 | `docs/layer3-raw-data.md` |
| 4 | `docs/layer4-care-layer.md` |

The earlier "Local AI Home Caregiver: Concept and Build Roadmap" PDF is background only. It still describes one hub laptop, spoken check-ins and "video never leaves the house".

## Which document wins

- Lucas's Layer 2 and Layer 4 docs are the reference for how the system works.
- The Layer 1 doc is the reference for joining, connecting, the AWS relay and the iPhone app. Each layer's own doc is the reference for what that layer does.
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

## Changes made to the Layer 1 doc

The Layer 1 doc was written before these decisions. It was corrected on Nov 14:

- Detectors and rule-based alerts are Layer 4's, running on workers. Layer 1 no longer starts Layer 4 or calls it directly; Layer 2's coordinator carries the messages.
- The capture job, its video feed for live view, and receiving watch data are Layer 3's.
- Layer 1 builds every app screen, including the care screens.
- The bridge no longer decides "monitoring degraded".
- Alert acknowledgments, false-alarm marks and the spoken "Are you okay?" option are removed.
- Watch data covers heart rate, sleep and steps, and goes to Layer 3. A call for the daily report is added.
- Live view needs the resident's consent once, then is always available.
- Its five questions for Layer 2 are answered in place.

## Still open

| Item | Owner |
|---|---|
| Lucas's confirmation of the proposed answers to Layer 1's ten asks (in the Layer 2 doc) | Lucas |
| The rule threshold values (in the Layer 4 doc) | Lucas, with the team |
| Whether the camera laptop still shows an on-screen notice during live view | Layer 1 owner |
| Updating or retiring the concept PDF, which still describes one hub laptop, spoken check-ins and "video never leaves the house" | Whole team |

## Privacy claim, as the decisions now stand

All detection and all model processing happen inside the home. No video or audio is stored. Alerts are encrypted between the home and the caregiver's phone. Once the resident has consented, the caregiver can open a live view of the camera at any time.
