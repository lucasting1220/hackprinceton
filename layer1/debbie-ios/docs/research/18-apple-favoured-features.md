# 18. Features and components Apple rewards, for Debbie (research brief)

Written 2026-11-14 22:30–22:55 for the owner's brainstorm (Live Activities, the Dynamic Island, StandBy, widgets, Controls, App Intents, iOS 26 components, Apple Design Award and App Store editorial criteria). Seven research lenses, one codebase effort map, one synthesis. Links marked † were fetched and quoted; others returned title-only and their wording is unverified.

# Debbie: stunning additions that need no rework

Every API below fits the iOS 26.0 deployment target. Nothing changes existing screens, tokens, transport or contracts; picks 3–4 share one new widget-extension target. Links marked † were fetched and quoted; the rest returned title-only (Apple's docs are script-rendered), so treat their wording as unverified.

## 1. Top picks (impact ÷ effort, best first)

1. **Lock Screen buttons on the fall alert: "I'm on it", "Call Mum", "Open Live View".** Long-press the banner and three buttons with Debbie's own glyphs appear; "I'm on it" sends the encrypted acknowledgement without opening the app, "Open Live View" asks for Face ID and lands on the camera. Apple's actionable-notification docs describe exactly this: a few clearly named actions taken without opening the app ([doc](https://developer.apple.com/documentation/usernotifications/declaring-your-actionable-notification-types), unverified wording). Effort **S**: the push extension already stamps a category, but nothing registers categories and the app has no response handler, so ~40 lines plus three glyph images. iOS 10+ (custom icons iOS 15+). Demo **high**.

2. **Debbie's face as the sender (Communication Notifications).** The alert arrives like a message from a person: a mint-rimmed Debbie avatar, "Debbie" in bold, "Possible fall in the living room" below, app icon shrunk to a badge. Apple's first-class way to show who a notification is from ([doc](https://developer.apple.com/documentation/usernotifications/implementing-communication-notifications), unverified wording). Effort **S**: one entitlement (no approval form), one Info.plist key, ~25 lines in the existing extension; the lane regenerates the profile. Risk: a persona sender is a grey area for public App Review (fine for TestFlight). iOS 15+. Demo **high**.

3. **"Checking on Mum" Live Activity: Dynamic Island, Lock Screen, dock, Watch, car, Mac.** Tap "I'm on it" and the Island shows Debbie's face glyph and a running timer; long-press expands to "Checking on Mum · Hub listening · 0:42" with one "Mum is OK" button. On a MagSafe charger, locked and sideways, StandBy shows it at 2× beside the clock; the paired Watch's Smart Stack and a Mac menu bar get it with no extra code. HIG: Live Activities suit "tasks and events that have a defined beginning and end" ([HIG†](https://developer.apple.com/design/human-interface-guidelines/live-activities)); Watch, CarPlay and Mac appear automatically ([WWDC24 10068†](https://developer.apple.com/videos/play/wwdc2024/10068/), [WWDC25 278†](https://developer.apple.com/videos/play/wwdc2025/278/)). Started locally by the app, so relay, contracts and push extension stay untouched. Effort **M**: new widget-extension target with its own App ID and profile. iOS 16.1; button iOS 17; StandBy iOS 17; CarPlay iOS 26; Mac menu bar macOS Tahoe. Demo **high**.

4. **Home-status widget, Lock Screen complications, Control Center "Live View" button.** A mint Home Screen card: status glyph, "Monitoring on", "Confirmed 4:31 PM", plus "72 bpm · 3 min ago" on the medium size; the same code gives a circular heart dial above the Lock Screen clock, sits full-bleed in StandBy and (iOS 26) CarPlay, and flips itself to "Unknown, open Debbie" when the heartbeat goes stale. A Control Center tile with Debbie's camera glyph opens Live View, also from the Lock Screen and Action button. iOS 26 renders widgets in Liquid Glass clear and tinted looks, and one control definition reaches all three places ([WWDC25 278†](https://developer.apple.com/videos/play/wwdc2025/278/), [WWDC24 10157†](https://developer.apple.com/videos/play/wwdc2024/10157/)). Effort **M** for the first widget, **S** per complication and control once pick 3's target exists; data goes through the existing shared Keychain group. Widgets iOS 14, complications iOS 16, controls iOS 18. Demo **high**.

5. **"Siri, how is Mum?" with a Debbie card answer.** Siri replies "Mum's doing fine, heart rate 72" and shows a Debbie-drawn card with a mint status pill and two buttons, "Open Live View" and "I'm on it", that act without leaving Siri; the demo home answers offline. Apple calls App Intents "your app's gateway to integrating with Apple Intelligence", and iOS 26 adds interactive snippets ([WWDC25 244†](https://developer.apple.com/videos/play/wwdc2025/244/), [WWDC25 275†](https://developer.apple.com/videos/play/wwdc2025/275/)). Effort **S** for the phrases (no target or entitlement; nothing uses App Intents yet), **M** with the card. Phrases iOS 16, snippets iOS 26. Risk: the Shortcuts tile needs an SF Symbol (system surface). Demo **high**; rehearse with type-to-Siri as fallback.

6. **Feel Mum's heartbeat.** Press and hold the heart on the heart-rate card: the glyph beats at the live BPM and the phone plays a lub-dub at that rate; release stops it. Core Haptics exists for patterns the standard feedback cannot express, and the HIG asks haptics to match meaning ([AHAP doc](https://developer.apple.com/documentation/corehaptics/representing-haptic-patterns-in-ahap-files), unverified wording; [HIG haptics](https://developer.apple.com/design/human-interface-guidelines/playing-haptics)). Effort **M**: a player inside the design system's `Haptics/` folder plus a CRAFT §4 amendment; device-only testing. iOS 13+. Demo **high** in hand, invisible on a projector.

7. **Accessibility credentials Apple prints on the store: Assistive Access and Nutrition Labels.** One plist key makes Debbie full-screen inside Assistive Access (the simplified iPhone mode for cognitive disabilities); a one-page evidence file maps six Accessibility Nutrition Labels (VoiceOver, Voice Control, Larger Text, Sufficient Contrast, Reduced Motion, Differentiate Without Color) to evidence CRAFT.md already holds. Announced May 2025 ([Newsroom†](https://www.apple.com/newsroom/2025/05/apple-unveils-powerful-accessibility-features-coming-later-this-year/), [WWDC25 238†](https://developer.apple.com/videos/play/wwdc2025/238/)). Effort **S** (a full Assistive Access scene is M). iOS 17 / iOS 26. Demo **medium**, strong slide line.

## 2. Stunning components to drop in

All fit the custom-drawn system; glass stays in `Chrome/`.

- **One piece of glass through the Live View states** (`GlassEffectContainer` + `glassEffectID`, iOS 26): the "Asking home…" pill morphs into the control cluster when video plays and back into "Live view ended". Apple: glass "dynamically morphs between the controls in each context" ([WWDC25 219†](https://developer.apple.com/videos/play/wwdc2025/219/), [323†](https://developer.apple.com/videos/play/wwdc2025/323/)). Container S, morph M.
- **Alert card zooms into its detail** (`navigationTransition(.zoom)`, iOS 18): the tapped card expands into the detail screen, whose top is the same card ([WWDC24 10144†](https://developer.apple.com/videos/play/wwdc2024/10144/)). M: iOS 26 forum reports show flicker after interrupted zooms, so run the gate's interrupted recording.
- **Sheets grow out of their buttons** (`matchedTransitionSource`, iOS 18; glass sheet look iOS 26): Settings gear, Add a Laptop, False Alarm, demo controls ([WWDC25 323†](https://developer.apple.com/videos/play/wwdc2025/323/)). S.
- **Concentric corners** (`ConcentricRectangle`, iOS 26) for the button inside the alert card and the video frame; permitted in CRAFT, zero uses today ([WWDC25 323†](https://developer.apple.com/videos/play/wwdc2025/323/)). S.
- **Scroll-edge effect under the floating tab bar**: attach the bar with `safeAreaBar(edge: .bottom)` so History dissolves as it slides under the capsule ([WWDC25 219†](https://developer.apple.com/videos/play/wwdc2025/219/)). S.
- **Heart-rate ribbon** (Swift Charts, iOS 16): a 56 pt mint sparkline under the BPM number from a phone-side buffer, no contract change ([WWDC24 10144†](https://developer.apple.com/videos/play/wwdc2024/10144/)). M.
- **Alert-arrival choreography** (`KeyframeAnimator`, iOS 17): slide, two slow border pulses and the icon beat on the same trigger as the urgent haptic. S.
- **Iris reveal for the video** (custom `Transition`, iOS 17): the picture opens from where the connecting pill sat. S.

## 3. Don't

- **Hub-pushed Live Activities (push-to-start).** The system decodes the content itself, so alert text would cross the relay in plain sight; hub and contract rework (L) ([ActivityKit push doc](https://developer.apple.com/documentation/activitykit/starting-and-updating-live-activities-with-activitykit-push-notifications), unverified).
- **Live Activities for the pairing code or the camera session.** HIG: avoid sensitive information on the Lock Screen; and video stops when the app leaves the screen, leaving nothing to track ([HIG†](https://developer.apple.com/design/human-interface-guidelines/live-activities)).
- **System looks: `.glass` button styles, `TabView` minimize-on-scroll, `SiriTipView`, `Gauge`.** System-default controls, which the lint and the brief forbid; mirror the behaviour with Debbie's components.
- **Critical Alerts, Emergency SOS, Medical ID, Watch Fall Detection.** Critical Alerts needs Apple's written approval (weeks); the rest have no third-party API. Roadmap slide only.
- **A watchOS app, Mac/iPad destination, Universal Links, "glass" Live Activities.** New platform or hosted domain means rework (and hosting is forbidden); a glass Island is unverified; the HIG still says its background is opaque black.

## 4. If you only do three before the presentation

| Order | What | Hours | Why |
|---|---|---|---|
| 1 | Lock Screen buttons + Debbie's face (picks 1–2) | 3–4, incl. entitlement, profile regen, device check | Two S items, no new target, visible in the first ten seconds |
| 2 | Widget-extension target with the "Checking on Mum" Live Activity: Island, Lock Screen, StandBy (pick 3) | 6–8, incl. signing retest and a MagSafe-stand photo | The headline you asked for; unlocks pick 4 at S each |
| 3 | "Siri, how is Mum?" phrases, card if time (pick 5) | 2–4 | No target; works offline from the demo home |

Before each step: list the capability in PROGRESS, add the DECISIONS entry, extend `tools/ci/lint.sh` to new folders. If step 2 runs long, swap step 3 for the alert-arrival choreography (1–2 hours).

