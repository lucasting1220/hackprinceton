# 02 The current iOS design language (Liquid Glass) and which iOS versions to support

_Researched 2026-11-14. Toolchain: Xcode 26.6 / iOS 26.5 SDK. Current public iOS: **iOS 27.2.1** (released 9 Nov 2026). iOS 27.0 shipped 14 Sep 2026. iOS 26.7.3 still gets security updates for people who stay on iOS 26 [S1]._

## Questions answered

> "The current iOS design language and what Apple asks of apps that adopt it (materials, layout, navigation, app icons), and how a fully custom-styled app stays faithful to it. Which iOS versions to support, within the limits in section 7." (KICKOFF_PROMPT.md §9, topic 2 [S41])

The workflow added these sub-questions: has iOS 27 shipped, and what did it change? Which of the named APIs exist in our local SDK? What does Apple say not to do? What is current iOS adoption, and which devices run iOS 26 and 27? What do older iPhones mean for lower-income families? Which minimum iOS should we set? What are the smallest and largest supported iPhone screens in points, for the screenshot gate?

## Summary

- **iOS 27 has shipped.** It came out on 14 Sep 2026, and the current public release is iOS 27.2.1 (9 Nov 2026). iOS 27.1 shipped only for the new foldable iPhone Duo [S1]. iOS 27 supports exactly the same pre-2026 iPhones as iOS 26 (iPhone 11 / SE 2nd gen and later), plus the 2026 models [S3][S4].
- **We can't use the iOS 27 SDK tonight.** Xcode 27.2 needs macOS Tahoe 26.6 or later, and this Mac runs macOS 26.2 [S1][S40]. Builds made with Xcode 26 and the iOS 26 SDK are still accepted for upload: that has been the minimum since 28 Apr 2026 [S10].
- **Liquid Glass is still the design language, and iOS 27 refined it.** Glass now diffuses busy content more, has a darkened edge and brighter highlights, and a new Settings slider runs from "ultra clear" to "fully tinted". Apps that use the system material get all of this automatically, without recompiling [S15].
- **Apple's main rule is two layers.** Glass belongs only to the floating layer of navigation and controls. Brand colour and everything else belong to the content layer. Apple also says: no glass in content, no glass on glass, tint only the primary action, no custom backgrounds behind bars, and use the scroll edge effect instead of dividers [S11][S12][S16][S19][S31].
- **A fully custom-styled app can still be faithful.** It builds its custom chrome *with* the system material (`glassEffect`, `GlassEffectContainer`, `safeAreaBar`), uses Apple's three shape types, and keeps standard placements, sizes (44 pt hit targets) and gestures [S12][S13][S28][S31]. Apple's WWDC26 branding session warns that custom *utilitarian* components can look "less native — or even dated" [S16]. That conflicts with the brief's custom-everything rule, and DECISIONS.md must record the conflict.
- **All the iOS 26 APIs this topic names are verified in the local iOS 26.5 SDK.** The iOS 27 additions (`toolbarMinimizeBehavior`, `visibilityPriority`, `ToolbarOverflowMenu`, `ReservedRegion`, `ArrangementView`, `isDynamicIslandLimitedInWidth`) are absent, so they need a newer SDK [S35]. `UIDesignRequiresCompatibility` is ignored once an app is built for iOS 27 [S32].
- **Adoption.** On 7 Jun 2026, 79% of all iPhones that transacted on the App Store ran iOS 26, 14% ran iOS 18, and 7% ran earlier versions. For devices introduced in the last four years the split was 86 / 11 / 3% [S6]. Apple has not yet published an iOS 27 figure.
- **Recommendation: minimum iOS 26.0.** It covers every iPhone that can run current iOS, gives native Liquid Glass without fallback code, and can be tested with the simulator runtimes installed on this Mac (26.2, 26.4, 26.5) [S36][S40]. The cost: owners of the 2018 iPhone XR, XS and XS Max, who are stuck on iOS 18, are excluded [S1][S5][S7].
- **Screenshot gate.** The smallest supported iPhone is the iPhone SE (2nd/3rd gen) at **375 × 667 pt**. The largest is **440 × 956 pt** (iPhone 16 / 17 / 18 Pro Max) [S36][S37]. The iPhone Duo can't be simulated with Xcode 26.6, so it is a known gap [S30][S36].
- **App icons.** A layered Icon Composer file on a 1024 × 1024 px canvas, with six appearances: default, dark, clear light, clear dark, tinted light, tinted dark [S24]. iOS 27 re-renders every icon with sharper glass. Icon Composer 2 needs Xcode 27 [S15][S34].

## Findings

WWDC session numbers below were checked against Apple's WWDC26 video index [S39] and the WWDC25 session pages [S11]–[S14].

### 1. What is current, and what our toolchain can build

- Apple's security-release index says "The latest version of iOS and iPadOS is 27.2.1" [S1]. The release history [S1]:
  - iOS 27: 14 Sep 2026, "iPhone 11 and later"
  - iOS 27.0.1: 28 Sep 2026
  - iOS 27.1: 23 Oct 2026, **iPhone Duo only**
  - iOS 27.2: 26 Oct 2026
  - iOS 27.2.1: 9 Nov 2026
- Apple still ships iOS 26.7.3 (9 Nov 2026) for iPhone 11 and later, and iOS 18.7.12 (9 Nov 2026) for the iPhone XS, XS Max and XR [S1]. So people can stay on iOS 26, and 2018 phones stay on iOS 18.
- Xcode 27.2 was released on 29 Oct 2026 and requires "macOS Tahoe 26.6 and later" [S1]. This Mac has macOS 26.2, Xcode 26.6 (17F113), the iOS 26.5 SDK, and simulator runtimes 26.2, 26.4 and 26.5 [S40].
- **Needs a newer SDK:** every iOS 27 API below. Reasoning: updating macOS to reach Xcode 27 is an owner decision. The brief forbids `sudo` and installs beyond what the build needs, so a macOS update isn't something to do tonight [S41].
- Upload rules [S10]:
  - Since 28 Apr 2026, uploads must be built with Xcode 26 or later using the iOS 26 SDK.
  - Since 9 Sep 2026, apps must target iOS 13 or later.
  - Our toolchain meets both. Reasoning: Apple raised the SDK minimum to Xcode 26 about seven months after iOS 26 shipped, so a similar Xcode 27 minimum is likely in 2027. It is not announced yet [S10].

