# 06 Colour
_Researched 2026-11-14. Toolchain: Xcode 26.6 / iOS 26.5 SDK. Current public iOS: iOS 27.2.1 (released 9 Nov 2026). iOS 27.0 shipped on 14 Sep 2026, and iOS 27.1 (23 Oct 2026) was for iPhone Duo only. iOS 26.7.3 (9 Nov 2026) is the current update for people who stay on iOS 26 [S1]. Apps built with the iOS 26.5 SDK run on iOS 27 but can't call iOS 27-only APIs. None of the colour recommendations below need the iOS 27 SDK._

## Questions answered

> "Colour: a calm palette whose identity stays mint; light, dark and increased-contrast variants; companion tokens for text; contrast thresholds; colour-blind safety; showing urgency inside a calm palette." (KICKOFF_PROMPT.md §9, topic 6)

The assignment adds these questions, all answered below:
- What do HIG Color, Dark Mode and Accessibility say?
- What are the system mint and teal values? (For understanding only, not to copy.)
- How do asset-catalog appearance variants work, and what do `colorSchemeContrast` and `UIAccessibility.isDarkerSystemColorsEnabled` do?
- WCAG 2.2 SC 1.4.3, 1.4.6 and 1.4.11, and the definition of large text in points. APCA as secondary context.
- Colour vision deficiency: how common it is, the simulation models, an urgency hue that separates from mint, and redundancy.
- Older eyes.
- A calm-urgency strategy.
- A draft token set with measured contrast ratios and CVD separation.

## Summary

- **Apple's bar.** Every custom colour needs light, dark and increased-contrast variants. Contrast must be at least 4.5:1, and Apple says to "strive for" 7:1 for custom colours, "especially in small text" [S2][S3][S4]. With Increase Contrast on, colours should "get darker in Light Mode and lighter in Dark Mode" [S7].
- **Mint can't carry text.** Light mint (L\* ≈ 80) can never be text on a light background. Apple's own system mint is 2.12:1 on white (measured). So mint stays the visible identity (fills, marks, the calm hero), and two companion tokens carry text:
  - deep-mint ink for text and icons on light surfaces, 6.5:1 on white;
  - dark ink for text on mint fills, 7.7:1.
- **Red-green CVD is common.** It affects about 8% of men and 0.4% of women of European descent, and 4–6.5% of men of Chinese and Japanese descent [S21]. The textbook green-vs-red pair collapses under deuteranopia (CIEDE2000 7.7 for systemGreen vs systemRed; measured). Debbie's mint vs urgent red keeps ΔE00 ≥ 26 in every dichromacy model and every appearance, and caution vs urgent keeps ≥ 22. This works because mint carries blue and the urgent red is much darker.
- **Tints and coloured text aren't colour-blind safe.** Pale status tints and coloured status text collapse under simulation: ΔE00 as low as 0.8 (pale pink vs pale mint, deuteranopia) and 1.7 (dark amber vs dark red text). So a tint or a text colour must never be the only signal. HIG and WCAG 1.4.1 already require redundancy [S2][S4][S13].
- **Urgency without breaking the calm.** Exactly one solid, saturated, dark fill exists in the app: urgent red with white text. Everything else is neutral, mint, or a pale tint. Urgency also comes from shape, words, position, motion and haptics, not hue alone (Reasoning, plus [S2][S8]).
- **Live indicator.** Indigo (`#3446C8`, white label 7.35:1) separates from mint, caution and urgent by ΔE00 ≥ 37 under every dichromacy model. Red-family candidates collide with urgent (ΔE00 5–6), and green collides with caution (9.6, measured).
- **Older eyes.** The lens yellows with age: lens density at 400 nm rises 0.12 per decade from 20 to 60 and 0.40 per decade after 60 [S27]. Short-wavelength (blue) losses are mainly optical [S28], tritan discrimination declines fastest after 60 [S29], and contrast sensitivity falls [S30]. So resident screens must not rely on blue, violet or blue-green distinctions, and need high luminance contrast.
- **The draft token set passes.** It has 27 tokens across 4 appearances, and every one of 31 text and icon pairings in all four appearances passes the thresholds in R2. It is an evidence base. The final palette is set in `CRAFT.md`.
- **iOS 27 changed little here.** The HIG Color page hasn't changed since 16 Dec 2025, and its system-colour table still holds the 9 Jun 2025 values [S2]. Branding guidance on brand colour was refined on 9 Sep 2026 [S5]. Users can now tune Liquid Glass with a clear-to-tinted slider (secondary report) [S32]. The 26.1 SDK renamed Button Shapes to "Show Borders" (`AXShowBordersEnabled`, SwiftUI `accessibilityShowBorders`), and 26.4 added `accessibilityReduceHighlightingEffects` (verified in local SDK [S12]).

## Findings

### F1. Apple's colour guidance (HIG Color, Dark Mode, Accessibility, Branding)

- **Variants.** "Make sure all your app's colors work well in light, dark, and increased contrast contexts… If you define a custom color, make sure to supply light and dark variants, and an increased contrast option for each variant that provides a significantly higher amount of visual differentiation." The HIG also says to provide both light and dark colours "even if your app ships in a single appearance mode", to support Liquid Glass adaptivity [S2].
- **One colour, one meaning.** "Avoid using the same color to mean different things", for example a brand colour used both for interactive borderless buttons and for non-interactive text [S2].
- **Inclusive colour.** "Avoid relying solely on color… provide the same information in alternative ways… text labels or glyph shapes" [S2]. Accessibility adds "Convey information with more than color alone… pairings such as red-green and blue-orange… Offer visual indicators, like distinct shapes or icons" [S4].
- **Contrast.**
  - Dark Mode: "make sure the contrast ratio between colors is no lower than 4.5:1. For custom foreground and background colors, strive for a contrast ratio of 7:1, especially in small text" [S3].
  - Accessibility: Accessibility Inspector applies WCAG AA as up to 17 pt → 4.5:1, 18 pt → 3:1, bold (any size) → 3:1. "If your app doesn't provide this minimum contrast by default, ensure it at least provides a higher contrast color scheme when the system setting Increase Contrast is turned on." The HIG names both WCAG and APCA as "popular standards" [S4].
- **Dark Mode.**
  - Don't offer an app-specific appearance setting [S3].
  - Dark Mode colours "aren't necessarily inversions of their light counterparts" [S3].
  - iOS uses dimmer *base* and brighter *elevated* backgrounds for layered interfaces [S3][S9].
  - Test with Increase Contrast and Reduce Transparency both on, because dark text on dark backgrounds can lose contrast [S3].
  - "In rare cases, consider using only a dark appearance… an app that supports immersive media viewing" [S3]. This is the basis for an always-dark live view (R7).
