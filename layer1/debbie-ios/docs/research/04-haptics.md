# 04 Haptics
_Researched 2026-11-14. Toolchain: Xcode 26.6 / iOS 26.5 SDK. Current public iOS: iOS 27.2.1 (released 9 Nov 2026). iOS 27.0 shipped 14 Sep 2026, and Apple still ships iOS 26.x updates (26.7.3 on 9 Nov 2026) for people who stay on 26 [S1]._

## Questions answered
> "Haptics: Apple's guidance and APIs, from simple feedback to custom patterns; when haptics help and when they are noise; pairing them with motion; accessibility." (KICKOFF_PROMPT.md §9, topic 4)

The assignment also asked for:
- HIG "Playing haptics".
- SwiftUI `sensoryFeedback`: every `SensoryFeedback` case and what it is documented to mean, plus the condition and closure variants.
- The UIKit `UIFeedbackGenerator` family, `prepare()`, and the iOS 17.5 view-anchored generators.
- Core Haptics: AHAP, transient and continuous events, intensity and sharpness, engine lifecycle, `capabilitiesForHardware`.
- WWDC19 520, WWDC19 223 and WWDC21 10278.
- When haptics help and when they are noise, and how to time them with motion.
- The System Haptics and Vibration settings, never making a haptic the only signal, devices without a Taptic Engine, and VoiceOver.
- A complete haptic map for Debbie, including what never gets a haptic.

## Summary
- **Current iOS.** iOS 27 is the current release (27.2.1). Nothing about haptics changed in iOS 27:
  - Apple's SwiftUI and UIKit change logs for June and September 2026 list no haptics APIs [S21][S22].
  - The HIG page was last changed on 7 May 2024 [S2].
  - The `SensoryFeedback` cases in today's online docs match our local 26.5 SDK exactly [S5][S26].
  - Everything below builds with the iOS 26.5 SDK. Nothing here needs the iOS 27 SDK, which needs Xcode 27 and macOS Tahoe 26.6 or later [S1]; this Mac runs 26.2.
- **Use system patterns for what they mean, and use few of them.** Apple's rules:
  - Use system patterns according to their documented meanings, and use them consistently [S2].
  - "Don't select a haptic because of the way it feels." Feedback "should never come as a surprise" [S10].
  - Causality, harmony and utility. "It's often a good idea not to add sound and haptics" [S16][S17].
  - iPhone has no pattern documented for "something needs your attention". watchOS has one, but on iPhone the notification patterns mean "the outcome of a task or action" [S2]. So an arriving urgent alert, which isn't the outcome of anything the caregiver did, plays a heavy impact tonight, as the HIG's "use a generic pattern" route allows (R2).
- **Several `SensoryFeedback` cases do nothing on iPhone** (verified in local SDK) [S5][S26]:
  - `.start`, `.stop`, `.increase`, `.decrease` and `.levelChange`.
  - The iOS 26 `.press(_:)`, `.release(_:)` and `.selection(_:)` (the variants that take an argument) play only on visionOS.
  - On iPhone, Debbie's useful set is `.success`, `.warning`, `.error`, `.selection` and `.impact(weight:intensity:)` / `.impact(flexibility:intensity:)`.
- **A haptic is a request, not a guarantee.** The system decides whether it plays, based on:
  - the hardware, whether the app is in the foreground, the System Haptics switch and battery [S10];
  - the Accessibility → Touch → Vibration switch, which silences all vibration [S19];
  - whether an audio session is recording, which suppresses haptics by default (verified in local SDK) [S26].

  No public API reports the Haptics or Vibration settings (verified in local SDK) [S26]. A haptic can therefore never be the only signal [S3][S4].
- **Haptics are separate from motion settings.** Reduce Motion changes animations, not haptics. Under Reduce Motion, fire the haptic when the substitute crossfade starts, the same moment as without it (R5). Reasoning: there is no Apple guidance tying haptics to Reduce Motion, and causality only needs the haptic to coincide with the visible change [S16].
- **Timing with motion.** Every haptic fires in the same state change that starts its visual change, and never from an animation's completion (R5). This is 03 R13's rule, so CRAFT.md gets one rule. Latency between visual and haptic "is clearly broken" [S16]. Match the haptic's intensity and sharpness to the animation's [S2].
  - In SwiftUI, `sensoryFeedback` fires when its trigger changes [S6], in the same update that starts the animation.
  - Why not on landing: Debbie's paired springs are critically damped (03 R2), so no moment of contact is visible. A `.logicallyComplete` completion fires at the spring's perceptual duration [S27], 0.40–0.50 s after the change and after the motion has visibly settled. It marks nothing on screen.
- **Debbie needs no custom Core Haptics patterns tonight.** Apple: "In most cases, you want to keep on using FeedbackGenerator" [S15]. A custom urgent-alert pattern is on the LATER list because it must be tuned on a device, and the Simulator plays no haptics [S17].
- **A small, checkable haptic map.** It has 17 named events (R2) and an explicit never-list (R3). Ordinary buttons, navigation and every passive status change never get one. Status belongs in passive feedback [S3]. `.success` is kept for four outcomes that are significant and not already in front of the person, because "people typically expect their action or task to succeed, they only need to know when it doesn't" [S3]. When two events collide, priority decides which plays (R6).

## Findings

### F1. Current release and toolchain consequences
- Apple's security-releases page lists:
  - iOS 27.2.1 as "the latest version of iOS and iPadOS", released 9 Nov 2026;
  - iOS 27 on 14 Sep 2026, for iPhone 11 and later;
  - iOS 26.7.3 on 9 Nov 2026, for iPhone 11 and later;
  - Xcode 27 (14 Sep 2026) and Xcode 27.2 (29 Oct 2026), both "macOS Tahoe 26.6 and later" [S1].
- So this Mac (macOS 26.2, Xcode 26.6) cannot install Xcode 27, and the iOS 27 SDK is unavailable. Reasoning: the "Available for" column of [S1].
- Apps built with the iOS 26.5 SDK still install and run on iOS 27. Reasoning: Apple's iOS 27 behaviour changes are worded as applying to "apps built with the latest SDK" [S22], which implies older-SDK binaries keep working.

### F2. Apple's design guidance
**HIG "Playing haptics"** [S2]:
- "Use system-provided haptic patterns according to their documented meanings." If no documented meaning fits, "use a generic pattern or create your own."
- "Use haptics consistently", building "a clear, causal relationship between each haptic and the action that causes it."
- "Prefer using haptics to complement other feedback." "Match the intensity and sharpness of a haptic with the intensity and sharpness of the animation it accompanies."
- "Avoid overusing haptics … the best haptic experience is one that people may not be conscious of, but miss when it's turned off."
- "In most apps, prefer playing short haptics that complement discrete events." Long-running haptics "can dilute the meaning of the feedback."
- "Make haptics optional. Let people turn off or mute haptics, and make sure people can still enjoy your app … without them."
- Haptics can disrupt "device features like the camera, gyroscope, or microphone."
- On iOS:
  - standard toggles, sliders and pickers play system haptics by default;
  - otherwise use the notification, impact or selection generators;
  - **notification** = "the outcome of a task or action";
  - **impact** = "a physical metaphor … a tap when a view snaps into place or a thud when two heavy objects collide";
  - **selection** = "while the values of a UI element are changing".
