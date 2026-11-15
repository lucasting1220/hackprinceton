# 08 Iconography, logos and app icons
_Researched 2026-11-14. Toolchain: Xcode 26.6 / iOS 26.5 SDK. Current public iOS: **iOS 27.2.1** (build 24B156, released 9 Nov 2026); iOS 27.0.1 shipped 28 Sep 2026 and iOS 27.3 has been in beta since 3 Nov 2026; Xcode 27.2 is the current Xcode [S18]. Builds made with Xcode 26 and the iOS 26 SDK are still accepted by App Store Connect [S19]. Xcode 27 needs macOS Tahoe 26.6 or later [S16], and the standalone Icon Composer 2 needs macOS 26.4 or later [S20]. This Mac runs macOS 26.2, so the iOS 27 icon-rendering tools can't run here._

## Questions answered
> "Iconography, logos and app icons: a complete custom symbol set that replaces SF Symbols while matching the optical weight and alignment of system text; the current app icon formats and appearance variants; logo and wordmark principles; vector-to-asset pipelines that run from the command line." (KICKOFF_PROMPT.md §9, topic 8)

> "Iconography, logos and app icons: designing custom symbols that sit well beside the system's; the current app icon formats and appearance variants; logo and wordmark principles; vector-to-asset pipelines that run from the command line." (assignment text for this note)

This note answers these sub-questions:
- What does the HIG ask of icons, SF Symbols and app icons today?
- Which iOS 26/27 icon formats and appearance variants exist?
- What does the system apply to an icon, and what must we not bake in?
- What does a `.icon` document look like, and how do we render and compile one from the command line?
- Are asset-catalog PNG icons still accepted, and how do they render?
- How do we make custom symbols without the SF Symbols app, and how do we match them to system text?
- When should we draw icons as SwiftUI `Shape`s instead?
- What rules make a good logo and wordmark?
- Does the SF Pro licence allow its outlines in a logo?
- How should the launch screen work?
- Which concrete pipeline should we use, and how do we verify it?

## Summary
- **The app icon format is a layered Icon Composer document (`.icon`) at a single 1024 px size.** The system makes Default, Dark, Clear light, Clear dark, Tinted light and Tinted dark from three annotations: default, dark and mono. It also applies the mask, specular highlights, shadows, blur and translucency itself, so we must not bake any of them in [S1][S6][S7][S10].
- **Asset-catalog PNG icons (light/dark/tinted at 1024) still compile with Xcode 26.6 (verified)**, but the system has to guess the layers. As of the HIG change on 28 Oct 2026, it splits a bitmap into two layers and applies Liquid Glass only to large simple shapes [S1][S26]. A `.icon` gives us control, and Xcode creates flattened icons for older iOS versions [S10][S26].
- **The whole icon pipeline runs from the command line with tools already on this Mac (verified):**
  - We write `icon.json` by script, with SVG layers.
  - Icon Composer's bundled `ictool` renders any of the 6 appearances at any size.
  - `actool` compiles the `.icon` into `Assets.car` with the layered stack plus flattened fallbacks [S24][S26].
- **iOS 27 changed the icon material:** sharper specular highlights, refraction, deeper shadows, and a light angle from above. Apple also uses less translucency in its own icons. iOS 26-era `.icon` files get the new look automatically, without a rebuild [S8][S10][S16][S20]. We can't preview the iOS 27 look on this Mac (Icon Composer here is 1.6), so the final check has to happen on a device.
- **Custom symbols can be built without the SF Symbols app.** A script-generated template SVG works: Baseline/Capline guides, margins, and `Ultralight-S`/`Regular-S`/`Black-S` masters. It compiled with `actool` and rendered beside text at every weight, aligned to cap height and scaled with font size (verified) [S12][S27]. `actool` does not reject malformed templates, so we need our own lint and render test [S27].
- **Calibration measured on this Mac:**
  - At Medium scale, a system round glyph spans about 1.00× the point size and is centred on the cap-height midline (cap height 0.7046 em).
  - The Regular stroke is 8.30 per 100 pt, about 0.94× the Regular text stem of 8.79.
  - The S and L scales are 0.783× and 1.29× in size, but their strokes change only about 0.90× and 1.10× [S12][S28].
  - The system applies the same stroke rule when it derives weights and scales for a custom symbol from three S masters (verified) [S27].
  
  These numbers let Debbie's own icons match system text without copying any SF Symbol.
- **Logo and wordmark:**
  - Simple, built from few shapes, recognisable without colour, and legible at small sizes [S1][S2][S8][S30].
  - SF Symbols, and anything confusingly similar, are banned from logos [S3].
  - The SF font licence forbids using the font for artwork or derivative works [S21], so **the wordmark must be hand-drawn letterforms**.
- **Launch screen:** use an Info.plist `UILaunchScreen` entry with only `UIColorName`, set to the first screen's background. No logo, no text [S4][S5][S13][S14]. iOS 27 SDK builds will *require* a launch-screen key [S17]. Ours (26.5 SDK) don't yet, but we add it now.

## Findings

### F1. Current release and what our toolchain can and can't do
- **Releases [S18]:**
  - The current public release is iOS 27.2.1 (24B156, 9 Nov 2026).
  - iOS 27.3 beta and Xcode 27.3 beta have been out since 3 Nov 2026.
  - Xcode 27.2 shipped 29 Oct 2026.
- **Upload requirement [S19]:** since 28 Apr 2026, App Store Connect requires uploads to be built with Xcode 26 or later and an iOS 26 SDK. Our Xcode 26.6 / iOS 26.5 SDK meets that.
- **Xcode 27 [S16]:** it needs macOS Tahoe 26.6 or later. Its Icon Composer 2.0 "supports a new sharper rendering mode for upcoming 2027 operating systems with support for refractivity, outside specular, and deeper shadows". The standalone Icon Composer download needs macOS 26.4 or later [S20].
- **This Mac (verified) [S24]:**
  - It runs macOS 26.2 with Icon Composer **1.6 (build 99.1)**, bundled in Xcode 26.6 (17F113).
  - The 1.6 binaries contain no "refract" strings.
  - It contains the error string "This document uses features from a newer version of Icon Composer", so it expects to refuse newer files. Not tested with a real 2.0 file.
  
  So we author for 1.6 and must never hand-edit in 2.0-only keys.
- **Device Hub [S1][S23]:** the HIG now says to test icons "on a simulated device in Device Hub". In Xcode 27, apps run on simulators and devices in Device Hub windows. On Xcode 26.6 we use the Simulator and `simctl` instead.

### F2. App icon formats: Icon Composer `.icon` versus asset-catalog PNGs
- **Two formats [S1]:**
  - In iOS, iPadOS, macOS and watchOS, an icon is either a non-layered bitmap or a layered Icon Composer file.
  - The HIG says "Provide your icon in the Icon Composer format for more flexibility and control".
  - Given a bitmap, "the system attempts to segment your icon … to create an icon with two layers". It applies Liquid Glass to large simple foreground shapes but not to "text and thin lines" (HIG change log: "October 28, 2026 — Added guidance for app icon format options").
