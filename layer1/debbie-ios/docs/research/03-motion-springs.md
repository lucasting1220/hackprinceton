# 03 Springs and motion
_Researched 2026-11-14. Toolchain: Xcode 26.6 / iOS 26.5 SDK. Current public iOS: iOS 27.2.1 (released 9 Nov 2026); iOS 27.0 shipped 14 Sep 2026, and iOS 26.7.3 is still offered to devices that stay on 26 [S1]. Xcode 27, which carries the iOS 27 SDK, needs macOS Tahoe 26.6 or later [S1]. This Mac runs macOS 26.2, so nothing that needs the iOS 27 SDK can be built here._

## Questions answered
> "Springs and motion: Apple's guidance and APIs for spring animation, interruptibility, gesture velocity, choreography and timing; Reduce Motion; how featured apps use motion to explain changes of state; how to verify motion from the command line." (KICKOFF_PROMPT.md §9, topic 3)

## Summary
- Apple's rule for motion is **purpose first**. Motion must support the experience and never be the only carrier of important information. People must be able to cancel it, and frequent interactions should get little or no custom motion [S2].
- **Springs are the default tool.** They are the only animation type that keeps position and velocity continuous both from rest and after a gesture. Apple configures them by perceptual `duration` and `bounce`, uses bounce 0 as the general-purpose default, and warns against bounce above about 0.4 [S4]. Since iOS 17, SwiftUI's bare `withAnimation` already runs a smooth spring [S6].
- The SwiftUI presets and conversion maths are verified in the local SDK [S9]:
  - `.smooth` is (0.5 s, bounce 0), `.snappy` is (0.5, 0.15), `.bouncy` is (0.5, 0.3) and `.interactiveSpring` is (0.15, 0.15, blend 0.25).
  - The damping ratio ζ is 1 − bounce, the stiffness is (2π/duration)², and the damping is 4π·ζ/duration.
- **Bounce only where a gesture carried momentum.** Apple's own example: tapping to open the Music Now Playing view uses 100 % damping, while swiping it closed uses 80 % [S5]. Debbie's character (calm, serious, older users) points to bounce 0 almost everywhere.
- **Velocity hand-off works without extra code in SwiftUI.** In iOS 17+, gesture `onChanged` callbacks set `Transaction.tracksVelocity`, so a spring started in `onEnded` inherits the finger's velocity [S12][S4]. In UIKit, use `UIView.animate(.interactiveSpring)` while dragging and then `.spring` (iOS 18), or pass unit velocity to `UISpringTimingParameters` [S8][S10].
- **Interruption.** Springs *merge*: a new change retargets the running spring and keeps its velocity. Timing curves and `interpolatingSpring` *add* instead. Keyframe animations cannot retarget gracefully [S6][S11][S13][S7].
- **Reduce Motion (HIG):**
  - Tighten springs (no bounce) and keep tracking gestures directly.
  - Replace x/y/z movement and zooms with fades.
  - Don't animate into or out of blurs, and cut automatic or repeating motion [S3].
  - Also honour **Prefer Cross-Fade Transitions** through `UIAccessibility.prefersCrossFadeTransitions`. SwiftUI has no environment value for it [S15][S10].
- **What Debbie should adopt:** one `Motion.swift` file holding six named springs (`press`, `state`, `settle`, `alertArrive`, `present`, `exit`), three fades and four symbol-effect tokens. Each has its Reduce Motion substitute, and unit tests plus a source lint enforce them from the command line.
- **iOS 27 changed nothing in Apple's motion or Reduce Motion guidance.** The HIG Motion page was last changed on 9 Sep 2025, and the Accessibility updates page has no 2026 entries [S2][S30]. The new iOS 27 `crossFade` navigation transition needs the iOS 27 SDK, so it is LATER [S28][S29].

## Findings

### 1. Apple's motion principles (HIG)
- **Purpose.** "Add motion purposefully… Gratuitous or excessive animation can distract people and may make them feel disconnected or physically uncomfortable." [S2]
- **Motion is optional.** Don't use motion as the only way to communicate important information, and supplement it with haptics and audio [S2].
- **Realistic, brief, precise feedback.** Motion should follow people's gestures and expectations; for example, a view revealed by sliding down shouldn't be dismissed sideways. Feedback animation should be brief and tied precisely to the action [S2].
- **Frequent interactions.** "In apps, generally avoid adding motion to UI interactions that occur frequently." [S2]
- **Let people cancel motion.** Don't make people wait for an animation before they can act, especially one they'll see repeatedly [S2].
- **System motion is meaningful.** When you use standard views such as SwiftUI Navigation or view controllers, "don't modify or change the built-in animations, which have specific and well-defined meanings." [S17]
- **Liquid Glass** reacts to direct touch with more emphasis than to trackpad input. This is system behaviour and needs no app work [S2].

### 2. Why springs, and how Apple parameterises them
- **Continuity.** Animations should have continuous position *and* velocity. Ease-in-out is continuous from rest but can't take an initial velocity, so it "jerks to a halt" when a gesture hands off. Linear has velocity jumps and suits only things like a repeating spinner. Springs are "the only type of animation that maintains continuity both for static cases and cases with an initial velocity" [S4].
- **Spring properties don't have to finish together.** Different properties, start times and end times combine in the iOS app-launch animation [S4].
- **Duration and bounce:**
  - `duration` is *perceptual*: it sets the pace and stays predictable.
  - `bounce` > 0 overshoots, = 0 is smooth (critically damped), and < 0 is "flattened" (overdamped). Its range is −1…1 [S4].
  - The *settling* duration is different and unpredictable, so don't wait for it before user-facing changes. Use the completion handler, which uses the perceptual duration [S4].
