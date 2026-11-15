# 16 Tab navigation, the corner Settings button and icon motion
_Researched 2026-11-14, 16:00–16:35 EST, after the owner's 15:44 design direction. Toolchain: Xcode 26.6 (17F113) / iOS 26.5 SDK on macOS 26.2. Current public iOS is 27.2.1 (9 Nov 2026); iOS 27 SDK features need Xcode 27, which this Mac can't run (03 [S1], 09 F1). Everything below builds with the iOS 26.5 SDK. The system tab bar was measured on an iOS 26.5 Simulator (F2)._

## Questions answered
> (The lead's assignment, condensed.) Research the owner's redesign: a white canvas, a custom floating bottom tab bar with four tabs (Home · Live · History · Devices), a simple Settings button (a gear) in the top-right corner, and custom icons with custom animations on every button. Answer: (1) tab bars on iOS 26: purpose, tab count, labels, selected state, the floating Liquid Glass bar and minimising, and what a custom bar must keep (placement, hit size, VoiceOver, Large Content Viewer); (2) how featured apps structure a calm tab-based app (large titles, corner buttons, white canvas, card density, whitespace), observable patterns only; (3) tab-switch motion: cross-fade or slide, selection-indicator motion, interruptibility, Reduce Motion; (4) icon animation, custom per-icon keyframes that respect Reduce Motion, and whether tab switches play a haptic; (5) the corner Settings button: placement, size, label, sheet or push; (6) a white canvas with tinted cards: contrast and separation. End with exact rule text for CRAFT.md. (Task from the lead, 15:5x; owner's words: "clean apps like airbnb with a bar at the bottom, simplistic settings button in the corner, and minimal clean features on each tab… custom icons and animations… even for switching between tabs.")

## Summary
- **Four tabs, labelled Home, Live, History and Devices.** The HIG asks for "the appropriate number of tabs", single-word labels, no overflow, and tabs that are never disabled or hidden [S1]. Debbie's 13-pt minimum label fits four tabs at 320 pt wide up to 15 pt. With five tabs it fits only at 11 pt, so a fifth tab would break CRAFT T1 or truncate (F1, measured). This reverses lead decision X19 and note 02 R10 ("no tab bar"); the owner chose it.
- **What the system bar is (measured on iOS 26.5, iPhone SE):**
  - A floating Liquid Glass capsule, 333 × 62 pt, sitting 21 pt from the sides and the bottom.
  - Four items, each 94 × 54 pt, with ≈ 10-pt labels and ≈ 22-pt glyphs. The glyphs are filled in every state.
  - The selected tab shows a tinted glyph and label plus a grey item-sized capsule.
  - At AX5 the bar stays the same size and the labels stay visible (F2). That is why custom bars need the Large Content Viewer [S26][S33].
- **Selected state for Debbie:** four cues, so colour is never the only signal.
  - The glyph turns from outline to filled. The HIG suggests a fill "to indicate selection" [S10].
  - A `mint.tint` indicator capsule sits behind the item.
  - The glyph and label take `accent.text` (5.68:1 on the indicator).
  - The item gets the `.isSelected` trait.
- **Never minimise.** The HIG ties minimise-on-scroll to bars with an accessory, such as Music's MiniPlayer [S1]. Debbie has no accessory, and `tabBarMinimizeBehavior` only drives the system `TabView` [S30].
- **Tab-switch motion.**
  - **What Apple does (measured):** a 0.10–0.15 s cross-dissolve of the content, with no slide and no visible zoom. The tapped item shows a glass "lens" that settles into the highlight in ≈ 0.13 s, and the highlight doesn't slide on a tap (F5). It moves only when you press and drag across the bar [S43].
  - **For Debbie:**
    - The content cross-fades with `tabFade` = `.easeInOut(duration: 0.15)`. Nothing drifts or slides.
    - The selection indicator slides on `tabSelect` = `Spring(duration: 0.30, bounce: 0)`, the same vocabulary as a segmented control [S19]. It reaches 95 % at 0.227 s, settles by 0.50 s, and is interruptible.
    - Under Reduce Motion the indicator cross-fades in place.
- **Icon animations.** Use `keyframeAnimator(initialValue:trigger:)`. Re-triggering keeps velocity, and `KeyframeTimeline` makes every effect unit-testable (verified locally) [S32][S36][S38].
  - Each effect is ≤ 0.6 s, starts in the same frame as the tap and ends exactly at rest.
  - Scale stays within 0.85–1.15, travel within 4 pt and rotation within 15°. Rotationally symmetric glyphs may turn further.
  - Effects play only on a person's tap. Reduce Motion turns them off.
  - The HIG asks for symbol animations that are "judicious", "serve a clear purpose" and suit the app's tone [S10].
- **No haptic on tab switches.** Apple's tab-press feedback, `SensoryFeedback.press(.tab)`, "Only plays feedback on visionOS" [S34][S36]. On iPhone the HIG lists switches, sliders and pickers as the controls that play haptics [S12], and it warns that frequent haptics become "tiresome" [S12].
- **Large Content Viewer: yes, on every tab item and on the corner button.**
  - Clamp their glyphs and labels at `.xLarge` and never hide the labels; the system keeps them (F2).
  - Add `accessibilityShowsLargeContentViewer { … }` (iOS 15). Apple's docs name tab bars as the use case [S33].
  - Exempt only those elements from the `.dynamicType` audit, through the audit's issue handler [S29][S36].
- **VoiceOver.** Put the documented `.isTabBar` trait on the bar container [S33][S36].
  - It may not announce "tab, n of N" in SwiftUI. An Apple engineer called this "may be a bug" (FB19401153) [S41], and the Simulator can't show it [S42].
  - So check it on a device. Fall back to the value "Tab n of 4" only if that check fails, never both.
- **Corner Settings button.**
  - The system draws a 44-pt Liquid Glass circle at the top trailing corner (F2). Debbie's version is the same circle, aligned to Debbie's 20-pt content margin, labelled "Settings", on every tab root.
  - It opens Settings in a **sheet**, not a push. Settings is a "distinct, narrowly scoped task" [S14], a modal "is temporary and self-contained" so it may cover the tab bar [S1], and pushing it into one tab would duplicate it across tabs [S24].
  - Inside the sheet, use one path at most one level deep [S14]. Close goes on the leading edge [S13]. Swipe down also dismisses [S13].
- **White canvas.**
  - Apple's own pattern is a white primary background with "secondary" grouping surfaces [S4]. Debbie's new light card colour (`#F3F7F5` on `#FFFFFF`) is fainter than Apple's pair: ΔL\* 3.1 against Apple's 4.4.
  - The same holds in every appearance. The worst is dark, at 5.6 against Apple's 10.3 (F9, measured).
  - Candidate surface tokens below meet Apple's separation and keep every C2 pairing.

## Findings

### F1. What a tab bar is for, and the iOS 26 floating bar (HIG and WWDC25)
- **Purpose.** "A tab bar lets people navigate between top-level sections of your app… quickly switch between sections of the view while preserving the current navigation state within each section." "Use a tab bar to support navigation, not to provide actions." [S1] "The tab bar is one of the most persistent parts of your app." [S19] TabViews "optimize for switching from section to section, maintaining context within each section" [S20].
- **Count.** "Use the appropriate number of tabs required… it's generally easier to navigate among fewer tabs." "Avoid overflow tabs": when space runs out, "the trailing tab becomes a More tab" [S1]. In UIKit, six or more view controllers show "only the first four items plus the standard More item" [S35]. So five is the iPhone ceiling.
- **Measured fit of Debbie's labels** (SF Pro Semibold widths computed on this Mac [S38]). "Devices" is the widest label at 49.8 pt at 13 pt and 56.5 pt at 15 pt.
  - On a 320-pt-wide screen (iPhone SE with Display Zoom, CRAFT §7) with 20-pt margins and a 4-pt inset, each item gets 68 pt with four tabs and 54 pt with five.
  - Four tabs fit labels up to 15 pt with padding. Five tabs fit only at about 11 pt ("Devices" 43.1 pt), which CRAFT T1 bans (`.caption2`).
  - Reasoning: four tabs is the largest count that keeps Debbie's 13-pt floor at every supported width.
- **Labels.** "Include tab labels… Use single words whenever possible." [S1] WWDC22: "Each tab communicates your app's menu of options… sections should be meaningful and descriptive"; "use clear and concise labels" [S24].
- **Never disable or hide.** "Don't disable or hide tab bar buttons, even when their content is unavailable… If a section is empty, explain why its content is unavailable." [S1]
- **Visible everywhere except under a modal.** "Make sure the tab bar is visible when people navigate to different sections… The exception is when a modal view covers the tab bar, because a modal is temporary and self-contained." [S1] Also: "avoid hiding or removing the tab bar throughout your navigation" and, when pushing, "the tab bar remains persistently anchored to the bottom of the screen" [S24].
- **No tab-jumping.** "Transporting someone to another tab by tapping on an element within a view is jarring and disorienting. Never force someone to change tabs automatically." [S24]
- **Home tabs.** "Home tabs disrupt an app's hierarchy" when they duplicate other tabs' functions: "Avoid duplicating features and merging them into a single tab." [S24] Reasoning: Debbie's Home has its own job (status and open alerts), so it's a section, not a catch-all, provided it doesn't repeat Live, History or Devices actions.
- **Glyphs.** "Prefer filled symbols or icons for consistency with the platform." [S1] "An iOS tab bar prefers the fill variant"; the fill variant suits "places where you use an accent color to communicate selection", and you can "use the fill variant to indicate selection" [S10]. When you supply outline symbols, "the system automatically selects the filled variant when it appears in a tab bar" [S30][S25].
- **Badges.** These are "a red oval containing white text… Reserve badges for critical information." [S1]
- **Colour.** Tint goes on "the selected state in the tab bar" [S22]. Use the accent colour "for… an icon for the selected tab in a tab bar" [S16]. "Avoid applying a similar color to tab labels and content layer backgrounds." [S1]
- **iOS 26 floating bar (new in iOS 26).** "A tab bar floats above content at the bottom of the screen. Its items rest on a Liquid Glass background." [S1]
  - Minimising is described for "tab bars with an attached accessory, like the MiniPlayer in Music" [S1]. The API is `tabBarMinimizeBehavior(_:)` with `.onScrollDown` [S20][S30].
  - A dedicated search tab can sit "at the trailing end" [S1][S20].
  - On iPhone the bar has "a new, more compact appearance" [S21].
- **Reviewer's view (secondary).** In iOS 26 the active tab shows "a colored glyph… plus a highlighted shape". Long-pressing turns it into a "selection bubble" you can slide across the bar ("pretty cool, it's pretty useless"). Minimised bars carry "intrinsic discoverability issues" [S43].

### F2. Measured: the system tab bar and corner button on iOS 26.5 [S37]
Probe: a plain SwiftUI `TabView` with four `Tab`s ("Home", "Live", "History", "Devices"; outline system symbols, which this throwaway probe may use because it's outside the app). Each tab is a `NavigationStack` with a large title, a `List` and one `ToolbarItem(placement: .topBarTrailing)` gear. It ran on a new iPhone SE (3rd generation) Simulator, iOS 26.5, light mode. XCUITest logged element frames and tapped Live, History, Devices and Home 3.9 s apart while `simctl io recordVideo` recorded. Screenshots were taken at the default size and at AX5. The probe device was deleted afterwards. Evidence: `Design/reviews/research/16-tab-probe/`.

| What | Measured (points, 375 × 667 screen) |
|---|---|
| Bar capsule (visible glass) | x 21.0–354.0, y 584.0–646.0 → **333 × 62 pt**, **21 pt** from each side and from the bottom (SE has no home indicator) |
| `UITabBar` accessibility frame | (0, 584, 375, 83): full width, to the screen bottom |
| Item buttons | **94 × 54 pt** each at x = 25, 102, 179, 256 (pitch 77, frames overlap 17 pt), y 588–642: 4 pt inside the capsule |
| Selected highlight | The item frame (94 × 54 capsule), light grey fill (sRGB grey 229–236 on 254 glass) |
| Glyphs | Filled in **both** states; ≈ 22–23 pt (clock ⌀ 22.5 pt, house 26.5 × 22.5 pt); tinted only when selected |
| Labels | ≈ 10 pt (cap height 7 pt; "Devices" 36.5 pt wide), below the glyph |
| At AX5 (`accessibility-extra-extra-extra-large`) | **Bar, glyphs and labels unchanged**: labels still shown, still ≈ 10 pt; the list text grew about 3×; rows under the bar dissolve in the scroll edge effect |
| Scrolling (no accessory, default behaviour) | Bar frame unchanged: no minimise |
| Top-trailing toolbar button | Visible **44-pt glass circle**, x 315–359 (16 pt from the edge), centred at y ≈ 42 in the 44-pt row under the 20-pt status bar; accessibility frame 36 × 36 |
| Large title | Text inset ≈ 16 pt (the "H" ink starts at 18 pt), below the toolbar row |
| VoiceOver-facing values | Items are `tabBars.buttons` with `isSelected` true on the current one and an empty value |

The Simulator can't play haptics, and its accessibility tools don't show the "tab" role [S42], so those items are covered by F3 and F7. Debbie Max wasn't measured (open question 1).

### F3. What a custom bar gives up, and must rebuild
- **Given up.** `tabBarMinimizeBehavior` and accessories drive only the system `TabView` [S30] (02 §7). On iPhone Duo's outer display "the system places toolbars and tab bars on the side", but custom bars stay where they are (01 [S56][S57]). That move needs the iOS 27 SDK, so it is LATER.
- **Large Content Viewer.**
  - What the system does: "we don't want to grow the tab bar because that would leave very little room for the main content… we allow you to long press on that button to see a larger version… drag your finger along the bottom bar… let go and the app act as though you tapped the button." It is "only enabled for the Accessibility text sizes", and "if you've got a custom bar… you'll need to implement some API" [S26].
  - The SwiftUI API `accessibilityShowsLargeContentViewer(_:)` (iOS 15; `@ViewBuilder` in our SDK, `@ContentBuilder` online [S36]). Apple: "Rely on the large content viewer only in situations where items must remain small… For example, buttons in a tab bar remain small… views that have their Dynamic Type size constrained with dynamicTypeSize(_:) may require a large content view." [S33]
  - The UIKit header adds: "users with an accessibility content size category can long press on a tab bar button to view a larger version" [S36].
  - The general rule it is an exception to: "Increase the size of meaningful interface icons as font size increases", and "Keep text truncation to a minimum" [S7]. Reasoning: a clamped bar plus the viewer is allowed because Apple names tab bars as the case where items "must remain small" [S33].
- **VoiceOver role and position.**
  - UIKit's `UIAccessibilityTraitTabBar` is "Used when a view or accessibility container represents an ordered list of tabs. The object with this trait should return NO for isAccessibilityElement" [S36].
  - SwiftUI has `AccessibilityTraits.isTabBar` (iOS 17.0, verified in local SDK): "The accessibility element is a tab bar" [S33][S36].
  - In August 2025 a developer reported that `.isTabBar` with `accessibilityElement(children: .contain)` didn't make VoiceOver say "tab one of two". Apple's Frameworks Engineer replied "this may be a bug" (FB19401153); no fix is recorded [S41] (secondary).
  - Bas Broek's UIKit write-up: Accessibility Inspector "doesn't add the internal 'tab' trait… it does actually work… only on device" [S42] (secondary).
  - Reasoning: only a device VoiceOver pass can prove the role and position.
- **Custom-control principle (WWDC26).** "Consider whether people can understand the control purpose, value, actions, and feedback." [S23]
- **Audit.** `performAccessibilityAudit(for:_:)` (iOS 17) takes an issue handler. Returning true ignores an issue, for "a false positive or expected behavior" [S29][S36]. This morning a deliberate Dynamic Type cap failed the audit (PROGRESS 11:50). A clamped tab bar will raise the same `.dynamicType` issue, and the Large Content Viewer is Apple's documented answer.
- **Shape and placement.** "For phone layouts, use a capsule with extra margin to create space near the screen edge." [S19] Apply glass "directly to the control, not its inner views" [S19]. Use `.interactive()` for "custom controls or for containers with interactive elements", which makes glass react by "scaling, bouncing, and shimmering" [S20][S31].
- **Familiarity is the condition for customising.** "Ensure that details like sizing, placement, and behavior continue to preserve a familiar experience" [S16]. "Try to lean into what's already familiar… rather than reinvent the wheel." Featured apps' "navigation: the tab bar and top toolbar actions, are all native" [S22].

### F4. How featured apps structure a calm tab-based app (observable patterns only)
- **A large title per tab, with corner buttons in the toolbar.**
  - "Use a large title to help people stay oriented… a large title transitions to a standard title as people begin scrolling… and transitions back to large when people scroll to the top." [S2]
  - The trailing edge holds "important items that need to remain available" [S2]. Apple's Books puts the account avatar in the top toolbar "without this visual grouping" [S20].
  - Measured: the system places the trailing button above the large title, in the toolbar row (F2).
- **Brand lives in the content, and bars stay native.**
  - "The content layer is the best opportunity to express your brand identity… move color into the content area." NYT Cooking shows its logo "only… on the Home tab, and it fades on scroll." Gentler Streak, a 2024 Apple Design Award winner (01 F3), keeps its tab bar and toolbar native [S22].
  - Custom icons can go "anywhere… from the content view to controls" if "recognizable, consistent and… scale well to small sizes". NYT Cooking uses its own line icons "on their tab bar, top toolbars, and in-line actions" [S22].
- **A white canvas with grouped surfaces.**
  - iOS backgrounds come in a "Primary for the overall view" and "Secondary for grouping content" ladder [S4].
  - "Group related items… negative space, container shapes, or separator lines"; "Use progressive disclosure"; "Order content by relative importance" [S17].
  - Bars no longer need "extra backgrounds or borders… hierarchy should be expressed through layout and grouping" [S19].
- **Balanced tabs and succinct labels.** "The first tab of apps tend to be loaded heaviest… distribute functionality throughout your tabs." Slopes (2022 Apple Design Award, Interaction) has specific tabs whose "labels are representative of the content" [S24]. Its jury called it "as easy to navigate as a nice green run" (01 F3).
- **Airbnb (the owner's reference; describe, never copy).**
  - Airbnb's own 2025 release names an "Explore tab", "Trips tab", "Messages" and "Profile". Profile and settings sit in a tab, not in a corner gear.
  - It calls the design system "a dimensional and beautifully animated interface" [S44]. The design brief was "Fun, alive, and simple", with "a smooth animated interface with subtle intensities", and icons that are "a universal language, and they're playful" [S45] (secondary).
  - Reasoning, for Debbie: take the qualities (a white canvas, one bar at the bottom, sparse corner chrome, motion that is subtle in intensity). Never take Airbnb's icons, 3D style, Rausch colour, layouts or copy (CLAUDE.md).

### F5. Tab-switch motion: what Apple does, and the rules that bind a custom version
- **Measured on iOS 26.5** [S37]. Frame times come from the recording's variable-frame-rate timestamps (≈ 60 Hz while animating). The page background was used as a fade probe, and frames were inspected (`system-tab-switch-frames.png`, `system-tab-select-bar-frames.png`).
  - **The content cross-dissolves; it doesn't slide or zoom.**
    - Home to Live: the background goes from 252 to 215, starting 62 ms after the bar reacts, mostly done in ≈ 70 ms and settled ≈ 0.13 s after it starts.
    - Live to History: ≈ 0.10 s to 95 %, settled ≈ 0.13 s.
    - Devices to Home: 10–90 % in ≈ 0.08 s, settled ≈ 0.15 s.
    - Old and new text overlap in exactly the same positions, so there's no translation and no visible scale.
  - **The selection doesn't slide on a tap.** On the first frame of the tap, the old highlight disappears, and the new item turns blue under a larger glass lens. The lens shrinks into the resting grey capsule within ≈ 0.13 s (68.130 → ≈ 68.26 s).
- **Reported history (secondary).** iOS 18 added "a new switch transition between tabs in UITabBarController" that the poster saw in "Apple's apps (like music, shortcuts…)". The thread's accepted answer, from a DTS engineer, points to `tabBarController(_:animationControllerForTransitionFrom:to:)` [S39]. A measured write-up found "a cross-dissolve (fade-in/fade-out) animation" in iOS 18.2 [S40]. Our 26.5 measurement matches.
- **HIG motion rules that bind a custom bar** [S9]:
  - "In apps, generally avoid adding motion to UI interactions that occur frequently."
  - "Aim for brevity and precision in feedback animations."
  - "Let people cancel motion."
  - "Strive for realistic feedback motion that follows people's gestures and expectations."
  - Reasoning: a sideways drift implies the tabs can be swiped like pages. They can't, so a slide promises a gesture that doesn't exist.
- **Indicator precedent.** "Components like tab bars, segmented controls, and sidebars all signal selection, navigation, and state in consistent ways" [S19]. Liquid Glass "dynamically morphs between the controls in each context… transitions between different sections… feel fluid and seamless" [S18]. Reasoning: a short slide of Debbie's indicator stays within that vocabulary, and it answers the owner's request for a visible switch animation.
- **Retargeting.** Springs merge, retargeting with velocity kept (03 §4). With `matchedGeometryEffect`, one view must be the source: "If the number of currently-inserted views… with isSource = true is not exactly one results are undefined" [S32].
- **Reduce Motion.** Reduce "automatic and repetitive animations, including zooming, scaling, and peripheral motion"; "Replacing transitions in x-, y-, and z-axes with fades" [S6]. For Liquid Glass, Reduce Motion "disables any elastic properties for the material… automatically whenever you use the new material" [S18]. Debbie's role-choice highlight already "cross-fades in place" under Reduce Motion (CRAFT T13).
- **Spring maths** (computed with `SwiftUI.Spring` on this Mac [S38]):
  - Candidate `Spring(duration: 0.30, bounce: 0)`: 80 % at 0.143 s, 95 % at 0.227 s, settled at 0.500 s, no overshoot.
  - The working tree's `tabSlide` `(0.35, 0.15)`: 95 % at 0.206 s, settled at 0.635 s, 0.63 % overshoot. Its bounce breaks P1/03 R2 ("bounce only on a gesture's release").

### F6. Icon animation: Apple's guidance and a testable custom build
- **HIG, symbol animations** [S10]:
  - "Apply symbol animations judiciously."
  - "Make sure that animations serve a clear purpose in communicating a symbol's intent… Consider how people might interpret an animated symbol."
  - "Use symbol animations to communicate information more efficiently."
  - "Consider your app's tone when adding animations."
  - Meanings: Bounce, "an action occurred"; Scale, "attention to a selected item or as feedback when people choose a symbol"; Rotate, "imitate an object's behavior in the real world" or "a task is in progress"; Wiggle, "a call to action".
  - Draw On/Off is new in SF Symbols 7 (iOS 26) [S10].
  - Effects work on custom symbols. Layered animation needs annotated layers, and you should "Test animations for custom symbols" [S10].
- **HIG Motion:** "Consider using animated symbols where it makes sense." [S9] System controls animate their own symbols too: "UISlider… now bounces its images as the thumb reaches the ends" [S28].
- **Custom per-icon keyframes** [S32][S27][S36]:
  - `keyframeAnimator(initialValue:trigger:content:keyframes:)` (iOS 17) "Plays the given keyframes when the given trigger value changes." "If the trigger value changes while animating… the keyframes that you return define a new animation that replaces the old one. The previous velocity will be preserved." The content closure runs "on every frame", so keep it cheap.
  - `phaseAnimator(_:trigger:)` steps through phases, but its docs don't define what a re-trigger mid-sequence does. Reasoning: keyframes are the documented choice for a control people may tap twice.
  - WWDC23 calls keyframes "predefined animations… like video clips". They "can't gracefully retarget the way that springs can", so don't change keyframes mid-flight [S27].
- **Testable.** `KeyframeTimeline(initialValue:content:)` exposes `duration`, `value(time:)` and `value(progress:)` (verified in local SDK) [S36].
  - A sample 2-keyframe effect computed on this Mac: duration 0.420 s, peak scale 1.072. It ended at (1.001, −0.164°), not exactly at rest, because a spring keyframe stops when its time runs out [S38].
  - So the last keyframe needs a duration of at least that spring's settling time, or a final snap to rest.
- **Reduce Motion.** For SF Symbol effects, `symbolEffectsRemoved(_:)` (iOS 17) [S32]. For custom keyframes, Debbie's `MotionPolicy` (CRAFT M9). The HIG list is in F5.

### F7. Haptics on tab switches: Apple's iPhone tab bars play none
- `SensoryFeedback.press(.tab)`: "Indicates that a control to activate a tab has been pressed (touch down)… **Only plays feedback on visionOS.**" It's an iOS 26.0 API, present in our SDK [S34][S36]. Note 04 F3 found the same for `.press`, `.release` and `.selection(_:)`.
- HIG: "components like switches, sliders, and pickers automatically play haptic feedback on supported iPhone models". Tab bars aren't listed [S12]. The same page: "Avoid overusing haptics… tiresome when it plays frequently"; "Use system-provided haptic patterns according to their documented meanings". Selection is "feedback while the values of a UI element are changing" [S12].
- The iOS 26 review describes the selection bubble in detail without any haptic [S43]. Reasoning, weak on its own: it's consistent with the two primary sources above.
- Debbie already rules out "navigation push and pop" and "ordinary button taps" (04 R3, CRAFT §4.2).

### F8. The corner Settings button, and where Settings opens
- **Placement and look.**
  - Placement: "Place UI in expected locations, use standard symbols to represent common actions, and rely on established conventions for navigation and modality" [S16]. On iOS, toolbar trailing items "remain available" [S2].
  - Look: "Prefer simple, recognizable symbols for items instead of text"; "Borders (like outlined circle symbols) aren't necessary because the section provides a visible container" [S2]. The owner's complaint ("the settings button is just random text in the middle of screen") is the first rule broken.
  - Measured system button: a 44-pt glass circle, top trailing (F2).
- **Gear metaphor.** HIG's standard-icon table has no Settings row; it lists Account and Profile as `person.crop.circle` [S11]. Interface icons should "use familiar visual metaphors" [S11]. Reasoning: a gear is the familiar settings metaphor on iPhone, and Debbie has no accounts, so the gear beats an avatar.
- **Modal versus push.**
  - A modal is "reserved for a self-contained task" and "comes from the bottom of the screen to cover your tab bar"; a push "is an expected default when drilling further into an app's hierarchy" [S24].
  - Modality helps "people perform a distinct, narrowly scoped task without losing track of their previous context" [S14].
  - HIG Settings: "Put general, infrequently changed settings in your custom settings area. People must suspend what they're doing to open an app's or game's settings area"; task-specific options belong "in the screens they affect" [S15]. Reasoning: Settings is a brief detour from any tab, which is what a sheet is for.
  - Settings belongs to no tab. Reasoning: pushing it onto whichever tab is open would put one screen into four hierarchies, which is the duplication WWDC22 warns about [S24].
- **Inside the sheet.**
  - "Avoid creating a modal experience that feels like an app within your app… If a modal task must contain subviews, provide a single path… and avoid including buttons that people might mistake for the button that dismisses the modal view." [S14]
  - "The Cancel (or Close) button dismisses a sheet without saving any changes"; for single-view sheets the Cancel button "belongs on the leading edge"; "Provide an alternative to the Done button" [S13].
  - WWDC22: "Use close symbols sparingly and only when modal presentations require minimal interaction and no text input" [S24].
  - Reasoning: Debbie's settings apply at once (pending, then confirmed: 09 R7), so a Close button is honest and a Done button would imply a save step.
- **Morphing (new in iOS 26).** "Sheets can also directly morph out of buttons that present them… make the presenting toolbar item a source for a navigation zoom transition" [S20]. CRAFT keeps zoom (T2) on the later list because of an iOS 26 flicker risk.

### F9. White canvas with tinted cards: measured separation
Ratios use WCAG 2.x, and ΔL\* and ΔE00 use CIELAB and CIEDE2000, all computed with `tools/design/tokens.py`'s functions [S38]. Apple's values are UIKit's dynamic `systemBackground` and `secondarySystemBackground` as mirrored in Flutter's Cupertino colours [S46] (secondary).

| Pair | Colours | Ratio | ΔL\* | ΔE00 |
|---|---|---|---|---|
| Apple primary vs secondary, light | `#FFFFFF` / `#F2F2F7` | 1.12 | 4.4 | 3.6 |
| Apple, dark | `#000000` / `#1C1C1E` | 1.23 | 10.3 | 6.4 |
| Apple, light + IC | `#FFFFFF` / `#EBEBF0` | 1.19 | 6.8 | 4.8 |
| Apple, dark + IC | `#000000` / `#242426` | 1.36 | 14.3 | 8.8 |
| Debbie `bg.canvas` vs `bg.surface` (working tree), light | `#FFFFFF` / `#F3F7F5` | 1.08 | **3.1** | 3.0 |
| Debbie, dark | `#0E1412` / `#18201D` | 1.12 | **5.6** | 4.1 |
| Debbie, light + IC | `#FFFFFF` / `#EEF3F0` | 1.12 | **4.6** | 4.1 |
| Debbie, dark + IC | `#000000` / `#121916` | 1.18 | **8.0** | 7.1 |

- **HIG basis.**
  - "Primary for the overall view; Secondary for grouping" [S4].
  - Dark Mode uses "base" colours that "recede" and "elevated" ones that "advance". Its colours "aren't necessarily inversions" of the light ones [S5].
  - Aim for 4.5:1 at minimum and "strive for a contrast ratio of 7:1" for custom colours. Check Increase Contrast "in Dark Mode… you might also find… reduced visual contrast" [S5].
  - Make colours "work well in light, dark, and increased contrast contexts" [S4].
- **The glass bar on white.** Small bars "flip from light to dark based on the background". The glass lowers its shadow "when it is over a solid light background", and "In steady states… avoid intersections between content and Liquid Glass" [S18]. Liquid Glass "has no inherent color… By default, symbols and text on these elements follow a monochromatic color scheme". In "apps with primarily monochromatic content or backgrounds, choosing your brand color as the app accent color can be an effective way" to show identity [S4].
- **Measured tab-bar pairings** (light / dark / light IC / dark IC) [S38]:
  - Selected glyph and label: `accent.text` on `mint.tint` 5.68 / 8.47 / 7.69 / 7.60.
  - Unselected: `text.secondary` on `bg.canvas` 8.88 / 10.09 / 13.48 / 15.80.
  - Indicator fill: `mint.tint` vs `bg.canvas` only 1.15 / 1.31 / 1.20 / 1.95. The fill is a soft cue, not a boundary.
  - Indicator stroke: `accent.text` vs canvas 6.52 / 11.09 / 9.26 / 14.85.
- **Separation candidates.** They meet the Apple-anchored floors, rounded down: light ≥ 4, dark ≥ 10, light IC ≥ 6, dark IC ≥ 14. They also keep every C2 pairing on `bg.surface` (text 7:1; tertiary, accent, caution and urgent text 4.5 / 7 IC; borders, focus ring and urgent border 3 / 4.5 IC) [S38]. The worst pairing is shown for each.

  | Appearance | Candidate `bg.surface` | ΔL\* | Worst pairing |
  |---|---|---|---|
  | Light | `#EEF3F0` | 4.6 | `border.control` 3.22 / 3 |
  | Dark | `#212B27` | 10.7 | `text.secondary` 7.90 / 7 |
  | Light + IC | `#E8EEEA` | 6.4 | `accent.text` 7.87 / 7 |
  | Dark + IC | `#1E2723` | 14.7 | `text.tertiary` 8.96 / 7 |

  - `surface.pressed` would then sit only ΔL\* 0.5–2.3 from the new surfaces, so it must be re-derived.

### F10. APIs checked in the local iOS 26.5 SDK [S36]
| API | Availability | Note |
|---|---|---|
| `AccessibilityTraits.isTabBar` | iOS 17.0 | Bar container; device-verify the spoken role [S41] |
| `UIAccessibilityTraitTabBar` (header comment) | iOS 10.0 | "an ordered list of tabs… should return NO for isAccessibilityElement" |
| `accessibilityShowsLargeContentViewer()` / `(_:)` | iOS 15.0 | `@ViewBuilder` locally |
| `UILargeContentViewerInteraction`, `isEnabled` | iOS 13.0 | "such as a custom tab bar" |
| `safeAreaBar(edge: VerticalEdge, alignment:spacing:content:)` | **iOS 26.0** | Bottom bar plus scroll edge effect |
| `glassEffect(_:in:)`, `Glass.interactive(_:)`, `GlassEffectContainer`, `glassEffectID(_:in:)` | **iOS 26.0** | [S31] |
| `TabBarMinimizeBehavior`, `tabBarMinimizeBehavior(_:)` | **iOS 26.0** | System `TabView` only |
| `SensoryFeedback.press(_:)`, `PressFeedback.tab` | **iOS 26.0** | visionOS-only playback [S34] |
| `matchedGeometryEffect(id:in:properties:anchor:isSource:)` | iOS 14.0 | Exactly one source |
| `keyframeAnimator(initialValue:trigger:content:keyframes:)`, `KeyframeTimeline` (`duration`, `value(time:)`) | iOS 17.0 | Velocity kept on re-trigger |
| `Tab` (`Tab(_:image:value:content:)`) | iOS 18.0 | Not used (custom bar) |
| `XCUIApplication.performAccessibilityAudit(for:_:)` with issue handler | iOS 17.0 | XCUIAutomation header |

## What changed in iOS 26 (and since)
- **New in iOS 26.**
  - The floating Liquid Glass tab bar. HIG Tab bars added Liquid Glass guidance on 28 Jul 2025 and updated it on 16 Dec 2025 [S1].
  - Minimise on scroll, and the bottom accessory (26.0; the `isEnabled:` variant is 26.1, 02 §8).
  - The search tab at the trailing end [S1][S20].
  - Liquid Glass APIs for custom controls [S31].
  - `safeAreaBar` and scroll edge effects [S36].
  - Toolbar items on shared glass backgrounds, with `sharedBackgroundVisibility` for avatars [S20].
  - Sheets morphing out of toolbar buttons [S20].
  - HIG Toolbars took over navigation bars on 9 Jun 2025 [S2].
  - `SensoryFeedback.press(.tab)` (visionOS-only playback) [S34].
  - SF Symbols 7 Draw On/Off [S10].
  - iOS 26.4: Reduce Motion "reduces Liquid Glass animations more reliably" (02 §2).
- **Older but load-bearing.**
  - The iOS 18 tab-switch cross-dissolve [S39][S40].
  - `Tab` (iOS 18) [S30].
  - `isTabBar`, keyframes and `KeyframeTimeline` (iOS 17) [S36].
  - Large Content Viewer (iOS 13/15) [S26][S33].
- **Since iOS 26 (HIG).**
  - Tab bars "Updated terminology and art" on 8 Jun 2026 [S1].
  - Branding refined brand colour, naming "the selected tab", on 9 Sep 2026 [S16].
  - Layout "Updated guidance" on 9 Sep 2026 [S17].
  - WWDC26 brand session: tab labels and icons appear in the centre at accessibility sizes [S22].
- **iOS 27 SDK only (LATER: Xcode 27 needs macOS 26.6).**
  - iPhone apps can opt their tab bar into a sidebar ("New in iOS 27, iPhone apps can also opt into sidebars") [S48].
  - `TabsPickerStyle`, which VoiceOver reads as "tabs" (09 F3).
  - The tab `.prominent` role (09, iOS 27 list).
  - iPhone Duo side placement for system bars only (01 R12).

## Recommendations for Debbie

**R1. Four tabs: Home · Live · History · Devices, in that order.** ADOPT-TONIGHT [S1][S24][S35][S38]; supersedes X19 and 02 R10 because the owner chose a tab bar (15:44).
- Labels are exactly those words: title case, nouns, ≤ 7 characters. Each tab has one job: Home, "is everything all right, and what needs me?"; Live, look in; History, what happened; Devices, what is set up.
- A tab is never disabled or hidden. An empty or unavailable section explains why. Example: "Live view is off. Only the person at home can turn it on."
- **Five tabs:** the HIG and UIKit allow it (six is where "More" begins). But Debbie's 13-pt label floor can't fit five items at 320 pt (F1).
  - Adding a fifth tab, such as the "Debbie" assistant in the working tree, therefore needs either an 11-pt label exception to CRAFT T1, recorded in DECISIONS with the system's ≈ 10-pt labels as precedent (F2), or Display Zoom truncation, which T3 forbids.
  - It must look like the other tabs: same anatomy, glyph and label, no raised or oversized centre button. "Use a tab bar to support navigation, not to provide actions" [S1].
  - Its glyph comes from the `dx` icon set, not the logo mark (B2, B6; [S22]).
- *Check:* `SimplicityTests` asserts 4 tab buttons with labels ["Home", "Live", "History", "Devices"]. A 320-pt snapshot shows no truncated label at `.xLarge`.

**R2. Geometry: match the system bar.** ADOPT-TONIGHT [S1][S19][S37]; 01 R12.
- One capsule of `Glass.regular.interactive()`, attached with `safeAreaBar(edge: .bottom)`.
- Width is the screen minus 2 × `space.20`, against the system's measured 21 pt. Height is 62 pt. On Debbie SE the bar sits 21 pt above the bottom edge.
- Items split the inner width equally, inset 4 pt, and are 54 pt tall: about 81.75 × 54 on SE and 98 × 54 on Max. The hit region is the item frame (`contentShape(.interaction, Capsule())`).
- Glyph 24 pt; label `tabLabel`, a new role: `.footnote` 13/18 Semibold (see Proposed additions).
- Debbie Max's bottom offset: measure a system `TabView` on the same Simulator before the gate (open question 1).
- *Check:* an overlay snapshot against the system bar: each outer edge within 1 pt. A UI test finds every `tab.*` frame ≥ 44 × 44.

**R3. Selected and unselected states: four cues, never colour alone.** ADOPT-TONIGHT [S1][S10][S16][S18][S38]; C7.
- **Selected:**
  - the filled glyph twin;
  - glyph and label in `accent.text`;
  - a `mint.tint` capsule the size of the item. It is a fill, because glass on glass is out [S18];
  - `.isSelected`.
- **Unselected:** outline glyph, `text.secondary`. The label stays Semibold in both states, so the text doesn't change width.
- **Increase Contrast:** the indicator adds a 1.5 pt `accent.text` stroke (9.26:1 on canvas, light IC).
- The Live tab's selected glyph must not be, or resemble, `dx.live`, the camera-is-live glyph. It never uses indigo `live.fill` and never says "LIVE". Reasoning: the tab is always on screen, while "LIVE" means a stream is running (P7, T15; 08 R11 lists both glyphs).
- **Deviation recorded:** the HIG prefers filled glyphs in every state [S1]. Debbie keeps outline for unselected so the fill change is a shape cue for colour-blind and low-vision users. The HIG itself suggests the fill variant "to indicate selection" [S10].
- *Check:* a greyscale screenshot identifies the selected tab. `ColorTokenTests` asserts `accent.text` on `mint.tint` ≥ 4.5 and ≥ 7 with IC.

**R4. Always there, never minimised.** ADOPT-TONIGHT [S1][S24][S43].
- The bar shows on every tab root and on screens pushed inside a tab.
- It's covered only by sheets and full-screen covers (Settings, Add a Laptop, live view, pairing). It may step aside while the keyboard is up, as the working tree does for the assistant composer; the keyboard would cover it anyway.
- No minimise and no hide-on-scroll: Debbie has no accessory, and minimised bars hurt discoverability.
- The resident root has no tab bar (X6).
- *Check:* a UI test scrolls History three screens and asserts all `tab.*` elements remain hittable.

**R5. Behaviour people expect from a tab bar.** ADOPT-TONIGHT [S1][S24][S35].
- **State per tab.** Each tab keeps its own `NavigationStack` path and scroll position across switches ("preserving the current navigation state within each section" [S1]). Two ways to do it:
  - keep visited roots alive and hidden with `.opacity(0)`, `.allowsHitTesting(false)` and `.accessibilityHidden(true)`. That fixes the "hidden pages leaked their bars to VoiceOver" problem noted in the working tree;
  - or render only the selected root and store each tab's path plus a `ScrollPosition` (iOS 18).
- **Re-tapping the selected tab** pops its stack to the root, and at the root scrolls to the top. UIKit: "User taps always display the root view of the tab… even if the tab was already selected" [S35]. Scroll-to-top is reasoning, the iOS convention.
- **No content control changes the selected tab** [S24]. The working tree's Home "showDevices" link breaks this. Show that fact inline on Home, or push a device detail inside Home's stack.
  - Alert actions ("Open Live View") present the live-view cover from wherever they are.
  - A notification tap may select Home and push the alert. That's a system deep link, not tab-jumping.
- **Cold launch opens Home.** Reasoning: the status is what people come for (P2).
- **Selecting Live never starts a stream.** Only its "Look In" action requests one. Reasoning: privacy (P7), and "not to provide actions" [S1].
- **Badge:** only on Home, only for unacknowledged urgent alerts (1–9, then "9+"), drawn as `urgent.fill` with `text.onUrgent` (6.07:1 light, 8.15:1 IC). The badge is "a red oval… Reserve badges for critical information" [S1]. CRAFT C6 needs a one-line extension (see Proposed additions).
- *Check:*
  - a UI test pushes an alert on Home, switches to History and back, and expects the alert screen. Re-tapping Home expects the root;
  - a grep finds no write to the tab selection outside the bar and the deep-link handler.

**R6. The bar's accessibility contract.** ADOPT-TONIGHT [S8][S23][S26][S29][S33][S36][S41][S42].
- **Container:** `.accessibilityElement(children: .contain)` plus `.accessibilityAddTraits(.isTabBar)`.
- **Items:** `Button`s whose names come from the visible label, with `.isSelected` on the current one. They contain no other elements.
- **Role and position (device check):** with VoiceOver on a device, each item reads its label, "tab", "n of 4" and, when current, "selected". If the device shows no role or position, the SwiftUI trait bug (FB19401153) applies [S41]. Then add `.accessibilityValue("Tab n of 4")`, never together with a working trait.
- **Order:** top bar (title, Settings), then the content, then Home, Live, History and Devices. A tab switch moves no VoiceOver focus (09 R13).
- **Dynamic Type:** the bar's glyphs and labels clamp at `.xLarge` (15-pt labels), and labels never hide at accessibility sizes (system, F2). Each item gets `.accessibilityShowsLargeContentViewer { Label { Text(title) } icon: { DIcon(glyph) } }`. At AX sizes, long press, drag across and lift selects [S26].
- **Audit:** `performAccessibilityAudit` passes. Only `.dynamicType` issues on elements whose identifier starts with `tab.` or equals `settings` may be ignored in the issue handler, with the reason recorded in DECISIONS [S29].
- **Voice Control:** input labels list the visible label first, then synonyms: Live → ["Live", "Live View"]; Devices → ["Devices", "Laptops"].
- **Show Borders** changes nothing: items aren't text-only buttons (C9), and the indicator already gives the selected item a shape.

**R7. Tab-switch content transition: a 0.15 s cross-fade, nothing else.** ADOPT-TONIGHT [S6][S9][S37][S39][S40].
- `tabFade` = `.easeInOut(duration: 0.15)` on both roots' opacity, in the transaction that changes the selection.
- No drift, slide, scale or zoom. That means replacing the working tree's 16-pt `tabContent(forward:)` offset.
- The new root is hittable at once, and the old one isn't (M4).
- Reduce Motion keeps the fade, because the fade is the substitute.
- *Check:* recording frames show the change over ≤ 0.2 s with old and new content at the same coordinates (as in `system-tab-switch-frames.png`). A lint bans `.offset`, `.move`, `.push`, `.scale` and `.slide` in the tab container.

**R8. Selection indicator motion: `tabSelect` = `Spring(duration: 0.30, bounce: 0)`.** ADOPT-TONIGHT [S18][S19][S20][S32][S38]; 03 R2; replaces the working tree's `tabSlide` `(0.35, 0.15)`.
- One indicator view with `matchedGeometryEffect`, exactly one source.
- It slides to the tapped item: 95 % at 0.227 s, settled 0.50 s. A second tap mid-flight retargets from the current position and velocity.
- The bar's `Glass.regular.interactive()` provides the lift and shimmer on touch. Items add only the standard pressed state (0.97 on `press`), replacing the working tree's 0.94.
- **Reduce Motion:** the indicator doesn't move; it fades out at the old item and in at the new one with `tabFade`. The system already removes the glass's elasticity [S18].
- No press-and-drag scrubbing tonight. It's a custom gesture (HIG Accessibility: "Prefer system gestures") [S6], and the Large Content Viewer already gives drag-to-select at AX sizes. LATER.

**R9. Icon animations (`DAnimatedIcon`), bounded and testable.** ADOPT-TONIGHT [S9][S10][S27][S32][S36][S38]; 03 R12, R13.
- Built with `keyframeAnimator(initialValue:trigger:)` from `SpringKeyframe`s:
  - the first keyframe ≤ 0.10 s on `press` (`Spring(0.20, 0)`, 80 % at 0.096 s);
  - the rest on `iconStep` = `Spring(duration: 0.25, bounce: 0)` (95 % at 0.189 s, settled 0.40 s);
  - any overshoot is an explicit keyframe value, never spring bounce.
- **Bounds:**
  - total ≤ 0.6 s;
  - scale 0.85–1.15;
  - travel ≤ 4 pt;
  - rotation ≤ 15°, except rotationally symmetric glyphs (gear, clock face, sync ring), which may turn ≤ 360° and end on an identical pose;
  - ends exactly at rest. The last keyframe lasts at least its spring's settling time, or ends with a `MoveKeyframe` to rest.
- **When:** only for the person's tap on that control, plus the heart's beat on a live reading (not a restored one). Once per trigger, never repeating, never on launch, restore, programmatic selection or deep links, and at most one effect running per screen.
- **Under Reduce Motion:** no effect. Only the state change happens (outline ↔ filled, colour), with `tabFade`.
- **Meanings** (Apple's vocabulary [S10]):

  | Icon | Effect | Keyframes |
  |---|---|---|
  | `home` | settle (Bounce) | down 2 pt with a 0.94 squash → rest |
  | `camera` (Live tab) | focus (Scale) | 1.10 → rest. Never `live`'s breathe |
  | `history` | rewind (Rotate, object behaviour) | −45° → rest |
  | `laptop` | wake (Bounce) | scaleY 0.88 from the hinge → rest |
  | gear | turn (Rotate) | +60°, one tooth, an identical pose |
  | `heart` | beat | 1.10 → 0.97 → 1.06 → rest |
  | `sync` | spin | 360° once, then 03's `working` while syncing |

  The working tree's 1.16 heart, −50° rewind and 0.78 lid exceed these bounds. Reasoning: Debbie is a calm safety tool (P1, 03 R2).
- **Accessibility:** inside a labelled control, the glyph is decorative (I5). An effect never carries meaning alone (M7).
- *Check:* `IconMotionTests` evaluates each effect's `KeyframeTimeline`: duration ≤ 0.6, value at 0 and at `duration` equal to rest within 0.001, and bounds held at 1-ms steps.

**R10. No haptics on tab selection, re-selection, the corner button or icon effects.** ADOPT-TONIGHT [S12][S34][S36][S43]; 04 R3.
- Don't reuse `choiceChanged` (`.selection`) for tabs: that pattern means "values… changing" [S12].
- *Check:* a lint finds no `.debbieHaptic` in `Chrome/` or `DAnimatedIcon`, and `HapticMapTests` lists no tab event.

**R11. The corner Settings button (`DebbieCornerButton`).** ADOPT-TONIGHT [S2][S11][S16][S37]; X6.
- A 44-pt circle of `Glass.regular.interactive()`, as measured for the system button (F2). The working tree's opaque `bg.surface` circle would be a recorded deviation from D2.
- The gear glyph is 22–24 pt in `text.primary`, monochrome like system bar items [S4][S20].
- **Position:**
  - top trailing on every tab root, centred in the 44-pt row below the status bar;
  - its trailing edge sits on the 20-pt content margin. The system aligns its button to its own 16-pt title margin; Debbie keeps the same alignment to its 20-pt margin (L3);
  - it never appears on pushed screens, sheets or covers;
  - the Demo badge may sit beside it (working tree).
- **Label:** "Settings" for VoiceOver and Voice Control. The glyph clamps at `.xLarge`, with the Large Content Viewer at AX sizes, because the system's bar button doesn't grow (F2).
- **Effect:** `turn` (one tooth) on tap.
- **Optional attention state:** a `caution.fill` dot only while alerts can't reach this iPhone (notifications off, or not time-sensitive; 14 R1), plus the VoiceOver value "Notifications are off".
- It's never disabled: Settings must stay reachable to unpair (X6).

**R12. Settings opens in a sheet.** ADOPT-TONIGHT [S1][S13][S14][S24]; T3.
- `.sheet` with `.presentationDetents([.large])`, and swipe down dismisses.
- Its own `NavigationStack`, with a single path at most one level deep (root → detail → back).
- `DebbieSheetHeader` puts Close (✕, "Close") on the **leading** edge of the root [S13]. Sub-pages show Back there instead, never both. There is no Done, because changes apply at once (09 R7).
- **Contents:** 14 R1 minus what Devices now owns. The home hub, laptops and this iPhone's route live in Devices, so nothing appears in both places [S24].
- The same sheet opens from every tab, and the tab underneath is unchanged when it closes.
- The zoom morph out of the gear [S20] is LATER (T2 flicker risk).

**R13. A large title per tab.** ADOPT-TONIGHT [S2][S8][S22].
- Each tab root's first content row is its large title (Live: "Live view"; History; Devices; ≤ 15 characters, never "Debbie"), with the corner button in the top-bar row above it, as the system does (F2).
- After the title scrolls under the top bar, the compact title fades in with `state`, opacity only.
- **Home** is different. Its large-title slot is the status headline (the `hero` role; CRAFT A3, P2). Its VoiceOver header label starts "Home," (for example "Home, monitoring is on, updated 1 minute ago") so the screen still gets a title [S8]. "If titling a toolbar seems redundant, you can leave the title area empty" [S2].

**R14. Calm density on the white canvas.** ADOPT-TONIGHT [S17][S19][S22][S24]; P3, §1.1.
- One job per tab (R1), with brand colour in the content: one mint focal point per screen (C4).
- Cards are `bg.surface` on `bg.canvas`, separated by `space.16`; groups by `space.24`; 20-pt margins (L3). No shadows (D6).
- Home doesn't repeat tab functions: the History, Status and Live View buttons in S09's old budget go.
- `SimplicityTests` counts the 5 chrome controls (4 tabs + Settings) once, separately from each screen's content budget.

**R15. Card separation floors and token candidates.** ADOPT-TONIGHT (token pass) [S4][S5][S38][S46].
- `ColorTokenTests` asserts ΔL\*(`bg.canvas`, `bg.surface`) ≥ 4 (light), 10 (dark), 6 (light IC) and 14 (dark IC). These are Apple's own primary/secondary separations, rounded down.
- Adopt F9's candidates (`#EEF3F0`, `#212B27`, `#E8EEEA`, `#1E2723`) or any others that pass. Re-derive `surface.pressed` so ΔL\*(surface, pressed) ≥ 3, then re-run `tools/design/tokens.py --write`.
- Increase Contrast keeps C9's 1.5-pt `border.control` on cards (9.85:1 light IC on canvas).

**R16. Glass legibility is the system's job.** ADOPT-TONIGHT [S3][S4][S18][S19].
- No fill, border, shadow or blur of Debbie's own behind or around the bar or the corner button. Reduce Transparency, Increase Contrast and Reduce Motion adapt the real material [S18].
- The working tree adds a `border.control` stroke under IC. The IC screenshot must show exactly one outline; drop Debbie's stroke if the system already draws one.
- Every tab's resting layout keeps primary actions and the status headline above the bar. Scroll content gets the bar's inset automatically (`safeAreaBar`).
- *Check:* the IC, Reduce Transparency and dark screenshots of each tab root, plus one with an urgent `AlertCard` scrolled under the bar: the bar's labels stay legible.

**R17. Urgent alert response: push or modal (lead/owner decision).** DECISION.
- **Keep the push (default)** and the bar stays visible [S1][S24].
- **Or present the alert detail as a full-screen cover:** modality "reinforce[s] focus by hiding the tab bar and preventing people from moving around the app before the task is complete" [S24]. Reasoning: it removes four tempting exits during a possible fall. The cost is a change to X19 and T1.
- Either way, the alert's prominent 64-pt actions sit in content, not pinned above the tab bar ("a checkout button… belongs with the content it supports" [S19]).

**R18. Verification plan.** ADOPT-TONIGHT; brief §8, CRAFT §3.4.
- The F2 probe becomes the overlay baseline on SE and Max.
- **Recordings:**
  - each tab switch;
  - one switch interrupted by a second tap mid-flight, where the indicator retargets with no jump;
  - the same with `-DebbieReduceMotion YES`, with no movement and no icon effect.
- One VoiceOver pass on a device (R6), or "not run" recorded with the value fallback in place.
- Large Content Viewer checked at AX5 (long press, drag, lift).

**R19. iOS 27 items.** LATER: Xcode 27 [S48].
- The iPhone sidebar opt-in, `TabsPickerStyle` and the tab `.prominent` role don't compile with our SDK.
- iPhone Duo's side bars won't move a custom bar (01 R12). Re-check once the toolchain moves.

## Delta from the working tree (read 16:2x, not edited) [S47]
1. `Motion.tabSlideSpring (0.35, 0.15)` → `tabSelect (0.30, 0)`. Bounce on a tap breaks P1 and 03 R2. The system's selection settles in ≈ 0.13 s (R8).
2. `Motion.tabContent(forward:)` drifts 16 pt → a cross-fade only, `tabFade` 0.15 s (R7).
3. `DebbieTabBar` hides labels at accessibility sizes → keep them and clamp at `.xLarge`, as the system does (F2, R6).
4. `.accessibilityValue("Tab n of N")` → the `.isTabBar` container first, the value only if the device check fails (R6).
5. IC `strokeBorder` on the glass bar → check for a double outline (R16).
6. `DebbieTabItemStyle` scale 0.94 → the standard 0.97 on `press`, plus interactive glass (R8).
7. `phaseAnimator` icon effects → `keyframeAnimator` with `KeyframeTimeline` tests. Effects play on user taps only, not "a link from another screen" (R9).
8. The Home "showDevices" switch → no tab-jumping (R5).
9. Only Home's path survives a switch → every tab keeps its path and scroll position (R5).
10. A fifth "Debbie" tab with an avatar → see R1 (label-size limit, same anatomy, `dx` glyph).
11. `DebbieCornerButton` on `bg.surface` → a glass circle like the system's (R11).
12. CRAFT working-tree T18 ("gear turns as the sheet rises") is fine and is kept as T19 below.

## Proposed CRAFT.md additions
Exact text to paste. `[16 Rk]` cites this note. Numbers continue CRAFT's existing ones. Accessibility rules are prefixed **TA** so they don't collide with checklist lines A1–A3.

### §2.5 Materials and depth (replace D1; add D8–D12)
- D1. Two layers. Liquid Glass only in floating chrome: the tab bar, the corner button, the top bar's floating controls, the floating action bar and the live-view controls. It is built only in `DebbieDesignSystem/Chrome/`. Never on cards, rows, alerts, status, empty states or the tab bar's selection indicator (lint for `glassEffect` and `.glass` outside `Chrome/`) [02 R3][16 R2][HIG Materials].
- D8. The tab bar is one capsule of `Glass.regular.interactive()` attached with `safeAreaBar(edge: .bottom)`, 62 pt tall, with `space.20` side margins. On Debbie SE it sits 21 pt above the bottom edge (system iOS 26.5: 333 × 62 pt, 21 pt from the sides and bottom). Items split the inner width equally, inset 4 pt, 54 pt tall; the item frame is the hit region. *Check:* overlay snapshot against a system `TabView` on the same Simulator, each outer edge within 1 pt, on SE and Max [16 R2][01 R12].
- D9. The selection indicator is a `mint.tint` capsule the size of the selected item, drawn as a fill inside the glass (never glass on glass). Under Increase Contrast it adds a 1.5 pt `accent.text` stroke [16 R3][WWDC25 219].
- D10. The corner button is a 44-pt `Glass.regular.interactive()` circle holding the gear in `text.primary`. It sits at the top trailing corner of every tab root, centred in the 44-pt row below the status bar, with its trailing edge on the 20-pt content margin. It is not shown on pushed screens, sheets or covers [16 R11].
- D11. Glass accessibility is the system's: Debbie adds no fill, border, shadow or opacity of its own to the tab bar or the corner button. *Check:* the Increase Contrast screenshot shows exactly one outline around each; Reduce Transparency and dark screenshots are legible with an urgent card under the bar [16 R16][WWDC25 219].
- D12. The tab bar never minimises or hides on scroll. It shows on every tab root and on screens pushed inside a tab, and is covered only by sheets, full-screen covers and the keyboard. *Check:* UI test, all `tab.*` hittable after scrolling History three screens [16 R4][HIG Tab bars].

### §3.1 Named springs and fades (add; replaces the working tree's `tabSlide` and `iconStep` rows)
| Token | `Spring(duration:bounce:)` | 95 % at | Settled | Overshoot | Use for | Reduce Motion substitute |
|---|---|---|---|---|---|---|
| `Motion.tabSelect` | 0.30, 0 | 0.227 s | 0.50 s | 0 | The tab bar's selection indicator moving to the tapped item; retargets when another tab is tapped mid-flight (T17) | Indicator cross-fades in place with `tabFade` |
| `Motion.iconStep` | 0.25, 0 | 0.189 s | 0.40 s | 0 | Every icon-effect keyframe after the first; the first uses `press` (§3.5) | No effect |

| Token | Curve | Use |
|---|---|---|
| `Motion.tabFade` | `.easeInOut(duration: 0.15)` | Tab content cross-fade (T16); the indicator's Reduce Motion cross-fade (T17); outline ↔ filled glyph swap |

### §3.2 Rules (add M10–M15)
- M10. Switching tabs cross-fades the old and new tab roots with `tabFade`, in the transaction that changes the selection. Nothing translates, scales or zooms; Apple's own switch is a ≈ 0.1–0.15 s cross-dissolve with no slide [16 F5]. The new root is hit-testable and visible to VoiceOver at once; the old root is neither. *Check:* lint bans `.offset`, `.move`, `.push`, `.scale` and `.slide` in the tab container. The recording shows one fade ≤ 0.2 s with content at the same coordinates [16 R7].
- M11. The tab selection indicator is exactly one view with `matchedGeometryEffect` (one source at a time), animated with `tabSelect`. A tap mid-flight retargets from the current position and velocity. Under `MotionPolicy.reduce` it never moves: it fades out at the old item and in at the new one with `tabFade`. *Check:* the interrupted recording (§3.4) shows the indicator turning toward the second tab without a jump [16 R8].
- M12. Icon effects (`DAnimatedIcon`) are `keyframeAnimator(initialValue:trigger:)` timelines of `SpringKeyframe`s only. The first keyframe is ≤ 0.10 s on `press`; the rest are on `iconStep`. Each effect lasts ≤ 0.6 s, stays within scale 0.85–1.15, travel ≤ 4 pt and rotation ≤ 15°, and ends exactly at rest. Rotationally symmetric glyphs (gear, clock face, sync ring) may turn ≤ 360° and must end on an identical pose. *Check:* `IconMotionTests` evaluates each effect's `KeyframeTimeline` (`duration`, `value(time:)`): bounds hold at 1-ms steps, and values at 0 and `duration` equal rest within 0.001 [16 R9].
- M13. An icon effect plays only for a person's tap on that control, or for a live arrival named in §3.5. It plays once per trigger and never repeats. It never plays on launch, restore, programmatic selection or deep links. At most one effect plays per screen at a time. Under `MotionPolicy.reduce` no effect plays; only the state change (outline ↔ filled, colour) happens, with `tabFade` [16 R9][M6][M8].
- M14. Tab items and the corner button get their touch response from interactive glass plus the standard pressed state: scale 0.97 on `press`, and no scale under Reduce Motion. There is no other press scale [16 R8].
- M15. A tab root's large title scrolls with the content. When it passes under the top bar, the compact title fades into the bar with `state` (opacity only) and fades out again at the top [16 R13][HIG Toolbars].

### §3.3 Transitions catalogue (replace the working tree's T16–T18; add T19–T20)
| ID | Change | Transition | Timing | Reduce Motion |
|---|---|---|---|---|
| T16 | Switching tabs (Home, Live, History, Devices) | Old and new tab roots cross-fade in place; no drift, slide or zoom; each tab keeps its navigation path and scroll position | `tabFade` | Same |
| T17 | Tab bar selection | The indicator capsule moves to the tapped item (`matchedGeometryEffect`); the glyph swaps outline → filled and plays its §3.5 effect | `tabSelect`; swap `tabFade` | Indicator cross-fades in place; swap stays; no effect |
| T18 | Re-tapping the selected tab | Its stack pops to the root (system pop); at the root the content scrolls to the top | System / `state` | System pop; scroll without animation |
| T19 | Opening Settings | The gear turns one tooth as the system sheet rises (T3) | `press` + `iconStep`; sheet system | Sheet only |
| T20 | Large-title collapse | The compact title fades into the top bar after the large title scrolls under it | `state` (opacity) | Same |

### §3.5 Icon effects (replace the working tree's table)
Each effect follows M12–M13. Meanings use Apple's symbol-animation vocabulary [HIG SF Symbols][16 R9].

| Icon | Effect | Keyframes | Plays when |
|---|---|---|---|
| `home` | settle | down 2 pt with a 0.94 squash → rest | Home tab tapped |
| `camera` | focus | scale 1.10 → rest (never resembles `live`'s breathe; never indigo) | Live tab tapped; Look In tapped |
| `history` | rewind | turn −45° → rest | History tab tapped |
| `laptop` | wake | scaleY 0.88 from the hinge → rest | Devices tab tapped |
| gear | turn | +60° (one tooth; identical pose) | Settings tapped |
| `heart` | beat | 1.10 → 0.97 → 1.06 → rest | A live (not restored) reading appears |
| `sync` | spin | one 360° turn, then `working` while syncing | Sync Now tapped |

### §4.2 Never gets a haptic (append)
Tab selection and re-selection, the corner button, and every icon effect. Apple's iPhone tab bars play none: `SensoryFeedback.press(.tab)` "Only plays feedback on visionOS" [16 R10]. *Check:* lint, no `.debbieHaptic` in `Chrome/` or `DAnimatedIcon`.

### §5 Components (add rows; replace the working tree's three rows)
| Component | Replaces | Sizes ([X21]) | States beyond the six / notes | Accessibility | Haptic |
|---|---|---|---|---|---|
| `DebbieTabBar` (Chrome/, Liquid Glass) | `TabView`'s tab bar | Bar: screen − 2 × 20 pt, 62 pt tall. Items: inner width ÷ 4 × 54 pt (≥ 44 × 44 hit). Glyph 24 pt. Label `tabLabel` 13 pt | Selected: filled glyph, `accent.text`, `mint.tint` indicator. Pressed: glass response + 0.97. Badged: Home only, unacknowledged urgent count. Never disabled, hidden or minimised [16 R1–R5] | Container `.contain` + `.isTabBar`. Items are buttons named by their visible label, with `.isSelected` on the current one. On a device VoiceOver speaks label, "tab", "n of 4", "selected" (value fallback only if that fails). Glyphs and labels clamp at `.xLarge` and never hide. Large Content Viewer on every item. Read after the content [16 R6] | none [16 R10] |
| `DebbieCornerButton` (Chrome/) | Toolbar icon button (Settings) | 44-pt glass circle; 44 × 44 hit; glyph 22–24 pt | Pressed: glass response + 0.97. Attention: `caution.fill` dot only while alerts can't reach this iPhone. Never disabled [X6] | Label "Settings"; input labels ["Settings"]. Glyph clamps at `.xLarge` with the Large Content Viewer. Last element of the top bar in reading order [16 R11] | none |
| `DAnimatedIcon` | SF Symbol effects | The glyph's own size (T6) | Outline, filled (selected or active), playing (§3.5, M12–M13) | Decorative inside a labelled control; standalone meaningful glyphs use `Image(_:bundle:label:)` (I5). An effect never carries meaning alone (M7) | none |

### §7 Accessibility: tab bar and corner button (new list; TA = tab accessibility)
- TA1. The tab bar container is `.accessibilityElement(children: .contain)` with `.accessibilityAddTraits(.isTabBar)`. Each item is a `Button` named by its visible label, with `.isSelected` on the current tab and no other child elements [16 R6].
- TA2. On a device with VoiceOver, every item speaks its label, "tab", its position ("n of 4") and, when current, "selected". If the device shows the role or position missing (FB19401153), items use `.accessibilityValue("Tab n of 4")`, never together with a working trait. The result is recorded in PROGRESS, or "not run" when no device is available [16 R6].
- TA3. VoiceOver order on a tab root: top bar (title, Settings), content, then Home, Live, History, Devices. A tab switch moves no VoiceOver focus [16 R6][09 R13].
- TA4. The tab bar's glyphs and labels, and the corner button's glyph, clamp at `.xLarge`. Labels are never hidden. Each item and the corner button has `accessibilityShowsLargeContentViewer` with glyph and title. At AX sizes, long press, drag and lift selects the item under the finger [16 R6][WWDC19 261].
- TA5. `performAccessibilityAudit()` passes. The only ignored issues are `.dynamicType` issues on elements whose identifier starts with `tab.` or equals `settings`; the reason (the Large Content Viewer, TA4) is recorded in DECISIONS [16 R6].
- TA6. Every tab item's hit region is its full item frame (≥ 44 × 44; 54 pt tall), with no dead gaps between items [16 R2][§2.3 touch targets].
- TA7. Voice Control input labels list the visible label first: Home ["Home"], Live ["Live", "Live View"], History ["History"], Devices ["Devices", "Laptops"], Settings ["Settings"] [16 R6][09 R6].
- TA8. The selected tab differs from the rest in four ways: filled glyph, indicator capsule, `accent.text` colour and `.isSelected`. It is identifiable in a greyscale screenshot [16 R3][C7].
- TA9. Inactive tab roots kept alive are `.accessibilityHidden(true)` and `.allowsHitTesting(false)` [16 R5].
- TA10. The Home badge is exposed as the Home item's value ("1 alert needs you"), never as colour alone [16 R5].

### §9 Review checklist (add lines)
- [ ] B6 Card separation floors hold: ΔL\*(`bg.canvas`, `bg.surface`) ≥ 4 / 10 / 6 / 14 (light / dark / light IC / dark IC). (A: `ColorTokenTests`) [16 R15]
- [ ] D5 Tab-switch recording: content cross-fades only (≤ 0.2 s, no translation), and one switch interrupted mid-flight retargets the indicator without a jump. (S) [M10][M11]
- [ ] D6 Reduce Motion recording of a tab switch: the indicator doesn't move and no icon effect plays. (S) [M11][M13]
- [ ] D7 `IconMotionTests` passes (duration, bounds, rest). (A) [M12]
- [ ] E3 No haptic on tab, corner-button or icon-effect taps. (L) [§4.2]
- [ ] H4 Device VoiceOver pass of the tab bar per TA2–TA3, or "not run" recorded. (D)
- [ ] H5 At AX5 the bar keeps its size and labels, and the Large Content Viewer shows on long press; drag and lift selects. (S/D) [TA4]
- [ ] H6 Greyscale screenshot: the selected tab is identifiable. (S) [TA8]
- [ ] L6 Tab bar overlay within 1 pt of the system bar on SE and Max. (A) [D8]
- [ ] L7 UI test: each tab keeps its pushed screen and scroll position across switches; re-tapping pops to the root. (A) [16 R5]
- [ ] L8 UI test: the bar stays hittable after scrolling. (A) [D12]
- [ ] L9 No content control changes the selected tab; only the bar and the notification deep link do. (S + grep) [16 R5]

### Other edits
- **§1.1:** "Budgets count the content area. On each tab root, the tab bar's 4 items and the corner button are chrome: `SimplicityTests` asserts exactly these 5 chrome controls and counts content separately. No Home control duplicates a tab [16 R14]." S09's budget drops History, Status and Live View.
- **§2.1 C6 (append):** "…and, while that alert is unacknowledged, as the Home tab's badge [16 R5]."
- **§2.2 type roles (add):** `tabLabel` | `.footnote` | 13/18 | Semibold | Default | Tab bar labels only | Clamped at `.xLarge` (15 pt), with the Large Content Viewer above it [16 R2, R6].
- **lead-decisions:** X19 ("No tab bar") and 02 R10 are superseded by the owner's 15:44 direction (tab bar, four tabs). 09 R1's "Not built: No tab bar" is superseded too.

## Open questions / risks
1. **Debbie Max not measured.** The bottom offset of the system bar on Face ID iPhones (34-pt home-indicator inset) wasn't measured. Run the F2 probe on Debbie Max before the overlay test sets D8's Max values.
2. **SwiftUI `.isTabBar`** may not speak "tab, n of N" (FB19401153, Aug 2025 [S41]), and the Simulator can't show it [S42]. Without a device, ship the value fallback and record TA2 as "not run".
3. **Large Content Viewer drag-across** in SwiftUI (moving between items while pressed) is documented for UIKit bars [S26]. Confirm it works across separate SwiftUI buttons. If it doesn't, each item still shows its own viewer on long press.
4. **The Simulator's tab-switch timing** (F5) comes from synthetic XCUITest taps. A real finger held longer keeps the glass lens up while pressed [S18][S43]. Debbie's interactive glass gives the same.
5. **Five tabs.** If the owner keeps the "Debbie" assistant tab, the label-size conflict (R1) needs an owner decision. List it under "Decisions to confirm".
6. **Corner margin.** Debbie aligns the corner button to its 20-pt margin; the system's sits at 16 pt. The overlay test should compare alignment with the title, not the absolute inset. This is a recorded deviation.
7. **Card tokens** (R15) change every `bg.surface` pairing. `tools/design/tokens.py --write` must re-pass all 49 pairings, and `surface.pressed` needs new values.

## Sources
- [S1] Human Interface Guidelines: Tab bars — Apple — https://developer.apple.com/design/human-interface-guidelines/tab-bars — last changed 8 Jun 2026 (Liquid Glass added 28 Jul 2025, updated 16 Dec 2025) — accessed 2026-11-14 — primary
- [S2] Human Interface Guidelines: Toolbars (absorbed navigation bars 9 Jun 2025) — Apple — https://developer.apple.com/design/human-interface-guidelines/toolbars — last changed 16 Dec 2025 — accessed 2026-11-14 — primary
- [S3] Human Interface Guidelines: Materials (Liquid Glass) — Apple — https://developer.apple.com/design/human-interface-guidelines/materials — last changed 9 Sep 2025 — accessed 2026-11-14 — primary
- [S4] Human Interface Guidelines: Color (Liquid Glass color; iOS background colors) — Apple — https://developer.apple.com/design/human-interface-guidelines/color — last changed 16 Dec 2025 — accessed 2026-11-14 — primary
- [S5] Human Interface Guidelines: Dark Mode — Apple — https://developer.apple.com/design/human-interface-guidelines/dark-mode — last changed 6 Aug 2024 — accessed 2026-11-14 — primary
- [S6] Human Interface Guidelines: Accessibility (target sizes; Reduce Motion list; gestures) — Apple — https://developer.apple.com/design/human-interface-guidelines/accessibility — last changed 9 Jun 2025 — accessed 2026-11-14 — primary
- [S7] Human Interface Guidelines: Typography (Supporting Dynamic Type) — Apple — https://developer.apple.com/design/human-interface-guidelines/typography — last changed 16 Dec 2025 — accessed 2026-11-14 — primary
- [S8] Human Interface Guidelines: VoiceOver — Apple — https://developer.apple.com/design/human-interface-guidelines/voiceover — new page 7 Mar 2025 — accessed 2026-11-14 — primary
- [S9] Human Interface Guidelines: Motion — Apple — https://developer.apple.com/design/human-interface-guidelines/motion — last changed 9 Sep 2025 — accessed 2026-11-14 — primary
- [S10] Human Interface Guidelines: SF Symbols (Design variants; Animations; Custom symbols) — Apple — https://developer.apple.com/design/human-interface-guidelines/sf-symbols — last changed 28 Jul 2025 — accessed 2026-11-14 — primary
- [S11] Human Interface Guidelines: Icons (Standard icons table) — Apple — https://developer.apple.com/design/human-interface-guidelines/icons — last changed 9 Jun 2025 — accessed 2026-11-14 — primary
- [S12] Human Interface Guidelines: Playing haptics — Apple — https://developer.apple.com/design/human-interface-guidelines/playing-haptics — last changed 7 May 2024 — accessed 2026-11-14 — primary
- [S13] Human Interface Guidelines: Sheets — Apple — https://developer.apple.com/design/human-interface-guidelines/sheets — last changed 24 Mar 2026 — accessed 2026-11-14 — primary
- [S14] Human Interface Guidelines: Modality — Apple — https://developer.apple.com/design/human-interface-guidelines/modality — last changed 5 Dec 2023 — accessed 2026-11-14 — primary
- [S15] Human Interface Guidelines: Settings — Apple — https://developer.apple.com/design/human-interface-guidelines/settings — last changed 10 Jun 2024 — accessed 2026-11-14 — primary
- [S16] Human Interface Guidelines: Branding — Apple — https://developer.apple.com/design/human-interface-guidelines/branding — last changed 9 Sep 2026 — accessed 2026-11-14 — primary
- [S17] Human Interface Guidelines: Layout (Visual hierarchy) — Apple — https://developer.apple.com/design/human-interface-guidelines/layout — last changed 9 Sep 2026 — accessed 2026-11-14 — primary
- [S18] Meet Liquid Glass (WWDC25 session 219), transcript — Apple — https://developer.apple.com/videos/play/wwdc2025/219/ — 2025-06-09 — accessed 2026-11-14 — primary
- [S19] Get to know the new design system (WWDC25 session 356), transcript — Apple — https://developer.apple.com/videos/play/wwdc2025/356/ — 2025-06-09 — accessed 2026-11-14 — primary
- [S20] Build a SwiftUI app with the new design (WWDC25 session 323), transcript — Apple — https://developer.apple.com/videos/play/wwdc2025/323/ — 2025-06-09 — accessed 2026-11-14 — primary
- [S21] What's new in SwiftUI (WWDC25 session 256), transcript — Apple — https://developer.apple.com/videos/play/wwdc2025/256/ — 2025-06-09 — accessed 2026-11-14 — primary
- [S22] Communicate your brand identity on iOS (WWDC26 session 251), transcript — Apple — https://developer.apple.com/videos/play/wwdc2026/251/ — 2026-06-08 — accessed 2026-11-14 — primary
- [S23] Refine accessibility for custom controls (WWDC26 session 220), transcript — Apple — https://developer.apple.com/videos/play/wwdc2026/220/ — 2026-06-08 — accessed 2026-11-14 — primary
- [S24] Explore navigation design for iOS (WWDC22 session 10001), transcript — Apple — https://developer.apple.com/videos/play/wwdc2022/10001/ — 2022-06-09 — accessed 2026-11-14 — primary
- [S25] Elevate your tab and sidebar experience in iPadOS (WWDC24 session 10147), transcript — Apple — https://developer.apple.com/videos/play/wwdc2024/10147/ — 2024-06-10 — accessed 2026-11-14 — primary
- [S26] Large Content Viewer – Ensuring Readability for Everyone (WWDC19 session 261), transcript — Apple — https://developer.apple.com/videos/play/wwdc2019/261/ — 2019-06-04 — accessed 2026-11-14 — primary
- [S27] Wind your way through advanced animations in SwiftUI (WWDC23 session 10157), transcript — Apple — https://developer.apple.com/videos/play/wwdc2023/10157/ — 2023-06-06 — accessed 2026-11-14 — primary
- [S28] Animate symbols in your app (WWDC23 session 10258), transcript — Apple — https://developer.apple.com/videos/play/wwdc2023/10258/ — 2023-06-08 — accessed 2026-11-14 — primary
- [S29] Perform accessibility audits for your app (WWDC23 session 10035), transcript — Apple — https://developer.apple.com/videos/play/wwdc2023/10035/ — 2023-06-06 — accessed 2026-11-14 — primary
- [S30] TabView; Tab (iOS 18); TabBarMinimizeBehavior (iOS 26); Enhancing your app's content with tab navigation — Apple Developer Documentation — https://developer.apple.com/documentation/swiftui/tabview, …/tab, …/tabbarminimizebehavior, …/enhancing-your-app-content-with-tab-navigation — undated — accessed 2026-11-14 — primary
- [S31] Applying Liquid Glass to custom views; glassEffect(_:in:); GlassEffectContainer; glassEffectID(_:in:); Glass.interactive(_:) (all iOS 26) — Apple Developer Documentation — https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views and member pages — undated — accessed 2026-11-14 — primary
- [S32] matchedGeometryEffect(id:in:properties:anchor:isSource:); keyframeAnimator(initialValue:trigger:content:keyframes:); phaseAnimator(_:trigger:content:animation:); symbolEffectsRemoved(_:); safeAreaBar(edge:alignment:spacing:content:) — Apple Developer Documentation — https://developer.apple.com/documentation/swiftui/view/… — undated — accessed 2026-11-14 — primary
- [S33] accessibilityShowsLargeContentViewer() and (_:); UILargeContentViewerInteraction; AccessibilityTraits.isTabBar; UIAccessibilityTraits.tabBar — Apple Developer Documentation — https://developer.apple.com/documentation/swiftui/view/accessibilityshowslargecontentviewer(_:), …/uikit/uilargecontentviewerinteraction, …/swiftui/accessibilitytraits/istabbar, …/uikit/uiaccessibilitytraits/tabbar — undated — accessed 2026-11-14 — primary
- [S34] SensoryFeedback.press(_:), SensoryFeedback.PressFeedback, PressFeedback.tab ("Only plays feedback on visionOS") — Apple Developer Documentation — https://developer.apple.com/documentation/swiftui/sensoryfeedback/pressfeedback/tab — undated (iOS 26.0) — accessed 2026-11-14 — primary
- [S35] UITabBarController (Overview: "User taps always display the root view of the tab… even if the tab was already selected"; the More item); UITabBarControllerDelegate tabBarController(_:animationControllerForTransitionFrom:to:) — Apple Developer Documentation — https://developer.apple.com/documentation/uikit/uitabbarcontroller — undated — accessed 2026-11-14 — primary
- [S36] Local SDK, iPhoneOS26.5.sdk in Xcode 26.6 (17F113): SwiftUICore and SwiftUI `.swiftinterface` (arm64e-apple-ios) for `isTabBar` (iOS 17.0), `PressFeedback.tab`, `safeAreaBar(edge: VerticalEdge…)` (iOS 26.0), `accessibilityShowsLargeContentViewer` (`@ViewBuilder`, iOS 15.0), `KeyframeTimeline` (`duration`, `value(time:)`, `value(progress:)`); UIKit `UIAccessibilityConstants.h` (`UIAccessibilityTraitTabBar` comment), `UILargeContentViewer.h`, `UITabBarController.h`; XCUIAutomation `XCUIApplication.h` (`performAccessibilityAuditWithAuditTypes:issueHandler:error:`, iOS 17) — Apple — /Applications/Xcode.app/Contents/Developer/Platforms/iPhoneOS.platform/… — SDK 26.5 — accessed 2026-11-14 — primary (verified in local SDK)
- [S37] Local probe: system `TabView` (4 tabs, large titles, top-trailing toolbar button) on a new iPhone SE (3rd generation) Simulator, iOS 26.5 (23F77), light, default text and AX5; XCUITest frame log; `simctl io recordVideo` (variable frame rate, ≈ 60 Hz while animating), frames and per-frame luminance inspected; screenshots profiled per pixel; device deleted afterwards. Evidence: `Design/reviews/research/16-tab-probe/` (`system-tabbar-SE-default.png`, `system-tabbar-SE-AX5.png`, `system-tab-switch-frames.png`, `system-tab-select-bar-frames.png`) — this project — 2026-11-14 16:18–16:28 EST — primary (measured)
- [S38] Local computation on this Mac (macOS 26.2): `SwiftUI.Spring` timings and a `KeyframeTimeline` sample (Swift script); SF Pro Semibold label widths via AppKit; WCAG ratio, CIELAB ΔL\* and CIEDE2000 with `tools/design/tokens.py`'s functions over the working-tree `Design/tokens/colors.json` values — this project — 2026-11-14 — primary (computed)
- [S39] "[iOS 18] UITabBarController disable new switching animation" (thread 763122; DTS Engineer's reply is the accepted answer) — Apple Developer Forums — https://developer.apple.com/forums/thread/763122 — Sep 2024 to Mar 2025 — accessed 2026-11-14 — secondary
- [S40] Causes and countermeasures for lifecycle delays when switching tabs in iOS 18 — Classmethod (Wada Kenji) — https://dev.classmethod.jp/en/articles/ios18-uitabbarcontroller-lifecycle-change/ — 2025-01-21 — accessed 2026-11-14 — secondary
- [S41] "Custom tab bar in SwiftUI" (thread 795761; Frameworks Engineer: "this may be a bug"; FB19401153) — Apple Developer Forums — https://developer.apple.com/forums/thread/795761 — Aug 2025 — accessed 2026-11-14 — secondary
- [S42] Building an Accessible Custom Tab Bar — Bas Broek — https://www.basbroek.nl/custom-tab-bar-accessibility — 2022-04-19 — accessed 2026-11-14 — secondary
- [S43] iOS and iPadOS 26: The MacStories Review, "Buttons, Toolbars, and Tab Bars" — MacStories (Federico Viticci) — https://www.macstories.net/stories/ios-and-ipados-26-the-macstories-review/3 — Sep 2025 — accessed 2026-11-14 — secondary
- [S44] 2025 Summer Release: Now you can Airbnb more than an Airbnb — Airbnb Newsroom — https://news.airbnb.com/en-in/2025-summer-release-now-you-can-airbnb-more-than-an-airbnb/ — 2025-05-14 — accessed 2026-11-14 — primary (Airbnb's own description)
- [S45] Airbnb app redesign — It's Nice That — https://www.itsnicethat.com/articles/airbnb-app-redesign-140525 — 2025-05-14 — accessed 2026-11-14 — secondary
- [S46] CupertinoColors.systemBackground and .secondarySystemBackground (Flutter's mirror of UIKit's dynamic colours: light, dark, high-contrast and elevated values) — Flutter API docs — https://api.flutter.dev/flutter/cupertino/CupertinoColors/secondarySystemBackground-constant.html — undated — accessed 2026-11-14 — secondary
- [S47] Project context (read only): sibling notes 01 (F3 jury table, R12), 02 (F7–F8, R3–R13), 03 (R1–R14), 04 (F3, R3), 05 (T13), 06, 07 (R4), 08 (R11), 09 (F1–F3, R1–R13), 10 (R18), 14 (R1); lead-decisions X6, X19, X21, X44; CRAFT.md (HEAD and working tree 16:2x); working tree `DebbieTabBar.swift`, `IconMotion.swift`, `Motion.swift`, `Views.swift`, `colors.json` — this project — 2026-11-14 — primary (project context)
- [S48] Modernize your UIKit app (WWDC26 session 278), transcript ("New in iOS 27, iPhone apps can also opt into sidebars") — Apple — https://developer.apple.com/videos/play/wwdc2026/278/ — 2026-06-08 — accessed 2026-11-14 — primary
