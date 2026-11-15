# 05 Transitions
_Researched 2026-11-14. Toolchain: Xcode 26.6 / iOS 26.5 SDK. Current public iOS: iOS 27.2.1 (released 9 Nov 2026); iOS 27.0 shipped 14 Sep 2026, and iOS 26.7.3 is still offered to devices that stay on 26 [S1]. The iOS 27 SDK ships in Xcode 27, which needs macOS Tahoe 26.6+ [S1]; this Mac runs 26.2, so iOS 27-only transition APIs can't be built here._

## Questions answered
> "Transitions: navigation and modal transitions, continuity of elements between screens, state changes within a screen, and avoiding dropped frames." (KICKOFF_PROMPT.md §9, topic 5)

Companion: `03-motion-springs.md` defines the named springs (`press`, `state`, `settle`, `alertArrive`, `present`, `exit`) and fades (`fadeIn`, `fadeOut`, `crossFade`) that this file refers to.

## Summary
- **Don't restyle system transitions.** Push, sheet and full-screen presentations "have specific and well-defined meanings", and Apple says not to modify them [S8]. They also handle accessibility settings themselves; one report says zoom falls back to a standard push under Reduce Motion [S27]. Debbie should spend its custom-motion budget *inside* screens.
- **Modal choice follows the HIG:**
  - Sheets are for brief, occasional tasks. Show one at a time, show a grabber when the sheet resizes, allow swipe to dismiss, and use the medium detent for progressive disclosure [S6].
  - Full-screen modals suit camera views, video and multistep tasks [S6][S7]. That fits the QR pairing flow, the add-laptop scanner and the live view.
- **Continuity between screens: the zoom transition** (iOS 18). Add `navigationTransition(.zoom(sourceID:in:))` to the destination and `matchedTransitionSource(id:in:)` to the source; it works with NavigationStack, sheets and full-screen covers, and stays interactive [S2][S31][S3].
  - **Risk:** on iOS 26.0–26.1, an interactive (drag) dismissal can make the source view vanish and flicker. Apple DTS called it a known issue in Nov 2025 and no fix was posted [S26]. Adopt zoom only after it passes an on-device check on the demo phone's iOS version.
- **Continuity inside a screen depends on SwiftUI identity.**
  - Different `if`/`else` branches are different views, so they fade in and out. One view whose modifiers change (inert modifiers) moves and morphs instead [S11].
  - Identity must be stable: Debbie's `alert_id`, never indices or fresh UUIDs [S11].
  - `matchedGeometryEffect` (iOS 14) morphs one element between two places in the same transaction [S32].
- **Changes inside a view.** Use `contentTransition(.numericText(value:))` (iOS 17), `.interpolate` and `.symbolEffect(.replace)` [S3]. Choose symbol effects by their HIG meanings [S10].
- **Frame budget:** 8.3 ms per stage at 120 Hz and 16.7 ms at 60 Hz [S18][S14]. Hitches are commit hitches (app main thread) or render hitches (render server) [S18].
  - Lab target hitch ratio: < 5 ms/s good, 5–10 ms/s investigate, ≥ 10 ms/s critical [S17].
  - Xcode Organizer's Hitches metric, which since Xcode 27 covers all animations including transitions, uses ≤ 10 good, ≤ 25 warning, ≤ 50 critical [S18][S19].
  - Hangs: keep main-thread work per event under 100 ms; tools report above 250 ms [S20][S21].
- **SwiftUI performance pitfalls** that cause hitches during transitions:
  - formatters and other heavy work inside `body` [S13]
  - fast-changing values (geometry, timers) stored in the environment [S13]
  - broad dependencies instead of granular `@Observable` models [S13]
  - a variable number of views per `ForEach` element, or `AnyView`, in lists [S12]
  - offscreen render passes from shadows, masks, rounded rects and blur effects [S16]
- **What changed in iOS 27:** `NavigationTransition.crossFade` (for example a sheet that fades in) needs the iOS 27 SDK, so it is LATER [S4][S5]. The HIG Sheets page was updated on 24 Mar 2026 (button placement: pair Done with Cancel or Back) [S6].

## Findings

### 1. Navigation and modal transitions (system)
- **Leave the built-in animations alone.** Navigation in SwiftUI, and view controllers in UIKit, "use animations to show transitions between different parts of the interface… don't modify or change the built-in animations, which have specific and well-defined meanings." [S8]
- **Sheets (HIG)** [S6]:
  - Use them for complex or prolonged flows only with caution; for video, photos, camera views or multistep tasks, consider a full-screen modal instead.
  - Display only one sheet at a time, and close the first before showing another.
  - On iPhone, consider the medium detent for progressive disclosure, but not for content that's more useful at full height.
  - Include a grabber in a resizable sheet. It also works with VoiceOver.
  - Support swipe to dismiss, and confirm with an action sheet if there are unsaved changes.
  - If you provide a Done button, pair it with Cancel or Back. This item was added in the 24 Mar 2026 revision.
  - Keep sheet interactions brief and occasional, and don't use sheets for navigation.