- **Choosing values.** Pick the duration first, then the bounce [S4]:
  - 0 is "smooth, gradual"; about 0.15 is "a little more brisk"; about 0.3 is noticeably bouncy.
  - Be cautious above about 0.4. "When you're not sure, use a spring with bounce 0."
  - Bounce suits playful moments or the end of a gesture. Keep values consistent with the app's character: "serious or playful… relaxed or fast-paced."
- **Damping ratio and response (2018 vocabulary).** Apple avoided the word "duration" for elastic behaviour at the time. The advice is to "start with 100 % damping", and to reward momentum with "a little bit of overshoot" when the gesture driving the motion has momentum. Bounce can also be a functional *hint* [S5].
- **Conversions, verified in local SDK** [S9]. These come from `springStiffness`, `springDamping` and `springDampingFraction` in `SwiftUICore.swiftinterface`, which `.spring(duration:bounce:)` uses:
  - `response = duration`
  - `dampingFraction (ζ) = 1 − bounce` (bounce ≥ 0) or `1 / (1 + bounce)` (−1 < bounce < 0)
  - `mass = 1`, `stiffness = (2π / duration)²`, `damping = 2·√stiffness·ζ = 4π·ζ / duration`
  - The damping equation in the session's code listing reads `1 - 4π × bounce ÷ duration`, which doesn't match the shipped SDK maths [S4]. Use the SDK form above.
- **Presets** (verified in local SDK; the defaults are in `@_alwaysEmitIntoClient` bodies) [S9]:
  - `Spring.smooth`/`Animation.smooth` = (0.5, 0)
  - `snappy` = (0.5, 0.15 + extraBounce)
  - `bouncy` = (0.5, 0.3 + extraBounce)
  - `Animation.spring` = `spring(duration: 0.5, bounce: 0)`
  - `interactiveSpring(duration: 0.15, extraBounce: 0, blendDuration: 0.25)` = bounce 0.15
  - The legacy `spring(response: 0.5, dampingFraction: 0.825)` and `interactiveSpring(response: 0.15, dampingFraction: 0.86, blendDuration: 0.25)` remain as `@_disfavoredOverload`.
  - The duration/bounce `Animation` factories are marked iOS 13+ because they're inlined into the client. The `Spring` model type itself is iOS 17+.
- **The `Spring` model** (iOS 17; verified in local SDK) [S9]:
  - Initialisers: `init(duration:bounce:)`, `init(response:dampingRatio:)`, `init(mass:stiffness:damping:allowOverDamping:)` and `init(settlingDuration:dampingRatio:epsilon:)`.
  - Read-only properties: `duration`, `bounce`, `response`, `dampingRatio`, `mass`, `stiffness`, `damping` and `settlingDuration`.
  - Evaluation: `value(target:initialVelocity:time:)`, `velocity(target:initialVelocity:time:)`, `settlingDuration(target:initialVelocity:epsilon:)`, `update(value:velocity:target:deltaTime:)` and `force(target:position:velocity:)`.
  - Use it in an animation with `Animation.spring(_ spring:blendDuration:)` or `Animation.interpolatingSpring(_ spring:initialVelocity:)`.
- **UIKit and Core Animation take the same two parameters** [S4][S10]:
  - `UIView.animate(springDuration:bounce:initialSpringVelocity:delay:options:animations:completion:)`, iOS 17.
  - `UISpringTimingParameters(duration:bounce:initialVelocity:)`, iOS 17, with a `CGVector` unit velocity.
  - `CASpringAnimation(perceptualDuration:bounce:)`, iOS 17.
  - `UIView.animate(_ animation: SwiftUI.Animation, changes:completion:)`, iOS 18, declared in the SwiftUI module.
  - All verified in local SDK.

### 3. Gesture velocity and hand-off
- **SwiftUI (iOS 17+).** "SwiftUI will now automatically track velocities any time a gesture is changing properties" [S4].
  - The mechanism is `Transaction.tracksVelocity`: "Gesture onChanged and updating callbacks automatically set this property to true… when the interaction ends, an animation can use the accumulated velocities" [S12].
  - So: don't animate in `onChanged`, then `withAnimation(spring)` in `onEnded`.
  - The same works for non-gesture streams, for example a slider: set `transaction.tracksVelocity = true` for intermediate changes and use an animated transaction for the final one [S12].
- **`DragGesture.Value`** (verified in local SDK) [S9]:
  - `velocity: CGSize` (pt/s) is defined as `4 × (predictedEndLocation − location)`, an `@_alwaysEmitIntoClient` computed property, so it back-deploys.
  - `predictedEndTranslation` and `predictedEndLocation` project the gesture about 0.25 s ahead.
  - `DragGesture(minimumDistance:)` defaults to 10 pt, matching Apple's statement that swipe hysteresis "is usually 10 points in iOS" [S5][S9].
- **Projection.** Use momentum to choose the *destination*, not just the nearest snap point. Apple's PiP example throws to the projected corner using the scroll deceleration rate [S5]. The function shown is `(v/1000)·r/(1−r)`.
  - Reasoning: this is the distance travelled when per-millisecond velocity decays geometrically by factor r.
  - Computed here: at 900 pt/s it projects 449 pt with r = 0.998 and 89 pt with r = 0.99.
