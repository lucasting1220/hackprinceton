# 07 Typography and layout
_Researched 2026-11-14. Toolchain: Xcode 26.6 / iOS 26.5 SDK. Current public iOS: iOS 27.2.1 (released 9 Nov 2026). iOS 27.0 shipped on 14 Sep 2026, and iOS 27.1 (23 Oct 2026) was for iPhone Duo only. iOS 26.7.3 is the current iOS 26 update [S1]. Apps built with the iOS 26.5 SDK run on iOS 27. The only typography or layout API discussed below that needs the iOS 27 SDK is iPhone Duo's `ReservedRegion` / `ArrangementView` (absent from the local SDK)._

## Questions answered

> "Typography and layout: system typefaces, Dynamic Type, legibility for older users, spacing systems, touch-target sizes." (KICKOFF_PROMPT.md §9, topic 7)

The assignment adds these questions, all answered below:
- **Typefaces:** SF Pro, SF Pro Rounded and New York, and the licence position for system fonts.
- **Dynamic Type:** the full iOS size table at every content size, xSmall to AX5. The APIs: `Font.TextStyle`, `@ScaledMetric`, `dynamicTypeSize` / `isAccessibilitySize` and `ViewThatFits`.
- **Layout behaviour:** reflow at accessibility sizes, truncation rules and the caveats of `minimumScaleFactor`.
- **Layout geometry:** line length and `readableContentGuide`, margins and safe areas, and a 4/8-point spacing system.
- **Touch targets:** HIG, WCAG 2.5.5 and 2.5.8, and studies with older adults.
- **Legibility for older users.**
- **Proposals for Debbie:** a type scale, a spacing scale and target sizes.

## Summary

- **System typefaces only.** Use SF Pro (system default) and SF Pro Rounded (`Font.Design.rounded`) through the APIs. Apple says "don't embed system fonts in your app", so no font is bundled and no licence entry is needed [S2][S7].
- **Use the text styles and let them scale.** iOS has 11 text styles at 12 content sizes. Body is 17/22 pt by default and 53/62 pt at AX5, which is 3.1× the default. That exceeds the HIG's "at least 200 percent" and WCAG 1.4.4's 200% [S2][S3][S14]. The full table is in F2.
- **Legibility floor.** The HIG gives 17 pt default and 11 pt minimum, and says to avoid Ultralight, Thin and Light weights [S2][S3]. Debbie is for older users and stressed caregivers, so its floor is Footnote (13 pt at default), with no Caption styles and Regular weight or heavier. SF applies size-specific tracking automatically, so don't add tracking [S2][S8].
- **Reflow, don't truncate.**
  - At accessibility sizes, switch horizontal layouts to vertical with `AnyLayout` keyed on `dynamicTypeSize.isAccessibilitySize`, or use `ViewThatFits` [S9][S11].
  - Truncation and `minimumScaleFactor` defeat the user's chosen size. The HIG asks to show as much text at the largest accessibility size as at the largest standard size [S2].
- **Spacing has a 4-pt base.** Every numeric spacing value Apple documents for iPhone (44, 28, 12 and 24 pt) [S3][S5], and the 20-pt minimum-margin example in UIKit's documentation [S11], is a multiple of 4. Debbie uses 4, 8, 12, 16, 20, 24, 32 and 48 pt, each with a defined use (R10).
- **Target sizes.**
  - HIG: a 44×44 pt hit region (28×28 pt is the absolute minimum) [S3][S5].
  - WCAG 2.5.5 (AAA) asks for 44×44 and 2.5.8 (AA) for 24×24 CSS px [S14]. WCAG2ICT maps a CSS px to an iOS pt [S15].
  - On a 460-ppi @3x iPhone, 44 pt is only 7.3 mm [S19][S20].
  - In a study of 40 adults aged 65–95, tap accuracy dropped significantly below 14 mm (about 85–90 pt), and spacing between targets had no significant effect [S16].
  - So Debbie's resident controls are ≥ 96 pt tall and caregiver primary actions ≥ 64 pt.
- **iOS 27 changed little for typography.** The HIG Typography page hasn't changed since 16 Dec 2025, when emphasized weights were added [S2]. Layout was "updated to reflect current best practices" on 9 Sep 2026, and iPhone Duo arrived with reserved regions and side-mounted bars [S4][S6]. Its APIs aren't in the 26.5 SDK, so Duo-specific layout waits.
- **Recent additions already in our SDK.** The iOS 26 SDK added `lineHeight(_:)` and `AttributedString.LineHeight` (.tight, .loose, .multiple, .exact). SwiftUI's `accessibilityShowBorders` is back-deployed (Show Borders was introduced in iOS 26.1) [S12].

## Findings

### F1. System typefaces and the licence position