- The HIG's demo media show success and warning as two pulses, error as four, and each impact style and selection as a single pulse.
- Only watchOS defines a haptic for an arriving event: its Notification haptic "Tells the person that something significant or out of the ordinary has happened and requires their attention." The iOS list has no such pattern. It offers notification patterns for outcomes, impact as "a physical metaphor", and selection.

**Apple's developer article "Playing haptic feedback in your app"** [S10]:
- "Always use feedback for its intended purpose. Don't select a haptic because of the way it feels."
- "The source of the feedback must be clear … Feedback should never come as a surprise."
- "Don't overuse feedback. Overuse can cause confusion and diminish the feedback's significance."

**HIG "Feedback"** [S3]:
- Match the significance of information to how it's delivered: "display status information in a passive way."
- Confirm completions only for significant activities, "because people typically expect their action or task to succeed, they only need to know when it doesn't."
- Give feedback through several channels ("color, text, sound, and haptics") so people get it "whether they silence their device, look away from the screen, or use VoiceOver."

**WWDC19 223 "Expanding the Sensory Experience with Core Haptics"** [S16]. Three principles:
- **Causality**: "for feedback to be useful it must be obvious what caused it."
- **Harmony**: "things should feel the way they look, the way they sound." Adding latency between the visual and the rest of the feedback is "clearly broken." Pace and energy matter: "something that feels calm or like a heartbeat warrant[s] different type of feedback."
- **Utility**: "only when you can provide clear value … Use moderation." "It's often a good idea not to add sound and haptics … are you tempted to add more? But maybe don't. It will overwhelm people, and it will diminish the value of what's really important."

**WWDC21 10278 "Practice audio haptic design"** [S17]:
- Restates causality, harmony and utility, with "Reserve haptics and audio for significant moments."
- The iOS Flashlight button combines animation, sound and haptic in a way that is "clear, precise, and succinct."
- "The simulator doesn't work for haptics. You need a physical iPhone 8 or newer."

### F3. SwiftUI `SensoryFeedback`: every case, what it means, where it plays
All cases are verified in the local SDK (`SwiftUI.swiftinterface`, lines 791–851). The meanings and "plays on" notes are from the per-case documentation [S5][S26].

| Case | Documented meaning | Plays on iPhone? | Since |
|---|---|---|---|
| `.success` | "a task or action has completed" | Yes (iOS, watchOS) | iOS 17 |
| `.warning` | "a task or action has produced a warning of some kind" | Yes | iOS 17 |
| `.error` | "an error has occurred" | Yes | iOS 17 |
| `.selection` | "a UI element's values are changing" | Yes | iOS 17 |
| `.impact`, `.impact(weight: .light/.medium/.heavy, intensity:)`, `.impact(flexibility: .rigid/.solid/.soft, intensity:)` | "a physical metaphor … feedback for UI elements colliding"; "not all platforms will play different feedback for different weights and intensities" | Yes (iOS, watchOS) | iOS 17 |
| `.alignment` | "the alignment of a dragged item" | iOS and macOS | iOS 17 |
| `.pathComplete` | "a drawn path has completed and/or recognized" | iOS only | iOS 17.5 |
| `.increase` / `.decrease` | "an important value increased above / decreased below a significant threshold" | **No** (watchOS, visionOS only) | iOS 17 |
| `.start` / `.stop` | "an activity started / stopped" | **No** (watchOS only) | iOS 17 |
| `.levelChange` | "movement between discrete levels of pressure" | **No** (macOS only) | iOS 17 |
| `.press(.button/.buttonIconOnly/.slider/.toggle/.tab)`, `.release(.slider)`, `.selection(.on/.off/.minimum/.maximum)` | touch-down, touch-up and value-change feedback for specific controls | **No** (visionOS only) | iOS 26 |

**Modifier variants.** All four are verified in the local SDK, available from iOS 17 (`SwiftUI.swiftinterface` lines 1857–1867) [S6][S26]:
1. `sensoryFeedback(_ feedback:trigger:)` plays "when the provided trigger value changes."
2. `sensoryFeedback(_:trigger:condition:)`, where the condition is `(oldValue, newValue) -> Bool`.
3. `sensoryFeedback(trigger:_:)`, where the closure is `(oldValue, newValue) -> SensoryFeedback?` and returns `nil` to stay silent.
4. `sensoryFeedback(trigger:_:)` with a zero-argument closure `() -> SensoryFeedback?`, an always-emit-into-client wrapper of variant 3.

For variants 2 and 3, the docs add: "when the value changes, the new version of the closure will be called."

A consequence for Debbie: a view inserted into the hierarchy starts with its trigger's current value and sees no change, so a `sensoryFeedback` attached to a newly inserted card never fires. Reasoning: this follows from the "plays when … changes" contract in [S6]. Attach haptic modifiers to a stable container, such as the screen root.

### F4. UIKit `UIFeedbackGenerator` family
All verified in local SDK headers (`UIKit.framework/Headers/UI*FeedbackGenerator.h`) [S7][S9][S26]:
- **`UIImpactFeedbackGenerator`**
  - Styles: `.light`, `.medium`, `.heavy`, plus `.soft` and `.rigid` (iOS 13).
  - `impactOccurred()`, and `impactOccurred(intensity:)` (iOS 13), where intensity is a value "between 0.0 and 1.0."
  - iOS 17.5 adds `init(style:view:)`, `impactOccurred(at:)` and `impactOccurred(intensity:at:)`.
  - `init(style:)` is marked `API_DEPRECATED_WITH_REPLACEMENT("+feedbackGeneratorWithStyle:forView:", ios(10.0, API_TO_BE_DEPRECATED))`.
- **`UINotificationFeedbackGenerator`**: `.success`, `.warning`, `.error`. `notificationOccurred(_:)`, and `notificationOccurred(_:at:)` (17.5).
- **`UISelectionFeedbackGenerator`**: `selectionChanged()`, and `selectionChanged(at:)` (17.5).
- **`UICanvasFeedbackGenerator`** (17.5): `alignmentOccurred(at:)`, `pathCompleted(at:)`. This is drawing-canvas feedback and isn't useful to Debbie.
- **Base class.**
  - `UIFeedbackGenerator(view:)` (17.5) "creates a feedback generator and attaches it to the specified view."
  - The plain `init()` is to-be-deprecated in favour of `init(view:)`.
  - From 17.5 the generator conforms to `UIInteraction`.
  - All generators are `@MainActor` and unavailable on visionOS, tvOS and watchOS.
- **`prepare()`** [S8]:
  - It puts the generator in "a prepared state for a short period of time" (Taptic Engine idle "typically seconds").
  - "Calling prepare() and then immediately triggering feedback … does not improve latency." Call it before the event, and again right after triggering if more feedback may follow within seconds.
  - It is "optional; however, it is highly recommended."
- **UIKit or Core Haptics?** WWDC19 520: "UIKit is built on top of Core Haptics. So both APIs share the same low-latency performance characteristics." Core Haptics "is not a replacement" for the feedback generators [S15].

### F5. Core Haptics (custom patterns)
**Model** [S11][S15][S17]: engine → player → pattern → events. The event types are:
- `hapticTransient`: a "gavel … momentary and instantaneous";
- `hapticContinuous`: like "bowing a stringed instrument", usable as a background texture;
- `audioContinuous` and `audioCustom`: audio in sync with the haptic.