- **Explicit velocity.** `Animation.interpolatingSpring(duration:bounce:initialVelocity:)` takes "a value in the range [0, 1] representing the magnitude of the value being animated", which is a *unit* velocity (velocity ÷ distance). It "preserves velocity across overlapping animations by adding the effects of each animation" [S11]. `Animation.spring(duration:bounce:blendDuration:)` is a "persistent" spring: when mixed with other springs on the same property, "each animation will be replaced by their successor, preserving velocity" [S13].
- **UIKit unit velocity.** Per the `UIView.h` header, it is "a unit coordinate system, where 1 is defined as traveling the total animation distance in a second". Changing position by 200 pt while the object moves at 100 pt/s → pass 0.5 (verified in local SDK) [S10].
- **WWDC24 pattern** (iOS 18) [S8]:
  - While dragging, each change event calls `UIView.animate(.interactiveSpring)`, and each new animation retargets the last.
  - On `.ended`, call `UIView.animate(.spring)`. That spring "uses the velocity from the interactiveSprings… with continuous velocity", so there's no manual velocity maths.
  - In representables, `context.animate { … }` bridges the SwiftUI transaction's animation onto UIKit views, in sync.

### 4. Interruption, retargeting and completion
- **Springs and timing curves merge differently.** When a new animation starts on a property that is already animating, timing curves (`shouldMerge` = false) run together and their results are combined, which is additive. "Spring animations override shouldMerge to return true… preserve velocity and retarget to the new value" [S6].
- **Keyframes don't retarget.** "Keyframe animations can't gracefully retarget the way that springs can, so it's generally best to avoid changing keyframes mid-animation." [S7]
- **Completion.** `withAnimation(_:completionCriteria:_:completion:)` (iOS 17) defaults to `.logicallyComplete`; `.removed` is the alternative. `Transaction.addAnimationCompletion(criteria:_:)` and `Animation.logicallyComplete(after:)` are also available (verified in local SDK) [S9]. Apple: use this rather than waiting for the settling duration [S4].
- **Fluid zoom transitions can start at any time** [S8]:
  - Code must not branch on "being in a transition".
  - An interrupted push is never cancelled; it "is always converted into a pop".
  - Reset any transition state in `viewDidAppear`/`viewDidDisappear`.

### 5. Choreography and timing tools
- **`animation(_:body:)`** (iOS 17) scopes an animation to specific modifiers. Apple's example animates a shadow with `.smooth` and a scale with `.bouncy` on one view [S6]. Verified in local SDK [S9].
- **`Transaction` and custom `TransactionKey`s** carry *why* a change happened, so the receiving view can choose its animation. Apple's example uses `.bouncy` for a tap and `.smooth` for a programmatic change, with `transaction(value:_:)` and `withTransaction(_:_:_:)` [S6]. `Transaction.disablesAnimations` (iOS 13) is verified in local SDK [S9].
- **`PhaseAnimator` and `.phaseAnimator(_:trigger:content:animation:)`** (iOS 17) step through discrete phases. They suit repeating loops and event-driven sequences, with a separate animation per phase [S7]. Verified in local SDK [S9].
- **`KeyframeAnimator` and `.keyframeAnimator(initialValue:trigger:content:keyframes:)`** (iOS 17) run independent tracks: `LinearKeyframe`, `SpringKeyframe`, `CubicKeyframe` and `MoveKeyframe` [S7][S9].
  - SwiftUI keeps velocity continuous between keyframes.
  - The content closure runs every frame, so "avoid performing any expensive operations" [S7].
- **The iOS 17 default.** A bare `withAnimation` uses a smooth spring [S6].
- **Fades.** `Animation.easeInOut` has a default duration of 0.35 s [S18].
- **Secondary guidance on duration** (NN/g):
  - Feedback animations about 100 ms; modal-size changes 200–300 ms.
  - Most UI animation 100–400 ms; 500 ms "start[s] to feel like a real drag".
  - Exits slightly shorter than entrances; ease-out for entering and ease-in for leaving [S34].
- **Perception threshold.** A discrete interaction feels instant below about 100 ms, and 250 ms "doesn't feel instant anymore" [S19]. This bounds how long Debbie can delay the *start* of any response.

### 6. Reduce Motion and related settings
- **HIG.** "Be cautious with fast-moving and blinking animations…". When Reduce Motion is on, reduce "automatic and repetitive animations, including zooming, scaling, and peripheral motion" [S3]. The HIG's list:
  1. tighten springs to reduce bounce
  2. track animations directly with people's gestures
  3. avoid animating depth changes on the z-axis
  4. replace x/y/z transitions with fades
  5. avoid animating into and out of blurs
- **SwiftUI.** `EnvironmentValues.accessibilityReduceMotion` (iOS 13, get-only; verified in local SDK): "UI should avoid large animations, especially those that simulate the third dimension." [S14][S9]
- **UIKit** (Swift names from `UIKit.apinotes`; verified in local SDK) [S10][S15]:
  - `UIAccessibility.isReduceMotionEnabled` (iOS 8) and `UIAccessibility.reduceMotionStatusDidChangeNotification`.
  - `UIAccessibility.prefersCrossFadeTransitions` (iOS 14), which is true when both Reduce Motion and Prefer Cross-Fade Transitions are on, and `UIAccessibility.prefersCrossFadeTransitionsStatusDidChange`.
  - The SwiftUI interfaces have no cross-fade preference: grep for "crossfade" finds nothing outside the iOS 27 navigation API [S9].