- **The families.** San Francisco covers SF Pro, SF Compact, SF Mono and the script variants, with rounded variants "to coordinate text with the appearance of soft or rounded UI elements, or to provide an alternative typographic voice". New York is the serif companion [S2].
- **Variable fonts with optical sizing.** System fonts are variable fonts with *dynamic optical sizes*. SF Pro's design transitions "from Text to Display between 17 and 28 points" [S2][S8].
- **Weights and widths.** Nine weights (Ultralight to Black) and four widths (Condensed and Expanded among them) [S2][S7].
- **Use system fonts through the API, don't embed them.** "You can use the constants defined in Font.Design to access all system fonts — don't embed system fonts in your app" [S2]. The downloadable SF fonts carry Apple's "LICENSE AGREEMENT FOR THE APPLE SAN FRANCISCO FONT — For iOS, OS X and tvOS application uses only". They are for design work; the app never ships the files [S7]. So Debbie needs no typeface licence entry in `docs/DECISIONS.md`, which is consistent with the brief's "Apple's system typefaces are allowed".
- **Few typefaces.** "Minimize the number of typefaces you use, even in a highly customized interface" [S2]. Apple itself pairs SF Pro Rounded with text styles in Reminders [S8].
- **Bold Text comes for free.** System fonts respond to Bold Text; custom fonts must implement it themselves [S2]. SwiftUI exposes this as `EnvironmentValues.legibilityWeight` (verified in local SDK) [S12].
- **Declarations** (verified in local SDK) [S12]:
  - `Font.Design` cases `default`, `serif`, `rounded` and `monospaced`;
  - `Text.fontDesign(_:)` (iOS 16.1+) and `fontWidth(_:)` (iOS 16+);
  - `monospacedDigit()`, iOS 15+.

### F2. iOS Dynamic Type sizes (HIG Specifications, reproduced)

Size / leading in points. The asterisk marks the default, "Large". Each row also gives the style's default weight and, after the arrow, its emphasized weight (the weight `.bold()` produces). "Point size based on image resolution of 144 ppi for @2x and 216 ppi for @3x designs" [S2].

| Style (weight → emphasized) | xS | S | M | L* | xL | xxL | xxxL | AX1 | AX2 | AX3 | AX4 | AX5 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Large Title (Regular → Bold) | 31/38 | 32/39 | 33/40 | 34/41 | 36/43 | 38/46 | 40/48 | 44/52 | 48/57 | 52/61 | 56/66 | 60/70 |
| Title 1 (Regular → Bold) | 25/31 | 26/32 | 27/33 | 28/34 | 30/37 | 32/39 | 34/41 | 38/46 | 43/51 | 48/57 | 53/62 | 58/68 |
| Title 2 (Regular → Bold) | 19/24 | 20/25 | 21/26 | 22/28 | 24/30 | 26/32 | 28/34 | 34/41 | 39/47 | 44/52 | 50/59 | 56/66 |
| Title 3 (Regular → Semibold) | 17/22 | 18/23 | 19/24 | 20/25 | 22/28 | 24/30 | 26/32 | 31/38 | 37/44 | 43/51 | 49/58 | 55/65 |
| Headline (Semibold → Semibold) | 14/19 | 15/20 | 16/21 | 17/22 | 19/24 | 21/26 | 23/29 | 28/34 | 33/40 | 40/48 | 47/56 | 53/62 |
| Body (Regular → Semibold) | 14/19 | 15/20 | 16/21 | 17/22 | 19/24 | 21/26 | 23/29 | 28/34 | 33/40 | 40/48 | 47/56 | 53/62 |
| Callout (Regular → Semibold) | 13/18 | 14/19 | 15/20 | 16/21 | 18/23 | 20/25 | 22/28 | 26/32 | 32/39 | 38/46 | 44/52 | 51/60 |
| Subhead (Regular → Semibold) | 12/16 | 13/18 | 14/19 | 15/20 | 17/22 | 19/24 | 21/28 | 25/31 | 30/37 | 36/43 | 42/50 | 49/58 |
| Footnote (Regular → Semibold) | 12/16 | 12/16 | 12/16 | 13/18 | 15/20 | 17/22 | 19/24 | 23/29 | 27/33 | 33/40 | 38/46 | 44/52 |
| Caption 1 (Regular → Semibold) | 11/13 | 11/13 | 11/13 | 12/16 | 14/19 | 16/21 | 18/23 | 22/28 | 26/32 | 32/39 | 37/44 | 43/51 |
| Caption 2 (Regular → Semibold) | 11/13 | 11/13 | 11/13 | 11/13 | 13/18 | 15/20 | 17/22 | 20/25 | 24/30 | 29/35 | 34/41 | 40/48 |

Notes:
- **Category names in each API.** SwiftUI's `DynamicTypeSize` cases are `xSmall` … `xxxLarge` and `accessibility1` … `accessibility5` (verified in local SDK) [S12]. `simctl` calls them `extra-small` … `accessibility-extra-extra-extra-large` [S13].
- **How to reach AX sizes.** By default people choose from 7 sizes. Turning on Larger Accessibility Sizes adds 5 more [S9].
- **Leading variants.** Tight and loose leading change line height by 2 pt on iOS [S8].

### F3. Tracking: the system already applies it

- **Automatic.** "In a running app, the system font dynamically adjusts tracking at every point size." Tracking tables exist only for mockups [S2].
- **SF Pro tracking** goes from +0.06 pt at 11 pt, to −0.43 pt at 17 pt, −0.45 pt at 20 pt and +0.38 pt at 28 pt [S2].
- **SF Pro Rounded is looser at text sizes:** +0.56 pt at 11 pt, +0.37 pt at 17 pt and +0.36 pt at 28 pt [S2]. Rounded therefore sets body text noticeably wider than SF Pro (Reasoning from the tables).
- **Making a string fit.** Apple advises against `kerning` hacks. Use the tracking API or, better, allow automatic tightening, which "will try to make a string fit within a range that's reasonable for legibility… there is such a thing as too much tracking… for those cases, it's just better to let things truncate" [S8]. SwiftUI's `allowsTightening(_:)` is verified in local SDK [S12].

### F4. Dynamic Type APIs (all verified in the local iOS 26.5 SDK [S12])