### 2. Liquid Glass: what it is and where it belongs

- **The two layers.** Liquid Glass "forms a distinct functional layer for controls and navigation elements … that floats above the content layer" [S19]. Standard materials (blur and vibrancy) are for differentiation *within* the content layer [S19].
- **How it behaves** [S11]:
  - It defines itself by lensing. It materialises by modulating that lensing rather than fading.
  - Tapping it makes it flex and light up.
  - It shifts shadow, tint and light/dark based on what is behind it.
  - Larger pieces, such as menus, look like thicker glass [S11].
  - Small elements (tab bars, nav bars) flip between light and dark. Large ones (menus, sidebars) don't [S11].
- **Two variants: regular and clear.** Never mix them [S11].
  - Regular works at any size and over any content [S11].
  - Clear has no adaptive behaviour. Use it only when all three hold: it sits over media-rich content, a dimming layer won't hurt the content, and whatever sits on top of it is bold and bright [S11].
  - The HIG suggests a 35% dark dimming layer behind clear glass when the content beneath is bright [S19].
- **Accessibility comes built in** when you use the real material [S11]:
  - Reduce Transparency makes it frostier.
  - Increase Contrast makes elements predominantly black or white with a contrasting border.
  - Reduce Motion tones down effects and turns off the elastic behaviour.
- **User settings added in iOS 26.x:**
  - iOS 26.1 (3 Nov 2025) added a Liquid Glass setting: the default clear look, or a tinted look that "increases opacity of the material in apps and notifications on the Lock Screen" [S1][S2].
  - The iOS 26.4 release notes (24 Mar 2026) add a "Reduce bright effects" setting that "minimizes bright flashes when tapping on elements like buttons". They also say Reduce Motion now "more reliably reduces the animations of Liquid Glass" [S1][S2]. I found no public API for Reduce bright effects in the iOS 26.5 SDK (verified in local SDK [S35]).
- **Sheets and modality.**
  - Partial-height sheets are inset on a glass background and become opaque when expanded to full height [S13].
  - A task that interrupts the main flow pairs glass with a dimming layer. A task that runs in parallel doesn't [S12].
  - Sheets, menus, alerts and popovers morph out of the control that presented them [S12][S13].

### 3. What Apple says *not* to do

| Don't | Source |
|---|---|
| Use Liquid Glass in the content layer (lists, tables, cards, app backgrounds). Exception: transient controls such as sliders and toggles take on glass while active | [S11][S19] |
| Put glass on glass. Elements on top of glass use fills, transparency and vibrancy instead. Don't layer glass elements on top of each other | [S11][S31] |
| Mix the regular and clear variants | [S11] |
| Tint every element, or use a solid fill in place of glass tinting. Tint only primary elements and actions. Don't colour the background of several controls | [S11][S25] |
| Add custom backgrounds, borders or darkening behind bars and bar items. Keep custom `presentationBackground` on sheets or extra effect views in popovers | [S12][S13][S22][S31] |
| Use scroll edge effects as decoration, or where nothing floats above the scroll view. Use more than one per view, or mix or stack the soft and hard styles | [S12][S26] |
| Override the scroll edge effect to `.soft`. On iOS 27, `.automatic` has its own visuals, and `.soft` "no longer matches the default system appearance" | [S17][S26] |
| Let content and glass intersect in a steady state, such as at launch | [S11] |
| Apply glass to many custom controls. Limit it to the most important functional elements | [S19][S31] |
| Group a text button with an icon button in one shared background | [S12][S22] |
| Leave corners that look "pinched" or "flared". Nested shapes should be concentric | [S12] |
| Put screen-specific actions in the tab-bar accessory, use a tab bar for actions, or hide or disable tabs | [S12][S21] |
| Title a view with the app's name, or use a title longer than about 15 characters | [S22] |
| Show the logo throughout the app, or use the launch screen for branding | [S16][S27] |
| Show more than one or two prominent buttons per view | [S28] |

### 4. Layout, shapes and sizes

- **Three shape types** [S12]:
  - **Fixed:** a constant corner radius.
  - **Capsule:** radius equals half the height.
  - **Concentric:** the parent's radius minus the padding.
- On iPhone, a button near the screen edge is a capsule with extra margin. A component that appears both nested and on its own uses a concentric shape with a fallback radius [S12].
- The APIs are `ConcentricRectangle` and `Edge.Corner.Style.concentric(minimum:)` (verified in local SDK, iOS 26.0 [S35]). The custom-component guidance says a button at the bottom of a sheet should share the sheet's corner centre [S13].
- Bordered buttons are capsules by default in the new design [S13]. The minimum hit region is 44 × 44 pt [S28].
- **HIG Layout** [S20]:
  - Separate controls from content with Liquid Glass and the scroll edge effect, not a solid or semi-opaque colour under the controls.
  - Extend full-screen background content under bars.
  - Make layout decisions by size class, never by device type or orientation.
- **The device-size table is gone.** The Layout page updated on 9 Sep 2026 no longer lists screen sizes per device. It points to Device Hub and resizable windows instead [S20]. WWDC26 says designers should now think in "a dynamic range of sizes and aspect ratios" [S15]. The point sizes below therefore come from the local simulator profiles [S36] and Apple's spec sheets [S37][S38].

### 5. Navigation components

- **Tab bars** [S21]:
  - For navigation only, never for actions.
  - Visible in every section except under a modal.
  - Never disabled or hidden.
  - Single-word labels.
  - Badges reserved for critical information.
  - On iOS the bar floats on glass and can minimise on scroll (`TabBarMinimizeBehavior`) [S21].
  - If the content is colourful, prefer monochrome tab labels [S21].