**Parameters.** All verified in local SDK `CHHapticParameter.h` [S14][S26]:
- `hapticIntensity`: strength;
- `hapticSharpness`: from "soft, rounded, or organic" toward 0 to "crisp, precise, or mechanical" toward 1 [S2][S16];
- `attackTime`, `decayTime`, `releaseTime`, `sustained`;
- dynamic controls such as `hapticIntensityControl` (multiplicative) and `hapticSharpnessControl` (additive, continuous only);
- parameter curves.

All values are normalised to 0–1, where 0 "maps to the minimum value the system supports."

Apple's sharpness examples [S15]: the Lock Screen Flashlight button is "very high sharpness", while the App Switcher swipe is "a more round, a lower sharpness haptic."

**AHAP** [S14]:
- A JSON-like file with top-level `Version` and `Pattern`.
- Each `Event` has `EventType` (`HapticTransient`, `HapticContinuous`, `AudioContinuous`, `AudioCustom`), `Time`, `Duration`, `EventParameters` and an optional `EventWaveformPath`.
- `Parameter` and `ParameterCurve` entries sit beside the events.
- Missing keys take defaults; out-of-range values are clamped; unknown keys are ignored.
- Load with `CHHapticPattern(contentsOf:)` (iOS 16), or play directly with `engine.playPattern(from:)` (verified in local SDK) [S26].

**Engine lifecycle** [S12][S13][S26]:
- Check `CHHapticEngine.capabilitiesForHardware().supportsHaptics` first. "Some devices don't support haptic feedback, including iPad, iPod touch, and Apple Vision Pro."
- The initializer fails with `CHHapticErrorCodeNotSupported` on systems without internal haptics (local header).
- Keep a strong reference to the engine.
- Set `stoppedHandler` and `resetHandler` before `start()`. Both are called on a non-main thread (local header).
- **Stopped reasons:** `audioSessionInterrupt`, `applicationSuspended`, `idleTimeout`, `notifyWhenFinished`, `engineDestroyed`, `gameControllerDisconnect`, `systemError`. Restart the engine before the next play.
- **Reset:** restart the engine, re-register audio resources and recreate every player.
- **Other properties:**
  - `isAutoShutdownEnabled` is off by default. When on, the engine stops idle hardware and restarts it on demand, which may delay start times.
  - `playsHapticsOnly` (default NO) and `isMutedForHaptics`. A `playsHapticsOnly` change takes effect after a stop and restart.

### F6. When the system plays nothing
- **The app's own requests** [S10]. Haptic feedback plays only:
  - "On a device with hardware for haptic feedback";
  - "When the app is running in the foreground";
  - "When the system Haptics setting is on".

  The system also weighs "the amount of battery power remaining, and other factors." Apple: "Don't check the device type or app state to conditionally trigger feedback … The system ignores any requests that it can't fulfill."
- **System Haptics.** Settings → Sounds & Haptics → System Haptics: "Play haptics for system controls and interactions." Each alert sound also has a paired vibration pattern [S18].
- **Vibration.** Settings → Accessibility → Touch → Vibration off turns off all vibration. "This setting turns off vibrations for earthquake, tsunami, and other emergency alerts" [S19].
- **Debbie can't detect either setting.** No public iOS API reports them. Verified in local SDK: UIKit, SwiftUI, SwiftUICore, CoreHaptics and Accessibility interfaces were searched; the only match is watchOS Digital Crown's `isHapticFeedbackEnabled` parameter [S26].
- **Recording audio.** `AVAudioSession.setAllowHapticsAndSystemSoundsDuringRecording(_:)` (iOS 13). The header says: "Set … to YES in order to allow system sounds and haptics to play while the session is actively using audio input. Default value is NO." So haptics are suppressed by default while audio input is active (verified in local SDK, `AVFAudio/AVAudioSession.h`) [S26].
- **Simulator.** Plays no haptics [S17].
- **Devices.** iOS 26 and 27 both require iPhone 11 or later [S1]. Every such iPhone postdates the iPhone 8, from which Core Haptics is supported [S15]. In practice every iPhone Debbie runs on has a Taptic Engine. Reasoning: from [S1] and [S15]. iPads don't [S13].

### F7. Accessibility
- Haptics complement other channels and never replace them [S3][S4]. The HIG Accessibility page adds "Use haptics in addition to audio cues" for people who can't perceive the audio [S4].
- VoiceOver has its own "Sounds & Haptics" settings, under Settings → Accessibility → VoiceOver → Audio [S20].
- No Apple document found says app haptics are suppressed while VoiceOver runs. Apple's list of conditions for playback [S10] doesn't mention VoiceOver. Reasoning: expect app haptics to play alongside VoiceOver's own, but treat this as unverified until tested on a device (see Open questions).
- A VoiceOver user may not connect a buzz to an off-screen change. Spoken announcements (`AccessibilityNotification.Announcement`, iOS 17, with priorities) carry the meaning [S25][S26].
- "Make haptics optional" [S2]. The system switches are global. An in-app switch lets someone silence Debbie's in-app feedback without losing system haptics.

### F8. Pairing haptics with motion
- **Principle.** The haptic coincides with the visual event that caused it, and matches its weight [S2][S16][S17].
- **The SwiftUI mechanism.**
  - `sensoryFeedback` fires on the update in which the trigger changes [S6], which is the same transaction that starts the animation.
  - `withAnimation(_:completionCriteria:_:completion:)` can instead run code when an animation ends. `.logicallyComplete` means "the animation has logically completed, but may still be in its long tail," and the completion "will always be fired exactly one time" [S24]. Verified in local SDK: iOS 17, `SwiftUICore.swiftinterface` lines 10127–10148 [S26].
  - For springs, "the new completion handler support in SwiftUI … uses a perceptual duration instead of a settling duration" [S27]. A spring's perceptual duration is its `duration` parameter. So for 03's tokens the completion fires 0.40 s (`state`), 0.45 s (`alertArrive`) or 0.50 s (`present`) after the change. By then the motion has passed its 95 % point (0.30–0.38 s, 03 R1).
- **Decision: fire at the start, for every event (R5).** Recorded here because 04 owns the haptic tokens. Note 03 R13 already says the same, so CRAFT.md §3 and §4 get one rule.
  - The WWDC example of harmony is a ball hitting a wall, where the haptic matches the visible collision [S16]. Debbie's haptic-paired springs have bounce 0 (03 R2), so they decelerate smoothly and show no collision. The only distinct visible moment is the start, when the change first appears.
  - A completion-timed haptic would trail the visible change by 0.1 s or more and mark nothing on screen. For a tapped action such as "I'm On It", it would also break 03 R7's 100 ms response budget.
  - Starting from the state change is the same in every case: an interrupted spring, a Reduce Motion crossfade, or a restored state. It also needs no completion bookkeeping, which keeps the haptic layer testable (R13).
- **Spring choice.** Reasoning: a bouncy spring shows contacts the haptic can't follow, so no haptic is paired with 03's one bouncy token, `settle`. R13 tests this.

## What changed in the current iOS release
- **iOS 27 (27.0 on 14 Sep 2026; 27.2.1 today): nothing relevant to haptics changed.**
  - Apple's SwiftUI updates page (June and September 2026) and UIKit updates page (June and September 2026) list no changes to `SensoryFeedback`, `sensoryFeedback`, the feedback generators or Core Haptics [S21][S22].
  - There is no Core Haptics updates page (it returns 404).
  - The HIG "Playing haptics" change log ends at 7 May 2024 [S2], and Apple's HIG "What's new" feed has no haptics entry in 2026 [S23].
  - The `SensoryFeedback` topic list online (iOS 27 SDK) is identical to the local 26.5 SDK [S5][S26]. Online declarations show `@export(implementation)` where the local SDK has `@_alwaysEmitIntoClient`. That is the same API, but write code against the local signatures.
  - Nothing here needs the iOS 27 SDK.