- **Text styles.** `Font.TextStyle` / `Font.body`, `.headline` and so on, including `Font.extraLargeTitle` and `extraLargeTitle2`, which the HIG describes for visionOS [S2].
- **`@ScaledMetric(wrappedValue:relativeTo:)`.** Scales spacing and image sizes with the text style. WWDC24 uses it to size non-symbol images next to text [S9][S11].
- **Reading the current size.** `EnvironmentValues.dynamicTypeSize`, with `DynamicTypeSize.isAccessibilitySize` returning true for AX1–AX5.
- **Clamping.** `View.dynamicTypeSize(_ range:)` clamps a subtree to a range, for example `...DynamicTypeSize.accessibility3`.
- **Choosing a layout.**
  - `ViewThatFits` (iOS 16) "selects the first child whose ideal size on the constrained axes fits", so children are listed largest first [S11].
  - `AnyLayout` (iOS 16) swaps `HStackLayout` and `VStackLayout` without losing view identity. WWDC24 demonstrates exactly this, keyed on `dynamicTypeSize` [S9].
- **Line limits and truncation.**
  - `lineLimit(_:)`, `lineLimit(_:reservesSpace:)` (iOS 16), `truncationMode(_:)` and `allowsTightening(_:)`.
  - `minimumScaleFactor(_:)` "draws its text in a font size as small as half of the actual font" at 0.5. It only acts when text doesn't fit [S11].
- **Line height.** `lineHeight(_:)` / `EnvironmentValues.lineHeight` (iOS 26), taking `AttributedString.LineHeight` with `.variable`, `.normal`, `.tight`, `.loose`, `.multiple(factor:)`, `.leading(increase:)` and `.exact(points:)` (declared in the CoreText overlay, iOS 26). There is also the older `Font.leading(_:)` (`.tight` / `.standard` / `.loose`).
- **Large content viewer.** `accessibilityShowsLargeContentViewer()`, for controls that can't grow, such as tab bars [S9].
- **UIKit equivalents.**
  - `UIFontMetrics` (`metricsForTextStyle:`, `scaledFontForFont:`, `scaledValueForValue:`). It "can also… scale a constant value for custom layout, like… the spacing between the two labels" [S8].
  - `UIContentSizeCategoryIsAccessibilityCategory`, `readableContentGuide`, `systemMinimumLayoutMargins` and `UILargeContentViewerInteraction`.

### F5. Layout at large sizes: reflow, truncation, scaling

- **HIG rules for large sizes** [S2]:
  - "Make sure your app's layout adapts to all font sizes."
  - "Increase the size of meaningful interface icons as font size increases."
  - "Keep text truncation to a minimum… aim to display as much useful text at the largest accessibility font size as you do at the largest standard font size. Avoid truncating text in scrollable regions unless people can open a separate view to read the rest."
  - "Consider using a stacked layout where text appears above secondary items… reduce the number of columns."
  - "Keep primary elements toward the top of a view even when the font size is very large."
  - "Prioritize important content… people… don't always want to increase the size of every word on the screen. For example… tab titles."
- **HIG Layout** [S4]:
  - "horizontally adjacent views may need to stack vertically"
  - "table rows… may need to grow in height so that text isn't cropped"
  - "Preview… the largest and the smallest layouts."
- **WWDC19 principles** [S10]:
  - "make as much of your text dynamic as possible";
  - "use as much of the screen width as possible";
  - "don't truncate text as it grows";
  - "scale glyphs that appear next to text".
- **WWDC24** [S9]:
  - set line count to zero (unlimited) to avoid truncation;
  - watch for text clipped by fixed-height containers;
  - switch HStack to VStack for accessibility sizes;
  - use the large content viewer for controls that can't scale.
- **Why `minimumScaleFactor` is risky** (Reasoning from [S2][S11]):
  - It shrinks text below the size the person asked for. At 0.5 it undoes AX settings completely.
  - It only triggers when text overflows its line limit, so it hides layout bugs.
  - Use it only for short, fixed-size numerals inside a badge, with a floor of 0.8.

### F6. Line length, margins and safe areas

- **Readable width.** UIKit's `readableContentGuide` defines "an area that can easily be read without forcing users to move their head to track the lines". Its width "is equal to or less than the readable width defined for the current dynamic text size", and it never extends beyond the layout margins [S11]. On iPhone in portrait the margins are the binding limit. Readable width matters on wide containers: iPad, or the iPhone Duo inner display [S6] (Reasoning).
- **Margins.** `systemMinimumLayoutMargins` holds "the minimum layout margins expected by the system for the view controller's root view". Apple's documentation example is a 20-point system minimum ("if the value for one system minimum margin is 20 points and you specify… 10… the view uses… 20"). Don't override it; read it at run time [S11].
- **Safe areas.** "Respecting the safe area is essential to make sure system UI and hardware features like the Dynamic Island don't obstruct content and controls" [S4].
  - Full-screen background content should extend under bars.
  - Controls should be set apart from content with Liquid Glass and scroll-edge effects, not opaque backgrounds [S4].
  - SwiftUI `safeAreaPadding(_:)` and `contentMargins(_:for:)` are present (verified in local SDK) [S12].