- **Liquid Glass colour.** Apply colour sparingly to glass, "reserve it for elements that truly benefit from emphasis, such as status indicators or primary actions" [S2].
- **Branding (refined 9 Sep 2026).** "Apply your app's accent color judiciously… Minimize its use on controls and instead use it intentionally for primary actions or status indicators… consider moving it into the content layer" [S5].
- **Increase Contrast rule of thumb.** "As a general rule, colors should get darker in Light Mode and lighter in Dark Mode." Apple's demo raised a symbol from 4.5:1 to 7.5:1 in its high-contrast variant, and called 4.5:1 "generally the lowest acceptable ratio for most cases" [S7].
- **Differentiate Without Color.** Since iOS 13, apps should add a non-colour indicator, such as a shape, wherever colour alone carries meaning, and should do so anyway "when possible" [S8].

### F2. System colours, for understanding only (never shipped)

The HIG lists sRGB values for every system colour in four appearances [S2]. These are reference values only: "Avoid hard-coding system color values… The actual color values may fluctuate from release to release" [S2]. Measured with the scratch script:

| Colour (HIG, Jun 2025 values) | Hex | CIELAB LCh | vs white | vs black |
|---|---|---|---|---|
| Mint, light | `#00C8B3` | L73 C46 h182 | 2.12 | 9.91 |
| Mint, dark | `#00DAC3` | L79 C49 h181 | 1.78 | 11.82 |
| Mint, IC light | `#008575` | L50 C35 h180 | 4.55 | 4.61 |
| Mint, IC dark | `#54DFCB` | L81 C42 h182 | 1.64 | 12.79 |
| Teal, light | `#00C3D0` | L72 C40 h207 | 2.16 | 9.72 |
| Green, light | `#34C759` | L71 C75 h144 | 2.22 | 9.46 |
| Red, light | `#FF383C` | L57 C86 h32 | 3.57 | 5.88 |
| Red, IC light | `#E9152D` | L50 C87 h32 | 4.56 | 4.61 |

What this shows:
- **Apple's mint sits at h ≈ 181°.** That is on the teal side of green. Apple's own increased-contrast mint drops to L\* 50, which is darker and more teal, and only just passes 4.5:1 on white. This is exactly the shift the brief forbids for Debbie's signature ("Never shift the signature colour toward teal…").
- **Apple's red is light.** Light-mode systemRed is 3.57:1 on white, so it fails 4.5:1 as small text. Apple's increased-contrast variant reaches 4.56:1.
- **What Debbie takes from this.** Debbie's mint stays greener (h ≈ 164°) and light (L\* 80). Debbie meets contrast with companion tokens, not by darkening the mint (R3, R4).

### F3. Asset-catalog variants and runtime APIs

- **Asset catalog.** Add a Color Set and specify bright and dim variants [S3]. Under Appearances, check **High Contrast** to provide alternate versions, "used when Increase Contrast is on" [S7]. With Appearances = Any, Dark plus High Contrast, each colour gets four variants: light, dark, light-IC and dark-IC. Apple's `colorSchemeContrast` documentation says: "If you only need to provide different colors… for different color scheme and contrast settings, do that in your app's Asset Catalog" [S10].
- **SwiftUI.** These are verified in the local SDK [S12]:
  - `EnvironmentValues.colorSchemeContrast: ColorSchemeContrast { get }` (`.standard` / `.increased`). It is read-only: "The value that you read depends entirely on user settings, and you can't change it" [S10]. The SDK also declares an underscored `_colorSchemeContrast` setter, which is private API and must not be used.
  - `accessibilityDifferentiateWithoutColor`, `accessibilityReduceTransparency` and `legibilityWeight`.
  - `accessibilityShowBorders`, back-deployed (`@backDeployed(before: iOS 26.1)`). The old `accessibilityShowButtonShapes` is marked `deprecated: 1000, renamed: "accessibilityShowBorders"`.
  - `accessibilityReduceHighlightingEffects` (iOS 26.4).
  - `accessibilityIgnoresInvertColors(_:)`.
- **UIKit.** Also verified in the local SDK [S12][S11]:
  - `UIAccessibility.isDarkerSystemColorsEnabled` ("whether the Increase Contrast setting is in an enabled state") and `UIAccessibilityDarkerSystemColorsStatusDidChangeNotification`, both iOS 8.
  - `UITraitCollection(accessibilityContrast:)` and the `accessibilityContrast` trait, iOS 13.
  - `UIColor(dynamicProvider:)` and `resolvedColor(with:)`, iOS 13.
  - `UIAccessibilityShouldDifferentiateWithoutColor()`, iOS 13.
  - `UIAccessibilityButtonShapesEnabled()` is now `API_DEPRECATED_WITH_REPLACEMENT("AXShowBordersEnabled", ios(14.0, 26.1))`. The replacements `AXShowBordersEnabled()` (iOS 26.1) and `AXReduceHighlightingEffectsEnabled()` (iOS 26.4) are in `Accessibility/AXSettings.h`.
- **Testing from the command line.** Verified locally with `xcrun simctl help ui` [S33]: `xcrun simctl ui <device> appearance light|dark`, `increase_contrast enabled|disabled` and `content_size <category>`. All four appearances can be screenshotted unattended.

### F4. Contrast thresholds (WCAG 2.2 and how they map to iOS points)

- **WCAG 2.2** (W3C Recommendation, 12 Dec 2024) [S13]:
  - **1.4.1 Use of Color (A).** Colour is never the only visual means of conveying information.
  - **1.4.3 Contrast (Minimum) (AA).** Text needs 4.5:1, and large-scale text 3:1. Logotypes are exempt.
  - **1.4.6 Contrast (Enhanced) (AAA).** Text needs 7:1, and large-scale text 4.5:1.
  - **1.4.11 Non-text Contrast (AA).** UI components and their states, and graphics needed for understanding, need 3:1 against adjacent colours.
  - **Contrast ratio and relative luminance.** The ratio is (L1 + 0.05)/(L2 + 0.05). Relative luminance uses sRGB linearisation with a 0.04045 threshold. The older value, 0.03928, was changed in May 2021 and "has no practical effect" [S13].