- **iOS 27 changes to legacy icons [S8]:**
  - Apple's icon team says iOS 27 "automatically segment[s] even legacy icons and then turn[s] them into basic mini Icon Composer documents".
  - Segmented foregrounds are now less translucent than on iOS 26. If you want control, "now is the time to invest in an Icon Composer version".
  - Bitmap icons still get the system's edge (specular) treatment on device [S7].
- **The `.icon` replaces the catalog icon [S10]:**
  - A `.icon` added to the project replaces any `AppIcon` asset catalog.
  - "If your app supports previous releases … Xcode automatically generates app icon images at build time for those releases from the Icon Composer file."
  - The `.icon` sits next to the Swift files, not inside `Assets.xcassets`. The target's App Icon name equals the file name without `.icon` [S8][S10].
  - Nothing changed in this integration between 2025 and 2026 [S8].
- **The asset-catalog route still works [S11]:**
  - It takes a single 1024×1024 image, plus Dark and Tinted appearance slots.
  - "Provide your tinted app icon as a grayscale image. Provide your dark app icon with a transparent background."
- **What `actool` produced from a test `.icon`, iOS 17 target, Xcode 26.6 (verified) [S26]:**
  - `IconImageStack` renditions for `UIAppearanceLight`, `UIAppearanceDark` and `ISAppearanceTintable`, with the SVG layer stored as a `Vector`.
  - Flattened 1024×1024 `Icon Image` renditions (Any, Dark, Tintable) for phone and pad.
  - Loose `…60x60@2x.png` and `…76x76@2x~ipad.png` files.
  - A partial Info.plist with `CFBundleIcons › CFBundlePrimaryIcon › CFBundleIconName`.
  
  Xcode's build rule accepts the file type `folder.iconcomposer.icon` as asset-catalog compiler input [S24].
- **What `actool` produced from an `AppIcon.appiconset` (Any/Dark/Tinted 1024 PNGs) (verified) [S26]:**
  - No errors.
  - Flat `Icon Image` renditions only, with no layer stack.
- **Single size:** the HIG lists the iOS layout as 1024×1024 px, Layered, with appearances "Default, dark, clear light, clear dark, tinted light, tinted dark" [S1]. The compiled car stores only `1024x1024` in its `MultiSized Image`, and the system scales down from it [S1][S26]. Accepted colour spaces are sRGB, Gray Gamma 2.2 and Display P3 [S1].

### F3. Appearance variants and annotations
- **Annotations [S7][S10]:**
  - People choose default, dark, clear or tinted Home Screen icons. "The system automatically generates variants you don't provide" [S1].
  - Icon Composer has three annotation sets (Default, Dark, Mono). The single Mono annotation drives Clear light, Clear dark and all tinted looks [S7][S8][S10].
- **Design advice [S1]:**
  - Keep the core features identical across appearances. Don't swap elements per variant.
  - Base the dark icon on the light one, and "avoid excessively bright images".
  - Dark, clear and tinted icons are progressively more subdued.
- **Mono legibility [S7][S8]:**
  - "Setting at least one element of your icon to be white, usually the most prominent or recognizable part" keeps it strong.
  - Map other colours to greys. "Maximize the dynamic range in your mono mode annotations" [S8].
  - Clear-mode icon glass ignores iOS 27's system-wide Liquid Glass transparency slider. Apple pins it deliberately [S8].
- **Backgrounds [S6]:**
  - Use the System Light / System Dark gradients instead of pure white or black.
  - Coloured backgrounds help distinguish modes.
  - Soft light-to-dark gradients "harmonize best with the direction of light".
- **Tested here (verified) [S26]:**
  - An unannotated test icon rendered in Dark with its white glyph re-coloured to the background mint on a near-black field. The automatic dark is the system's choice, not ours.
  - Explicit `fill-specializations` with `"appearance": "dark"` and `"tinted"` took effect as written.

### F4. What the system applies, and what must not be baked in
- **System effects [S1][S6][S15]:** the system adds a mask (rounded corners matched to hardware), specular highlights, refraction (iOS 27), translucency, blur and per-layer shadows. They "automatically adapt with the size of your icon … and can appear differently between system versions" [S1].
- **Don't bake effects in [S1]:**
  - "No need to include specular highlights, drop shadows between layers, beveled edges, blurs, glows."
  - Custom effects are static, while the system's are dynamic.
- **Export clean art [S7][S10]:**
  - Export layers flat and opaque.
  - Remove blurs, shadows, specular, opacity and translucency, and remove background colours and gradients (set them in Icon Composer).
  - "Don't export the canvas mask."
  - Convert text to outlines, because SVG doesn't keep fonts.
  - Use PNG only for raster or mesh-gradient layers.
  - Icon Composer 1.6 warns when SVG layers contain text elements [S24].
- **Shapes [S1][S6]:**
  - Prefer clearly defined (not feathered) edges.
  - Avoid thin lines and sharp corners. Rounder corners let light "travel on the edges".
  - Use bolder line weights to keep detail when small.
  - Prefer illustration to photos. Don't replicate UI or Apple hardware.
  - Include text only if it is essential.
- **Groups [S7][S10]:** Icon Composer allows at most **4 groups**, and Glass properties are set per group. Apple found four "provides the right bounds for how much visual complexity an icon should have" [S7].

### F5. Grid, mask and safe zones
- **Grid [S6][S1]:**
  - The 2025 grid is "simpler and more evenly spaced" with "a rounder corner radius", still on a 1024 px canvas.
  - "Keep primary content centered to avoid truncation" and use the template grids [S1].
  - The iOS 27 templates are on Apple Design Resources (`iOS-27-Icon-Templates-Photoshop-Illustrator.dmg`, last modified 8 Jun 2026) [S22]. They are behind a licence click-through, which I did not accept on the owner's behalf, so their keyline numbers are not in this note.
- **Mask measured from an `ictool` 1024 px Default render (verified) [S26]:**
  - The mask touches the canvas edge at mid-sides.
  - It is inset 78 px along each diagonal, so content more than ~614 px from centre along a diagonal is cut.
  - The corner curve starts ~291 px from each corner (a continuous-curvature corner, not a simple arc).
- **Use the canvas sparingly [S1]:** "you don't need to fill the entire icon canvas with content". For a related Apple surface (document icons), the HIG suggests a ~10% margin with the image filling ~80% of its canvas [S2].

### F6. Command-line rendering and compiling (verified on this Mac)
- **`ictool` (render) [S24][S26]:**
  - `xcrun ictool`, i.e. `/Applications/Xcode.app/Contents/Developer/usr/bin/ictool`, is an `actool`-style stub. It rejects `--help` and points to a man page that isn't installed.
  - The usable renderer is inside Icon Composer:
  ```sh
  ICTOOL="$(xcode-select -p)/../Applications/Icon Composer.app/Contents/Executables/ictool"
  "$ICTOOL" AppIcon.icon --export-image --output-file out.png --platform iOS \
    --rendition Default --width 1024 --height 1024 --scale 1 \
    [--light-angle <a>] [--tint-color <hue 0–1>] [--tint-strength <0–1>]
  ```
  - Valid `--rendition` values (from its own error message): `Default`, `Dark`, `TintedLight`, `TintedDark`, `ClearLight`, `ClearDark`.
  - The output is a masked PNG with alpha, and works at any size (tested 16–1088 px).
  - `--tint-color` is a hue. For example, 0.42 rendered yellow-green.
