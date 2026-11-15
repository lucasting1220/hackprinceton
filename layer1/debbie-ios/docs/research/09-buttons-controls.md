# 09 Buttons and controls
_Researched 2026-11-14. Toolchain: Xcode 26.6 / iOS 26.5 SDK. Current public iOS: iOS 27.2.1 (released 9 Nov 2026). iOS 27.0 shipped 14 Sep 2026, and iOS 26.7.3 (9 Nov 2026) is still maintained for people who stay on 26 [S1]._

## Questions answered
> "Custom buttons and controls: replacements for every system control the app uses, with their states, feedback and accessibility, built as reusable styles." (KICKOFF_PROMPT.md §9, topic 9)

Assignment title: "Custom buttons and controls: states, feedback and accessibility, and building them as reusable styles." It also asked for:
- HIG Buttons, Toggles, Segmented controls, Text fields and Progress indicators.
- In SwiftUI: `ButtonStyle` vs `PrimitiveButtonStyle`, `isPressed` and `role`, `isEnabled`, focus, `contentShape`, 44×44 pt, `controlSize`, `buttonBorderShape`, the iOS 26 glass styles, `ToggleStyle`, `ProgressView` styles and `LabelStyle`.
- The states default, pressed, disabled, loading, focused and error.
- Accessibility: traits, labels, values, hints, `accessibilityAction`, `accessibilityRepresentation`, Button Shapes, the large content viewer, Full Keyboard Access and Switch Control.
- Hold-to-confirm for serious actions and its accessible alternatives.
- Debbie's component list.
- Added after review (B3): the other controls brief §3 names, which the first draft missed. These are navigation bars, back buttons and sheet headers, plus pull to refresh and the row chevron.

## Summary
- **Current iOS.** iOS 27 is current. The HIG pages for Buttons, Toggles, Segmented controls, Text fields and Progress indicators have no iOS 27-era changes. The last was Buttons, on 16 Dec 2025, for Liquid Glass [S2][S33]. One page that governs how Debbie colours its controls did change. HIG Branding (9 Sep 2026) now says to "minimize [the accent colour's] use on controls and instead use it intentionally for primary actions or status indicators" [S40]. R1 applies it: only `.primary` buttons and state indicators carry mint.
- **iOS 27 changes that matter here.** Settings now has a Liquid Glass tint slider [S29]. The iOS 27 SDK soft-deprecates the `.roundedBorder` and `.squareBorder` text field styles in favour of `.bordered` and `textInputBorderShape(_:)`. It also adds `TabsPickerStyle`, and resets `controlSize`, `buttonSizing` and three other control environment values inside sheets and popovers [S38]. These need Xcode 27, which needs macOS 26.6 or later [S1][S31]. Nothing below needs them, and R2, R3 and R9 are written so that moving to the 27 SDK changes nothing. HIG Sheets' button-placement change (24 Mar 2026) came with iOS 26.4, not iOS 27 [S1][S10].
- **Build every tap button on `ButtonStyle`, not `PrimitiveButtonStyle`.** `ButtonStyle` keeps "the standard button interaction behavior" and supplies `isPressed` and `role`. `PrimitiveButtonStyle` is for "custom interaction behavior" [S12]. Use it only for a later hold-to-confirm.
- **Custom styles keep the control's accessibility only if you keep its parts.**
  - A custom `ToggleStyle` "inherits the accessibility features of Toggle automatically" [S14].
  - A `ButtonStyle` that discards `configuration.label` makes VoiceOver read the icon's name instead of the label [S22].
  - Where a control can't be built from a system control, use `accessibilityRepresentation` [S14][S22].
- **Hit regions.** At least 44×44 pt everywhere [S2][S7]. Visible heights follow lead decision X21, which adopts note 07's older-adult evidence. They are 44 and 48 pt for inline controls, 56 pt for screen primary actions, 64 pt for alert response actions and live-view Stop, and 96 pt for resident controls (R3).
- **New accessibility settings in the iOS 26.x SDK** (verified in local SDK) [S34]:
  - Button Shapes is now **Show Borders**, the name in the SDK documentation [S15]. MacRumors calls the toggle "Display Borders" [S36]. `UIAccessibility.buttonShapesEnabled` is deprecated from iOS 26.1, and using it would break the zero-warnings rule. Use SwiftUI `accessibilityShowBorders` (back-deployed to iOS 14) [S15].
  - iOS 26.4 adds `accessibilityReduceHighlightingEffects`, for "Reduce Bright Effects".
  - iOS 26.1 adds `AccessibilitySettings.prefersActionSliderAlternative`, a preference for alternatives to "prolonged, continuous swipe" actions.
- **Hold-to-confirm is a custom gesture.** The HIG asks that custom gestures be discoverable and never the only way to do something [S8], and that gestures have onscreen alternatives [S7]. WCAG says long-press activation should happen when the finger lifts [S28] (secondary). Debbie uses the system confirmation dialog for Unpair tonight; on iPhone it is an action sheet [S39][S47]. A hold button is on the LATER list. It is specified as a drag state machine that fires on release, with the dialog as its accessible path (R12).
- **Custom back buttons cost the swipe-back gesture.** On the iOS 26.5 Simulator, hiding the system back button or bar turned off both the edge swipe and iOS 26's full-width content swipe. X44's delegate bridge brought back only the edge swipe [S46]. So `DebbieBackButton` ships with a UI test that swipes back (R1).
- **Debbie's component list.** About eighteen components (R1), each with defined states, accessibility, haptic (from 04-haptics.md) and test. It includes the navigation chrome the brief names (top bar, back button, sheet header) and a navigation row with Debbie's own chevron. It also includes a countdown ring for the live-view limit, because a date-driven `ProgressView` can't take a custom style [S42]. There is no segmented control (role choice uses two large choice cards), no tab bar (X19) and no pull to refresh. Pull to refresh draws the system spinner, and Debbie refreshes on its own [S6]. `TextField` is wrapped, not styled, because `TextFieldStyle` only exposes an underscored `_body` requirement (verified in local SDK) [S34].

## Findings

### F1. Toolchain and current release
- iOS 27.2.1 is current (9 Nov 2026). iOS 27 shipped on 14 Sep 2026 for iPhone 11 and later. Xcode 27 and 27.2 require "macOS Tahoe 26.6 and later" [S1].
- This Mac runs macOS 26.2, so the iOS 27 SDK is out of reach. Write against the local iOS 26.5 SDK.
- Apple's online docs now show iOS 27 SDK declarations. Example: `accessibilityShowsLargeContentViewer` takes `@ContentBuilder` online, but `@ViewBuilder` in the local SDK [S16][S34]. Always check signatures locally.

### F2. HIG rules for each control
**Buttons** [S2]:
- "A button needs a hit region of at least 44x44 pt."
- "Always include a press state for a custom button. Without a press state, a button can feel unresponsive."
- Use a prominent style for "the most likely action in a view"; "keep the number of prominent buttons to one or two per view."
- "Use style — not size — to visually distinguish the preferred choice."
- Roles are normal, primary, cancel and destructive. "Don't assign the primary role to a button that performs a destructive action."
- Labels: "consider starting the label with a verb", in title-style capitalisation. "Consider using text when a short label communicates more clearly than an icon."
- iOS: "Configure a button to display an activity indicator when … an action … doesn't instantly complete." Show a different label alongside it ("Checkout" → "Checking out…").
- Liquid Glass: "Avoid applying a similar color to button labels and content layer backgrounds."

**Toggles** [S3]:
- "Make sure the visual differences in a toggle's state are obvious … Avoid relying solely on different colors to communicate state."
- iOS: "Use the switch toggle style only in a list row." "Outside of a list, use a button that behaves like a toggle, not a switch."
- "Change the default color of a switch only if necessary … use a color that provides enough contrast with the uncolored appearance."

**Segmented controls** [S4]:
- No more than "about five segments on iPhone."
- Text or images, "not a mix of both."
- Equal widths, noun labels.
- Never mix action segments with selection segments.

**Text fields** [S5]:
- Placeholder text disappears when people type, so "include a separate label."
- Validate at the right time: on switching fields for an email, before switching fields for user names and passwords.
- Show the right keyboard.
- iOS: a trailing Clear button.

**Progress indicators** [S6]:
- "When possible, use a determinate progress indicator."
- "Keep progress indicators moving."
- "Don't switch from the circular style to the bar style."
- "Avoid vague terms like loading or authenticating."
- "When it's feasible, let people halt processing."
- Refresh controls are on the same page. A refresh control "is a specialized type of activity indicator", and "Perform automatic content updates … Don't make people responsible for initiating every update."

**Accessibility** [S7]:
- iOS default control size 44×44 pt, minimum 28×28 pt.
- "About 12 points of padding around elements that include a bezel … about 24 points … around the element's visible edges" for elements without one.
- "Offer alternatives to gestures."
- Support Full Keyboard Access and Switch Control.
- "Minimize use of time-boxed interface elements." The rule is about "Views and controls that auto-dismiss on a timer".

**Alerts** [S9]:
- For an uncommon destructive action that can't be undone, "display an alert."
- Use specific verb titles ("Erase", "Delete"), not "OK". "Aim for a one- or two-word title that describes the result of selecting the button."
- Always include "Cancel", and never make Cancel the default.
- "Use the destructive style to identify a button that performs a destructive action people didn't deliberately choose." When people "deliberately choose a destructive action — such as Empty Trash — the resulting alert doesn't apply the destructive style".

**Action sheets** [S39]. This page governs SwiftUI's `confirmationDialog`: "When you use SwiftUI, you can offer action sheet functionality … by specifying a presentation modifier for a confirmation dialog."
- "Use an action sheet — not an alert — to offer choices related to an intentional action." An alert "is usually unexpected, generally telling people about a problem or a change in the current situation".
- "Make destructive choices visually prominent. Use the destructive style for buttons that perform destructive actions, and place these buttons at the top of the action sheet".
- "A SwiftUI confirmation dialog includes a Cancel button by default."
- Apple's `confirmationDialog` documentation confirms a deliberately chosen "Empty Trash" with `Button("Empty Trash", role: .destructive)` [S47].
- So the Alerts rule that drops the destructive style for a chosen action applies to alerts. An action sheet that confirms a chosen destructive action keeps the style (R11).

**Toolbars and navigation bars** [S41]:
- "Use the standard Back and Close buttons … Prefer the standard symbols for each, and don't use a text label that says Back or Close. If you create a custom version of either, make sure it still looks the same, behaves as people expect, and matches the rest of your interface".
- Keep a title "under 15 characters long".
- HIG Gestures: people "expect to find a Back button in a top toolbar", and "many apps also offer a shortcut gesture — such as swiping from the side … — while continuing to provide the Back button" [S8].