- **iOS 26, already in our SDK.** It added `SensoryFeedback.press(_:)`, `.release(_:)` and `.selection(_:)`, with `PressFeedback.button`, `.buttonIconOnly`, `.slider`, `.toggle`, `.tab`. Flagged because they look like iPhone button-press haptics, but every one is documented "Only plays feedback on visionOS" [S5].
- **iOS 17.5** added view-anchored generators (`init(view:)`, `init(style:view:)`) and location-based triggers. The old initializers are marked to-be-deprecated [S7][S26].
- **Settings paths.** The System Haptics and Vibration settings are unchanged in the iOS 27 user guide [S18][S19].

## Recommendations for Debbie

**R1. One haptic vocabulary in one place.** ADOPT-TONIGHT. Consistency is the HIG's first rule, and a single choke point makes it checkable [S2].
- Define `enum DebbieHaptic` in the design-system module, with an exhaustive `switch` mapping each event to `SensoryFeedback?`.
- Views play haptics only through one modifier, `.debbieHaptic(_ event:trigger:)`, which wraps `sensoryFeedback(trigger:_:)` [S6].
- **Check:** this lint over app sources, excluding `DesignSystem/Haptics/`, returns nothing:
  `grep -rnE '[Ss]ensoryFeedback|UI[A-Za-z]*FeedbackGenerator|CHHaptic|kSystemSoundID_Vibrate|AudioServicesPlay(Alert|System)Sound' Sources --include=*.swift`
  - It covers the routes that can vibrate the phone, as found in the local SDK [S26]:
    - SwiftUI `sensoryFeedback`, with or without a space before the bracket, and any use of the `SensoryFeedback` type;
    - every UIKit generator, including `UICanvasFeedbackGenerator` and the base `UIFeedbackGenerator(view:)`;
    - all Core Haptics types;
    - AudioToolbox vibration through `kSystemSoundID_Vibrate`, `AudioServicesPlayAlertSound` and `AudioServicesPlaySystemSound`, with or without `WithCompletion`.
  - Tested with BSD grep 2.6.0 on 13 planted raw-haptic lines. The first draft's pattern caught 5, and this one catches all 13 while matching nothing in a clean file [S28].
  - A unit test runs the lint over a planted fixture outside the app target, and fails if the lint passes.

**R2. The haptic map. These are the only events that play anything.** ADOPT-TONIGHT. Every row is causal. Each notification pattern is the outcome of a task or action the person started, which is its documented meaning [S2][S5][S10]. Where no documented meaning fits, the row uses a generic impact instead [S2]. Each paired moment is the start of the visual change (R5), named with the 03 motion token it starts. The priority column feeds R6.

