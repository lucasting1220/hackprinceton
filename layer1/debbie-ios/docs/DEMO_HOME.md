# On-device demo home

**What it is.** A demo of Debbie that runs entirely on the iPhone, with no network, so the owner can feel the
motion and haptics on a real phone from a TestFlight build (binding brief §6, "On-device demo home"). It is the
one exception to "no mocks in Release" (brief §3).

## Rules (brief §6)
| Rule | How Debbie meets it |
|---|---|
| Clearly labelled as a demo | A persistent "Demo — sample data" capsule in the top bar of every demo screen (`DebbieDemoBadge`, the `mint.tint` surface with `text.primary`). Every demo string that could be mistaken for real data says "(demo)". The app name in notifications is prefixed "Demo:" |
| Chosen explicitly from onboarding | Welcome (S01) offers **Try the Demo** as a secondary action next to **Get Started**. Choosing it shows one sentence ("Explore Debbie with sample data. Nothing here is real, and nothing is sent anywhere.") and a **Start Demo** button |
| Runs entirely on the phone, no network | `DemoHomeTransport` implements the same `HubTransport` protocol as the LAN and relay clients, in-process. It never opens a socket or a URLSession (a unit test asserts no `URLSession` is created while the demo is active) |
| Demo data marked; never mixed with a real pairing | The demo has its own in-memory store and no Keychain items. Starting the demo is impossible while paired, and pairing is impossible while in the demo; leaving the demo erases demo state. Unit test |
| Removable with one build setting | Everything lives in `App/DemoHome/` (the app target, because package targets cannot see xcconfig flags), wrapped in `#if DEBBIE_DEMO_HOME`; the `FakeMediaEngine` lives there too. The setting is one xcconfig line, `SWIFT_ACTIVE_COMPILATION_CONDITIONS = $(inherited) DEBBIE_DEMO_HOME`. `tools/ci/check-release-clean.sh --expect-no-demo` proves a Release build without the line contains no demo symbols |
| Reaches every §5.1 screen | See "Coverage" below; a UI test walks every row in Release-like Debug with the demo transport |
| Fires every named haptic event | See "Coverage"; the haptic event log (Debug) is checked by the same UI test, and the owner's phone checklist in MORNING_REPORT §4 |
| Listed under "Decisions to confirm" | MORNING_REPORT §5 |

## Behaviour
- The demo plays the hub's side with the **real crypto** (the same `DebbieCrypto` code), generating a demo home key and
  pairing bundle in memory. Only the transport is in-process, so screens, view models and decryption are the real code.
- A "Demo controls" sheet, opened from the demo badge, lets the person trigger what the mock home's control panel
  triggers: a possible-fall alert (urgent), a wording update, a late alert, monitoring degraded, hub offline / back
  online, phone removed, live view (allowed / denied / ended by the resident / connection lost), a new laptop to approve,
  and a heart-rate burst. Each control says what it will do in one line.
- Live view in the demo uses the `FakeMediaEngine` (a calm animated mint test pattern labelled "Demo camera"), so every
  live-view state and its haptics can be felt.
- Resident mode in the demo uses sample heart readings, never HealthKit, so it works without Health permission.

## Coverage (every §5.1 screen and every named haptic event)
| §5.1 | Demo path | Haptic events felt |
|---|---|---|
| 1 Pairing | Start Demo → Compare the code (demo code) → auto-confirms after 3 s → Paired | `paired`; `pairingFailed` via "Try a failed pairing" |
| 2 Alerts | Demo controls → Possible fall → Alert detail → I'm On It / Mark as false alarm | `alertUrgentArrived`, `acknowledged` |
| 3 Push | Demo controls → "Show as notification" posts a local notification with the same content builder the extension uses | (system sound and vibration) |
| 4 Status | Demo controls → degraded / hub offline / back online / removed | none (status changes never vibrate) |
| 5 Live view | Live View → ready → playing → Stop; or denied / ended by the resident / lost | `liveViewStarted`, `liveViewDenied`, `liveViewEndedByResident`, `liveViewLost` |
| 6 Add a laptop | Add a Laptop → demo QR → Approve | `scanRecognized`, `laptopApproved`; `laptopApprovalFailed` via the failed variant |
| 7 Resident | Settings → Resident mode → Sync Now with sample readings | `syncSucceeded`, `syncFailed`, `toggleChanged` |
| 8 Settings | Settings → Leave Demo (instead of Unpair) | `unpairIncomplete` via "Try leaving while home is unreachable" |
| Onboarding choice cards | Role choice | `choiceChanged` |
| Scan errors | Demo controls → "Scan an expired code" | `scanInvalid` |