- **Why 4.5:1 and 7:1.** The base is 3:1 (ISO 9241-3 / ANSI-HFES). People with 20/40 acuity lose about 1.5× in contrast sensitivity, which gives 4.5:1. People with 20/80 acuity need about 7:1. 4.5:1 also covers "the loss of contrast sensitivity that typically accompanies aging" [S14].
- **1.4.11 and buttons.** A button needs no visible boundary if its text identifies it: "the button's text is sufficient to indicate the presence of the control" [S15]. So a light mint button fill doesn't itself need 3:1 against the page, but its label does need text contrast.
- **"Large scale" in points.** WCAG defines it as "at least 18 point or 14 point bold" [S13], where a WCAG point is a CSS pt: "1pt = 1.333px… 14pt and 18pt are equivalent to approximately 18.5px and 24px" [S14]. WCAG2ICT (W3C Group Note, 11 Dec 2025) says non-web software should "use platform-defined density-independent pixel measurements which approximate the CSS reference pixel… points (pt) for iOS" [S16]. Taken strictly, that makes large text ≥ 24 iOS pt regular or ≥ 18.7 iOS pt bold. Apple's Accessibility Inspector treats 18 iOS pt, and *any* bold text, as large [S4]. The two readings disagree by about 6 pt (Reasoning). Debbie doesn't use the large-text exception (R2).
- **APCA and WCAG 3 (secondary context).**
  - APCA's guidance levels [S18]:
    - Lc 90 is preferred for body text.
    - Lc 75 is the minimum for body-text columns (≥ 18 px/400 or 16 px/500).
    - Lc 60 is the minimum for other content text.
    - Lc 45 is for large or heavy text and fine icons.
    - Lc 30 is for spot-readable text.
    - Lc 15 is for non-semantic dividers.
  - The WCAG 3.0 Working Draft of 10 Sep 2026 still says "The contrast algorithm used in WCAG 3 is yet to be determined" [S17]. APCA is not a standard.
  - It is still useful as a cross-check. APCA rates light-on-dark text lower than WCAG 2 does: Debbie's dark `text.secondary` measures 9.0:1 WCAG but only Lc −66, below APCA's Lc 75 body-text level (measured, table in F8). Reasoning: dark-mode text deserves extra margin above the WCAG minimum.

### F5. Colour vision deficiency (CVD)

- **Prevalence.** About 8% of European men and about 0.4% of women have red-green CVD. The figure is 4–6.5% for men of Chinese and Japanese ethnicity [S21].
- **Types** [S19][S20]:
  - Red-green is the most common. Deuteranomaly is the most common form of all, and protanopia and deuteranopia mean someone can't tell red from green at all.
  - Blue-yellow types are less common. Tritanopia confuses blue with green, purple with red, and yellow with pink.
  - Complete colour blindness (achromatopsia) is rare.
- **Why mint vs red is a risk.** A protanope or deuteranope loses the L–M (red–green) axis and keeps only blue–yellow and lightness. Saturated greens and reds both map to similar yellow-olive tones, so a "green = fine, red = danger" scheme can collapse. Measured: systemGreen vs systemRed drops from ΔE00 77.8 in normal vision to 7.7 under Viénot deuteranopia and 7.2 under Machado deuteranopia (scratch script, F8). Apple's WWDC19 demo shows exactly this: under deuteranopia, red, green and yellow status circles "all kind of blend together" [S8].
- **Simulation models.**
  - **Brettel, Viénot & Mollon 1997 (JOSA A).** Projects LMS stimuli onto two half-planes anchored at 475/575 nm (protan/deutan) or 485/660 nm (tritan). It was validated by a protanope and a deuteranope who accepted the match [S22].
  - **Viénot, Brettel & Mollon 1999.** A single-plane simplification for protan and deutan [S23] (paper not read directly; described in [S25]).
  - **Machado, Oliveira & Fernandes 2009 (IEEE TVCG).** A physiologically based model covering anomalous trichromacy and dichromacy, with published matrices at severity 0.0–1.0 [S24].
  - DaltonLens's review (2021, secondary) recommends Brettel 1997 for tritanopia; Viénot 1999 or Brettel 1997 for protanopia and deuteranopia; and Machado for anomalous trichromacy, warning that Machado ranks lower for full dichromacy [S25].
  - The script uses the sRGB-adapted Viénot and Brettel matrices from libDaltonLens (public domain) [S26], and the Machado matrices from the authors' page [S24]. The Machado severity-0.6 deutan row was checked against the published table.
- **Results for Debbie's palette** (full table in F8):
  - Signal fills (mint, caution, urgent, live) stay separated under every dichromacy model, worst ΔE00 16.1–57.1. The weakest pair is mint vs caution under protanopia (16.1–17.5).
  - **Pale tints don't separate.** Under deuteranopia, `ok.tint` vs `urgent.tint` is ΔE00 0.8, and the luminance ratio is 1.04:1.
  - **Dark coloured text doesn't separate.** Under deuteranopia, `caution.text` vs `urgent.text` is ΔE00 1.7.
  - Conclusion: hue on tints and on text is decoration, never the signal.
- **Choosing the urgency hue.** A red at L\* 34–47 differs from light mint and amber by **lightness** (luminance ratio 2.5–5.4:1) as well as by hue. Lightness survives every CVD type, including the achromatic stress test (ΔE00 24–44).
- **Choosing the live hue.** The search over seven candidates is in F8. Indigo wins (worst ΔE00 37.3). Red and red-orange collide with urgent (5.1–6.0), magenta collides with urgent under tritanopia (5.3), and green collides with caution (9.6) and fails a white label (3.45:1).

### F6. Older adults' colour and contrast vision

- **Lens yellowing.** "The average lens density increases linearly at 400 nm by 0.12 density unit per decade between the ages of 20 and 60 and by 0.40 density unit per decade above age 60" [S27].
- **Short-wavelength losses are optical.** Age-related loss for short-wavelength stimuli is mainly caused by the lens. Red-blue isoluminance shifts systematically with age in natural lenses, while red-green does not, and pseudophakic older eyes (after cataract surgery, with an artificial lens) performed like young eyes [S28].
- **Chromatic sensitivity.** It peaks around age 30 and then declines, "with a marked acceleration after 60 years… and more pronounced for the tritan system" [S29].
- **Contrast sensitivity.** Older adults have impaired photopic contrast sensitivity at intermediate and high spatial frequencies. Reduced retinal illuminance (pupillary miosis, lens density), intraocular scatter and aberrations contribute, and the loss is larger under low luminance [S30].
- **What this means for Debbie (Reasoning from [S27]–[S30]):**
  - The resident is likely over 70. Blue/violet vs green distinctions and pale-on-pale contrasts are the first to fail for them.
  - Fine detail, such as thin strokes and small text, needs more luminance contrast, not more hue.
  - Many people use phones in dim rooms at night, where these losses grow.

### F7. Showing urgency inside a calm palette

- **Calm by default.** Apple reserves colour for "elements that truly benefit from emphasis, such as status indicators or primary actions" [S2][S5]. If most of the UI is neutral, the one saturated element reads as urgent without being loud (Reasoning).
- **One loud colour.** Debbie gets one solid saturated dark fill, urgent red with a white label. Caution and OK use pale tints plus a dark glyph and words. Mint fills mean "Debbie / calm / go".
- **Never colour alone** (HIG; WCAG 1.4.1) [S2][S4][S13]. Every status carries:
  1. a distinct glyph *shape* (circle-check for OK, triangle for caution, octagon or person-fallen pictogram for urgent, filled dot for live);
  2. a plain-words label ("All quiet", "Monitoring degraded", "Possible fall", "Live");
  3. a fixed position (urgent banner on top, full width);
  4. for urgent and live only, motion and haptics. Haptics come from topic 4 and motion from topic 3.
- **No time-out on alerts.** HIG Accessibility asks to minimise time-boxed elements that auto-dismiss [S4]. An urgent banner stays until it is acknowledged (Reasoning, topic 10).

### F8. Draft token set and measurements (evidence base for `CRAFT.md`)