| Event | Fires exactly when | SwiftUI | UIKit (only in UIKit-hosted views) | Priority | Paired visual moment (start of) | Basis |
|---|---|---|---|---|---|---|
| `scanRecognized` | A QR code decodes to a valid, unexpired Debbie pairing or add-laptop payload. Once per scan session | `.impact(weight: .light)` | `UIImpactFeedbackGenerator(style: .light, view:)` + `impactOccurred()` | P5 | The viewfinder snapping onto the code (`state`). Scanning stops at this point (11a R23) | Impact = "a view snaps into place" [S2] |
| `scanInvalid` | A decoded code is not a Debbie code, is the wrong kind for this flow, or has expired. Once per scan session for each failure kind (R6) | `.error` | `UINotificationFeedbackGenerator(view:)` + `.error` | P2 | The inline message appearing (`state`) | The person's scan failed, an outcome of their own action [S2]. Camera: see the notes below |
| `paired` | The pairing bundle is decrypted and stored, meaning the laptop person confirmed that the 4-digit code matched | `.success` | `.success` | P4 | The success mark drawing (`state`, or 03 R12's `confirm` effect) | Significant, and not in front of the person: they are looking at the laptop when they press Confirm, and the phone learns the outcome afterwards [S3] |
| `pairingFailed` | The flow moves into an expired, already-used, wrong-network, timeout or decrypt-failure state | `.error` | `.error` | P2 | The error card entering (`present`) | Failed outcome of the pairing task [S2][S3] |
| `alertUrgentArrived` | A new `alert_id` with urgent severity (for example, possible fall) is first rendered while Debbie is in the foreground, and no system notification sound was presented for it (R12) | `.impact(weight: .heavy)` | `UIImpactFeedbackGenerator(style: .heavy, view:)` + `impactOccurred()` | P1 | The alert card entering (`alertArrive`) | Not the outcome of anything the caregiver did, so no notification pattern fits, and iPhone has no "needs your attention" pattern (F2). The HIG's answer is "use a generic pattern or create your own" [S2]. A heavy impact is the physical metaphor of a heavy card arriving, and the custom pattern replaces it later (R14). Once per `alert_id` |
| `acknowledged` | The caregiver's "I'm On It", or "Mark False Alarm" after its dialog, commits to the local outbox | `.success` | `.success` | P4 | The label changing to the acknowledgement line (`state`) | Outcome of the caregiver's own action, and the most important action in the app, so it is "sufficiently important" for a confirmation [S3]. Under stress the confirmation must not be missed (10 R26) |
| `liveViewStarted` | The first decoded video frame is on screen | `.success` | `.success` | P4 | The video fading in under the LIVE badge (`fadeIn`) | Outcome of the caregiver's request, after a wait the relay allows to run 30 s per poll, which can also end in "denied" or failure. So success is news, and feedback should reach people who "look away from the screen" during the wait [S3]. `.start` is watchOS-only [S5] |
| `liveViewDenied` | The hub replies "denied" | `.warning` | `.warning` | P3 | The denied card entering (`present`) | Outcome of the caregiver's request: it "produced a warning", not a fault, because it's the resident's choice [S5] |
| `liveViewEndedByResident` | The resident turns live view off mid-session | `.warning` | `.warning` | P3 | The video collapsing to the "ended" card (`present`) | Outcome of the live-view session the caregiver started, which ended early for a reason that isn't a fault: "a task or action has produced a warning of some kind" [S5] |
| `liveViewLost` | The connection fails to start, or drops (not Stop, not the time limit) | `.error` | `.error` | P2 | The error card entering (`present`) | The session the caregiver started failed: "an error has occurred" [S5] |
| `laptopApproved` | The coordinator confirms the laptop approval | `.success` | `.success` | P4 | The success mark drawing (`state`) | Significant, because a new device joins the home. The coordinator confirms after the tap, so the result isn't already in front of the person [S3] |
| `laptopApprovalFailed` | The approval is rejected or can't be delivered | `.error` | `.error` | P2 | The error card entering (`present`) | Failed outcome |
| `syncFailed` | "Sync Now" on home Wi-Fi, but the gateway didn't accept | `.error` | `.error` | P2 | The message appearing (`state`) | Failure of a deliberate act. People "only need to know when it doesn't" succeed [S3] |
| `toggleChanged` | The person flips a Debbie toggle (resident live view, resident mode). Programmatic changes never fire it | `.selection` | `UISelectionFeedbackGenerator(view:)` + `selectionChanged()` | P5 | The knob moving (`state`) | Selection = "values … changing" [S2][S5]. Replaces the system switch's built-in haptic |
| `choiceChanged` | The person picks a different role card (caregiver or resident) | `.selection` | `selectionChanged()` | P5 | The selection ring moving (`state`) | Same as above |
| `unpairIncomplete` | The phone is wiped, but the hub couldn't be told | `.warning` | `.warning` | P3 | The "remove it on the laptop too" card entering (`present`) | The unpair task "produced a warning" [S5] |
| `formInvalid` | Submitting the phone name is rejected. Once per submit, never per keystroke | `.error` | `.error` | P2 | The inline error appearing (`state`) | Failure of a deliberate act |

Notes on the map:
- **"Code matches"** has no haptic of its own. The phone cannot know the codes match until the laptop's Confirm produces the pairing bundle, which is `paired`.
- **"Destructive confirm"** (Unpair) uses the system confirmation dialog (see 09-buttons-controls.md, R11). There is no Debbie haptic at confirmation, and none on a clean wipe. Reasoning: a success buzz would celebrate a destructive act, and the return to the pairing screen is the feedback.
- **`syncSucceeded` was removed.** A successful "Sync Now" is the expected result of a routine act, and "Sent to home at 3:12 PM" already confirms it, so it moved to R3. The first draft cited [S3] for it, but [S3] says the opposite: people "only need to know when it doesn't" succeed.
- **`.success` is kept for exactly four events** (`paired`, `acknowledged`, `liveViewStarted`, `laptopApproved`). Each is significant and either arrives after a wait the person doesn't control, or confirms the response to an urgent alert. HIG Feedback reserves confirmation for "activities that are sufficiently important" [S3], and WWDC21 says "Reserve haptics and audio for significant moments" [S17].
- **Camera during scanning.** The HIG warns that haptics can disrupt "device features like the camera" [S2]. `scanRecognized` plays after scanning stops (11a R23), so only `scanInvalid` plays with the camera running. Reasoning for keeping it: the person has to move to another code anyway, and a few shaken frames only delay the next decode, because the scanner keeps reading new frames while it runs (`DataScannerViewController`, 11a R23). R6 limits it to one per failure kind per session. The on-device checklist (R13) checks that a valid code still scans within 2 s of an invalid-code haptic.

**R3. Never gets a haptic.** ADOPT-TONIGHT. Status stays passive [S3], and utility means fewer haptics [S16][S17].
- **Interactions:** ordinary button taps, navigation push and pop (including swipe-back), sheet and dialog presentation, scrolling, typing. Debbie has no pull to refresh (09 R1).
- **Passive status:** every status-header change ("Can't reach home", "Monitoring degraded", "Back online", "This phone was removed from the home"). Non-urgent alerts. Alert wording updates. Acknowledgements delivered later from the queue.
- **Background data:** heart-rate readings arriving, background fetches and their failures, history loading.
- **Live view, ended by the caregiver or on time:** the 5-minute countdown, any "time almost up" notice, Stop by the caregiver, and the session ending at the time limit.
- **Normal-path silence:** a successful "Sync Now" ("Sent to home at 3:12 PM" is the confirmation [S3]), "Sync Now" off home Wi-Fi ("Will send when you're home" is a normal state), a successful unpair, permission priming and system prompts.
- **System-handled contexts:** anything in the Notification Service Extension or while Debbie is in the background (the system ignores it anyway [S10]). Programmatic toggle changes and state restored at launch.

**R4. Only cases that play on iPhone.** ADOPT-TONIGHT. The others are silent no-ops on iPhone and would make the map lie [S5].
- `DebbieHaptic` may return only `.success`, `.warning`, `.error`, `.selection`, `.impact(weight: .light)`, `.impact(weight: .medium)` and `.impact(weight: .heavy)`, all at the default intensity of 1.0.
- `.start`, `.stop`, `.increase`, `.decrease`, `.levelChange`, `.press(_:)`, `.release(_:)` and `.selection(_:)` are banned.
- A unit test iterates `DebbieHaptic.allCases` and asserts each mapping is in the allowed set.

**R5. Timing with motion.** ADOPT-TONIGHT. Synchrony is what makes feedback read as caused [S2][S16]. This is the same rule as 03 R13; F8 records the decision and its reasoning.
- Every event changes its haptic trigger in the same transaction as the state change that starts its visual change. That covers the former "impulse" events (`scanRecognized`, `toggleChanged`, `choiceChanged`) and the former "landing" events (`paired`, `acknowledged`, `liveViewStarted`, `laptopApproved`, `alertUrgentArrived`, and the error and warning cards) alike.
- Nothing fires from an animation completion. The first draft's `.logicallyComplete` triggers are withdrawn, because the completion comes 0.40–0.50 s after the change, after the motion has visibly settled (F8) [S27].
- No haptic is paired with 03's `settle`, the only token with bounce. Each `DebbieHaptic` case names its paired motion token (the R2 column), and R13 tests this.
- The first draft's "logically complete within 400 ms" rule is withdrawn. The number had no source, and with start timing the length of the paired animation doesn't affect synchrony. The bounce rule above is the checkable part.
- Under Reduce Motion, the same event fires at the same moment, when the replacement crossfade starts.
- Attach the modifier to the screen's root container, never to a view inserted in the same update (F3).

**R6. Rate limits and priority.** ADOPT-TONIGHT. Overuse "can cause confusion and diminish the feedback's significance" [S10], and two feelings for one cause break causality [S16]. Each number below has its reasoning beside it.
- **Priority** (the R2 column): P1 `alertUrgentArrived`, P2 errors, P3 warnings, P4 successes, P5 selection and light impact. Reasoning: safety first, then failures, which people must act on ("they only need to know when it doesn't" succeed [S3]), then warnings, confirmations and interaction ticks.
- **Arbitration window W = 0.5 s**, defined in code as `Motion.present.duration`, the longest motion token paired with a haptic (03 R1). Reasoning: two haptics inside one visible transition read as one change with two feelings. Tying W to the token keeps the two in step if 03 retunes.
  - A requested event is dropped if an event of equal or higher priority played less than W earlier.
  - A higher-priority event always plays, even inside W, because a haptic already playing can't be withdrawn. So an urgent alert or an error is never dropped for an earlier selection tick.
- **One per `alert_id`, ever.** Persist the "played" flag with the local alert history.
- **Bursts.** Alerts that arrive in the same delivery are one burst. A delivery is one fetch run with all its pages, whether a reconnect or a push started it. The first urgent alert of the burst plays as soon as its card renders, and the rest of the burst plays nothing. Each card, the list count and the announcement still carry them (R7). Reasoning: defining a burst by delivery, not by a time window, means nothing waits to learn which alert is most severe, and no number is needed. Only urgent alerts have a haptic, so "most severe" never had to be chosen.
- **At most one `.error` per user action.**
- **`scanInvalid` plays once per scan session for each failure kind** (not a Debbie code, wrong kind for this flow, expired; 15-flows-and-states.md). Reasoning: while the camera rests on a wrong code it decodes it many times a second, and a sheet of unrelated codes would buzz on each one. One buzz per kind tells the person something went wrong, and the text says what to do. The first draft's 3 s spacing had no source and is replaced.
- **Check:** unit tests of a pure `HapticArbiter` with an injected clock (R13):
  - P1 inside W after P5 plays.
  - P5 inside W after P1 is dropped.
  - Equal priorities inside W keep the first.
  - Anything after W plays.
  - A second render of the same `alert_id` plays nothing, including after a relaunch.
  - A burst of three urgent alerts plays once.
  - `scanInvalid` plays once per failure kind per session.

**R7. A haptic is never the only signal.** ADOPT-TONIGHT. The HIG requires feedback that works for people who silence the device, look away or use VoiceOver [S3][S4]. Vibration-off users get no vibration at all [S19].
- Every R2 event also has a visible text state change.
- Every R2 event that happens without a direct tap also posts `AccessibilityNotification.Announcement`, for example "Paired with home", "Live view started", "Possible fall alert".
- **Check:** UI tests pass with the haptic layer replaced by a no-op.

**R8. In-app opt-out.** Superseded by lead decision X2: Debbie has no in-app switch, and the system Haptics and Vibration settings govern (HIG Settings, via 14 R2). The original recommendation is kept below for the record. ADOPT-TONIGHT. "Make haptics optional" [S2], and the cost is one settings row and one flag.
- Caregiver Settings has a "Vibration feedback" switch, default On, stored as `@AppStorage("haptics.enabled")`. The R1 modifier reads it.
- It does not change system notification vibration (iOS controls that [S18]).
- The resident's screen shows no such switch. It follows the phone's setting.

**R9. API choice.** ADOPT-TONIGHT. Follows Apple's guidance [S8][S10][S15]; verified in local SDK [S26].
- Use SwiftUI `sensoryFeedback` everywhere it can reach. Tonight's map needs nothing else. The QR scanner and the WebRTC view report their state to SwiftUI, and the haptic fires from that state (R5).
- If a UIKit-hosted view ever needs a haptic of its own, use `UIImpactFeedbackGenerator(style:view:)`, `UINotificationFeedbackGenerator(view:)` or `UISelectionFeedbackGenerator(view:)` (iOS 17.5). Never use the to-be-deprecated `init()` or `init(style:)`.
- `prepare()`: call it only when a trigger is likely within the next second or two, and again right after each trigger if another may follow [S8].
  - The generator stays prepared "for a short period of time", and the Taptic Engine goes idle again once "A short period of time passes (typically seconds)". Also: "if you continue calling prepare() without ever triggering feedback, the system may eventually … ignore any further prepare() calls" [S8]. So preparing when scanning starts, as the first draft said, doesn't help `scanRecognized`.
  - Nothing reliably comes just before a code is recognised. `DataScannerViewController` reports codes already decoded (11a R23), and preparing "and then immediately triggering feedback … does not improve latency" [S8].
  - So `scanRecognized` fires from SwiftUI state with no prepare. SwiftUI's `sensoryFeedback` has no `prepare()` API, and how it handles latency isn't documented [S6]. The on-device checklist (R13) checks that the tick lands with the snap.
- Never check device model or settings before a SwiftUI or UIKit haptic. The system ignores requests it can't fulfil.
- If the deployment target is below 17.5, gate `init(view:)` with `if #available`. Everything else here needs iOS 17. With X18's iOS 26.0 floor, no gate is needed.

**R10. Resident mode uses at most two events:** `toggleChanged` (the live-view switch) and `syncFailed`. A successful "Sync Now" plays nothing (R2, R3). ADOPT-TONIGHT. Reasoning: the brief makes resident mode "as simple as the app can be," and every extra haptic is something to learn.

**R11. Keep haptics alive during live view.** ADOPT-TONIGHT. Audio input silently suppresses haptics by default (F6, verified in local SDK) [S26]. This is cheap, and the alternative is a silent failure.
- The viewer is video only. Configure the WebRTC client with no audio track and no audio-input session.
- If any `AVAudioSession` with input is active during a session, call `setAllowHapticsAndSystemSoundsDuringRecording(true)` so that `liveViewEndedByResident` and `liveViewLost` still play.
- **Check:** a test asserts the session category isn't `.playAndRecord` or `.record` during live view.
- The WebRTC library choice is topic 11's.

**R12. Exactly one tactile signal per urgent alert.** ADOPT-TONIGHT. Two buzzes for one event breaks the one cause, one feeling rule [S2][S16]. Each alert sound has its own paired vibration [S18].
- If the foreground notification-presentation handler lets the system play the notification sound for an `alert_id`, Debbie must not also play `alertUrgentArrived` for it.
- The reverse order needs the same rule. Suppose Debbie has already rendered the alert and played `alertUrgentArrived`, for example because it came first from the LAN gateway. Then `willPresent` for that `alert_id` returns `[.list]`, with no banner and no sound. Note 10 R6 today silences only updates to alerts already on screen, so it needs this case too (Open questions).
- Ownership follows lead decision X4: when a push arrives in the foreground, the system banner and sound own the urgent alert. Debbie's haptic covers only alerts the system didn't sound.

**R13. How to verify.** ADOPT-TONIGHT. Haptics can't be checked by eye or in the Simulator [S17], so the logic is tested and the feel is checked on device.
1. An exhaustive unit test of the R2 table, including R4. It also asserts that no event's paired motion token is `settle`, reading the token values from 03's `Motion.allSprings` (R5).
2. The R1 lint, run in the test lane, with its planted-fixture test.
3. A Debug-only `HapticRecorder`, so UI tests can count events, for example one per `alert_id` and none during navigation and scrolling. This replaces the first draft's `Logger` line. XCUITest runs in a separate process with no API for reading the app's log. On iOS, `OSLogStore` reads only the current process, because the `.system` scope and `local()` are unavailable on iOS (verified in local SDK) [S26].
   - The `DebbieHaptic` choke point (R1) appends each event it plays, after R6's arbitration, to the recorder.
   - With a launch argument (`-DebbieHapticLog YES`), a hidden 1×1 element with `accessibilityIdentifier("haptic-log")` exposes the list as its accessibility value, for example `alertUrgentArrived:A17;acknowledged:A17`. UI tests read that element's `value`.
   - It compiles only under `#if DEBUG`, so it is never in Release or in the demo-home build (brief §3).
   - Fallback for the lane script: run `xcrun simctl spawn booted log stream --predicate 'category == "haptics"'` from the host beside the UI test. The Simulator runtime ships `/usr/bin/log` [S26].
4. The `HapticArbiter` unit tests listed in R6.
5. An on-device feel checklist in `CRAFT.md` §9:
   - each R2 event felt once, at the start of its visual change;
   - nothing felt during scrolling, navigation or status changes;
   - `scanRecognized` felt together with the viewfinder snap, with no lag (R9);
   - a valid code shown within 2 s after an invalid-code haptic still scans (R2 notes).

**R14. A custom "urgent alert" pattern in Core Haptics.** LATER. It needs on-device tuning, which the Simulator can't do [S17], and system patterns suffice tonight [S15].
- An AHAP file in the bundle, played once for `alertUrgentArrived` in place of tonight's `.impact(weight: .heavy)`. This is the HIG's "create your own" route for a meaning no system pattern has [S2].
- Engine: check `capabilitiesForHardware().supportsHaptics`; create one engine (strong reference) when the alert screen appears; set `stoppedHandler` and `resetHandler` before `start()`; set `isAutoShutdownEnabled = true` and `playsHapticsOnly = true`; stop it on disappear; fall back to `.impact(weight: .heavy)` on any failure [S13][S14].
- The pattern must stay short and discrete [S2], and must be distinct from every system pattern so it can earn its own meaning.

**R15. Hold-to-confirm completion haptic.** LATER, together with 09 R12. An impact is the physical metaphor for the ring "latching" shut [S2].
- `.impact(weight: .medium)` exactly once, when the hold ring closes. The first draft said `.heavy`. The heavy impact now means "urgent alert arrived" (R2), so the latch takes the medium weight to keep one pattern to one meaning [S2].
- No continuous or ramping haptic during the hold. Short haptics suit discrete events [S2].

## Open questions / risks
- **VoiceOver and app haptics.** No Apple source states whether `sensoryFeedback` and generator haptics play while VoiceOver is running (F7). Verify on the demo iPhone with VoiceOver on. R7 makes the result non-critical.
- **Foreground notification double-buzz.** R12 now covers both orders. Note 10 R6 still needs the reverse case: `willPresent` should return `[.list]`, with no sound, when Debbie has already played `alertUrgentArrived` for that `alert_id`. The CRAFT.md alert section must state it once, under X4.
- **Conflicts with note 10 (review H2), and the decision.** This note's map (R2) is the single source, and note 10 follows it.
  - The review found three conflicts. Note 10 used `.start`/`.stop` for live view starting and ending, which are watchOS-only and silent on iPhone (R4). It said "no extra app haptic" for an urgent arrival. It used `.error` for a failed live-view start, where 04 uses `.warning` for "denied".
  - Lead decisions X3 and X4 settled all three in 04's favour, and note 10 now uses 04's events (checked 2026-11-14). Its R18 and R26 list `.success` on the first frame, `.warning` for "denied" and for the resident turning it off, `.error` for a lost or never-started connection, and ban `.start`/`.stop`.
  - One difference remains, and this review created it (H4): `alertUrgentArrived` now plays `.impact(weight: .heavy)`, while X4 and note 10 R26 still say `.warning`. Ownership is unchanged (R12). The lead updates the feedback type in X4 and 10 R26 before CRAFT.md is written.
- **WebRTC audio session.** If the chosen WebRTC build activates `playAndRecord` even for receive-only video, R11 is needed. Unknown until the library is chosen.
- **Custom toggles.** Reasoning, not documented: a custom `ToggleStyle` replaces the system switch's drawing, so the system switch haptic [S2] is assumed absent and R2 adds `.selection`. Verify on device that the person doesn't feel two haptics. If they do, drop Debbie's.
- **Low battery and power state.** The system may skip haptics "based on … the amount of battery power remaining" [S10]. The behaviour is undocumented, and R7 covers it.
- **iOS 27-only behaviour** can't be compiled against or tested in the Simulator here. The demo iPhone may run iOS 27.2.1 while the newest Simulator runtime is 26.5. Do the final feel check on the demo iPhone.

## Sources
- [S1] Apple security releases — Apple Support — https://support.apple.com/en-us/100100 — updated 13 Nov 2026 (latest entry) — accessed 2026-11-14 — primary
- [S2] Playing haptics (Human Interface Guidelines) — Apple — https://developer.apple.com/design/human-interface-guidelines/playing-haptics — last changed 7 May 2024 — accessed 2026-11-14 — primary
- [S3] Feedback (Human Interface Guidelines) — Apple — https://developer.apple.com/design/human-interface-guidelines/feedback — undated — accessed 2026-11-14 — primary
- [S4] Accessibility (Human Interface Guidelines) — Apple — https://developer.apple.com/design/human-interface-guidelines/accessibility — last changed 9 Jun 2025 — accessed 2026-11-14 — primary
- [S5] SensoryFeedback and its member pages (success, warning, error, selection, impact…, alignment, pathComplete, increase, decrease, start, stop, levelChange, PressFeedback, ReleaseFeedback, SelectionFeedback) — Apple Developer Documentation — https://developer.apple.com/documentation/swiftui/sensoryfeedback — undated — accessed 2026-11-14 — primary
- [S6] sensoryFeedback(_:trigger:), sensoryFeedback(_:trigger:condition:), sensoryFeedback(trigger:_:) — Apple Developer Documentation — https://developer.apple.com/documentation/swiftui/view/sensoryfeedback(_:trigger:) — undated — accessed 2026-11-14 — primary
- [S7] UIFeedbackGenerator, including init(view:) — Apple Developer Documentation — https://developer.apple.com/documentation/uikit/uifeedbackgenerator — undated — accessed 2026-11-14 — primary
- [S8] prepare() — Apple Developer Documentation — https://developer.apple.com/documentation/uikit/uifeedbackgenerator/prepare() — undated — accessed 2026-11-14 — primary
- [S9] UIImpactFeedbackGenerator, UINotificationFeedbackGenerator, UISelectionFeedbackGenerator, UICanvasFeedbackGenerator, impactOccurred(intensity:) — Apple Developer Documentation — https://developer.apple.com/documentation/uikit/uiimpactfeedbackgenerator — undated — accessed 2026-11-14 — primary
- [S10] Playing haptic feedback in your app — Apple Developer Documentation — https://developer.apple.com/documentation/applepencil/playing-haptic-feedback-in-your-app — undated — accessed 2026-11-14 — primary
- [S11] Core Haptics — Apple Developer Documentation — https://developer.apple.com/documentation/corehaptics — undated — accessed 2026-11-14 — primary
- [S12] CHHapticEngine — Apple Developer Documentation — https://developer.apple.com/documentation/corehaptics/chhapticengine — undated — accessed 2026-11-14 — primary
- [S13] Preparing your app to play haptics — Apple Developer Documentation — https://developer.apple.com/documentation/corehaptics/preparing-your-app-to-play-haptics — undated — accessed 2026-11-14 — primary
- [S14] Representing haptic patterns in AHAP files — Apple Developer Documentation — https://developer.apple.com/documentation/corehaptics/representing-haptic-patterns-in-ahap-files — undated — accessed 2026-11-14 — primary
- [S15] Introducing Core Haptics (WWDC19 session 520) — Apple — https://developer.apple.com/videos/play/wwdc2019/520/ — June 2019 — accessed 2026-11-14 — primary
- [S16] Expanding the Sensory Experience with Core Haptics (WWDC19 session 223) — Apple — https://developer.apple.com/videos/play/wwdc2019/223/ — June 2019 — accessed 2026-11-14 — primary
- [S17] Practice audio haptic design (WWDC21 session 10278) — Apple — https://developer.apple.com/videos/play/wwdc2021/10278/ — June 2021 — accessed 2026-11-14 — primary
- [S18] Change iPhone sounds and vibrations (iPhone User Guide, iOS 27) — Apple Support — https://support.apple.com/guide/iphone/change-sounds-and-vibrations-iph07c867f28/ios — undated — accessed 2026-11-14 — primary
- [S19] Turn off vibration on iPhone (iPhone User Guide, iOS 27) — Apple Support — https://support.apple.com/guide/iphone/turn-off-vibration-iphd722c9100/ios — undated — accessed 2026-11-14 — primary
- [S20] Change your VoiceOver settings on iPhone (iPhone User Guide, iOS 27) — Apple Support — https://support.apple.com/guide/iphone/change-your-voiceover-settings-iphfa3d32c50/ios — undated — accessed 2026-11-14 — primary
- [S21] SwiftUI updates — Apple Developer Documentation — https://developer.apple.com/documentation/updates/swiftui — entries through September 2026 — accessed 2026-11-14 — primary
- [S22] UIKit updates — Apple Developer Documentation — https://developer.apple.com/documentation/updates/uikit — entries through September 2026 — accessed 2026-11-14 — primary
- [S23] What's new (design guidance change feed) — Apple — https://developer.apple.com/design/whats-new/ — latest entry 6 Nov 2026 — accessed 2026-11-14 — primary
- [S24] withAnimation(_:completionCriteria:_:completion:), AnimationCompletionCriteria.logicallyComplete and .removed — Apple Developer Documentation — https://developer.apple.com/documentation/swiftui/withanimation(_:completioncriteria:_:completion:) — undated — accessed 2026-11-14 — primary
- [S25] Build accessible apps with SwiftUI and UIKit (WWDC23 session 10036) — Apple — https://developer.apple.com/videos/play/wwdc2023/10036/ — June 2023 — accessed 2026-11-14 — primary
- [S26] Local iOS 26.5 SDK interfaces (Xcode 26.6): `SwiftUI.framework/Modules/SwiftUI.swiftmodule/arm64e-apple-ios.swiftinterface`, `SwiftUICore.framework/…/arm64e-apple-ios.swiftinterface`, `UIKit.framework/Headers/UI*FeedbackGenerator.h` (including `UICanvasFeedbackGenerator.h` and `UIFeedbackGenerator.h`), `CoreHaptics.framework/Headers/*.h`, `AVFAudio.framework/Headers/AVAudioSession.h`, `AudioToolbox.framework/Headers/AudioServices.h` (`kSystemSoundID_Vibrate`, `AudioServicesPlayAlertSound`, `AudioServicesPlaySystemSound` and their `WithCompletion` forms), `OSLog.framework/Headers/Store.h` (`OSLogStoreSystem` and `localStoreAndReturnError` are `API_UNAVAILABLE(ios, …)`), `Accessibility.framework/Modules/Accessibility.swiftmodule/arm64e-apple-ios.swiftinterface` under /Applications/Xcode.app/Contents/Developer/Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS.sdk/System/Library/Frameworks/. Also the iOS 26.5 Simulator runtime's `/usr/bin/log` — Apple — SDK 26.5 — accessed 2026-11-14 — primary
- [S27] Animate with springs (WWDC23 session 10158): "the duration parameter is a perceptual duration", and "the new completion handler support in SwiftUI … uses a perceptual duration instead of a settling duration" — Apple — https://developer.apple.com/videos/play/wwdc2023/10158/ — June 2023 — accessed 2026-11-14 — primary
- [S28] Local lint check (this review, 2026-11-14): BSD grep 2.6.0-FreeBSD on this Mac (macOS 26.2), run over a planted Swift fixture of 13 raw-haptic lines and a clean file. The first draft's pattern caught 5 of 13, and R1's pattern caught 13 of 13 with no hits in the clean file — primary data

## Review log
Independent review of this note, resolved 2026-11-14.

| ID | Severity | Resolution |
|---|---|---|
| H1 | high | **Fixed.** There is now one rule, recorded with its reasoning in F8 ("Decision") and R5: every haptic fires in the same state change that starts its visual change, never from a completion. This is 03 R13's rule, so 03 needs no change and CRAFT.md §3–4 get a single rule. Reasoning: Debbie's paired springs are critically damped (03 R2), so there is no visible contact to match [S16]. `.logicallyComplete` fires at the perceptual duration, 0.40–0.50 s after the change [S27], after the motion has visibly settled, and would break 03 R7's 100 ms budget for tapped actions. The Summary, F8, R2's paired-moment column and R5 are updated. |
| H2 | medium | **Fixed.** Open questions lists the three conflicts with note 10 and the decision: 04's map is the single source, and X3 and X4 settled the conflicts. `.start` and `.stop` are watchOS-only and silent on iPhone (R4). Note 10 was checked on 2026-11-14, and its R18 and R26 already use 04's events. The one difference this review creates (H4: heavy impact, where X4 and 10 R26 still say `.warning`) is flagged for the lead. R12 pins foreground ownership for both arrival orders, and the reverse case is flagged for 10 R6. |
| H3 | medium | **Fixed.** The 400 ms rule is withdrawn: it had no source, and start timing makes it moot. The checkable constraint is now structural. No haptic pairs with `settle`, the only bouncy token. Each event names its paired token (R2), and R13 tests this through `Motion.allSprings`. F8 gives the completion time per token, from WWDC23's statement about perceptual duration [S27]. |
| H4 | medium | **Fixed.** `alertUrgentArrived` now plays `.impact(weight: .heavy)`. No iPhone pattern means "needs your attention" (only watchOS has one, F2), and the HIG says to "use a generic pattern or create your own" [S2]. R14's custom pattern stays the long-term answer. `liveViewEndedByResident` (`.warning`) and `liveViewLost` (`.error`) are re-justified as outcomes of the live-view session the caregiver started, which matches the documented meanings [S5]. `liveViewDenied`, `scanInvalid` and `unpairIncomplete` are re-justified the same way. R15's latch moved to `.medium` so the heavy impact keeps one meaning. |
| H5 | medium | **Fixed.** `.success` is kept for four events, each with written reasons. `paired` and `laptopApproved` are significant and confirmed later by another device. `acknowledged` is the app's most important action, taken under stress. `liveViewStarted` is a success after a long, uncertain wait, during which people may "look away from the screen" [S3]. `syncSucceeded` is removed and moved to R3, so R10 now has two events. The wrong [S3] citation is corrected. |
| H6 | medium | **Fixed.** R6 is rewritten with priority arbitration P1–P5. A higher priority always plays, and an equal or lower one inside the window is dropped. W = 0.5 s is defined as `Motion.present.duration`, with its reasoning. A burst is defined by delivery (one fetch run), and its first urgent alert plays at once, without waiting. `scanInvalid` plays once per failure kind per session. The unsourced 2 s, 300 ms and 3 s figures are gone. Unit tests for `HapticArbiter` are specified. |
| H7 | medium | **Fixed.** R13 replaces the `Logger` line with a Debug-only `HapticRecorder`. Behind a launch argument, a hidden `haptic-log` accessibility element exposes it, and XCUITest can read it. A host-side `simctl spawn … log stream` is the fallback. The local SDK confirms that `OSLogStore`'s `.system` scope and `local()` are unavailable on iOS [S26]. |
| H8 | low | **Fixed.** R1's lint now matches `[Ss]ensoryFeedback`, `UI[A-Za-z]*FeedbackGenerator`, `CHHaptic`, `kSystemSoundID_Vibrate` and `AudioServicesPlay(Alert\|System)Sound`. It was tested with BSD grep on 13 planted lines: the old pattern caught 5, the new one all 13, with 0 hits in a clean file [S28]. A planted-fixture unit test is now required. |
| H9 | low | **Fixed.** R2's notes add the camera reasoning. `scanRecognized` plays after scanning stops (11a R23), so only `scanInvalid` plays with the camera on, and R6 limits it to one per failure kind per session. The on-device checklist adds "a valid code still scans within 2 s of an invalid-code haptic" (R13). |
| H10 | low | **Fixed.** R9 drops "prepare when scanning starts", because the prepared state lapses within seconds and repeated prepares may be ignored [S8]. `DataScannerViewController` reports codes already decoded (11a R23), so nothing reliably comes before recognition. `scanRecognized` therefore fires from SwiftUI state with no prepare, and the on-device checklist checks that the tick lands with the snap. |

Other edits for consistency:
- R8 is marked superseded by lead decision X2 (no in-app switch), and the `toggleChanged` row no longer lists that switch.
- "Sync now" is written "Sync Now" (X7, X10).
- `liveViewLost` now covers a connection that never starts, as note 10 does.
- The `scanInvalid` failure kinds follow 15-flows-and-states.md.