- **Toolbars and navigation bars** [S22]:
  - Fewer bar backgrounds and fewer tinted controls.
  - The content layer informs the bar's colour.
  - Custom components need corner radii concentric with the bar.
  - Titles under 15 characters, and not the app name.
  - "Use the standard Back and Close buttons … If you create a custom version of either, make sure it still looks the same, behaves as people expect."
  - One primary action, using the `.prominent` style, on the trailing side.
  - At most three groups.
  - Items are grouped with `ToolbarSpacer` (fixed or flexible) and `sharedBackgroundVisibility` [S13].
- **Sheets** [S23]:
  - Cancel goes on the leading edge, Done on the trailing edge (updated 24 Mar 2026).
  - Always offer a way out other than Done, but never show Cancel, Done and Back together.
  - Show only one sheet at a time.
  - Show a grabber on resizable sheets; it also works with VoiceOver.
  - Support swipe to dismiss, and confirm first if there are unsaved changes.
  - For camera views and video, use a full-screen modal rather than a sheet.
- **Scroll edge effect** [S12][S26]:
  - It applies automatically under system bars.
  - Custom bars must opt in, via `safeAreaBar(edge:alignment:spacing:content:)` in SwiftUI or `UIScrollEdgeElementContainerInteraction` in UIKit [S31] (both verified in local SDK, iOS 26.0 [S35]).

### 6. Colour and brand inside Liquid Glass

- **WWDC26 "Communicate your brand identity on iOS"** [S16]:
  - Treat the content layer as "the best opportunity to express your brand identity".
  - Move colour off solid bar backgrounds and into the scroll view, so glass controls "pick up your brand color dynamically".
  - Use tint sparingly: primary actions, badges and the selected tab.
  - Support Dark Mode.
  - Custom fonts must scale with Dynamic Type.
  - Custom icons can go "anywhere … from the content view to controls" if they are recognisable, consistent and scale down well.
  - Show the logo on the home screen only, fading as the user scrolls.
- **HIG Color, "Liquid Glass color"** [S25]:
  - Glass has no colour of its own.
  - To emphasise a primary action, colour the button's background rather than its symbol or text.
  - In an app whose content is mostly monochrome, using the brand colour as the accent "can be an effective way" to reflect identity.
  - Avoid similar colours in control labels and in the content behind them.
- **HIG Branding** (updated 9 Sep 2026) [S27]:
  - Use the accent colour "judiciously": primary actions and status indicators.
  - "Express your brand with familiar components": if you customise, keep "sizing, placement, and behavior" familiar.
- **Custom colours** used on controls need light, dark and increased-contrast variants [S31].

### 7. How a fully custom-styled app stays faithful (the brief's constraint)

- **The brief.** SF Symbols are banned everywhere in the app's own interface. Every control the app can style must be Debbie's own component. Where Apple's language implies an unchanged system control, we build a custom component that meets the same guidance and record it in DECISIONS.md [S41].
- **Apple's position pulls the other way.**
  - "Try to lean into what's already familiar … rather than reinvent the wheel."
  - Custom utilitarian components "can make the product appear less native — or even dated."
  - Even a custom toolbar should keep iOS button sizes, placement of floating actions and popover behaviour [S16].
  - Reasoning: this is a real conflict. The brief wins, so the custom components must be visually Debbie's but structurally and behaviourally iOS.
- **Apple provides the tools to do that:**
  - `glassEffect(_:in:)` with `Glass.regular.tint(_:).interactive()` for custom controls. Interactive glass scales, bounces and shimmers like system buttons [S13].
  - `GlassEffectContainer`, because "glass can not sample other glass" and elements in separate containers render inconsistently. It also performs better [S13][S31].
  - `glassEffectID(_:in:)` for morphing between shapes [S13].
  - Apply the material to the control itself, not to its inner views [S12].
  - UIKit equivalents: `UIGlassEffect`, `UIGlassContainerEffect` and `cornerConfiguration` [S14].
  - All verified in local SDK [S35].
- **Why the system material matters.** Reasoning: the iOS 27 refinements and the Liquid Glass slider reach "apps already using Liquid Glass … without even needing to recompile" [S15]. The accessibility adaptations are "available automatically whenever you use the new material" [S11]. A hand-made blur-and-gradient imitation would get neither.
- **What a custom bar gives up** compared with a system bar:
  - `tabBarMinimizeBehavior` only drives the system `TabView` [S13][S35].
  - On iPhone Duo, only system bars move to the vertical side position: "If your item uses a custom view … the system doesn't present it vertically" [S30].
  - System tab bars show labels and icons larger in the centre of the screen at accessibility text sizes. A custom bar must reproduce this with `accessibilityShowsLargeContentViewer` (iOS 15, verified [S35]) [S16].
- **Containers to keep using.** Reasoning: `NavigationStack`, `.sheet` and `.fullScreenCover` are presentation *containers*, not controls the app styles. Keeping them preserves swipe-back, interruptible navigation transitions [S14] and the system glass sheet, while the bars, buttons and sheet headers inside them stay custom.

### 8. APIs checked against the local iOS 26.5 SDK [S35]

