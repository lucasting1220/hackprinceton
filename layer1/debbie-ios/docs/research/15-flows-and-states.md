# 15 Screens, flows and states inventory
_Written 2026-11-14 by the lead from KICKOFF_PROMPT.md §5 and the Layer 1 doc (layer-1@fa56475, "Screens", "Pair a phone",
"Live view", "When things fail"). It's requirements analysis, not one of the 13 research topics. It lists every
screen, its one job (brief §4.3: "Every screen has one clear job") and the §5.2 states each must handle, so
`CRAFT.md` §9 and the Phase 6 screen gates have a complete list to check against._

## Screen inventory

| ID | Screen | Who | Its one job | Source |
|---|---|---|---|---|
| S01 | Welcome | Everyone, first launch | Explain Debbie in one sentence and start pairing | §5.2 "First launch and onboarding" |
| S02 | Who uses this iPhone? | Everyone, first launch | Choose caregiver or resident | §5.1.1 "Roles: caregiver or resident"; L1 "Phone pairing" |
| S03 | Local network priming | Everyone, before pairing | Explain why the system will ask, then trigger the prompt | §5.2 priming; L1 "The app asks for Local Network access first" |
| S04 | Camera priming | Everyone, before scanning | Explain why, then trigger the camera prompt | §5.2 priming |
| S05 | Scan the pairing code | Everyone | Point the camera at the laptop's QR code (Debug: paste a payload) | §5.1.1; §6 "Debug builds… feed in a QR payload" |
| S06 | Compare the code | Everyone | Check that the 4 digits match the laptop, then press Confirm on the laptop | §5.1.1; L1 step 3 |
| S07 | Paired | Everyone | Confirm success, then continue to notifications or Health priming | §5.1.1 |
| S08 | Notification priming | Caregiver | Explain time-sensitive alerts, then trigger the prompt | §5.2; §5.1.3 |
| S09 | Home | Caregiver | Answer "Is everything all right at home, and what needs me?" | L1 "Home: status header…"; §5.1.2, §5.1.4 |
| S10 | Alert detail | Caregiver | Understand one alert and respond (acknowledge, look in) | §5.1.2 |
| S11 | History | Caregiver | Review past alerts | §5.3 "alerts, status, history" |
| S12 | Home status | Caregiver | See which parts of monitoring are working | §5.1.4 |
| S13 | Live view | Caregiver | Look in, briefly and visibly | §5.1.5 |
| S14 | Add a laptop | Caregiver | Scan, check the name, approve | §5.1.6 |
| S15 | Resident | Resident (and a caregiver phone with resident mode on) | Send heart rate home; control whether a caregiver may look in | §5.1.7; L1 "Resident mode (… live view on/off)" |
| S16 | Health priming | Resident | Explain heart-rate access, then trigger the Health sheet | §5.2; §5.1.7 |
| S17 | Settings | Everyone | Manage this iPhone's pairing (see note 14) | §5.1.8 |
| S18 | Unpair confirmation | Everyone | Confirm removing this iPhone from the home | §5.1.8 |
| SD1 | Developer (Debug only) | Developers | Drive the mock home and switch transports | §6; never in Release |

## State matrix (brief §5.2)

Legend: ● the state must be designed and tested; ○ not applicable (with the reason).

| Screen | Loading | Empty | Offline / can't reach home | Error + recovery | Network switch |
|---|---|---|---|---|---|
| S05 Scan | ● camera starting | ○ | ● laptop unreachable → "check you're on the same Wi-Fi" | ● QR expired, invalid, wrong kind, camera denied | ○ |
| S06 Code | ● waiting for Confirm | ○ | ● lost contact → keep retrying, then explain | ● declined, expired, in progress elsewhere | ● same Wi-Fi required; say so |
| S09 Home | ● first fetch | ● no alerts yet: never "all clear" unless monitoring is confirmed | ● "Can't reach home", with last contact | ● fetch failed → retry | ● route changes silently; indicator updates |
| S10 Alert | ● acknowledging | ○ | ● ack queued, "will send when home is reachable" | ● ack failed → retry | ● |
| S11 History | ● | ● no past alerts | ● shows cached history, marked as possibly stale | ● | ● |
| S12 Status | ● | ○ | ● every row "can't confirm" with the age | ● | ● |
| S13 Live view | ● requesting / ready / connecting | ○ | ● relay unreachable → failed, with Try again | ● denied (resident has it off), failed, ended | ● keeps playing if WebRTC survives; otherwise failed, with Try again |
| S14 Add laptop | ● sending | ○ | ● home unreachable → explain | ● expired, invalid code, rejected | ● LAN or relay, whichever works |
| S15 Resident | ● syncing | ● no readings yet (Watch not worn or not synced) | ● home Wi-Fi not reachable → readings wait | ● Health denied → how to allow in Settings | ● readings wait until home Wi-Fi |
| S17 Settings | ○ | ○ | ● unpair offline → deletes locally and says so | ● | ○ |

## Live-view states (brief §6: all must be reachable and tested)

`requesting → denied` · `requesting → ready → connecting → playing → ending → ended` · any state → `failed`.
Each needs a visible design, VoiceOver announcement, and a UI test path through the mock home.

## Cross-cutting requirements that every screen inherits
- First launch: the onboarding order is S01 → S02 → S03 → S04 → S05 → S06 → S07 → (S08 caregiver | S16 resident). Every primer comes before its system prompt (§5.2).
- Moving between Wi-Fi and cellular never asks the user to re-pair (§5.2; L1 "When things fail").
- "Can't reach home" and "monitoring degraded" are first-class states, never an error toast (§5.1.4).
- Never an all-clear that can't be confirmed (§5.1.4; L1 "Relay unreachable from the phone").