**Method.**
- A scratch Python script, not in the repo: `palette_check.py` in the session scratchpad.
- **Contrast.** WCAG 2.2 relative luminance and contrast ratio as defined in [S13]. APCA-W3 0.0.98G-4g Lc is computed as secondary context [S18].
- **Colour difference.** CIEDE2000 in CIELAB (D65).
- **CVD simulations**, each run in linear sRGB [S24][S26]:
  - Viénot 1999 for protan and deutan;
  - Brettel 1997 for tritan;
  - Machado 2009 at severity 1.0 (protan, deutan, tritan) and 0.6 (deuteranomaly);
  - a luminance-only "achromatic" worst case.
- **Self-test.** The script passes against known values:
  - CIEDE2000 test pairs from Sharma, Wu & Dalal 2005 (2.0425, 2.3669, 27.1492) [S31];
  - WCAG black/white 21:1 and `#777777` on white 4.48:1;
  - APCA black-on-white Lc 106.04 and white-on-black −107.88.

**Tokens** (sRGB hex). "IC" = Increase Contrast. The live view is always dark (R7), so the live tokens are the same in every appearance.

| Token | Light | Dark | Light IC | Dark IC | Role |
|---|---|---|---|---|---|
| `bg.canvas` | `#F3F7F5` | `#0E1412` | `#F3F7F5` | `#000000` | Screen background (faint mint-grey) |
| `bg.surface` | `#FFFFFF` | `#18201D` | `#FFFFFF` | `#121916` | Cards, sheets (dark: "elevated") |
| `bg.sunken` | `#E8EFEB` | `#0A0F0D` | `#E3EBE7` | `#000000` | Wells, text-field interiors |
| `text.primary` | `#14201B` | `#EAF2EE` | `#000000` | `#FFFFFF` | All primary text |
| `text.secondary` | `#3F4D47` | `#B4C2BB` | `#26312C` | `#D7E2DC` | Secondary text, timestamps |
| `text.tertiary` | `#5E6B65` | `#93A29B` | `#3A4641` | `#BCC9C2` | Placeholders, hints only |
| `mint.fill` | `#6CDCB0` | `#6CDCB0` | `#6CDCB0` | `#8EEBC6` | **Signature mint**: primary action fill, brand, calm hero |
| `mint.tint` | `#DDF5EA` | `#173A2E` | `#D2F1E3` | `#1C4536` | Calm/OK surface tint |
| `text.onMint` | `#06392A` | `#06392A` | `#00241A` | `#00241A` | Text and icons on `mint.fill` |
| `accent.text` | `#0A6B4D` | `#6CDCB0` | `#00523A` | `#8EEBC6` | Mint companion for interactive text and icons on backgrounds |
| `ok.icon` | `#0A6B4D` | `#6CDCB0` | `#00523A` | `#8EEBC6` | OK glyph |
| `ok.tint` | `#DDF5EA` | `#173A2E` | `#D2F1E3` | `#1C4536` | OK row tint (same as `mint.tint`) |
| `caution.fill` | `#F2A93B` | `#F2A93B` | `#F2A93B` | `#FFCB66` | Small caution badge fill (dark label) |
| `caution.tint` | `#FFF0D2` | `#3A2C0E` | `#FFEBC4` | `#45330F` | Degraded / can't-reach-home surface |
| `caution.text` | `#7A4A00` | `#F6C35E` | `#5C3700` | `#FFD68A` | Caution glyph and emphasis text |
| `text.onCaution` | `#2E1C00` | `#2E1C00` | `#1F1300` | `#1F1300` | Label on `caution.fill` |
| `urgent.fill` | `#C2182B` | `#D42A3C` | `#A00E1F` | `#A8101F` | **The only saturated solid fill**: possible fall |
| `text.onUrgent` | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` | Label on `urgent.fill` |
| `urgent.border` | `#C2182B` | `#FF8A92` | `#A00E1F` | `#FFB3B9` | Keeps the urgent banner ≥ 3:1 against dark canvases |
| `urgent.tint` | `#FCE6E8` | `#45161B` | `#FADADD` | `#561A21` | Acknowledged-alert history rows (never the only cue) |
| `urgent.text` | `#A3121F` | `#FF8A92` | `#850A17` | `#FFB3B9` | Urgent glyph and emphasis text |
| `live.fill` | `#3446C8` | `#3446C8` | `#3446C8` | `#3446C8` | "Camera is live" badge |
| `text.onLive` | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` | Badge label and countdown |
| `live.border` | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` | 1.5 pt badge outline |
| `live.scrim` | `#0B0F0D` | `#0B0F0D` | `#000000` | `#000000` | Background behind video chrome |
| `separator` | `#D3DDD8` | `#2E3934` | `#7D8B84` | `#8A9891` | Hairlines (decorative; ≥ 3:1 in IC) |
| `border.control` | `#7B8A83` | `#7F8E87` | `#3A4641` | `#C3CFC9` | Text-field and toggle-track outlines, IC button borders |

**Mint identity check.** `mint.fill` is CIELAB L80 C44 h164 in light, dark and light-IC, and L87 C37 h165 in dark-IC (lighter, as [S7] advises). Apple's mint, for comparison, is h181–182 (F2). The deep companion `accent.text` keeps the same hue (h164) at L40.

**Contrast of every text and icon pairing.** WCAG ratio, with APCA Lc in brackets (secondary). Minimums are from R2. All 31 pairs pass in all four appearances.