| API | Availability (verified in local SDK) | Notes |
|---|---|---|
| `View.glassEffect(_ glass: Glass = .regular, in shape:)` | iOS 26.0 (SwiftUICore) | Default shape is a capsule [S13] |
| `Glass.regular` / `.clear` / `.identity`, `.tint(_:)`, `.interactive(_:)` | iOS 26.0 | |
| `GlassEffectContainer(spacing:content:)`, `glassEffectID(_:in:)`, `glassEffectUnion(id:namespace:)`, `glassEffectTransition(_:)` (`.matchedGeometry`, `.materialize`, `.identity`) | iOS 26.0 | |
| `.buttonStyle(.glass)` / `.buttonStyle(.glassProminent)` | iOS 26.0 | `GlassButtonStyle(_ glass:)` is **iOS 26.1** |
| `backgroundExtensionEffect()` / `(isEnabled:)` | iOS 26.0 | Mirrors and blurs imagery under bars [S13][S20] |
| `tabBarMinimizeBehavior(_:)`: `.automatic`, `.onScrollDown`, `.onScrollUp`, `.never` | iOS 26.0 | System `TabView` only |
| `tabViewBottomAccessory(content:)` / `(isEnabled:content:)` | 26.0 / **26.1** | |
| `scrollEdgeEffectStyle(_:for:)`: `.automatic`, `.hard`, `.soft`; `scrollEdgeEffectHidden(_:for:)` | iOS 26.0 | |
| `ToolbarSpacer(_: SpacerSizing = .flexible, placement:)`, `.sharedBackgroundVisibility(_:)` | iOS 26.0 | |
| `safeAreaBar(edge:alignment:spacing:content:)` | iOS 26.0 | Lets custom bars use the scroll edge effect [S31] |
| `ConcentricRectangle`, `Edge.Corner.Style.concentric(minimum:)` | iOS 26.0 | |
| `matchedTransitionSource(id:in:)` + `navigationTransition(.zoom(sourceID:in:))` | iOS 18.0 | Sheets morph from their source [S13] |
| `EnvironmentValues.accessibilityShowBorders` | back-deployed before iOS 26.1 (maps to `_accessibilityShowButtonShapes`) | The "Show Borders" setting |
| `accessibilityReduceTransparency`, `colorSchemeContrast`, `accessibilityShowsLargeContentViewer` | iOS 13 / 13 / 15 | |
| UIKit: `UIGlassEffect`, `UIGlassContainerEffect`, `UIScrollEdgeEffect`, `UIScrollEdgeElementContainerInteraction`, `UIBackgroundExtensionView`, `UICornerConfiguration`, `UIBarButtonItem.hidesSharedBackground` | iOS 26.0 (headers) | |
| `UIDesignRequiresCompatibility` (Info.plist) | iOS 26.0, documentation only | "The system ignores this key when you build for iOS 27 or later" [S32] |
| **Absent (need the iOS 27 SDK):** `toolbarMinimizeBehavior`, `visibilityPriority`, `ToolbarOverflowMenu`, `topBarPinnedTrailing`, `ReservedRegion`, `ArrangementView`, `toolbarVerticalEdge`, `axisBehavior`, `isDynamicIslandLimitedInWidth` | 0 matches in the iOS 26.5 SDK | Announced in [S17][S18][S30] |

### 9. App icons

- **Format and appearances** [S24]:
  - iOS icons are square, layered, on a 1024 × 1024 px canvas.
  - Appearances: default, dark, clear light, clear dark, tinted light, tinted dark.
  - Colour spaces: sRGB, Gray Gamma 2.2 or Display P3.
  - The system masks the corners, so supply square, unmasked layers.
- **Design guidance** [S24]:
  - Prefer an Icon Composer file over a bitmap. With a bitmap, the system segments the icon itself and doesn't apply glass to text or thin lines.
  - Keep foreground edges clean, not feathered.
  - No text unless it is essential.
  - Don't bake in highlights, shadows or blurs.
  - Keep the same features across all appearances.
- **Xcode behaviour** [S33]:
  - Xcode generates icon images for earlier OS releases from the Icon Composer file.
  - Adding a `.icon` file *replaces* any asset-catalog app icon.
  - Icon Composer allows at most four groups.
- **iOS 27.** Glass in icons renders "sharper and more defined" on all app icons. Icon Composer 2 adds multi-layer glass, refraction and a preview of the icon on earlier releases [S15]. Icon Composer 2 was released as a beta on 8 Jun 2026, alongside the iOS 27 betas [S34].
  - Reasoning: our Xcode 26.6 bundles the iOS 26 Icon Composer and `ictool` [S40]. A file authored in Icon Composer 2 may use features Xcode 26 can't compile. Not verified.

### 10. iOS 27 adaptability and iPhone Duo

- **Resizability.** iOS 27 lets iOS apps resize on iPad and in iPhone Mirroring, and apps opt in automatically when rebuilt with the latest SDK [S15]. Our 26.5 SDK build does not opt in. Reasoning: this follows from "once you rebuild with the latest SDK" [S15].
- **iPhone Duo** (introduced 2026) [S7][S29][S38]:
  - Inner display: 7.6-inch, 1878 × 2670 px. Outer display: 5.4-inch, 1398 × 2034 px [S38].
  - The system moves its bars to the side on the outer display [S29].
  - "When you build with Xcode 26 and earlier, your app doesn't extend under the status bar and camera" [S30].
  - The Duo layout APIs are iOS 27-only (absent locally [S35]).

### 11. Which iOS versions to support

- **Device lists:**
  - iOS 26 runs on iPhone 11, 11 Pro, 11 Pro Max, 12 mini through 12 Pro Max, 13 mini through 13 Pro Max, 14 through 14 Pro Max, 15 through 15 Pro Max, 16 through 16 Pro Max, 16e, 17, 17 Pro, 17 Pro Max, Air, 17e, and SE (2nd and 3rd gen) [S4].
  - iOS 27 runs on the same list plus the iPhone 18 Pro, 18 Pro Max and iPhone Duo [S3].
  - iOS 18 additionally ran on the iPhone XR, XS and XS Max [S5].
  - Release years: XR and XS in 2018, iPhone 11 in 2019, SE (2nd gen) in 2020 [S7].
- **Adoption** (App Store transactions, 7 Jun 2026):
  - All iPhones: iOS 26 79%, iOS 18 14%, earlier 7%.
  - iPhones introduced in the last four years: 86% / 11% / 3% [S6].
  - No iOS 27 figure has been published yet [S6].