- **Size classes, not device type.** "Determine layout based on size classes, not device type or orientation" [S4].
- **iPhone Duo (iOS 27.1)** [S6]:
  - It adds *reserved regions*: the outer camera, the inner camera when active, and the fold.
  - Toolbars and tab bars move to the side on the outer display.
  - The HIG asks apps to "Build your app to resize", avoid fixed widths, and use `ReservedRegion` / `ArrangementView`.
  - Those APIs are **not in the iOS 26.5 SDK** (grep of the SwiftUI, SwiftUICore and UIKit interfaces found nothing) [S12], so this needs the iOS 27 SDK.

### F7. Spacing: what Apple specifies and how its layouts space things

- **What the current HIG Layout page covers.** It is about relationships, not a numeric grid [S4]:
  - order by importance, top and leading;
  - "Align elements to make them easier to scan, and use indentation to convey hierarchy";
  - "Group related items… negative space, container shapes, or separator lines";
  - progressive disclosure.
- **Apple's numeric spacing guidance for iPhone:**
  - "about 12 points of padding around elements that include a bezel. For elements without a bezel, about 24 points of padding works well around the element's visible edges" [S3];
  - a 44×44 pt hit region [S5];
  - the 28×28 pt absolute minimum [S3];
  - the 20-pt margin example [S11].
- **Other platforms** use 40 pt grid gaps and 60/80 pt safe insets on tvOS, and 60-pt button-centre spacing on visionOS [S4].
- **Line-height rhythm.** Every iOS Dynamic Type leading is a whole number of points (F2) [S2].
- **Conclusion** (Reasoning): a 4-pt base unit reproduces all of Apple's iPhone values exactly (12 = 3×4, 24 = 6×4, 44 = 11×4, 28 = 7×4, 20 = 5×4). An 8-pt-only grid can't express 12, 20, 28 or 44.

### F8. Touch targets

- **Apple.**
  - "A button needs a hit region of at least 44x44 pt — in visionOS, 60x60 pt" [S5].
  - iOS "Default control size 44x44 pt; Minimum control size 28x28 pt".
  - "Consider spacing between controls as important as size" (12 pt bezeled, 24 pt borderless) [S3].
  - Every custom button must have a press state [S5].
- **WCAG 2.2** [S14]:
  - **2.5.5 Target Size (Enhanced), AAA:** at least 44 by 44 CSS px.
  - **2.5.8 Target Size (Minimum), AA:** at least 24 by 24 CSS px. Smaller targets pass only if a 24-px circle centred on each doesn't intersect another target or circle.
  - WCAG2ICT: for non-web software "use platform-defined density-independent pixel measurements… points (pt) for iOS" [S15].