- **`actool` (compile) [S24][S26]:**
  - `xcrun actool --compile <dir> --platform iphoneos --minimum-deployment-target <v> --target-device iphone --app-icon AppIcon --output-partial-info-plist <dir>/partial.plist AppIcon.icon Assets.xcassets`
  - Inspect the result with `xcrun assetutil --info <dir>/Assets.car`, which prints JSON.
  - The relevant build settings are `ASSETCATALOG_COMPILER_APPICON_NAME` (`--app-icon`), `ASSETCATALOG_COMPILER_INCLUDE_ALL_APPICON_ASSETS`, `ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES` and `ASSETCATALOG_COMPILER_STANDALONE_ICON_BEHAVIOR`.
- **`.icon` package layout:** `AppIcon.icon/icon.json` plus `AppIcon.icon/Assets/<layer>.svg|png` (UTI `com.apple.iconcomposer.icon`, a package) [S24].
- **`icon.json` keys accepted by Icon Composer 1.6, found by experiment [S24][S26]:**
  - **Top level:** `fill` takes `{"solid": "srgb:r,g,b,a"}`, `{"automatic-gradient": "<colour>"}`, `{"linear-gradient": [c1, c2], "orientation": {"start": {x,y}, "stop": {x,y}}}`, or `"system-light"`. Also `fill-specializations: [{"appearance": "dark"|"light"|"tinted", "value": {...}}]`, `groups`, and `supported-platforms` (`{"squares": ["iOS"]}` worked for iOS-only).
  - **Group:** `name`, `layers`, `shadow` (`{"kind": "neutral"|"layer-color"|"none", "opacity": 0–1}`; `layer-color` is the UI's "chromatic"), `translucency` (`{"enabled": bool, "value": 0–1}`), `specular` (bool), `blend-mode` (e.g. `plus-lighter`), `lighting` (`combined`|`individual`), and `-specializations` variants of these.
  - **Layer:** `image-name`, `name`, `fill` and `fill-specializations` were exercised. `opacity`, `hidden`, `position` (`scale`, `translation-in-points`) and the other `*-specializations` keys appear as strings in the 1.6 binary but were not exercised.
  - **Colours:** colour strings `srgb:` and `display-p3:` both parse. `color-space-for-untagged-svg-colors: "display-p3"` parses, but `"srgb"` and `"sRGB"` failed, so omit the key for sRGB.
  - **Rejected values** fail with "The data couldn't be read because it isn't in the correct format", with no key named. Bisect by adding one key at a time.

### F7. Interface icons: what the HIG asks
- **Consistency [S2]:** use "a recognizable, highly simplified design" and familiar metaphors. Keep "a consistent size, level of detail, stroke thickness (or weight), and perspective" across all icons. Adjust dimensions for visual weight.
- **Match weights to adjacent text [S2]:** "In general, match the weights of interface icons and adjacent text."
- **Optical centring [S2]:** add padding in the asset to optically centre asymmetric icons.
- **Selected states [S2]:** provide a selected-state version "only if necessary".
- **Format and labels [S2]:**
  - Use vector (PDF/SVG) for custom icons.
  - Give every custom icon an alternative-text label.
  - Use inclusive, gender-neutral figures.
  - Don't use Apple hardware replicas.
- **SF Symbols design [S3]:**
  - Symbols come in nine weights, each matched to a San Francisco font weight.
  - Their three scales are "defined relative to the cap height".
  - Outline is the common variant. Fill gives emphasis and selection, for example in tab bars.
  - Enclosed variants help at small sizes.
- **Custom symbols [S3]:** a custom symbol must match system symbols in "level of detail, optical weight, alignment, position, and perspective". Negative side margins aid alignment, and custom symbols need accessibility labels.
- **Apple's brand guidance on custom iconography [S9]:**
  - Custom icons are welcome anywhere, including tab bars and toolbars, if they are "recognizable, consistent and … scale well to small sizes".
  - They should stay true to platform metaphors. Apple's example is a custom Share icon that still reads as iOS Share.
- **Pixel snapping:** Apple calls it a pre-Retina concern [S7]. So vector symbols need no pixel grid. Reasoning: at 2× and 3×, 0.5 design units at 100 pt are ~0.09 pt at 17 pt, well below a pixel.

### F8. Custom symbols without the SF Symbols app
- **Apple's documented route [S12]:** export a template from the SF Symbols app, edit it, then validate. Apple also documents the template format, so we can generate it ourselves. Reasoning: the app isn't installed here, and its download is a 445 MB installer [S22]. Installing it system-wide would likely need admin rights, which this session doesn't use (brief: never `sudo`).
- **Template format [S12]:**
  - A `Notes` group holding a required `template-version` text element.
  - A `Guides` group: `Baseline-S/M/L` and `Capline-S/M/L` lines, and `left-margin-<Weight>-<Scale>` / `right-margin-…` lines.
  - A `Symbols` group of up to 27 `<Weight>-<S|M|L>` groups.
  - Interpolation needs `Ultralight-S`, `Regular-S` and `Black-S`, all path-based, with the same number of paths and control points.
  - Scale factors are S 0.783, M 1.0, L 1.29.
  - The system centres symbols vertically on cap height.
  - Convert strokes to filled paths. Interpolation sources must be path-based, and hierarchical and palette rendering need it too. No effects, closed shapes only, no hidden paths.
  - Export with at least 7 decimal places.
- **What worked here (verified) [S27]:**
  - A Python-generated template with only guides (no Apple reference glyph), `Template v.3.0`, and three S masters compiled with `actool`. The masters were a ring with inner-edge strokes of 2.35 / 8.30 / 17.39 per 100 pt; the test used the M-scale values before the S values were measured.
  - It rendered via `Image(_:bundle:)` beside `Text`: thin at UltraLight, heavy at Black, interpolated at Semibold.
  - It sat on the cap-height midline and scaled at 17, 34 and 56 pt.
  - A single-variant (`Regular-M`-only) template rendered at every weight but **did not change weight** with the text. Weight matching needs the three masters or explicit variants.
- **How the system derives the other weights and scales from three S masters (measured, verified) [S27][S28]:**
  - Geometry scales exactly 1.277× (M) and 1.648× (L), matching 1/0.783 and 1.29/0.783.
  - Strokes do *not* scale proportionally. From a test custom symbol, S→M stroke grew ×1.055 / ×1.110 / ×1.223 for Ultralight / Regular / Black. Apple's own circle symbol grows ×1.063 / ×1.107 / ×1.225.
  - Semibold landed 0.318 of the way from Regular to Black, which is exactly where Apple's Semibold-S sits (7.50 + 0.318 × 6.70 = 9.63).
  - So S masters stroked at Apple's S values (2.21 / 7.50 / 14.20 per 100 pt) should reproduce the system's stroke at every weight and scale.
- **`actool` is lenient (verified) [S27]:** it compiled a template with **no `template-version`** and one with a **stroked `<circle>`**, without errors or warnings. Validation must be our own: a lint plus a render test.
- **Generating outlines [S25][S27]:** CoreGraphics can turn strokes into outlines: `CGPath.copy(strokingWithWidth:lineCap:lineJoin:miterLimit:transform:)`, `normalized(using:)` and `union(_:using:)` (macOS 13/iOS 16+), all verified in local SDK. Stroking the same chevron, bell, rounded rectangle and circle at widths 2.21, 7.50 and 14.20, with round caps and joins, gave identical element counts per subpath, before and after `normalized()`. So the masters stay interpolatable for simple shapes. The script must still check this for every icon.
- **Using them in SwiftUI (verified in local SDK) [S25]:**
  - `Image(_ name:bundle:)`, `Image(_:bundle:label:)`, `Image(decorative:bundle:)` and `Image(_:variableValue:bundle:)`.
  - `symbolRenderingMode(_:)`, `imageScale(_:)`, `symbolEffect(_:options:isActive:)` and `symbolEffect(_:options:value:)`.
- **Using them in UIKit (verified in local SDK) [S25]:** `UIImage(named:in:with:)` (iOS 13) and `UIImageSymbolConfiguration` `configurationWithTextStyle:scale:`.

### F9. Matching system text: calibration measured on this Mac [S28]
Method: CoreText glyph bounds of "I" in the system font (`.AppleSystemUIFont`). AppKit then rasterised system symbols at 100 and 400 pt. All values are per 100 pt, ±~0.25. These are calibration targets only; no symbol geometry is copied.

| Weight | Text stem ("I") | Symbol stroke S | M | L |
|---|---|---|---|---|
| Ultralight | 2.49 | 2.21 | 2.35 | 2.44 |
| Thin | 3.91 | 3.40 | 3.69 | 3.95 |
| Light | 6.69 | 5.73 | 6.32 | 6.88 |
| Regular | 8.79 | 7.50 | 8.30 | 9.09 |
| Medium | 11.04 | 8.70 | 9.94 | 11.14 |
| Semibold | 12.60 | 9.63 | 11.20 | 12.70 |
| Bold | 14.75 | 10.85 | 12.85 | 14.77 |
| Heavy | 17.97 | 12.62 | 15.25 | 17.77 |
| Black | 20.70 | 14.20 | 17.39 | 20.17 |

- **Proportions:**
  - Cap height is 70.46 (0.7046 em) at every weight.
  - The M-scale symbol stroke is 0.84–0.94× the text stem.
  - The L-scale stroke is about equal to the text stem.
- **Extents at Regular, measured on the ink:**
  - A circle is ⌀ 79 / 100 / 128 at S/M/L, matching 0.783/1.29 [S12].
  - At M, a circle runs from 14.5 below to 85.5 above the baseline, so it is centred at 35.5 ≈ cap/2 [S12].
  - Square 91×90, heart 98×90, bell 93×101 and house 118×103 at M. Squares are drawn ~10% smaller than circles, an optical size correction.
- **Behaviour across weights:** the stroke grows about equally inward and outward. The circle's outer diameter goes from 94.5 (Ultralight) to 106.8 (Black) at M, while the centreline stays at ~90–92.
- **Observed reference renders:** strokes end in round caps, joins are rounded, and outer corners are rounded. This is a technique we can share without copying any glyph.
- **Bold Text:** symbols take their weight from the font [S3]. Reasoning: so symbol-asset icons get heavier with Bold Text along with the text, provided every weight is available. SwiftUI exposes `legibilityWeight` and `colorSchemeContrast`, both verified in local SDK [S25], so `Shape` icons can follow Bold Text and Increase Contrast too.

### F10. The alternative: icons drawn as SwiftUI `Shape`s
- **What we get:**
  - Vector output at any scale.
  - `@ScaledMetric(wrappedValue:relativeTo:)` (iOS 14+) scales a base size with Dynamic Type relative to a text style.
  - `Shape.trim(from:to:)` gives draw-on animation.
  - `ImageRenderer` (iOS 16+) exports `cgImage` or vector output through `render(rasterizationScale:renderer:)`.
  
  All verified in local SDK [S25].
- **What we lose:**
  - Baseline and cap-height alignment inside `Text`.
  - Use as a named asset in system surfaces, such as `UNNotificationActionIcon(templateImageName:)` (iOS 15+, verified in local SDK) [S25].
  - Weight-following unless coded by hand.
  
  Reasoning: so `Shape` icons suit animated or illustrative glyphs (the "camera is live" indicator, the status ring, empty states). Static UI icons should be symbol assets.

### F11. Logo and wordmark principles
- **Simplicity [S1][S8]:** "Embrace simplicity … express it in a simple, unique way with a minimal number of shapes" [S1]. Apple's icon team says "some of the best logos in the world are the ones that are constructed most simply, but still come across powerfully". Icons appear from "a tiny little rectangle in … settings … to some huge billboard" [S8].
- **Monochrome-first and colour-blind safe [S8]:** "there's a form which is recognizable … you wouldn't want to depend on people's ability to be able to see color". A strong form before colour is "the number one rule of brand design".
- **Small sizes [S2]:** at 16×16 px, reduce complexity, use fewer and thicker lines, or "remove the lines altogether".
- **Peer-reviewed evidence (secondary) [S30]:** logo design traits shape reactions before any promotion. Logos meant to look professional and positive should be "moderately elaborate and natural".
- **Restraint in the app [S5][S9]:**
  - Don't repeat the logo throughout the app. Branding defers to content.
  - The launch screen is not for branding [S5].
  - Apple's example shows a logo only on the home tab, fading on scroll [S9].
- **Prohibitions [S3][S1]:**
  - SF Symbols terms forbid "using symbols — or images that are confusingly similar — in app icons, logos, or any other trademarked use" [S3].
  - Don't depict Apple hardware [S1][S2][S3].
  - Apple trademarks must not appear in names or images [S5].
- **Contrast:** for graphics needed to understand content, WCAG 2.2 SC 1.4.11 asks for at least 3:1 against adjacent colours [S29] (secondary). Example: a pale mint like sRGB(0.62, 0.90, 0.78) against white is about **1.44:1**. Reasoning: computed with WCAG relative luminance (L = 0.677). So a white glyph on a light mint field, or a mint mark on white, is too faint.

### F12. Font licence: may SF Pro outlines be used in a logo?
- **What the licence grants [S21]:** the licence on developer.apple.com/fonts grants use "solely for creating mock-ups of user interfaces to be used in software products running on Apple's iOS, OS X or tvOS operating systems" (§2A).
- **What it forbids [S21]:**
  - §2B: "You may not embed the Apple Font in any software programs or other products. Except as expressly provided for herein, you may not use the Apple Font to, create, develop, display or otherwise distribute any documentation, artwork, website content or any other work product."
  - §2C: no "modify, create derivative works of the Apple Font or any part thereof".
- **Conclusion:** a logo or wordmark is artwork and a distributed work product, and outlined glyphs would be a derivative. So **the wordmark must be hand-drawn letterforms** that are not traced from SF Pro or any system font. Using system fonts at runtime through the OS (`Font.system`) is a different matter and is allowed by the brief.
- **Other typefaces:** any other typeface would need a bundling or logo licence recorded in `docs/DECISIONS.md`, per CLAUDE.md. Hand-drawing avoids this.

### F13. Launch screen
- **Purpose [S4]:**
  - "Downplay the launch experience". It is not onboarding or a splash screen.
  - Make it "nearly identical to the first screen". A solid colour if the app first shows a solid colour.
  - Match the current appearance mode.
  - "Avoid including text". "Don't include logos or other branding elements unless they're a fixed part of your app's first screen" [S4][S5].
- **Two ways to build it [S13][S14]:**
  - An Info.plist `UILaunchScreen` dictionary (iOS 14+), or a storyboard.
  - `UIColorName` names an asset-catalog colour; the default is `systemBackground`.
  - `UIImageName` is an asset-catalog image; the background shows through its transparency.
  - `UIImageRespectsSafeAreaInsets` is a Boolean.
  - Storyboards must use UIKit only, with no custom classes or connections.
- **iOS 27 rule [S17]:** apps built with the 27.0 SDK must have one of `UILaunchStoryboardName`, `UILaunchStoryboards`, `UILaunchScreen` or `UILaunchScreens`. Without one they "are rejected when the App Store begins accepting apps built with the 27.0 SDK".

### F14. Tools on this Mac for a no-dependency pipeline (verified) [S24][S26][S27]
- `rsvg-convert` 2.62.3 renders SVG to PNG and PDF.
- `swiftc` (Swift 6.3.3) has CoreGraphics, ImageIO, AppKit and SwiftUI `ImageRenderer`. Top-level `MainActor.assumeIsolated { … }` works for a compiled render tool.
- Python 3.14 standard library is enough to write SVG and JSON. No `pip` install was needed for anything tested.
- `actool`, `assetutil` and Icon Composer's `ictool` are present.
- An SVG `imageset` with `"preserves-vector-representation": true` and `"template-rendering-intent": "template"` compiled into a `Vector` rendition plus @1x/@2x/@3x template bitmaps [S26].

## What changed in the current iOS release
1. **iOS 27 icon material [S8][S10][S16][S20]:**
   - Sharper "new specular" highlights, with an Inside/Outside/Automatic choice.
   - Refraction, a 2D strength/height control including inverse refraction.
   - Deeper ring shadows and a vertical light angle from above.
   - Apple reduced translucency in its own icons, and that change isn't automatic for ours.
   - iOS 26 `.icon` files adopt the new look "without recompiling" [S8].
   - In OS versions before 27, Inside/Outside specular just means "on" and refraction has no effect [S10].
   - **Needs a newer toolchain:** Icon Composer 2.0 (Xcode 27, macOS 26.6+) or the standalone app (macOS 26.4+). Neither runs on this Mac.
2. **Bitmap icons are segmented automatically [S1][S8]:** they become two layers. Glass goes on large simple shapes only, and on iOS 27 the foreground is less translucent than on iOS 26 (HIG change, 28 Oct 2026).
3. **Liquid Glass transparency slider [S8]:** iOS 27 adds a system-wide slider. Clear-mode app icons ignore it, so we have nothing to design for.
4. **Device Hub [S1][S23]:** in Xcode 27, apps run in Device Hub windows for simulators and devices, and the HIG now cites it for icon testing. Not available on Xcode 26.6.
5. **Launch screen required [S17]:** apps built with the iOS 27 SDK must declare one. Not yet binding on 26.5 SDK builds; adopted now anyway.
6. **HIG Branding [S5]:** "Refined guidance for using brand color" (9 Sep 2026). Use the accent colour sparingly, and move brand colour into the content layer under Liquid Glass controls.
7. **Nothing changed for custom-symbol templates or `UILaunchScreen` keys** that affects us [S12][S14]. Apple now ships SF Symbols as "SF Symbols 27" on Design Resources [S22]; we don't use it.

## Recommendations for Debbie

**R1. Ship one `AppIcon.icon`, generated from SVG sources.** `ADOPT-TONIGHT`: it's the HIG-preferred format and gives control over all six appearances [S1][S10].
- **Placement:** in the app target's resources (file type `folder.iconcomposer.icon`), not in `Assets.xcassets`.
- **Build settings:** `ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon`. No `AppIcon.appiconset` anywhere.
- **Check:** `xcrun assetutil --info <App>.app/Assets.car` lists `IconImageStack` for `UIAppearanceLight`, `UIAppearanceDark` and `ISAppearanceTintable`, plus 1024 `Icon Image` Any/Dark/Tintable. The built Info.plist has `CFBundleIcons.CFBundlePrimaryIcon.CFBundleIconName = AppIcon` [S24][S26].

**R2. Write `icon.json` with the keys verified for Icon Composer 1.6 only.** `ADOPT-TONIGHT`: newer-version keys make 1.6 refuse the file [S24][S26].
- **Groups and layers:** ≤ 2 groups (Icon Composer's limit is 4 [S7]). Every layer is a full-canvas 1024×1024 SVG with outlined shapes and no text.
- **Background:** `fill` is `solid` mint, or `automatic-gradient` from the mint token.
- **Dark appearance:** `fill-specializations` with `appearance: "dark"` on both the background and the glyph.
- **Mono:** the glyph's `appearance: "tinted"` fill is white.
- **Glyph group:** `translucency.enabled = false`, or `value ≤ 0.2`.
  - Reasoning: Apple reduced translucency in iOS 27 to make icons "sharper and more legible" [S8].
- **Shadow:** `shadow.kind` is `neutral`. `layer-color` (chromatic) is allowed in Default only, with neutral kept for Dark and Mono through a specialization, following Apple's own practice [S7].
- **Colour strings:** the same `srgb:`/`display-p3:` values as the palette tokens in CRAFT.md.
- **Check:** the export script fails on any key outside this list.

**R3. Annotate every appearance explicitly; never rely on the automatic dark.** `ADOPT-TONIGHT`: the automatic dark recoloured our test glyph [S26], and the HIG asks for deliberate dark and tinted designs [S1][S7].
- Keep the same elements in all appearances; only the fills change [S1].

**R4. Contrast gate for the icon.** `ADOPT-TONIGHT`: legibility for older eyes [S1][S29].
- **Default and Dark:** in the 1024 `ictool` renders, the glyph-centre colour and a background sample 40 px inside the mask must measure ≥ 3:1. White-on-mint (~1.44:1) fails.
- **What passes:** in Default, an ink-dark companion glyph on a mint field; in Dark, a mint glyph on a deep field.
- **Clear and tinted:** in ClearLight, ClearDark and TintedDark at `--tint-color` 0.0 / 0.33 / 0.67, the glyph must be visibly distinct (reviewed by eye and recorded).

**R5. Composition keylines (1024 canvas).** `ADOPT-TONIGHT`: keeps the glyph clear of the mask and readable at notification size [S1][S2][S6][S26].
- Primary glyph inside a centred circle of ⌀ 640 px.
- Nothing essential beyond ⌀ 820 px. The mask cuts corners from 614 px out along the diagonals.
- Minimum stroke or gap 48 px, which keeps ≥ 1.9 px at the 40 px notification size.
- Glyph corner radii ≥ 24 px. No hairlines, no text.
- One glyph only, and it is the logo mark (R16).
- Reasoning for the numbers:
  - 640 px (62.5%) leaves room for the system's shadows and specular. 820 px (80%) follows the HIG's ~80% occupancy figure for document icons [S2].
  - 48 px follows from the 40 px smallest presentation (48 × 40/1024 ≈ 1.9 px).
  - The 24 px radius follows Apple's advice to avoid sharp corners [S1][S6].

**R6. Bake nothing the system draws.** `ADOPT-TONIGHT` [S1][S7][S10].
- **Never in the SVG layers:** rounded-corner mask, drop shadow, specular or bevel, blur or glow, background colour or gradient, opacity or translucency, text, photos, UI replicas, Apple hardware.
- **Check:** the export script rejects `filter`, `mask`, `clipPath`, `text`, `image` and `opacity < 1` in icon SVGs.

**R7. Render-and-review gate for the icon (no GUI).** `ADOPT-TONIGHT`: brief §8 Phase 3 needs visual evidence at every size [S8][S24][S26].
- **Appearances:** use `ictool` (path from F6) for all six `--rendition` values at 1024, and TintedLight/TintedDark at `--tint-color` 0, 0.17, 0.33, 0.5, 0.67 and 0.83.
- **Sizes:** render Default and Dark at 40, 58, 60, 80, 87, 120, 180 and 1024 px. Reasoning: these are iPhone Notification 20 pt, Settings 29 pt, Spotlight 40 pt and App 60 pt at @2x/@3x, the App Store slot at 1024, and the slot names in Xcode's asset framework [S24]. Add 16 px as a stress test.
- **Backgrounds:** build contact sheets with CoreGraphics on white, #8E8E93, black and one busy photo.
- **Record:** save everything to `Design/reviews/app-icon/` and look at each sheet.

**R8. On-device iOS 27 check, then tune.** `LATER`: iOS 27 rendering can't be previewed on this Mac [S16][S20].
- After the first TestFlight install, screenshot the Home Screen on the demo iPhone in all six looks.
- If Xcode 27 becomes available, re-check in Icon Composer 2.0's 26-vs-27 toggle. Don't add refraction unless the file still opens in 1.6.

**R9. Build the UI icon set as custom symbol assets, generated by script.** `ADOPT-TONIGHT`: they align, scale and weight-match with text like system symbols, without the SF Symbols app [S3][S12][S27].
- **Assets:** one `dx.<name>.symbolset` per icon, in the design-system module's catalog, each with a variable template:
  - `Template v.3.0`.
  - `Baseline-S/M/L` at y = 696 / 1126 / 1556, with `Capline` 70.459 above each. These are the values verified in [S27]. The system reads positions from the guides, so what matters is that guides and master transforms agree.
  - `left-` and `right-margin-` lines for each master.
  - Masters `Ultralight-S`, `Regular-S` and `Black-S`.
- **No Apple artwork:** no reference glyph from Apple, and never a duplicate of an SF Symbol. The brief counts SF Symbols as stock.
- **Check:** `assetutil` lists `Vector Glyph` entries for the three masters for every `dx.*` asset.

**R10. Symbol geometry and weights.** `ADOPT-TONIGHT`: matches system text optically [S2][S12][S28].
- **Design units:** author on an M-scale grid where 100 units equal the point size of the paired text (the 100 pt template reference), at 0.5-unit precision. Centre glyphs on the cap-height midline, 35.23 units above baseline.
- **Outer bounds at Regular-M:**
  - Round glyphs ⌀ 100 ± 3.
  - Square-ish glyphs ≤ 90 tall.
  - No glyph taller than 104 or wider than 120.
  - Asymmetric glyphs get optical-centre margins.
- **Masters:** the generator scales by 0.783 for S and strokes the centreline at **2.21 / 7.50 / 14.20** (Ultralight-S / Regular-S / Black-S), so each stroke grows equally inward and outward, as the system's do.
- **Check:** the system's derivation reproduces Apple's stroke rule [S27]. Rendered at 400 pt, the stroke must be 8.30 ± 5% at Regular-M and 11.20 ± 5% at Semibold-M per 100 pt. Measure across the glyph's widest horizontal stroke, the same method as F9.

**R11. Icon drawing rules.** `ADOPT-TONIGHT`: consistency is the HIG's first icon rule [S1][S2][S3][S6][S9][S28].
- **Strokes and corners:** round caps and round joins. Outer corner radius ≥ 1× stroke. Gaps and counters ≥ 1× stroke.
- **Complexity:** ≤ 3 distinct elements, frontal flat perspective, no letters or numerals inside icons.
- **Variants:** outline is the default. A filled variant with the same silhouette exists only where it marks selection or an active state (selected tab, live camera, acknowledged alert).
- **Metaphors:** familiar ones, true to platform metaphors (share, close, back), with inclusive figures.
- **Inventory to draw:** pairing/QR, code, alert (possible fall), acknowledge, false alarm, connected, can't reach home, monitoring degraded, monitoring unknown, phone removed, live view/camera, camera-live, stop, laptop/add laptop, heart rate, sync, queued ("will send when home"), resident, settings, unpair, history, chevrons, close.

**R12. Our own symbol lint plus render test, because `actool` doesn't validate templates.** `ADOPT-TONIGHT` [S12][S27].
- **Lint (fails the build):** fail if `template-version` is missing, or `Notes`, `Guides` or `Symbols` is missing. Fail on any `stroke`, `filter`, `opacity` or hidden element under `Symbols`, on an unclosed subpath, on fewer than 7 decimals, or on path or element counts that differ between masters.
- **Render test:** a Swift `ImageRenderer` sheet of every icon beside "Home Hg" at UltraLight/Regular/Black × 17/34/56 pt, saved to `Design/reviews/symbols/` and inspected.
- **Fallback:** if an icon's masters can't share topology, emit explicit variants for all 9 weights × 3 scales, using the F9 stroke table.

**R13. Use icons the same way everywhere, and ban system glyphs.** `ADOPT-TONIGHT`: brief §3 forbids SF Symbols; HIG asks for labels [S2][S3][S25].
- **Meaningful icons:** `Image("dx.alert", bundle: .designSystem, label: Text("Possible fall"))`, where `.designSystem` is a `Bundle` constant for the design-system module.
- **Decorative icons:** `Image(decorative:bundle:)`.
- **Sizing:** size icons by `.font(...)` text style, never by a fixed frame, so Dynamic Type and Bold Text apply.
- **Colour:** icon colours only from CRAFT.md tokens, ≥ 3:1 against their background [S29]. Any icon that signals state also has a text label.
- **Check:** a test greps the sources and fails on `systemName:`, `systemImage:`, `UIImage(systemName`, `iconWithSystemImageName` and `systemImageName:`.
- Reasoning: system-drawn controls (navigation back button, `Menu`, `Picker`, `DisclosureGroup`) draw system chevrons, which is one more reason for custom components (topic 9).

**R14. Draw `Shape` icons only for animated glyphs.** `ADOPT-TONIGHT` for the camera-live indicator; `LATER` for status-ring and empty-state animations [S25][S28].
- **Size:** `@ScaledMetric(relativeTo: .body)` base size `s`, frame `1.2·s`. Reasoning: measured M-scale system symbol frames are 1.14–1.17× the point size [S28].
- **Stroke:** `0.083·s` at Regular, `0.112·s` at Semibold (the M-scale values in F9). Switch Regular to Semibold when `legibilityWeight == .bold`.
- **Ends and joins:** round caps and joins, the same keylines as R10 scaled by `s/100`.
- **Motion:** only CRAFT.md motion tokens (brief §3).

**R15. Notification action icons.** `ADOPT-TONIGHT` if actions ship tonight, otherwise `LATER` [S25].
- Use `UNNotificationActionIcon(templateImageName: "dx.ack")` with Debbie's assets.
- Never `systemImageName`.

**R16. Logo mark rules.** `ADOPT-TONIGHT` [S1][S2][S3][S8][S29][S30].
- **Construction:** ≤ 3 geometric primitives, designed in solid black first.
- **Small size:** no stroke or counter narrower than 6.25% of the mark's width, i.e. ≥ 1 px at 16 px. Render with `rsvg-convert -w 16/24/32/48/64` and inspect.
- **Approved pairings:** ink on white, white on ink, ink on mint, mint on the deep companion. Each must be ≥ 3:1. Mint on white or light backgrounds is never approved.
- **Distinctiveness:** not confusable with any SF Symbol, Apple product or existing care or home-monitoring app. Checked with a side-by-side review in Phase 3, recorded in `docs/DECISIONS.md`.
- **Reuse:** the same mark is the app-icon glyph.

**R17. Wordmark: hand-drawn letterforms.** `ADOPT-TONIGHT`: the SF licence forbids artwork and derivatives [S21].
- **Drawing:** draw "debbie" on its own grid: x-height, ascender and stem set equal to the mark's stroke at the lockup size. Never trace SF Pro, New York or any installed font. Ship as outlined SVG paths only.
- Reasoning: lowercase gives the d-b-b ascender rhythm a distinctive word shape. Title case is acceptable if Phase 3 review prefers it.
- **Where it appears:** only on the welcome/onboarding screen and Settings › About. Never in navigation bars, never on the launch screen [S4][S5][S9].

**R18. Deliver brand assets as vector, tintable images.** `ADOPT-TONIGHT` [S26][S31].
- **Format:** `Logo.imageset` and `Wordmark.imageset` hold the source SVG, with `preserves-vector-representation: true` and `template-rendering-intent: template`. Colour comes from tokens, so light, dark and increased-contrast variants come free.
- **Two-colour lockups:** use two layered template images, not baked colour.

**R19. Launch screen = background colour only.** `ADOPT-TONIGHT`: the HIG asks for exactly this, and the iOS 27 SDK will require the key [S4][S5][S13][S14][S17].
- **Info.plist:** `UILaunchScreen = { UIColorName = "LaunchBackground" }`. No `UIImageName`, no storyboard.
- **Colour:** `LaunchBackground` is an asset-catalog colour whose Any and Dark values equal the canvas token of the first screen (welcome and home share it).
- **Check:** on a fresh Simulator install (`simctl erase`, then install, launch and an immediate `simctl io screenshot`), the launch frame and the first rendered frame have the same background colour, and the launch frame has no logo or text.

**R20. Pipeline layout (relocatable, no third-party dependencies).** `ADOPT-TONIGHT`: brief §3 needs an editable vector source and an export script for every asset [S24][S25][S26][S27].
- **Sources:** `Design/brand/{mark,wordmark}.svg`, `Design/app-icon/layers/*.svg` plus `Design/app-icon/icon.template.json`, and `Design/symbols/src/*.svg`. Symbol sources are stroke-based, 100-unit, `M/L/C/Z`, `line`, `circle` and `rect rx` only.
- **Scripts:** `Design/scripts/export-*.swift`, compiled with `xcrun swiftc -O` and run from the repo root.
  - CoreGraphics strokes the symbol outlines and writes the `.symbolset`s.
  - A script assembles `AppIcon.icon`.
  - Another renders the review sheets.
- **Lookups:** tools are found through `xcode-select -p` and `xcrun`. No absolute paths.
- **Outputs:** go into the app's asset catalogs and `Design/reviews/`.

## Open questions / risks
- **iOS 27 look unverified:** we can't preview how iOS 27 renders our icon on this Mac. Icon Composer 1.6 shows the 26 look, and updating macOS needs the owner and admin rights. Check on the demo iPhone after the first TestFlight build (R8). Also unknown: how iOS 27's "Automatic" specular treats 1.6's boolean `specular` key.
- **Undocumented `icon.json` schema:** the keys in F6 come from string inspection and experiment, not documentation. A future Icon Composer can change them. Pin the script to the keys verified here and fail loudly.
- **`ictool` location:** it lives inside the Icon Composer app bundle, and the `usr/bin/ictool` stub doesn't render. The path may move in later Xcode releases. The script should check that it exists and print a clear error.
- **Calibration platform:** the stroke and extent numbers were measured on macOS 26.2 AppKit. iOS should match, but confirm with a Simulator snapshot in Phase 5.
- **Apple keylines unread:** we did not read Apple's iOS 27 template keylines (licence click-through), so R5's numbers are Debbie's own reasoning and measurements. If the owner accepts the Apple Design Resources licence, compare R5 against the template grid.
- **Launch-screen caching:** Reasoning: iOS is widely reported to cache launch-screen snapshots, so a changed colour may not appear until reinstall. This is developer folklore, not verified tonight. Verify on an erased Simulator.
- **Increase Contrast at launch:** unverified whether `UIColorName` picks an asset colour's "High Contrast" variant on the launch screen.
- **Older licence wording:** the fonts page licence text names "iOS, OS X or tvOS" (older wording). The DMG may carry newer wording. Either way the bans on artwork and derivative works decide R17.
- **App Store icon alpha:** if we ever fall back to an asset-catalog PNG icon, the 1024 Any image must be opaque and unmasked. Reasoning: an App Store icon with an alpha channel is a long-standing upload validation failure. Not re-verified tonight because the `.icon` path generates its own.

## Sources
- [S1] App icons — Apple Human Interface Guidelines — https://developer.apple.com/design/human-interface-guidelines/app-icons — last updated 2026-10-28 (page change log; also 2026-06-08, 2025-06-09) — accessed 2026-11-14 — primary
- [S2] Icons — Apple Human Interface Guidelines — https://developer.apple.com/design/human-interface-guidelines/icons — last updated 2025-06-09 — accessed 2026-11-14 — primary
- [S3] SF Symbols — Apple Human Interface Guidelines — https://developer.apple.com/design/human-interface-guidelines/sf-symbols — last updated 2025-07-28 — accessed 2026-11-14 — primary
- [S4] Launching — Apple Human Interface Guidelines — https://developer.apple.com/design/human-interface-guidelines/launching — last updated 2024-06-10 — accessed 2026-11-14 — primary
- [S5] Branding — Apple Human Interface Guidelines — https://developer.apple.com/design/human-interface-guidelines/branding — last updated 2026-09-09 — accessed 2026-11-14 — primary
- [S6] Say hello to the new look of app icons (WWDC25 session 220), transcript — Apple — https://developer.apple.com/videos/play/wwdc2025/220/ — June 2025 — accessed 2026-11-14 — primary
- [S7] Create icons with Icon Composer (WWDC25 session 361), transcript — Apple — https://developer.apple.com/videos/play/wwdc2025/361/ — June 2025 — accessed 2026-11-14 — primary
- [S8] Icon Composer for Beginners Group Lab (WWDC26 session 8012), transcript — Apple — https://developer.apple.com/videos/play/wwdc2026/8012/ — June 2026 — accessed 2026-11-14 — primary
- [S9] Communicate your brand identity on iOS (WWDC26 session 251), transcript — Apple — https://developer.apple.com/videos/play/wwdc2026/251/ — June 2026 — accessed 2026-11-14 — primary
- [S10] Creating your app icon using Icon Composer — Apple Developer Documentation — https://developer.apple.com/documentation/xcode/creating-your-app-icon-using-icon-composer — undated (current text covers 27 releases) — accessed 2026-11-14 — primary
- [S11] Configuring your app icon using an asset catalog — Apple Developer Documentation — https://developer.apple.com/documentation/xcode/configuring-your-app-icon — undated — accessed 2026-11-14 — primary
- [S12] Creating custom symbols — Apple Developer Documentation — https://developer.apple.com/documentation/technologyoverviews/custom-sf-symbols — undated — accessed 2026-11-14 — primary
- [S13] Specifying your app's launch screen — Apple Developer Documentation — https://developer.apple.com/documentation/xcode/specifying-your-apps-launch-screen — undated — accessed 2026-11-14 — primary
- [S14] UILaunchScreen, UIColorName, UIImageName, UIImageRespectsSafeAreaInsets — Apple Developer Documentation — https://developer.apple.com/documentation/bundleresources/information-property-list/uilaunchscreen — undated (iOS 14.0+) — accessed 2026-11-14 — primary
- [S15] Adopting Liquid Glass — Apple Developer Documentation — https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass — undated — accessed 2026-11-14 — primary
- [S16] Xcode 27 Release Notes — Apple Developer Documentation — https://developer.apple.com/documentation/xcode-release-notes/xcode-27-release-notes — undated (Xcode 27 cycle, 2026) — accessed 2026-11-14 — primary
- [S17] iOS & iPadOS 27 Release Notes — Apple Developer Documentation — https://developer.apple.com/documentation/ios-ipados-release-notes/ios-ipados-27-release-notes — undated (2026) — accessed 2026-11-14 — primary
- [S18] Software Releases — Apple Developer News — https://developer.apple.com/news/releases/ — entries dated 2026-09-28 to 2026-11-13 (iOS 27.2.1 on 2026-11-09) — accessed 2026-11-14 — primary
- [S19] Upcoming Requirements — Apple Developer News — https://developer.apple.com/news/upcoming-requirements/ — SDK minimum "since April 28, 2026"; iOS 13 minimum target "since September 9, 2026" — accessed 2026-11-14 — primary
- [S20] Icon Composer — Apple Developer — https://developer.apple.com/icon-composer/ — undated ("Requires macOS Tahoe 26.4 or later") — accessed 2026-11-14 — primary
- [S21] License Agreement for the Apple San Francisco Font — Apple Developer, Fonts page — https://developer.apple.com/fonts/ — undated — accessed 2026-11-14 — primary
- [S22] Apple Design Resources — Apple Developer — https://developer.apple.com/design/resources/ — undated page; iOS 27 icon template DMG Last-Modified 2026-06-08, SF Symbols 27 DMG 2026-11-04 (HTTP headers) — accessed 2026-11-14 — primary
- [S23] What's new in Xcode 27 (WWDC26 session 258), transcript — Apple — https://developer.apple.com/videos/play/wwdc2026/258/ — June 2026 — accessed 2026-11-14 — primary
- [S24] Local toolchain inspection on this Mac:
  - Icon Composer 1.6 (99.1): `Info.plist`, embedded `Contents/Executables/ictool` usage and error text, `IconComposerFoundation` strings.
  - The `actool(1)` man page.
  - `AssetCatalogCompiler.xcspec`.
  - `AssetCatalogCocoaTouchFoundation` slot names, from Xcode 26.6 (17F113).
  
  — local — 2026-11-14 — accessed 2026-11-14 — primary (verified locally)
- [S25] Local SDK interfaces: `iPhoneOS26.5.sdk` SwiftUICore/SwiftUI `.swiftinterface`, `UserNotifications/UNNotificationActionIcon.h`, `UIKit/UIImage.h` and `UIImageSymbolConfiguration.h`; `MacOSX26.5.sdk` CoreGraphics `.swiftinterface` and `CGPath.h` — local — 2026-11-14 — accessed 2026-11-14 — primary (verified in local SDK)
- [S26] Local experiments A (scratchpad, not in repo):
  - Hand-written `.icon` documents rendered with `ictool` in all six renditions and at 16–1088 px.
  - `icon.json` keys bisected.
  - Compiled with `actool` for iOS 17 and 26 targets and inspected with `assetutil`.
  - An asset-catalog Any/Dark/Tinted icon compiled.
  - SVG vector imageset compiled.
  - Mask geometry measured.
  
  — this Mac, 2026-11-14 — accessed 2026-11-14 — primary data
- [S27] Local experiments B (scratchpad):
  - Script-generated custom symbol templates (static `Regular-M`, and variable `Ultralight-S`/`Regular-S`/`Black-S`).
  - Negative tests (no `template-version`, stroked circle) compiled with `actool`.
  - Rendered beside `Text` with SwiftUI `ImageRenderer` on macOS.
  - Derived S/M/L strokes and diameters at four weights measured at 400 pt.
  - CGPath stroking topology test.
  
  — this Mac, 2026-11-14 — accessed 2026-11-14 — primary data
- [S28] Local experiments C (scratchpad): CoreText stem widths of the system font. AppKit rasterisation of system symbols (circle, square, heart, house, bell, minus, plus, chevron.right, checkmark) at 100 and 400 pt, for size, stroke and terminal calibration only — this Mac (macOS 26.2), 2026-11-14 — accessed 2026-11-14 — primary data
- [S29] Web Content Accessibility Guidelines (WCAG) 2.2, SC 1.4.11 Non-text Contrast — W3C — https://www.w3.org/TR/WCAG22/#non-text-contrast — W3C Recommendation 2023-10-05, updated 2024-12-12 — accessed 2026-11-14 — secondary
- [S30] Henderson, P. W. & Cote, J. A., "Guidelines for Selecting or Modifying Logos", Journal of Marketing 62(2):14–30 — American Marketing Association / SAGE — https://doi.org/10.1177/002224299806200202 — 1998 — accessed 2026-11-14 (via bibliographic record and excerpt) — secondary (peer-reviewed)
- [S31] Providing images for different appearances — Apple Developer Documentation (UIKit) — https://developer.apple.com/documentation/uikit/providing-images-for-different-appearances — undated — accessed 2026-11-14 — primary