- **System transitions.** A developer blog reports, while noting it is undocumented, that the iOS 18 zoom navigation transition automatically falls back to a standard push under Reduce Motion. Custom animations are the app's responsibility [S35].
- **Symbol effects.** `.symbolEffectsRemoved(_:)` (iOS 17) removes all symbol effects from a subtree (verified in local SDK) [S9].
- **Repeating motion (secondary, web standards used as a bar):**
  - WCAG 2.3.3 (AAA): motion triggered by interaction can be disabled unless it is essential [S31].
  - WCAG 2.2.2 (A): moving or blinking content that starts automatically, lasts more than 5 s and runs in parallel with other content needs a way to pause, stop or hide it [S32].
  - WCAG 2.3.1 (A): no more than three flashes in any one second [S33].
- **Command-line testing.** `xcrun simctl ui` can set appearance, Increase Contrast and content size, but **not Reduce Motion** (checked locally with `xcrun simctl help ui`) [S22]. Testing Reduce Motion from the command line therefore needs an app-side override.

### 7. Symbol animations as state language
The HIG gives each effect a meaning [S16]:

| Effect | HIG meaning |
|---|---|
| Bounce | An action occurred or needs to take place |
| Pulse | Ongoing activity |
| Variable colour | Progress, connecting or broadcasting |
| Replace | A change in state (down-up), forward progression (up-up), or emphasis on the next action (off-up) |
| Wiggle | A change or call to action that people might overlook |
| Breathe | A status change or an ongoing activity such as a recording session |
| Rotate | A task is in progress |
| Draw On / Draw Off | Progress or emphasis (SF Symbols 7) |

The HIG adds: apply them "judiciously" and with "a clear purpose", and they work on custom symbols too [S16].

Availability (verified in local SDK) [S10]:
- Pulse, Bounce, Variable colour, Scale, Appear, Disappear and Replace: iOS 17.
- Wiggle, Rotate, Breathe and `magic(fallback:)`: iOS 18.
- Draw On and Draw Off: iOS 26.

### 8. How featured apps use motion to explain changes of state (techniques only)
- **Momentum decides bounce.** Tapping to open Now Playing has no momentum toward the presentation, so it uses 100 % damping. Swiping it closed has momentum, so it uses 80 % damping for "a little bit of bounce and squish" [S5].
- **Discrete animations rehearse the gesture.** Safari's close button slides the tab left, which teaches that a left swipe closes tabs [S5].
- **Hinting.** Control Center modules grow toward the finger before opening, and the Flashlight button bounces on a tap to teach that a firmer press is needed [S5].
- **Spatial consistency.** Things leave along the path they came in on, because symmetric paths match object permanence [S5].
- **Projection.** Thrown objects land where their momentum takes them (PiP corners) [S5].
- **Layered springs.** App launch is several springs with different start and end times [S4].
- **What recent Apple Design Award pages praise** (they never give parameters):
  - Flighty (2023 Interaction winner): journey states shown through Live Activities and the Dynamic Island [S23].
  - oko (2024 winner, inclusivity): signal state conveyed through haptics and audio, not only visuals [S24].
  - Denim (2025 winners-and-finalists page): "smooth scroll transitions" and "custom haptics" in a SwiftUI app [S25].
  - Tide Guide (2026 page): "custom animations" in data presentation, plus a palette that follows the sky through the day [S26].
  - Reasoning: the common thread is that state lives in more than one channel (motion, symbol, haptic, system surface), and motion confirms a change rather than decorating it.

### 9. Verifying motion from the command line
- **The Spring model is testable.** `Spring` exposes `value`, `velocity` and `settlingDuration`, so a test can assert each catalogue entry's shape [S9]. This file's table was computed that way with `SwiftUI.Spring` on this Mac.
- **Animation internals are not.** `Animation.animate(value:time:context:)` is public, but `AnimationContext` has no public initialiser (verified in local SDK) [S9], so Debbie can't step a SwiftUI `Animation` in a unit test. Store `Spring` values and test those instead.
- **Hitch metrics** (verified in local SDK) [S21]:
  - `XCTHitchMetric(application:)` (iOS 26).
  - `XCTOSSignpostMetric` animation intervals report fps, frame count, hitch count, hitch time and hitch time ratio. Built-ins: `navigationTransitionMetric`, `customNavigationTransitionMetric` and `scrollingAndDecelerationMetric`.
  - Apple's settings for performance tests: a separate scheme, Release configuration, no debugger, no screenshots, no code coverage, no diagnostics [S20].
  - `xcrun xctrace` lists the "Animation Hitches" and "SwiftUI" templates (checked locally) [S22].
- **Hitch-ratio targets:** below 5 ms/s is good, 5–10 ms/s is noticeable, and 10 ms/s or more is critical [S20]. Topic 05 covers the new field thresholds.

## What changed in the current iOS release
- **iOS 27 (14 Sep 2026; now 27.2.1)** [S1].
  - **Nothing changed in Apple's motion guidance.** HIG Motion was last changed 9 Sep 2025 (Liquid Glass) [S2]. HIG Accessibility was last changed 9 Jun 2025 [S3]. The Accessibility updates page has no 2026 entry [S30]. Reduce Motion APIs and HIG rules are the same as in iOS 26.
  - **New in iOS 27 SDK: `NavigationTransition.crossFade`** (`CrossFadeNavigationTransition`, iOS 27.0), for example a sheet that fades in instead of sliding up [S28][S29]. It is **absent from our iOS 26.5 SDK** (grep: 0 matches) [S9]. Needs the iOS 27 SDK, Xcode 27 and macOS 26.6+ [S1] → LATER.
  - **The refreshed Liquid Glass look** arrives automatically when apps are built with Xcode 27 [S27]. Builds from our SDK may look and move differently from iOS 27-native apps on an iOS 27 phone (open question below).
  - **`@State` becomes a macro** (lazy class initialisation) when building with Xcode 27 [S27][S28]. This is a performance change; it needs Xcode 27.