- **Modality (HIG)** [S7]:
  - Present modally only when there's a clear benefit, and keep modal tasks short and simple.
  - Avoid an "app within your app"; if subviews are needed, give one path through them.
  - Use full screen for in-depth content (video, camera) or complex tasks.
  - Always give an obvious way to dismiss, confirm before losing data, and dismiss one modal before presenting another.
- **Presentation APIs** (verified in local SDK) [S3]:
  - `sheet(isPresented:)` and `sheet(item:)` (iOS 13), `fullScreenCover(isPresented:)` and `fullScreenCover(item:)` (iOS 14).
  - `presentationDetents(_:)` and `presentationDetents(_:selection:)` (iOS 16), `presentationDragIndicator(_:)` (iOS 16), `interactiveDismissDisabled(_:)` (iOS 15).
  - `presentationBackgroundInteraction(_:)`, `presentationCornerRadius(_:)` and `presentationContentInteraction(_:)` (iOS 16.4), `presentationSizing(_:)` (iOS 18).
  - SwiftUI disables the view behind a sheet unless you opt in with `presentationBackgroundInteraction(.enabled(upThrough:))` [S33].
- **Cross-fade presentation (iOS 27).** `NavigationTransition.crossFade` (iOS 27.0) makes a sheet "appear by fading in over the content, as opposed to moving upwards" [S4][S5]. It is **not in our SDK**: grep for `crossFade`/`CrossFade` finds 0 matches in the iOS 26.5 SwiftUI interfaces [S3].

### 2. Continuity between screens: the zoom transition
- **What it does.** In iOS 18 the tapped cell "morphs into the incoming view", and it is "continuously interactive" from the start or during the transition. Use it where you transition from a *large* cell, so the same UI stays on screen [S2].
- **Same APIs for sheets and covers.** It works with `fullScreenCover` and `sheet` in SwiftUI and UIKit [S2].
- **API** (verified in local SDK) [S3][S31]:
  - `View.navigationTransition(_:)` and `NavigationTransition.zoom(sourceID:in:)` (iOS 18) go on the destination.
  - `View.matchedTransitionSource(id:in:)`, plus a `configuration:` variant (iOS 18), goes on the source.
  - Placement: "within a NavigationStack or a sheet, outside of any containers such as VStack" [S31].
  - The WWDC24 sample spells it `navigationTransitionStyle`; the shipped name is `navigationTransition` [S2][S3].
- **UIKit semantics that matter even in SwiftUI apps** [S2]:
  - An interrupted push is never cancelled; it becomes a pop.
  - Be ready for a transition to start at any time, and don't branch on "in transition".
  - Keep temporary transition state minimal and reset it in `viewDidAppear`/`viewDidDisappear`.
  - The UIKit zoom closure should capture a stable identifier, not a view.
- **Reduce Motion.** One secondary report says zoom "automatically falls back to a standard navigation transition", and says this isn't documented [S27].
- **Known defect.** "SwiftUI navigationTransition Regression on iOS 26" [S26]:
  - On iOS 26.0, 26.0.1 and 26.1, simulator and iPhone 16, after an interactive drag-dismiss the source card disappears and the outgoing view flickers with misaligned geometry. Back-button dismissal is fine.
  - iOS 18.5 was not affected.
  - An Apple DTS engineer replied that it is a known issue under investigation (Nov 2025). The thread names no fixed release.

### 3. Continuity and state inside a screen
- **Identity decides the animation** [S11]:
  - The branches of an `if` are different views with distinct identity, so they "transition in and out".
  - A single view that changes layout and colour moves smoothly.
  - Prefer inert modifiers (for example `opacity(1)`) to branches so that identity is preserved. Branches "are great" when the content is genuinely different.
  - Use stable identifiers (database IDs), not indices or random IDs, or insertions animate in the wrong place.
- **`matchedGeometryEffect(id:in:properties:anchor:isSource:)`** (iOS 14; verified in local SDK) [S3]: when one view is inserted while another with the same id is removed in the same transaction, the frames interpolate so it looks like a single view moving. Exactly one source per group is required [S32].
- **Transitions for insertion and removal** (verified in local SDK) [S3]:
  - `.transition(_: AnyTransition)` (iOS 13) and `.transition(_: some Transition)` (iOS 17).
  - `.opacity`, `.move(edge:)`, `.scale`, `.push(from:)` (iOS 16; as a `Transition` in iOS 17), `.blurReplace` (iOS 17).
- **Content transitions** (verified in local SDK) [S3]:
  - `contentTransition(_:)` (iOS 16), `.interpolate` and `.numericText(countsDown:)` (iOS 16), `.numericText(value:)` (iOS 17, "intended to be used with Text views displaying numbers" [S36]).
  - `.symbolEffect(_:options:)` as a content transition, for example `.replace` (iOS 17).
- **Symbol effects by meaning** [S10]:
  - Replace down-up = a change of state; up-up = forward progression.
  - Bounce = an action occurred or is needed.
  - Breathe = an ongoing activity such as a recording.
  - Wiggle = a call to action that might be overlooked.
  - Rotate = in progress.
  - Use them "judiciously".