**Branding** (changed 9 Sep 2026) [S40]:
- "Apply your app's accent color judiciously … Minimize its use on controls and instead use it intentionally for primary actions or status indicators, like badges for unread content or an icon for the selected tab in a tab bar."
- "If you need to customize a component's appearance to reflect your brand, ensure that details like sizing, placement, and behavior continue to preserve a familiar experience".

**Sheets** (changed 24 Mar 2026) [S10]:
- Pair Done with Cancel, or with Back in multi-step flows. "Avoid showing all three buttons."
- iOS: Cancel on the leading edge of the top toolbar, Done on the trailing edge.

**Feedback** [S11]: "Show people when a command can't be carried out and help them understand why."

### F3. SwiftUI building blocks (verified in local SDK) [S34]
- **`ButtonStyle`** (iOS 13): `makeBody(configuration:)`, with `ButtonStyleConfiguration` providing `label`, `isPressed` and `role` (iOS 15).
- **`PrimitiveButtonStyle`** (iOS 13): its configuration has `label`, `role` and `trigger()`. There is no `isPressed`, because the style owns the interaction [S12].
- **`ButtonRole`**: `.destructive`, `.cancel`, and from iOS 26 `.confirm` and `.close`. `.close` "doesn't lose progress for a user" [S12].
- **`@Environment(\.isEnabled)`** (iOS 13, default `true`) [S21].
- **Built-in styles (iOS 26)**: `.glass` and `.glassProminent`, both `PrimitiveButtonStyle`s, unavailable on visionOS. `GlassButtonStyle(_ glass:)` arrived in iOS 26.1.
- **Liquid Glass for custom controls (iOS 26)**: `glassEffect(_:in:)` with `Glass.regular`, `.clear` and `.identity`, plus `.tint(_:)` and `.interactive(_:)` [S20].
  - WWDC25 323: for custom controls on iOS, "add the interactive modifier to the glass effect. Glass reacts to user interaction by scaling, bouncing, and shimmering." Use tint "to convey meaning and not just for visual effect" [S27].
  - Bordered buttons are now capsule-shaped by default. The session also says "for your most important, prominent actions there is now support for extra large sized buttons" [S27], but that sentence sits in its macOS control-height passage. On iPhone, `ControlSize.extraLarge` "resolves to ControlSize.large on platforms other than visionOS" [S20], so `.controlSize(.extraLarge)` makes nothing bigger. Debbie's sizes come only from `DebbieButtonStyle` (R3).
- **Shape and size**:
  - `buttonBorderShape(_:)` (iOS 15): `.automatic`, `.capsule`, `.roundedRectangle`, `.roundedRectangle(radius:)`, and `.circle` (iOS 17).
  - `controlSize(_:)`: `.mini`, `.small`, `.regular`, `.large`, `.extraLarge` (iOS 17). The docs say `.extraLarge` "resolves to ControlSize.large on platforms other than visionOS" [S20].
  - `buttonSizing(_:)` (iOS 26): `.automatic`, `.flexible`, `.fitted`. Custom styles can read `\.buttonSizing` [S20].
  - In apps built with the iOS 27 SDK, "the `controlSize`, `buttonSizing`, `buttonRepeatBehavior`, `menuIndicatorVisibility`, and `ButtonBorderShape` environment values are now reset to their default values in sheets and popovers" [S38]. A style that reads them would behave differently inside sheets after the move to Xcode 27, so Debbie's styles don't read them (R2).
- **Hit testing and assistive shapes**:
  - `contentShape(_:eoFill:)` "defines the content shape for hit testing." `contentShape(_:_:eoFill:)` with `ContentShapeKinds` shapes one kind at a time [S19].
  - On iOS the usable kinds are `.interaction`, `.dragPreview`, `.contextMenuPreview`, `.hoverEffect` and `.accessibility` (iOS 17).
  - `.focusEffect` is `@available(iOS, unavailable)` in the local SDK, and Apple's page lists it for macOS 12 and watchOS 8 only [S19][S34]. Compiled for iPhone, `.contentShape(.focusEffect, Circle())` fails with "'focusEffect' is unavailable in iOS" [S45]. Apple's example for the modifier uses it, which is how the first draft of this note went wrong.
  - Setting a content shape of kind `.accessibility` "causes the accessibility frame and path of the view's underlying accessibility element to match the shape without adjusting the hit-testing shape, updating the visual focus ring that assistive apps, such as VoiceOver, draw" (local SDK documentation) [S34]. That is the path the Full Keyboard Access cursor follows (F4).
- **Focus**:
  - `@FocusState` with `focused(_:equals:)` (iOS 15). Setting it programmatically moves focus.
  - `focusable(_:interactions:)` (iOS 17, `.activate`, `.edit`).
  - `focusEffectDisabled(_:)` (iOS 17).
  - `@Environment(\.isFocused)` [S18].
- **`ToggleStyle`**: `ToggleStyleConfiguration` has `label`, `isOn` and `$isOn`, plus `isMixed` (iOS 16). Built-in styles are `.switch`, `.button` and `.automatic` [S13].
- **`ProgressViewStyle`**: `ProgressViewStyleConfiguration` has `fractionCompleted: Double?` (`nil` means indeterminate), `label` and `currentValueLabel`. Built-ins are `.linear` and `.circular`.
  - `ProgressView(timerInterval:countsDown:)` (iOS 16) updates itself, but "Date-relative progress views, such as those created with this initializer, don't support custom styles" [S42].
  - For the circular style, Apple says: "In cases where no determinate circular progress view style is available, circular progress views use an indeterminate style" [S42].
  - So a self-updating countdown would have the system look, which the brief bans. Debbie's live-view ring is its own view (R1 `DebbieCountdownRing`, R10).
  - `Text(timerInterval:pauseTime:countsDown:showsHours:)` (iOS 16) is text, not a control, and stays usable.
- **`LabelStyle`**: `.iconOnly`, `.titleOnly` and `.titleAndIcon`. The configuration has `title` and `icon`.
- **`TextFieldStyle`**: its only requirement is the underscored `_body(configuration:)`. Reasoning: underscored members aren't a supported customisation point, so wrap `TextField` in a component view rather than styling it.
  - In the iOS 27 SDK, "The `.squareBorder` and `.roundedBorder` text field styles are soft deprecated — use the new `.bordered` text field style instead". `TextInputBorderShape` with `textInputBorderShape(_:)` customises the border [S38]. Apple's online `TextFieldStyle` page lists both old styles under Deprecated [S49].
  - None of this is in our SDK. `DebbieTextField` uses `.plain` and draws its own border (R9).
- **Navigation chrome and swipe-back (measured on the iOS 26.5 Simulator)** [S46]. A probe app pushed a detail view inside a `NavigationStack`. XCUITest then swiped right from the leading edge (1 % of the width) and from mid-content (35 %).

  | Detail view's chrome | Edge swipe pops | Content swipe pops |
  |---|---|---|
  | System back button | yes | yes |
  | `navigationBarBackButtonHidden(true)` + custom toolbar Back | no | no |
  | Same, plus a bridge that sets `interactivePopGestureRecognizer.delegate` (X44) | yes | no |
  | `.toolbar(.hidden, for: .navigationBar)` + custom bar | no | no |
  | Same, plus the bridge | yes | no |
  | Same, plus the bridge also on `interactiveContentPopGestureRecognizer` | yes | no |

  - `interactiveContentPopGestureRecognizer` (iOS 26) "recognizes on the entire content area" [S34]. No custom chrome got it back.
  - The UIKit header says of both recognizers: "This property should only be used to set up failure requirements with it" [S34]. X44's bridge uses it in a way the header advises against, so the UI test in R1 is the guard.
- **Pull to refresh.** On a `List`, `refreshable(action:)` makes the view reveal "a progress indicator" while it refreshes [S48]. That is the system spinner. SwiftUI has no style type to change it (none in the local SDK) [S34]. Custom views can call the `\.refresh` action and draw their own [S48].

### F4. Accessibility of custom controls
- **Inherit before you represent.** "A custom ToggleStyle that you create inherits the accessibility features of Toggle automatically. When you can't use the parent view's accessibility elements, use … `accessibilityRepresentation(representation:)`," whose hidden view "the framework uses … only to generate accessibility elements" [S14]. Apple: "It's recommended to use accessibilityRepresentation(representation:) when possible, to make custom controls accessible" [S22].
- **The `configuration.label` trap.** Apple's own demo `SymbolButtonStyle` returned an `Image` and ignored `configuration.label`, so VoiceOver read the symbol name ("slider.vertical.3") instead of "Edit Budgets" [S22].
- **Traits.** `.isToggle` (iOS 17) "provides the proper accessibility hint and 'switch button' description" for a button that toggles [S26]. Other traits verified in the local SDK [S34]: `.isButton`, `.isSelected`, `.isHeader`, `.updatesFrequently`, `.startsMediaSession`.
  - `.startsMediaSession` silences assistive output: "Use this trait to silence the audio output of an assistive technology, such as VoiceOver, during a media session that should not be interrupted" [S43]. Debbie's live view has no audio (brief §5.1.5) and must announce its start, last minute and end (04 R7, 10 R18), so Debbie never uses it.
- **Actions.**
  - `accessibilityAction(_:_:)` and `accessibilityAction(named:_:)` [S17].
  - Custom actions "show up in VoiceOver, Switch Control, and Full Keyboard Access … Custom actions are what show up when you hit Tab-Z" [S23].
  - `accessibilityRespondsToUserInteraction(false)` tells the Full Keyboard Access and Switch Control cursors to skip an element that is readable but not interactive [S23].
- **Voice Control.** `accessibilityInputLabels(_:)`: "Voice Control and Full Keyboard Access use the input labels." Without them, people use the accessibility label [S17].
- **Show Borders (formerly Button Shapes).**
  - SwiftUI `accessibilityShowBorders` (`@backDeployed(before: iOS 26.1)`, so usable from iOS 14) reports "whether the system preference for Show Borders is enabled." When true, "draw interactive custom controls such as buttons with clearly visible edges" [S15].
  - The old SwiftUI `accessibilityShowButtonShapes` is marked `deprecated: 1000, renamed: "accessibilityShowBorders"`, a soft deprecation with no warning today.
  - UIKit's `UIAccessibility.buttonShapesEnabled` is hard-deprecated (`ios(14.0, 26.1)`) in favour of `AccessibilitySettings.showBordersEnabled` (iOS 26.1). Verified in local SDK [S34].
  - The setting was renamed in iOS 26.1. The SDK documentation calls it "Show Borders" [S15][S34]. MacRumors (3 Nov 2025) calls the toggle "Display Borders": "It adds a border to all buttons, and replaces the prior 'Button Shapes' setting" [S36] (secondary). Debbie's copy and CRAFT.md use the SDK name.
  - WWDC20 10020: "If you can't fit button shapes in your default design, you should provide an alternate appearance for people with this setting enabled" [S25].