- **Earlier releases still matter for our availability floor** (verified in local SDK) [S9][S10][S21]:
  - iOS 17: the `Spring` type, `snappy`/`smooth`/`bouncy`, `PhaseAnimator`/`KeyframeAnimator`, `withAnimation(completion:)`, `tracksVelocity`, `animation(_:body:)` and most symbol effects.
  - iOS 18: Wiggle, Rotate and Breathe, `UIView.animate(SwiftUI.Animation)` and zoom navigation.
  - iOS 26: Draw On and Draw Off (SF Symbols 7, HIG updated 28 Jul 2025 [S16]) and `XCTHitchMetric`.

## Recommendations for Debbie

**R1. Put the whole motion vocabulary in one file, `DesignSystem/Motion.swift`.** — ADOPT-TONIGHT: consistency and testability need a single source [S4].
- Store each spring as a `Spring` value, the source of truth, and expose a matching `Animation` with `.spring(Motion.state)`.
- These values were computed with `SwiftUI.Spring` on this Mac [S9]. Durations and bounces follow Apple's guidance: bounce 0 by default, bounce only for momentum, nothing near 0.4 [S4][S5]. Durations sit inside Apple's preset range (0.15–0.5 s) [S9] and the secondary 100–500 ms band [S34].

| Token | `Spring(duration:, bounce:)` | ζ | 80 % at | 95 % at | Settled (removed) | Overshoot | Use for | Reduce Motion |
|---|---|---|---|---|---|---|---|---|
| `press` | 0.20, 0 | 1.00 | 0.096 s | 0.152 s | 0.30 s | 0 | Custom control pressed state, both directions | Same spring, but no scale, only an opacity or highlight change |
| `state` | 0.40, 0 | 1.00 | 0.191 s | 0.303 s | 0.60 s | 0 | In-screen state changes: status header, expand/collapse, list reorder, selection, numeric text | Colour and opacity keep `state`; position and size reflow without animation (`nil`) |
| `settle` | 0.40, 0.15 | 0.85 | 0.165 s | 0.235 s | 0.72 s | 0.6 % | Only the end of a gesture that carried momentum (drag release); always inherits velocity | `Spring(duration: 0.40, bounce: 0)`; keep 1:1 tracking (allowed by HIG [S3]) |
| `alertArrive` | 0.45, 0 | 1.00 | 0.215 s | 0.340 s | 0.70 s | 0 | A new possible-fall or heart alert card entering in-app, and its siblings making room | `fadeIn` only; siblings reflow without animation |
| `present` | 0.50, 0 | 1.00 | 0.239 s | 0.378 s | 0.80 s | 0 | Custom (non-system) presentations and large moves: inline panels, banners, matched-geometry morphs | `crossFade` |
| `exit` | 0.30, 0 | 1.00 | 0.143 s | 0.227 s | 0.50 s | 0 | Custom elements leaving: banner out, card removed | `fadeOut` |

- Reasoning for `alertArrive` at bounce 0 and 0.45 s: urgent content must look serious, not playful [S4]. 0.45 s keeps the 95 % point at 0.34 s, inside the 200–300 ms + settle band for substantial changes [S34], while staying calmer than `state`.

**R2. Bounce policy: 0 everywhere except `settle` (0.15).** — ADOPT-TONIGHT: Debbie is a calm safety tool [S4][S5].
- No token may have bounce > 0.2.
- `.bouncy`, `.snappy`, `interactiveSpring` and positive `extraBounce` are banned outside `Motion.swift`.
- Check: a unit test iterates `Motion.allSprings` and asserts `0 ≤ bounce ≤ 0.15` and `0.15 ≤ duration ≤ 0.5`, and `settlingDuration ≤ 0.8 s` for every token.

**R3. No anonymous animations.** — ADOPT-TONIGHT: Reasoning: an unnamed default is untestable and drifts from the catalogue [S4][S6].
- Never call a bare `withAnimation { }`, `.animation(.default, value:)`, `.easeInOut` or `.linear` outside `Motion.swift`.
- `.linear` is allowed only for an indeterminate rotation [S4].
- Check: `grep -rnE 'withAnimation *\{|withAnimation\(\)|\.animation\(\.default|\.(easeIn|easeOut|easeInOut|linear|bouncy|snappy|interactiveSpring)\b' Sources --include=*.swift | grep -v Motion.swift` must print nothing.

**R4. Gesture hand-off pattern (SwiftUI, iOS 17+).** Use it wherever Debbie has a custom drag. The first candidate is drag-down-to-close on the full-screen live view, as a secondary path beside the Stop button. — ADOPT-TONIGHT: required "carrying gesture velocity" craft, and nearly free in SwiftUI [S12][S4].
- `onChanged`: assign the translation with **no** animation. SwiftUI tracks velocity [S12].
- `onEnded`: decide using `value.predictedEndTranslation` (projection [S5]), not the release position.
  - Commit when the projected translation ≥ 40 % of the container height. Reasoning: a flick dismisses; a slow nudge springs back.
  - Then `withAnimation(Motion.settleAnimation)` to the chosen end, so velocity carries over automatically [S4][S12].
- Keep `DragGesture`'s default `minimumDistance` of 10 pt [S5][S9].
- For a drag that stops the live view, call the relay's stop before teardown, as the brief requires. Motion completion must not gate the stop request.