- **The resident's Apple Watch** [S8][S9]:
  - Series 11, SE 3 and Ultra 3 need an iPhone 11 or later on iOS 26 or later.
  - Series 9, Ultra 2 and Series 10 also pair with an iPhone XS or later on iOS 17 or 18.
  - Updating to watchOS 27 requires an iPhone 11 or later on iOS 27.
  - So a resident whose Watch runs watchOS 26 or 27 already owns an iOS 26-capable iPhone. An older Watch can pair with an iOS 18 iPhone XS or XR.
- **Lower-income families.** Reasoning: hand-me-down and refurbished phones skew old. An iOS 26 floor still covers phones back to the iPhone 11 (2019) and SE 2nd gen (2020) [S4][S7]. It excludes the 2018 XR, XS and XS Max, which Apple still patches on iOS 18.7.x [S1]. Apple's 14% "iOS 18" bucket mixes stuck 2018 phones with people who simply haven't updated, so it can't size the excluded group [S6].
- **The options compared:**

| Minimum | Coverage | Design | Can we test tonight? |
|---|---|---|---|
| iOS 27.0 | Excludes everyone who stays on iOS 26, which Apple still patches [S1] | Same as 26 with our SDK | No benefit: we can't use iOS 27 APIs [S35] |
| **iOS 26.0** | Every iPhone that can run current iOS [S3][S4]; 79% of all iPhones were already on 26 by June 2026 [S6] | Native glass; no fallback code | Yes: runtimes 26.2, 26.4 and 26.5 are installed [S36] |
| iOS 18.0 | Adds XR, XS, XS Max (2018) [S5] | Every glass call needs `if #available(iOS 26, *)` plus a standard-material fallback | No: no iOS 18 runtime is installed and the disk has 24 GB free [S40]. The brief requires screenshot evidence [S41] |

- **Brief constraint.** The minimum must not be above `DEMO_IOS_VERSION`, which is unknown because `asc.env` is missing [S40][S41].

### 12. Screen sizes for the screenshot gate (iOS 26 / 27 iPhones)

| Device | Points (logical) | Pixels / scale | Source |
|---|---|---|---|
| iPhone SE (2nd, 3rd gen): **smallest** | **375 × 667** | 750 × 1334 @2x | [S36] |
| iPhone 12 mini / 13 mini | 375 × 812 | canvas 1125 × 2436 @3x (panel 1080 × 2340, downsampled) | [S36] |
| iPhone 16e / 17e | 390 × 844 | 1170 × 2532 @3x | [S36] |
| iPhone 11 / 11 Pro Max | 414 × 896 | @2x / @3x | [S36] |
| iPhone 17 / 17 Pro | 402 × 874 | 1206 × 2622 @3x | [S36] |
| iPhone Air | 420 × 912 | 1260 × 2736 @3x | [S36] |
| iPhone 16 Pro Max / 17 Pro Max: **largest** | **440 × 956** | 1320 × 2868 @3x | [S36] |
| iPhone 18 Pro Max | 440 × 956 (derived: same 2868 × 1320 px panel at 460 ppi as the 17 Pro Max) | — | [S37] + Reasoning |
| iPhone Duo inner / outer | about 626 × 890 / 466 × 678 **if** @3x (scale not published) | 1878 × 2670 / 1398 × 2034 px | [S38] + Reasoning; no simulator in Xcode 26.6 [S36] |

The iOS 26.5 runtime supports both gate devices: "iPhone SE (3rd generation)" (`com.apple.CoreSimulator.SimDeviceType.iPhone-SE-3rd-generation`) and "iPhone 17 Pro Max" (`…iPhone-17-Pro-Max`) (verified with `xcrun simctl` [S36]).

## What changed in the current iOS release

- **[CHANGED, iOS 27, runtime]** Glass diffuses complex content more and gains a darkened edge with brighter highlights. A new Settings slider runs from ultra clear to fully tinted. Apps using the system material get all of this without recompiling [S15][S18].
- **[CHANGED, iOS 27]** The `.automatic` scroll edge effect has new visuals, and a `.soft` override no longer matches the system default [S17]. The HIG scroll-edge guidance was updated on 8 Jun 2026 [S26].
- **[CHANGED, Xcode 27]** "We'll be removing support for opting to use the old design" [S15]. `UIDesignRequiresCompatibility` is ignored when building for iOS 27 or later [S32].
- **[CHANGED, iOS 27, icons]** All app icons render with sharper glass. Icon Composer 2 adds multi-layer glass and refraction [S15][S34].
- **[CHANGED, iOS 27]** Resizable iOS apps (with the iOS 27 SDK), and the iPhone Duo foldable with vertical system bars. Apps built with Xcode 26 don't extend under the status bar and camera on the Duo [S15][S29][S30].
- **[CHANGED, HIG]** Branding: brand-colour guidance refined on 9 Sep 2026 [S27]. Layout: device size tables removed on 9 Sep 2026 [S20]. Sheets: button placement updated on 24 Mar 2026 [S23]. Tab bars: terminology and art updated on 8 Jun 2026 [S21]. App icons: format options added on 28 Oct 2026 [S24]. Design principles reintroduced on 8 Jun 2026 [S34].
- **[NEEDS iOS 27 SDK]** `toolbarMinimizeBehavior`, `visibilityPriority`, `ToolbarOverflowMenu`, `topBarPinnedTrailing`, the prominent tab role, `ReservedRegion`, `ArrangementView`, `toolbarVerticalEdge` and `isDynamicIslandLimitedInWidth` are all absent from our SDK [S17][S18][S30][S35].
- **[CHANGED, iOS 26.x, still relevant]**
  - iOS 26.1: the Liquid Glass "tinted" option [S2], `accessibilityShowBorders`, and `GlassButtonStyle(_:)` [S35].
  - iOS 26.4: the Reduce bright effects setting, and Reduce Motion reduces Liquid Glass animations more reliably [S2].

## Recommendations for Debbie