- **On/Off Labels.**
  - In Swift the API is `UIAccessibility.isOnOffSwitchLabelsEnabled` (iOS 13), with `UIAccessibility.onOffSwitchLabelsDidChangeNotification`. `UIKit.apinotes` renames the C function `UIAccessibilityIsOnOffSwitchLabelsEnabled()`, so that name doesn't compile in Swift (verified in local SDK) [S34].
  - No SwiftUI environment value exists, so a custom switch must observe the notification to redraw while it's on screen (R7).
  - Apple's user guide describes what the setting draws: switches "use a vertical line to indicate when they're on and a circle to indicate when they're off" [S51].
- **Reduce Bright Effects (iOS 26.4).** `accessibilityReduceHighlightingEffects` reports "Whether the system preference for Reduce Bright Effects is enabled". When it is true, "controls, such as buttons, should be drawn in such a way that minimizes highlighting and flashing" [S35].
  - The SwiftUI value is get-only, so tests can't set it. The UIKit-side route is `AccessibilitySettings.isReduceHighlightingEffectsEnabled` with `reduceHighlightingEffectsEnabledDidChangeNotification` (verified in local SDK) [S34].
- **Large content viewer.**
  - `accessibilityShowsLargeContentViewer()` and `accessibilityShowsLargeContentViewer(_:)` (iOS 15). "Rely on the large content viewer only in situations where items must remain small due to unavoidable design constraints … Don't use the large content viewer as a replacement for proper Dynamic Type support" [S16].
  - It is for "tab bars or any other UI that has to stay small"; people long-press, then drag and release to activate [S24].
- **Focus for assistive technologies.**
  - `AccessibilityFocusState` can move VoiceOver focus, but "moving focus programmatically can be very disruptive if no user interaction occurred". Reserve it for high-priority banners [S22].
  - Full Keyboard Access uses the same focus system as Tab navigation [S23].
  - The Full Keyboard Access cursor follows the element's accessibility path: "To show nice cursor shapes around our buttons, we can just use accessibilityPath -- the same accessibilityPath, in fact, that you'd use for VoiceOver" [S23]. In SwiftUI that path comes from `.contentShape(.accessibility, …)` (F3).
  - No public API reports whether Full Keyboard Access is on (verified in local SDK) [S34]:
    - SwiftUI's `AccessibilityTechnologies` has only `.voiceOver` and `.switchControl`, and its Full Keyboard Access setter is `internal`.
    - UIKit has only `UIAccessibilityIsVoiceOverRunning()` and `UIAccessibilityIsSwitchControlRunning()`.
    - `AccessibilityRequest.current.technology` (iOS 18) names the technology that is asking during an accessibility callback. It isn't a setting.
  - On iPhone, the Tab key alone doesn't move focus between buttons. In the probe, `typeKey(.tab)` left both buttons without focus after one press and after two [S46]. Keyboard traversal of buttons needs Full Keyboard Access, which only the Settings app can turn on. `simctl ui` offers only appearance, content size and Increase Contrast [S46].
- **Announcements.** `AccessibilityNotification.Announcement` (iOS 17) supports high, default and low priority [S26][S34].
- **Auditing.** `XCUIApplication.performAccessibilityAudit` (iOS 17). On iOS and the Simulator, the audit types are contrast, element detection, hit region, sufficient element description, Dynamic Type, clipped text and traits. The action and parent/child audit types are compiled only for macOS and Mac Catalyst (`#elif TARGET_OS_OSX || TARGET_OS_MACCATALYST` in `XCUIAccessibilityAuditTypes.h`). So on iPhone the audit doesn't check custom actions or containment, and R13 covers them. Verified in local `XCUIAutomation` headers [S34].

### F5. Hold-to-confirm and other serious actions
- **Platform convention.** Touch and hold means "reveal additional controls or functionality" [S8], usually a context menu. A hold that commits an action is a custom gesture. It must be "discoverable; straightforward to perform; distinct from other gestures; not the only way to perform an important action" [S8].
- **`LongPressGesture` commits while the finger is down.** It "succeeds when a person performs a long press that elapses a minimum duration" [S44], so `onEnded` runs when the duration elapses, not when the finger lifts. `maximumDistance` (default 10 pt, verified in local SDK [S34]) is "The maximum distance that the long press can move before the gesture fails" [S44]. It governs only the press, and nothing after the gesture has succeeded. A hold that fires on release therefore can't be a `LongPressGesture` (R12).
- **Alternatives and timers.** "Offer alternatives to gestures" [S7]. The HIG's "Minimize use of time-boxed interface elements" is about "Views and controls that auto-dismiss on a timer" [S7]. It doesn't govern a hold gesture, but it does argue against an undo banner that disappears on a timer (R11).
- **WCAG 2.5.2 Pointer Cancellation (secondary).** Single-pointer functions must not execute on the down-event unless they can be aborted or undone, or the up-event reverses them. Its examples: "For interface elements that have a single tap or long press as input, the corresponding event is triggered when the finger is lifted inside that element" [S28].
- **Apple's own precedent (iOS 26.1).** Alarms moved to "slide to stop" to prevent accidental dismissal. A new "Prefer Single-Touch Actions" switch (Settings → Accessibility → Touch) restores the tap button [S37] (secondary). The SDK exposes `AccessibilitySettings.prefersActionSliderAlternative` (iOS 26.1): "Prefers that user interface items that rely on a prolonged, continuous swipe action provide an alternative requiring less physical dexterity or effort." Verified in local SDK [S34][S35]. Reasoning: the name and wording match, so this is very likely the API for that switch.
- **Touch Accommodations** let people set Hold Duration and Haptic Touch speed (Fast or Slow) [S30]. Reasoning: a custom hold gesture adds to these delays and doesn't adapt to them.
- **The standard path.** Confirm an uncommon destructive action that can't be undone [S9]. Present the confirmation as an action sheet, which is what SwiftUI's `confirmationDialog` is on iPhone, because it confirms an action the person chose [S39][S47]. Give it a specific verb and a Cancel button [S9][S39]. System alerts and action sheets are exempt from the custom-asset rule (CLAUDE.md, "system-drawn UI").

## What changed in the current iOS release
- **iOS 27 (shipped 14 Sep 2026; 27.2.1 today):**
  - **HIG.** Buttons, Toggles, Segmented controls, Text fields, Progress indicators, Alerts and Accessibility have no 2026 changes. Their latest change-log entries are 16 Dec 2025, 29 Mar 2024, 21 Jun 2023, 5 Jun 2023, 12 Sep 2023, 2 Feb 2024 and 9 Jun 2025 [S2]–[S7][S9][S33].
  - **HIG Branding** changed on 9 Sep 2026: "Refined guidance for using brand color" [S33][S40]. It now says "Minimize its use on controls and instead use it intentionally for primary actions or status indicators". This decides which Debbie controls carry mint (R1, R4, R14).
  - **HIG Gestures** added Mac touch-input guidance on 28 Oct 2026 [S8], which doesn't affect iPhone.
  - **Settings.** The Liquid Glass look moved from Display & Brightness, where it was a Clear/Tinted choice in iOS 26, to **Appearance → Liquid Glass**, a tint slider, in iOS 27 [S29]. System `.glass` and `.glassProminent` buttons follow this setting. Debbie's opaque custom styles don't (see R14).
  - **Control changes in the iOS & iPadOS 27 Release Notes** (SwiftUI section; each needs Xcode 27) [S38]:
    - "You can now use the `TextInputBorderShape` type to customize the border shape of text input controls like `TextField` with the `textInputBorderShape(_:)` view modifier. The `.squareBorder` and `.roundedBorder` text field styles are soft deprecated — use the new `.bordered` text field style instead." (173362083). Affects F3 and R9.
    - "The `TabsPickerStyle` style is now available for pickers that represent tab-based navigation and content selection. This style is similar to the `.segmented` style, but VoiceOver reads it as 'tabs'" (173211711). Affects R8.
    - "In apps built with the 27.0 SDKs, the `controlSize`, `buttonSizing`, `buttonRepeatBehavior`, `menuIndicatorVisibility`, and `ButtonBorderShape` environment values are now reset to their default values in sheets and popovers." (167448274). Affects R2 and R3.
  - **iOS 27 SDK-only SwiftUI APIs** (need Xcode 27, so unavailable to us) [S31]:
    - `alert(error:actions:)` and the item-based `alert` and `confirmationDialog` variants. The release notes add that projects targeting iOS 15 or later can use them (179388848), but they still need the 27 SDK to compile [S38];
    - `GestureInputKinds` on `LongPressGesture` and other gestures;
    - toolbar `visibilityPriority`, `ToolbarOverflowMenu` and `topBarPinnedTrailing`;
    - the tab `.prominent` role;
    - `ContentBuilder`;
    - iPhone Duo's vertical-axis controls (`toolbarVerticalEdge`, `toolbarVerticalBehavior`).
  - **UIKit (June 2026).** "Starting in iOS 27, apps built with the latest SDK must use the scene-based life cycle" [S32]. This doesn't apply to a 26.5-SDK build, and SwiftUI apps are scene-based anyway.
- **iOS 26.x, already in our SDK:**
  - **HIG Sheets** updated its button placement on 24 Mar 2026, the day iOS 26.4 shipped [S1][S10][S33]. Cancel goes on the leading edge and Done on the trailing edge (F2).
  - Button Shapes became Show Borders. The UIKit API is deprecated in 26.1 and the SwiftUI value renamed [S15][S34][S36].
  - iOS 26 added `interactiveContentPopGestureRecognizer`, a swipe back from anywhere in the content. Custom back buttons lose it (F3) [S34][S46].
  - `prefersActionSliderAlternative` (26.1) and `accessibilityReduceHighlightingEffects` (26.4) were added [S34].
  - Also from iOS 26: `ButtonRole.confirm` and `.close`, `buttonSizing`, the glass button styles, and `GlassButtonStyle(_:)` (26.1) [S12][S20][S34].
  - `SensoryFeedback.press(.button)` exists but plays only on visionOS (see 04-haptics.md, F3).

## Recommendations for Debbie

**R1. Debbie's component list.** ADOPT-TONIGHT. Every system control the app uses is replaced by one reusable style or view in the design-system module. Basis: brief §3 and §9 (custom controls), [S2]–[S7], [S40][S41], lead decisions X19, X21, X35 and X44, with haptics from 04-haptics.md.