**R5. Explicit velocity when no gesture is driving the value.** — LATER: only needed if UIKit views or non-gesture streams appear.
- SwiftUI: `.interpolatingSpring(Motion.settle, initialVelocity: v / remainingDistance)`. It is additive, so use it only for one-shot hand-offs [S11].
- UIKit (for example a WebRTC host view): either `UIView.animate(.interactiveSpring)` while dragging then `UIView.animate(Motion.settleAnimation)` at the end (iOS 18) [S8], or `UIViewPropertyAnimator(duration: 0, timingParameters: UISpringTimingParameters(duration: 0.40, bounce: 0.15, initialVelocity: CGVector(dx: vx/dx, dy: vy/dy)))` (iOS 17) [S10].

**R6. Interruptibility rules.** — ADOPT-TONIGHT: HIG "Let people cancel motion" [S2]; springs retarget [S6].
- (a) Never disable hit-testing or buttons because an animation is running. Disable only while a network request is in flight, and say so in text.
- (b) Chain steps with `withAnimation(_:completionCriteria: .logicallyComplete, _:completion:)` [S9]. Never use `DispatchQueue.main.asyncAfter` or `Task.sleep` with an animation duration [S4].
- (c) Drive every animation from state, so a new change retargets the running spring [S6].
- Check: `grep -rnE 'asyncAfter|Task\.sleep' Sources/**/Views` is empty, and UI tests tap Acknowledge again during the arrival animation and expect one queued acknowledgement.

**R7. Choreography budget.** — ADOPT-TONIGHT: keeps the response under the 100 ms "instant" threshold [S19].
- The element the person touched starts moving in the same transaction as the input (0 ms delay).
- At most 3 elements may be staggered, 40 ms apart, so no more than 80 ms is added.
- Different properties may finish at different times [S4]; use `animation(_:body:)` per modifier rather than delays [S6].
- No `.delay()` > 0.08 s outside `Motion.swift`.

**R8. Tag the cause in the transaction.** — ADOPT-TONIGHT: no motion on cold start or restore [S6].
- Define a `TransactionKey` `isRestore`.
- Alerts loaded from the local history at launch, or deduplicated replays of an `alert_id`, are applied with `disablesAnimations = true` [S9].
- Only *live* arrivals animate with `alertArrive`. Reasoning: animating stale data misstates what just happened.

**R9. `PhaseAnimator` and `KeyframeAnimator` only for one-shot, non-interruptible confirmations** (pairing succeeded, laptop added). — LATER: decorative; ship the core flows first.
- Total ≤ 0.8 s, no repeat, nothing the user must wait for, expensive work kept out of the per-frame closure [S7].
- Disabled under Reduce Motion.

**R10. A `MotionPolicy` environment value.** It combines `accessibilityReduceMotion` [S14] and `UIAccessibility.prefersCrossFadeTransitions`, observed through `UIAccessibility.prefersCrossFadeTransitionsStatusDidChange` [S15][S10]. A DEBUG-only launch argument, `-DebbieReduceMotion YES`, forces it on for tests, because simctl can't [S22]; Release builds compile the override out (brief §3). — ADOPT-TONIGHT: accessibility is a hard requirement, and this makes it testable [S3].
- The policy maps tokens to their Reduce Motion substitutes (R1 table) and defines:
  - `transition(.move/.push/.scale/.blurReplace)` → `.opacity` [S3]
  - repeating effects → none
  - bounce → 0
- Check: unit tests cover the mapping for both policy values. A snapshot test renders key screens with the override on.

