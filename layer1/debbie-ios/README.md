# Debbie for iPhone

Debbie turns a few spare laptops into a private home-monitoring hub for an older person who mostly lives
alone. This repository is the iPhone app: a **caregiver** role (alerts, home status, live view, adding a laptop)
and a **resident** role (heart rate from Apple Watch via HealthKit). It's part of the HackPrinceton project;
the system design is the Layer 1 doc (`docs/context/upstream/`).

> Everything here builds, tests and ships from the command line. No step needs the Xcode GUI.

## Repository map

| Path | What |
|---|---|
| `CLAUDE.md` | Standing rules for anyone (human or agent) working here |
| `CRAFT.md` | The design and engineering practice every change must pass (§9 is the review checklist) |
| `PROGRESS.md`, `MORNING_REPORT.md` | Build log and owner report |
| `docs/CONTRACTS.md` | PROPOSED phone ↔ hub wire contracts and crypto test vectors |
| `docs/DECISIONS.md` | Every decision, with options, reasons and sources |
| `docs/research/` | Sourced research notes behind `CRAFT.md` |
| `Design/` | Vector sources, export scripts and review renders for every asset |
| `project.yml` → `Debbie.xcodeproj` | XcodeGen spec (the generated project is committed; regenerate with `xcodegen generate`) |
| `App/`, `NotificationService/` | App target (composition root, on-device demo home) and the Notification Service Extension |
| `Packages/DebbieKit/` | All app code as modules: Core, Crypto, SecureStore, Networking, DesignSystem, CareScreens, Features |
| `UITests/` | Main path (with Xcode's accessibility audit), the 22-screen tour used by the screen gate, the transitions recording, and the mock-home reconnection and rediscovery test |
| `MockHome/` | Node mock of the bridge, LAN gateway and relay (development only, 127.0.0.1) + its smoke test |
| `fastlane/`, `Gemfile` | Pinned fastlane 2.241.2: `test`, `build`, `preflight`, `beta`, `beta_notes` lanes |
| `tools/` | CI checks (`tools/ci`), screen gate (`tools/screens`), simulators, video frames, colour tokens, contract vectors |

## Prerequisites

- Xcode 26.6 or later (iOS 26.5 SDK), on Apple silicon
- Homebrew Ruby and Bundler (`bundle install` installs the pinned fastlane into `vendor/bundle`)
- Node 20 or later (contract vectors and the mock home; built-in modules only, no `npm install`)
- XcodeGen 2.46.0 (`brew install xcodegen`): every fastlane lane regenerates `Debbie.xcodeproj` from `project.yml`

## Build and test

```sh
bundle config set --local path vendor/bundle && bundle install   # once
tools/ci/fl test     # xcodegen, lint, contract vectors (Node vs CryptoKit), mock-home smoke test, package unit tests, UI main path, warnings
tools/ci/fl build    # Debug Simulator build, unsigned Release device build, Release cleanliness, demo removable, zero warnings
tools/screens/tour.sh            # screen gate: 22 screens × SE/Max × light/dark × default/AX5 + Reduce Motion + Increase Contrast
tools/ci/lint.sh                 # design-system lint: raw animations, haptics, colours, fonts, spacing, SF Symbols, system controls
```

Every `xcodebuild` goes through `tools/ci/xcb.sh` (stdin closed, time limit, redacted log in `logs/`). The Simulators
"Debbie SE" and "Debbie Max" are created by `tools/sim/sim.sh ensure`.

## Try it without a home: the on-device demo home

On the first screen, **Try the Demo** opens a clearly labelled demo home that runs entirely on the phone: no
network, sample data only, never mixed with a real pairing (`docs/DEMO_HOME.md`). It reaches every screen and
every haptic: a possible-fall alert arrives a few seconds in, Live View plays a demo camera, and each new live-view
request shows a different outcome (ended by the person at home, live view off at home, normal, lost connection).
Choose "The person at home" to see resident mode. It ships in TestFlight builds and is removed by deleting one line,
`DEBBIE_DEMO_HOME`, from `Config/Release.xcconfig`; `tools/ci/fl build` proves a build without it contains no demo code.

## Run the mock home

The mock home plays the coordinator laptop's bridge, LAN gateway and the relay over real HTTP with the real
crypto, on **127.0.0.1 only**, and advertises `_debbie._tcp` by Bonjour (`docs/MOCK_HOME.md`). Debug builds only.

```sh
node MockHome/server.mjs --auto-confirm   # LAN 7580, relay 7581, control panel http://127.0.0.1:7570
node MockHome/smoke.mjs                   # 22 checks: pairing, LAN, relay, live view, offline, removed phone
```

Run the app against it in the Simulator: build Debug, then launch with `DEBBIE_TRANSPORT=mock` and the QR payload
the server prints as `DEBBIE_DEBUG_QR` (or paste it on the scan step's Debug field):

```sh
SIMCTL_CHILD_DEBBIE_TRANSPORT=mock SIMCTL_CHILD_DEBBIE_DEBUG_QR='<the printed payload>' \
  xcrun simctl launch --terminate-running-process "Debbie SE" com.example.debbie
```

The control panel's buttons (and `POST /control/…`) trigger alerts, updates, late delivery, hub offline/online,
monitoring degraded, stale heartbeats, a removed phone, the LAN gateway unreachable/moved/black-holed, live-view
consent and every live-view outcome, and a push to the Simulator (`push` runs `xcrun simctl push` with the latest
encrypted alert, which the Notification Service Extension decrypts). `UITests/MockHomeUITests` pairs the real app
with the mock, cuts the LAN gateway and measures the fallback to the relay.

## Debbie's AI answers (Gemini)

The centre tab is a conversation with Debbie, who summarises how the person at home is doing (D-031). With a Gemini key, Google Gemini writes her answers. Without one, the phone writes them from the same facts in fixed wording.

1. Create `~/.config/debbie-ios/gemini.env` (mode 600), outside the repo:
   ```sh
   # From aistudio.google.com/apikey:
   GEMINI_API_KEY=…
   # Optional; research note 17 R1 lists the allowed models:
   GEMINI_MODEL=gemini-3.5-flash-lite
   ```
2. Run `tools/ci/gemini-smoke.sh`. It makes one tiny call and prints the model, the HTTP status and the first words of the reply, never the key.
3. Run `tools/ci/make-local-config.sh`, or any `tools/ci/fl` lane, which runs it. It writes the key into the gitignored `Config/Local.xcconfig`, and the build copies it into Info.plist `DebbieGeminiKey`.

**TestFlight only.** By the owner's decision, the key ships inside TestFlight builds and the home's data goes to Gemini without a consent step. That isn't acceptable for the App Store; see D-031 for what must change first. The redactor, the log scan and the pre-commit hook all treat the key as a secret.

## Ship to TestFlight

One-time setup by the owner (KICKOFF_PROMPT.md "Before you start"):
1. Create `~/.config/debbie-ios/asc.env` with six lines: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_PATH` (an App Store Connect **Team** API key `.p8` with the **Admin** role), `APPLE_TEAM_ID`, `BUNDLE_ID` and `DEMO_IOS_VERSION`. The file stays outside the repo; nothing ever prints its values.
2. Register `BUNDLE_ID` and create the app record in App Store Connect (the API can't create app records).
3. Make sure an internal TestFlight group with automatic distribution exists and includes you.

Then, from the repo root:

```sh
bundle config set --local path vendor/bundle && bundle install   # once: pinned fastlane 2.241.2
tools/ci/fl preflight             # read-only: key, app record, bundle IDs and capabilities, internal group and testers, minimum iOS
tools/ci/fl beta                  # register the extension ID, sign with the dedicated keychain, archive, validate, upload (internal only)
tools/ci/fl build_status build:N  # read-only: the processing state of build N
tools/ci/fl beta_notes build:N    # once build N is VALID: attach fastlane/what-to-test.txt (and add it to the group if that group isn't automatic)
```

What `beta` does (D-027):
- **Identifiers.** It registers only `BUNDLE_ID.NotificationService` (and `BUNDLE_ID`, if it's missing). It enables Push, Time Sensitive and HealthKit only if they're off, using the public API, and never disables anything.
- **Keychain.** It creates `.signing/debbie-signing.keychain-db` and appends it to the keychain search list. The default keychain is never changed.
- **Certificate and profiles.** It creates one Apple Distribution certificate in that keychain, plus App Store profiles named `Debbie AppStore <bundle id>` that are bound to that certificate only.
  - It never uses or changes existing certificates or profiles.
  - It stops if the team is at its certificate limit.
- **Build.** It sets the build number to the latest TestFlight build + 1 and archives with manual signing. It regenerates the project afterwards, so the committed project never carries anyone's signing. It validates the IPA with `tools/ci/validate-ipa.sh`.
- **Upload.** It uses `xcrun altool --p8-file-path`, which reads the key where it is, without copying it, and doesn't wait for processing. Nothing is submitted for review, and export compliance is answered only in Info.plist (D-028).

Undoing the signing items is the account owner's call. The pipeline never revokes or deletes anything in the account.
- Run `security delete-keychain "$PWD/.signing/debbie-signing.keychain-db"`, which also removes it from the search list, then `rm -rf .signing`.
- In Certificates, Identifiers & Profiles, revoke the Apple Distribution certificate the lane created and delete the two `Debbie AppStore …` profiles. The local copies are in `~/Library/Developer/Xcode/UserData/Provisioning Profiles/`.

`tools/ci/make-local-config.sh` generates `Config/Local.xcconfig` from `asc.env`. It holds only the bundle ID and team ID, neither of which is secret.

Always run lanes through `tools/ci/fl`, never a global `fastlane`. The wrapper closes stdin, so nothing can prompt for an Apple ID. It also redacts credential values and writes logs to the gitignored `logs/`. Nothing is ever submitted for App Review or Beta App Review.

## How Layer 4 contributes

The care screens (alerts, status including the heart-rate trend and "no heart data", history) belong to the Layer 4 owner. They live in their own module so they can be handed over cleanly:

| Module | Owner | What it is |
|---|---|---|
| `Packages/DebbieKit/Sources/DebbieCareScreens` | Layer 4 | Alerts list and detail, status, history, and their view models |
| `Packages/DebbieKit/Sources/DebbieDesignSystem` | shared | Every token and component. Use these, never system controls or literal values (`CRAFT.md` §2, §5) |
| `Packages/DebbieKit/Sources/DebbieCore` | shared | Wire models and protocols the care screens consume |
| everything else | Layer 1 | Pairing, transports, crypto, live view, resident mode, settings, the notification extension |

Once the owner adds a git remote (the repo is local-only tonight):
1. Clone it, run `brew install xcodegen` (optional; the generated `Debbie.xcodeproj` is committed), then open `Debbie.xcodeproj` or work from the command line as above.
2. Work on a branch. Changes to `DebbieCareScreens` must pass `CRAFT.md` §9 (the review checklist): `tools/ci/lint.sh`, the unit and UI tests, and the screen gate screenshots.
3. `DebbieCareScreens` may import only `DebbieCore` and `DebbieDesignSystem` (the module allowlist in `CRAFT.md` §8). Needs from other layers go through the contracts in `docs/CONTRACTS.md` (for example §3.3 `care_status` and §3.4 requests and replies).

## Contract vectors

```sh
node tools/contracts/verify-vectors.mjs          # checks docs/contracts/vectors.json with Node's built-in crypto
```

## The launch intro

The first four seconds on the welcome screen (CRAFT.md §3.7, D-033): a heart monitor's line that becomes the mark, then the welcome. It is a pure function of one clock (`Motion.Intro`, `IntroPose.at(t)`), tested by `IntroShapeTests` and `IntroUITests`. To record it and inspect it frame by frame:

```sh
tools/video/record-intro.sh small off   # iPhone SE; writes Design/reviews/recordings/intro.mp4, intro-10fps.png and build/intro-frames/
tools/video/record-intro.sh small on    # the Reduce Motion version
```