R1. **Set `IPHONEOS_DEPLOYMENT_TARGET = 26.0`** for the app and the notification extension, building with Xcode 26.6 and the iOS 26.5 SDK. Add a test that fails if any target differs. Record the choice in DECISIONS.md and under "Decisions to confirm". When `asc.env` appears, check that `DEMO_IOS_VERSION` is 26.0 or higher; if it is lower, record a blocker. Cites [S3][S4][S6][S35][S36][S41]. **ADOPT-TONIGHT.** Why: it covers every iPhone that runs current iOS, gives native Liquid Glass, and is the only floor we can produce evidence for tonight.

R2. **Run the screen gate on two simulators:** "iPhone SE (3rd generation)" (375 × 667 pt @2x) as the smallest and "iPhone 17 Pro Max" (440 × 956 pt @3x) as the largest, both on the iOS 26.5 runtime. Optionally add "iPhone 13 mini" (375 × 812 pt) for notch and safe-area layouts. List iPhone Duo as untested. Cites [S36][S37][S38]. **ADOPT-TONIGHT.** Why: these are the extreme sizes among all iOS 26 and 27 iPhones that Xcode 26.6 can simulate.

R3. **Glass only in the functional layer.** Allow `glassEffect` and the `.glass`/`.glassProminent` button styles only in `DesignSystem/Chrome/`: top bar, floating action bar, live-view overlay controls, and a tab bar if one exists. Never use them on alert cards, status cards, list or settings rows, or empty states. Enforce this with a lint test that greps for those calls outside the allowlisted folder. Cites [S11][S19][S31]. **ADOPT-TONIGHT.** Why: Apple's most-repeated rule, and it is mechanically checkable.

R4. **Use the system material for every custom chrome component.** Default to `Glass.regular`, and add `.interactive()` to anything tappable. Wrap any two or more glass elements that sit in the same bar or cluster in one `GlassEffectContainer`. Morph between states with `glassEffectID` in a shared `@Namespace`. Apply glass to the control, never to its subviews. Don't imitate glass with blur and gradient: the lint bans `UIBlurEffect` and `.ultraThinMaterial`/`.regularMaterial` inside `Chrome/`. Cites [S11][S12][S13][S15][S31]. **ADOPT-TONIGHT.** Why: accessibility adaptations and iOS 27 refinements arrive for free only with the real material.

R5. **Never place glass on glass.** Content on a glass surface uses fills or vibrancy. When a sheet or overlay rises over a floating glass control, hide that control, as Maps does. Cites [S11][S14]. **ADOPT-TONIGHT.** Why: an explicit Apple "don't", and easy to check in snapshot review.

R6. **Use the clear variant only on live-view controls floating over video,** always with a 35% black dimming layer behind them. Use regular everywhere else. Cites [S11][S19]. **ADOPT-TONIGHT.** Why: the camera frame is media-rich and of unknown brightness. Reasoning: dimming always is simpler than detecting brightness, and legible every time.

R7. **Tint budget: at most one tinted glass control per screen,** the primary action, via `Glass.regular.tint(<semantic token>)`. All other icons and labels on glass stay monochrome. Express mint as the `AccentColor` asset and in content-layer surfaces, not as bar backgrounds. If a content surface behind a bar is mint, the bar's labels must stay monochrome. Cites [S11][S16][S25][S27][S28]. **ADOPT-TONIGHT.** Why: a calm, single focal point that matches Apple's tinting rules.

R8. **Custom bars attach with `safeAreaBar(edge:)`** so the system scroll edge effect sits behind them. Put no colour, gradient, blur or divider behind bar items. Never set `scrollEdgeEffectStyle(.soft, …)`: the lint bans `.soft`, and `.automatic` stays. Cites [S12][S17][S26][S31][S35]. **ADOPT-TONIGHT.** Why: correct legibility without custom backgrounds, and it stays right on iOS 27.

R9. **Only three shape kinds:** capsule, radius tokens, and `ConcentricRectangle` (for nested shapes, `.concentric(minimum: <token>)`). The lint bans literal `cornerRadius:` values outside the token file. Cites [S12][S13][S35]. **ADOPT-TONIGHT.** Why: no pinched or flared corners, and shapes stay concentric with the hardware.

R10. **Prefer a flat structure with no tab bar.**
  - Caregiver: one Home screen (status header plus alert feed). Settings opens from a trailing top-bar button, Live view is a full-screen cover, and Add a laptop is a sheet.
  - Resident: one screen.
  - If a tab bar is used anyway: four tabs at most, single-word labels, always visible except under modals, never disabled, monochrome except the selected tab, and minimised on scroll-down to match `.onScrollDown`.
  - Cites [S16][S21][S30]. Reasoning: fewer custom chrome pieces to get right, and no custom bar to fail iPhone Duo's vertical layout. **ADOPT-TONIGHT.**

R11. **Top-bar rules:**
  - Title of 15 characters or fewer, never "Debbie".
  - A custom Back glyph at top-leading that works inside `NavigationStack`, so swipe-back and interruptible pops keep working.
  - At most one prominent action, on the trailing side.
  - At most three item groups, never mixing a text button with icon buttons.
  - Cites [S14][S22]. **ADOPT-TONIGHT.** Why: custom Back and Close must "look the same, behave as people expect".

R12. **Presentation rules:**
  - Use the system `.sheet` with `presentationDetents` (`.medium` where progressive disclosure helps, `.large` otherwise) and `presentationDragIndicator(.visible)` on resizable sheets.
  - Never use `presentationBackground` (lint).
  - Cancel at leading, Done at trailing, never Cancel, Done and Back together.
  - One sheet at a time.
  - `interactiveDismissDisabled(true)` only while there are unsaved changes, and then confirm before dismissing.
  - Live view and the QR scanner use `fullScreenCover`.
  - All APIs verified in local SDK (iOS 14–16.4). Cites [S13][S23][S35]. **ADOPT-TONIGHT.** Why: the system glass sheet comes for free, and the HIG puts camera views in a full-screen modal.

