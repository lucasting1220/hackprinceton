# Decisions

Format: **D-NNN: title**, then date, decision, options considered, reason and sources. Newest last.

---

## D-001: The local Layer 1 doc is the source of truth for now
- **Date:** 2026-11-14 09:15 EST
- **Decision:** Use `/Users/chava/Desktop/layer 1/docs/layer1-join-and-connect.md` (snapshot in `docs/context/upstream/`, sha256 57f6bace…) until the GitHub copy exists.
- **Options:** (a) the local file; (b) wait for GitHub.
- **Reason:** At 09:14 `lucasting1220/hackprinceton@layer-1` held only the initial commit and the doc path returned 404. (The binding brief's rule, if the copies ever differ, is to use the one changed most recently, record which, and list it under "Decisions to confirm". Corrected 10:49; the earlier text quoted an older copy of the brief.) Re-check at each networking, crypto, push or live-view phase.
- **Sources:** `gh api repos/lucasting1220/hackprinceton/contents/docs/layer1-join-and-connect.md?ref=layer-1` → 404 at 09:14 EST.

## D-002: Build with placeholder identifiers while `asc.env` is missing
- **Date:** 2026-11-14 09:15 EST
- **Decision:** Use the placeholder bundle ID `com.example.debbie` and no team, via `Config/Local.xcconfig`, which is generated from the env file when it exists and from placeholders when it doesn't. Simulator builds need no signing. Device, archive and TestFlight lanes refuse to run without the real values, and explain why.
- **Options:** (a) placeholders; (b) take the team ID from a signing identity in the login keychain; (c) stop and wait.
- **Reason:** The brief forbids inventing or registering identifiers when `BUNDLE_ID` or `APPLE_TEAM_ID` is missing. (b) amounts to guessing which of the owner's teams is meant, and (c) is forbidden ("never wait for a human").
- **Sources:** KICKOFF_PROMPT.md §3 "Security, accounts and limits".

## D-003: Follow the GitHub Layer 1 doc now that it exists (fa56475)
- **Date:** 2026-11-14 09:31 EST
- **Decision:** Snapshot updated to `layer-1@fa56475` (sha256 2b1c45f8…, identical to the local file). The only change since the first snapshot is the Bonjour service `_debbie._tcp`, with the hub-key prefix in its TXT record. `CONTRACTS.md` now follows it, and drops my earlier `_debbie-bridge._tcp` proposal.
- **Options:** none. The two copies are identical, so the binding brief's "most recently changed" rule picks either. Listed under "Decisions to confirm" as required.
- **Sources:** `gh api repos/lucasting1220/hackprinceton/commits?sha=layer-1` → fa56475 "Name the Bonjour service phones and laptops use to find the coordinator" (2026-11-14T14:23Z).

## D-004: Build with Xcode 26.6 and the iOS 26.5 SDK, even though iOS 27 is current
- **Date:** 2026-11-14 09:36 EST
- **Decision:** Build with the installed Xcode 26.6 (iOS 26.5 SDK). Don't install Xcode 27.
- **Options:** (a) use Xcode 26.6; (b) install Xcode 27 for the iOS 27 SDK.
- **Reason:** iOS 27 shipped on 14 September 2026 (found by the Phase 1 platform research; see `docs/research/02-ios-design-language.md`). Installing Xcode 27 needs an Apple ID download (the brief forbids Apple ID login) and more than the 24 GB of free disk. Apps built with the iOS 26 SDK run on iOS 27. Whether App Store Connect still accepts Xcode 26 uploads in November 2026 is checked in `docs/research/12-delivery-fastlane.md`. Anything that needs the iOS 27 SDK goes on the later list.
- **Sources:** Phase 1 research notes 02 and 12; `xcodebuild -version` → Xcode 26.6 (17F113); `df -h` → 24 GB free.

## D-005: Minimum iOS version is 26.0
- **Date:** 2026-11-14 09:51 EST
- **Decision:** `IPHONEOS_DEPLOYMENT_TARGET = 26.0` for the app and the notification extension.
- **Options:** (a) iOS 26.0; (b) iOS 18.0 with fallbacks for the Liquid Glass APIs; (c) iOS 17.0.
- **Reason:** iOS 26 runs on every iPhone that runs current iOS (iPhone 11 / SE 2nd gen and later; iOS 27 supports the same devices). On 7 June 2026, 79% of App Store iPhones ran iOS 26. It gives native Liquid Glass with no fallback code, and it can be tested on this Mac's simulator runtimes (26.2, 26.4, 26.5). Cost: 2018 iPhones (XR, XS, XS Max), which stop at iOS 18, are excluded. That matters for the lower-income pitch, so it is listed under "Decisions to confirm", and an iOS 18 resident build goes on the later list.
- **Sources:** `docs/research/02-ios-design-language.md` R1, R2 and R18, and its sources S1, S3–S7 and S36.

## D-006: Apple system typefaces only, nothing bundled
- **Date:** 2026-11-14 09:51 EST
- **Decision:** SF Pro (default design) for all text. SF Pro Rounded (`.fontDesign(.rounded)`) only for the hero line and large numerals. Both are used through the system font API; no font files are bundled, so no licence is needed. The wordmark is hand-drawn outlines, not set in any font.
- **Options:** (a) system fonts; (b) a bundled open-licence typeface.
- **Reason:** Best legibility and full Dynamic Type and Bold Text support for older users. The brief allows Apple's system typefaces. Apple's font licence forbids using SF outlines as artwork, which is why the wordmark is drawn.
- **Sources:** `docs/research/07-typography-layout.md` R1–R3; `08-icons-logos-app-icons.md` R17.

## D-007: XcodeGen 2.46.0 generates the Xcode project (build-time dependency)
- **Date:** 2026-11-14 09:51 EST
- **Decision:** `project.yml` is the source of truth. `xcodegen generate` writes `Debbie.xcodeproj` with folder-synchronised groups. Both are committed, so Layer 4 can open the project without installing anything. The test lane fails if regenerating would change the committed project.
- **Purpose:** a reproducible, reviewable project definition, built entirely from the command line (brief §3), with few merge conflicts for several contributors.
- **Alternatives:** Tuist (heavier, its own toolchain); a hand-maintained `.xcodeproj` (not reproducible without the Xcode GUI); SwiftPM only (can't build an iOS app with a notification extension).
- **Maintenance:** active project, release 2.46.0 dated 2026-07-16. Installed with Homebrew (`brew install xcodegen`), and listed in MORNING_REPORT.
- **Licence:** MIT. It is a build tool only: nothing from it ships in the app.
- **Sources:** `docs/research/11a-engineering-architecture.md` R1, F2; `brew info xcodegen` (09:32) → stable 2.46.0, MIT.

## D-008: Alert severity tiers, with unknown treated as urgent
- **Date:** 2026-11-14 09:51 EST
- **Decision:** Layer 4's `severity` is `urgent` | `attention` | `info`. Any other value is displayed as `urgent`, and logged as a contract error without its content. Only `urgent` uses Time Sensitive interruption. The relay's "hub offline" push is `active`, and "back online" is `passive`.
- **Options:** two tiers; three tiers; unknown treated as `info`, `attention` or `urgent`.
- **Reason:** The costliest failure is a missed emergency, and alarm fatigue is the main threat to the alert channel. Keeping Time Sensitive for real emergencies means caregivers never have a reason to switch it off for Debbie.
- **Sources:** `docs/research/10-caregivers-older-adults-alerting.md` R1, R2 and R4; `13-platform-extras.md` R1; `lead-decisions.md` X1 and X34. PROPOSED to Layer 4 and the relay in `docs/CONTRACTS.md` §3.1 and §8.

## D-009: Mock home is a Node process speaking the real contracts on 127.0.0.1
- **Date:** 2026-11-14 10:26 EST
- **Decision:** `MockHome/` is a Node program (built-in modules only) outside the app target. It listens on 127.0.0.1 only, plays the coordinator's bridge, the LAN gateway and the relay over real HTTP, adds a KVS-style signalling WebSocket and a control panel, and advertises `_debbie._tcp` by Bonjour. The app reaches it through its real transports, chosen by configuration (Debug only).
- **Options:** (a) an in-process mock behind the transport protocol; (b) a `URLProtocol` interceptor; (c) a local server (Node or Swift); (d) combinations.
- **Reason:** The binding brief §6 prescribes it ("a separate local server … listening on 127.0.0.1 only. Write it in Node, so its cryptography is the independent implementation that checks yours"). It also exercises the real networking and crypto code (research notes 11a R2/R20 and 11b R14).
- **Sources:** KICKOFF_PROMPT.md §6; `docs/research/11b-engineering-webrtc-testing-perf.md` §F6 and R14; `docs/MOCK_HOME.md`; `lead-decisions.md` X29 and X37.

## D-010: Phase 1 cross-note review done by the lead plus an independent check, not the workflow's barrier stage
- **Date:** 2026-11-14 10:26 EST
- **Decision:** After every per-note review and fix finishes, stop the research workflow before its automated cross-note stage. Cross-note contradictions are resolved in `docs/research/lead-decisions.md` (X1–X44, each against primary sources or the brief). An independent subagent with no stake reviews those decisions, and the lead's own notes (11c, 14, 15), against the binding brief and the notes, and every finding is fixed.
- **Options:** (a) wait for the workflow's cross-note agent and its fixer (about 25–30 more minutes, pushing research to about 11:20 against the 10:40 checkpoint); (b) the decision above.
- **Reason:** Brief §2: "If you fall behind, cut scope inside a phase before you relax its gate". The gate's substance stays: every note is independently reviewed and fixed, contradictions are found and resolved, and the resolutions are independently reviewed. Only the duplicate automated pass is cut.
- **Sources:** KICKOFF_PROMPT.md §2, §8 Phase 1.

## D-011: rsvg-convert (Homebrew librsvg) as a build-time renderer for review images
- **Date:** 2026-11-14 10:40 EST
- **Decision:** Use the already-installed `rsvg-convert` (librsvg 2.x, Homebrew) only to rasterise SVG sources into review PNGs and illustration previews in `Design/reviews/`. Nothing it produces ships in the app: the asset catalogs hold the SVG or PDF vectors, and app icon renders come from Apple's `ictool`.
- **Purpose:** headless, scriptable SVG → PNG for the brief's "render every asset to an image and look at it".
- **Alternatives:** Apple's `ictool` (app icons only); a Swift renderer through WebKit (heavy, needs a run loop); `qlmanage -t` (low fidelity, no control over size or background); Inkscape (not installed, large).
- **Maintenance:** GNOME librsvg, actively maintained; installed before this session.
- **Licence:** LGPL-2.1-or-later. It is a command-line tool used at build time and is never linked or bundled.
- **Sources:** `docs/research/08-icons-logos-app-icons.md` F14; review:icons finding F08-05; `rsvg-convert --version`.

## D-012: Confirmations use a Debbie sheet, not the system action sheet
- **Date:** 2026-11-14 10:49 EST
- **Decision:** Unpair, Mark as False Alarm and Turn On Live View confirm with `DebbieConfirmSheet`: a medium-detent `.sheet` with `DebbieSheetHeader`, one explanatory sentence, the action, and Cancel.
- **Options:** (a) SwiftUI `confirmationDialog` (a system action sheet on iPhone); (b) `.alert` (a system alert, which the brief exempts); (c) a Debbie sheet.
- **Reason:** The binding brief exempts only system *alerts* among system-drawn surfaces. An action sheet is a stylable presentation, so it must be Debbie's own. A sheet keeps the HIG's confirmation guidance (a specific verb, Cancel available, destructive styling) and our type scale and target sizes.
- **Sources:** KICKOFF_PROMPT.md §3 (custom controls, the exemption list); `docs/research/09-buttons-controls.md` R11; `lead-decisions.md` X22.

## D-013: App icon ships as an asset catalog with Any, Dark and Tinted variants
- **Date:** 2026-11-14 10:49 EST
- **Decision:** `AppIcon.appiconset` holds 1024-px Any, Dark and Tinted renders, generated by `Design/scripts/` from editable SVG sources. No `.icon` document ships.
- **Options:** (a) generate an Icon Composer `.icon` from scripts (it renders with `ictool`, as tested at 09:34); (b) the asset catalog.
- **Reason:** The binding brief allows script generation of a GUI-authored icon format only "where its file format is documented". Apple doesn't document the `.icon` JSON schema; note 08 reverse-engineered it from strings and experiment. So the brief's other branch applies: ship the appearance variants iOS still accepts in an asset catalog, record the gap here, and list it under "Decisions to confirm". iOS 26 and 27 still render asset-catalog icons with the system's glass treatment.
- **Sources:** KICKOFF_PROMPT.md §3; `docs/research/08-icons-logos-app-icons.md` (F6, R1–R3); review:icons F08-02; lead-decisions X24 and X55.

## D-014: Custom navigation chrome over NavigationStack
- **Date:** 2026-11-14 10:49 EST
- **Decision:** Hide the system navigation bar. Debbie draws `DebbieTopBar` and `DebbieBackButton`, and `DebbieSheetHeader` in sheets. Navigation still uses `NavigationStack`. Interactive swipe-back is tested first with the bar hidden on iOS 26.5. Only if it fails is a bridge added that sets a delegate on `interactivePopGestureRecognizer`, with a guard so the root screen can't pop. The SDK header says that property "should only be used to set up failure requirements", so the bridge is a recorded exception.
- **Options:** (a) the system navigation bar (forbidden by the brief's custom-control rule); (b) a fully custom stack (loses the system's interactive pop and its accessibility); (c) the above.
- **Reason:** It meets the brief's MUST while keeping the familiar back gesture the HIG expects. A UI test swipes back on every pushed screen.
- **Sources:** KICKOFF_PROMPT.md §3; `docs/research/02-ios-design-language.md` R11; review:motion F07; lead-decisions X44.
- **Outcome (12:15–12:31):** the test came first, as planned. `MainPathUITests` showed the edge swipe does **not** go back with the system bar hidden on iOS 26.5. I then tried the bridge in three versions (`interactivePopGestureRecognizer` delegate and enable; also iOS 26's `interactiveContentPopGestureRecognizer`; re-attached on every pushed screen; navigation controller found through the responder chain). None made the UI test's edge swipe go back, so I **removed the bridge** rather than ship an SDK exception with no proven benefit. Pushed screens go back with Debbie's Back button (tested). **Edge-swipe back is a known gap** (MORNING_REPORT §2 and §8). Next: a small `UINavigationController` subclass via `UIViewControllerRepresentable`, or SwiftUI's own navigation bar kept and styled once the brief's custom-chrome rule is confirmed for back navigation.

## D-015: Owner pivot — finish in about 2 hours, all deliverables kept
- **Date:** 2026-11-14 10:58 EST
- **Decision:** At the owner's request ("7 hours is far too long … maintain all results but push for a finish in 2ish hours"), finish around 13:00 EST with every deliverable (CRAFT.md, brand and design system, the app with every §5.1 flow, the fastlane pipeline, MORNING_REPORT) at reduced depth: remaining research fixers stopped; reviews become documented self-review passes (the account's 5-hour API limit was hit at 10:5x, so no more subagents until 15:00); screen gates on representative screens; a core custom icon set; live-view states proven through the demo home and the mock relay (the video engine itself is not built; D-016).
- **Options:** keep the brief's 8-hour plan (owner declined); cut deliverables (owner declined).
- **Reason:** The owner's direct instruction overrides the brief's timeline; the brief allows self-review when subagents can't be spawned, if the report says so.
- **Sources:** owner message 10:5x; API error "You've hit your 5-hour limit · resets 3pm".

## D-016: Live video engine not built tonight; every live-view state still works
- **Date:** 2026-11-14 11:50 EST
- **Decision:** No WebRTC dependency was added. The live-view state machine (requesting, denied, ready, connecting, playing, ending, ended by time limit / by you / by the resident / connection lost, failed) runs against the real relay session API (mock home) and the demo home. The networked app's media step uses `UnavailableMediaEngine`, which fails with "Couldn't start live view. Try again in a minute." The demo home uses a labelled fake camera.
- **Options:** (a) add a maintained community build of Google's WebRTC and a KVS signalling client tonight (can't be proven without AWS and a Layer 1 sender, and would cost most of the 2-hour budget); (b) this.
- **Reason:** The owner's 2-hour pivot (D-015). The brief never allows cutting the live-view *states*, and they are all reachable and tested. The engine is the first item in MORNING_REPORT §8.
- **Sources:** KICKOFF_PROMPT.md §5.1.5 and cut order; docs/research/11b-engineering-webrtc-testing-perf.md.

## D-017: Privacy manifest: no tracking, no collected data, no required-reason APIs
- **Date:** 2026-11-14 11:47 EST
- **Decision:** `App/PrivacyInfo.xcprivacy` declares `NSPrivacyTracking = false`, no tracking domains, no collected data types and no accessed API types.
- **Reason:** Alerts and status are end-to-end encrypted (the relay can't read them), heart rate goes only to the family's own home laptop over the local network, and there is no analytics, advertising or crash reporting. A grep found no required-reason APIs (UserDefaults, file timestamps, boot time, disk space). **Owner to confirm** the App Store privacy answers match before any public release.
- **Sources:** Apple, "Privacy manifest files" and "Describing data use in privacy manifests" (developer.apple.com/documentation/bundleresources/privacy-manifest-files).

## D-018: Brand on screen: ink-on-mint mark, a one-word "Demo" badge
- **Date:** 2026-11-14 11:52 EST
- **Decision:** The welcome screen shows the mark as an ink glyph on a mint tile (an approved pairing, CRAFT.md §2.8 B1). It had been deep green on near-white, which B1 doesn't allow. The demo badge reads "Demo" (VoiceOver: "Demo mode. Sample data."), and onboarding's title stays "Set Up" in the demo, so the screen never says "Demo Demo".
- **Reason:** B1; the 11:24 SE screenshot showed "Demo — sample data" wrapping onto two lines in the top bar.

## D-019: Accessibility sizes reflow instead of truncating
- **Date:** 2026-11-14 11:55 EST
- **Decision:** At accessibility text sizes `DebbieTopBar` puts the title on its own row, `DebbieLiveBar` stacks, and every fixed-height step (priming, code, paired, Add a Laptop, live view) scrolls. When the content fits it stays centred (`defaultScrollAnchor(.center, for: .alignment)`). Primary actions are pinned above the home indicator (`debbiePinnedAction`).
- **Reason:** The 11:41 AX5 screenshots on the iPhone SE showed titles broken mid-word ("De/mo/Ho/me") and truncated sentences. CRAFT.md §7 requires wrapping, not truncation, up to AX5.

## D-020: Mock home scope and binding
- **Date:** 2026-11-14 11:45 EST
- **Decision:** `MockHome/server.mjs` implements every control in docs/MOCK_HOME.md except the KVS signalling WebSocket and the browser "master" page, which only matter once a real video engine exists (D-016). It binds to 127.0.0.1 only, with no `--lan` option (this supersedes lead decision X37's opt-in). `MockHome/smoke.mjs` checks it end to end (22 checks).
- **Reason:** The binding brief §6 (127.0.0.1 only); the 2-hour pivot.

## D-021: `care_status` decodes the contract's nested shape
- **Date:** 2026-11-14 11:44 EST
- **Decision:** `CareStatus` now reads and writes `{"heart_rate": {"bpm","at","trend"} | null, "no_heart_data"}` (CONTRACTS.md §3.3). Before this it expected flat camelCase keys, so it would never have decoded Layer 4's messages. Unit tests decode the contract's own example.
- **Reason:** Found while writing the mock home against the contract.

## D-022: iPhone portrait only; iPad orientations listed
- **Date:** 2026-11-14 11:33 EST
- **Decision:** `UISupportedInterfaceOrientations~iphone` = portrait. The iPad key lists all four orientations, as Apple's templates do, though the app is iPhone-only (`TARGETED_DEVICE_FAMILY = 1`).
- **Reason:** Without the iPad key, Xcode 26.6 warns "All interface orientations must be supported unless the app requires full screen", and Release builds must have no warnings. Portrait matches the one-handed, glanceable use in CRAFT.md §1.
- **Correction (15:25):** the audit found the build was in fact universal: XcodeGen sets `TARGETED_DEVICE_FAMILY = "1,2"` on each iOS target, which overrides the project-level `1`. Each target now sets `"1"` itself, and `tools/ci/validate-ipa.sh` fails any IPA whose `UIDeviceFamily` isn't `[1]`.

## D-023: Demo-home behaviour details
- **Date:** 2026-11-14 11:38 EST
- **Decision:** The demo "laptop" confirms pairing after 5 s, long enough to read and compare the four digits. The demo never asks for Health access, since it uses sample readings. It does ask for notifications, so the demo shows the real priming flow. Live-view requests cycle through: ended by the person at home, live view off at home, normal (stop it yourself or reach the time limit), connection lost.
- **Reason:** DEMO_HOME.md (every screen and haptic reachable, no network, never mixed with real data).

## D-024: The mock home is compiled out of Release
- **Date:** 2026-11-14 11:33 EST
- **Decision:** The mock addresses (127.0.0.1:7480/7481) and the mock-mode switch are inside `#if DEBUG`. In Release, `.mock` falls back to `.auto`. `tools/ci/release-forbidden.txt` now fails a Release binary containing those addresses, any "(Debug)" UI string, or the Debug-only environment variable names.
- **Reason:** CLAUDE.md "Mocks, debug menus, fixtures and test hooks stay out of Release builds". Verified by `tools/ci/check-release-clean.sh` on the unsigned Release device build.

## D-025: Find the LAN gateway again by Bonjour
- **Date:** 2026-11-14 11:58 EST
- **Decision:** When the stored LAN address stops answering `/v1/hello`, `NetworkHomeService` browses `_debbie._tcp` for up to 3 s. It keeps services whose TXT `hub=` matches the first 8 characters of this home's hub key and resolves each by opening a TCP connection. It accepts a candidate only if it answers a `fetch` encrypted with this phone's own key, then stores it first in `lanAddrs`. There is at most one attempt every 15 s. Residents now probe too, so heart rate follows a moved gateway.
- **Options:** (a) re-pair after an address change (the brief forbids prompts and re-pairing); (b) trust any Bonjour result (a neighbour's or a spoofed service could answer); (c) this.
- **Reason:** Brief §6 ("rediscover it by Bonjour, confirm with a request encrypted with the phone's own key, and update the stored addresses"). The encrypted confirmation means only the real hub can be accepted.
- **Evidence:** `UITests/MockHomeUITests` moves the mock's gateway to another port (`lan/moved`, Bonjour re-registered) and measures the time to the first LAN fetch at the new address (PROGRESS.md, "Reconnection").

## D-026: fastlane as the delivery tool (build-time only)
- **Date:** 2026-11-14 15:40 EST (chosen at 09:40 and used since; this entry was missing, found by the 14:50 audit)
- **Decision:** fastlane 2.241.2, pinned in `Gemfile` and `Gemfile.lock` and installed by Bundler into the gitignored `vendor/bundle`. It runs only through `tools/ci/fl`, never in the app; nothing from it ships in the IPA.
- **Options:** (a) plain `xcodebuild`, `altool` and App Store Connect API calls with our own JWT code (more to own, and our own code would read the key); (b) Xcode Cloud (a GUI setup and an account service); (c) fastlane.
- **Reason:** Brief §7 asks for fastlane lanes, pinned per project through a Gemfile and Bundler. **Maintenance:** monthly releases; 2.241.2 was the newest on rubygems at 09:40. **Licence:** MIT.
- **Sources:** research note 12 (R1–R5); rubygems.org/gems/fastlane.

## D-027: Signing and upload: a dedicated keychain, signing items the lane creates, and the key read in place
- **Date:** 2026-11-14 15:40 EST
- **Decision:**
  - Manual signing with the App Store Connect API key only.
  - `.signing/debbie-signing.keychain-db` is appended to the search list. The default keychain is never changed.
  - `get_certificates` creates one Apple Distribution certificate in that keychain. `CER_KEYCHAIN_PATH` points every certificate check there, so nothing lists or imports into the login keychain.
  - `get_provisioning_profile` makes App Store profiles named `Debbie AppStore <bundle id>`, bound to that certificate only (`cert_id`, `skip_certificate_verification`, `ignore_profiles_with_different_name`).
  - The lane sets manual signing on the freshly generated project and regenerates it afterwards.
  - The upload is `xcrun altool --upload-package … --api-key … --api-issuer … --p8-file-path <ASC_KEY_PATH>`, so the key file is read where it is and never copied.
  - Capabilities are enabled only with the public `POST /v1/bundleIdCapabilities` (`create_capability`).
- **Options:**
  - (a) Automatic signing with `-allowProvisioningUpdates`: Xcode picks or creates certificates itself, so there's no control over which signing items are used.
  - (b) `match`: needs a git or cloud store, which means a remote, and the brief forbids remotes.
  - (c) `upload_to_testflight`: pilot writes a temporary copy of the `.p8` for altool (fastlane_core `itunes_transporter.rb` 63–97), which the brief forbids. Passing a changelog also makes it wait, with no time limit, for the build to appear.
  - (d) This.
- **Reason:** Brief §3 (Signing, Identifiers, TestFlight, the `.p8` rule) and §7. Every option and API was checked against the vendored fastlane 2.241.2 source by the 14:50 delivery review (`docs/research/gap-audit-2026-11-14.md`).
- **Owner-visible items it creates:** see MORNING_REPORT §9, with how to undo each.

## D-028: Export compliance: answered in Info.plist only
- **Date:** 2026-11-14 15:40 EST (the answer was set at 11:21; this records it)
- **Decision:** `ITSAppUsesNonExemptEncryption = NO` on the app target. Never answered through the API, fastlane or the website by the agent.
- **Reason:**
  - The build's only encryption is Apple's: CryptoKit (X25519, HKDF, HMAC, ChaCha20-Poly1305) and HTTPS through URLSession. Apple: "the use of encryption that's built into the operating system … is exempt from export documentation upload requirements".
  - There is no WebRTC yet (D-016). Revisit this when it ships, because it bundles its own DTLS, SRTP and TLS.
- **If a build ever shows Missing Compliance:** in App Store Connect › TestFlight › the build › Manage, the answer matching this key is "None of the algorithms mentioned above", since the app only uses encryption within Apple's operating system. The owner should confirm this (MORNING_REPORT §5).
- **Sources:** research note 12 F6 and R15 ([S28] [S29] [S33] [S35]).

## D-029: Tabs, a floating glass tab bar, a corner Settings gear and a white canvas
- **Date:** 2026-11-14 16:05 EST
- **Decision:**
  1. **Canvas.** `bg.canvas` is white (`#FFFFFF`, also under Increase Contrast). Cards take the soft mint-grey the canvas used to have (`#F3F7F5`; `#EEF3F0` under Increase Contrast). Every pairing was re-measured and passes (`Design/tokens/contrast-report.md`).
  2. **Caregiver tabs.** Four tabs, each with one job: **Home** (is everything all right?), **Live** (see the home), **History** (what happened?) and **Devices** (what's set up?).
     - They sit in `DebbieTabBar`, a custom floating Liquid Glass bar in `DebbieDesignSystem/Chrome/` (CRAFT D1–D3).
     - The selected tab gets a mint highlight that slides on `Motion.tabSlide` (0.35 s, bounce 0.15) and retargets if another tab is tapped mid-flight. Its icon turns filled and plays its own animation.
     - Only the selected tab exists; keeping hidden tabs alive leaked their header and pinned buttons to VoiceOver (found by the main-path UI test at 16:05). The new tab fades in while drifting 16 pt from its side, and the Home tab's navigation path survives switching.
     - Tab switches play no haptic.
     - The bar's glyphs and labels, and the corner gear, clamp at the xLarge text size, as the system's bars do. Beyond that the Large Content Viewer shows them. The main-path accessibility audit waives only `.dynamicType` issues, only on `tab.*` and `settings` elements (research note 16 R6).
     - Five tabs: labels may shrink to 80 % (about 10 pt, the system's own size) at 320 pt Display Zoom, rather than truncate (note 16 R1, F2).
     - Revised after research note 16 (16:40): the content cross-fades in 0.15 s instead of drifting, the highlight moves on `tabSelect` (0.30 s, no bounce), icon effects stay within 0.6 s / 15 % / 15° (symmetric glyphs excepted), the corner gear is glass, Close sits on the leading edge of sheets, Home's title is its status headline, a red count badge marks unanswered urgent alerts on Home, re-tapping Home returns to its root, and cards separate from the white canvas by ΔL* ≥ 4 / 10 / 6 / 14 (light / dark / light IC / dark IC).
  3. **Settings** is a gear `DebbieCornerButton` in the top-right corner of every main screen, opening a sheet.
  4. **Resident** stays one screen, without a tab bar, as simple as the app can be (brief §5.1.7). The gear is in the corner, a heart beats on new readings, and the sync icon spins.
  5. **Icon animations.** Every icon button has its own short animation (`DAnimatedIcon`, `IconMotion.swift`): home hops, camera pops, history rewinds, laptop lid lifts, gear turns, heart beats, sync spins. They are built from named springs within CRAFT M1. Under Reduce Motion only the outline-to-fill change remains.
- **Options:**
  - (a) The system `TabView`. It has a native glass bar, but the default look; the brief requires Debbie's own component for every stylable control.
  - (b) Keep the single home screen with text buttons. The owner found it "scrappily put together".
  - (c) This.
- **Reason:** The owner's direction at 15:44: "the main background … white", "a bar at the bottom, simplistic settings button in the corner, and minimal clean features on each tab", "custom icons and animations" for every button, and "an animation for … switching between tabs". Also CRAFT P4 and D1–D3, and HIG Tab bars (research note 16).
- **Sources:** owner, in chat; `docs/research/16-tab-navigation.md`.

## D-030: Debbie has a face: a layered vector avatar with a subtle idle animation
- **Date:** 2026-11-14 16:20 EST
- **Decision:**
  - **Who she is.** "Debbie" is a warm woman of about 45–55, drawn flat and rounded in the app's palette, with a brand-mint top. She guides onboarding (welcome, each step's question and the permission screens) and is the face of the centre tab.
  - **How she's built.** Nine vector layers (body, hair back, head, cheeks, open and closed eyes, brows, mouth, hair front) on one 200×200 canvas. The source is `Design/avatar/src/debbie.svg`, and `Design/scripts/export-avatar.sh` exports single-scale PDF imagesets. `DebbieAvatar` stacks them.
  - **Idle.** She breathes (≤ 1 % scale over 4.8 s), tilts her head (±2° over 7.3 s) and blinks (130 ms, every 3–6 s, sometimes twice). Under Reduce Motion she stays still with her eyes open. Until the layers exist, the mint "D" mark stands in.
- **Options:**
  - (a) An AI-generated raster portrait. It can't blink without frames, has no editable vector source and isn't custom-designed (brief §3).
  - (b) A 3D Memoji-like character. It doesn't match the flat icon and illustration family.
  - (c) This.
- **Reason:** The owner's direction at 16:16: "give debbie a face … a warm looking female individual, a slight idle animation, the art style which blends the best with the app". Brief §3 requires every asset to be custom-designed with a vector source and an export script. Idle amplitudes and blink timing come from research note 17.
- **CRAFT:** §3.6 adds idle motion as a third allowed repeating effect, beside `live` and `working`. It is allowed only while the avatar is on screen, and is static under Reduce Motion.

## D-031: Debbie's answers come from Google Gemini, in TestFlight builds only
- **Date:** 2026-11-14 16:20 EST
- **Decision:**
  - **Where it lives.** The centre tab is a conversation with Debbie, who summarises how the person at home is doing from the app's data: status, monitoring, laptops and sensors, heart rate, and every alert with its acknowledgement.
  - **How it calls Gemini.** `GeminiAssistant` calls Gemini's `streamGenerateContent` over HTTPS, with the key in the `x-goog-api-key` header. It reads the key from Info.plist `DebbieGeminiKey`, set from the gitignored `Config/Local.xcconfig`, which comes from `~/.config/debbie-ios/gemini.env`.
  - **Without a key.** When a build has no key, or tests force it, `OfflineAssistant` answers on the phone with the same facts in fixed wording.
  - **The owner's decisions (in chat, 16:16):**
    1. The key is built into TestFlight builds.
    2. **All the home's data is sent to Gemini with no consent step**: "we don't need to adhere to Apple review; this will remain in TestFlight, for presentation purposes … opt out of asking consent, this is not going to production".
  - **What Debbie still tells the user (not consent):**
    - Debbie's subtitle says "AI", and a line in the conversation says answers are written with AI (Google Gemini) from your home's data and can be wrong, and to call emergency services in an emergency (HIG Generative AI).
    - The device credential, the keys and the pairing secret are never part of what's sent.
- **Revised after research note 17 (17:05):**
  - **Model:** `gemini-3.5-flash-lite` with `thinkingLevel: "minimal"`. `gemini-2.5-flash` has been limited to past users since 18 Sep 2026. Only ids in the table (3.5 Flash-Lite, 3.8 Flash, 4 Hydrogen) are accepted.
  - **Request:** the stable `v1` endpoint; no `temperature` (deprecated); `safetySettings` at `BLOCK_ONLY_HIGH`; `store: false`. The constant system instruction is note 17 R9's text, and the home's data goes in the last user turn as one `<home_data>` block, with ages computed on the phone and no IDs, keys or home name.
  - **Resilience:** up to 2 retries (408, 429 and 5xx); "Summarizing the latest from home…" after 3 s; a time-out at 20 s with no text.
  - **Rules:** a reply guard for all-clears, clinical words and claims to be a person.
  - **Urgency:** the app draws its own urgent row at the top of the chat, so urgency never depends on the model.
  - **Control and design:** Stop while she writes; at most 3 suggestions; your bubbles on mint tint; small avatars held still.
- **Not for production. Before any App Store build:**
  - add explicit permission before sharing personal data with third-party AI (App Review Guideline 5.1.2(i));
  - minimise the data;
  - move the key out of the app (for example to the hub's `ask` path in CONTRACTS §3.4, where the team's design runs a local language model);
  - update the privacy manifest and the App Privacy details.
- **Options:**
  - (a) Phone → hub `ask` → the laptop calls Gemini. The key never ships, but nothing can answer until the bridge supports it.
  - (b) Apple's on-device Foundation Models. Private, but not Gemini, and only on Apple Intelligence devices.
  - (c) This, as the owner chose.
- **Sources:** owner, in chat; research note 17 (Gemini API; HIG Generative AI).

## D-032: The owner's 17:24 and 17:40 fixes, and the afternoon review's fixes (build 3)
- **Date:** 2026-11-14 17:24–18:10 EST
- **Decision (owner, in chat):**
  - **Light only.** "I requested the dark green background to be white": `UIUserInterfaceStyle` is `Light`, so a phone in Dark Mode still shows the white canvas. The dark tokens and the avatar's dark renditions stay in the catalog, measured, so following the system again is one Info.plist line. Departs from CRAFT C8 (amended).
  - **Debbie's eyes.** "Inverse with white pupils and black eyes … terrifying": the white catch-lights are gone. Her eyes are plain dark rounds (no white at all), and the closed lids are redrawn to match. The blink's squash lands on the lids' line (anchor y 0.471; the export script measures it). Compared on a render before choosing: plain dark almonds read as sleepy, while dark rounds read as warm.
  - **One blink at a time.** "Sometimes double blinks very fast … uncanny": no double blinks, and blinks at least 2 s apart (`MotionShapeTests` sweeps 10 minutes at 30 fps).
  - **Home scrolls to the end.** The tab bar floats over the pages, and each page pads its bottom safe area by the bar's measured height, inside its own NavigationStack. A bar attached outside the stack never reached Home's scroll view. The main-path UI test now scrolls Home and checks that the heart-rate card clears the bar.
  - **Back on every setup step** that has somewhere to go back to, including Scan the Code (owner, 17:40). The steps after pairing have none, because going back can't undo a pairing.
  - **The person at home, redesigned** (owner, 17:40: "make the grandmas side also more aesthetic"): a greeting with Debbie, the reading in a large mint card, "Sent to home at …", and one Sync Now. Sync Now keeps its colour and shows the spinner while it sends.
  - **No live-view switch** ("remove the switch to opt out of live video … this is not a production product"): the resident screen has no switch, and the demo's live view always plays. CRAFT P7 is marked suspended. **Restore it before any real use.**
- **Demo home and Gemini.** When a build has a Gemini key, Debbie answers in the demo home through Gemini too. The demo is what the owner presents, and the 16:16 decision sends the home's data to Gemini without asking. This departs from brief §6, where the demo home runs with no network. The current builds have no key, so they answer on the phone.
- **Afternoon review** (independent, three lenses: correctness, security/privacy, design/accessibility; each finding then verified by a second agent: 52 findings, 51 confirmed). **Fixed for build 3:**
  - The tab bar could stay hidden on Home after the chat's urgent Open was tapped while typing. Now it hides only while typing on Debbie's own tab.
  - Stop, the 20 s limit and the 45 s cut-off could keep a partial reply as a finished answer, or show the wrong error. A cancelled stream ends without an error, so the model now checks for cancellation. Stop shows nothing; both limits show "taking longer than usual".
  - Leaving the demo or unpairing during a reply could leave a stale error or bring the old reply back. Each ask now has a token that a reset clears.
  - `home_data` could drop an old unanswered urgent alert past its 10-alert cap. Now every unanswered urgent or attention alert is always listed.
  - Free text in `home_data` could start new lines or fields. Line breaks and bars are now removed, as well as angle brackets.
  - The reply guard missed "she's safe" and inflections ("abnormally", "arrhythmias"), and checked only each phrase's first occurrence. It is now whole-word regexes over the full reply, with a cut last word held back mid-stream.
  - History's I'm On It did nothing; it now acknowledges.
  - Home emphasised the first alert in the list; it now leads with the newest unanswered urgent alert.
  - The Debbie tab had no accessibility-size layout. At AX sizes the header and urgent row scroll with the chat.
  - Suggestions now wrap (`DFlow`) instead of scrolling sideways. The field grows to four lines, its outline meets 3:1, and its prompt uses `text.secondary`.
  - Chat scrolling is instant under Reduce Motion (`MotionPolicy.scroll`).
  - Try Again shows only when retrying can work.
  - VoiceOver hears failures.
  - `make-local-config.sh`, `check-logs.sh`, `gemini-smoke.sh` and `gemini-cases.py` now accept the README's `gemini.env` format (comments, no optional line). Before, a missing optional line aborted the script, and a trailing comment corrupted the key.
  - fastlane no longer passes the Gemini key to gym or altool.
  - The Release check forbids `DEBBIE_ASSISTANT`.
  - A new `DebbieFeaturesTests` target holds 8 tests for the guard, Stop, reset and finished answers.
- **After the build-3 screenshot check (18:15):**
  - **On-device answers rewritten.** Build 3 has no Gemini key, so these are the answers the owner will present. They had read like raw data ("(noticed 6:01 PM (just now))") and were the same whatever was asked. `OfflineAssistant` now answers the question asked (heart rate, alerts, whether everything is working, or an overview) in plain sentences:
    - an unanswered urgent alert comes first;
    - a home that can't be reached is said, whatever was asked;
    - a worried question ("Is she having a heart attack?") gets the emergency advice first.
    - `OfflineAnswerTests` (6) pin the wording.
  - **Two suggestions, one row.** With three wrapped chips, Debbie's answer was squeezed off the top on SE. "How are they today?" and "Any alerts?" fit one row on every iPhone at the default size, and wrap at larger sizes.
  - **Pairing Back.** On the real pairing path, Back while waiting for the laptop jumped to Scan the Code with "Can't find the home laptop" and a failure haptic: URLSession reports cancellation as `URLError.cancelled`. Back on the name step during the first send could also jump forward to the code. Both now cancel quietly.
  - `OnboardingBackUITests` walks the real path to Scan the Code and backs out to the first screen, with screenshots.
- **Second independent review, of the whole build-3 diff** (`wf_d1591b66-0f2`: three lenses, each verified adversarially; 28 findings, 25 confirmed, none on the demo's main path). **All fixed:**
  - **Pairing:**
    - Back from Check the Code now returns to Scan the Code with a fresh code and tells the person to press Cancel on the laptop. The hub keeps the first key's code until Cancel (CONTRACTS §4.2), so a retry with a new key got 409 `in_progress`, which the app had reported as a Wi-Fi problem.
    - `in_progress` has its own message.
    - A second tap on Continue no longer starts a second pairing, and the button shows it's busy.
    - The two messages that nothing could trigger were removed.
  - **Demo isolation:** the resident's reading, "Sent to home" time and note are cleared on Try the Demo, Leave Demo and Unpair. Before this, the demo's 68 bpm could show in a real pairing, and a real reading in the demo.
  - **On-device answers:**
    - events 12 hours old or more say how old they are ("at 4:31 PM, 2 days ago");
    - topics match whole words, and worry is caught wider ("isn't answering", "fell", "not responding") but not "help" or "painting";
    - "Any alerts?" always gives the monitoring state (CRAFT P2);
    - when the guard replaces a Gemini answer, the fallback answers the same question.
  - **Reply guard:**
    - it catches an all-clear about anyone ("your loved one is fine", "Mum's okay") and unusual spaces;
    - mid-stream, the bubble shows only words the guard has already judged;
    - a one-word answer is kept.
  - **`home_data`:** semicolons in laptop names become commas, so a name can't add sensor facts.
  - **Interface:**
    - at accessibility sizes the chat opens at the top, with the urgent row and the start of her answer in view;
    - the chip layout measures and places in one pass (a rounding gap could wrap a chip under the field);
    - a pasted line break no longer sends;
    - Back's slide changes direction before the step leaves (the steps had crossed);
    - History's I'm On It plays the acknowledged haptic;
    - the resident card and pill get Increase Contrast outlines;
    - the pill wraps inside a rounded rectangle at large sizes.
  - **Tests:** `DebbieFeaturesTests` now has 20.
  - **Refuted by the verifiers:** the privacy text, the `gemini.env` CRLF case and the pre-commit comment case.
- **Deferred (low, or not needed for the presentation):**
  - a "See What's Shared" view;
  - Increase Contrast cues on the tab bar's selection;
  - a "Tab n of 5" fallback for VoiceOver;
  - the heart's beat on restored data;
  - the bubbles' slide instead of a fade;
  - the resident's 44 pt gear (below the 96 pt resident tier);
  - the remaining CRAFT §5 drift;
  - a `home_data` fixture test (AppModel needs a stub HomeService).
  - Each is listed in the morning report.
- **Options:** for light only, (a) owner's choice, or (b) keep dark mode with a white canvas only in light. (b) doesn't answer "I want it white" on a phone set to dark.
- **Sources:** owner, in chat 17:24 and 17:40; `wf_828f2b27-567` review results; render comparison in the scratchpad; `Design/reviews/avatar/debbie.png`.

## D-033: The launch intro: a heartbeat that becomes the mark, then the welcome
- **Date:** 2026-11-14 20:55 EST (owner: "lets design the splash screen, meticulously animate this … based around a heart beat monitor, but just the line itself beating healthily, it should smoothly flow into the app's logo and then transition to the first screen")
- **Decision:**
  - **Where it lives.** iOS launch screens can't animate, so the system launch screen stays a plain colour (CRAFT B5), now exactly `bg.canvas` white (it had been the old `#F3F7F5` tint, which flashed before the first white frame). The intro is the welcome screen's first four seconds, in `WelcomeView`, built from `DebbieDesignSystem/Intro/HeartbeatIntro.swift` and the `Motion.Intro` tokens (CRAFT §3.7).
  - **The design.** A strip-chart monitor, already running in the first frame: the pen sits on the mark's stem and the paper flows left under it, so two beats (80 a minute, real P-QRS-T proportions) drift away and fade like phosphor. The paper brakes to a stop as the third beat's P wave passes, and that beat's upstroke is the mark: the pen climbs the stem and draws the whole outline in one 0.5 s movement while the old trace drains away. The line thickens and pools into the solid mark, the pen's mint glow swells into the tile on the settle spring, the wordmark rises in, and the lockup gives one small heartbeat. Then it glides to its place at the top of the welcome screen (a shared-element move on `present`) while the tile rounds into a circle and the mark becomes Debbie's face; the words and buttons rise in beneath it on the same spring, 40 ms apart. The mark is on its way by 2.9 s and the welcome is interactive at about 3.3 s; a tap anywhere skips to the handoff.
  - **Revised 22:55 (owner: "the initial heartbeat takes far too long … the text gets violently spit on the screen"):** the first cut ran 4.0 s with the mark starting at 2.35 s, and the words came in on a quick 0.25 s fade after the glide. Now the monitor is already running when the first frame appears, the beats come at 80 a minute with the third exactly on rhythm, the mark starts at 1.9 s, and the words ride the glide's own spring from 24 pt below instead of fading in after it.
  - **Revised 23:15 (the intro's independent review, `wf_afa9cf07-bfd`: three lenses, 27 findings, 23 verified by adversarial verifiers; all the visual ones fixed in build 5, the recorder's two tooling gaps fixed after it):** the words had re-wrapped frame by frame at the handoff because the welcome's column was only as wide as the hero slot until they arrived (the owner's "spat on the screen"); the column is now full width and the words exist, unseen, from the first frame. The strike no longer hesitates at the foot of the stem (a 0.22 s brake and a curve that starts with speed). The lockup's extra heartbeat is gone (it rode on the bloom's own settle and never read as a beat). Under Reduce Motion nothing changes shape any more (the tile fades out as Debbie, on her own circle, fades in). The mark shrinks away before Debbie arrives rather than dissolving 50/50 into her face. A skip, or VoiceOver starting mid-intro, fades the trace and glides the lockup home instead of cutting. The trail samples sit on a grid fixed to the paper, so the R peaks never waver. One stage advancer replaces three ordered flags, so a late tick can't strand the view.
  - **Revised 23:35 (owner: "the heartbeat intro is still a couple seconds too long"):** the beats themselves were cut. The first beat is already on the strip, drifting, when the app appears (it struck half a second before the first frame); the second strikes at 0.25 s and is the one that becomes the mark, one beat later, at 1.11 s. The mark is complete at 1.53 s, the lockup glides at 1.95 s and the welcome is interactive at about 2.5 s (build 4: 4.0 s; build 5: 3.4 s). The rhythm is still even at 80 a minute, and nothing else changed.
  - **One clock.** `IntroPose.at(t)` is a pure function of time, the same approach as Debbie's idle, driven by a `TimelineView`. Nothing sleeps or chains callbacks (M4). The handoff is the one real SwiftUI animation, so the frame change is a spring.
  - **When it plays.** Only when the app opens on the welcome screen, once per process (`IntroGate`): a paired caregiver opening to an alert never waits, and it doesn't replay after unpairing or leaving the demo. With VoiceOver running it doesn't play at all. Under Reduce Motion nothing moves: the finished lockup fades in where it will stay, then the words cross-fade in (1.6 s in all).
  - **Rhythm and geometry** are tested (`IntroShapeTests`: an ordered timeline inside 4 s, the mark drawn and filled from one path, a healthy rhythm, every pose within bounds, the pen fixed while the paper moves); the behaviour is tested on the Simulator (`IntroUITests`: it ends on the welcome, a tap skips it); the motion is recorded frame by frame (`tools/video/record-intro.sh`, CRAFT N7).
- **Options:**
  - (a) No intro, as the HIG advises for launch (fast, nothing to wait for). Rejected by the owner's direction; kept for returning caregivers, who never see it.
  - (b) A sweep-style monitor (the pen moving across a still trace). Rejected: the pen would have to end where the mark is, so the trace could use only half the screen, or the logo would form off-centre and then slide.
  - (c) The strip chart (chosen): the motion is continuous (flow, brake, strike), the logo forms in place, and the deceleration gives the moment before the mark its weight.
  - (d) Morphing the line's points into the mark's outline. Rejected: it needs matched point counts and reads as a shape-tween; having the beat *draw* the mark is simpler and truer to a monitor.
- **Reasons:** the owner asked for a portfolio-grade piece built on the heartbeat; the app's subject is a heart; the mark's stem is a natural R wave. Keeping it off returning launches respects the HIG and a caregiver's urgency; Reduce Motion and VoiceOver get the brand without the motion.
- **Sources:** owner, in chat 20:55; HIG Launching ("avoid displaying a splash screen… make launch fast"); HIG Motion (Reduce Motion, don't make motion essential); CRAFT §3 (M1, M4, M5, M8, M9); WWDC23 "Animate with springs" (`Spring.value(fromValue:toValue:initialVelocity:time:)`).

## D-034: Motion fixes found by the designer kit's independent motion review
- **Date:** 2026-11-14 22:20 EST
- **Decision:** while building the designer kit (owner, 20:01), the motion reviewer measured build 3's animations against CRAFT.md and found four defects. Fixed:
  - **The acknowledged haptic could play twice** (from Home's trigger and from the alert screen's own), and not at all from History. It now plays from one place, the caregiver root, which is alive whatever screen acknowledged.
  - **An alert answered with I'm On It left Home with no animation** (T8). The list animated only when alert IDs changed. It is now keyed on acknowledgement too, and cards use `motion.alertCard`: in from the top (T7), out by fading (T8).
  - **Sync Now's turn never showed** because the icon gave way to a spinner in the same update. The icon stays, turns on the tap and again on success, and "Sending…" is the working state.
  - **The intro's bloom** starts at half size with a 0.2 s fade, so the tile reads as a swell of light rather than a small square appearing.
- **Left as is, recorded:** the pop on I'm On It, Send and Stop cannot show, because each of those buttons leaves the screen in the same update (the card fades out, the field empties, the live view ends). The press feedback and, for I'm On It, the success haptic and the fade carry the moment. `unpairIncomplete` cannot play on the real path either (the screen that would show it is already gone); it stays on the later list with real-home testing.
- **Sources:** the kit's motion review (`wf_ba022345-f68`, motion lens); CRAFT.md §3.3 T7/T8, §3.5, §4.

## D-035: Two bugs found on a device: Unpair with the laptop off, and Add a Laptop's camera
- **Date:** 2026-11-15 00:20 EST (owner, testing build 6 on an iPhone with a real laptop, 23:5x: "turned off the qr code on the laptop, and tried clicking 'unpair this iphone' which is not working at all. furthermore the add a laptop button isnt working either, it says scan the code on the new laptops screen but there is nothing below it, no camera opens")
- **Reproduced first** (`UITests/DeviceBugsUITests.swift`, against the mock home on 127.0.0.1 with a new `home/off` control that makes the LAN gateway and the relay stop answering, and a Debug-only stand-in camera, `DEBBIE_FAKE_CAMERA=1`, that sizes like the real one): the camera measured **0.0 pt** in the Add a Laptop sheet, and after confirming Unpair the app was **still on Settings 8 s later**.
- **Causes:**
  - **Camera:** VisionKit's scanner view has no intrinsic size. `QRScannerView` gave it only a maximum height, and Add a Laptop puts it in a scroll view, which proposes no height, so it collapsed to nothing. Pairing's scan step isn't in a scroll view, which is why pairing worked. The Simulator shows a placeholder with its own height instead, so no test could see it.
  - **Unpair:** it told the home first, one route after another (a 1.5 s LAN hello, a 3 s Bonjour browse and a 3 s address check, a 3 s LAN command, then two relay calls with 10 s timeouts on a session that waits for connectivity), with the confirm sheet already closed and nothing on screen. It looked dead, and a second press started a second unpair.
- **Fixes:**
  - **Camera:** the scanner always has a minimum, an ideal and a maximum height (CRAFT §5 QR scanner). It asks for the camera if nobody has yet (not in the demo), and scanning restarts on the next update if it hadn't started.
  - **Unpair:** the hub command and the relay call run together and are abandoned after 4 s (`NetworkHomeService.firstOf`, which, unlike a task group, never waits for the work to wind down). The keys are deleted whatever happens. The button reads "Unpairing…" and ignores another press. When the home couldn't be told, the welcome shows CRAFT's failure copy and plays `unpairIncomplete`, which until now could never play (D-034's deferred note).
- **Tests:** the reproduction tests now pass (camera 280 pt; unpair back on the welcome in 4.1 s with the notice). New `UnpairDeadlineTests` (3). The mock-home pairing test still unpairs normally with the laptop on.
- **Found on the way:** the welcome's buttons had been laid out (unseen) from the first frame since the intro's handoff fix, so a UI test could press "Get Started" through the end of the intro. They are now disabled until shown, which also keeps Switch Control and VoiceOver off them. Every UI test's tap helper now waits for a button to be enabled.
- **Not changed, noted:** other commands (I'm On It, live view) can still wait up to the session's 10 s request timeout when the laptop is off. They update the screen first and don't block it, so they're on the later list rather than this build.
- **After the fix's independent review** (`wf_095bdbb1-ce4`: two lenses, 12 findings, 8 verified; all fixed in build 8):
  - **Build 7 regression: the false notice after a successful unpair.** Running the hub command and the relay revocation at the same time let the revocation land first, so the hub refused the command as "device removed" and a successful unpair showed the "couldn't reach the home laptop" notice. Now the hub is told first (up to 2.5 s, with no Bonjour search), then the relay revokes the credential (the rest of the 4 s). The home counts as told if either succeeded, or answered "already removed". A phone the home removed first therefore unpairs without the notice too.
  - **The scanner kept stopping after a wrong code.** A code the screen rejects no longer stops the camera: it keeps looking and ignores that same code for 3 s (`ScanGate`, unit-tested).
  - **The double-unpair guard now lives in the model** (`AppModel.isUnpairing`), so closing and reopening Settings can't start a second unpair that resets the app later.
  - **The welcome's buttons** are untouchable and hidden until shown, but not `.disabled`: the disabled colours had blended into their rise. UI tests start without the intro instead.
  - **The notice's wording** now follows the laptop's own page ("under Phones, press Remove"). While iPhone asks for the camera, the panel behind the prompt says what the camera is for, not "isn't available".
- **Sources:** the owner's report; the reproduction tests; the independent review `wf_095bdbb1-ce4`; the bridge's setup page (`layer1/bridge/src/pairing-page.ts`, read only).

## D-036: Off home Wi-Fi the app reaches the relay: LAN calls stop waiting for connectivity
- **Date:** 2026-11-15 01:45 EST
- **Decision:** `NetworkHomeService` uses two URL sessions instead of one (`HomeSessions.swift`). The LAN gateway's session (the hello, every `lanRequest`, the pairing POSTs and the Bonjour candidate check) has `waitsForConnectivity = false`, a 3 s request timeout and a 5 s resource timeout; the per-request 1.5 s (hello) and 3 s (LAN calls) stay. The relay's session keeps `waitsForConnectivity = true` with a 10 s request timeout and, new, a 20 s resource timeout. With it, the relay's replies are read properly: a refusal is decoded as `{"v":1,"error":{…}}` (so 401 `device_removed` now throws `HomeError.removed`), `refresh()` checks for 2xx before decoding a page and otherwise throws `HomeError.server("<route> <status> <code>")` and logs the status and code (never the credential), and `/v1/home` is decoded by its `hub` field. Both sessions and the pairing store (`PairingStore`, which `SecureStore` adopts) can be injected for tests; the app's call sites are unchanged.
- **The bug (owner's iPhone, on cellular):** "Can't connect to Debbie", and a packet capture on the relay saw no connection from the app for a full minute with the app open, while Safari on the same phone loaded the relay's `/healthz`. The one session had `waitsForConnectivity = true`, so the hello to the stored LAN address, which can't be reached away from home, waited for connectivity: the request timeout doesn't apply while a task waits, only the resource timeout (7 days by default). `refresh()` never got past the LAN check to the relay; going to the background cancelled it (-999) and the screen showed "Can't connect". Reproduced on macOS with the same configuration (still waiting at 150 s; with `false`, failed with -1001 after 1.52 s). Commands (I'm On It, laptop approval, the live-view setting), heart rate and pairing hit the same wait whenever the LAN address was unreachable. Ruled out, against the real relay code: the cursor, the reply's shape, sign-in, DNS/TLS/ATS and the relay URL in the pairing bundle.
- **Options:**
  - (a) Turn `waitsForConnectivity` off for everything. Rejected for the relay: leaving home Wi-Fi for cellular has a moment with no usable network, and failing then would show "Can't connect" for a whole refresh interval.
  - (b) Keep one session and only add a resource timeout. Rejected: the LAN check would still cost the whole resource timeout on every refresh away from home, and the relay's limit has to be long enough to ride out a network change.
  - (c) Two sessions (chosen): the LAN gateway is only worth using when it answers at once, so its calls fail at once; relay calls may wait for a network, but at most 20 s, inside the brief's 30 s reconnection target.
- **Tests:** `OffHomeWiFiTests` (5). The regression test pairs a phone whose LAN address is TEST-NET-1 (192.0.2.1:7480), uses the production LAN session and a stubbed relay, and races `refresh()` against a 15 s deadline: on the old code it was still waiting at 15 s (and the three relay-reply tests failed with `DecodingError` or the wrong hub state); with the fix it returns the relay's alert in 4.6 s (the 1.5 s hello plus the 3 s Bonjour search). Package tests use an in-memory pairing store: a Swift package's test bundle has no Keychain entitlement on the Simulator (`SecureStore` answered `missingEntitlement`).
- **Sources:** Apple, `URLSessionConfiguration.waitsForConnectivity` ("the session waits for connectivity… the timeoutIntervalForRequest property doesn't apply, but the timeoutIntervalForResource property does") and `timeoutIntervalForResource` (default 7 days); the owner's on-device report and the relay's packet capture; the macOS reproduction; `layer1/relay/src/phone-api.ts` (read only) for the error and `/v1/home` bodies.