- **Physical size** (computed from Apple's specs):

  | Device class | Display | Size of 1 pt | 44 pt | 64 pt | 96 pt |
  |---|---|---|---|---|---|
  | iPhone 17, 18 Pro, 18 Pro Max [S19][S20] | 460 ppi, @3x | 0.166 mm | 7.3 mm | 10.6 mm | 15.9 mm |
  | iPhone 11 [S21] | 326 ppi (1792×828 px, 414 pt wide), @2x | 0.156 mm | 6.9 mm | 10.0 mm | 15.0 mm |

- **Older adults (secondary, peer-reviewed). Leitão & Silva 2012** [S16]:
  - 40 adults aged 65–95 (mean 76.9) on a smartphone.
  - Tap accuracy was "significantly lower for button sizes below 14 mm", with no significant differences above 14 mm. Targets were judged satisfactory at ≥ 97% mean accuracy: ≥ 14 mm for tap and ≥ 17.5 mm for swipe.
  - "Spacing between targets did not show significant effects in either of the tasks."
  - The authors note that official guidelines (7–9 mm) are "considerably smaller" than their findings.
  - In iOS points, 14 mm is 84.5 pt at 460 ppi @3x and 89.8 pt at 326 ppi @2x.
- **Motor-control disabilities. Chen et al. 2013** [S17]:
  - 53 participants, 38 of them with motor-control disabilities. Buttons were 10–30 mm.
  - "As button size increased, there was a decrease in misses, errors, and time." Non-disabled performance "plateaued at button size 20 mm", while the disabled group "continued to improve".
  - "Gap size did not affect user performance" (1 vs 3 mm).
- **General adults, one-handed thumb. Parhi, Karlson & Bederson 2006:** 9.2 mm for discrete and 9.6 mm for serial targets [S18]. This is from the abstract and summaries; the paper wasn't read in full. 9.6 mm is about 58–62 pt.

### F9. Legibility for older users

- **Default and minimum sizes.** The HIG's iOS default is 17 pt and the minimum 11 pt. "If you use a custom font with a thin weight, aim for larger than the recommended sizes" [S2][S3].
- **Weights.** "In general, avoid light font weights… prefer Regular, Medium, Semibold, or Bold… avoid Ultralight, Thin, and Light" [S2].
- **Contrast sensitivity.** Older adults lose contrast sensitivity at intermediate and high spatial frequencies, worse in low light [S22]. Thin strokes and small x-heights are exactly those high spatial frequencies (Reasoning). So weight and size matter as well as colour contrast; see `06-colour.md` R2, where all text is ≥ 7:1.
- **Line spacing.**
  - The system body leading is 22/17 ≈ 1.29× the size [S2]. Loose leading adds 2 pt [S8], giving 24/17 ≈ 1.41×.
  - WCAG 1.4.12 (for markup-based content) requires that content survive a user override to line height 1.5×, paragraph spacing 2×, letter spacing 0.12× and word spacing 0.16× [S14]. That isn't a native requirement, but it shows the direction: more space helps.
  - The HIG: "If you need to display three or more lines of text, avoid tight leading", and loose leading helps people "keep their place" in long passages [S2].
- **Scaling range.** Body at AX5 (53 pt) is 3.1× the default. "Ideally, give people the option to enlarge text by at least 200 percent" [S3]. WCAG 1.4.4 asks for 200% "without loss of content or functionality" [S14].

## What changed in the current iOS release

- **Current release.** iOS 27.2.1 (9 Nov 2026), on iPhone 11 and later. iOS 27.1 (23 Oct 2026) shipped only for iPhone Duo [S1].
- **HIG Typography: no iOS 27 change.** The last entry is 16 Dec 2025, "Added emphasized weights to the Dynamic Type style specifications", so the F2 table (with the emphasized-weight column) is current. The 7 + 5 content sizes are unchanged [S2][S9].
- **HIG Layout, 9 Sep 2026.** "Updated guidance to reflect current best practices" [S4]. The page now centres on Liquid Glass separation of controls and content, scroll-edge effects, size classes and safe areas, and points to "Device Hub" for testing. Device Hub appears to belong to a newer Xcode; it wasn't checked in Xcode 26.6 (open question).
- **Designing for iPhone Duo, 9 Sep 2026; device on iOS 27.1** [S6][S1]:
  - It adds reserved regions (fold and cameras), vertical toolbars and tab bars on the side, and `ArrangementView`, `ReservedRegion` and `ToolbarItemVisibilityPriority`.
  - These **need the iOS 27 SDK** (absent locally [S12]).
  - With standard components and resizable layouts, apps "automatically adapt… with little adjustment required" [S6]. Debbie's custom bars won't move to the side automatically (Reasoning).
- **Liquid Glass in iOS 27** (secondary report): a transparency slider, darker glass edges, and a uniform top toolbar when content scrolls under bars. Existing apps get these without recompiling [S23]. That only affects system bars Debbie keeps.
- **SDK changes within iOS 26.x that matter for type and controls** (verified in local SDK) [S12]:
  - **iOS 26:** `lineHeight(_:)` and `AttributedString.LineHeight`.
  - **iOS 26.1:** Button Shapes renamed **Show Borders** (`accessibilityShowBorders`, back-deployed). Text-only custom buttons must show a border or underline when it is on.
  - **iOS 26.4:** `accessibilityReduceHighlightingEffects`.

## Recommendations for Debbie

1. **R1: System typefaces only, used through the API.** ADOPT-TONIGHT (no licence risk; best legibility and automatic Dynamic Type and Bold Text [S2][S7]).
   - SF Pro (`.default`) for all running text and controls.
   - SF Pro Rounded (`.fontDesign(.rounded)`) only for the hero line and large numerals.
   - No New York, no SF Mono and no bundled fonts.
   - Record "system fonts via API; nothing bundled" in `docs/DECISIONS.md`. No licence is needed.
2. **R2: Type roles.** ADOPT-TONIGHT (it gives `CRAFT.md` a checkable scale tied to Dynamic Type [S2]). Every `Text` uses one of these tokens; raw `.font(.system(size:))` is linted out of feature code.

   | Role | Text style | Default size/leading | Weight | Design | Use |
   |---|---|---|---|---|---|
   | `hero` | `.largeTitle` | 34/41 | Bold | Rounded | One per screen: status headline ("All quiet at home", "Possible fall") |
   | `title` | `.title2` | 22/28 | Bold | Rounded | Screen and section titles inside content |
   | `headline` | `.headline` | 17/22 | Semibold | Default | Alert titles, row and card titles |
   | `body` | `.body` | 17/22 | Regular | Default | Every sentence, including alert bodies and explanations |
   | `bodyStrong` | `.body` | 17/22 | Semibold | Default | Key facts inside body text (times, names) |
   | `button` | `.body` | 17/22 | Semibold | Default | All button labels |
   | `secondary` | `.subheadline` | 15/20 | Regular | Default | Timestamps, metadata, helper lines |
   | `footnote` | `.footnote` | 13/18 | Regular | Default | Legal and help text only; the smallest text in the app |
   | `metric` | `.largeTitle` | 34/41 | Semibold + `monospacedDigit()` | Rounded | Heart rate, live-view countdown (digits don't jitter) |
   | `resident.metric` | `.largeTitle` scaled by `@ScaledMetric(relativeTo: .largeTitle)` from 64 pt | 64 at Large | Bold + `monospacedDigit()` | Rounded | Last heart-rate reading in resident mode |
   | `resident.body` | `.title3` | 20/25 | Regular (Semibold for button labels) | Default | All resident-mode text |

3. **R3: Banned styles.** ADOPT-TONIGHT.
   - `.caption` and `.caption2`, because 12 and 11 pt sit at or near the HIG floor (Reasoning: older users [S2][S22]).
   - Ultralight, Thin and Light weights [S2].
   - Italic for running text.
   - All-caps strings longer than one word (the "LIVE" badge is the only all-caps string).
   - Manual `tracking` or `kerning` on system text [S2][S8].
   - Tight leading on any text that can reach 3 or more lines [S2].
4. **R4: Every role scales from xSmall to AX5, with three bounded exceptions.** ADOPT-TONIGHT (the brief requires the largest accessibility sizes; the HIG allows prioritising [S2]).
   - **`hero` clamps at `.accessibility3` (52 pt).** Reasoning: at AX5, 60 pt rounded bold puts about 35 pt per character. A 10-letter word like "Monitoring" then needs about 350 pt, more than the 335 pt line on a 375-pt-wide phone with 20-pt margins. The word would break mid-word. Verify by snapshot.
   - **Custom tab-bar labels clamp at `.xxxLarge`** and use `accessibilityShowsLargeContentViewer()` [S9].
   - **The live badge clamps at `.xxxLarge`.** It is announced by VoiceOver and repeated in body text below the video.
   - Everything else is unclamped.
5. **R5: Reflow rule.** ADOPT-TONIGHT ([S2][S4][S9]).
   - When `dynamicTypeSize.isAccessibilitySize` is true, any HStack holding text plus an accessory (icon, time, chevron, toggle) becomes a VStack through `AnyLayout`. The text comes first and the accessory sits below, aligned leading.
   - Button pairs use `ViewThatFits(in: .horizontal)` with the side-by-side layout first and the stacked layout second.
   - Lists never use more than one column on iPhone.
   - The primary element (status or alert) stays first in reading order at every size.
6. **R6: Truncation rules.** ADOPT-TONIGHT ([S2][S9][S10]).
   - Default `lineLimit(nil)`, so text wraps.
   - Truncation (`.tail`) is allowed only for user-entered names (phone and laptop names) in single-line rows that open a detail view showing the full name.
   - Never truncate alert titles or bodies, status lines, error messages or button labels.
   - Every container that holds text has no fixed height. Use `minHeight` instead.
7. **R7: `minimumScaleFactor` is banned except for numeral badges**, where it must be ≥ 0.8. ADOPT-TONIGHT (it silently overrides the user's text size [S11]; Reasoning in F5).
   - The badge exception covers the live countdown and the heart-rate value when inside a fixed-size chip.
   - `allowsTightening(true)` is allowed only on single-line control labels [S8].
8. **R8: Leading.** ADOPT-TONIGHT (HIG and WWDC20 [S2][S8]; the APIs are in the iOS 26 SDK [S12]).
   - Keep system leading for one- and two-line text.
   - Paragraphs that can reach 3 or more lines (alert bodies, onboarding, permission priming) use loose leading: `.lineHeight(.loose)` on iOS 26 and later, falling back to `Font.leading(.loose)`. That is +2 pt, so body becomes 24/17 ≈ 1.41× instead of 1.29×.
   - Paragraph spacing is 12 pt (R10, `space.12`).
9. **R9: Icons scale with their text.** ADOPT-TONIGHT ("Increase the size of meaningful interface icons as font size increases" [S2]).
   - Every custom glyph next to text is sized by `@ScaledMetric(relativeTo:)` using its neighbour's text style. Base sizes: 17 pt for body and headline glyphs, 22 pt for title glyphs, 28 pt for the hero glyph.
   - Glyph and label share one baseline. Glyphs in VoiceOver-labelled controls are `accessibilityHidden`.
10. **R10: Spacing scale.** ADOPT-TONIGHT (Apple's numbers fit a 4-pt base [S3][S5][S11]; Reasoning F7).
    - Only these values are allowed, as tokens:

      | Token | Value | When to use |
      |---|---|---|
      | `space.4` | 4 pt | Icon-to-label gap inside chips and badges; between a value and its unit ("72" "bpm") |
      | `space.8` | 8 pt | Between tightly related lines (title ↔ subtitle in a row); icon ↔ label in buttons |
      | `space.12` | 12 pt | Chip and badge inner padding; **minimum gap between adjacent bezeled controls** [S3]; paragraph spacing |
      | `space.16` | 16 pt | Inner padding of cards and list rows; gap between cards in a list |
      | `space.20` | 20 pt | **Screen side margins** on iPhone; padding inside the status header |
      | `space.24` | 24 pt | Between groups within a screen; **clearance around borderless text buttons** [S3] |
      | `space.32` | 32 pt | Between major regions (status header ↔ alerts list); separation of destructive actions (Unpair) from other buttons |
      | `space.48` | 48 pt | Top and bottom breathing room in hero, empty and onboarding screens |

    - Intra-component values (`space.4` to `space.16`) scale with `@ScaledMetric(relativeTo: .body)` [S8][S11].
    - Screen margins (`space.20`) and region gaps do *not* scale, to keep width for text at AX sizes (Reasoning).
    - Lint: no numeric literals in `.padding`, `spacing:` or `.frame` outside the DesignSystem module.
11. **R11: Margins and safe areas.** ADOPT-TONIGHT ([S4][S11]).
    - Content sits inside the safe area with 20 pt horizontal margins. If `systemMinimumLayoutMargins` is ever larger, the larger value wins.
    - Only two things go full-bleed: backgrounds (`bg.canvas`, the urgent banner background) and the live video.
    - Nothing interactive goes under the Dynamic Island, status bar or home indicator.
    - Use `safeAreaPadding` / `contentMargins` rather than hard-coded insets.
    - Bottom-anchored primary buttons sit 16 pt above the bottom safe-area edge.
12. **R12: Touch targets, in three tiers.** ADOPT-TONIGHT (HIG 44 pt [S3][S5], WCAG 2.5.5 via WCAG2ICT [S14][S15], older-adult evidence [S16][S17]).
    1. **Every interactive element:** hit region ≥ **44×44 pt**. The HIG's 28-pt minimum is never used.
    2. **Caregiver primary actions** (Acknowledge, Call, Open live view, Stop, Pair, Approve laptop): visual height ≥ **64 pt** (≥ 10 mm on every supported iPhone), full width minus margins.
    3. **Resident-mode controls** (Sync now, Live view on/off, permission buttons): visual height ≥ **96 pt** (15.0–15.9 mm, above Leitão & Silva's 14 mm), full width.
    - **No swipe-only actions.** If a swipe is ever needed, its target is ≥ 112 pt (17.5 mm on @2x devices), and a button alternative exists [S3][S16].
    - Hit regions may extend beyond the visible shape (`contentShape`), but never overlap another target.
13. **R13: Spacing between targets.** ADOPT-TONIGHT (HIG [S3]; the older-adult studies found spacing secondary to size [S16][S17], so size carries the safety margin).
    - ≥ 12 pt between bezeled controls.
    - ≥ 24 pt clearance around borderless text buttons.
    - ≥ 32 pt between any destructive action and any other button.
14. **R14: Readable column width on wide containers.** LATER (it only matters on iPad and the iPhone Duo inner display, which aren't tonight's demo targets; R16).
    - In regular-width size classes, cap text columns at `@ScaledMetric(relativeTo: .body) var readableWidth = 560` and centre them.
    - Reasoning: about 66 characters of 17 pt SF Pro, mirroring `readableContentGuide`'s intent [S11].
15. **R15: Verify type and layout from the command line.** ADOPT-TONIGHT (`CLAUDE.md`: nothing is done without evidence).
    - Snapshot every screen at `large`, `extra-extra-extra-large`, `accessibility-large` (AX3) and `accessibility-extra-extra-extra-large` (AX5), in light and dark, using `xcrun simctl ui <udid> content_size …` and `appearance …` [S13].
    - Run on a 375-pt-wide device (iPhone SE 3rd gen or 13 mini; both device types exist on this Mac per `PROGRESS.md`) and on an iPhone 17.
    - Review every frame for truncation, clipping and overlap.
16. **R16: iPhone Duo-specific layout.** LATER (needs the iOS 27 SDK; Debbie's demo device is a standard iPhone [S6][S12]).
    - Use `ReservedRegion`, `ArrangementView` and side-mounted custom bars.
    - Until then, rely on size classes and safe areas, with no fixed widths, which the HIG says covers most adaptation [S6].

## Open questions / risks

- **Hero clamp.** R4's AX3 clamp is reasoned, not measured. Snapshot "Monitoring degraded" and "Can't reach home" at AX5 on a 375-pt device to confirm or drop it. Also confirm it meets the brief's "Dynamic Type up to the largest accessibility sizes": body text still reaches AX5, and only the 52-pt display line stops growing.
- **SF Pro Rounded is looser at small sizes** (F3). Limiting it to hero, title and metrics avoids a wider body texture, but whether rounded titles read as "calm" is a taste call for `CRAFT.md`.
- **The older-adult target studies have limits** [S16][S17]:
  - Leitão & Silva used a 233-ppi Android phone in 2012.
  - Chen et al. used a kiosk-style number-entry task.
  - Parhi et al. was read only as an abstract and summaries [S18].
  - The tiers in R12 are deliberately conservative, but they cost vertical space, which matters most at AX sizes with 96-pt resident buttons. Check that the resident screen's three controls still fit without scrolling at AX3.
- **Device Hub.** The HIG now mentions "Device Hub" for testing layouts [S4][S6]. Its availability in Xcode 26.6 wasn't checked; `simctl` covers our needs (R15).
- **Assumed live-view chrome.** This note assumes the live badge sits on a dark scrim (see `06-colour.md` R7). Typography over video must be re-checked once the live-view layout exists.
- **No typography-specific iOS 27 change was found** in the HIG change logs [S2]. Release notes for SwiftUI in iOS 27 weren't reviewed, because we can't build against that SDK anyway.

## Sources

- [S1] Apple security releases (iOS 27.2.1, 27.2, 27.1, 27.0.1, 27, 26.7.x rows) — Apple Support — https://support.apple.com/en-us/100100 — entries through 9 Nov 2026 — accessed 2026-11-14 — primary
- [S2] Human Interface Guidelines: Typography (incl. Dynamic Type and tracking tables) — Apple — https://developer.apple.com/design/human-interface-guidelines/typography — last change 16 Dec 2025 — accessed 2026-11-14 — primary
- [S3] Human Interface Guidelines: Accessibility (text sizes, control sizes, spacing) — Apple — https://developer.apple.com/design/human-interface-guidelines/accessibility — last change 9 Jun 2025 — accessed 2026-11-14 — primary
- [S4] Human Interface Guidelines: Layout — Apple — https://developer.apple.com/design/human-interface-guidelines/layout — last change 9 Sep 2026 — accessed 2026-11-14 — primary
- [S5] Human Interface Guidelines: Buttons — Apple — https://developer.apple.com/design/human-interface-guidelines/buttons — last change 16 Dec 2025 — accessed 2026-11-14 — primary
- [S6] Human Interface Guidelines: Designing for iPhone Duo — Apple — https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo — new page 9 Sep 2026 — accessed 2026-11-14 — primary
- [S7] Fonts for Apple platforms (SF Pro, SF Pro Rounded, New York; SF font licence header) — Apple — https://developer.apple.com/fonts/ — undated — accessed 2026-11-14 — primary
- [S8] WWDC20 session 10175, "The details of UI typography" (transcript) — Apple — https://developer.apple.com/videos/play/wwdc2020/10175/ — June 2020 — accessed 2026-11-14 — primary
- [S9] WWDC24 session 10074, "Get started with Dynamic Type" (transcript) — Apple — https://developer.apple.com/videos/play/wwdc2024/10074/ — June 2024 — accessed 2026-11-14 — primary
- [S10] WWDC19 session 244, "Visual Design and Accessibility" (transcript) — Apple — https://developer.apple.com/videos/play/wwdc2019/244/ — June 2019 — accessed 2026-11-14 — primary
- [S11] Apple Developer Documentation: `ScaledMetric` (https://developer.apple.com/documentation/swiftui/scaledmetric), `ViewThatFits` (https://developer.apple.com/documentation/swiftui/viewthatfits), `minimumScaleFactor(_:)` (https://developer.apple.com/documentation/swiftui/view/minimumscalefactor(_:)), `readableContentGuide` (https://developer.apple.com/documentation/uikit/uiview/readablecontentguide), `systemMinimumLayoutMargins` (https://developer.apple.com/documentation/uikit/uiviewcontroller/systemminimumlayoutmargins), `Font.Design.rounded` (https://developer.apple.com/documentation/swiftui/font/design/rounded) — Apple — undated — accessed 2026-11-14 — primary
- [S12] iOS 26.5 SDK interfaces in Xcode 26.6 (17F113): `SwiftUICore.swiftmodule/arm64e-apple-ios.swiftinterface` (ScaledMetric, DynamicTypeSize, `dynamicTypeSize(_:)`, AnyLayout, `lineLimit(_:reservesSpace:)`, `minimumScaleFactor`, `allowsTightening`, `lineHeight(_:)`, `legibilityWeight`, `accessibilityShowBorders`, `accessibilityReduceHighlightingEffects`, `safeAreaPadding`, `monospacedDigit`), `SwiftUI.swiftmodule` (ViewThatFits, `contentMargins`, `accessibilityShowsLargeContentViewer`), `CoreText.swiftmodule` (`AttributedString.LineHeight`), UIKit headers (`UIFontMetrics.h`, `UIView.h`, `UIViewController.h`, `UIContentSizeCategory.h`, `UIFontDescriptor.h`, `UILargeContentViewer.h`); absence of `ReservedRegion` / `ArrangementView` confirmed by grep — Apple — local path `/Applications/Xcode.app/Contents/Developer/Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS.sdk/System/Library/Frameworks/` — SDK files dated 18 Apr 2026 — accessed 2026-11-14 — primary (verified in local SDK)
- [S13] `xcrun simctl help ui` output (content_size, appearance, increase_contrast) — Apple, Xcode 26.6 command-line tools (local) — undated — accessed 2026-11-14 — primary (verified locally)
- [S14] Web Content Accessibility Guidelines (WCAG) 2.2 (SC 1.4.4, 1.4.12, 2.5.5, 2.5.8) — W3C — https://www.w3.org/TR/WCAG22/ — 12 Dec 2024 — accessed 2026-11-14 — secondary
- [S15] Guidance on Applying WCAG 2 to Non-Web ICT (WCAG2ICT), "Applying CSS pixel to non-web software" — W3C Group Note — https://www.w3.org/TR/wcag2ict-22/ — 11 Dec 2025 — accessed 2026-11-14 — secondary
- [S16] Leitão R, Silva PA. "Target and spacing sizes for smartphone user interfaces for older adults: design patterns based on an evaluation with users." Conference on Pattern Languages of Programs (PLoP) 2012, Arizona, 19–21 Oct 2012 — Maynooth University repository — https://mural.maynoothuniversity.ie/6045/1/PS-Target-Spacing.pdf — Oct 2012 — accessed 2026-11-14 — secondary (peer-reviewed)
- [S17] Chen KB, Savage AB, Chourasia AO, Wiegmann DA, Sesto ME. "Touch screen performance by individuals with and without motor control disabilities." Applied Ergonomics 44(2):297–302 — PubMed 23021630 / PMC3572909 — https://pubmed.ncbi.nlm.nih.gov/23021630/ — Mar 2013 — accessed 2026-11-14 — secondary (peer-reviewed)
- [S18] Parhi P, Karlson AK, Bederson BB. "Target size study for one-handed thumb use on small touchscreen devices." MobileHCI 2006, pp. 203–210 — https://doi.org/10.1145/1152215.1152260 — Sep 2006 — accessed 2026-11-14 (abstract and summaries only) — secondary (peer-reviewed)
- [S19] iPhone 17 — Tech Specs (2622×1206 px at 460 ppi) — Apple — https://www.apple.com/iphone-17/specs/ — undated (2025 model) — accessed 2026-11-14 — primary
- [S20] iPhone 18 Pro / 18 Pro Max — Tech Specs (460 ppi) — Apple — https://www.apple.com/iphone-18-pro/specs/ — undated (2026 model) — accessed 2026-11-14 — primary
- [S21] iPhone 11 — Technical Specifications (1792×828 px at 326 ppi) — Apple Support — https://support.apple.com/en-us/111865 — undated — accessed 2026-11-14 — primary
- [S22] Owsley C. "Aging and vision." Vision Research 51(13):1610–1622 — PMC3049199 — https://pmc.ncbi.nlm.nih.gov/articles/PMC3049199/ — Jul 2011 — accessed 2026-11-14 — secondary (peer-reviewed)
- [S23] "Here's How Liquid Glass Is Changing in iOS 27" — MacRumors — https://www.macrumors.com/2026/06/10/how-liquid-glass-is-changing-in-ios-27/ — 10 Jun 2026 — accessed 2026-11-14 — secondary