- **Scroll transitions.** `scrollTransition(_:axis:transition:)` (iOS 17) animates views as they enter or leave the visible region [S37]. Reasoning: this is automatic, repeated motion during a frequent interaction (scrolling). The HIG advises against motion on frequent interactions and asks for automatic motion to be reduced under Reduce Motion [S29][S9]. Debbie doesn't adopt it.
- **Liquid Glass morphing** (iOS 26). `GlassEffectContainer`, `glassEffectID(_:in:)` and `glassEffectTransition(_:)` exist (verified in local SDK) [S3]. Use them only if topic 02 adopts Liquid Glass for custom controls.

### 4. No jumps, no flashes (sources and reasoning)
- **Identity.** Unstable identity causes surprise fades and wrong-place insertions [S11]. Debbie's alert lists use `alert_id`.
- **Placeholders.** `redacted(reason:)` (iOS 14; verified in local SDK [S3]) renders a placeholder from the *real* view, so loading and loaded layouts match. Reasoning: with the same geometry, the swap from loading to content is a pure opacity change with no layout jump.
- **First render.** Reasoning: data restored from the local store before the first frame shouldn't animate. Animation should only report *new* changes. Use `Transaction.disablesAnimations` (iOS 13; verified in local SDK) [S3].
- **Flashes between colours.** Reasoning: a window, sheet or cover whose background isn't set explicitly to the theme token shows the default system background for a frame during presentation. The same happens when a launch screen's colour differs from the first screen's.

### 5. Dropped frames: render loop, budgets, thresholds
- **The render loop** [S14][S18]:
  - Event → commit (app main thread) → render prepare (CPU) → render execute (GPU) → display.
  - Double buffering is the norm. The system can fall back to triple buffering, which gives the render server an extra frame [S14].
  - "A display updating at a 120 Hz refresh rate updates… every 8.3 ms… each stage then has up to 8.3 ms"; at 60 Hz the figure is 16.7 ms [S18].
  - Input-to-photon delay in double buffering is 50 ms at 60 Hz and 25 ms at 120 Hz [S18].
- **Hitch types** [S18]:
  - *Commit hitch*: the app misses the commit deadline.
  - *Render hitch*: the render server misses presentation time.
  - "Even a few milliseconds of delay can cause the main thread work to miss the commit deadline," whereas discrete hangs become noticeable around 100 ms.