| Pair (foreground on background) | Kind | Light | Dark | Light IC | Dark IC | Min std / IC |
|---|---|---|---|---|---|---|
| `text.primary` on `bg.canvas` | text | 15.52 (Lc 98) | 16.35 (Lc −97) | 19.43 (Lc 101) | 21.00 (Lc −108) | 7 / 7 |
| `text.primary` on `bg.surface` | text | 16.77 (Lc 104) | 14.59 (Lc −96) | 21.00 (Lc 106) | 17.85 (Lc −107) | 7 / 7 |
| `text.secondary` on `bg.canvas` | text | 8.22 (Lc 85) | 10.09 (Lc −67) | 12.47 (Lc 95) | 15.80 (Lc −87) | 7 / 7 |
| `text.secondary` on `bg.surface` | text | 8.88 (Lc 90) | 9.00 (Lc −66) | 13.48 (Lc 100) | 13.43 (Lc −86) | 7 / 7 |
| `text.tertiary` on `bg.surface` | text | 5.57 (Lc 78) | 6.24 (Lc −48) | 9.85 (Lc 93) | 10.43 (Lc −71) | 4.5 / 7 |
| `text.tertiary` on `bg.canvas` | text | 5.16 (Lc 73) | 6.99 (Lc −49) | 9.11 (Lc 87) | 12.27 (Lc −72) | 4.5 / 7 |
| `text.onMint` on `mint.fill` | text | 7.69 (Lc 67) | 7.69 (Lc 67) | 9.87 (Lc 72) | 11.72 (Lc 81) | 7 / 7 |
| `text.primary` on `mint.tint` | text | 14.63 (Lc 94) | 10.97 (Lc −92) | 17.43 (Lc 94) | 10.75 (Lc −99) | 7 / 7 |
| `accent.text` on `bg.canvas` | text | 6.03 (Lc 76) | 11.09 (Lc −73) | 8.57 (Lc 85) | 14.85 (Lc −84) | 4.5 / 7 |
| `accent.text` on `bg.surface` | text | 6.52 (Lc 82) | 9.90 (Lc −71) | 9.26 (Lc 91) | 12.62 (Lc −83) | 4.5 / 7 |
| `accent.text` on `mint.tint` | text | 5.68 (Lc 73) | 7.44 (Lc −67) | 7.69 (Lc 78) | 7.60 (Lc −74) | 4.5 / 7 |
| `ok.icon` on `bg.surface` | icon | 6.52 | 9.90 | 9.26 | 12.62 | 3 / 4.5 |
| `ok.icon` on `ok.tint` | icon | 5.68 | 7.44 | 7.69 | 7.60 | 3 / 4.5 |
| `caution.text` on `bg.surface` | text | 7.48 (Lc 86) | 10.20 (Lc −73) | 10.49 (Lc 94) | 12.95 (Lc −84) | 4.5 / 7 |
| `caution.text` on `bg.canvas` | text | 6.92 (Lc 80) | 11.43 (Lc −74) | 9.71 (Lc 89) | 15.24 (Lc −85) | 4.5 / 7 |
| `caution.text` on `caution.tint` | text | 6.64 (Lc 78) | 8.33 (Lc −70) | 8.96 (Lc 83) | 8.79 (Lc −78) | 4.5 / 7 |
| `text.primary` on `caution.tint` | text | 14.89 (Lc 96) | 11.92 (Lc −93) | 17.93 (Lc 95) | 12.11 (Lc −101) | 7 / 7 |
| `text.onCaution` on `caution.fill` | text | 8.20 (Lc 63) | 8.20 (Lc 63) | 9.13 (Lc 64) | 12.15 (Lc 79) | 7 / 7 |
| `urgent.text` on `bg.surface` | text | 7.88 (Lc 85) | 7.36 (Lc −56) | 10.23 (Lc 92) | 10.54 (Lc −72) | 4.5 / 7 |
| `urgent.text` on `bg.canvas` | text | 7.30 (Lc 80) | 8.25 (Lc −57) | 9.47 (Lc 86) | 12.40 (Lc −73) | 4.5 / 7 |
| `urgent.text` on `urgent.tint` | text | 6.62 (Lc 74) | 6.72 (Lc −55) | 7.86 (Lc 74) | 7.92 (Lc −67) | 4.5 / 7 |
| `text.primary` on `urgent.tint` | text | 14.07 (Lc 92) | 13.32 (Lc −95) | 16.14 (Lc 89) | 13.42 (Lc −103) | 7 / 7 |
| `text.onUrgent` on `urgent.fill` | text | 6.07 (Lc −84) | 5.00 (Lc −78) | 8.15 (Lc −91) | 7.61 (Lc −89) | 4.5 / 7 |
| `urgent.border` on `bg.surface` | icon | 6.07 | 7.36 | 8.15 | 10.54 | 3 / 4.5 |
| `urgent.border` on `bg.canvas` | icon | 5.62 | 8.25 | 7.54 | 12.40 | 3 / 4.5 |
| `text.onLive` on `live.fill` | text | 7.35 (Lc −90) | 7.35 | 7.35 | 7.35 | 4.5 / 7 |
| `live.border` on `live.scrim` | icon | 19.29 | 19.29 | 21.00 | 21.00 | 3 / 4.5 |
| `text.onLive` on `live.scrim` | text | 19.29 | 19.29 | 21.00 | 21.00 | 7 / 7 |
| `border.control` on `bg.surface` | icon | 3.62 | 4.85 | 9.85 | 11.13 | 3 / 4.5 |
| `border.control` on `bg.canvas` | icon | 3.35 | 5.43 | 9.11 | 13.09 | 3 / 4.5 |
| `separator` on `bg.surface` | decor | 1.39 | 1.39 | 3.56 | 5.93 | – / 3 |

**CVD separation.** CIEDE2000 for normal vision, the *worst* of the seven dichromacy simulations, and the achromatic stress test. Light-mode excerpt; the other appearances behave the same except as noted.

| Pair | Normal | Worst dichromat (model) | Achromatic | Luminance ratio |
|---|---|---|---|---|
| `mint.fill` vs `caution.fill` | 41.0 | 17.5 (Viénot protan) | 4.2 | 1.19:1 |
| `mint.fill` vs `urgent.fill` | 73.8 | 31.4 (Machado deutan) | 33.6 | 3.61:1 |
| `mint.fill` vs `live.fill` | 59.9 | 37.3 (Brettel tritan) | 39.5 | 4.38:1 |
| `caution.fill` vs `urgent.fill` | 43.5 | 26.8 (Machado deutan) | 29.7 | 3.04:1 |
| `caution.fill` vs `live.fill` | 68.3 | 57.1 (Brettel tritan) | 35.7 | 3.68:1 |
| `urgent.fill` vs `live.fill` | 41.3 | 46.8 (Machado protan) | 4.5 | 1.21:1 |
| `ok.tint` vs `urgent.tint` | 23.3 | **0.8** (Machado deutan) | 0.9 | 1.04:1 |
| `ok.tint` vs `caution.tint` | 15.6 | 8.3 (Machado protan) | 0.4 | 1.02:1 |
| `caution.text` vs `urgent.text` | 25.0 | **1.7** (Viénot deutan) | 1.2 | 1.05:1 |
| `ok.icon` vs `urgent.text` | 58.4 | 13.2 (Machado protan) | 4.3 | 1.21:1 |

Notes on the other appearances:
- **Dark.** `mint.fill` vs `urgent.fill` worst is 26.5, with a luminance ratio of 2.98:1. `caution.fill` vs `urgent.fill` worst is 22.0, at 2.51:1.
- **Dark IC.** An earlier draft used a light-pink urgent fill with dark text. It collapsed against mint (ΔE00 8.6 under deuteranopia), so dark-IC urgent stays a *dark* red fill with a light `urgent.border`. Its worst case is now 39.2–47.9.
- **Simulated appearances.** Mint `#6CDCB0` becomes `#C4C4B2` (deuteranopia), `#D3D3B0` (protanopia) and `#81D2EE` (tritanopia). Urgent `#C2182B` becomes `#71711D`, `#4A4A2D` and `#C30F40`. Caution `#F2A93B` becomes `#C2C233`, `#B3B33C` and `#F99EA8`. Live `#3446C8` stays blue under protanopia and deuteranopia.

**Live-hue search** (light-mode fills, white label; worst ΔE00 against mint, caution and urgent across normal vision and the seven CVD simulations):