**R11. Fade tokens.** Opacity-only changes use timing curves: velocity continuity matters little for opacity [S4]. — ADOPT-TONIGHT: the Reduce Motion substitutes need named values.
- `fadeIn` = `.easeOut(duration: 0.25)` (entrances) [S34]
- `fadeOut` = `.easeIn(duration: 0.20)` (exits, shorter) [S34]
- `crossFade` = `.easeInOut(duration: 0.30)` (screen-level and Reduce Motion substitutions; under Apple's 0.35 s default [S18])
- `spin` = `.linear(duration: 1.0).repeatForever(autoreverses: false)`, only for an indeterminate rotation [S4]

**R12. Symbol-effect tokens with fixed meanings** [S16]. — ADOPT-TONIGHT if topic 08 ships the icons as custom *symbols* (effects work on custom symbols [S16]); otherwise LATER.

| Token | Effect | Where | Fallback below iOS 18 |
|---|---|---|---|
| `attention` | `.bounce`, once | The alert glyph of a newly arrived possible-fall alert | — |
| `live` | `.breathe`, continuous | The "camera is live" icon, only while the stream is live | `.pulse` |
| `working` | `.rotate` | "Connecting…" | `.variableColor.iterative` |
| `confirm` | `.replace` (down-up) | Acknowledged, saved | `.drawOn` (iOS 26) for the check mark on iOS 26+ |

- Everything sits under `.symbolEffectsRemoved(motion.reduce)` [S9].
- Never more than one effect running per screen. Reasoning: "Apply symbol animations judiciously" [S16].

**R13. Motion is never the only signal.** — ADOPT-TONIGHT: HIG "Make motion optional" [S2]; oko and Flighty show state across several channels [S23][S24].
- Every animated state change also changes text, icon or colour.
- New alerts also post a VoiceOver announcement.
- Paired haptics fire from the *same* state change through `.sensoryFeedback(_:trigger:)` (iOS 17; verified in local SDK [S9]) at animation start, not at completion. Reasoning: the start is the only fixed moment of a spring, and it keeps feedback under 100 ms [S19].

**R14. Rules for repeating motion.** — ADOPT-TONIGHT: the live cue must be unmistakable but safe [S3][S32][S33].
- Only `live` and `working` may repeat, and only while their condition is true.
- Nothing flashes more than 3 times in any second.
- Under Reduce Motion, both become static and carry the words "Camera is live" or "Connecting…".

**R15. Verification from the command line.** — ADOPT-TONIGHT: "nothing is done without evidence" (CLAUDE.md).
- (a) `MotionTests` (Swift Testing) assert R1/R2 bounds and the R10 mapping.
- (b) The R3 and R6 grep lint runs in `fastlane test`.
- (c) Snapshot tests set `Transaction.disablesAnimations` so they never capture mid-animation frames [S9].
- (d) Hitch UI tests use `XCTHitchMetric` and `navigationTransitionMetric` in a Release-configured performance scheme on a physical device; thresholds are in 05 [S20][S21].

**R16. Availability.** The motion system needs **iOS 17** at minimum (`Spring`, `tracksVelocity`, `withAnimation(completion:)`, symbol effects). — ADOPT-TONIGHT: needed for the minimum-iOS decision the brief leaves to research.
- Gate iOS 18 items (Breathe, Wiggle, Rotate, `UIView.animate(SwiftUI.Animation)`, zoom) and iOS 26 items (Draw On/Off) with `if #available` and the fallbacks above [S9][S10].
- Input to the minimum-iOS decision (topic 02): no motion feature requires more than iOS 17.

**R17. Revisit iOS 27 items once Xcode 27 is available.** — LATER: needs the iOS 27 SDK, Xcode 27 and macOS 26.6+ [S1].
- `NavigationTransition.crossFade` for sheets as the Reduce Motion presentation [S29].
- Re-check whether HIG Motion changes.

## Open questions / risks
- **Reduce Motion and zoom.** The standard-push fallback for zoom under Reduce Motion is reported by a secondary source but undocumented [S35]. Verify on the demo device with Reduce Motion on before relying on it. 05-R5 has the conditional fallback.
- **SDK mismatch on iOS 27 phones.** The demo phone may run iOS 27, while Debbie is built with the iOS 26.5 SDK. System animations, such as sheets and the refreshed Liquid Glass, may differ from iOS 27-native apps [S27]. Record screens on the actual demo device.
- **Symbol effects depend on asset format.** They only work if topic 08 delivers icons as symbol templates; plain vector images can't use `symbolEffect` [S16]. Coordinate before building R12.
- **Legacy `spring()` behaviour.** `.spring(response:dampingFraction:)` defaults (0.5/0.825) differ from `.spring` (bounce 0). Copied legacy code silently changes feel [S9]. R3's lint catches unnamed uses.
- **Untested assumptions.** The thresholds in R4 (40 % projection) and R7 (40 ms stagger) are reasoned, not Apple-specified. Tune them on device and record the values in `CRAFT.md`.

## Sources
- [S1] Apple security releases — Apple Support — https://support.apple.com/en-us/100100 — living page; rows read: iOS 27 (14 Sep 2026), iOS 27.2 (26 Oct 2026), iOS 27.2.1 and iOS 26.7.3 (09 Nov 2026), Xcode 27 (14 Sep 2026, "macOS Tahoe 26.6 and later") — accessed 2026-11-14 — primary
- [S2] Human Interface Guidelines: Motion — Apple — https://developer.apple.com/design/human-interface-guidelines/motion — last changed 2025-09-09 (change log) — accessed 2026-11-14 — primary
- [S3] Human Interface Guidelines: Accessibility (motion section) — Apple — https://developer.apple.com/design/human-interface-guidelines/accessibility — last changed 2025-06-09 — accessed 2026-11-14 — primary
- [S4] Animate with springs (WWDC23 session 10158), transcript and code — Apple — https://developer.apple.com/videos/play/wwdc2023/10158/ — 2023-06-09 — accessed 2026-11-14 — primary
- [S5] Designing Fluid Interfaces (WWDC18 session 803), transcript — Apple — https://developer.apple.com/videos/play/wwdc2018/803/ — 2018-06-06 — accessed 2026-11-14 — primary
- [S6] Explore SwiftUI animation (WWDC23 session 10156), transcript and code — Apple — https://developer.apple.com/videos/play/wwdc2023/10156/ — 2023-06-07 — accessed 2026-11-14 — primary
- [S7] Wind your way through advanced animations in SwiftUI (WWDC23 session 10157) — Apple — https://developer.apple.com/videos/play/wwdc2023/10157/ — 2023-06-06 — accessed 2026-11-14 — primary
- [S8] Enhance your UI animations and transitions (WWDC24 session 10145), transcript and code — Apple — https://developer.apple.com/videos/play/wwdc2024/10145/ — 2024-06-11 — accessed 2026-11-14 — primary
- [S9] Local SDK Swift interfaces: SwiftUICore.swiftinterface and SwiftUI.swiftinterface (arm64e-apple-ios) — Apple, iOS 26.5 SDK in Xcode 26.6 (17F113) — /Applications/Xcode.app/…/iPhoneOS.sdk/System/Library/Frameworks/{SwiftUICore,SwiftUI}.framework/Modules/ — SDK 26.5 (undated) — accessed 2026-11-14 — primary (verified in local SDK)
- [S10] Local SDK headers: UIKit UIView.h, UITimingParameters.h, UIAccessibility.h, UIKit.apinotes; QuartzCore CAAnimation.h; Symbols.swiftinterface — Apple, iOS 26.5 SDK — same SDK path — undated — accessed 2026-11-14 — primary (verified in local SDK)
- [S11] interpolatingSpring(duration:bounce:initialVelocity:) — Apple Developer Documentation — https://developer.apple.com/documentation/swiftui/animation/interpolatingspring(duration:bounce:initialvelocity:) — undated — accessed 2026-11-14 — primary
- [S12] Transaction.tracksVelocity — Apple Developer Documentation — https://developer.apple.com/documentation/swiftui/transaction/tracksvelocity — undated — accessed 2026-11-14 — primary
- [S13] spring(duration:bounce:blendDuration:) — Apple Developer Documentation — https://developer.apple.com/documentation/swiftui/animation/spring(duration:bounce:blendduration:) — undated — accessed 2026-11-14 — primary
- [S14] EnvironmentValues.accessibilityReduceMotion — Apple Developer Documentation — https://developer.apple.com/documentation/swiftui/environmentvalues/accessibilityreducemotion — undated — accessed 2026-11-14 — primary
- [S15] UIAccessibility.prefersCrossFadeTransitions — Apple Developer Documentation — https://developer.apple.com/documentation/uikit/uiaccessibility/preferscrossfadetransitions — undated — accessed 2026-11-14 — primary
- [S16] Human Interface Guidelines: SF Symbols (Animations) — Apple — https://developer.apple.com/design/human-interface-guidelines/sf-symbols — last changed 2025-07-28 — accessed 2026-11-14 — primary
- [S17] Animations (technology overview) — Apple Developer Documentation — https://developer.apple.com/documentation/technologyoverviews/animations — undated — accessed 2026-11-14 — primary
- [S18] Animation.easeInOut — Apple Developer Documentation — https://developer.apple.com/documentation/swiftui/animation/easeinout — undated — accessed 2026-11-14 — primary
- [S19] Analyze hangs with Instruments (WWDC23 session 10248), transcript — Apple — https://developer.apple.com/videos/play/wwdc2023/10248/ — 2023-06-08 — accessed 2026-11-14 — primary
- [S20] Eliminate animation hitches with XCTest (WWDC20 session 10077), transcript — Apple — https://developer.apple.com/videos/play/wwdc2020/10077/ — 2020-06-26 — accessed 2026-11-14 — primary
- [S21] Local SDK XCTest headers XCTMetric.h and XCTMetric+UIAutomation.h (`XCTHitchMetric` iOS 26, `XCTOSSignpostMetric`) — Apple, Xcode 26.6 — /Applications/Xcode.app/Contents/Developer/Platforms/iPhoneOS.platform/Developer/Library/Frameworks/XCTest.framework/Headers/ — undated — accessed 2026-11-14 — primary (verified in local SDK)
- [S22] Local tool output: `xcrun simctl help ui` (options: appearance, increase_contrast, content_size; no Reduce Motion) and `xcrun xctrace list templates` (includes "Animation Hitches", "SwiftUI") — Apple, Xcode 26.6 — local — undated — accessed 2026-11-14 — primary
- [S23] Apple Design Awards 2023 winners and finalists (Flighty, Interaction) — Apple — https://developer.apple.com/design/awards/2023/ — 2023 — accessed 2026-11-14 — primary
- [S24] Apple Design Awards 2024 winners and finalists (oko) — Apple — https://developer.apple.com/design/awards/2024/ — 2024 — accessed 2026-11-14 — primary
- [S25] Apple Design Awards 2025 winners and finalists (Denim) — Apple — https://developer.apple.com/design/awards/2025/ — 2025 — accessed 2026-11-14 — primary
- [S26] Apple Design Awards 2026 winners and finalists (Tide Guide) — Apple — https://developer.apple.com/design/awards/ — 2026 — accessed 2026-11-14 — primary
- [S27] What's new in SwiftUI (WWDC26 session 269), transcript — Apple — https://developer.apple.com/videos/play/wwdc2026/269/ — 2026-06-08 — accessed 2026-11-14 — primary
- [S28] SwiftUI updates — Apple Developer Documentation — https://developer.apple.com/documentation/updates/swiftui — June and September 2026 sections — accessed 2026-11-14 — primary
- [S29] NavigationTransition.crossFade (iOS 27.0) — Apple Developer Documentation — https://developer.apple.com/documentation/swiftui/navigationtransition/crossfade — 2026 (iOS 27) — accessed 2026-11-14 — primary
- [S30] Accessibility updates — Apple Developer Documentation — https://developer.apple.com/documentation/updates/accessibility — latest section June 2025 — accessed 2026-11-14 — primary
- [S31] Understanding SC 2.3.3 Animation from Interactions (WCAG 2.2) — W3C WAI — https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html — undated (WCAG 2.2 Rec. 2023-10-05) — accessed 2026-11-14 — secondary
- [S32] Understanding SC 2.2.2 Pause, Stop, Hide (WCAG 2.2) — W3C WAI — https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html — undated (WCAG 2.2 Rec. 2023-10-05) — accessed 2026-11-14 — secondary
- [S33] Understanding SC 2.3.1 Three Flashes or Below Threshold (WCAG 2.2) — W3C WAI — https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html — undated (WCAG 2.2 Rec. 2023-10-05) — accessed 2026-11-14 — secondary
- [S34] Executing UX Animations: Duration and Motion Characteristics — Nielsen Norman Group (Page Laubheimer) — https://www.nngroup.com/articles/animation-duration/ — 2020-02-09 — accessed 2026-11-14 — secondary
- [S35] Reducing Motion of Animations — Use Your Loaf (Keith Harrison) — https://useyourloaf.com/blog/reducing-motion-of-animations/ — 2025-01-20 — accessed 2026-11-14 — secondary