R13. **Extend the screen gate's accessibility matrix** for any screen with chrome: add Increase Contrast, Reduce Transparency, Show Borders and the Liquid Glass "Tinted" setting to the brief's light/dark, largest text and Reduce Motion runs. Custom buttons draw a 1 pt border in the stroke token when `accessibilityShowBorders` is true. Custom bars use `accessibilityShowsLargeContentViewer`. Cites [S2][S11][S16][S31][S35]. **ADOPT-TONIGHT.** Why: Apple says to test custom elements under these settings, and Show Borders is now a named API.

R14. **Make the app icon an Icon Composer `.icon` file** built from square, unmasked SVG layers on a 1024 × 1024 canvas, in at most four groups, with no text and no baked-in effects. Provide default, dark, clear and tinted appearances. Review renders of all six appearances at full size and at small sizes. Topic 8 owns the command-line render pipeline; I did not verify which of Xcode 26.6's tools can render each appearance. Cites [S24][S33][S40]. **ADOPT-TONIGHT.** Why: the HIG's preferred format; Xcode derives older-OS images. Use the Icon Composer bundled with Xcode 26.6, not Icon Composer 2.

R15. **Don't add `UIDesignRequiresCompatibility`**, and don't use any of the iOS 27-only APIs listed in §8, because they won't compile with our SDK. Cites [S32][S35]. **ADOPT-TONIGHT.** Why: the key is ignored from Xcode 27 onward, and the APIs don't exist in the iOS 26.5 SDK.

R16. **Logo and launch screen.** Show the logo and wordmark only on onboarding and welcome, and at most as a home-header mark that fades on scroll. Keep them out of bars. The launch screen uses the first screen's background token plus, at most, the small custom logo mark: no wordmark, no tagline, no text. Cites [S16][S27]. Reasoning: the brief requires a custom-designed launch screen [S41], and the HIG says a launch screen "disappears too quickly to convey any information" and shouldn't be a branding moment; a near-empty designed screen satisfies both. **ADOPT-TONIGHT.** Why: Apple says not to use launch screens or logos for branding inside the app.

R17. **Move to Xcode 27 after the hackathon** (needs macOS 26.6 or later). Then test on iPhone Duo, adopt resizability, and drop any reliance on custom-bar gaps (for example `toolbarVerticalEdge`). Cites [S1][S10][S30]. **LATER.** Why: macOS on this Mac is too old, and the brief forbids this kind of system change tonight.

R18. **Revisit iOS 18 support for the resident role** if pilot families turn out to own 2018 iPhones. That would need an iOS 18 simulator runtime, plus `#available(iOS 26, *)` fallbacks to standard materials in `Chrome/`. Cites [S1][S5][S8]. **LATER.** Why: a real equity cost, but it can't be built and tested tonight.

## Open questions / risks

- **`DEMO_IOS_VERSION` is unknown** because `asc.env` is missing [S40]. If the demo iPhone runs iOS 18, R1 conflicts with the brief's rule that the minimum must not exceed it [S41]. We would then need the R18 fallback work and an iOS 18 runtime download on a disk with 24 GB free.
- **The custom-everything rule versus Apple's "familiar components" guidance** [S16][S27]. Record this as a DECISIONS.md entry and list it under "Decisions to confirm".
- **iPhone Duo is untested.** Reasoning: our build will run there letterboxed under the status bar and camera, with custom bars staying horizontal [S30].
- **Liquid Glass on the iPhone SE and the slowest iOS 26 devices** (A13-class iPhone 11 and SE 2). Performance on these is unmeasured here. Group glass in containers [S31], and include them in the performance budget work (topic 11).
- **Icon Composer.** Unverified whether `.icon` files from Icon Composer 2 (Xcode 27) compile with Xcode 26 [S34].
- **iOS 27 adoption.** No Apple figure yet [S6]. Expect a large share on 27 by the time of the pitch, because iOS 27 supports the same devices as iOS 26 [S3][S4].

## Sources