| Candidate | White label | Worst ΔE00 | Worst pair | Achromatic vs urgent |
|---|---|---|---|---|
| **indigo `#3446C8`** | 7.35:1 | **37.3** | mint / Brettel tritan | 4.5 |
| violet `#5B3FD9` | 6.65:1 | 35.5 | mint / Brettel tritan | 2.2 |
| blue `#1D63D6` | 5.51:1 | 28.7 | mint / Brettel tritan | 2.4 |
| green `#2F9E44` | 3.45:1 (fails) | 9.6 | caution / Viénot protan | 15.8 |
| red-orange `#D2401C` | 4.68:1 | 6.0 | urgent / Machado tritan | 6.8 |
| red `#D62D2D` | 4.92:1 | 5.1 | urgent / Machado tritan | 5.4 |
| magenta `#B0247E` | 6.18:1 | 5.3 | urgent / Brettel tritan | 0.4 |

## What changed in the current iOS release

- **The current release is iOS 27.2.1** (9 Nov 2026), after iOS 27.0 (14 Sep 2026) and 27.0.1, 27.1 (iPhone Duo only) and 27.2. iOS 27 runs on iPhone 11 and later, the same iPhone list as iOS 26.7.x [S1].
- **HIG Color: no iOS 27 change.** The last change-log entry is 16 Dec 2025 ("Updated guidance for Liquid Glass"). The system-colour specification values are still those "updated" on 9 Jun 2025 [S2]. Apple's design "What's new" page lists an iOS 27 Figma UI kit (17 Sep 2026) "with updated… system colors" [S6]. That isn't reflected in the HIG table today. It doesn't affect Debbie, which ships no system colours (R4).
- **Branding (9 Sep 2026)** refined brand-colour guidance: use it "judiciously", "for primary actions or status indicators", and consider moving it into the content layer [S5]. This matches R3.
- **Liquid Glass in iOS 27** (secondary report) [S32]:
  - There is a system-wide transparency slider from "ultra clear to fully tinted", a darkened edge around glass, and a uniform toolbar when content scrolls under floating bars.
  - "Apps already using Liquid Glass will gain many of these improvements automatically… without needing to be recompiled."
  - Debbie's own controls are custom, but any system glass it keeps (keyboard, alerts, share sheet) will vary per user. No action needed.
- **SDK-level accessibility changes inside iOS 26.x** (verified in local SDK) [S12]:
  - 26.1 renamed Button Shapes to **Show Borders**: `AXShowBordersEnabled`, with SwiftUI `accessibilityShowBorders` back-deployed.
  - 26.4 added **Reduce Highlighting Effects**: `AXReduceHighlightingEffectsEnabled`, SwiftUI `accessibilityReduceHighlightingEffects`.
  - Custom controls must honour both (R8).
- **Nothing here needs the iOS 27 SDK.** WCAG maths, the asset-catalog appearance model and the contrast APIs are unchanged in the local 26.5 SDK.

## Recommendations for Debbie

1. **R1: Semantic tokens only, four variants each.** ADOPT-TONIGHT (it is the base of every screen and the contrast test).
   - Every colour in the app is a semantic token from F8, defined as an asset-catalog Color Set with Appearances = **Any, Dark** and **High Contrast** checked (4 variants), colour space **sRGB** [S3][S7][S10].
   - Views never use literal colours. A lint fails on `Color(red:`, `Color(#`, `UIColor(red:` or hex strings outside the DesignSystem module.
   - Check: every Color Set has 4 appearance entries.
2. **R2: Contrast thresholds.** ADOPT-TONIGHT (they decide the token values).
   - All primary and secondary text needs **≥ 7:1** in all four appearances [S3][S13].
   - Tertiary and placeholder text needs ≥ 4.5:1 standard and ≥ 7:1 IC.
   - Labels on mint and caution fills need ≥ 7:1.
   - Labels on urgent and live fills need ≥ 4.5:1 standard and ≥ 7:1 IC.
   - Icons, control boundaries and focus rings need **≥ 3:1** standard and ≥ 4.5:1 IC [S13][S15].
   - Separators are decorative in standard and need ≥ 3:1 in IC.
   - The large-text 3:1 exception is **never** used. Apple's 18 pt rule and WCAG2ICT's 24 pt mapping disagree, and Dynamic Type changes the delivered size [S4][S16].
   - Check: R11's test passes the F8 pair table.
