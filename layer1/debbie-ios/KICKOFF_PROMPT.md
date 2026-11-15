# Debbie iOS: overnight kickoff brief

## Before you start (owner)

The agent can't do these, and the night is wasted without them:

1. Plug the Mac into power and keep the lid open.
2. Create `~/.config/debbie-ios/asc.env` with six lines: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_PATH` (the path to an App Store Connect API key `.p8`; a Team key with the Admin role is simplest, and you can revoke it after the hackathon), `APPLE_TEAM_ID`, `BUNDLE_ID`, and `DEMO_IOS_VERSION` (the iOS version on the demo iPhone, from Settings → General → About).
3. Register `BUNDLE_ID` under Certificates, Identifiers & Profiles, and create the app record in App Store Connect with it.
4. Make sure an internal TestFlight group exists that includes you, with automatic distribution turned on.
5. Start Claude Code in this folder with permission prompts off, so it never stops for approvals: `claude --dangerously-skip-permissions` in Terminal, or in VS Code the same bypass mode as the session that wrote this brief. Give it: `Read KICKOFF_PROMPT.md and follow it.` Watch the first few minutes and check that a shell command and a web fetch run without a prompt.
6. Optional: start it as `/loop Read KICKOFF_PROMPT.md and follow it, resuming from PROGRESS.md.` instead, so it picks up again if it ever stops.

---

> For the Claude Code agent working in `~/Desktop/debbie-ios`. Read all of it before you act. It is binding. MUST and MUST NOT allow no exceptions. Where it leaves a decision to you, decide through research, write down why in `docs/DECISIONS.md`, and keep moving. This file is read-only for you.

## 0. If you are resuming

If `PROGRESS.md` exists, you have worked here before. Read `CLAUDE.md`, this brief (`KICKOFF_PROMPT.md`), `PROGRESS.md` and `CRAFT.md` (if it exists), then continue from the "Next step" recorded in `PROGRESS.md`. Never restart a phase that is finished. Before continuing, check `pmset -g assertions`; if no caffeinate assertion holds, start `caffeinate -dims -t 43200` in the background again and note it in `PROGRESS.md`.

## 1. Mission

You are the design and engineering lead for the Debbie iOS app, working alone through the night while the owner sleeps. By morning, deliver:

1. **`CRAFT.md`**: your curated, master-level iOS design and engineering practice for this app, distilled from your own research into what makes Apple's featured and award-winning apps exceptional. Everything you build follows it.
2. **A design system and an original brand**: palette, type, layout, motion, haptics, components, iconography, logo, app icon and every other asset, designed by you around the owner's direction in section 4.
3. **The app**: Debbie for iPhone, with a caregiver role and a resident mode, meeting section 5 and running end to end against a mock home.
4. **Delivery**: a fastlane pipeline that tests, builds and uploads to the owner's TestFlight, and the newest build that passes every gate installable from the owner's internal TestFlight group.
5. **`MORNING_REPORT.md`** for the owner.

A smaller app that meets the bar beats a bigger one that doesn't. The demo-critical flows in section 5.1 must still exist by morning.

## 2. Time

Run `date` when you start and record the start time in `PROGRESS.md`. Plan for about 8 hours, with these checkpoints from the start time: orientation and the signing dry run by 0:30, research by 1:30, `CRAFT.md` by 2:10, brand and assets by 3:00, project, pipeline and first upload by 3:30, design system by 4:10, the demo-critical flows by 7:00, then polish, the final build and the report.

If you fall behind, cut scope inside a phase before you relax its gate, following the cut order in section 8. If a gate truly can't pass, record why and what you did instead. Do not end your session early: if everything is done, work through "If you finish early" in section 8. If you are still running after 8 hours, keep improving against the checklist until the owner stops you.

## 3. Non-negotiables

### Process

- MUST, right after starting `caffeinate` in Phase 0, create `CLAUDE.md` in this folder holding these non-negotiables (condensed, nothing dropped), a pointer to this brief as the full binding instructions, and pointers to your working files. At the start of every phase, re-read that phase's section here and every section it refers to.
- MUST keep `PROGRESS.md` current: start time, plan, current phase, what's done (with evidence), what's in progress, the next step, blockers and TestFlight uploads. Update it after every meaningful step.
- MUST research before deciding (section 9). Every rule in `CRAFT.md` comes from research with cited sources, primary sources first (Apple's Human Interface Guidelines, Apple developer documentation, WWDC sessions, Apple Design Award and App Store editorial pages), or from reasoning you write down. Your own taste is not a source.
- MUST NOT copy any app's visual identity, assets, layouts or copy. Learn what makes great apps great, then create Debbie's own.
- MUST commit to a local git repository in this folder at every working checkpoint, with clear messages. MUST NOT push, add remotes, or open pull requests or issues anywhere.
- MUST NOT wait for a human. Nobody will answer tonight. When a decision belongs to the owner, take the most conservative option that keeps work moving, list it under "Decisions to confirm" in `MORNING_REPORT.md`, and continue. If a tool call is refused or asks for approval, record it under Blockers and carry on with the tools that work. Never change Claude Code's permission settings.
- MUST NOT call anything done without evidence: a build log, a passing test, a screenshot you have opened and looked at, a screen recording whose frames you have inspected, or an App Store Connect response. Never report an upload, test or feature as working unless you have seen it work.
- MUST use independent review where this brief asks for it: a fresh subagent with no stake in the work, told to find problems rather than praise. If you can't spawn subagents, do the review yourself as a separate pass against the checklist, and say so in the report.

### Design (the owner's direction, section 4)

- MUST make a minty green the signature colour, inside a complementary palette that is simple, calm and easy on the eyes, in light mode, dark mode and increased contrast. The signature colour MUST read as mint to anyone looking at it. Where contrast rules forbid mint for text or behind text, use companion tokens for those roles and keep mint as the visible identity. Never shift the signature colour toward teal, sage or forest green to pass a contrast check.
- MUST reach the craft of apps Apple features: spring-based, interruptible motion; purposeful haptic feedback; fluid transitions with continuity. Every animation and every haptic in the code comes from tokens named in `CRAFT.md` (named springs, named transitions, named haptic events), so they can be checked. A test or lint MUST fail on raw animation curves or haptic calls outside the design-system code.
- MUST custom-design every asset: the logo and wordmark, the app icon in every variant the current iOS uses, a complete icon set, buttons and controls, empty states, the launch screen, and any illustrations your research calls for. No stock or downloaded art, icon packs, third-party UI kits, or placeholders in any build you upload. Every asset MUST have an editable vector source in the repo and a script that exports it. If the current app icon format is normally authored in a GUI tool, generate it from your scripts where its file format is documented, and prove it compiles with `actool`. Otherwise ship the appearance variants (default, dark, tinted) that the current iOS still accepts in an asset catalog, record the gap in `docs/DECISIONS.md`, and list it under "Decisions to confirm".
- SF Symbols, and any other system-provided icon or glyph, count as stock icons: they MUST NOT appear anywhere in the app's own interface (tab bars, toolbars, navigation, buttons, lists, empty states, notification content, widgets). Every control the app can style (buttons, toggles, segmented controls, tab and navigation bars, back buttons, sheet headers, progress indicators, text fields) MUST use Debbie's own component, never the system's default look. Where following Apple's current design language would mean using a system-drawn control unchanged, build a custom component that meets the same guidance, and record the choice in `docs/DECISIONS.md`.
- Only surfaces the system draws and an app can't restyle are exempt: permission prompts, the share sheet, the keyboard and system alerts. Apple's system typefaces are allowed. Any other typeface needs a licence that permits bundling it, recorded in `docs/DECISIONS.md`.
- MUST treat accessibility as a hard requirement: VoiceOver, Dynamic Type up to the largest accessibility sizes, Reduce Motion, Increase Contrast, and colour never the only signal. The thresholds come from your research and go in `CRAFT.md`.

### Engineering

- MUST build, test and ship entirely from the command line. No step may need the Xcode GUI, a GUI dialog, or a password typed in.
- MUST keep the final build free of warnings from Debbie's own code and project settings, and the test suites green. A warning that comes from a prebuilt third-party binary and can't be fixed without rebuilding it is recorded word for word in `docs/DECISIONS.md` and doesn't fail a gate.
- MUST NOT add a third-party dependency without a justification in `docs/DECISIONS.md` covering its purpose, alternatives, maintenance and licence. The live viewer needs a WebRTC library; the Layer 1 doc explains why it must be a maintained community build of Google's WebRTC.
- MUST NOT add analytics, tracking, advertising or third-party crash-reporting code.
- MUST keep mocks, debug menus, fixtures and test hooks out of Release builds. The one exception is the on-device demo home described in section 6.
- MUST keep the project relocatable: no absolute paths in the project, the scripts or the fastlane setup.

### Security, accounts and limits

- MUST NOT commit, print or log secrets: App Store Connect keys, certificates, provisioning profiles, passwords, device credentials, the home key. Check credentials for presence only, never print their values, and never open, copy or print the `.p8`. Keep build, fastlane and test-result logs in a gitignored folder. Before every commit, check that the staged changes contain none of `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_PATH` or any content of the `.p8`. `BUNDLE_ID`, `APPLE_TEAM_ID` and `DEMO_IOS_VERSION` are not secrets: either commit them, or generate a gitignored build-settings file from `asc.env` so other contributors can build with their own; record which in `docs/DECISIONS.md`. Your `.gitignore` MUST cover at least `*.p8`, `*.p12`, `*.cer`, `*.mobileprovision`, `*.ipa`, `*.dSYM.zip`, `fastlane/report.xml`, and the build and log folders, and it must exist before any such file can.
- Apple credentials (the App Store Connect API key, and anything signing needs) come only from `~/.config/debbie-ios/asc.env` (see "Before you start") and the signing items this section lets you create. Read it at run time. If the file, a credential or the key is missing or invalid, MUST NOT use any other credentials and MUST NOT search the disk or the keychain for any: build, test and archive locally, keep the pipeline ready, and record the blocker. Reading GitHub with the machine's existing `gh` login is allowed, read-only. `DEMO_IOS_VERSION` is not a credential: if it's missing, keep uploading, set the minimum iOS version to the lowest your research supports for `CRAFT.md`, and list that first under "Decisions to confirm".
- MUST authenticate fastlane with that App Store Connect API key only, non-interactively (standard input closed), so any step that wants an Apple ID fails rather than waits. MUST NOT attempt Apple ID password or two-factor login.
- **Identifiers.** You may register only `BUNDLE_ID` itself (if the owner hasn't already), extension IDs of the form `BUNDLE_ID.<suffix>`, and the app group and Keychain group that match `BUNDLE_ID`. On these identifiers, including the `BUNDLE_ID` the owner registered, you MAY enable the capabilities the uploaded app uses and create provisioning profiles for them. List each capability in `PROGRESS.md` before enabling it, and never disable or remove one. Never modify or delete any other identifier or capability. If `BUNDLE_ID` or `APPLE_TEAM_ID` is missing, register nothing.
- **Signing.** MUST NOT revoke, delete, regenerate or modify any existing certificate, provisioning profile, identifier, key or app in the developer account. Enabling capabilities on Debbie's own identifiers, as the Identifiers rule allows, is the one exception. MUST NOT change the default keychain or remove anything from the keychain search list. If you add a keychain, append it to the search list, and record it and how to undo it. If the team is at its certificate limit, stop and record it; never free a slot.
- **TestFlight.** MAY upload builds for internal testing and add them to an existing internal group. If no internal group exists, MAY create one containing only people who are already App Store Connect users on the team. MUST NOT invite anyone, create external groups, submit anything for App Review or Beta App Review, or change other App Store Connect settings.
- **Export compliance.** Set only the Info.plist answer your research supports. MUST NOT answer export compliance questions, upload compliance documents or change compliance settings through the API, fastlane or any other route.
- MUST NOT use any AWS or other cloud account, deploy anything, or spend money.
- MUST NOT write outside this folder, except tool caches, the user-level installs your build needs (Homebrew packages, Ruby gems through bundler) and the signing items allowed above. MUST NOT use `sudo`. Record every install and every signing item you create, with how to undo it, in the report.
- The team repository is read-only for you: read it with `gh`, never write to it.

## 4. The owner's direction

In the owner's words: a "minty green color matched with a complementing rest of the color palette that keeps it simple and easy on the eyes"; "strict design practices"; features that "apps like Apple featured apps contain, like spring mechanics, haptic feedback, fluid transitions"; "all assets, buttons, logos should all be custom designed"; and a practices file of "master designer and iOS developer practices" so the app "maintains utmost quality".

As requirements (how you meet them is yours to research and decide):

1. **Colour.** Build the palette as semantic tokens for light, dark and increased contrast. It must show real urgency, such as a possible fall, without breaking the calm everywhere else, and it must work for colour-blind users. Measure every text and icon pairing against contrast thresholds from your research and record the ratios in `CRAFT.md`.
2. **Featured-app craft.** Find out what Apple's featured and award-winning apps do that ordinary apps don't, and bring it to Debbie. At minimum: spring mechanics (physically based, interruptible, carrying gesture velocity), haptics (deliberate, consistent, matched to meaning, never noise) and fluid transitions (continuity between screens and states, no jumps or flashes). Find out what else those apps have in common, and decide with reasons what Debbie adopts tonight and what goes on the later list.
3. **Simplicity.** Calm, uncluttered and easy on the eyes. `CRAFT.md` must define, from research, what simplicity means for each screen and how to check it.
4. **Strictness.** Rules in `CRAFT.md` must be specific and checkable. "Use whitespace generously" is not a rule; a spacing scale with values and when to use each is.

## 5. What the app does

The Layer 1 design doc defines the behaviour; this section is the checklist. Read the doc for the details and use its terms: coordinator laptop, bridge, LAN gateway, hub connector, relay, hub, home key, a phone's own key, device credential.

### Sources (read before research)

- **Layer 1 design doc**, the source of truth for everything the app connects to: `/Users/chava/Desktop/layer 1/docs/layer1-join-and-connect.md`, also on GitHub at repository `lucasting1220/hackprinceton`, branch `layer-1`, path `docs/layer1-join-and-connect.md`. The two should match. If they differ, use the one changed most recently, record which and why in `docs/DECISIONS.md`, and list it under "Decisions to confirm". Re-read the doc at the start of every phase that touches networking, cryptography, push or live view, because it may change tonight.
- The doc's "Instructions for Claude Code", "Build order", "Prerequisites" and "Acceptance tests" sections are written for the team's laptop-and-cloud agent, not for you. Use them only to understand behaviour. You build only the iOS app and its mock home, in this folder. You never build the bridge, the relay or the sender, and you don't run the doc's [demo] tests.
- **Work already done by others**: before writing or changing any contract, read (never write) branch `layer-1` on GitHub: `layer1/contracts/`, `layer1/bridge` and `layer1/cloud`, if they exist. Repeat at the start of each networking phase (section 6).
- **Layer 2 design doc**, for context: the same repository, branch `layer-2`, `docs/layer2-device-management.md`.
- **Product concept and roadmap**: `docs/context/concept-roadmap.md` in this folder.
- **Team notes and the judging rubric**: `docs/context/team-layer-notes.md` in this folder.

Where the concept disagrees with the Layer 1 doc, the Layer 1 doc wins. It reflects later decisions: several pooled laptops, an encrypted live view the resident must turn on, and end-to-end encrypted alerts.

### People

- **Resident**: an older person who mostly lives independently, at risk of falls or heart problems, wearing an Apple Watch. Uses resident mode, which sends heart rate.
- **Caregiver**: usually an adult child or relative living elsewhere. Must understand an alert and act on it quickly, often under stress, and doesn't want to watch video all day.
- **Installer**: often the caregiver, often not technical.
- **Judges**: the app is demoed to hackathon judges, who score utility, innovation, social need and the team's passion. The pitch targets lower-income families who can't afford a care home.

Work out from research what these people need in legibility, touch targets, tone, and urgent versus calm states.

### 5.1 Demo-critical (build in this order)

1. **Pairing** (the doc's "Pair a phone" and "Phone ↔ hub messages"): bring up the Local Network prompt first; scan the coordinator laptop's QR code (its LAN addresses, the hub's public key, a one-time secret and an expiry); create the phone's key pair; send the pairing request with its proof, the user-editable phone name and the role; show the 4-digit code the person confirms on the laptop; receive and decrypt the pairing bundle; store everything in the Keychain group shared with the notification extension, readable after first unlock. Roles: caregiver or resident. Design clear states for an expired or already-used code, the wrong network, and retry.
   - **Keys.** The home key (caregivers only) decrypts what the hub sends to caregivers. The phone's own key encrypts everything the phone sends to the hub: acknowledgements, laptop approvals, live-view requests, settings changes and heart rate. The device credential is shown only to the relay, over HTTPS, and is never an encryption key or sent over the LAN.
2. **Alerts**: fetch encrypted messages (from the relay, or from the LAN gateway on home Wi-Fi) and decrypt them with the home key. Show alerts using the fields in the doc's "Handoff to Layer 4" (`alert_id`, `kind`, `severity`, `detected_at`, `title`, `body`, `update`).
   - `alert_id` identifies an alert across push, the relay and the LAN gateway, so deduplicate by it, keep a fetch cursor, and store the history locally.
   - Order and label alerts by `detected_at`, not by when they arrived. When an alert arrives late, show both times.
   - An update changes only the wording, and never clears the caregiver's acknowledgement.
   - Acknowledgements (with the `false_alarm` flag) are encrypted with the phone's own key, safe to send twice, and queued until sent.
3. **Push** (caregiver phones only): register the push token with the relay, together with its environment. The notification extension handles two kinds of payload: alerts the hub encrypted, which it decrypts with the home key (showing safe generic text if it can't), and plain notices the relay writes ("hub offline", "back online"), which it shows as sent, with the time in the phone's time zone. Follow the doc's "Push" section for the payload, the size limit and the collapse ID.
4. **Status**: Layer 1's status header with three states.
   - Connection: whether the relay is reachable, and the hub's last contact, which comes from the relay.
   - Monitoring: from the latest decrypted heartbeat. If the heartbeat is older than two intervals, show monitoring as unknown, never as healthy.
   - Language model: from Layer 4's health.
   - "Can't reach home", "monitoring degraded" and "this phone was removed from the home" are first-class states. Never show an all-clear you can't confirm.
5. **Live view** (caregivers only; follow the doc's "Live view"):
   - Send a live-view request encrypted with the phone's own key (request ID, time and a fresh viewer client ID) and get a session ID.
   - Poll for "ready" or "denied" (the relay's HTTP calls end after 30 seconds). On "ready", fetch the viewer URL and ICE servers, and connect with the WebRTC library. The phone never holds AWS credentials or uses an AWS SDK.
   - Video only, no audio. Show the 5-minute limit, and make it unmistakable that the camera is live.
   - Stop calls the relay before tearing down. Show why a session ended: time limit, you stopped it, the resident turned live view off, or the connection was lost.
   - Keep watching sends a new request, which can come back "denied".
6. **Add a laptop** (caregivers only): scan the new laptop's QR code, show its name, approve, and send the approval, encrypted with the phone's own key, to the coordinator laptop's LAN gateway on home Wi-Fi or through the relay.
7. **Resident mode**: on a phone paired as a resident, or turned on in Settings on a caregiver phone (so one iPhone can play both roles in the demo).
   - Get Health permission for heart rate and read the readings synced from the Watch, everything since the last check. Where HealthKit allows, deliver new readings in the background as well, with Sync now as the fallback.
   - Readings arrive in bursts after the phone is unlocked, because HealthKit can't be read while it's locked.
   - Heart rate MUST go only to the LAN gateway, never through the relay or to any other server. A test MUST prove the relay route rejects it.
   - Off home Wi-Fi, keep unsent readings on the device, protected, and show "Will send when you're home" with the time of the last successful send.
   - Show the last reading, a "Sync now" button and a live-view on/off switch for the resident. As simple as the app can be.
8. **Settings**:
   - Unpair: tell the hub with an encrypted message, delete every Keychain item including the shared ones, and return to pairing. If the hub can't be reached, still wipe the phone and say the laptop must remove it.
   - Resident mode on or off.
   - Whatever else your research says belongs here.

### 5.2 States every flow needs

First launch and onboarding; permission priming before each system prompt (camera, local network, notifications, Health); loading; empty; offline; errors with a way to recover; and moving between Wi-Fi and cellular, with the route switching automatically, no re-pairing, and reconnection within the doc's 30-second target.

### 5.3 Shared with Layer 4

- **Care screens.** The doc gives the care screens (alerts; status, including the heart-rate trend and "no heart data"; history) to the Layer 4 owner, who will contribute to this app later. Build them now to demo quality, kept separable so Layer 4 can take them over.
- **Design system.** Keep it separable too, so every contributor uses the same components. How to structure this is yours to research.
- **Requests and replies.** Define the contract for the doc's requests and replies (`ask`, `check_now`) in `docs/CONTRACTS.md`, even though their screens come later.
- **Where the project lives.** It stays in this folder, owned by Layer 1, outside the team repository. `README.md` explains how Layer 4 will contribute once the owner sets up a remote.

### 5.4 Not tonight

Everything the Layer 1 doc lists under "After the hackathon": caregiver accounts, several caregivers, audio, the Watch live mode and the rest. Put good ideas in the report instead.

## 6. Contracts, routes and the mock home

- **Contracts.**
  - The doc's "Phone ↔ hub messages" fixes the core format: the QR code, the pairing request and proof, the keys, the 4-digit code, the envelope, freshness rules and credentials. Follow it exactly, even if the laptop-and-cloud track's code differs, and list each difference under "For the bridge and relay builders" in the report. Never invent cryptography.
  - For details the doc leaves open (endpoint paths, JSON field names, message `type` values, the unpair message, the removed-phone signal, requests and replies), check branch `layer-1` first (section 5). Where the laptop-and-cloud track has already chosen, match it exactly and mark it ADOPTED in `docs/CONTRACTS.md` with the commit hash. If an adopted choice would break one of the doc's guarantees (the relay sees only ciphertext and routing data, heart rate never goes through the relay, the device credential never crosses the LAN), don't adopt it: propose an alternative and report the conflict.
  - Propose only for real gaps, marked PROPOSED, with example payloads.
  - Keep the phone-to-hub part of `docs/CONTRACTS.md` self-contained (formats, PROPOSED items and test vectors), so the owner can copy it as-is to `layer1/contracts/phone-hub.md` in the team repository.
- **Test vectors.** Generate them from your Swift tests, and verify them independently with Node's built-in `crypto` (the bridge's runtime) in your test lane, so the two implementations are proven to agree byte for byte. Publish them in `docs/CONTRACTS.md`.
- **Routes, chosen at run time.**
  - For caregivers, the relay is the main path. The LAN gateway is used when the phone is on home Wi-Fi and the gateway answers.
  - If the gateway fails, fall back to the relay without asking and without re-pairing. A stale LAN address after a network change just means "LAN unavailable".
  - Pairing, adding a laptop over Wi-Fi, and heart rate need the LAN gateway. When the stored LAN addresses stop answering, find the coordinator's bridge again by Bonjour, using the service type the Layer 1 doc names, confirm it with a request encrypted with the phone's own key, and update the stored addresses.
  - Configuration may only override the choice: point at the mock home, force the LAN gateway, or force the relay.
  - Measure reconnection by making the mock home's LAN gateway unreachable, or moving it, mid-session, and timing until messages arrive again. Compare with the 30-second target and record it in `PROGRESS.md` as a simulated measurement. The real Wi-Fi-to-cellular test on the iPhone goes in the report as a step for the owner.
- **The mock home.**
  - A separate local server in this repo, outside the app target, listening on 127.0.0.1 only. Write it in Node, so its cryptography is the independent implementation that checks yours.
  - It plays the coordinator's bridge, the LAN gateway and the relay over real HTTP, so the app runs its real networking code against it.
  - It has controls to trigger alerts, updates, late delivery, status changes, "hub offline", "monitoring degraded", a removed phone, the LAN gateway becoming unreachable or moving (it advertises itself by Bonjour like the real bridge), and every live-view state: requesting, denied, ready, connecting, playing, ended by time limit, ended by you, ended by the resident, failed. For live view it may stop at the signalling boundary if a real video peer is impractical, but every state must be reachable and tested.
  - Debug builds may reach the mock relay over plain HTTP on 127.0.0.1. Release builds require HTTPS for the relay and allow plain HTTP only to local-network addresses (the LAN gateway); a test checks the Release settings.
- **Simulator.** It has no camera, so give Debug builds a way to feed in a QR payload. Find out how to test push and the notification extension locally, and document it.
- **On-device demo home.** TestFlight builds SHOULD include a demo home, so the owner can feel the motion and haptics on a real phone in the morning. It reaches every 5.1 screen and fires every named haptic event.
  - It is clearly labelled as a demo and chosen explicitly from onboarding.
  - It runs entirely on the phone, with no network, and its sample data is marked as demo data. It is never mixed with a real pairing.
  - It can be removed with one build setting.
  - List it under "Decisions to confirm".

## 7. Fastlane and TestFlight

You decide how; these are the requirements.

- **Setup.** fastlane pinned per project through a Gemfile and bundler, with lanes for at least testing, building and uploading to TestFlight, all runnable unattended and non-interactively.
- **Preflight (Phase 0).**
  - Check that every value in `asc.env` is present (without printing it).
  - Confirm with a read-only call that the API key works, that its role can manage the identifiers, certificates and profiles you need, that the app record for `BUNDLE_ID` exists, and that an internal group with automatic distribution and at least one tester exists. Record the group's name and tester count (no names or emails); the owner confirms membership in the morning. If there are several, use the one with automatic distribution and list the choice under "Decisions to confirm".
  - Create only what section 3 allows. For anything else, write exact steps for the owner under Blockers.
- **Signing.** Research an approach that works unattended with an API key, within the limits in section 3. Prove it in Phase 0: archive and export a throwaway signed build in a gitignored scratch folder, with standard input closed, in the background, with a time limit. Do not upload it. If it hangs or asks for anything, abandon that approach and try another, or record the blocker.
- **Minimum iOS version.** It MUST NOT be above `DEMO_IOS_VERSION`, and must weigh the older iPhones the target families are likely to own against what newer design features need. Choose the most inclusive version that still meets `CRAFT.md`, and list it under "Decisions to confirm".
- **Build numbers.** Always above the latest TestFlight build.
- **Export compliance.** Research what App Store Connect requires for an app using CryptoKit, end-to-end encryption and a bundled WebRTC library (which ships its own DTLS, SRTP and TLS code). Set only the Info.plist answer, record the reasoning, and list it under "Decisions to confirm". If a build shows "Missing Compliance", record the exact answer the owner should give in App Store Connect, and why.
- **Push environment.** Verify which push environment TestFlight builds use and which Xcode-run builds use, set the entitlement to match, and make sure the app reports its environment when it registers its push token, as the doc requires.
- **Running uploads.**
  - Archive and upload in the background, with logs in the gitignored log folder.
  - Don't wait for App Store Connect processing: upload, then check processing state later with a read-only call. Never hold up feature work on it.
  - Before each upload, validate the archive: usage-description strings, privacy manifest, icons, version and build number.
  - Upload at most about once an hour, plus the final build.
  - If a build ends up INVALID, or an upload fails twice for the same reason, stop uploading until you have fixed the cause locally and validated a new archive, and record it.
- **First upload (Phase 4).** A minimal shell that uses only finished Phase 3 assets: the custom app icon, the launch screen, and one screen with the logo and wordmark. No system-default controls and no placeholder text or art. It MUST already carry the push and Time Sensitive Notifications entitlements and the notification extension with its shared Keychain group, so signing is proven for every capability early and the laptop-and-cloud track's push test (the Layer 1 doc's build step 0b) has a build to target.
- **Every upload.** Add the build to the owner's internal group, with "What to Test" notes describing it. Record the build number, time, result and processing state in `PROGRESS.md`.
- **If uploads are blocked.** Keep building and testing locally, keep the pipeline ready, and record the exact blocker and its fix in the report.

## 8. Phases and gates

Each phase ends with a gate. Don't start the next phase until the gate passes, or until you've recorded why it can't pass and what you did instead.

**Phase 0: Orientation** (by 0:30)
- Run `date`. Start `caffeinate -dims -t 43200` in the background and confirm with `pmset -g assertions` that it holds. If the Mac is on battery, record that as a blocker in `PROGRESS.md` and in the report.
- Create `CLAUDE.md`, `PROGRESS.md`, a `MORNING_REPORT.md` skeleton and `.gitignore`; run `git init`.
- Read the sources in section 5.
- Check the machine: Xcode and SDK versions, Simulators, Ruby, bundler, fastlane, Homebrew.
- Run the TestFlight preflight and the signing dry run (section 7).
- Gate: `PROGRESS.md` records the environment, the plan with clock times, the state of every item in "Before you start", and every blocker.

**Phase 1: Research** (by 1:30)
- Cover every topic in section 9, using parallel subagents where you can. Each writes notes with links to `docs/research/`. Primary sources first; date every source; flag anything that changed in the current iOS release.
- Then an independent reviewer hunts for unsourced claims, outdated APIs and contradictions. Fix what it finds.
- Gate: notes exist for every topic, with sources, and the review's findings are resolved.

**Phase 2: `CRAFT.md`** (by 2:10)
- Write `CRAFT.md` (section 10) from the research.
- An independent reviewer tries to break it: vague rules, unsourced rules, conflicting rules, rules that can't be checked. Revise until it passes, and save the review in `docs/research/craft-review.md`.
- Gate: every rule is specific, checkable, and sourced or reasoned.

**Phase 3: Brand and assets** (by 3:00)
- Design the logo and wordmark, the app icon and its variants, the complete icon set, the launch screen and any illustrations `CRAFT.md` calls for. Vector sources go in `Design/`, with export scripts, and the exports go in the asset catalog.
- Render every asset to an image and look at it. Explore several directions for the logo and the icon, compare them side by side, choose with written reasons, and iterate until each one passes your checklist at every size, in light and dark.
- Gate: every asset passes; choices are logged.

**Phase 4: Project, pipeline and first TestFlight build** (by 3:30)
- Create the project with the structure your research chose, reproducible from the command line. It MUST keep the design system and the care screens separable, and include the notification extension and the mock home.
- Set up fastlane and upload the minimal shell (section 7).
- Gate: the upload accepted and its processing state recorded, or a precise blocker recorded with everything else ready.

**Phase 5: Design system in code** (by 4:10)
- Build the tokens (colour, typography, spacing, shapes, materials, named springs and transitions, named haptic events) and the custom components. Add a Debug-only component gallery, snapshot tests in light and dark and at large Dynamic Type, and the test or lint that enforces tokens.
- Gate: gallery screenshots and motion recordings reviewed against `CRAFT.md`; tests green.

**Phase 6: Features** (by 7:00)
- Build section 5.1 in order, against the mock home. Each screen passes the screen gate before you move on. Add each finished screen to the demo home, then upload about once an hour when a feature has passed.
- **Screen gate:**
  - Screenshots on the smallest and largest supported iPhones, in light and dark, at the largest accessibility text size and with Reduce Motion on, each opened and reviewed against the `CRAFT.md` checklist.
  - A screen recording (`xcrun simctl io booted recordVideo`) of every transition and animated state change, with frames extracted and inspected for jumps, flashes, layout pops and dropped frames, including one recording that interrupts an animation mid-flight. Recordings go in `Design/reviews/`.
  - Every animation and haptic uses `CRAFT.md` tokens, with tests passing.
  - No SF Symbols or system-default controls.
  - VoiceOver labels and reading order checked.
  - A UI test for the main path.
  - No warnings from Debbie's own code (section 3).

**Phase 7: Polish, audit and final build** (by 8:00)
- Full passes for motion, haptics, accessibility, copy, empty and error states, performance against your budgets, and consistency across screens. An independent reviewer audits three screens of its own choosing against `CRAFT.md`.
- Upload the final TestFlight build and complete `MORNING_REPORT.md`.

**Cut order, if you fall behind.** Never cut pairing, alerts, status, or the live-view states. Cut in this order, which follows the Layer 1 doc's:
1. Platform extras (research topic 13).
2. The LAN route for caregivers (relay only).
3. Background heart-rate delivery (keep Sync now).
4. Decrypting inside the push (fall back to generic text that the app decrypts when opened).

**If you finish early**: rerun the `CRAFT.md` checklist on every screen and raise the weakest one, add tests, strengthen the mock home and the demo home, and tighten `CRAFT.md` with what you've learned. Never add scope from 5.4.

## 9. Research topics

Answer each one with sources, and follow what you find beyond this list.

1. What Apple Design Award winners and the apps Apple features on the App Store (recent years, especially health, family, safety and home apps) share in visual design, motion, haptics, onboarding, copy and craft. List concrete, observable techniques.
2. The current iOS design language and what Apple asks of apps that adopt it (materials, layout, navigation, app icons), and how a fully custom-styled app stays faithful to it. Which iOS versions to support, within the limits in section 7.
3. Springs and motion: Apple's guidance and APIs for spring animation, interruptibility, gesture velocity, choreography and timing; Reduce Motion; how featured apps use motion to explain changes of state; how to verify motion from the command line.
4. Haptics: Apple's guidance and APIs, from simple feedback to custom patterns; when haptics help and when they are noise; pairing them with motion; accessibility.
5. Transitions: navigation and modal transitions, continuity of elements between screens, state changes within a screen, and avoiding dropped frames.
6. Colour: a calm palette whose identity stays mint; light, dark and increased-contrast variants; companion tokens for text; contrast thresholds; colour-blind safety; showing urgency inside a calm palette.
7. Typography and layout: system typefaces, Dynamic Type, legibility for older users, spacing systems, touch-target sizes.
8. Iconography, logos and app icons: a complete custom symbol set that replaces SF Symbols while matching the optical weight and alignment of system text; the current app icon formats and appearance variants; logo and wordmark principles; vector-to-asset pipelines that run from the command line.
9. Custom buttons and controls: replacements for every system control the app uses, with their states, feedback and accessibility, built as reusable styles.
10. Designing for caregivers, older adults and alerting: clarity under stress, urgency without alarm fatigue, and trust and privacy cues such as an unmistakable "camera is live" indicator.
11. Engineering:
    - architecture for a small SwiftUI codebase shared by several contributors, module boundaries, state and concurrency;
    - sharing Keychain items with a notification extension that runs while the phone is locked, and Notification Service Extensions in general;
    - HealthKit heart rate and the limits of background delivery;
    - local-network permission, Bonjour and App Transport Security for plain HTTP to a laptop on the LAN;
    - choosing routes at run time and detecting network changes;
    - QR scanning;
    - WebRTC on iOS and the KVS signalling protocol;
    - snapshot, UI and motion testing from the command line;
    - performance budgets and how to measure them unattended.
12. Delivery: fastlane with an App Store Connect API key, run non-interactively; unattended signing within the limits in section 3; uploading without waiting for processing; validating an archive before upload; export compliance; internal testing groups.
13. Platform extras featured apps use, such as widgets, Live Activities, App Intents and notification actions: which would genuinely help a caregiver, and at what cost. Build the ones you can justify only after 5.1 passes its gates.

## 10. `CRAFT.md`

Your curated master practice for Debbie: what a master iOS designer and a master iOS engineer would hold this app to. Required sections:

1. **Principles**: a few, each with what it means for Debbie in practice, including what simplicity means per screen and how to check it.
2. **Design system**:
   - colour tokens with values and measured contrast, and how mint stays the identity;
   - the type scale and its Dynamic Type behaviour;
   - spacing and layout, shapes and corner radii, materials and depth;
   - the icon grid and drawing rules;
   - the illustration style, if you adopt illustrations;
   - logo and app icon rules.
3. **Motion**: named springs for each kind of interaction, with their parameters and where each applies; named transitions; rules for interruption; Reduce Motion fallbacks; how motion is verified.
4. **Haptics**: every named haptic event, which feedback it plays and why, how it pairs with motion, and what never gets a haptic.
5. **Components**: every custom control and every system control it replaces, with its states (default, pressed, disabled, loading, focused, error), behaviour and accessibility.
6. **Voice and microcopy**: tone for caregivers and residents, how urgent alerts read, and error messages.
7. **Accessibility**, with thresholds.
8. **Engineering standards**: architecture, module boundaries, concurrency, error handling, logging without secrets, dependency policy, testing strategy (including motion and token enforcement), performance budgets and code style.
9. **Review checklist**: the exact list every screen and every change must pass, used by the gates in section 8.
10. **Sources and changelog.**

Every rule MUST be specific, checkable and traceable to a source or to written reasoning. Keep `CRAFT.md` alive: when the build teaches you something, update it and log the change.

## 11. Files

- `CLAUDE.md`, `PROGRESS.md`, `CRAFT.md`, `MORNING_REPORT.md`, and `README.md` (how to build, test, run the mock home, ship to TestFlight, and how Layer 4 will contribute)
- `docs/research/`, `docs/CONTRACTS.md`, and `docs/DECISIONS.md` (date, decision, options considered, reason, sources)
- `Design/`: vector sources, export scripts, review renders, and screen recordings in `Design/reviews/`
- the app, its extension, its modules and tests, the mock home, the Node test-vector check, `fastlane/` and the `Gemfile`

## 12. `MORNING_REPORT.md`

Written for the owner: short, scannable and honest.

1. **On TestFlight now**: build number, what's in it, which internal group has it, how to try it (including how to open the demo home, or plainly why there is none), known issues, and, if the build shows Missing Compliance, the exact answer to give in App Store Connect.
2. **What works end to end against the mock home**, with screenshots and recordings stored in the repo.
3. **The design**:
   - the mint swatch and its companion colours side by side, with hex values;
   - the app icon and key screens, with renders;
   - the research findings that shaped them most.
4. **To check on the phone**: each haptic event, where to trigger it and what it should feel like; and the Wi-Fi-to-cellular reconnection test. The Simulator can do neither.
5. **Decisions to confirm**, each with the default you took. At least: the exact mint, the minimum iOS version, the export compliance answer, the demo home, and which copy of the Layer 1 doc you followed.
6. **Blockers**, and exactly what the owner needs to do about each.
7. **For the bridge and relay builders**: that the phone-to-hub part of `docs/CONTRACTS.md` is ready to copy to `layer1/contracts/phone-hub.md`; what they must implement or agree to; which items you ADOPTED from their work; any conflicts; and what their push test needs from the app (the push environment, and how and when the app registers its token).
8. **What you would do next.**
9. **Installed items**: everything you installed, and every signing item you created, with how to undo each.