| Component | Replaces | Built as | States | Accessibility requirements | Haptic |
|---|---|---|---|---|---|
| `DebbieButtonStyle` (variants `.primary`, `.secondary`, `.quiet`, `.destructive`, `.urgent`; sizes `.compact`, `.regular`, `.large`, `.prominent`, `.resident`, R3) | `.borderedProminent`, `.bordered`, `.borderless`, `.glass*` | `ButtonStyle` | default, pressed, disabled, loading, focused (error shown by the host view, R4) | Uses `configuration.label`; traits come from `Button`; `.quiet` gets an outline when `accessibilityShowBorders`; label wraps at accessibility sizes; colours per "Variant colours" below | none on tap |
| `DebbieIconButton` (close, settings, info) | Icon-only toolbar or overlay buttons | `Button` + `Label(_:image:)` + `.labelStyle(.iconOnly)` + `DebbieButtonStyle(.quiet, .compact)` | default, pressed, disabled, focused | Title is the spoken label ("Close", never a glyph name [S41]); hit region 44×44 pt via frame + `contentShape(.interaction, …)`; `accessibilityShowsLargeContentViewer()` only where Dynamic Type is clamped (R6.5); circular outline under Show Borders | none |
| `DebbieTopBar` (title, back, one trailing action) | The system navigation bar | A view in `safeAreaBar(edge: .top)` on a screen with `.toolbar(.hidden, for: .navigationBar)` (X44; `safeAreaBar` is iOS 26.0 [S45]); glass only here (X20) | default, scrolled (scroll-edge effect), accessibility sizes | Title is `Text` with `.isHeader`, under 15 characters [S41], wrapping at accessibility sizes and never truncated; reading order back, title, trailing action | none |
| `DebbieBackButton` | The system Back button | `Button` + Debbie's chevron glyph (08) + `DebbieButtonStyle(.quiet, .compact)` | default, pressed, focused; absent at the stack root | No visible "Back" text and label "Back" [S41]; 44×44 pt; the screen root adds `.accessibilityAction(.escape) { dismiss() }` so VoiceOver's two-finger scrub still goes back (Reasoning; check on device). The leading-edge swipe must keep working: X44's bridge, guarded by a UI test that edge-swipes and expects the previous screen. Without the bridge, the edge swipe doesn't go back on the 26.5 runtime [S46]. iOS 26's content swipe can't be restored (F3) | none (04 R3) |
| `DebbieSheetHeader` | The system sheet toolbar | A view pinned to the top of the sheet's content | default, editing (Done enabled), accessibility sizes | Title `.isHeader`; "Cancel" (`.quiet`, `role: .cancel`) on the leading edge and "Done" (`.primary`, `.compact`) on the trailing edge; never Cancel, Done and Back together; multi-step sheets put `DebbieBackButton` leading [S10]; keeps swipe to dismiss and a grabber on resizable sheets [S10]; re-applies Debbie's button environment at the sheet root (R2) | none |
| `DebbieRowStyle` (a list row that navigates) | `NavigationLink` rows in a `List`, which draw the system disclosure chevron (08 R13) | `ButtonStyle` on a `Button` that appends to the `NavigationStack` path (X19) | default, pressed (`surface.pressed`, X36), disabled, focused | One element: the row's text is the label and `Button` supplies `.isButton`; Debbie's chevron glyph (08) is decorative; at least 44 pt tall | none |
| `DebbieSwitchStyle` | `.switch` toggle in Settings rows | `ToggleStyle` | off, on, pressed, disabled, focused, pending ("Saving…") | Inherits `Toggle` semantics [S14]; state shown by knob position and track fill, plus Debbie's line and circle glyphs when On/Off Labels is on (R7) [S51]; list rows only [S3] | `.selection` on user change |
| `DebbieToggleCardStyle` (resident's "Live view") | `.button` toggle style outside lists | `ToggleStyle` | off, on, pending, error (reverts and explains) | Whole card is the target; text states the consequence ("Off — no one can see the camera"); never colour-only [S3] | `.selection` |
| `DebbieChoiceCard` (role: caregiver or resident) | Segmented control or inline picker | `Button` + style reading a selected flag | unselected, selected, pressed, disabled, focused | `.isSelected` trait on the chosen card; group container labelled "Role"; border under Show Borders | `.selection` |
| `DebbieTextField` (phone name) | Default `TextField` chrome | Wrapper `View` around `TextField` with `.textFieldStyle(.plain)` (not `TextFieldStyle`, never `.roundedBorder`, R9) | empty, focused, filled, error, disabled | Persistent visible label [S5]; error text after the field in reading order; `@FocusState` returns focus on error; trailing Clear button (44×44 pt, "Clear name") | `.error` on invalid submit only |
| `DebbieProgressStyle` (`.spinner`, `.bar`) | `.circular`, `.linear` | `ProgressViewStyle` | indeterminate, determinate, complete | Specific label text, never "Loading" alone [S6]; check the spoken value with Accessibility Inspector and add `.accessibilityValue` if lost (Reasoning) | none |
| `DebbieCountdownRing` (live-view limit) | `ProgressView(timerInterval:countsDown:)`, which can't take a custom style [S42] | `View`: `TimelineView(.periodic(from: start, by: 1))` drawing `Circle().trim` from the remaining fraction, with no animation (R10) | counting, last minute, ended | Inside the live bar the ring is decorative (`accessibilityHidden(true)`), and the bar's one element carries "4 minutes 12 seconds left" with `.updatesFrequently` (10 R18). Alone, the ring has label "Time left", a value from the same timeline date, and `.updatesFrequently`. Reduce Motion changes nothing, because it never animates | none |
| `DebbieLabelStyle` | `.titleAndIcon`, `.iconOnly` | `LabelStyle` | n/a | Custom glyph is decorative; `title` stays the accessible name [S22] | none |
| `DebbieCodeDisplay` (4-digit pairing code) | n/a (new) | `View` | live, expired | `speechSpellsOutCharacters()` (verified in local SDK [S34]) so VoiceOver reads digit by digit; one accessibility element, "Pairing code 4 7 1 9" | none |
| `DebbieStepIndicator` (pairing steps) | n/a (new) | `View` | upcoming, current, done | One element, "Step 2 of 3, Confirm the code"; `accessibilityRespondsToUserInteraction(false)` [S23] | none |
| Live view controls ("Stop", "Keep Watching") | n/a | `DebbieButtonStyle`; Stop is `.prominent` (X21) | Stop: default, pressed only (never disabled, never confirmed). Keep Watching: default, pressed, loading ("Requesting…") | Stop reachable by VoiceOver, Full Keyboard Access and Switch Control at all times. No `.startsMediaSession`: it silences VoiceOver during a media session [S43], and the live view has no audio and must speak its announcements (04 R7, 10 R18) | none |
| Alert actions ("I'm On It" per X35, "Mark False Alarm") | n/a | `DebbieButtonStyle(.primary, .prominent)` and `(.quiet, .regular)` | I'm On It: default → loading ("Saving…") → done (a non-interactive acknowledgement line, 10 R9). Mark False Alarm: opens a system confirmation dialog (R11) | Each alert row exposes `.accessibilityAction(named: "I'm On It")` and `(named: "Mark False Alarm")` [S23]; input labels list the visible label first (R6.3) | `acknowledged` = `.success` |
| Unpair | n/a | `Button(role: .destructive)` + `DebbieButtonStyle(.destructive, .large)` → system `confirmationDialog`, an action sheet on iPhone [S39] | default, pressed | Dialog: specific verb "Unpair" in the destructive style [S39], plus "Cancel" [S9] | none at confirm (04 R2) |

**Variant colours.** HIG Branding (9 Sep 2026) asks apps to "minimize [the accent colour's] use on controls and instead use it intentionally for primary actions or status indicators" [S40]. Tokens and measured ratios are note 06's (F8 table) and X36's.
- `.primary`: `mint.fill` with `text.onMint` (7.69:1 in light and dark). At most one per screen (R5), so mint appears on one button per screen.
- `.secondary`: a neutral `bg.surface` fill, a `text.primary` label (16.77:1 light) and a 1.5 pt `border.control` outline (3.35:1 against `bg.canvas` light). Reasoning: a white fill on the near-white canvas is otherwise invisible to older eyes, and the outline shows the shape without colour.
- `.quiet`: no fill and an `accent.text` label (6.03:1 on `bg.canvas` light). Note 06 gives `accent.text` the role "interactive text and icons", and HIG Color keeps one colour to one meaning (06 F1). It is the deep companion, not the mint fill.
- `.destructive`: the `.secondary` shape with an `urgent.text` label (7.88:1 on `bg.surface` light). It never uses `urgent.fill`, which is reserved for possible-fall urgency (06 R6).
- `.urgent`: `urgent.fill` with `text.onUrgent`, on urgent-alert surfaces only (R5).
- State indicators may use mint. These are the switch's on-track and the selected choice card's border and check. Reasoning: they show state, which the Branding page names as the right use ("an icon for the selected tab in a tab bar") [S40].

**Not built, on purpose:**
- No tab bar (X19).
- No segmented control (R8).
- No pull to refresh. `.refreshable` draws the system spinner [S48]. Debbie fetches on push, on return to the foreground and on its polling timer, as the HIG asks ("Don't make people responsible for initiating every update" [S6]). Error and offline states offer "Try Again" (15-flows-and-states.md).
- **Check:** `grep -rnE 'refreshable|NavigationLink|navigationBarBackButtonHidden|ProgressView\(timerInterval|contentShape\(\.focusEffect|startsMediaSession' Sources --include=*.swift` prints nothing.

**R2. Button architecture.** ADOPT-TONIGHT. `ButtonStyle` keeps platform tap, keyboard and assistive-technology activation; roles carry meaning [S2][S12].
- All tap buttons use `DebbieButtonStyle: ButtonStyle`. `PrimitiveButtonStyle` is allowed only for the R12 hold button.
- The style reads `configuration.role`: `.destructive` gets destructive styling; `.cancel` is never filled.
- Call sites pass `role:`. Styling is never chosen ad hoc.
- Variants are selected through an environment value (for example `.debbieButtonVariant(.primary)`) so a container can set them.
- Sizes and variants are `DebbieButtonStyle` parameters or Debbie's own environment keys. Debbie's styles never read `\.controlSize`, `\.buttonSizing` or `\.buttonBorderShape`, which the iOS 27 SDK resets to defaults inside sheets and popovers [S38]. `DebbieSheetHeader`'s container also re-applies Debbie's keys at the sheet root. Reasoning: the move to Xcode 27 then changes nothing inside sheets.
- **Check:** `grep -rn "PrimitiveButtonStyle" Sources/` matches only the hold button file, and `grep -rnE 'controlSize|buttonSizing|buttonBorderShape' Sources/DesignSystem/` prints nothing.

**R3. Sizes and hit regions.** ADOPT-TONIGHT. 44 pt is Apple's floor [S2][S7]. The larger tiers are lead decision X21. It adopts note 07's older-adult evidence (in a study of adults aged 65–95, tap accuracy dropped below about 14 mm, 07 R12) and note 10's reasoning about stress. Every tier still grows with Dynamic Type.
- `.compact`: minimum height 44 pt. Inline secondary actions, and the hit region of icon buttons.
- `.regular`: 48 pt. Secondary actions beside or below a primary.
- `.large`: 56 pt, full content width. Screen primary actions such as Pair, Approve, Continue and Unpair. Reasoning (X21 keeps 56 here, below 07 R12's 64): these are set-up tasks without time pressure, and full width already gives more than 300 pt of width.
- `.prominent`: 64 pt (about 10 mm), full width. Alert response actions (I'm On It, Call, Open Live View) and live-view Stop (07 R12, X21).
- `.resident`: 96 pt (at least 15 mm on every supported iPhone), full width. Resident-mode controls only (07 R12, X6, X21).
- Icon buttons draw a 24–28 pt glyph inside a hit region of at least 44×44 pt (`.frame(minWidth: 44, minHeight: 44)` + `.contentShape(.interaction, .rect)`).
- Adjacent bezeled controls are at least 12 pt apart. Quiet (unbezeled) buttons keep at least 24 pt clear around their visible edges [S7]. A destructive action sits at least 32 pt from any other button (07 R13).
- Heights are minimums, never fixed. Labels wrap at accessibility sizes (`dynamicTypeSize.isAccessibilitySize`), and side-by-side pairs stack vertically through `ViewThatFits`. Both APIs are verified in local SDK [S34].
- Sizes are never set through `controlSize`. `.controlSize(.extraLarge)` is `.large` on iPhone (F3), and the 27 SDK resets `controlSize` inside sheets [S38].
- **Check:** a UI test asserts every `buttons`, `switches` and `textFields` element has frame width and height of at least 44, and `performAccessibilityAudit(for: .hitRegion)` passes [S34]. The component gallery's snapshot test measures each size's rendered height at the default text size: 44, 48, 56, 64 and 96 pt or more.

**R4. State specification.** ADOPT-TONIGHT. Every component implements exactly these states [S2][S6][S11][S15][S18][S19].
- **Pressed** (`configuration.isPressed`):
  - Fill switches to the variant's pressed token (X36). `mint.fill.pressed` is one step lighter in both modes, so `text.onMint` stays at 7:1 or more. `urgent.fill.pressed` is darker, and neutral fills use `surface.pressed`.
  - Scale 0.97.
  - Press-in and release both animate with 03's `press` token (`Spring(duration: 0.20, bounce: 0)`, which reaches 80 % at 0.096 s). So the press reads as immediate, inside 03 R7's 100 ms budget, and the release is interruptible. This is 03 R1's rule ("Custom control pressed state, both directions"). The first draft's "pressed look on the first frame" is withdrawn.
  - Under Reduce Motion: the same token with no scale, so only the colour changes (03 R1).
  - **Under Reduce Bright Effects** (`accessibilityReduceHighlightingEffects`, iOS 26.4+, read through Debbie's own environment value so tests can set it, R7): the fill never lightens on press. It keeps its default token, and the press shows as a 2 pt inset outline in the variant's label colour (for example `text.onMint` on mint, 7.69:1), plus the 0.97 scale unless Reduce Motion is on. With both settings on, the outline alone is the press state. Reasoning: the setting asks controls to minimise "highlighting and flashing" [S35], and X36 makes every mint press a lightening. The outline is a press state that doesn't brighten, and the HIG requires a press state [S2].
- **Disabled** (`@Environment(\.isEnabled) == false`):
  - Neutral `fill.disabled` and `label.disabled`, with no mint. The label keeps at least 3:1 contrast. Reasoning: WCAG exempts inactive controls, but older users must still read them.
  - A visible reason sits next to it ("Connect to home Wi-Fi to sync"). Prefer keeping a button enabled and explaining on tap [S11].
- **Loading** (Debbie environment flag):
  - A circular spinner leads a gerund label ("Saving…", "Approving…", "Connecting…") [S2].
  - Width is locked to the default state so the layout doesn't jump (Reasoning).
  - Repeat taps are ignored by an idempotent action guard. Don't use `allowsHitTesting(false)`, so VoiceOver focus stays put (Reasoning).
  - Waits over 10 s show a "Cancel" [S6].
- **Focused** (the Full Keyboard Access, Switch Control and VoiceOver cursors):
  - The assistive technology draws its cursor around the element's accessibility path [S23]. `.contentShape(.accessibility, <the control's shape>)` (iOS 17) makes it hug the capsule without changing hit-testing [S34], and `.contentShape(.interaction, …)` sets the hit region (R3). Never `.focusEffect`, which doesn't compile for iOS [S45].
  - `focusEffectDisabled()` is banned on interactive views [S18].
  - `DebbieTextField` draws a 2 pt `focus.ring` outline (X36) when its `@FocusState` is true (Reasoning: we draw the field, so we draw its focus).
  - **Check:** the cursor shape is part of the on-device Full Keyboard Access pass (R13), because only the Settings app can turn Full Keyboard Access on [S46].
- **Error:**
  - Buttons never turn red. The host view shows an inline icon and text message next to the action [S11], and the button's label becomes the recovery verb ("Try Again").
  - Text fields show an error border, icon and message. Never colour alone [S3].
- **Check:** a snapshot matrix renders each component in every state, in light, dark and increased contrast, at default and AX5 Dynamic Type, with Show Borders on and off. It adds switches with On/Off Labels on, and pressed states with Reduce Bright Effects on (iOS 26.4 runtime or later; 26.5 is installed). The system values are get-only or UIKit-only [S34], so the app root reads all three into Debbie's own environment value, and tests set that value (R7).

**R5. Hierarchy and labels.** ADOPT-TONIGHT. Fewer prominent buttons lowers cognitive load, and specific verbs prevent misreads [S2][S9].
- At most one `.primary` per screen; Apple allows one or two, Debbie is stricter.
- `.urgent` appears only on urgent-alert surfaces.
- `.destructive` is never `.primary` and never the default action.
- Every button label, dialog buttons included, is at most 3 words and starts with a verb: "Unpair", "Try Again", "Keep Watching", "Mark False Alarm". A `{name}` placeholder counts as one word ("Call {name}"). Reasoning: this tightens HIG Buttons' "a few words" and "consider starting the label with a verb" [S2].
- Dialog buttons aim for one or two words, as HIG Alerts asks [S9]. Three are allowed only when two would be unclear. "Mark False Alarm" keeps three because "False Alarm" isn't a verb and "Mark False" is unclear (Reasoning). The cancel button is always "Cancel" [S9].
- Exceptions sit in the lint's allowlist, each with its reason:
  - "Done", the HIG's standard sheet button [S10].
  - "I'm On It", the acknowledgement label (X35). It is first-person because it tells the family who is handling the alert. Its input labels keep the verb alias "Acknowledge" (R6.3).
- Capitalisation: title case for buttons and dialog titles (X10).
- **Check:** a test over the string catalog fails on any button label longer than 3 words, or one whose first word isn't in the verb list kept beside the catalog, unless the label is on the allowlist. Labels proposed in other notes that fail it today: 10 R9's "Mark as false alarm" (use "Mark False Alarm") and X14's "Send a test alert" (use "Send Test Alert").

**R6. Accessibility contract for every control.** ADOPT-TONIGHT [S7][S14][S15][S16][S17][S22][S25].
1. The accessible name comes from visible text (`configuration.label`, `Label` title). Custom glyphs inside labelled controls are decorative.
2. Add a hint only when the result isn't obvious from the label (for example "Sends to your home hub").
3. Add `accessibilityInputLabels` when the visible label is 3 words long, or when people may call the action something else. The visible label comes first, then the aliases. Apple asks for labels "in descending order of importance" [S17], and WCAG 2.5.3 wants the visible words in the name, "at the start" as best practice [S50] (secondary). So "Mark False Alarm" gets ["Mark False Alarm", "False Alarm"], and "I'm On It" gets ["I'm On It", "Acknowledge"]. X35 lists "Acknowledge" first; this note recommends the visible label first.
4. Under `accessibilityShowBorders`, quiet buttons get a 1.5 pt outline, icon buttons a circle and choice cards a border. Never use `UIAccessibility.buttonShapesEnabled`, which is deprecated in 26.1 and would break the zero-warnings rule [S34].
5. Use the large content viewer only on elements whose Dynamic Type is deliberately clamped [S16]. Tonight that is only the live badge, which clamps at xxxLarge (07 R4, X31). The live-view bar as a whole isn't capped: at accessibility sizes it wraps to two lines and never truncates (10 R18). Its Stop button grows with Dynamic Type, so it doesn't need the viewer.
6. Custom controls that can't inherit semantics use `accessibilityRepresentation`.
7. A button that toggles adds `.isToggle` [S26].

**Check:** the `performAccessibilityAudit()` lane passes with no issues for `.sufficientElementDescription`, `.trait`, `.contrast`, `.dynamicType` and `.textClipped` [S34].

**R7. Toggles.** ADOPT-TONIGHT [S3][S14]. HIG and Apple's documented accessibility inheritance; the pending and turn-off-immediately rules are Reasoning (privacy first).
- `DebbieSwitchStyle` is used only in list rows. Outside lists, use `DebbieToggleCardStyle`.
- Both are `ToggleStyle`s on `Toggle`, never hand-rolled views, so VoiceOver gets switch semantics for free.
- State is shown by position and shape plus text, never colour alone. When On/Off Labels is on, the switch shows Debbie's own on and off glyphs: a line for on and a circle for off, as the system switch does [S51].
- Read the setting as `UIAccessibility.isOnOffSwitchLabelsEnabled` and observe `UIAccessibility.onOffSwitchLabelsDidChangeNotification` [S34]. One `@Observable` in the design-system module does this and publishes it, together with Show Borders and Reduce Bright Effects, as Debbie's own environment value at the app root. Switches then redraw live, and tests can set the value (R4). The pattern compiles against the local SDK [S45]. The C name in the first draft, `UIAccessibilityIsOnOffSwitchLabelsEnabled()`, doesn't compile in Swift [S34].
- Settings sent to the hub show "pending" until the hub confirms, and revert with an explanation on failure.
- **Turning live view off never waits.** The resident's off switch takes effect in the UI at once, and is never disabled, never confirmed and never delayed by sending.

**R8. No segmented control tonight.** ADOPT-TONIGHT. Two big, labelled choices beat a small segmented control for a non-technical installer [S2][S7].
- Role choice uses two `DebbieChoiceCard`s: large hit targets, a description line each, and `.isSelected`. Reasoning.
- If a segmented control is ever needed: at most 5 segments, text only, equal widths, noun labels, selection only [S4].
- If a tab-like picker is ever needed after the move to Xcode 27, `TabsPickerStyle` makes VoiceOver say "tabs" [S38]. A system picker style is the system look, so Debbie would draw its own control and give it that meaning through `accessibilityRepresentation` (LATER).

**R9. Text field.** ADOPT-TONIGHT. `TextFieldStyle` has no public customisation point (F3) [S34], and these are the HIG text-field rules [S5][S18].
- `DebbieTextField` wraps `TextField` with `.textFieldStyle(.plain)` and draws its own border, label and error. Never `.roundedBorder` or `.squareBorder`: they are the system look, and the iOS 27 SDK soft-deprecates them [S38].
- A persistent label sits above the field. The placeholder is only an example ("Sam's iPhone").
- `.submitLabel(.done)`, `.textContentType(nil)`, autocorrection off. Limit to 32 characters; Reasoning, to be confirmed against `docs/CONTRACTS.md`.
- Validate on submit only.
- On error: show the inline message, set `@FocusState` back to the field, and post an announcement.

**R10. Progress.** ADOPT-TONIGHT [S6][S34].
- `DebbieProgressStyle` provides `.spinner` (indeterminate, circular) and `.bar` (determinate, linear). A view never switches between the two. The live-view limit has its own third component, `DebbieCountdownRing` (below).
- Every indicator has a specific line: "Waiting for the laptop to confirm…", "Sending 12 of 40 readings".
- Use determinate whenever a count is known.
- The pairing wait and the live-view connect show "Cancel" after 10 s.
- The 5-minute live-view limit shows `DebbieCountdownRing` beside the countdown text ("4:12 left", `monospacedDigit()`, 10 R18). Not `ProgressView(timerInterval:)`, which can't take a custom style [S42].
  - The ring, the text and the VoiceOver value all come from one `TimelineView(.periodic(from: start, by: 1))` date. So our code makes no per-second state updates, and everything is right again the moment the app returns to the foreground.
  - The ring steps once a second with no animation. Reasoning: one step is 1/300 of the circle, about 0.25 pt on a 24-pt ring, which is too small to need smoothing. With no animation, Reduce Motion changes nothing, and no `.linear` curve is needed outside `Motion.swift` (03 R3).
  - At one minute left the text becomes "1 minute left" and one announcement posts (10 R19). The ring keeps its colour, because colour isn't the signal.
- Under Reduce Motion the spinner still turns. Reasoning: "keep progress indicators moving" [S6] outranks the setting for a small, non-spatial indicator. Re-check against 03 Motion.

**R11. Destructive and serious actions.** ADOPT-TONIGHT. Confirm an uncommon action that can't be undone [S9]. Present the confirmation as an action sheet, because it confirms an action the person chose [S39]. Privacy-protective actions never get friction (Reasoning). Approving a laptop is serious but not destructive, so a review step replaces a dialog (Reasoning).
- **Unpair:** `Button(role: .destructive)` opens a system `confirmationDialog`, which is an action sheet on iPhone [S39][S47].
  - Title: "Unpair this iPhone?"
  - Message: "Debbie will delete this phone's keys. You'll need to pair again."
  - Buttons: "Unpair" with `role: .destructive`, and "Cancel".
  - The destructive style follows HIG Action sheets: "Use the destructive style for buttons that perform destructive actions" [S39]. Apple's own `confirmationDialog` example does the same for a deliberately chosen "Empty Trash" [S47]. HIG Alerts' rule against the destructive style for a chosen action [S9] is written for alerts, and Debbie shows no alert here.
- **"Mark False Alarm"** opens the same kind of dialog, with 10 R10's copy:
  - Title "Mark as a false alarm?" and message "This tells the home hub that nothing was wrong."
  - Buttons "Mark False Alarm" (default role, not destructive, because no data is destroyed) and "Cancel".
  - Why confirm when it isn't destructive: a mis-tap under stress would label a real fall as false and feed the hub's tuning (10 R10). It also can't be taken back, because the acknowledgement contract carries only `alert_id`, `acked_at` and `false_alarm` (docs/CONTRACTS.md, `ack`). An undo banner instead would be a view that auto-dismisses on a timer, which the HIG asks apps to minimise [S7]. One confirmation is the smaller cost.
- **Stop live view** and **turning live view off** are single taps with no dialog.
- **Approve laptop:** a review screen shows the laptop's name, with primary "Approve" and a Cancel in the leading position of `DebbieSheetHeader` [S10].

**R12. Hold-to-confirm.** LATER. It's a custom gesture. The HIG says a custom gesture must be discoverable and "Not the only way to perform an important action" [S8], and that gestures need onscreen alternatives [S7]. Touch Accommodations change hold timing system-wide and a custom gesture can't follow them [S30], and WCAG asks for activation on release [S28]. The system dialog (R11) meets tonight's need.
- If built, use it only for Unpair, as an alternative skin over R11.
- Visible instruction in the label: "Hold to Unpair".
- Build it as a `DragGesture(minimumDistance: 0)` state machine, not a `LongPressGesture`, which succeeds while the finger is still down (F5) [S44]:
  1. **Holding:** touch-down starts a ring that fills over 1.5 s, timed from the touch-down.
  2. **Armed:** at 1.5 s the label becomes "Release to Unpair" and 04 R15's latch haptic plays once (`.impact(weight: .medium)`).
  3. **Fire:** lifting while armed and inside the control's frame runs the action. This follows WCAG 2.5.2, where the action happens on the up-event inside the element [S28].
  4. **Cancel:** lifting before the ring is armed, or the finger leaving the control's frame at any time, cancels. The ring springs back with 03's `state` token.
  - The cancel boundary is the control's own frame, at least 56 pt tall (R3), not a fixed distance. Reasoning: it matches WCAG's "inside the element" rule and tolerates a tremor better than `LongPressGesture`'s 10 pt.
- Accessible path: the control's default accessibility action, `.accessibilityAction { presentDialog = true }`, opens R11's dialog. VoiceOver, Switch Control, Voice Control and Full Keyboard Access activate through that action, so none of them needs the hold (Reasoning; confirm with Full Keyboard Access on device, R13).
- The control renders as the plain R11 button when `accessibilityVoiceOverEnabled`, `accessibilitySwitchControlEnabled` or `AccessibilitySettings.prefersActionSliderAlternative` (26.1+) is true. There is no Full Keyboard Access check, because no public API reports it (F4) [S34].

**R13. Focus and assistive navigation.** ADOPT-TONIGHT [S17][S22][S23].
- Read-only status elements (the status header readouts, the step indicator) use `accessibilityRespondsToUserInteraction(false)`.
- Multi-action rows expose named actions (Tab-Z in Full Keyboard Access).
- `AccessibilityFocusState` moves VoiceOver focus only for a newly arrived urgent alert.
- Text-field focus moves only after a submit error.
- **Check**, in two parts, because Full Keyboard Access and Voice Control can't run unattended. Only the Settings app turns them on, `simctl ui` can't [S46], and Voice Control needs speech.
  - (a) Automated, in the test lane:
    - Each multi-action component takes its named actions and input labels from one array (for example `AlertRowActions.all`), which its view maps to `.accessibilityAction(named:)` and `accessibilityInputLabels`. A unit test asserts the names, their order, and that each input-label list starts with the visible label (R6.3).
    - `performAccessibilityAudit` runs with the iOS audit types (F4). It covers traits, hit regions, descriptions, contrast, Dynamic Type and clipping, but not custom actions.
    - There is no Tab-key traversal test. On iPhone, Tab doesn't move focus between buttons without Full Keyboard Access: in the probe, `typeKey(.tab)` gave no element focus [S46].
  - (b) On device, on the owner's morning checklist (MORNING_REPORT §4):
    - With a hardware keyboard and Full Keyboard Access on, Tab through each 5.1 flow. Press Tab-Z on an alert row and check both named actions. Check that the cursor hugs each capsule (R4).
    - With Voice Control on, say "Show names", then "Tap Mark False Alarm" and "Tap Acknowledge".

**R14. Liquid Glass on floating controls only.** LATER, or adopt with Topic 2 if the deployment target is iOS 26 or later.
- Content-layer buttons use Debbie's opaque styles, and only `.primary` is mint (R1, HIG Branding [S40]). Reasoning: brand identity and stable contrast, since glass tint now varies by user setting in iOS 27 [S29].
- Over the live video, Stop and Keep Watching may use `glassEffect(.regular.interactive(), in: .capsule)` inside `DebbieButtonStyle`, availability-gated to iOS 26. Use tint only to convey meaning [S27].
- Never use system `.glass` styles for primary actions [S2].

**R15. Availability floor.** ADOPT-TONIGHT. This keeps the components independent of the minimum-iOS decision (brief §7), now iOS 26.0 (X18).
- **Compiled, not assumed** [S45]. A probe used every API in R1–R13: the styles, `.contentShape(.interaction, …)` and `.contentShape(.accessibility, …)`, the countdown ring, the On/Off Labels observer, `confirmationDialog`, input labels, named actions, and the chrome rows. It was type-checked against the local iOS 26.5 SDK in Swift 6 mode.
  - At `-target arm64-apple-ios26.0`: 0 errors and 0 warnings.
  - At `ios17.0`: the only error is `safeAreaBar` (`DebbieTopBar`), which is iOS 26.0.
  - The first draft's `.contentShape(.focusEffect, …)` fails at both targets.
- With X18's iOS 26.0 floor, only two APIs need `if #available`: `accessibilityReduceHighlightingEffects` (26.4) and `prefersActionSliderAlternative` (26.1).
- If the floor ever drops below 26, the iOS 26.0 items also need checks. These are `ButtonRole.confirm` and `.close`, `buttonSizing`, the glass styles and `safeAreaBar`, with `safeAreaInset(edge: .top)` as `DebbieTopBar`'s fallback.
- Wrap each in one helper view or modifier in the design-system module, never at call sites.

## Open questions / risks
- **Custom toggle haptics.** Does a custom `ToggleStyle` lose the system switch's haptic? R1 assumes yes and adds `.selection`. Verify on device that there's no double haptic (also listed in 04).
- **Custom `ProgressViewStyle` accessibility.** Unclear whether it keeps `ProgressView`'s spoken value. Check with Accessibility Inspector on first build (R1 note).
- **Show Borders vs Button Shapes naming.** The SDK documentation says "Show Borders" [S15][S34], and MacRumors says "Display Borders" [S36]. The iOS 27 user guide page for display colours doesn't mention the setting [S51]. Low risk, since the API is what matters. Check the label on the demo iPhone.
- **`prefersActionSliderAlternative` meaning.** Its link to "Prefer Single-Touch Actions" is inferred (F5). It only matters if R12 is built.
- **Older-user sizes.** Resolved by lead decision X21, adopted in R3 (44, 48, 56, 64 and 96 pt). One gap stays open: X21 keeps Pair and Approve at 56 pt, where 07 R12 lists them at 64 pt. R3 records the reasoning, and the lead confirms it in CRAFT.md.
- **Swipe-back with custom chrome.** X44's bridge brings back the edge swipe but not iOS 26's full-width content swipe [S46]. The bridge also sets a delegate on a recognizer whose header says to use it "only … to set up failure requirements" [S34], so a future iOS could break it. The UI test in R1 catches that. Record the lost content swipe in the X44 DECISIONS entry.
- **Labels in other notes.** 10 R9's "Mark as false alarm" and X14's "Send a test alert" break R5. X35 lists the alias "Acknowledge" before the visible label "I'm On It" (R6.3). The lead aligns these when writing CRAFT.md.
- **Brand colour on quiet buttons.** `.quiet` labels use `accent.text`, following 06's token roles and HIG Color (R1). If CRAFT.md reads the Branding change more strictly, `.quiet` labels become `text.primary`, and quiet buttons then need another visible cue, such as a permanent outline.
- **iPhone Duo (folding, iOS 27).** It moves system bars to a vertical axis [S31]. How a 26.5-SDK app lays out there is unknown and can't be tested without the iOS 27 SDK. It's out of scope for the demo phone unless that phone is an iPhone Duo.

## Sources
- [S1] Apple security releases — Apple Support — https://support.apple.com/en-us/100100 — updated 13 Nov 2026 (latest entry) — accessed 2026-11-14 — primary
- [S2] Buttons (Human Interface Guidelines) — Apple — https://developer.apple.com/design/human-interface-guidelines/buttons — last changed 16 Dec 2025 — accessed 2026-11-14 — primary
- [S3] Toggles (Human Interface Guidelines) — Apple — https://developer.apple.com/design/human-interface-guidelines/toggles — last changed 29 Mar 2024 — accessed 2026-11-14 — primary
- [S4] Segmented controls (Human Interface Guidelines) — Apple — https://developer.apple.com/design/human-interface-guidelines/segmented-controls — last changed 21 Jun 2023 — accessed 2026-11-14 — primary
- [S5] Text fields (Human Interface Guidelines) — Apple — https://developer.apple.com/design/human-interface-guidelines/text-fields — last changed 5 Jun 2023 — accessed 2026-11-14 — primary
- [S6] Progress indicators (Human Interface Guidelines) — Apple — https://developer.apple.com/design/human-interface-guidelines/progress-indicators — last changed 12 Sep 2023 — accessed 2026-11-14 — primary
- [S7] Accessibility (Human Interface Guidelines) — Apple — https://developer.apple.com/design/human-interface-guidelines/accessibility — last changed 9 Jun 2025 — accessed 2026-11-14 — primary
- [S8] Gestures (Human Interface Guidelines) — Apple — https://developer.apple.com/design/human-interface-guidelines/gestures — last changed 28 Oct 2026 — accessed 2026-11-14 — primary
- [S9] Alerts (Human Interface Guidelines) — Apple — https://developer.apple.com/design/human-interface-guidelines/alerts — last changed 2 Feb 2024 — accessed 2026-11-14 — primary
- [S10] Sheets (Human Interface Guidelines) — Apple — https://developer.apple.com/design/human-interface-guidelines/sheets — last changed 24 Mar 2026 — accessed 2026-11-14 — primary
- [S11] Feedback (Human Interface Guidelines) — Apple — https://developer.apple.com/design/human-interface-guidelines/feedback — undated — accessed 2026-11-14 — primary
- [S12] ButtonStyle, PrimitiveButtonStyle, ButtonStyleConfiguration.isPressed, ButtonRole.confirm, ButtonRole.close — Apple Developer Documentation — https://developer.apple.com/documentation/swiftui/buttonstyle — undated — accessed 2026-11-14 — primary
- [S13] ToggleStyle — Apple Developer Documentation — https://developer.apple.com/documentation/swiftui/togglestyle — undated — accessed 2026-11-14 — primary
- [S14] accessibilityRepresentation(representation:) — Apple Developer Documentation — https://developer.apple.com/documentation/swiftui/view/accessibilityrepresentation(representation:) — undated — accessed 2026-11-14 — primary
- [S15] accessibilityShowBorders, accessibilityShowButtonShapes, UIAccessibility.buttonShapesEnabled — Apple Developer Documentation — https://developer.apple.com/documentation/swiftui/environmentvalues/accessibilityshowborders — undated — accessed 2026-11-14 — primary
- [S16] accessibilityShowsLargeContentViewer() and accessibilityShowsLargeContentViewer(_:) — Apple Developer Documentation — https://developer.apple.com/documentation/swiftui/view/accessibilityshowslargecontentviewer() — undated — accessed 2026-11-14 — primary
- [S17] accessibilityInputLabels(_:), accessibilityAction(_:_:) — Apple Developer Documentation — https://developer.apple.com/documentation/swiftui/view/accessibilityinputlabels(_:) — undated — accessed 2026-11-14 — primary
- [S18] FocusState, focusEffectDisabled(_:) — Apple Developer Documentation — https://developer.apple.com/documentation/swiftui/focusstate — undated — accessed 2026-11-14 — primary
- [S19] contentShape(_:eoFill:), contentShape(_:_:eoFill:), ContentShapeKinds, and ContentShapeKinds.focusEffect (listed for macOS 12.0 and watchOS 8.0 only, https://developer.apple.com/documentation/swiftui/contentshapekinds/focuseffect) — Apple Developer Documentation — https://developer.apple.com/documentation/swiftui/view/contentshape(_:_:eofill:) — undated — accessed 2026-11-14 — primary
- [S20] glass, glassProminent, GlassButtonStyle, buttonSizing(_:), ControlSize.extraLarge — Apple Developer Documentation — https://developer.apple.com/documentation/swiftui/primitivebuttonstyle/glass — undated — accessed 2026-11-14 — primary
- [S21] isEnabled, accessibilityVoiceOverEnabled, accessibilitySwitchControlEnabled, AccessibilityTraits.isToggle — Apple Developer Documentation — https://developer.apple.com/documentation/swiftui/environmentvalues/isenabled — undated — accessed 2026-11-14 — primary
- [S22] SwiftUI Accessibility: Beyond the basics (WWDC21 session 10119) — Apple — https://developer.apple.com/videos/play/wwdc2021/10119/ — June 2021 — accessed 2026-11-14 — primary
- [S23] Support Full Keyboard Access in your iOS app (WWDC21 session 10120) — Apple — https://developer.apple.com/videos/play/wwdc2021/10120/ — June 2021 — accessed 2026-11-14 — primary
- [S24] Large Content Viewer — Ensuring Readability for Everyone (WWDC19 session 261) — Apple — https://developer.apple.com/videos/play/wwdc2019/261/ — June 2019 — accessed 2026-11-14 — primary
- [S25] Make your app visually accessible (WWDC20 session 10020) — Apple — https://developer.apple.com/videos/play/wwdc2020/10020/ — June 2020 — accessed 2026-11-14 — primary
- [S26] Build accessible apps with SwiftUI and UIKit (WWDC23 session 10036) — Apple — https://developer.apple.com/videos/play/wwdc2023/10036/ — June 2023 — accessed 2026-11-14 — primary
- [S27] Build a SwiftUI app with the new design (WWDC25 session 323) — Apple — https://developer.apple.com/videos/play/wwdc2025/323/ — June 2025 — accessed 2026-11-14 — primary
- [S28] Understanding Success Criterion 2.5.2: Pointer Cancellation (WCAG 2.2) — W3C WAI — https://www.w3.org/WAI/WCAG22/Understanding/pointer-cancellation.html — updated 4 Oct 2026 — accessed 2026-11-14 — secondary
- [S29] Adjust iPhone display and text settings (iPhone User Guide; iOS 27 page, compared with the iOS 26 page at …/26.0/ios/26.0) — Apple Support — https://support.apple.com/guide/iphone/adjust-iphone-display-and-text-settings-iphd6804774e/ios — undated — accessed 2026-11-14 — primary
- [S30] Adjust how iPhone responds to your touch (iPhone User Guide, iOS 27) — Apple Support — https://support.apple.com/guide/iphone/adjust-how-iphone-responds-to-your-touch-iph77bcdd132/ios — undated — accessed 2026-11-14 — primary
- [S31] SwiftUI updates — Apple Developer Documentation — https://developer.apple.com/documentation/updates/swiftui — entries through September 2026 — accessed 2026-11-14 — primary
- [S32] UIKit updates — Apple Developer Documentation — https://developer.apple.com/documentation/updates/uikit — entries through September 2026 — accessed 2026-11-14 — primary
- [S33] What's new (design guidance change feed) — Apple — https://developer.apple.com/design/whats-new/ — latest entry 6 Nov 2026 — accessed 2026-11-14 — primary
- [S34] Local iOS 26.5 SDK (Xcode 26.6): `SwiftUI.swiftinterface`, `SwiftUICore.swiftinterface` and `SwiftUICore.swiftdoc` (the `ContentShapeKinds.accessibility` documentation), `UIKit.framework/Headers/UIAccessibility.h`, `UINavigationController.h` and `UIKit.apinotes`, `Accessibility.framework/Headers/AXSettings.h`, `AXRequest.h`, `AXTechnology.h` and `Accessibility.swiftinterface`, `XCUIAutomation.framework/Headers/XCUIApplication.h`, `XCUIElement.h` and `XCUIAccessibilityAuditTypes.h`, under /Applications/Xcode.app/Contents/Developer/Platforms/iPhoneOS.platform/Developer/ — Apple — SDK 26.5 — accessed 2026-11-14 — primary
- [S35] accessibilityReduceHighlightingEffects, AccessibilitySettings.prefersActionSliderAlternative, AccessibilitySettings.showBordersEnabled — Apple Developer Documentation — https://developer.apple.com/documentation/swiftui/environmentvalues/accessibilityreducehighlightingeffects — undated — accessed 2026-11-14 — primary
- [S36] iOS 26.1 Features: Everything New in iOS 26.1 — MacRumors — https://www.macrumors.com/guide/ios-26-1-features/ — published 3 Nov 2025 (page `datePublished`) — accessed 2026-11-14 — secondary. Calls the setting "Display Borders".
- [S37] iOS 26.1 makes alarms use a slider, here's how to get 'Stop' button — 9to5Mac — https://9to5mac.com/2025/12/11/ios-26-1-makes-alarms-use-a-slider-heres-how-to-get-stop-button-back/ — published 11 Dec 2025 (the /2025/11/05/ address cited earlier 301-redirects here) — accessed 2026-11-14 — secondary
- [S38] iOS & iPadOS 27 Release Notes (SwiftUI section: 173362083, 173211711, 167448274, 179388848) — Apple Developer Documentation — https://developer.apple.com/documentation/ios-ipados-release-notes/ios-ipados-27-release-notes — undated — accessed 2026-11-14 — primary
- [S39] Action sheets (Human Interface Guidelines) — Apple — https://developer.apple.com/design/human-interface-guidelines/action-sheets — no change log on the page — accessed 2026-11-14 — primary
- [S40] Branding (Human Interface Guidelines) — Apple — https://developer.apple.com/design/human-interface-guidelines/branding — last changed 9 Sep 2026 ("Refined guidance for using brand color") — accessed 2026-11-14 — primary
- [S41] Toolbars (Human Interface Guidelines) — Apple — https://developer.apple.com/design/human-interface-guidelines/toolbars — last changed 16 Dec 2025 — accessed 2026-11-14 — primary
- [S42] init(timerInterval:countsDown:label:currentValueLabel:), init(timerInterval:countsDown:) and CircularProgressViewStyle — Apple Developer Documentation — https://developer.apple.com/documentation/swiftui/progressview/init(timerinterval:countsdown:label:currentvaluelabel:) — undated — accessed 2026-11-14 — primary
- [S43] AccessibilityTraits.startsMediaSession — Apple Developer Documentation — https://developer.apple.com/documentation/swiftui/accessibilitytraits/startsmediasession — undated — accessed 2026-11-14 — primary
- [S44] LongPressGesture and maximumDistance — Apple Developer Documentation — https://developer.apple.com/documentation/swiftui/longpressgesture — undated — accessed 2026-11-14 — primary
- [S45] Local compile probe (this review, 2026-11-14): Swift files exercising every API in R1–R13, type-checked with `xcrun swiftc -typecheck -swift-version 6` against the local iOS 26.5 SDK. Results: 0 errors and 0 warnings at `arm64-apple-ios26.0`; one error at `ios17.0` (`safeAreaBar` is iOS 26.0); `.contentShape(.focusEffect, Circle())` fails at both targets with "'focusEffect' is unavailable in iOS" — Xcode 26.6 — accessed 2026-11-14 — primary data
- [S46] Local navigation probe (this review, 2026-11-14): a SwiftUI app plus XCUITest built with Xcode 26.6 and run on a fresh iPhone 17 Simulator, iOS 26.5 runtime (`** TEST SUCCEEDED **`). It measured edge-swipe (1 % of the width) and content-swipe (35 %) pops for six chrome variants (F3 table), and checked `typeKey(.tab)` on two buttons (no element gained `hasFocus`). Also `xcrun simctl help ui` (options: appearance, increase_contrast, content_size) — accessed 2026-11-14 — primary data
- [S47] confirmationDialog(_:isPresented:titleVisibility:actions:message:) — Apple Developer Documentation — https://developer.apple.com/documentation/swiftui/view/confirmationdialog(_:ispresented:titlevisibility:actions:message:) — undated — accessed 2026-11-14 — primary
- [S48] refreshable(action:) and navigationBarBackButtonHidden(_:) — Apple Developer Documentation — https://developer.apple.com/documentation/swiftui/view/refreshable(action:) — undated — accessed 2026-11-14 — primary
- [S49] TextFieldStyle (online, iOS 27 SDK: `roundedBorder` and `squareBorder` under "Deprecated", `bordered` added) — Apple Developer Documentation — https://developer.apple.com/documentation/swiftui/textfieldstyle — undated — accessed 2026-11-14 — primary
- [S50] Understanding Success Criterion 2.5.3: Label in Name (WCAG 2.2) — W3C WAI — https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html — undated — accessed 2026-11-14 — secondary
- [S51] Change display colors on iPhone to make it easier to see what's onscreen (iPhone User Guide, iOS 27; "Use symbols for on/off switches") — Apple Support — https://support.apple.com/guide/iphone/change-display-colors-iph3e2e1fb0/ios — undated — accessed 2026-11-14 — primary

## Review log
Independent review of this note, resolved 2026-11-14. Evidence is in the sections named, with probe details in [S45] and [S46].

| ID | Severity | Resolution |
|---|---|---|
| B1 | high | **Fixed.** F3 and R4 now use `.contentShape(.accessibility, …)` (iOS 17) for the assistive cursor and `.contentShape(.interaction, …)` for hit-testing. `.focusEffect` is `@available(iOS, unavailable)` and fails to compile at iOS 17.0 and 26.0 [S34][S45]. WWDC21 10120 confirms the Full Keyboard Access cursor follows the accessibility path [S23]. R15 now rests on an actual compile: 0 errors and 0 warnings at iOS 26.0, and only `safeAreaBar` fails at iOS 17.0 [S45]. Only the Settings app can turn Full Keyboard Access on, so the Simulator cursor check moved to the on-device pass (R4, R13). |
| B2 | medium | **Fixed.** F3 quotes both limits: date-relative progress views take no custom style, and the circular style falls back to indeterminate [S42]. R1 adds `DebbieCountdownRing`, with its states, Reduce Motion behaviour, accessibility value and `.updatesFrequently`. R10 is rewritten. The ring uses `TimelineView(.periodic(from:by:))` rather than one linear animation, because it is right after a return from the background and needs no `.linear` curve outside `Motion.swift` (03 R3). |
| B3 | medium | **Fixed.** R1 adds `DebbieTopBar`, `DebbieBackButton`, `DebbieSheetHeader` and `DebbieRowStyle` (Debbie's chevron, no `NavigationLink` in a `List`), named after lead decision X44. It also lists what isn't built: no tab bar (X19) and no pull to refresh, because `.refreshable` shows the system spinner [S48] and the HIG asks for automatic updates [S6]. Swipe-back was measured on the 26.5 Simulator [S46]. Hiding the back button or the bar disables both the edge swipe and iOS 26's content swipe, and X44's bridge restores only the edge swipe. R1 now requires a swipe-back UI test. The header caveat and the lost content swipe are in F3 and Open questions. |
| B4 | medium | **Fixed.** R11 now cites HIG Action sheets as the page that governs `confirmationDialog` [S39]. It keeps the destructive "Unpair", per Action sheets and Apple's `confirmationDialog` example [S47], and explains that the Alerts rule applies to alerts. The false-alarm dialog stays, without the destructive role, for three reasons. A mis-tap would mislabel a real fall and feed the hub's tuning (10 R10). The `ack` contract can't un-mark a false alarm (docs/CONTRACTS.md). An undo banner would be a time-boxed element [S7]. |
| B5 | medium | **Fixed.** The labels are now "I'm On It" (X35) and "Mark False Alarm". R5 now says: at most 3 words and verb-first; dialogs aim for 1–2 words, with a reasoned exception for "Mark False Alarm"; and an explicit allowlist ("Done", "I'm On It") with reasons, plus the lint. R6.3 puts the visible label first in the input labels [S17][S50]. It flags the labels in 10 R9 and X14 that the lint would fail. |
| B6 | medium | **Fixed.** "What changed" quotes the three iOS 27 release-note items with their radar numbers, each marked as needing Xcode 27 [S38]. F3 is updated. R9 requires `.plain` and never `.roundedBorder`. R2 and R3 stop reading `controlSize`, `buttonSizing` and `buttonBorderShape`, and re-apply Debbie's keys at sheet roots. R8 notes `TabsPickerStyle`. |
| B7 | medium | **Fixed.** The Branding change (9 Sep 2026) is flagged in the Summary and in "What changed" [S40][S33]. R1's "Variant colours" limits mint fills to `.primary` and state indicators. `.secondary` and `.destructive` get neutral fills, and `.quiet` gets none, with reasons and 06's measured ratios. R14 is aligned. How strictly to read the change for `.quiet` labels is in Open questions. |
| B8 | medium | **Fixed.** R3 adopts lead decision X21's five tiers (44, 48, 56, 64, 96 pt), which carry 07's older-adult evidence. R1's sizes, the Summary and the check are updated. The one remaining difference, Pair and Approve at 56 pt where 07 R12 says 64, is reasoned in R3 and listed in Open questions. R6.5 now says the live bar is not capped (10 R18). Only the live badge clamps (07 R4, X31) and gets the large content viewer, so 09 and 10 agree without editing 10. |
| B9 | medium | **Fixed.** `.startsMediaSession` is removed from R1. F4 quotes its documented purpose, silencing VoiceOver during a media session [S43], and says Debbie never uses it. R1's lint pattern catches it. |
| B10 | low | **Fixed.** F4 and R7 use `UIAccessibility.isOnOffSwitchLabelsEnabled` and `UIAccessibility.onOffSwitchLabelsDidChangeNotification` (apinotes verified [S34]). One `@Observable` publishes Debbie's own environment value, a pattern that compiles [S45]. R4's matrix adds On/Off Labels on. The glyphs follow Apple's user guide [S51]. |
| B11 | low | **Fixed.** F4 lists only the iOS audit types, and quotes the header guard that limits action and parent/child audits to macOS and Mac Catalyst [S34]. R13 covers named actions with unit tests and the on-device pass. |
| B12 | low | **Fixed.** R12 is now a `DragGesture(minimumDistance: 0)` state machine: hold, armed, fire on release inside the frame, cancel when leaving the frame. F5 documents how `LongPressGesture` behaves [S44]. There is no Full Keyboard Access detection, because none exists (F4). The default accessibility action opens R11's dialog, and the plain button shows under VoiceOver, Switch Control or `prefersActionSliderAlternative`. The time-boxed citation is replaced by HIG Gestures' custom-gesture rule in the Summary, F5 and R12 [S8]. |
| B13 | low | **Fixed.** In R4, press-in and release both use 03's `press` token, as 03 R1 and X13 say, and the pressed tokens follow X36. Reduce Bright Effects now has a defined press state: no lightening, a 2 pt inset outline, and the scale unless Reduce Motion is on. The snapshot matrix adds Reduce Bright Effects on, through Debbie's environment value, because the SwiftUI value is get-only [S34]. |
| B14 | low | **Fixed.** F4 cites the SDK documentation for "Show Borders" and records MacRumors' "Display Borders". S36 is now dated 3 Nov 2025. S37 has the 301 target URL, its 11 Dec 2025 date and its real title. |
| B15 | low | **Fixed.** The Summary and "What changed" move HIG Sheets (24 Mar 2026) to iOS 26.x, since iOS 26.4 shipped that day [S1]. F3 states that `.extraLarge` resolves to `.large` on iPhone and that WWDC25's remark is in its macOS passage [S20][S27]. R3 forbids `controlSize` for sizing. |
| B16 | low | **Fixed, one suggestion rejected with evidence.** R13's check is split into (a) automated unit tests over each component's action and input-label arrays plus the iOS audit, and (b) an on-device Full Keyboard Access and Voice Control pass on the owner's checklist. The suggested Tab-driven XCUITest is rejected: on the iOS 26.5 Simulator, `typeKey(.tab)` gave no button focus, and `simctl` can't turn on Full Keyboard Access or Voice Control [S46]. |