3. **R3: Mint stays mint.** ADOPT-TONIGHT (it's the owner's identity requirement).
   - `mint.fill` must measure CIELAB **h 158–170°, C\* ≥ 35, L\* ≥ 78** in every appearance. That means no teal (h > 175, which is where Apple's mint sits [S2]), no sage (C\* < 25) and no forest (L\* < 50).
   - Mint is used only for:
     - the brand mark;
     - **one** primary-action fill per screen;
     - the calm hero surface or illustration;
     - `mint.tint` calm rows.
   - Text on mint is `text.onMint`. Mint-family text and icons on backgrounds use `accent.text` (same hue, L\* 30–40 on light). Mint itself is never text on a light surface (Reasoning: 1.7–2.1:1 measured).
   - Check: assert LCh ranges in the token test.
4. **R4: No system colours in Debbie's own UI.** ADOPT-TONIGHT (the brief requires an original palette, and system values can shift between releases [S2]).
   - `Color.red`, `.green`, `.mint` and the rest are banned in app code, and the lint covers them. System-drawn surfaces (alerts, share sheet) are exempt.
5. **R5: Status is shape + words + position; colour only reinforces it.** ADOPT-TONIGHT (WCAG 1.4.1, HIG [S2][S4][S13], and the CVD results in F8).
   - Each status token pairs with a fixed glyph and label:

     | Status | Glyph | Label |
     |---|---|---|
     | OK | circle-check | "All quiet" |
     | Caution | triangle | "Monitoring degraded" / "Can't reach home" |
     | Urgent | octagon or fall pictogram | "Possible fall" |
     | Live | filled dot | "Live" |

   - `*.tint` and `*.text` colours are never the only difference between two statuses, because they collapse to ΔE00 0.8–1.7 under deuteranopia.
   - When `accessibilityDifferentiateWithoutColor` is true, any icon-only status chip also shows its text label.
6. **R6: Urgent red spec.** ADOPT-TONIGHT (it's the demo-critical alert).
   - `urgent.fill` is the only saturated solid fill in the app: CIELAB h 25–35°, L\* 34–47, white label.
   - It must keep:
     - **ΔE00 ≥ 20** against `mint.fill` and `caution.fill` under each dichromacy model (Viénot protan and deutan, Brettel tritan, Machado 1.0 and 0.6). Measured worst: 22.0.
     - a **luminance ratio ≥ 2.5:1** against both. Measured 2.51–5.38.
   - Dark appearances add the 2 pt `urgent.border`, so the banner stays ≥ 3:1 against near-black canvases.
   - Reasoning: the ΔE00 ≈ 2 values in the Sharma test set [S31] are near-threshold differences, so 20 is a deliberately large at-a-glance margin. Lightness separation survives all CVD types (F5).
7. **R7: "Camera is live" spec.** ADOPT-TONIGHT (the brief requires an unmistakable cue).
   - The live-view screen is always dark (`live.scrim`), whatever the system appearance. HIG allows a permanent dark appearance for immersive media [S3].
   - The badge is a `live.fill` indigo capsule with a white "LIVE" label and the remaining time in monospaced digits, plus a 1.5 pt `live.border`.
   - The badge is never red, green or amber (F8 hue search). It pulses only when Reduce Motion is off (topic 3).
   - Apply `.accessibilityIgnoresInvertColors()` to the video (verified in local SDK) [S12].
8. **R8: Increase Contrast and Show Borders.** ADOPT-TONIGHT (the brief lists Increase Contrast as a hard requirement).
   - Asset variants switch automatically [S7]. In addition, when `colorSchemeContrast == .increased` (SwiftUI) or `UIAccessibility.isDarkerSystemColorsEnabled` (UIKit) [S10][S11]:
     - filled buttons and cards draw a 1.5 pt `border.control`;
     - separators switch to their IC value (≥ 3:1).
   - When `accessibilityShowBorders` is true (the iOS 26.1 rename of Button Shapes), every text-only button gets a visible border or underline.
   - When `accessibilityReduceHighlightingEffects` is available and true (iOS 26.4+), drop glow and highlight effects [S12].
9. **R9: Resident screens for older eyes.** ADOPT-TONIGHT (the resident is the oldest user).
   - Resident mode uses only:
     - neutral text tokens (≥ 7:1);
     - `mint.fill` for "Sync now";
     - status words.
   - No meaning depends on blue, violet or green differences, or on pale-tint differences. No text or icon is lighter than `text.secondary`.
   - Check this with Increase Contrast and in a dim room on device. Grounds: [S27]–[S30].
10. **R10: Follow the system appearance.** ADOPT-TONIGHT (HIG [S3]).
    - No in-app light/dark switch; the live view (R7) is the only always-dark screen.
    - Sheets and popovers use `bg.surface`, which is lighter in dark mode, so layered UI keeps the base/elevated cue [S3][S9].
11. **R11: Automated token test.** ADOPT-TONIGHT (`CLAUDE.md` requires recorded, checkable ratios).
    - A unit test resolves each token with `UIColor.resolvedColor(with: UITraitCollection(traitsFrom: [.init(userInterfaceStyle: .light/.dark), .init(accessibilityContrast: .normal/.high)]))` (verified in local SDK) [S12].
    - It recomputes the WCAG ratio for every F8 pair and fails if any falls below R2.
    - It asserts the R3 LCh ranges and the R6 CVD margins. Port the scratch script's maths; this note keeps the numbers.
    - Simulator screenshots in all 4 appearances use `xcrun simctl ui <udid> appearance dark` and `increase_contrast enabled` [S33].
12. **R12: One meaning per hue.** ADOPT-TONIGHT (HIG "Avoid using the same color to mean different things" [S2]).
    - Mint = calm and "go" (primary action). Amber = needs attention soon. Red = act now. Indigo = camera live.
    - No decorative use of amber, red or indigo anywhere else (illustrations included).
13. **R13: Display P3 variants of mint.** LATER (wide colour can make the identity more vivid [S2], but sRGB keeps tonight's contrast maths exact).
14. **R14: APCA Lc as an advisory metric.** LATER (WCAG 3's algorithm is still undetermined [S17]).
    - Report APCA Lc next to the WCAG ratios in the token test, with no gate.
    - When adopted, flag dark-mode body text below |Lc| 75, as dark `text.secondary` at Lc −66 already is [S18].

## Open questions / risks

- **The exact mint is a taste call.** It is within R3's ranges, but the owner hasn't seen it. On device, check:
  - True Tone and sunlight, since the HIG says colours look darker and more muted in bright light [S2];
  - whether an L\* 80 mint fill glares in dark mode. A dimmer dark-mode mint would push `text.onMint` contrast below 7:1, so it would need re-measuring.
- **Mint means two things.** It is both "primary action" and "calm/OK". That is close to the HIG's warning about one colour meaning two things [S2]. The draft separates them by form: mint *fills* are actions, while mint *tints plus a check glyph* are calm status. `CRAFT.md` must decide this explicitly.
- **Weak achromatic separation.** Mint vs caution fills (ΔE00 4.2) and urgent vs live (4.5) barely separate in the achromatic test. This is accepted because complete colour blindness is rare [S20] and R5 always adds glyph and words, but it means R5 is load-bearing.
- **Simulations are models.** DaltonLens notes accuracy limits, including for large areas [S25]. A check with real colour-blind users is on the later list.
- **Dark-mode urgent label.** White on dark-mode `urgent.fill` is 5.00:1. That passes AA but is below the HIG's 7:1 "strive" target [S3]. A darker red would fall under 3:1 against the dark canvas, so the draft keeps 5.0:1 plus `urgent.border`.
- **Asset-catalog JSON keys.** The `Contents.json` appearance keys (`luminosity: dark`, `contrast: high`) are from experience and weren't verified in documentation tonight. Confirm by compiling one Color Set with `actool` in Phase 5.
- **iOS 27 system colours.** The iOS 27 UI kit mentions "updated system colors" [S6], but the HIG table hasn't changed. This only matters if system colours are used, which R4 bans.

## Sources

- [S1] Apple security releases (iOS rows: 27.2.1, 27.2, 27.1, 27.0.1, 27, 26.7.x) — Apple Support — https://support.apple.com/en-us/100100 — page updated with entries through 9 Nov 2026 — accessed 2026-11-14 — primary
- [S2] Human Interface Guidelines: Color — Apple — https://developer.apple.com/design/human-interface-guidelines/color — last change 16 Dec 2025 (system colour values 9 Jun 2025) — accessed 2026-11-14 — primary
- [S3] Human Interface Guidelines: Dark Mode — Apple — https://developer.apple.com/design/human-interface-guidelines/dark-mode — last change 6 Aug 2024 — accessed 2026-11-14 — primary
- [S4] Human Interface Guidelines: Accessibility — Apple — https://developer.apple.com/design/human-interface-guidelines/accessibility — last change 9 Jun 2025 — accessed 2026-11-14 — primary
- [S5] Human Interface Guidelines: Branding — Apple — https://developer.apple.com/design/human-interface-guidelines/branding — last change 9 Sep 2026 — accessed 2026-11-14 — primary
- [S6] Design: What's new — Apple — https://developer.apple.com/design/whats-new/ — entries through 6 Nov 2026 — accessed 2026-11-14 — primary
- [S7] WWDC20 session 10020, "Make your app visually accessible" (transcript) — Apple — https://developer.apple.com/videos/play/wwdc2020/10020/ — June 2020 — accessed 2026-11-14 — primary
- [S8] WWDC19 session 244, "Visual Design and Accessibility" (transcript) — Apple — https://developer.apple.com/videos/play/wwdc2019/244/ — June 2019 — accessed 2026-11-14 — primary
- [S9] WWDC19 session 214, "Implementing Dark Mode on iOS" (transcript) — Apple — https://developer.apple.com/videos/play/wwdc2019/214/ — June 2019 — accessed 2026-11-14 — primary
- [S10] `colorSchemeContrast` — Apple Developer Documentation — https://developer.apple.com/documentation/swiftui/environmentvalues/colorschemecontrast — undated — accessed 2026-11-14 — primary
- [S11] `isDarkerSystemColorsEnabled` — Apple Developer Documentation — https://developer.apple.com/documentation/uikit/uiaccessibility/isdarkersystemcolorsenabled — undated — accessed 2026-11-14 — primary
- [S12] iOS 26.5 SDK interfaces in Xcode 26.6 (17F113): `SwiftUICore.swiftmodule/arm64e-apple-ios.swiftinterface`, `SwiftUI.swiftmodule/…`, `UIKit.framework/Headers/UIAccessibility.h`, `UITraitCollection.h`, `UIColor.h`, `Accessibility.framework/Headers/AXSettings.h`, `CoreText.swiftmodule/…` — Apple — local path `/Applications/Xcode.app/Contents/Developer/Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS.sdk/System/Library/Frameworks/` — SDK files dated 18 Apr 2026 — accessed 2026-11-14 — primary (verified in local SDK)
- [S13] Web Content Accessibility Guidelines (WCAG) 2.2 — W3C — https://www.w3.org/TR/WCAG22/ — 12 Dec 2024 — accessed 2026-11-14 — secondary
- [S14] Understanding SC 1.4.3 Contrast (Minimum) — W3C WAI — https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html — undated — accessed 2026-11-14 — secondary
- [S15] Understanding SC 1.4.11 Non-text Contrast — W3C WAI — https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html — undated — accessed 2026-11-14 — secondary
- [S16] Guidance on Applying WCAG 2 to Non-Web ICT (WCAG2ICT) — W3C Group Note — https://www.w3.org/TR/wcag2ict-22/ — 11 Dec 2025 — accessed 2026-11-14 — secondary
- [S17] W3C Accessibility Guidelines (WCAG) 3.0, Working Draft — W3C — https://www.w3.org/TR/wcag-3.0/ — 10 Sep 2026 — accessed 2026-11-14 — secondary
- [S18] APCA in a Nutshell — Myndex / APCA project — https://git.apcacontrast.com/documentation/APCA_in_a_Nutshell.html — undated — accessed 2026-11-14 — secondary
- [S19] Color Blindness — National Eye Institute (NIH) — https://www.nei.nih.gov/learn-about-eye-health/eye-conditions-and-diseases/color-blindness — last updated 5 Nov 2025 — accessed 2026-11-14 — secondary (government)
- [S20] Types of Color Vision Deficiency — National Eye Institute (NIH) — https://www.nei.nih.gov/learn-about-eye-health/eye-conditions-and-diseases/color-blindness/types-color-blindness — last updated 7 Aug 2023 — accessed 2026-11-14 — secondary (government)
- [S21] Birch J. "Worldwide prevalence of red-green color deficiency." J Opt Soc Am A 29(3):313–320 — PubMed 22472762 — https://pubmed.ncbi.nlm.nih.gov/22472762/ — Mar 2012 — accessed 2026-11-14 — secondary (peer-reviewed)
- [S22] Brettel H, Viénot F, Mollon JD. "Computerized simulation of color appearance for dichromats." J Opt Soc Am A 14(10):2647–2655 — PubMed 9316278 — https://pubmed.ncbi.nlm.nih.gov/9316278/ — Oct 1997 — accessed 2026-11-14 — secondary (peer-reviewed)
- [S23] Viénot F, Brettel H, Mollon JD. "Digital video colourmaps for checking the legibility of displays by dichromats." Color Research & Application 24(4):243–252 — https://doi.org/10.1002/(SICI)1520-6378(199908)24:4%3C243::AID-COL5%3E3.0.CO;2-3 — Aug 1999 — accessed 2026-11-14 (not read directly; method as described in [S25] and implemented in [S26]) — secondary (peer-reviewed)
- [S24] Machado GM, Oliveira MM, Fernandes LAF. "A physiologically-based model for simulation of color vision deficiency." IEEE TVCG 15(6):1291–1298 (PubMed 19834201), and the authors' matrices page — https://www.inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html — Nov 2009 — accessed 2026-11-14 — secondary (peer-reviewed)
- [S25] "Review of Open Source Color Blindness Simulations" — DaltonLens (N. Burrus) — https://daltonlens.org/opensource-cvd-simulation/ — 19 Oct 2021 (updated Nov 2021) — accessed 2026-11-14 — secondary
- [S26] libDaltonLens (public-domain C reference implementation; Viénot 1999 and Brettel 1997 sRGB matrices) — DaltonLens — https://github.com/DaltonLens/libDaltonLens — undated — accessed 2026-11-14 — secondary
- [S27] Pokorny J, Smith VC, Lutze M. "Aging of the human lens." Applied Optics 26(8):1437–1440 — PubMed 20454339 — https://pubmed.ncbi.nlm.nih.gov/20454339/ — Apr 1987 — accessed 2026-11-14 — secondary (peer-reviewed)
- [S28] Nguyen-Tri D, Overbury O, Faubert J. "The role of lenticular senescence in age-related color vision changes." IOVS 44(8):3698–3704 — PubMed 12882826 — https://pubmed.ncbi.nlm.nih.gov/12882826/ — Aug 2003 — accessed 2026-11-14 — secondary (peer-reviewed)
- [S29] Paramei GV, Oakley B. "Variation of color discrimination across the life span." J Opt Soc Am A 31(4):A375–A384 — PubMed 24695196 — https://pubmed.ncbi.nlm.nih.gov/24695196/ — Apr 2014 — accessed 2026-11-14 — secondary (peer-reviewed)
- [S30] Owsley C. "Aging and vision." Vision Research 51(13):1610–1622 — PMC3049199 — https://pmc.ncbi.nlm.nih.gov/articles/PMC3049199/ — Jul 2011 — accessed 2026-11-14 — secondary (peer-reviewed)
- [S31] Sharma G, Wu W, Dalal EN. "The CIEDE2000 color-difference formula: implementation notes, supplementary test data, and mathematical observations." Color Research & Application 30(1):21–30 — https://doi.org/10.1002/col.20070 — Feb 2005 — accessed 2026-11-14 (test values used for the script self-test; the implementation reproduced them to 4 decimals) — secondary (peer-reviewed)
- [S32] "Here's How Liquid Glass Is Changing in iOS 27" — MacRumors — https://www.macrumors.com/2026/06/10/how-liquid-glass-is-changing-in-ios-27/ — 10 Jun 2026 — accessed 2026-11-14 — secondary
- [S33] `xcrun simctl help ui` output (appearance, increase_contrast, content_size) — Apple, Xcode 26.6 command-line tools (local) — undated — accessed 2026-11-14 — primary (verified locally)