[S1] Apple security releases — Apple Support — https://support.apple.com/en-us/100100 — rolling page, newest entry 13 Nov 2026 — accessed 2026-11-14 — primary
[S2] About iOS 26 Updates — Apple Support — https://support.apple.com/en-us/123075 — rolling page, newest entry iOS 26.7.3 — accessed 2026-11-14 — primary
[S3] iPhone models compatible with iOS 27 (iPhone User Guide, iOS 27.2) — Apple Support — https://support.apple.com/en-us/guide/iphone/iphe3fa5df43/ios — undated — accessed 2026-11-14 — primary
[S4] iPhone models compatible with iOS 26 (iPhone User Guide, iOS 26.5) — Apple Support — https://support.apple.com/en-us/guide/iphone/iphe3fa5df43/26.0/ios/26.0 — undated — accessed 2026-11-14 — primary
[S5] iPhone models compatible with iOS 18 (iPhone User Guide, iOS 18.6) — Apple Support — https://support.apple.com/en-us/guide/iphone/iphe3fa5df43/18.0/ios/18.0 — undated — accessed 2026-11-14 — primary
[S6] App Store: "iOS and iPadOS usage" — Apple Developer — https://developer.apple.com/support/app-store/ — measured 7 Jun 2026 — accessed 2026-11-14 — primary
[S7] Identify your iPhone model — Apple Support — https://support.apple.com/en-us/108044 — undated — accessed 2026-11-14 — primary
[S8] Apple Watch and iPhone compatibility — Apple Support — https://support.apple.com/en-us/118490 — undated — accessed 2026-11-14 — primary
[S9] Update your Apple Watch — Apple Support — https://support.apple.com/en-us/HT204641 — undated — accessed 2026-11-14 — primary
[S10] Upcoming Requirements — Apple Developer News — https://developer.apple.com/news/upcoming-requirements/ — entries dated 28 Apr 2026 and 9 Sep 2026 — accessed 2026-11-14 — primary
[S11] Meet Liquid Glass (WWDC25 session 219) — Apple — https://developer.apple.com/videos/play/wwdc2025/219/ — 9 Jun 2025 — accessed 2026-11-14 — primary
[S12] Get to know the new design system (WWDC25 session 356) — Apple — https://developer.apple.com/videos/play/wwdc2025/356/ — 9 Jun 2025 — accessed 2026-11-14 — primary
[S13] Build a SwiftUI app with the new design (WWDC25 session 323) — Apple — https://developer.apple.com/videos/play/wwdc2025/323/ — June 2025 — accessed 2026-11-14 — primary
[S14] Build a UIKit app with the new design (WWDC25 session 284) — Apple — https://developer.apple.com/videos/play/wwdc2025/284/ — June 2025 — accessed 2026-11-14 — primary
[S15] Platforms State of the Union (WWDC26 session 102) — Apple — https://developer.apple.com/videos/play/wwdc2026/102/ — 8 Jun 2026 — accessed 2026-11-14 — primary
[S16] Communicate your brand identity on iOS (WWDC26 session 251) — Apple — https://developer.apple.com/videos/play/wwdc2026/251/ — June 2026 — accessed 2026-11-14 — primary
[S17] Modernize your UIKit app (WWDC26 session 278) — Apple — https://developer.apple.com/videos/play/wwdc2026/278/ — June 2026 — accessed 2026-11-14 — primary
[S18] What's new in SwiftUI (WWDC26 session 269) — Apple — https://developer.apple.com/videos/play/wwdc2026/269/ — June 2026 — accessed 2026-11-14 — primary
[S19] HIG: Materials — Apple — https://developer.apple.com/design/human-interface-guidelines/materials — last changed 9 Sep 2025 — accessed 2026-11-14 — primary
[S20] HIG: Layout — Apple — https://developer.apple.com/design/human-interface-guidelines/layout — last changed 9 Sep 2026 — accessed 2026-11-14 — primary
[S21] HIG: Tab bars — Apple — https://developer.apple.com/design/human-interface-guidelines/tab-bars — last changed 8 Jun 2026 — accessed 2026-11-14 — primary
[S22] HIG: Toolbars — Apple — https://developer.apple.com/design/human-interface-guidelines/toolbars — last changed 16 Dec 2025 — accessed 2026-11-14 — primary
[S23] HIG: Sheets — Apple — https://developer.apple.com/design/human-interface-guidelines/sheets — last changed 24 Mar 2026 — accessed 2026-11-14 — primary
[S24] HIG: App icons — Apple — https://developer.apple.com/design/human-interface-guidelines/app-icons — last changed 28 Oct 2026 — accessed 2026-11-14 — primary
[S25] HIG: Color ("Liquid Glass color") — Apple — https://developer.apple.com/design/human-interface-guidelines/color — last changed 16 Dec 2025 — accessed 2026-11-14 — primary
[S26] HIG: Scroll views ("Scroll edge effects") — Apple — https://developer.apple.com/design/human-interface-guidelines/scroll-views — last changed 8 Jun 2026 — accessed 2026-11-14 — primary
[S27] HIG: Branding — Apple — https://developer.apple.com/design/human-interface-guidelines/branding — last changed 9 Sep 2026 — accessed 2026-11-14 — primary
[S28] HIG: Buttons — Apple — https://developer.apple.com/design/human-interface-guidelines/buttons — last changed 16 Dec 2025 — accessed 2026-11-14 — primary
[S29] HIG: Designing for iPhone Duo — Apple — https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo — 9 Sep 2026 — accessed 2026-11-14 — primary
[S30] Preparing your app for iPhone Duo — Apple Developer Documentation — https://developer.apple.com/documentation/technologyoverviews/preparing-your-app-for-iphone-duo — undated (2026) — accessed 2026-11-14 — primary
[S31] Adopting Liquid Glass — Apple Developer Documentation — https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass — undated — accessed 2026-11-14 — primary
[S32] UIDesignRequiresCompatibility — Apple Developer Documentation — https://developer.apple.com/documentation/bundleresources/information-property-list/uidesignrequirescompatibility — undated — accessed 2026-11-14 — primary
[S33] Creating your app icon using Icon Composer — Apple Developer Documentation — https://developer.apple.com/documentation/xcode/creating-your-app-icon-using-icon-composer — undated — accessed 2026-11-14 — primary
[S34] Design: What's new (HIG change log) — Apple — https://developer.apple.com/design/whats-new/ — newest entry 6 Nov 2026 — accessed 2026-11-14 — primary
[S35] iOS 26.5 SDK Swift interfaces and ObjC headers (SwiftUI, SwiftUICore, UIKit, UserNotifications) — Apple, Xcode 26.6 (17F113) — local: /Applications/Xcode.app/Contents/Developer/Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS.sdk — SDK built Apr 2026 — accessed 2026-11-14 — primary (verified in local SDK)
[S36] CoreSimulator device-type profiles and `xcrun simctl list devicetypes` / `runtimes` — Apple, local: /Library/Developer/CoreSimulator/Profiles/DeviceTypes/*.simdevicetype/Contents/Resources/profile.plist — undated — accessed 2026-11-14 — primary (local)
[S37] iPhone 18 Pro: Technical Specifications — Apple — https://www.apple.com/iphone-18-pro/specs/ — undated (2026) — accessed 2026-11-14 — primary
[S38] iPhone Duo: Technical Specifications — Apple — https://www.apple.com/iphone-duo/specs/ — undated (2026) — accessed 2026-11-14 — primary
[S39] WWDC26 videos index (session numbers) — Apple — https://developer.apple.com/videos/wwdc2026/ — June 2026 — accessed 2026-11-14 — primary
[S40] PROGRESS.md environment table and blockers — this repo — 2026-11-14 — accessed 2026-11-14 — primary (local observation)
[S41] KICKOFF_PROMPT.md §3, §7, §9 — this repo (owner's brief) — 2026-11-14 — accessed 2026-11-14 — primary (project requirement)