- **Hitch-ratio thresholds.**
  - Lab (WWDC20, used by Apple's tools at that time): < 5 ms/s is a good experience; 5–10 ms/s "users will start to notice"; ≥ 10 ms/s "quite distracting… take immediate action" [S17].
  - Field (current documentation for the Xcode Organizer Hitches metric): "≤ 10 ms/s is good; ≤ 25 ms/s is a warning; ≤ 50 ms/s is critical; > 50 ms/s warrants immediate attention" [S18].
  - The June 2026 Xcode update widened the Organizer metric to "all animated interactions — including scrolling, transitions, and other continuous motion" [S19][S30].
- **Hangs.** "A delay of less than 100 ms in a discrete user interaction is rarely noticeable"; most tools report when the main run loop is unresponsive for more than 250 ms [S20]. Apple's one rule: main-thread work "should be done in less than 100 milliseconds" [S21].
- **Commit-phase costs** [S15]:
  - layout (`layoutSubviews`) and drawing (`drawRect`)
  - image decoding during the prepare step
  - expensive work in cell updates (the example spent about 10 ms in one method)
- **Render-phase costs** [S16]:
  - Offscreen passes for **shadows, masks, rounded rectangles and visual effects (blur)**.
  - Fixes: set `shadowPath` or pre-render shadows; replace shape-layer masks with `cornerRadius` plus `masksToBounds`.
- **SwiftUI.**
  - Slow updates cause both hangs and hitches. Lists need a constant number of views per element, so a filter `if` inside `ForEach` or `AnyView` forces every row to be built. `Self._printChanges()` explains why a body re-ran [S12].
  - Instruments 26's SwiftUI instrument has lanes for Update Groups, Long View Body Updates, Long Representable Updates and Other Long Updates. Updates are coloured orange or red by how likely they are to cause a hitch [S13].
  - Common fixes: move formatters and computation out of `body` and cache them in the model; use granular `@Observable` models; don't store fast-changing values such as geometry or timers in the environment [S13].
- **ProMotion** [S22][S23]:
  - The ProMotion iPhones are iPhone 13 Pro and later Pro models, iPhone 17 and later, and iPhone Air.
  - SwiftUI, UIKit and `CAAnimation` frame pacing is automatic.
  - `CADisableMinimumFrameDurationOnPhone = YES` is needed only to unlock frame-rate hints above 60 Hz for `CADisplayLink` or `CAAnimation`. The iPad Pro doesn't need it.
- **Measurement** (verified in local SDK and tools) [S24][S25][S17]:
  - `XCTHitchMetric(application:)` (iOS 26).
  - `XCTOSSignpostMetric.navigationTransitionMetric`, `.customNavigationTransitionMetric` and `.scrollingAndDecelerationMetric` report fps, hitch count, hitch time and hitch time ratio.
  - `xcrun xctrace record --template 'Animation Hitches' | 'SwiftUI' --device <UDID> --launch -- <app>`.
  - Apple's settings for performance tests: Release configuration, no debugger, no screenshots, no code coverage, no diagnostics, and reset state between iterations [S17].
  - Note: the brief cites "WWDC20 'Explore UI animation hitches and the render loop' (10077)". Session 10077 is *Eliminate animation hitches with XCTest*; the render-loop talk is Tech Talk 10855 [S17][S14].

### 6. Reduce Motion for transitions
- **HIG list** [S9]:
  - Replace x/y/z transitions with fades.
  - Avoid animating depth (zoom or scale) and blurs.
  - Reduce automatic and repeating animation.
  - Keep spring tracking but tighten bounce.
- **Signals to read** [S34][S35]:
  - SwiftUI `accessibilityReduceMotion` (get-only).
  - UIKit `UIAccessibility.prefersCrossFadeTransitions`, for the separate *Prefer Cross-Fade Transitions* switch, with the `UIAccessibility.prefersCrossFadeTransitionsStatusDidChange` notification.
  - Neither SwiftUI interface has an environment value for cross-fade [S3].
- **`.blurReplace`** animates a blur, so under Reduce Motion it must become `.opacity` [S9][S3].

## What changed in the current iOS release
- **iOS 27 (14 Sep 2026; now 27.2.1)** [S1]:
  - **New in iOS 27 SDK:** `NavigationTransition.crossFade` and `CrossFadeNavigationTransition` (iOS 27.0), for example a sheet that fades in instead of rising [S4][S5]. Absent from our iOS 26.5 SDK [S3]. **Needs a newer SDK** (Xcode 27, macOS 26.6+) → LATER.
  - **Xcode 27 Organizer Hitches** now covers scrolling, transitions and all continuous motion, with the thresholds above [S19][S18][S30]. It needs Xcode 27 and field data from a shipped app → LATER.
  - **Xcode 27 SwiftUI performance changes:** `@State` as a macro (classes initialised once) and the unified `ContentBuilder` for faster type-checking [S28][S5]. These need Xcode 27.
  - **The refreshed Liquid Glass look** applies automatically to apps built with Xcode 27 [S28]. Our iOS 26.5-SDK build may present system transitions differently on an iOS 27 phone; unverified.
- **During the iOS 26.x cycle** (not tied to the SDK):
  - HIG Sheets revised 24 Mar 2026 (Done paired with Cancel or Back) [S6].
  - Zoom-transition regression reported on iOS 26.0–26.1 [S26].
  - `XCTHitchMetric` and the Instruments SwiftUI instrument arrived with Xcode 26 and iOS 26 and are available to us [S24][S13].

## Recommendations for Debbie

**R1. Use this transitions catalogue.** Every change of screen or state uses exactly one row. — ADOPT-TONIGHT: makes "fluid, no jumps" checkable per screen. Sources per row; springs and fades are from 03.

| ID | Change | Transition | Timing | Reduce Motion / Prefer Cross-Fade | API (iOS) |
|---|---|---|---|---|---|
| T1 push | Drill-in within a stack: Home → Alert detail, Home → History, Settings → sub-page | System `NavigationStack` push, unmodified [S8] | System | System handles it | NavigationStack (16) |
| T2 zoom | Large card → its own detail when the card's content stays visible: Home "current alert" card → Alert detail; live-view tile → live view | `.navigationTransition(.zoom(sourceID: alertID, in: ns))` + `.matchedTransitionSource(id:in:)` [S2][S3] | System | Only after R5's device check; otherwise T1 | 18 |
| T3 sheet | Short, focused task that returns to the same place: "Was this a false alarm?" acknowledge choice, approve a new laptop's name, edit this phone's name | `.sheet` + `.presentationDetents([.medium])`, or `[.medium, .large]` when content grows, with `.presentationDragIndicator(.visible)` [S6][S3] | System | System | 16 |
| T4 cover | Immersive or multistep: pairing (scan → name/role → code → done), add-laptop scanner, live view | `.fullScreenCover` [S6][S7] | System | System | 14 |
| T5 root | App-level state change with no "back": unpaired ↔ paired, caregiver ↔ resident mode, "this phone was removed from the home" | Root content swap with `.transition(.opacity)` | `crossFade` (0.30 s) | Same | 13 |
| T6 step | Forward or back step inside a linear flow (pairing steps inside T4) | `.transition(.push(from: .trailing))` forward, `.leading` back | `state` | `.opacity` with `crossFade` [S9] | 16 / 17 |
| T7 arrive | A live alert arrives while its list is visible | `.transition(.move(edge: .top).combined(with: .opacity))`; siblings reflow in the same transaction | `alertArrive` | `.opacity` with `fadeIn`; reflow without animation [S9] | 13 |
| T8 leave | Acknowledged alert leaves "Active" for "History" | `.transition(.opacity)`; remaining rows reflow | `exit` / `state` | `fadeOut`; reflow without animation | 13 |
| T9 status | Status header state (healthy, monitoring unknown, degraded, can't reach home, removed) | Header container keeps its identity [S11]; icon uses `.contentTransition(.symbolEffect(.replace.downUp))` [S10]; label `.contentTransition(.opacity)`; colour animates | `state` | Opacity only; symbol effects removed | 17 |
| T10 value | Heart-rate value, counts | `.contentTransition(.numericText(value:))` [S36] | `state` | `.opacity` | 17 |
| T11 tick | Live-view 5-minute countdown (changes every second) | No transition (`.identity`), `.monospacedDigit()` | None | None | 16 |
| T12 load | Loading → content, empty ↔ content, error ↔ content | Same layout; placeholder from `redacted(reason: .placeholder)`; swap by `.opacity` | `fadeIn` / `fadeOut` | Same | 14 |
| T13 select | Selection highlight moving between options (custom role picker: Caregiver / Resident) | `matchedGeometryEffect` on the highlight [S32] | `state` | Highlight cross-fades in place (no slide) [S9] | 14 |
| T14 live | Live-view states: requesting → waiting for resident → connecting → live → ended (with reason) | Panels swap by `.opacity` (a state, not a place); video layer appears with `fadeIn` on the first decoded frame | `crossFade` / `fadeIn` | Same | 13 |
| T15 live cue | "Camera is live" indicator | Appears with the first frame; `live` symbol effect (03-R12) while live; **removed without animation** when the session ends | `fadeIn` in, none out | Static icon + text | 17 / 18 |

- Reasoning for T5: those changes aren't places in a hierarchy, and a push would imply a back route that doesn't exist.
- Reasoning for T11: a per-second roll is frequent, automatic motion [S29][S9].
- Reasoning for T15: a privacy cue must never linger after the camera stops or appear before it starts; accuracy beats polish.

**R2. Leave system transitions unmodified.** — ADOPT-TONIGHT: they carry platform meaning and adapt to accessibility settings [S8][S27].
- No custom push or pop animations, no `UIViewControllerAnimatedTransitioning`, no `.animation` modifiers applied to a `NavigationStack` path.
- Check: `grep -rn "UIViewControllerAnimatedTransitioning\|UIViewControllerTransitioningDelegate" Sources` is empty.

**R3. Sheet rules.** — ADOPT-TONIGHT: all are HIG requirements [S6][S7].
- (a) Only one sheet at a time. The app has one `@State var activeSheet: Sheet?` enum per scene. Reasoning: a single optional makes stacking impossible by construction.
- (b) Any sheet with more than one detent shows `.presentationDragIndicator(.visible)`.
- (c) Swipe-to-dismiss stays enabled. `interactiveDismissDisabled(true)` is allowed only while an encrypted request is in flight (approve laptop, send acknowledgement); after that, confirm with `confirmationDialog`.
- (d) A Done button is always paired with Cancel or Back.
- (e) No navigation hierarchy inside a sheet.

**R4. Full-screen covers for pairing, the add-laptop scanner and live view.** — ADOPT-TONIGHT: HIG names camera views and multistep tasks [S6][S7].
- Each cover has a visible Close or Stop control in the top bar [S7].
- Live view's Stop calls the relay *before* teardown (brief §5.1).

**R5. Zoom only after a device check.** — LATER: a known iOS 26 regression risks exactly the flicker the brief forbids [S26].
- Adopt T2 only behind `if #available(iOS 18, *)`.
- Only after a scripted check on the demo phone's iOS version: push, back-swipe halfway and cancel, back-swipe fully, then tap the source again. Record the screen and inspect it frame by frame for a missing source or flicker.
- Also verify with Reduce Motion on that it becomes a standard push [S27]. If it doesn't, apply the zoom modifier only when `MotionPolicy.reduce == false`.
- Until then, T1 provides the navigation.

**R6. Identity rules.** — ADOPT-TONIGHT: identity is what makes SwiftUI animate as a move rather than a fade-swap [S11].
- (a) `ForEach` and `List` use `alert_id` (or another persisted id); never `\.self` on mutable values, indices or `UUID()` created in `body`.
- (b) The same element in different states is one view with changing modifiers, such as the status header, the acknowledge button and the alert card's urgency styling. An `if`/`else` is used only for genuinely different content, and it carries an explicit `.transition` from R1.
- (c) No `.id(…)` used to force refreshes.
- Check: `grep -rnE "id: *\\\\\.self|UUID\(\)" Sources/**/Views` is reviewed per hit.

**R7. Deep links from a notification.** — ADOPT-TONIGHT: the caregiver must see the alert immediately [S2].
- On a cold start from a push, build the `NavigationPath` to the alert detail *before* the first frame, inside a transaction with `disablesAnimations = true` [S3], so no push animation plays.
- On a warm start, use the normal T1 push.
- Any in-flight transition must not block it: "Be ready for a new transition to start at any time" [S2].

**R8. Rules against flashes.** — ADOPT-TONIGHT: "no jumps/flashes" is a brief requirement.
- (a) Each loading state is the real view with `redacted(reason: .placeholder)` and the same frame sizes [S3].
- (b) First render and restored data apply without animation (03-R8) [S3].
- (c) Every root, sheet and cover sets its background from the theme token, edge to edge, so dark mode never flashes white. Reasoning.
- (d) The launch screen background equals Home's background token. Reasoning.
- (e) UI artwork is bundled vector assets, never loaded asynchronously. Reasoning.
- Check: snapshot tests of loading vs loaded states have the same header and section frames, measured by comparing the bounding boxes of accessibility elements.

**R9. Reduce Motion and Prefer Cross-Fade for transitions.** Use the Reduce Motion column of R1, driven by 03-R10's `MotionPolicy`, which reads `accessibilityReduceMotion` and `UIAccessibility.prefersCrossFadeTransitions` [S34][S35]. — ADOPT-TONIGHT: accessibility is a hard requirement.
- Mapping [S9]:
  - `.move`, `.push`, `.scale` and `.blurReplace` → `.opacity` with `crossFade`.
  - Layout reflow → no animation.
  - Symbol effects → removed (`symbolEffectsRemoved`).
  - Zoom → per R5.
- Check: the unit test `MotionPolicyTests.transitionMapping` covers every R1 row for both policy values.

**R10. Performance gate per animated flow.** — ADOPT-TONIGHT: the brief requires performance budgets measured unattended [S17][S18][S20][S21].
- **Hitches (lab):** < 5 ms/s, measured with `XCTHitchMetric(application:)` in UI tests that drive each R1 transition five times. Use a Release-configured performance scheme without debugger or coverage [S17][S24].
- **Hangs:** no main-thread interval ≥ 100 ms during any R1 transition. Instruments flags ≥ 250 ms; 100 ms is our stricter line [S20][S21].
- Run on a physical device, ideally the oldest available, because the target families are likely to own older phones (brief §7). Reasoning: simulator timing isn't representative. If no device is attached, the gate is recorded as "not measured", never "passed".

**R11. SwiftUI update-cost rules.** — ADOPT-TONIGHT: these are the causes of transition hitches Apple names [S12][S13].
- (a) No `DateFormatter`, `MeasurementFormatter`, decoding, decryption or sorting inside `body`. Alert times are formatted once when stored, and decryption happens off the main actor.
- (b) Models are `@Observable` with per-item granularity. A row reads only its own alert.
- (c) No timers or geometry in the environment. The live-view countdown lives in a `TimelineView(.periodic(from: sessionStart, by: 1))` scoped to the countdown label.
- (d) Lists produce exactly one row view per element: no `if` filters inside `ForEach` and no `AnyView`.
- Check: Instruments' SwiftUI template shows no red "Long View Body Updates" during the R10 runs [S13].

**R12. Render-cost rules.** — ADOPT-TONIGHT: offscreen passes cause render hitches [S16].
- No shadow, mask or blur material on a view that moves or resizes during a transition.
- Card shadows, if topic 06/09 keeps any, sit on a static simple shape and their radius is never animated.
- No animated blur radius anywhere; this is also a Reduce Motion rule [S9].
- Live-view overlays (the live cue, timer and Stop button) use solid colour tokens, not materials, because a material over moving video adds a visual-effect pass on every frame. Reasoning from [S16].

**R13. Measurement scripts.** — ADOPT-TONIGHT for the scripts; device runs as available: evidence must be reproducible.
- `scripts/perf-hitches.sh` runs `xcodebuild test -scheme DebbiePerf -configuration Release -destination 'id=<UDID>'`, collecting `XCTHitchMetric` results from the `.xcresult` [S24].
- `scripts/trace.sh` runs `xcrun xctrace record --template 'Animation Hitches' --device <UDID> --time-limit 30s --launch -- <app path>`, then the same with `--template 'SwiftUI'`, saving `.trace` files under `build/traces/` [S25].

**R14. ProMotion.** — LATER: Debbie needs it only if it adds a display link [S22][S23].
- Don't add `CADisableMinimumFrameDurationOnPhone`: SwiftUI and UIKit animations are paced automatically.
- Add it, set to `YES`, only if a `CADisplayLink` or `CAAnimation` frame-rate hint above 60 Hz is introduced.

**R15. No scroll-driven decorative motion.** — ADOPT-TONIGHT: calm and simple; frequent automatic motion is discouraged [S29][S9].
- No `scrollTransition`, `visualEffect` parallax or scroll-linked scaling [S37].
- Check: `grep -rnE "scrollTransition|visualEffect" Sources` is empty.

**R16. Cross-fade presentation (iOS 27).** — LATER: needs the iOS 27 SDK, Xcode 27 and macOS 26.6+ [S1].
- When Xcode 27 is available, use `.navigationTransition(.crossFade)` as the Reduce Motion presentation for T3 sheets [S4][S5].
- Read the Organizer Hitches metric for shipped builds against the ≤ 10 ms/s "good" line [S18][S19].

## Open questions / risks
- **Zoom regression status.** Is the iOS 26.0–26.1 zoom regression fixed in 26.2+ or 27.x? The forum thread names no fix [S26]. R5's device check decides.
- **Undocumented Reduce Motion fallback.** The zoom fallback under Reduce Motion is undocumented [S27]. Verify on device.
- **SDK mismatch on iOS 27 phones.** On a phone running iOS 27, an app built with the iOS 26.5 SDK may show system sheets and pushes in the older style, or differently from iOS 27-native apps [S28]. Record the demo flows on the actual demo device before judging "fluid".
- **No physical device.** Without one attached, R10 can't produce real hitch numbers; simulator runs only prove the tests execute. Record this as a blocker rather than a pass.
- **Two sets of thresholds.** The WWDC20 lab thresholds (5/10 ms/s) and the current Organizer thresholds (10/25/50 ms/s) differ [S17][S18]. This file uses the stricter lab line for the gate; confirm in `CRAFT.md`.
- **No-animation pushes.** `disablesAnimations` for deep links (R7) is a widely used technique, but Apple doesn't document its effect on `NavigationStack` pushes. Verify that it produces no visible push on cold start.

## Sources
- [S1] Apple security releases — Apple Support — https://support.apple.com/en-us/100100 — living page; rows read: iOS 27 (14 Sep 2026), iOS 27.2.1 and iOS 26.7.3 (09 Nov 2026), Xcode 27 (14 Sep 2026, "macOS Tahoe 26.6 and later") — accessed 2026-11-14 — primary
- [S2] Enhance your UI animations and transitions (WWDC24 session 10145), transcript and code — Apple — https://developer.apple.com/videos/play/wwdc2024/10145/ — 2024-06-11 — accessed 2026-11-14 — primary
- [S3] Local SDK Swift interfaces: SwiftUI.swiftinterface and SwiftUICore.swiftinterface (arm64e-apple-ios), Symbols.swiftinterface — Apple, iOS 26.5 SDK in Xcode 26.6 (17F113) — /Applications/Xcode.app/…/iPhoneOS.sdk/System/Library/Frameworks/ — undated — accessed 2026-11-14 — primary (verified in local SDK)
- [S4] NavigationTransition and NavigationTransition.crossFade (iOS 27.0) — Apple Developer Documentation — https://developer.apple.com/documentation/swiftui/navigationtransition and https://developer.apple.com/documentation/swiftui/navigationtransition/crossfade — 2026 (iOS 27) — accessed 2026-11-14 — primary
- [S5] SwiftUI updates — Apple Developer Documentation — https://developer.apple.com/documentation/updates/swiftui — June 2026 section ("Transitions: crossFade") — accessed 2026-11-14 — primary
- [S6] Human Interface Guidelines: Sheets — Apple — https://developer.apple.com/design/human-interface-guidelines/sheets — last changed 2026-03-24 — accessed 2026-11-14 — primary
- [S7] Human Interface Guidelines: Modality — Apple — https://developer.apple.com/design/human-interface-guidelines/modality — last changed 2023-12-05 — accessed 2026-11-14 — primary
- [S8] Animations (technology overview) — Apple Developer Documentation — https://developer.apple.com/documentation/technologyoverviews/animations — undated — accessed 2026-11-14 — primary
- [S9] Human Interface Guidelines: Accessibility (motion section) — Apple — https://developer.apple.com/design/human-interface-guidelines/accessibility — last changed 2025-06-09 — accessed 2026-11-14 — primary
- [S10] Human Interface Guidelines: SF Symbols (Animations) — Apple — https://developer.apple.com/design/human-interface-guidelines/sf-symbols — last changed 2025-07-28 — accessed 2026-11-14 — primary
- [S11] Demystify SwiftUI (WWDC21 session 10022), transcript — Apple — https://developer.apple.com/videos/play/wwdc2021/10022/ — 2021-06-09 — accessed 2026-11-14 — primary
- [S12] Demystify SwiftUI performance (WWDC23 session 10160), transcript — Apple — https://developer.apple.com/videos/play/wwdc2023/10160/ — 2023-06-08 — accessed 2026-11-14 — primary
- [S13] Optimize SwiftUI performance with Instruments (WWDC25 session 306), transcript — Apple — https://developer.apple.com/videos/play/wwdc2025/306/ — 2025-06-09 — accessed 2026-11-14 — primary
- [S14] Explore UI animation hitches and the render loop (Tech Talk 10855), transcript — Apple — https://developer.apple.com/videos/play/tech-talks/10855/ — 2020-12-21 — accessed 2026-11-14 — primary
- [S15] Find and fix hitches in the commit phase (Tech Talk 10856), transcript — Apple — https://developer.apple.com/videos/play/tech-talks/10856/ — 2020-12-21 — accessed 2026-11-14 — primary
- [S16] Demystify and eliminate hitches in the render phase (Tech Talk 10857), transcript — Apple — https://developer.apple.com/videos/play/tech-talks/10857/ — 2020-12-21 — accessed 2026-11-14 — primary
- [S17] Eliminate animation hitches with XCTest (WWDC20 session 10077), transcript — Apple — https://developer.apple.com/videos/play/wwdc2020/10077/ — 2020-06-26 — accessed 2026-11-14 — primary
- [S18] Understanding hitches in your app — Apple Developer Documentation — https://developer.apple.com/documentation/xcode/understanding-hitches-in-your-app — undated (Organizer thresholds as of 2026) — accessed 2026-11-14 — primary
- [S19] Xcode updates — Apple Developer Documentation — https://developer.apple.com/documentation/updates/xcode — June 2026 section (Organizer: Hitches metric across all animated interactions) — accessed 2026-11-14 — primary
- [S20] Understanding hangs in your app — Apple Developer Documentation — https://developer.apple.com/documentation/xcode/understanding-hangs-in-your-app — undated — accessed 2026-11-14 — primary
- [S21] Analyze hangs with Instruments (WWDC23 session 10248), transcript — Apple — https://developer.apple.com/videos/play/wwdc2023/10248/ — 2023-06-08 — accessed 2026-11-14 — primary
- [S22] Optimizing iPhone and iPad apps to support ProMotion displays — Apple Developer Documentation — https://developer.apple.com/documentation/quartzcore/optimizing-iphone-and-ipad-apps-to-support-promotion-displays — undated — accessed 2026-11-14 — primary
- [S23] CADisableMinimumFrameDurationOnPhone — Apple Developer Documentation — https://developer.apple.com/documentation/bundleresources/information-property-list/cadisableminimumframedurationonphone — undated — accessed 2026-11-14 — primary
- [S24] Local SDK XCTest headers XCTMetric.h, XCTMetric+UIAutomation.h (`XCTHitchMetric` iOS 26; `XCTOSSignpostMetric` built-ins) — Apple, Xcode 26.6 — /Applications/Xcode.app/Contents/Developer/Platforms/iPhoneOS.platform/Developer/Library/Frameworks/XCTest.framework/Headers/ — undated — accessed 2026-11-14 — primary (verified in local SDK)
- [S25] Local tool output: `xcrun xctrace list templates` ("Animation Hitches", "SwiftUI") and `xcrun xctrace help record` — Apple, Xcode 26.6 — local — undated — accessed 2026-11-14 — primary
- [S26] "SwiftUI navigationTransition Regression on iOS 26 (Source View Disappears + Flicker/Misaligned Geometry)", with an Apple DTS reply — Apple Developer Forums — https://developer.apple.com/forums/thread/807208 — 2025-11 — accessed 2026-11-14 — secondary
- [S27] Reducing Motion of Animations — Use Your Loaf (Keith Harrison) — https://useyourloaf.com/blog/reducing-motion-of-animations/ — 2025-01-20 — accessed 2026-11-14 — secondary
- [S28] What's new in SwiftUI (WWDC26 session 269), transcript — Apple — https://developer.apple.com/videos/play/wwdc2026/269/ — 2026-06-08 — accessed 2026-11-14 — primary
- [S29] Human Interface Guidelines: Motion — Apple — https://developer.apple.com/design/human-interface-guidelines/motion — last changed 2025-09-09 — accessed 2026-11-14 — primary
- [S30] Analyzing responsiveness issues in your shipping app — Apple Developer Documentation — https://developer.apple.com/documentation/xcode/analyzing-responsiveness-issues-in-your-shipping-app — undated — accessed 2026-11-14 — primary
- [S31] navigationTransition(_:) — Apple Developer Documentation — https://developer.apple.com/documentation/swiftui/view/navigationtransition(_:) — undated (iOS 18) — accessed 2026-11-14 — primary
- [S32] matchedGeometryEffect(id:in:properties:anchor:isSource:) — Apple Developer Documentation — https://developer.apple.com/documentation/swiftui/view/matchedgeometryeffect(id:in:properties:anchor:issource:) — undated (iOS 14) — accessed 2026-11-14 — primary
- [S33] presentationBackgroundInteraction(_:) — Apple Developer Documentation — https://developer.apple.com/documentation/swiftui/view/presentationbackgroundinteraction(_:) — undated (iOS 16.4) — accessed 2026-11-14 — primary
- [S34] Local SDK UIKit headers UIAccessibility.h and UIKit.apinotes (`UIAccessibility.prefersCrossFadeTransitions`, `prefersCrossFadeTransitionsStatusDidChange`, `isReduceMotionEnabled`) — Apple, iOS 26.5 SDK — /Applications/Xcode.app/…/iPhoneOS.sdk/System/Library/Frameworks/UIKit.framework/Headers/ — undated — accessed 2026-11-14 — primary (verified in local SDK)
- [S35] UIAccessibility.prefersCrossFadeTransitions — Apple Developer Documentation — https://developer.apple.com/documentation/uikit/uiaccessibility/preferscrossfadetransitions — undated (iOS 14) — accessed 2026-11-14 — primary
- [S36] ContentTransition.numericText(value:) — Apple Developer Documentation — https://developer.apple.com/documentation/swiftui/contenttransition/numerictext(value:) — undated (iOS 17) — accessed 2026-11-14 — primary
- [S37] scrollTransition(_:axis:transition:) — Apple Developer Documentation — https://developer.apple.com/documentation/swiftui/view/scrolltransition(_:axis:transition:) — undated (iOS 17) — accessed 2026-11-14 — primary
