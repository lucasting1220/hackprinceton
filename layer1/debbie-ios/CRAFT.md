# CRAFT.md — how Debbie is designed and built

_The master practice for the Debbie iOS app (binding brief `KICKOFF_PROMPT.md` §10). Every screen and every change passes §9. Every rule is specific, checkable, and cites research (`[NN Rk]` = `docs/research/NN-*.md` recommendation k), a lead decision (`[X n]`, `docs/research/lead-decisions.md`), a decision record (`[D-nnn]`), the brief, or written reasoning. v1 written 2026-11-14 11:0x EST under the owner's 2-hour pivot (D-015); its review is a documented self-review (§10.4) because the account's API limit stopped subagents._



## 1. Principles

Seven principles. Each maps to Apple's 2026 design principles [HIG Design principles, 8 Jun 2026, via 01 S4]
and says what it means for Debbie in practice. When two rules conflict, the earlier principle wins.

| # | Principle | Apple principle | What it means for Debbie (checkable) | Basis |
|---|---|---|---|---|
| P1 | **Calm until it matters.** | Purpose, Responsibility | The urgent colour, the Time Sensitive interruption level and the `.warning` haptic appear only for an unacknowledged `urgent` alert. Status changes play no sound and no haptic. Bounce appears only on a gesture's release. A screen at rest has nothing moving. | [10 R1–R2, R15][06 R6][03 R2][04 R3] |
| P2 | **Say what we know, and how old it is.** | Responsibility, Agency | Every status shows the time of its last confirmation. "Unknown" is its own state, with its own glyph and words. The healthy glyph and the words "Monitoring is on" appear only when 10 R14's three conditions hold. "No alerts" is never shown without the monitoring state beside it. | [10 R14, R16][L1 "When things fail"][X5] |
| P3 | **One screen, one job.** | Simplicity, Purpose | Each screen in `docs/research/15-flows-and-states.md` has one sentence describing its job and at most one primary (filled) button. The resident screen has at most 3 controls. | [Brief §4.3][01 R1][09 R5][X6] |
| P4 | **Familiar first, Debbie second.** | Familiarity | Every control is Debbie's own component, including the top bar, back button and sheet header, but each keeps the system's placement, size, gestures and transitions. Navigation is system push (with the interactive swipe-back kept), sheets and covers. Liquid Glass appears only in floating chrome. The brand lives in content, never in bars. | [02 R3–R12][01 R12][05 R2][HIG Branding][X44][Brief §3] |
| P5 | **Motion and touch explain cause.** | Craft, Delight | Every animation uses a named Motion token, and every haptic is an event from the §4 map. A gesture's release carries its velocity. Every motion can be interrupted. Nothing moves or buzzes for decoration. | [03 R1–R6][04 R1–R2][05 R1] |
| P6 | **Everyone can read it, in every state.** | Flexibility | Primary and secondary text is at least 7:1 in all four appearances. Every screen works through AX5 with no truncated essential text. Targets are at least 44 / 56 / 64 / 96 pt by tier. Every visual signal also has words for VoiceOver. | [06 R2][07 R4–R6, R12][X8][X21] |
| P7 | **The resident stays in charge.** *(Suspended for the TestFlight presentation by owner direction, 17:40, D-032: no switch; restore before any real use.)* | Responsibility, Agency | Live view is off until the resident turns it on. Turning it off takes effect at once and is never confirmed or delayed. While the camera is live, the live bar is always on screen, and is never colour-only. The app never nags the resident. | [L1 "Live-view consent"][10 R18, R21][X16] |

### 1.1 What simplicity means, per screen, and how it is checked

Simplicity in Debbie means: one job per screen, at most one primary (filled) action, and a small, counted number of things to touch [Brief §4.3][P3][01 R1][09 R5]. The budget below is the maximum number of hittable interactive elements at the default text size, before scrolling. `SimplicityTests` (XCUITest) counts `app.descendants(matching: .any).matching(NSPredicate(format: "isHittable == true AND elementType IN %@", [button, switch, textField, link]))` on each screen and fails over budget. Reasoning for the numbers: Hick–Hyman (choice time grows with the number of options) applied to stress-narrowed working memory [10 Summary][10 [S28][S29]]; each budget is the smallest set that still does the job in brief §5.1.

| Screen | One job | Primary action (max 1) | Interactive budget |
|---|---|---|---|
| S01 Welcome | Start pairing (or try the demo) | Get Started | 3 (Get Started, Try the Demo, About) |
| S02 Who uses this iPhone? | Choose a role | Continue | 3 (2 choice cards + Continue) |
| S03/S04/S08/S16 Priming | Explain, then ask | Continue | 1 (exactly one button [01 R9]) |
| S05 Scan | Point at the code | none (scanning is automatic) | 2 (Close; Debug-only Paste) |
| S06 Compare the code | Confirm on the laptop | none while waiting; Try Again on error | 2 |
| S07 Paired | Confirm success | Continue | 1 |
| S09 Home | "Is everything all right, and what needs me?" | I'm On It on the newest unacknowledged urgent alert, else none | 6 (top bar Settings, the alert card's action, Live View, History, Status, Call) |
| S10 Alert | Understand and respond | the alert's primary (Call / Open Live View / I'm On It) | 4 (3 buttons + 1 text button [10 R9]) |
| S11 History | Review past alerts | none | Back + rows (rows scroll; budget counts Back only) |
| S12 Status | See what's working | none | 1 (Back) |
| S13 Live view | Look in, briefly | Stop | 2 (Stop; Keep Watching at the end) |
| S14 Add a laptop | Approve a laptop | Approve | 2 (Approve, Cancel) |
| S15 Resident | Send heart rate | Sync Now | 2 (Sync Now, Settings [X6]). The live-view switch was removed by owner direction (17:40; D-032) |
| S17 Settings | Manage this iPhone | none | rows ≤ 10; exactly 1 destructive (Unpair) |

## 2. Design system

Everything here lives in `Packages/DebbieKit/Sources/DebbieDesignSystem/` and is the only place visual values are written down [11a R2][06 R1][07 R10]. Feature code uses tokens and components, never literals.

### 2.1 Colour

**Source of truth:** `Design/tokens/colors.json` → `tools/design/tokens.py --write` → `Colors.generated.swift` (dynamic `UIColor` providers keyed on interface style and accessibility contrast) and `Design/tokens/contrast-report.md`. The tables below are copied from that report. `ColorTokenTests` re-measures every pairing at test time, so CRAFT.md and the code can't drift [06 R1, R11].

Rules:
- C1. Every colour in the app is a semantic token with four variants: light, dark, light with Increase Contrast, dark with Increase Contrast. Literal colours (`Color(red:`, `UIColor(red:`, hex strings, `Color.red`/`.green`/`.mint`…) are banned outside `DebbieDesignSystem` (lint) [06 R1, R4].
- C2. Contrast thresholds (WCAG 2.x ratio): primary and secondary text **≥ 7:1** in all four appearances. Tertiary text ≥ 4.5:1 (≥ 7:1 with IC). Labels on `mint.fill` and `caution.fill` ≥ 7:1. Labels on `urgent.fill` and `live.fill` ≥ 4.5:1 (≥ 7:1 with IC). Icons, control boundaries and focus rings ≥ 3:1 (≥ 4.5:1 with IC). Separators are decorative, but ≥ 3:1 with IC. The large-text 3:1 exception is never used [06 R2][X9].
- C3. **Mint stays mint:** `mint.fill` measures CIELAB h 158–170°, C\* ≥ 35, L\* ≥ 78 in every appearance. Mint is never text on a light surface; `accent.text` carries the mint hue as text and icons [06 R3].
- C4. **Mint's jobs:** the brand mark, **one** primary-action fill per screen, the calm hero surface, and `mint.tint` rows. Nothing else [06 R3][HIG Branding, Sep 2026].
- C5. **One meaning per hue:** mint = calm and "go"; amber = needs attention soon; red = act now; indigo = camera is live. No decorative amber, red or indigo anywhere, illustrations included [06 R12].
- C6. **Urgent budget:** `urgent.fill` is the only saturated solid fill in the app. It appears only on the newest **unacknowledged** urgent alert. After acknowledgement the card returns to neutral, and urgency persists only as `urgent.text` plus the glyph and its words [06 R6][10 R17].
- C7. Status = shape + words + position; colour only reinforces. Status glyphs have distinct silhouettes (§2.6), and each always appears with its word. Tints and coloured text are never the only difference between two statuses, because they collapse under simulated colour-blindness to ΔE00 0.8–1.7 [06 R5][10 R17].
- C8. ~~Follow the system appearance.~~ **Light only** by owner direction (17:24: "I requested the dark green background to be white"; D-032): `UIUserInterfaceStyle` is `Light`. The dark and dark-IC tokens stay defined and measured, so following the system again is one Info.plist line. No in-app light/dark switch. The live-view screen is always dark (`live.scrim`) [06 R7, R10].
- C9. With Increase Contrast, filled buttons and cards add a 1.5 pt `border.control`. With Show Borders (`accessibilityShowBorders`), every text-only button gets a border [06 R8][02 R13].

**Measured values** (generated; every text and icon pairing, all four appearances):
_Generated by `tools/design/tokens.py` from `Design/tokens/colors.json`. Do not edit by hand._

WCAG 2.x contrast ratio, (L1 + 0.05) / (L2 + 0.05), with sRGB linearisation threshold 0.04045.

#### Tokens

| Token | Role | Light | Dark | Light + IC | Dark + IC |
|---|---|---|---|---|---|
| `bg.canvas` | Screen background | `#F3F7F5` | `#0E1412` | `#F3F7F5` | `#000000` |
| `bg.surface` | Cards, sheets | `#FFFFFF` | `#18201D` | `#FFFFFF` | `#121916` |
| `bg.sunken` | Wells | `#E8EFEB` | `#0A0F0D` | `#E3EBE7` | `#000000` |
| `text.primary` | Primary text | `#14201B` | `#EAF2EE` | `#000000` | `#FFFFFF` |
| `text.secondary` | Secondary text | `#3F4D47` | `#B4C2BB` | `#26312C` | `#D7E2DC` |
| `text.tertiary` | Placeholders | `#5E6B65` | `#93A29B` | `#3A4641` | `#BCC9C2` |
| `mint.fill` | Signature mint | `#6CDCB0` | `#6CDCB0` | `#6CDCB0` | `#8EEBC6` |
| `mint.tint` | Calm tint | `#DDF5EA` | `#123026` | `#D2F1E3` | `#1C4536` |
| `text.onMint` | Text on mint | `#06392A` | `#06392A` | `#00241A` | `#00241A` |
| `accent.text` | Mint companion text | `#0A6B4D` | `#6CDCB0` | `#00523A` | `#8EEBC6` |
| `ok.icon` | OK glyph | `#0A6B4D` | `#6CDCB0` | `#00523A` | `#8EEBC6` |
| `ok.tint` | OK tint | `#DDF5EA` | `#123026` | `#D2F1E3` | `#1C4536` |
| `caution.fill` | Caution fill | `#F2A93B` | `#F2A93B` | `#F2A93B` | `#FFCB66` |
| `caution.tint` | Caution surface | `#FFF0D2` | `#3A2C0E` | `#FFEBC4` | `#45330F` |
| `caution.text` | Caution text | `#7A4A00` | `#F6C35E` | `#5C3700` | `#FFD68A` |
| `text.onCaution` | Text on caution | `#2E1C00` | `#2E1C00` | `#1F1300` | `#1F1300` |
| `urgent.fill` | Urgent fill | `#C2182B` | `#D42A3C` | `#A00E1F` | `#A8101F` |
| `text.onUrgent` | Text on urgent | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` |
| `urgent.border` | Urgent border | `#C2182B` | `#FF8A92` | `#A00E1F` | `#FFB3B9` |
| `urgent.tint` | Urgent tint | `#FCE6E8` | `#45161B` | `#FADADD` | `#561A21` |
| `urgent.text` | Urgent text | `#A3121F` | `#FF8A92` | `#850A17` | `#FFB3B9` |
| `live.fill` | Live badge | `#3446C8` | `#3446C8` | `#3446C8` | `#3446C8` |
| `text.onLive` | Text on live | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` |
| `live.border` | Live outline | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` |
| `live.scrim` | Live background | `#0B0F0D` | `#0B0F0D` | `#000000` | `#000000` |
| `separator` | Hairlines | `#D3DDD8` | `#2E3934` | `#7D8B84` | `#8A9891` |
| `border.control` | Control outlines | `#7B8A83` | `#7F8E87` | `#3A4641` | `#C3CFC9` |
| `mint.fill.pressed` | Signature mint, pressed (lighter, keeps text.onMint >= 7:1) | `#7DE3BC` | `#86E8C3` | `#7DE3BC` | `#9DEFD0` |
| `urgent.fill.pressed` | Urgent fill, pressed | `#A31326` | `#BE2234` | `#8C0D1B` | `#93101D` |
| `surface.pressed` | Quiet button / row pressed background | `#E8EFEB` | `#222C28` | `#DFE8E3` | `#1A2420` |
| `fill.disabled` | Disabled control fill | `#DDE5E1` | `#26302B` | `#D3DCD7` | `#2C3631` |
| `label.disabled` | Disabled control label (>= 3:1 on fill.disabled) | `#63706A` | `#909E98` | `#4A5651` | `#AEBBB5` |
| `focus.ring` | Keyboard / Switch Control focus ring | `#0A6B4D` | `#6CDCB0` | `#00523A` | `#8EEBC6` |

#### Pairings (foreground on background)

| Foreground | Background | Use | Min | Light | Dark | Light + IC | Dark + IC | Result |
|---|---|---|---|---|---|---|---|---|
| `text.primary` | `bg.canvas` | Body and headings on the screen background | 7 | 15.52 | 16.35 | 19.43 | 21.00 | PASS |
| `text.primary` | `bg.surface` | Body and headings on cards and sheets | 7 | 16.77 | 14.59 | 21.00 | 17.85 | PASS |
| `text.secondary` | `bg.canvas` | Timestamps, metadata on the background | 7 | 8.22 | 10.09 | 12.47 | 15.80 | PASS |
| `text.secondary` | `bg.surface` | Timestamps, metadata on cards | 7 | 8.88 | 9.00 | 13.48 | 13.43 | PASS |
| `text.tertiary` | `bg.surface` | Placeholders and hints on cards (never essential) | 4.5 / 7 IC | 5.57 | 6.24 | 9.85 | 10.43 | PASS |
| `text.tertiary` | `bg.canvas` | Placeholders and hints on the background | 4.5 / 7 IC | 5.16 | 6.99 | 9.11 | 12.27 | PASS |
| `text.onMint` | `mint.fill` | Primary button label; text on the mint hero | 7 | 7.69 | 7.69 | 9.87 | 11.72 | PASS |
| `text.primary` | `mint.tint` | Text on calm/OK rows | 7 | 14.63 | 12.48 | 17.43 | 10.75 | PASS |
| `accent.text` | `bg.canvas` | Mint-family links and icon-buttons on the background | 4.5 / 7 IC | 6.03 | 11.09 | 8.57 | 14.85 | PASS |
| `accent.text` | `bg.surface` | Mint-family links and icon-buttons on cards | 4.5 / 7 IC | 6.52 | 9.90 | 9.26 | 12.62 | PASS |
| `accent.text` | `mint.tint` | Mint-family text on calm rows | 4.5 / 7 IC | 5.68 | 8.47 | 7.69 | 7.60 | PASS |
| `ok.icon` | `bg.surface` | Healthy status glyph on cards | 3 / 4.5 IC | 6.52 | 9.90 | 9.26 | 12.62 | PASS |
| `ok.icon` | `ok.tint` | Healthy status glyph on calm rows | 3 / 4.5 IC | 5.68 | 8.47 | 7.69 | 7.60 | PASS |
| `caution.text` | `bg.surface` | Attention glyph and emphasis on cards | 4.5 / 7 IC | 7.48 | 10.20 | 10.49 | 12.95 | PASS |
| `caution.text` | `bg.canvas` | Attention glyph and emphasis on the background | 4.5 / 7 IC | 6.92 | 11.43 | 9.71 | 15.24 | PASS |
| `caution.text` | `caution.tint` | Attention glyph on the degraded / can't-reach-home surface | 4.5 / 7 IC | 6.64 | 8.33 | 8.96 | 8.79 | PASS |
| `text.primary` | `caution.tint` | Text on the degraded / can't-reach-home surface | 7 | 14.89 | 11.92 | 17.93 | 12.11 | PASS |
| `text.onCaution` | `caution.fill` | Label on a small attention badge | 7 | 8.20 | 8.20 | 9.13 | 12.15 | PASS |
| `urgent.text` | `bg.surface` | Urgent glyph and words on cards (after acknowledgement) | 4.5 / 7 IC | 7.88 | 7.36 | 10.23 | 10.54 | PASS |
| `urgent.text` | `bg.canvas` | Urgent glyph and words on the background | 4.5 / 7 IC | 7.30 | 8.25 | 9.47 | 12.40 | PASS |
| `urgent.text` | `urgent.tint` | Urgent glyph on acknowledged-alert history rows | 4.5 / 7 IC | 6.62 | 6.72 | 7.86 | 7.92 | PASS |
| `text.primary` | `urgent.tint` | Text on acknowledged-alert history rows | 7 | 14.07 | 13.32 | 16.14 | 13.42 | PASS |
| `text.onUrgent` | `urgent.fill` | Label on the newest unacknowledged urgent alert | 4.5 / 7 IC | 6.07 | 5.00 | 8.15 | 7.61 | PASS |
| `urgent.border` | `bg.surface` | Urgent banner outline on cards (dark-mode separation) | 3 / 4.5 IC | 6.07 | 7.36 | 8.15 | 10.54 | PASS |
| `urgent.border` | `bg.canvas` | Urgent banner outline on the background | 3 / 4.5 IC | 5.62 | 8.25 | 7.54 | 12.40 | PASS |
| `text.onLive` | `live.fill` | "LIVE" badge label and countdown | 4.5 / 7 IC | 7.35 | 7.35 | 7.35 | 7.35 | PASS |
| `live.border` | `live.scrim` | Live badge outline on the always-dark live screen | 3 / 4.5 IC | 19.29 | 19.29 | 21.00 | 21.00 | PASS |
| `text.onLive` | `live.scrim` | Live-view chrome text on the dark scrim | 7 | 19.29 | 19.29 | 21.00 | 21.00 | PASS |
| `border.control` | `bg.surface` | Text-field and toggle outlines; IC button borders on cards | 3 / 4.5 IC | 3.62 | 4.85 | 9.85 | 11.13 | PASS |
| `border.control` | `bg.canvas` | Control outlines on the background | 3 / 4.5 IC | 3.35 | 5.43 | 9.11 | 13.09 | PASS |
| `text.onMint` | `mint.fill.pressed` | Pressed primary button label | 7 | 8.35 | 8.82 | 10.72 | 12.38 | PASS |
| `text.onUrgent` | `urgent.fill.pressed` | Pressed urgent button label | 4.5 / 7 IC | 7.84 | 6.06 | 9.60 | 9.00 | PASS |
| `text.primary` | `surface.pressed` | Pressed quiet button / row | 7 | 14.36 | 12.64 | 16.79 | 15.94 | PASS |
| `accent.text` | `surface.pressed` | Pressed quiet button label | 4.5 / 7 IC | 5.58 | 8.57 | 7.40 | 11.27 | PASS |
| `label.disabled` | `fill.disabled` | Disabled control label | 3 / 4.5 IC | 4.04 | 4.89 | 5.47 | 6.30 | PASS |
| `focus.ring` | `bg.canvas` | Focus ring | 3 / 4.5 IC | 6.03 | 11.09 | 8.57 | 14.85 | PASS |
| `focus.ring` | `bg.surface` | Focus ring on cards | 3 / 4.5 IC | 6.52 | 9.90 | 9.26 | 12.62 | PASS |
| `text.primary` | `bg.sunken` | Primary text on bg.sunken | 7 | 14.36 | 16.96 | 17.30 | 21.00 | PASS |
| `text.secondary` | `bg.sunken` | Secondary text on bg.sunken | 7 | 7.61 | 10.46 | 11.11 | 15.80 | PASS |
| `text.secondary` | `mint.tint` | Secondary text on mint.tint | 7 | 7.75 | 7.70 | 11.19 | 8.09 | PASS |
| `text.secondary` | `caution.tint` | Secondary text on caution.tint | 7 | 7.89 | 7.36 | 11.51 | 9.12 | PASS |
| `text.secondary` | `urgent.tint` | Secondary text on urgent.tint | 7 | 7.46 | 8.22 | 10.36 | 10.09 | PASS |
| `text.secondary` | `surface.pressed` | Secondary text on surface.pressed | 7 | 7.61 | 7.80 | 10.78 | 12.00 | PASS |
| `accent.text` | `bg.sunken` | Mint-family interactive text on bg.sunken | 4.5 / 7 IC | 5.58 | 11.50 | 7.63 | 14.85 | PASS |
| `accent.text` | `caution.tint` | Mint-family interactive text on caution.tint | 4.5 / 7 IC | 5.79 | 8.08 | 7.91 | 8.57 | PASS |
| `accent.text` | `urgent.tint` | Mint-family interactive text on urgent.tint | 4.5 / 7 IC | 5.47 | 9.04 | 7.12 | 9.49 | PASS |
| `text.tertiary` | `bg.sunken` | text.tertiary on wells | 4.5 / 7 IC | 4.77 | 7.25 | 8.11 | 12.27 | PASS |
| `border.control` | `bg.sunken` | border.control on wells | 3 / 4.5 IC | 3.10 | 5.63 | 8.11 | 13.09 | PASS |
| `focus.ring` | `bg.sunken` | focus.ring on wells | 3 / 4.5 IC | 5.58 | 11.50 | 7.63 | 14.85 | PASS |

#### Colour-vision separation (CIEDE2000; minimum 17)

Simulated with Machado et al. 2009 (severity 1.0). Colour is never the only signal, and this checks that the hues still separate.

| Pair | Appearance | Normal | Protanopia | Deuteranopia | Tritanopia |
|---|---|---|---|---|---|
| `mint.fill` vs `urgent.fill` | Light | 73.8 | 46.5 | 31.4 | 70.9 |
| `mint.fill` vs `urgent.fill` | Dark | 72.5 | 40.0 | 26.5 | 71.2 |
| `mint.fill` vs `urgent.fill` | Light + Increase Contrast | 76.2 | 55.5 | 39.2 | 73.1 |
| `mint.fill` vs `urgent.fill` | Dark + Increase Contrast | 74.5 | 56.5 | 41.6 | 72.0 |
| `mint.fill` vs `caution.fill` | Light | 41.0 | 18.7 | 21.1 | 55.8 |
| `mint.fill` vs `caution.fill` | Dark | 41.0 | 18.7 | 21.1 | 55.8 |
| `mint.fill` vs `caution.fill` | Light + Increase Contrast | 41.0 | 18.7 | 21.1 | 55.8 |
| `mint.fill` vs `caution.fill` | Dark + Increase Contrast | 34.1 | 17.1 | 20.8 | 45.5 |
| `mint.fill` vs `live.fill` | Light | 59.9 | 56.5 | 53.4 | 38.7 |
| `mint.fill` vs `live.fill` | Dark | 59.9 | 56.5 | 53.4 | 38.7 |
| `mint.fill` vs `live.fill` | Light + Increase Contrast | 59.9 | 56.5 | 53.4 | 38.7 |
| `mint.fill` vs `live.fill` | Dark + Increase Contrast | 60.9 | 56.9 | 54.7 | 41.6 |
| `caution.fill` vs `urgent.fill` | Light | 43.5 | 41.1 | 26.8 | 27.7 |
| `caution.fill` vs `urgent.fill` | Dark | 41.1 | 35.8 | 22.0 | 23.7 |
| `caution.fill` vs `urgent.fill` | Light + Increase Contrast | 49.4 | 47.4 | 36.3 | 35.8 |
| `caution.fill` vs `urgent.fill` | Dark + Increase Contrast | 54.5 | 54.1 | 39.2 | 40.8 |
| `urgent.fill` vs `live.fill` | Light | 41.3 | 46.8 | 58.4 | 57.6 |
| `urgent.fill` vs `live.fill` | Dark | 41.2 | 44.3 | 58.5 | 59.2 |
| `urgent.fill` vs `live.fill` | Light + Increase Contrast | 40.4 | 47.0 | 56.0 | 55.5 |
| `urgent.fill` vs `live.fill` | Dark + Increase Contrast | 41.0 | 47.9 | 57.0 | 55.9 |

#### Result

All pairings and separations pass.

- C10. `accent.text` and `ok.icon` share values on purpose: same mint family, told apart by form (interactive text sits inside a button shape, underlined or bordered under Show Borders; status always carries its glyph and word) [X47].

### 2.2 Type
System fonts through the API only: SF Pro for running text, SF Pro Rounded for the hero line and numerals. Nothing bundled [07 R1][D-006]. Every `Text` uses a role; `.font(.system(size:))` is banned outside the design system (lint) [07 R2].

| Role | Text style | Default size/leading | Weight | Design | Use | Largest size |
|---|---|---|---|---|---|---|
| `hero` | `.largeTitle` | 34/41 | Bold | Rounded | One per screen: the status headline | Clamped at AX3 (52 pt) [07 R4] |
| `title` | `.title2` | 22/28 | Bold | Rounded | Section and screen titles in content | AX5 |
| `headline` | `.headline` | 17/22 | Semibold | Default | Alert titles, row and card titles | AX5 |
| `body` | `.body` | 17/22 | Regular | Default | Every sentence | AX5 |
| `bodyStrong` | `.body` | 17/22 | Semibold | Default | Key facts inside body (times, names) | AX5 |
| `button` | `.body` | 17/22 | Semibold | Default | All button labels | AX5 |
| `secondary` | `.subheadline` | 15/20 | Regular | Default | Timestamps, metadata, helper lines | AX5 |
| `footnote` | `.footnote` | 13/18 | Regular | Default | Legal and help text only; the smallest text in the app | AX5 |
| `metric` | `.largeTitle` | 34/41 | Semibold, `monospacedDigit()` | Rounded | Heart rate, live countdown | AX5 (badge use clamped at xxxLarge) |
| `resident.metric` | `@ScaledMetric(relativeTo: .largeTitle)` from 64 pt | 64 | Bold, `monospacedDigit()` | Rounded | The resident's last reading | AX5 |
| `resident.body` | `.title3` | 20/25 | Regular (Semibold for labels) | Default | All resident-mode text | AX5 |

- T1. Banned: `.caption`, `.caption2`; Ultralight, Thin and Light weights; italic running text; all-caps strings longer than one word (the only all-caps string is "LIVE"); manual tracking or kerning [07 R3].
- T2. Reflow: when `dynamicTypeSize.isAccessibilitySize`, any HStack of text plus an accessory becomes a VStack (`AnyLayout`), text first. Button pairs use `ViewThatFits(in: .horizontal)` [07 R5].
- T3. Truncation: `lineLimit(nil)` by default. Only user-entered names in single-line rows may truncate (`.tail`), and only when the row opens a view showing the full name. Never truncate alert text, status lines, errors or button labels. No fixed heights on text containers [07 R6].
- T4. `minimumScaleFactor` is banned, except ≥ 0.8 on numeral badges [07 R7].
- T5. Paragraphs that can reach 3+ lines use loose leading (`.lineHeight(.loose)` on iOS 26). Paragraph spacing is `space.12` [07 R8].
- T6. Glyphs next to text scale with that text (symbols via `.font`; shapes via `@ScaledMetric(relativeTo:)`) [07 R9][08 R13].

### 2.3 Spacing and layout
Only these values, as tokens [07 R10]:

| Token | Value | When to use |
|---|---|---|
| `space.4` | 4 pt | Icon-to-label gap in chips and badges; value-to-unit gap |
| `space.8` | 8 pt | Between tightly related lines (title ↔ subtitle); icon ↔ label in buttons |
| `space.12` | 12 pt | Chip and badge padding; minimum gap between adjacent bezeled controls; paragraph spacing |
| `space.16` | 16 pt | Inner padding of cards and rows; gap between cards; primary button 16 pt above the bottom safe area |
| `space.20` | 20 pt | Screen side margins; status header padding |
| `space.24` | 24 pt | Between groups within a screen; clearance around borderless text buttons |
| `space.32` | 32 pt | Between major regions; separation of a destructive action from other buttons |
| `space.48` | 48 pt | Top and bottom breathing room in hero, empty and onboarding screens |

- L1. `space.4`–`space.16` scale with `@ScaledMetric(relativeTo: .body)`. Margins and region gaps don't scale [07 R10].
- L2. No numeric literals in `.padding`, `spacing:` or `.frame` outside the design system (lint) [07 R10].
- L3. Content stays inside the safe area with 20 pt margins. Only backgrounds and live video are full-bleed. Nothing interactive sits under the Dynamic Island, status bar or home indicator [07 R11].

**Touch targets** [X8][X21][07 R12–R13]:

| Tier | Minimum | Applies to |
|---|---|---|
| Every interactive element | 44 × 44 pt hit region | All controls, icon buttons (glyph 24–28 pt inside), rows |
| `regular` | 48 pt tall | Secondary actions in content |
| `large` | 56 pt tall, full width | The screen's primary action |
| `prominent` | 64 pt tall, full width | Alert response actions (I'm On It, Call, Open Live View) and live-view Stop |
| `resident` | 96 pt tall, full width | Every resident-mode control |

Gaps: ≥ 12 pt between bezeled controls, ≥ 24 pt around borderless buttons, ≥ 32 pt between a destructive action and anything else. No swipe-only actions [07 R12–R13].

### 2.4 Shapes and corner radii
Only three shape kinds: capsule, the radius tokens, and `ConcentricRectangle` for anything nested inside another rounded shape [02 R9].

| Token | Value | Use |
|---|---|---|
| `radius.12` | 12 pt (continuous) | Text fields, small chips that aren't capsules, list-row highlight |
| `radius.20` | 20 pt (continuous) | Cards, status header, alert cards |
| `radius.28` | 28 pt (continuous) | Panels and large hero surfaces |
| capsule | — | Buttons, badges, the live badge, toggles |
| `ConcentricRectangle` | system | Shapes nested in cards or sheets (inner radius = outer − padding, computed by the system) |

- S1. Literal `cornerRadius:` values are banned outside the token file (lint) [02 R9]. (The note's radius.8/16 were dropped: three radii are enough. Reasoning.)

### 2.5 Materials and depth
- D1. Two layers. Liquid Glass only in floating chrome (top bar, floating action bar, live-view controls), built only in `DebbieDesignSystem/Chrome/`. Never on cards, rows, alerts, status or empty states (lint for `glassEffect` and `.glass` outside `Chrome/`) [02 R3].
- D2. Chrome uses the real system material (`Glass.regular`, `.interactive()` when tappable, `GlassEffectContainer` for clusters). No imitation glass: `UIBlurEffect` and `.ultraThinMaterial` are banned in `Chrome/` [02 R4].
- D3. No glass on glass. At most one tinted glass control per screen (the primary action) [02 R5, R7].
- D4. Custom bars attach with `safeAreaBar(edge:)`, with no background, divider or `.soft` scroll edge effect [02 R8].
- D5. Live-view controls over video use clear glass over a 35 % black dimming layer, except the live bar, which is opaque `live.fill` (it must never vary with the video) [02 R6][10 R18].
- D6. Content depth comes from surface tokens (`bg.canvas` < `bg.surface`), never from shadows on moving views. Cards have no shadow [05 R12]. Reasoning: shadows on moving views cost offscreen passes, and surfaces carry the hierarchy in dark mode [06 R10].
- D7. Alert, status and live text never sits on a translucent material [10 R25].

### 2.6 Icons
- I1. UI icons are custom symbol assets (`dx.<name>.symbolset`), written into both the design system's catalog and the app's catalog (notification action icons are looked up in the main bundle [review:icons F08-03]), generated by `Design/scripts/` from stroke-based 100-unit SVG sources. They scale, align and weight-match with text like system symbols. No SF Symbols anywhere in the UI (lint for `systemName:` and `systemImage:`) [08 R9, R13][X23].
- I2. Grid and geometry: M scale, 100 units = the point size of the paired text. Round glyphs ⌀ 100 ± 3, square-ish ≤ 90 tall, none taller than 104 or wider than 120, centred on the cap-height midline (35.23 above baseline). Strokes at Regular-M are 8.30 per 100 [08 R10].
- I3. Drawing rules: round caps and joins; outer corner radius ≥ 1 × stroke; gaps and counters ≥ 1 × stroke; ≤ 3 elements; frontal, flat; no letters or numerals inside icons; outline by default, filled only for a selected or active state [08 R11].
- I4. Status glyphs have five distinct silhouettes (healthy, attention, urgent, unknown, info). Each must be identifiable in greyscale at 50 % size [10 R17].
- I5. Meaningful icons carry a label (`Image(_:bundle:label:)`); decorative ones use `Image(decorative:)` [08 R13].
- I6. The only `Shape`-drawn glyph is the animated camera-is-live ring [08 R14].

### 2.7 Illustrations
No research note covers illustration style specifically. These rules are reasoned from the colour, icon and caregiver research, plus HIG Images (read by the lead at 09:56).
- IL1. Illustrations appear only on onboarding, empty states and success moments. Never on alert, status-detail or live-view screens. Reasoning: P1, and care surfaces carry facts, not decoration.
- IL2. They are built from the icon grid's vocabulary (round caps, the same corner rule, 2–3 simple shapes per object), so they read as part of the icon family [08 R11].
- IL3. Colours come only from `mint.fill`, `mint.tint`, `accent.text`, `bg.sunken` and `text.secondary`. No amber, red or indigo [06 R12][C5].
- IL4. No human faces or bodies. Use homes, laptops, phones, a heart and a watch. Reasoning: avoids ageist or clinical depictions of the resident, and keeps the resident's dignity [10 [S38] privacy and dignity findings].
- IL5. Every illustration is decorative (`accessibilityHidden`); its meaning is in the adjacent text. At accessibility text sizes (AX1+) it shrinks to ≤ 25 % of the screen height, or is hidden, so text never scrolls below the fold because of art. Reasoning: text is the content.
- IL6. Source: token-coloured SVG in `Design/illustrations/src/`, with control points on whole units of the 1× grid so edges stay crisp at @2x and @3x. An export script writes per-appearance variants (light, dark, both IC) into the asset catalog as vector (SVG) assets [HIG Images: "Flat icons, interface icons, and other flat artwork…: PDF or SVG"; "position control points at whole values so that they're cleanly aligned at 1x", read 09:56].

### 2.8 Logo, wordmark and app icon
- B1. The logo mark is ≤ 3 geometric primitives, designed in solid black first. No stroke or counter narrower than 6.25 % of its width (≥ 1 px at 16 px). Approved pairings (each ≥ 3:1): ink on white, white on ink, ink on mint, mint on deep green. Mint on white is never used [08 R16].
- B2. The wordmark "debbie" is hand-drawn lowercase outlines on its own grid. It is never traced from any font. It appears only on the welcome screen and in Settings › About [08 R17][D-006].
- B3. The app icon is an asset-catalog `AppIcon.appiconset` with **Any, Dark and Tinted** 1024-px variants, rendered by `Design/scripts/app-icon.sh` from SVG sources (D-013: Apple doesn't document the `.icon` format, so the brief's asset-catalog branch applies). Any = ink glyph on a mint field; Dark = mint glyph on a deep-green field; Tinted = a light-grey glyph on black, which the system tints. Glyph-to-field contrast ≥ 3:1 in Any and Dark. Nothing the system draws is baked in (mask, shadow, specular, blur, text) [08 R4–R6][X24][X55].
- B6. Clear space around the mark = 25% of its width. Minimum sizes: mark 16 px, wordmark 64 px wide, lockup 96 px wide. Misuse, never allowed: recolouring outside the approved pairings, stretching, outlines, shadows, putting the mark on photos, or using it on the launch screen [review:icons F08-12].
- B4. Every brand and icon asset is rendered and reviewed at 16, 40, 58, 60, 80, 87, 120, 180 and 1024 px, and in all six icon appearances, before it ships [08 R7].
- B5. The launch screen is the `LaunchBackground` colour only (= `bg.canvas`, light and dark). No logo, no text [08 R19][X17]. The intro that begins on the app's first frame (§3.7) is not the launch screen: the colour match is what makes the handoff invisible.

## 3. Motion

All motion lives in `DebbieDesignSystem/Motion/Motion.swift`. Views never name an animation curve [03 R1, R3].

### 3.1 Named springs

Values were computed with `SwiftUI.Spring` on this Mac [03 R1, S9]. ζ = 1 − bounce. Settling time is the "settled" column.

| Token | `Spring(duration:bounce:)` | 95 % at | Settled | Overshoot | Use for | Reduce Motion substitute |
|---|---|---|---|---|---|---|
| `Motion.press` | 0.20, 0 | 0.152 s | 0.30 s | 0 | Pressed state of every custom control, both directions | Same spring, with no scale: only the colour or highlight changes |
| `Motion.state` | 0.40, 0 | 0.303 s | 0.60 s | 0 | In-screen state changes: status header, expand/collapse, selection, numeric text, reflow | Colour and opacity keep `state`; position and size reflow without animation |
| `Motion.settle` | 0.40, 0.15 | 0.235 s | 0.72 s | 0.6 % | **Only** the release of a gesture that carried momentum; always inherits the gesture's velocity | `Spring(duration: 0.40, bounce: 0)`, with 1:1 tracking kept during the drag |
| `Motion.alertArrive` | 0.45, 0 | 0.340 s | 0.70 s | 0 | A live urgent or attention alert entering a visible list, and its siblings making room | `fadeIn`; siblings reflow without animation |
| `Motion.present` | 0.50, 0 | 0.378 s | 0.80 s | 0 | Custom presentations and large moves: inline panels, banners, matched-geometry morphs | `crossFade` |
| `Motion.exit` | 0.30, 0 | 0.227 s | 0.50 s | 0 | Custom elements leaving: a banner going out, a card removed | `fadeOut` |
| `Motion.tabSelect` | 0.30, 0 | 0.227 s | 0.50 s | 0 | The tab bar's selection highlight moving to the tapped tab (T17). Retargets mid-flight when another tab is tapped [16 R8] | `tabFade`: the highlight fades out at the old tab and in at the new one |
| `Motion.iconQuick` | 0.15, 0 | — | ≈ 0.25 s | 0 | The first step of an icon effect (§3.5), like the touch that started it [16 R9] | None: only the outline-to-fill change remains |
| `Motion.iconSettle` | 0.25, 0 | 0.189 s | 0.40 s | 0 | An icon effect's return to rest; any overshoot is an explicit pose, never spring bounce [16 R9] | None |

Fades (timing curves are fine for opacity, where velocity continuity doesn't matter) [03 R11]:

| Token | Curve | Use |
|---|---|---|
| `Motion.fadeIn` | `.easeOut(duration: 0.25)` | Entrances, first video frame, Reduce Motion substitute for entrances |
| `Motion.fadeOut` | `.easeIn(duration: 0.20)` | Exits |
| `Motion.crossFade` | `.easeInOut(duration: 0.30)` | Root swaps (T5), Reduce Motion substitute for presentations |
| `Motion.spin` | `.linear(duration: 1.0).repeatForever(autoreverses: false)` | Indeterminate rotation only |
| `Motion.tabFade` | `.easeInOut(duration: 0.15)` | Switching tabs: the content cross-fades in place, as the system's tab bar does (T16) [16 R7] |
| `Motion.settleIn(delay:)` | `.offset(y: 24) + .opacity` on `present`, delayed 0 / 0.04 / 0.08 s | Content rising in beneath something that is arriving, on its spring (T19). Reduce Motion: opacity on `crossFade` |
| `Motion.Intro.*` | Clock times, two `UnitCurve`s and the drawing's measures (line widths, glow, persistence, rises); its springs are `settle`, `present` and `exit` | The launch intro (§3.7): every value it needs, in one place |

### 3.2 Rules
- M1. No token has bounce > 0.15 or duration outside 0.15–0.5 s; `settlingDuration ≤ 0.8 s`. *Check:* `MotionTests` iterates `Motion.allSprings` [03 R2].
- M2. No anonymous animation outside `Motion.swift`. *Check:* the lint `grep -rnE 'withAnimation *\{|withAnimation\(\)|\.animation\(\.default|\.(easeIn|easeOut|easeInOut|linear|bouncy|snappy|interactiveSpring)\b' Packages App --include=*.swift | grep -v Motion.swift` prints nothing [03 R3].
- M3. Gestures: `onChanged` assigns the translation with no animation, so SwiftUI tracks velocity. `onEnded` decides using `predictedEndTranslation`: commit when the projection is ≥ 40 % of the container, then `withAnimation(Motion.settleAnimation)` so the velocity carries over. `DragGesture` keeps the 10 pt default minimum distance [03 R4].
- M4. Interruption: never disable hit-testing because an animation is running. Chain with `withAnimation(_:completionCriteria: .logicallyComplete, _:completion:)`, never with `asyncAfter` or `Task.sleep` [03 R6]. *Check:* `grep -rnE 'asyncAfter|Task\.sleep' Packages/DebbieKit/Sources/*/Views` prints nothing.
- M5. Choreography: the touched element moves in the same transaction as the input. Stagger at most 3 elements, 40 ms apart. No `.delay()` > 0.08 s [03 R7].
- M6. Restored data (cold start, history, de-duplicated replays) applies with `disablesAnimations = true`. Only live arrivals animate [03 R8].
- M7. Motion is never the only signal: every animated change also changes text, icon or colour, and new alerts post a VoiceOver announcement [03 R13].
- M8. Only `live`, `working` and Debbie's `idle` (§3.6) may repeat, and only while their condition is true (idle: while her face is on screen). Nothing flashes more than 3 times per second. Under Reduce Motion both are static, with words ("Camera is live", "Connecting…") [03 R14].
- M9. `MotionPolicy` (an environment value) combines `accessibilityReduceMotion` and `UIAccessibility.prefersCrossFadeTransitions`. Debug builds accept `-DebbieReduceMotion YES` for screenshots; Release compiles it out [03 R10].

### 3.3 Transitions catalogue
Exactly one row applies to every change of screen or state [05 R1]. System transitions are never modified [05 R2].

| ID | Change | Transition | Timing | Reduce Motion |
|---|---|---|---|---|
| T1 | Drill-in: Home → Alert, Settings → sub-page | System `NavigationStack` push | System | System |
| T3 | Short task returning to the same place (false-alarm confirm, approve laptop name) | `.sheet` + detents + visible drag indicator | System | System |
| T4 | Immersive or multistep: pairing, add-laptop scanner, live view | `.fullScreenCover` | System | System |
| T5 | Root state change: unpaired ↔ paired, caregiver ↔ resident, removed from home | Root swap `.transition(.opacity)` | `crossFade` | Same |
| T6 | Step inside a linear flow (pairing steps) | `.push(from: .trailing)` forward, `.leading` back | `state` | `.opacity` + `crossFade` |
| T7 | Live alert arrives in a visible list | `.move(edge: .top).combined(with: .opacity)`, siblings reflow | `alertArrive` | `fadeIn`, no reflow animation |
| T8 | Acknowledged alert leaves Active for History | `motion.alertCard`: `.opacity` out, rows reflow (D-034) | `alertArrive` (one spring drives the whole list, so arrivals and departures share it) | `.opacity`, no reflow animation |
| T9 | Status header state | Same container; glyph `.contentTransition(.symbolEffect(.replace.downUp))`; label `.contentTransition(.opacity)` | `state` | Opacity only, symbol effects removed |
| T10 | Heart-rate value | `.contentTransition(.numericText(value:))` | `state` | `.opacity` |
| T11 | Live countdown (every second) | None, `.monospacedDigit()` | — | — |
| T12 | Loading ↔ content ↔ empty ↔ error | Same layout; `redacted(reason: .placeholder)`; swap by `.opacity` | `fadeIn` / `fadeOut` | Same |
| T13 | Selection highlight (role choice) | `matchedGeometryEffect` on the highlight | `state` | Highlight cross-fades in place |
| T14 | Live-view states | Panels swap by `.opacity`; video fades in on its first frame | `crossFade` / `fadeIn` | Same |
| T15 | Camera-is-live bar | Appears with the first frame; **removed without animation** when the session ends | `fadeIn` in, none out | Static |
| T16 | Switching tabs (Home, Live, Debbie, History, Devices) | Only the selected tab exists (hidden pages leaked their bars to VoiceOver). The content cross-fades in place: no drift, slide or scale. The Home tab's navigation path survives switching; re-tapping Home returns to its root [16 R5, R7] | `tabFade` | Same |
| T17 | Tab bar selection | A mint-tint highlight capsule moves to the tapped item with `matchedGeometryEffect`. The icon swaps outline → filled and plays its effect (§3.5). A tap mid-flight retargets the spring from its current position and velocity [16 R8] | `tabSelect` | The highlight fades in place; the fill swap stays |
| T18 | Settings | The corner gear turns one tooth (§3.5) as the Settings sheet rises (T3) | `press` + `iconStep` | Sheet only |
| T19 | The launch intro's lockup taking its place on the welcome (§3.7) | `matchedGeometryEffect` from the centred slots to the layout's slots; the tile's corner rounds into a circle and the mark becomes Debbie's face by opacity; the words then the buttons `settleIn` (24 pt rise on the same spring) 40 ms apart | `present` | Fades only, in place: the lockup appears where it will stay |

### 3.5 Icon animations (owner direction 15:44: "custom icons and animations" for every button)
Each icon moves the way its object would, once per tap, in 2–4 steps: the first on `iconQuick`, the return on `iconSettle` (a full turn uses `present`). Every sequence ends on a pose identical to rest, so the snap back is invisible. Bounds [16 R9]: ≤ 0.6 s in total, scale 0.85–1.15, ≤ 4 pt travel, ≤ 15° turns except rotationally symmetric glyphs (gear, sync ring), which end on an identical pose. Under Reduce Motion `DAnimatedIcon` skips the movement and keeps only the outline-to-fill swap (M8, M9). Effects never repeat on their own (M8), and they never play on restored data (M6). *Check:* `DIconEffect.poses` in `IconMotion.swift`; the recording in §3.4.

| Icon | Effect | Steps | When |
|---|---|---|---|
| `home` / `home.fill` | `hop` | down 2 pt with a 0.94 squash → rest (0.40 s) | Home tab tapped |
| `camera` / `camera.fill` | `lensPop` | 110 % → rest (0.40 s) | Live tab tapped; Start Live View |
| `history` / `history.fill` | `rewind` | turn back 45° → rest (0.40 s) | History tab tapped |
| `laptop` / `laptop.fill` | `lidOpen` | lid dips to 88 % from the hinge → rest (0.40 s) | Devices tab tapped |
| `gear` | `turn` | turn 60° (one tooth) | Settings tapped |
| `heart` / `heart.fill` | `beat` | 110 % → 97 % → 106 % → rest, lub-dub (0.60 s) | A new, live heart reading arrives (never on restored data) |
| `sync` | `spin` | one full turn | Sync Now tapped, and again when it succeeds |

### 3.6 Debbie's idle motion (owner direction 16:16; D-030)
A face that never moves looks like a photo. One that moves too much looks nervous. Debbie stays within these bounds [17]:

| Part | Motion | Amplitude | Period | Reduce Motion |
|---|---|---|---|---|
| Body | breathing scale, anchored at the bottom | ≤ 1 % (0.8 %) | 4.8 s, sine | none |
| Head | tilt around the neck at (100, 150) of the 200×200 canvas | ±2° | 7.3 s, sine | none |
| Eyes | blink: open → squash → closed → squash → open; plain dark rounds with no white (owner, 17:24: catch-lights read as white pupils) | 130 ms closed; the squash lands on the closed lids' line (anchor y 0.471, measured by the export script) | one per 4.4 s window, placed pseudo-randomly; never a double blink, and at least 2 s apart (owner, 17:24) | eyes open |

- I1a. The idle pose is a pure function of time (`IdlePose(at:)`), so every Debbie on screen moves in step, and no timer or `Task.sleep` drives it (M4). *Check:* `IconMotion`/`DebbieAvatar` tests; recording.
- I1b. `TimelineView(.animation(minimumInterval: 1/30))` drives it, only while the avatar is on screen. Under Reduce Motion there is no `TimelineView`.
- I1c. Debbie's face never appears on urgent-alert surfaces, the live view or the status header. Urgency is never a cartoon (CRAFT §1 P2).


### 3.7 The launch intro (owner direction 20:55; D-033)
The system launch screen stays a plain `bg.canvas` (B5). The intro begins on the app's first frame and plays **only when the app opens on the welcome screen, once per process**: a paired caregiver opening to an alert never waits for it. It is one sequence driven by one clock: `IntroPose.at(t)` is a pure function of time, like Debbie's idle (I1a), so every frame is reproducible, a tap can move the clock, and `IntroShapeTests` checks the whole timeline. All values are `Motion.Intro` tokens.

| Time (s) | What happens | Tokens |
|---|---|---|
| 0.00–0.89 | A heart monitor's line is already running under a pen that sits on the mark's stem: 0.9 s of line is on screen in the first frame, with the first beat already on it, drifting; the second strikes at 0.25 s. 80 a minute, real P-QRS-T proportions, 120 pt/s, fading like phosphor | `paperSpeed`, `preroll`, `beatInterval`, `firstBeat` |
| 0.89–1.11 | The paper brakes evenly to a stop as the third beat's P wave passes, and the line rounds into the stem. The third beat falls exactly one beat after the second: the rhythm stays even | `flowEnds`, `stemEntry` |
| 1.11–1.53 | The third beat's upstroke *is* the mark: the pen draws the outline in one movement (the stem is the fastest stroke, as an R wave rises; the bowl and the close are the soft part) while the old trace drains away from the left | `flourish`, `flourishCurve` |
| 1.48–1.88 | The line thickens and pools into the solid mark; the pen's mint glow swells from the stem into the tile on the settle spring, whose small overshoot is the lockup's one beat | `setBegins`, `setDuration`; the bloom settles on `Motion.settleSpring` |
| 1.54–1.84 | The wordmark rises in beneath | `wordmarkAt`, `wordmarkDuration` |
| 1.95–2.80 | Handoff (T19): the lockup glides to its place at the top of the welcome while the tile rounds into a circle, the mark shrinks away (`exit`) and Debbie arrives a breath later (`present`); a quarter second in, once the lockup has passed where they sit, the words and then the buttons (laid out at full width from the first frame, so nothing re-wraps) rise in beneath it on the same `present` spring | `handoffAt`, `arriveAt`, `doneAt`, `faceDelay`, `markLeaveScale` |

- N1. The mark is finished and on its way within 2.0 s, the welcome is interactive by about 2.5 s. A tap anywhere (or VoiceOver starting) ends the intro the way Reduce Motion plays it: the trace fades and the lockup glides into place; never a one-frame cut. *Check:* `IntroShapeTests.theTimelineIsOrderedAndShort`; `IntroUITests`.
- N2. Reduce Motion: no trace, no glide, no change of shape. The finished lockup fades in where it will stay (0.3 s), holds, and at 0.8 s the tile fades out as Debbie, on her own circle, fades in with the words. With VoiceOver running there is no intro at all: it is decorative, and the welcome's words are what matter. *Check:* `IntroShapeTests.reduceMotionShowsTheFinishedLockupFadingIn`; the `intro-RM` recording.
- N3. Once per process, and only on the welcome: never after unpairing or leaving the demo in the same session (`IntroGate`).
- N4. The intro's layers are hidden from accessibility and hit-testing, and the welcome's words are hidden until they appear, so nothing is announced or tappable that can't be seen.
- N5. Colours and sizes: the line is `accent.text`, 3 pt; the mark sets into `text.onMint` on `mint.fill`, as the app icon; the tile is the hero size with `Radius.brandTile`; the pen's glow is `mint.fill` at 30 %.
- N6. The first in-app frame is `bg.canvas`, the same colour as the launch screen, so there is no flash between them.
- N7. Verified by `tools/video/record-intro.sh small off` and `small on`: 30 fps frames and a 10 fps sheet in `Design/reviews/recordings/`, inspected by eye; the per-frame change scores show no single-frame jumps.

### 3.4 How motion is verified (from the command line)
| Check | Tool | Pass condition |
|---|---|---|
| Token bounds | `MotionTests` (Swift Testing) over `Motion.allSprings` | 0 ≤ bounce ≤ 0.15; 0.15 ≤ duration ≤ 0.5 s; settling ≤ 0.8 s [M1] |
| Reduce Motion mapping | `MotionPolicyTests` | every T-row maps to its Reduce Motion substitute for both policy values [M9] |
| No raw motion | `tools/ci/lint.sh` rules M1–M8 | prints nothing (brief §3: "a test or lint MUST fail on raw animation curves") |
| Continuity, no flashes | `tools/video/record.sh` + `tools/video/frames.swift --fps 30` on every transition in §3.3 | frames inspected by eye. Per-frame change scores show one smooth ramp: no single-frame spike above the neighbours' ×3 (a flash or jump), and no 0.00 plateau inside the motion (a held frame). Recordings and frames go in `Design/reviews/motion/` |
| Interruption | One recording per screen gate that taps again mid-animation (e.g. I'm On It during `alertArrive`) | the element retargets from its current position (no snap back, no restart) [M4] |
| Reduce Motion | Screenshots and one recording with `-DebbieReduceMotion YES`, and with `simctl spawn … defaults write com.apple.Accessibility ReduceMotionEnabled -bool true` | no translation or scale; fades only [M9] |
| Hitches | `XCTHitchMetric`, signpost metrics | recorded on the Simulator; gated on a device (LATER) [05 R10][11b R17] |
| The launch intro (§3.7) | `tools/video/record-intro.sh small off`, then `small on` | one continuous movement from the first frame to the welcome, no flash at the launch handoff, interactive by about 3.4 s; under Reduce Motion no translation, scale or change of shape. The 30 fps extraction can hide a held native frame: for a hitch check, read the recording's own frame times (`ffprobe -show_frames`) and look for gaps above 25 ms during the glide |

T2 (zoom navigation) is on the later list: there is a known iOS 26 flicker risk, which conflicts with "no flashes" [05 R5][X12].

## 4. Haptics

One vocabulary: `enum DebbieHaptic` in `DebbieDesignSystem/Haptics/`, played only through `.debbieHaptic(_:trigger:)`, which wraps `sensoryFeedback` [04 R1]. *Check:* `grep -rnE "sensoryFeedback\(|UI(Impact|Notification|Selection)FeedbackGenerator|CHHapticEngine" Packages App --include=*.swift | grep -v "/Haptics/"` prints nothing.

### 4.1 The map (the only events that play anything)

| Event | Fires exactly when | Feedback | Paired with (motion moment) | Why |
|---|---|---|---|---|
| `scanRecognized` | A QR code decodes to a valid, unexpired Debbie payload (once per scan) | `.impact(weight: .light)` | The viewfinder frame snaps onto the code, in the same transaction | Impact means "snaps into place" [04 R2] |
| `scanInvalid` | A decoded code isn't Debbie's, or has expired (once per payload, ≥ 3 s apart) | `.error` | The inline message appears | Failure |
| `paired` | The pairing bundle is decrypted and stored | `.success` | The success mark settles (`.logicallyComplete`) | Outcome |
| `pairingFailed` | The flow enters expired, used, wrong-network, timeout or decrypt-failure | `.error` | The error card lands | Failure |
| `alertUrgentArrived` | A new urgent `alert_id` is first rendered in the foreground **and the system presented no sound for it** | `.warning` | The card lands (`alertArrive` complete) | Once per `alert_id` [04 R2, R12][X4] |
| `acknowledged` | "I'm On It" or the false alarm commits to the local outbox | `.success` | The label settles on "On it" | The caregiver's own action [X35] |
| `liveViewStarted` | The first decoded video frame is on screen | `.success` | The video finishes fading in | `.start` only plays on watchOS [X3] |
| `liveViewDenied` | The hub replies "denied" | `.warning` | The denied panel lands | |
| `liveViewEndedByResident` | The resident turns live view off mid-session | `.warning` | The video gives way to the ended panel | Unexpected end |
| `liveViewLost` | The connection fails or drops (not Stop, not the time limit) | `.error` | The error panel lands | |
| `laptopApproved` | The hub confirms the approval | `.success` | The success mark settles | |
| `laptopApprovalFailed` | The approval is rejected or can't be delivered | `.error` | The error card lands | |
| `syncSucceeded` | The resident's "Send now" is accepted by the LAN gateway | `.success` | "Sent" settles | Reassurance for a deliberate act |
| `syncFailed` | "Send now" on home Wi-Fi, but the gateway didn't accept | `.error` | The message appears | |
| `toggleChanged` | The person flips a Debbie toggle (never on programmatic changes) | `.selection` | The knob commits | |
| `choiceChanged` | The person picks a different role card | `.selection` | The selection ring moves | |
| `unpairIncomplete` | The phone was wiped but the hub couldn't be told | `.warning` | The notice card | |

### 4.2 Never gets a haptic
Ordinary taps, navigation, sheets, scrolling, pull-to-refresh, typing. Status header changes (can't reach home, degraded, back online, removed). Non-urgent alerts. Alert wording updates. Background data (heart-rate arrival, fetches). Live view stopped by the caregiver or at the time limit, and the countdown. "Will send when you're home". A clean unpair. Priming and system prompts. Anything in the notification extension or in the background [04 R3].

### 4.3 Rules
- H1. Only `.success`, `.warning`, `.error`, `.selection` and `.impact(weight:)` at intensity 1.0 are allowed. `.start`, `.stop`, `.increase`, `.decrease`, `.levelChange`, `.press`, `.release` and `.selection(_:)` are banned [04 R4][X3]. *Check:* unit test over `DebbieHaptic.allCases`.
- H2. Timing: impulse events change the trigger in the same transaction as the state change. Landing events change it in the completion of `withAnimation(<named spring>, completionCriteria: .logicallyComplete)`. Under Reduce Motion, the haptic fires when the substitute fade completes [04 R5].
- H3. Rate limits: one haptic per `alert_id`, ever (persisted). One haptic for a burst of alerts within 2 s. None within 300 ms of another. At most one `.error` per user action [04 R6].
- H4. A haptic is never the only signal. Every event has a visible text change, and events that occur without a tap also post an `AccessibilityNotification.Announcement` [04 R7].
- H5. There is no in-app vibration switch: the system's Haptics and Vibration settings govern, and the HIG says not to duplicate system settings [X2].
- H6. Live view runs with no audio-input session, so haptics are never suppressed during it [04 R11].
- H7. Each event is checked on a device once per release, felt once at its visual moment (on-device checklist, §9) [04 R13].

## 5. Components

Every control is Debbie's own component in `DebbieDesignSystem` and replaces the system default look [Brief §3][09 R1][X22][X44]. Lint K1 and I1–I2 fail on system-default styles and glyphs. Each component carries all six states, or says "N/A" with the reason. Pressed changes colour and scales to 0.97 (no scale under Reduce Motion) using `Motion.press` [09 R4][03 R1]. Disabled uses `fill.disabled`/`label.disabled` (≥3:1), with a visible reason next to the control [09 R4]. Loading puts a spinner before a gerund label at locked width, and an idempotent action guard stops double sends [09 R4]. Focused uses the system focus effect plus a 2 pt `focus.ring` on fields [09 R4]. Error is never a red button: the host view shows an inline icon, words, and a recovery verb [09 R4].

| Component | Replaces | Sizes ([X21]) | States beyond the six / notes | Accessibility | Haptic |
|---|---|---|---|---|---|
| `DebbieButtonStyle` (`.primary` mint, `.secondary`, `.quiet`, `.destructive`, `.urgent`) | bordered, borderedProminent, borderless, glass styles | compact 44, regular 48, large 56, prominent 64, resident 96 | One `.primary` or `.urgent` per screen [09 R5]. `.urgent` only on urgent-alert surfaces | Name comes from the visible label. `.quiet` gets a border under `accessibilityShowBorders` [06 R8]. Labels wrap at AX sizes | none on tap [04 R3] |
| `DebbieIconButton` | toolbar/overlay icon buttons | 44×44 hit, 24–28 pt glyph | — | Spoken label = title. Large content viewer only where text is capped | none |
| `DebbieTabBar` (Chrome/, Liquid Glass) | `TabView`'s tab bar | items ≥ 52 tall, full width ÷ 5; floating capsule 20 pt from the edges | default, pressed (0.97), selected (mint-tint highlight, accent glyph and label, filled glyph), badge (red count of unanswered urgent alerts on Home) [16 R2, R3, R5] | Container with the tab-bar trait; items are buttons with `.isSelected` and Voice Control synonyms. Glyphs and labels clamp at xLarge and never hide; the Large Content Viewer shows them beyond. Labels may shrink to 80 % at 320 pt Display Zoom. Increase Contrast adds a border [16 R6] | none: Apple's tab bars play no haptic [16 R10] |
| `DebbieTabScreen` | navigation bar with a large title | title in `hero`; corner buttons on the right | — | Title is a header. At accessibility sizes the header scrolls with the content, and the corner buttons sit above the title | none |
| `DebbieCornerButton` (Chrome/, Liquid Glass) | toolbar icon buttons (Settings) | 44 pt glass circle, glyph in `text.primary` [16 R11] | default, pressed (0.97) | Spoken label ("Settings"); clamps at xLarge with the Large Content Viewer; outlined under Increase Contrast or Show Borders | none |
| `DAnimatedIcon` | SF Symbol effects | the glyph's own size | outline, filled (active), playing | Image trait with the label when it carries meaning, otherwise hidden. Effects per §3.5 | none |
| `DButtonLabel` | `Label` in buttons | the button's | the icon plays once per tap | The spoken name is the visible title; the icon is hidden | the button's |
| `DStatusRow` (`.labelled`, `.state`, `.inline`) | list rows | ≥ 44 | healthy, attention, urgent, unknown, info: always glyph + words | One element, "Label, value, detail". `.inline` stacks when it doesn't fit | none |
| `DebbieAvatar` | — | tab 30, header 44, guide 64, hero 148 | idle (§3.6), still under Reduce Motion | One image element, "Debbie" | none |
| `DebbieGuide` | — | avatar 64 + speech bubble on `bg.surface` | — | The line is a header; at accessibility sizes the bubble moves below the face | none |
| `DChatBubble` | — | max width = screen − 48 pt; `body` text | Debbie: left on `bg.surface`; you: right on `mint.fill` with `text.onMint` | "Debbie: …" / "You: …"; text is selectable | none |
| `DTypingIndicator` | `ProgressView` | 3 × 8 pt dots | pulsing (a `working` effect, M8); static with "Debbie is writing…" under Reduce Motion | "Debbie is writing", updates-frequently trait | none |
| `DSuggestionChip`, `DFlow` | — | ≥ 44 tall outlined capsule in `accent.text`; `DFlow` wraps chips onto new lines (never a sideways scroll, so none hides off screen on SE) | pressed 0.95 | Its text is the question it sends | none |
| `DChatComposer` | `TextField` chrome, send button | field ≥ 48, grows to 4 lines; `border.default` outline (3:1), prompt in `text.secondary`; send 48 circle | empty (no Send), typing (Send), writing (Stop in Send's place) | Field "Message to Debbie"; button "Send" / "Stop"; Return sends | none (the conversation is quiet) |
| `DebbieTopBar`, `DebbieBackButton` | navigation bar, back button | bar ≥ 44 tall; back 44×44 | Title ≤ 15 characters, never "Debbie" [02 R11] | Back is labelled "Back". The bar is a header trait. Swipe-back is kept [X44] | none |
| `DebbieSheetHeader`, `DebbieConfirmSheet` | sheet headers, action sheets | Close 44×44 on the leading edge, then the title (iOS 26 sheets) [16 R12] | Confirm sheet: one sentence, action, Cancel [D-012] | Close is labelled "Close". The action uses a specific verb | none at confirm [04 R2] |
| `DebbieSwitchStyle` (rows), `DebbieToggleCardStyle` (cards) | `.switch` toggle | row ≥ 48; card = resident 96 | pending ("Saving…"); turning live view **off** never waits [09 R7] | `Toggle` semantics kept. State shown by position and words, plus I/O glyphs when On/Off Labels is on | `toggleChanged` (user change only) |
| `DebbieChoiceCard` | segmented control, picker | large 56+ | selected [09 R8] | `.isSelected` trait; group labelled "Role" | `choiceChanged` |
| `DebbieTextField` | `TextField` chrome | ≥ 48 | empty, filled, error with inline message [09 R9] | Persistent label above; error read after the field; focus returns on error | `formInvalid` (on submit only) |
| `DebbieProgressStyle` (`.spinner`, `.bar`) | circular, linear | — | indeterminate, determinate, complete [09 R10] | Always has specific words ("Waiting for the laptop to confirm…") | none |
| `DebbieCodeDisplay` | — | metric type | live, expired | One element, "Pairing code 4 7 1 9"; `speechSpellsOutCharacters` | none |
| `DebbieStepIndicator` | — | — | upcoming, current, done | "Step 2 of 3, Check the code"; not interactive | none |
| `StatusHeader` (three rows + headline) | — | each row ≥ 44 | Connection / Monitoring / Language model, each with glyph, word and age. The headline is the worst row by precedence (removed > can't reach home > monitoring unknown > limited > on) [X54] | First VoiceOver element; each row reads "Monitoring: on, updated 1 minute ago" | none (status never vibrates) [04 R3] |
| `AlertCard` | — | the alert's action is prominent 64 | unacknowledged urgent (the only `urgent.fill` surface), acknowledged (neutral + `urgent.text` glyph), update, late (both times) [10 R9][06 R6] | Order: tier word, title, place and time, detail, actions. Custom action "I'm On It" [09 R1] | `alertUrgentArrived` (rules in §4), `acknowledged` |
| `LiveBar` | — | ≥ 44 tall, opaque | requesting ("Asking home…", never "LIVE"), live, ended (removed without animation) [X16][T15] | First element: "Live view on. Living room camera. 4 minutes 12 seconds left."; `.updatesFrequently` | none (start = `liveViewStarted` on the first frame) |
| `EmptyState`, `ErrorState`, `LoadingState` | — | — | Empty: one sentence + at most one action, always beside the monitoring state. Error: what happened, what to do, one button. Loading: the real layout, redacted [10 R13][05 R8] | Text carries the meaning; illustrations are decorative | `.error` only for user-started actions |
| `DebbieDemoBadge` | — | 44 tall | "Demo — sample data" on every demo screen [DEMO_HOME] | Read first on demo screens | none |
| `PrimingScreen` | — | Continue = large 56 | exactly one button [01 R9] | Purpose sentence, then the button | none |

**Unpair** (brief §5.1.8), **4 s at most in all** (`NetworkHomeService.unpairDeadline`; D-035: with the laptop switched off it had taken half a minute with nothing on screen): (1) send the encrypted `unpair` command with the phone's own key (LAN, without a Bonjour search, or relay), up to 2.5 s; **then** (2) `POST /v1/unpair` (PROPOSED) with the rest. The order matters: revoking first makes the hub refuse the command as "device removed". Meanwhile the button reads "Unpairing…" with the loading style, and a second unpair (even from a reopened Settings) returns at once. (3) Delete every Keychain item, including the shared group, plus alert history, queued acknowledgements and the heart-rate queue; (4) return to pairing. The home **was told** if either step succeeded, or answered that this iPhone was already removed. Only if neither did, the **welcome screen** (Settings is gone by then) leads with "This iPhone is unpaired. Debbie couldn't reach the home laptop, so it may still list this iPhone. On the laptop's setup page, under Phones, press Remove next to this iPhone." on `caution.tint` until Get Started or Try the Demo [10 R13; the wording follows the laptop's page]. Haptic: `unpairIncomplete` only in that case, as the welcome appears.

**QR scanner** (pairing, Add a Laptop): the live camera has no size of its own, so it always gets `minHeight: Size.scannerMin`, an `idealHeight` (its maximum) and a `maxHeight`; without the ideal height it collapsed to 0 pt inside Add a Laptop's scroll view on a device (D-035). If the camera has never been asked for, the scanner asks (not in the demo), showing "Debbie uses the camera to read the code." while iPhone asks; denied or unavailable shows the plain "camera isn't available" panel. A code the screen rejects doesn't stop the camera: it keeps looking, and ignores that same code for 3 s (`ScanGate`).

## 6. Voice and microcopy

- V1. **Two registers, one voice** [01 R5]. *Steady* (alerts, status, errors, live view): calm, factual, verb-first actions, the specific time and place, no exclamation marks. *Warm* (onboarding, pairing success, empty states): friendly and plain, at most one "!" per flow.
- V2. **Capitalisation** [X10]: notification titles, button labels and sheet titles use title case with no ending punctuation. Headings, status lines, body and hidden-preview text use sentence case.
- V3. **Banned in any user-facing string** (`CopyLintTests` scans the string catalog) [10 R12][01 R4]: "!" in steady strings; oops, uh-oh, sorry, please, we; "all clear", "all quiet", "everything's fine", "she's safe", "he's safe"; abnormal, arrhythmia, AFib, tachycardia, bradycardia, cardiac, heart attack, diagnos-, "emergency detected"; "camera feed", "stream", "spy"; internal terms (bridge, relay, LAN gateway, envelope, credential, hub connector). Detections always read "Possible …". Buttons start with a verb, except "Cancel", "Done", "Not Now", "Back" and the acknowledgement "I'm On It" [X35].
- V4. **Alert anatomy** [10 R8–R9]. Push: title = what happened (≤ 30 characters, from Debbie's kind table); subtitle = place · absolute time; body ≤ 110 characters on what is and isn't known. In-app, in this order: tier word, headline, "Living room · 3:12 PM (4 min ago)", "Arrived 3:20 PM, 8 min after it was noticed" when late by ≥ 60 s, detail ≤ 2 sentences, actions.
- V5. **Status deck** (X5, from 10 R13):
  - "Monitoring is on" — last update 1 min ago
  - "Monitoring status unknown" — no update since 3:12 PM
  - "Monitoring is limited" — kitchen laptop not reporting since 3:05 PM
  - "Can't reach home" — home last connected at 3:12 PM; alerts will come through when it reconnects
  - "Can't connect to Debbie" — trying again every 30 seconds
  - "This iPhone was removed from the home" — [Pair Again]
  - "Extra detail is off" — the language model is down
- V6. **Errors**: what happened, then why if known, then what to do, then one button that does it. At most 3 sentences, no error codes [10 R13]. Examples:
  - "This code has expired. Codes work for 10 minutes. On the home laptop, show a new code and scan it." [Scan Again]
  - "Can't find the home laptop. Your iPhone needs to be on the same Wi-Fi as the home laptop." [Try Again]
- V7. **Resident copy** [10 R23]: "72", "beats a minute", "Read at 3:10 PM". "Sent to home at 3:12 PM". "Will send when you're home. Last sent 9:40 AM." "No heart readings yet" (also covers denied access [X51]).
- V8. **Purpose strings**, each one active sentence ending with a period [01 R9]:
  - Camera: "Debbie uses the camera to scan the pairing code on your home laptop."
  - Local network: "Debbie connects to your home laptop on this Wi-Fi network to pair and get updates."
  - Health: "Debbie reads your heart rate from Health to send it to your home hub."
- V9. **Regulatory**: Debbie is "an alerting and check-in aid for families". Onboarding says: "Debbie doesn't replace emergency services or your Apple Watch's Fall Detection and Emergency SOS. Keep those on." Plus the ringer line: "Keep your ringer on, or Debbie's alerts will arrive silently." [10 R27][X41]

### 6.x Debbie's voice (owner direction 16:16; D-031; research note 17)
- V-D1. Debbie speaks in the first person ("I look for the home laptop…") in onboarding and the chat, and nowhere else. Alerts, status and errors keep the app's plain third-person voice.
- V-D2. In the chat she leads with anything urgent and unacknowledged, in one sentence, then gives the calm picture: 2–4 sentences, plain words, no lists, Markdown or emoji. She never diagnoses, and she says "call emergency services" when something sounds like an emergency. *Check:* `DebbieChatModel.instructions`; the offline wording.
- V-D3. She only says what the home's data shows, and says plainly when data is missing or old.
- V-D4. AI is always disclosed: her subtitle says "AI", and the first line of the conversation says who writes the answers and that they can be wrong (HIG Generative AI) [17].

## 7. Accessibility (thresholds)

| What | Threshold | Check |
|---|---|---|
| Text contrast | primary and secondary ≥ 7:1 in all four appearances; tertiary ≥ 4.5:1 (7:1 with IC); coloured text ≥ 4.5:1 (7:1 with IC) [§2.1 C2] | `ColorTokenTests`, `tools/design/tokens.py` |
| Icons, control edges, focus | ≥ 3:1 (4.5:1 with IC) | same |
| Targets | ≥ 44×44 every target; tiers 48/56/64/96 [X21]; gaps ≥ 12 between bezeled controls, ≥ 24 around borderless ones, ≥ 32 to a destructive action | UI test frames; `performAccessibilityAudit(for: .hitRegion)` |
| Dynamic Type | every size through AX5 (`accessibility-extra-extra-extra-large`); no essential text truncated; accessory rows stack at AX sizes [07 R4–R6]; hero clamps at AX3 | gate screenshots at AX5 |
| Width | layouts work at 320 pt (iPhone SE with Display Zoom) [X48] | snapshot at a 320-pt-wide container |
| Motion | Reduce Motion and Prefer Cross-Fade via `MotionPolicy`; no flashing > 3/s [03 R10, R14] | Reduce Motion screenshot and recording |
| Colour | never the only signal: status = glyph shape + word [06 R5]; `accessibilityDifferentiateWithoutColor` adds words to icon-only chips | greyscale screenshot review |
| VoiceOver | every control labelled from visible text; reading order = visual order; the most important fact first; announcements for arrivals and live-view start/end/1-minute-left [10 R6, R18] | `performAccessibilityAudit()` in every UI test; label assertions |
| Other settings | Show Borders (`accessibilityShowBorders`) outlines text-only buttons; Increase Contrast adds 1.5 pt borders; Reduce Transparency makes chrome opaque; Bold Text follows through symbol weights [06 R8][08 F9] | gate screenshot with IC |

## 8. Engineering standards

- E1. **Project**: `project.yml` (XcodeGen 2.46.0, synced folders) generates `Debbie.xcodeproj`, and both are committed [D-007]. Targets: `Debbie` (app), `DebbieNotificationService`, `DebbieTests`, `DebbieUITests`. One local package `Packages/DebbieKit`, swift-tools 6.2, iOS 26.0.
- E2. **Modules and imports** [11a R2][X28]:

  | Module | May import (Debbie modules) |
  |---|---|
  | DebbieCore | none |
  | DebbieCrypto | Core |
  | DebbieSecureStore | Core |
  | DebbieNetworking | Core, Crypto, SecureStore |
  | DebbieDesignSystem | none |
  | DebbieCareScreens (Layer 4) | Core, DesignSystem |
  | DebbieFeatures (pairing, live view, resident, settings) | everything above |

  The extension links only Core, Crypto and SecureStore (`otool -L` check: system libraries only, ≤ 2 MB). WebRTC goes only into the live-view code.
- E3. **Concurrency**: Swift 6 language mode. UI modules and the app use `defaultIsolation(MainActor.self)`. Core, Crypto, SecureStore and Networking stay nonisolated, with `Sendable` value types and actors for shared state (`RouteSelector`, `MessageStore`). No `@unchecked Sendable` without a comment explaining why [11a R3].
- E4. **State**: models are `@Observable` final classes owned with `@State` at the screen root. Services are injected through `@Entry` environment values with inert defaults. No I/O in `init`. No `ObservableObject` (lint R2) [11a R4].
- E5. **Errors**: typed throws per module (`TransportError`, `PairingError`, `KeychainError`, `CryptoError`), mapped to a `ScreenState` with exactly one recovery action. No `try!`, `as!` or `fatalError` outside tests and Debug tools (lint R1) [11a R5].
- E6. **Logging without secrets**: `os.Logger` only, and every interpolation declares `privacy:` (lint P2). Keys, credentials, QR secrets, signalling URLs, SDP and decrypted alert text are never logged [11a R5][11b R7]. `print` is banned (lint P1).
- E7. **Keychain**: generic passwords under service `debbie.pairing`, in the shared access group from Info.plist `DebbieKeychainAccessGroup`, `AfterFirstUnlockThisDeviceOnly`, never synchronizable. Unpair deletes them all [11a R8–R9]. Verified in a team-less Simulator build (PROGRESS 09:59).
- E8. **Routes** [11c][Brief §6]: never preflight. Caregivers use the LAN only when on Wi-Fi and the latest post-path-change probe succeeded; otherwise the relay. Any path change or LAN failure invalidates the LAN verdict. Rediscovery browses `_debbie._tcp` with `bonjourWithTXTRecord`, matches the `hub` prefix, and confirms with an encrypted request. Heart rate is LAN-only, and a relay test proves it is rejected. Sessions: LAN commands use `waitsForConnectivity = true` (TN3179) with a 3 s request timeout and 2 retries; the route probe fails fast (1.5 s); relay calls use a 10 s request timeout and give up at 10 s (CONTRACTS §5). Worst case after a network change: probe 1.5 s → relay ≤ 10 s → next fetch, so the 30 s reconnection target holds. Plain HTTP only to loopback, RFC 1918, link-local or `.local` hosts; the relay must be `https` in Release (`TransportPolicyTests`) [X56].
- E9. **Debug, Release and demo**: Debug-only code is wrapped in `#if DEBUG` with `DeveloperMenu`/`DebbieFixture` names and the canary. The demo home lives in `App/DemoHome/` under `DEBBIE_DEMO_HOME` (one xcconfig line) [DEMO_HOME]. `tools/ci/check-release-clean.sh` runs on Release, and with `--expect-no-demo` on a Release build with the flag off.
- E10. **Dependencies**: only those with a DECISIONS entry. Build-time: XcodeGen (D-007), rsvg-convert (D-011). Runtime: stasel/WebRTC `exact 157.0.0`, live-view module only [X38]. No analytics, tracking, ads or crash reporters.
- E11. **Testing strategy**:
  - **Unit tests** (Swift Testing): crypto, plus contract vectors that write `docs/contracts/vectors.json`, which `node tools/contracts/verify-vectors.mjs` must pass; routes and transport policy; the notification renderer as a pure function; tokens (contrast in all four appearances); `MotionTests` (spring bounds) and `MotionPolicyTests`; `HapticMapTests` (only allowed feedback types); `CopyLintTests`; `MonitoringStateTests` (no unconfirmed all-clear).
  - **UI tests** (XCUITest): one main path per §5.1 flow, against the demo transport (and the Node mock home for networking), each running `performAccessibilityAudit()`. Plus `SimplicityTests` (§1.1 budgets) and a swipe-back test.
  - **Motion and token enforcement**: `tools/ci/lint.sh` (M1–M8, H1, C1, T1, L1, S1, D1–D2, I1–I2, K1, R1–R4, P1–P2) and the recordings in §3.4.
  - **Snapshots**: the dependency-free `SnapshotAssert` from 11b R11, in light, dark and AX5, plus 320 pt.
- E12. **Performance budgets** [11b R17]:

  | Budget | Limit | Status tonight |
  |---|---|---|
  | Cold launch (unpaired, Simulator Release, `XCTApplicationLaunchMetric`) | ≤ 1,000 ms median | gate |
  | Tap → visible response (signposts) | ≤ 100 ms median | gate |
  | Extension render (`XCTClockMetric`) | ≤ 50 ms median | gate |
  | Extension memory growth | ≤ 2,048 kB | gate |
  | Extension size | ≤ 2 MB | gate |
  | App size (Release) | ≤ 60 MB | gate |
  | Hitches (navigation, scrolling) | ≤ 5 ms/s | recorded on the Simulator, gated on a device later |

  `tools/perf/check-budgets.mjs` reads the `.xcresult` and exits non-zero on any gated breach.
- E13. **Code style**: one primary type per file, named after the file. Public API in `DebbieDesignSystem` and `DebbieCareScreens` has `///` docs, because Layer 4 consumes it. No literal visual values outside the design system (lints C1, T1, L1, S1). The release-cleanliness markers in E9.

## 9. Review checklist

Every screen and every change passes every applicable line before it counts as done. Each line is pass/fail and
names how it is checked: **A** = automated (a test or script in the `test` lane), **L** = lint (a grep in
`tools/ci/lint.sh`), **S** = screenshot review (the reviewer opens the images), **D** = on a device.
A screen gate (brief §8 Phase 6) means: screenshots on **Debbie SE** (375×667) and **Debbie Max** (440×956), in light
and dark, at the default size and at AX5, plus one with Reduce Motion on, all opened and reviewed against this list.
VoiceOver labels and reading order are checked, a UI test covers the main path, and there are no warnings.

### A. Job and hierarchy
- [ ] A1 The screen's one job is written in `docs/research/15-flows-and-states.md` and the screen does only that. (S) [P3]
- [ ] A2 At most one `.large`/`.prominent` filled (mint or urgent) button is visible. (S, A: UI test counts) [09 R5][C4]
- [ ] A3 The first VoiceOver element is the screen's most important fact (status headline, alert title, live bar). (A) [01 R2][10 R18]

### B. Colour
- [ ] B1 Only tokens; no literal colours. (L) [C1]
- [ ] B2 `ColorTokenTests` passes; the contrast table in §2.1 matches `tools/design/tokens.py`. (A) [C2]
- [ ] B3 `urgent.fill` appears only on the newest unacknowledged urgent alert. (S) [C6]
- [ ] B4 No status is told apart by colour alone: glyph shape plus words are present. Check in a greyscale screenshot. (S) [C7]
- [ ] B5 Light, dark and Increase Contrast screenshots all show the intended token variants and borders. (S) [C8–C9]

### C. Type and layout
- [ ] C1 Only type roles; no `.system(size:)`, `.caption`, `.caption2` or light weights. (L) [T1]
- [ ] C2 At AX5, no essential text is truncated, clipped or overlapping, and accessory rows have stacked. (S) [T2–T3]
- [ ] C3 Only spacing and radius tokens; no numeric literals in padding, spacing, frames or corner radii. (L) [L2][S1]
- [ ] C4 Every interactive element is ≥ 44×44 pt, and each tier meets its minimum height. (A: UI test frames + `performAccessibilityAudit(for: .hitRegion)`) [§2.3]

### D. Motion
- [ ] D1 No anonymous animations. (L) [M2]
- [ ] D2 Every animated change has a Reduce Motion screenshot showing the substitute (fade or static). (S) [M9][§3.3]
- [ ] D3 No hit-testing disabled for animation; no `asyncAfter` or `Task.sleep` chains. (L) [M4]
- [ ] D4 Nothing repeats except `live` and `working`; nothing flashes more than 3 times per second. (S) [M8]

### E. Haptics
- [ ] E1 Haptics only through `.debbieHaptic`, and only events from the §4.1 map. (L, A) [H1]
- [ ] E2 Each haptic event also changes visible text, and gets an announcement when no tap caused it. (A: UI tests pass with haptics off) [H4]

### F. States (brief §5.2)
- [ ] F1 Every state in note 15's matrix for this screen exists and has a screenshot: loading (real layout, redacted), empty, can't reach home, error with exactly one recovery action. (S) [10 R13][05 R8]
- [ ] F2 No all-clear without a confirmed, fresh heartbeat; every status shows its age. (A: `MonitoringStateTests`) [P2][10 R14]

### G. Copy
- [ ] G1 `CopyLintTests` passes: banned words, no "!", verb-first buttons, capitalisation rules. (A) [§6]
- [ ] G2 Every error says what happened, what to do, and offers one button that does it. (S) [§6]

### H. Accessibility
- [ ] H1 `try app.performAccessibilityAudit()` passes in the screen's UI test. (A) [§7]
- [ ] H2 VoiceOver labels, values and order were read through in the Simulator's accessibility snapshot and match the visual order. (A/S) [§7]
- [ ] H3 Show Borders on: text-only buttons are outlined. (S) [C9]

### I. Privacy and trust
- [ ] I1 No secrets, keys, credentials or decrypted alert text are logged (`os.Logger` privacy rules). (L) [§8]
- [ ] I2 Live view: the live bar shows from "ready" until stop, is never covered, and disappears without animation at the end. (S, A) [T15][10 R18]

### J. Engineering
- [ ] J1 Zero warnings: `tools/ci/check-warnings.sh` on the build log. (A)
- [ ] J2 Unit and UI tests green. (A)
- [ ] J3 The Release `.app` passes `tools/ci/check-release-clean.sh`. (A)
- [ ] J4 The module import allowlist holds. (L) [§8]
- [ ] J5 Contract vectors pass in Swift and in Node (`tools/contracts/verify-vectors.mjs`). (A)

### L. Brief additions (binding brief)
- [ ] L1 Simplicity budget for the screen (§1.1) holds: `SimplicityTests`. (A)
- [ ] L2 No system-default control or glyph: lint K1, I1, I2. (L)
- [ ] L3 Custom top bar, back button and sheet header; swipe-back works (UI test). (A) [X44]
- [ ] L4 Demo home: screen reachable from the demo, labelled, no network (DEMO_HOME). (A/S)
- [ ] L5 A screen recording of each transition, frames inspected, one interrupted mid-flight (§3.4). (S)

### K. Evidence
- [ ] K1 The screenshots exist under `docs/screenshots/<screen>/` and were opened by the reviewer, whose verdict is recorded in `PROGRESS.md`. (S)
- [ ] K2 For haptics, a device feel-check is recorded, or marked "not run" when there is no device. (D)

## 10. Sources and changelog

### 10.1 How to read citations
- `[NN Rk]` = recommendation Rk of research note `docs/research/NN-*.md`. Each note lists its own dated sources (primary first), and its review log records the independent review.
- `[X<n>]` = a lead decision in `docs/research/lead-decisions.md`, which settles a conflict between notes or with the brief.
- `[D-NNN]` = `docs/DECISIONS.md`. `[L1 …]` = the Layer 1 design doc (layer-1@fa56475). `[Brief §n]` = `KICKOFF_PROMPT.md`.
- `[HIG <page>]` = a Human Interface Guidelines page the lead read directly on 2026-11-14 with `tools/research/appledoc.py`.

### 10.2 Research notes (all researched and reviewed 2026-11-14)
| Note | Topic (brief §9) |
|---|---|
| 01-featured-apps-craft | 1. What award-winning and featured apps share |
| 02-ios-design-language | 2. iOS 26/27 design language, Liquid Glass, version support |
| 03-motion-springs | 3. Springs and motion |
| 04-haptics | 4. Haptics |
| 05-transitions | 5. Transitions and frame budgets |
| 06-colour | 6. Colour, contrast, colour-blind safety |
| 07-typography-layout | 7. Typography, layout, touch targets |
| 08-icons-logos-app-icons | 8. Icons, logos, app icons, vector pipeline |
| 09-buttons-controls | 9. Custom buttons and controls |
| 10-caregivers-older-adults-alerting | 10. Caregivers, older adults, alerting, trust |
| 11a-engineering-architecture | 11. Architecture, Keychain, NSE, HealthKit, local network, QR |
| 11b-engineering-webrtc-testing-perf | 11. WebRTC/KVS, CLI testing, performance budgets, mock home |
| 11c-routes-network-changes | 11. Route choice at run time and network changes (lead; filled a gap between 11a and 11b) |
| 12-delivery-fastlane | 12. fastlane, signing, TestFlight, export compliance |
| 13-platform-extras | 13. Widgets, Live Activities, App Intents, notification actions |
| 14-settings | Lead: what belongs in Settings |
| 15-flows-and-states | Lead: screen inventory and state matrix |
| research-review | Record of the Phase 1 independent review |
| lead-decisions | Cross-note decisions X1–X41 |

### 10.3 Primary sources the lead read directly (accessed 2026-11-14)
- HIG Design principles (8 Jun 2026): https://developer.apple.com/design/human-interface-guidelines/design-principles
- HIG Branding (9 Sep 2026): https://developer.apple.com/design/human-interface-guidelines/branding
- HIG Color: https://developer.apple.com/design/human-interface-guidelines/color
- HIG Launching: https://developer.apple.com/design/human-interface-guidelines/launching
- HIG Notifications: https://developer.apple.com/design/human-interface-guidelines/notifications
- HIG Settings (10 Jun 2024): https://developer.apple.com/design/human-interface-guidelines/settings
- HIG Images: https://developer.apple.com/design/human-interface-guidelines/images
- HIG Playing haptics: https://developer.apple.com/design/human-interface-guidelines/playing-haptics
- SensoryFeedback.start ("Only plays feedback on watchOS"): https://developer.apple.com/documentation/swiftui/sensoryfeedback/start
- Local SDK interfaces, Xcode 26.6 / iOS 26.5: SwiftUICore (`accessibilityShowBorders`, `_accessibilityReduceMotion`), XCUIAutomation (`performAccessibilityAudit`), XCTest (`XCTHitchMetric`, `navigationTransitionMetric`), UIKit (`openNotificationSettingsURLString`).

### 10.4 Changelog
| Date | Change | Why |
|---|---|---|
| 2026-11-14 11:0x | v1: first edition, written from the Phase 1 research and lead decisions X1–X59 | Phase 2 |
| 2026-11-14 11:1x | Self-review pass (§10.5) | Subagents unavailable (API limit), so the brief's self-review alternative applies |
| 2026-11-14 11:55 | §5: `debbiePinnedAction` (a screen's primary action pinned above the home indicator while content scrolls) and `DReading` (a large reading that scales with Dynamic Type). §7: at accessibility sizes `DebbieTopBar` gives the title its own row, `DebbieLiveBar` stacks, and fixed-height steps scroll, centred when they fit (D-019) | AX5 screenshots on the iPhone SE showed mid-word title breaks and truncated text |
| 2026-11-14 11:52 | §2.8 B1 applied on screen: the welcome mark is an ink glyph on a mint tile; the demo badge is the single word "Demo" (D-018) | The mark had been deep green on near-white, which isn't an approved pairing |
| 2026-11-14 11:57 | §4: the scan events (`scanRecognized`, `scanInvalid`) are wired in both QR flows; the demo home's Demo Controls sheet plays all 18 events with when each fires | Brief §6: the demo fires every named haptic event |
| 2026-11-15 00:45 | §5 Unpair: the hub first (2.5 s, no Bonjour search), then the relay; told if either, or "already removed"; the guard in the model; the laptop's own wording. §5 QR scanner: keeps looking after a rejected code (`ScanGate`), a neutral line while iPhone asks | The fix's independent review (`wf_095bdbb1-ce4`), including a build-7 regression: a false "couldn't reach" notice after a successful unpair (D-035) |
| 2026-11-15 00:20 | §5 Unpair: the two calls together for at most 4 s, "Unpairing…", the failure notice on the welcome; the QR scanner's sizing and permission rule | Owner 23:5x, testing on a device with a real laptop (D-035) |
| 2026-11-14 23:35 | §3.7 retimed again: the first beat already on the strip, the mark from 1.11 s, interactive at about 2.5 s | Owner 23:30: "still a couple seconds too long" |
| 2026-11-14 23:15 | §3.7: the strike starts with speed, the pulse is gone, the words are laid out full width from the first frame; N1 skip and N2 shape rules | The intro's independent review (`wf_afa9cf07-bfd`): re-wrapping words, a hesitating strike, a shape change under Reduce Motion, a one-frame skip |
| 2026-11-14 23:00 | §3.7 retimed (80 a minute, the monitor already running, the mark from 1.9 s, interactive at 3.0 s); `settleIn` rides the `present` spring | Owner 22:55: the beats took too long and the words came in abruptly |
| 2026-11-14 22:20 | `motion.alertCard` (T7 in, T8 out); the acknowledged haptic from one place; Sync Now keeps its icon | The kit's motion review measured build 3 against §3 (D-034) |
| 2026-11-14 22:10 | §3.7 the launch intro; T19; `settleIn`, `Motion.Intro`; B5 note; §3.4 row | Owner direction 20:55: a heart-monitor line that becomes the logo, then the first screen (D-033) |
| 2026-11-14 18:05 | §3.6 eyes: plain dark rounds, single blinks ≥ 2 s apart. C8: light only. P3 table: S15 without the live-view switch. §5: `DFlow`, the growing composer. `MotionPolicy.scroll` (no scroll animation under Reduce Motion) | Owner fixes 17:24 and 17:40, and the afternoon review (D-032) |
| 2026-11-14 16:30 | §3.1 `tabSlide`, `iconStep`; §3.3 T16–T18; §3.5 icon animations; §3.6 Debbie's idle; M8 adds idle; §5 tab bar, tab screen, corner button, animated icon, button label, status-row styles, avatar, guide, chat bubble, typing indicator, chip, composer; §6.x Debbie's voice | Owner directions 15:44 and 16:16 (D-029–D-031); research notes 16–17 |
| 2026-11-14 11:34 | §8 lint: L1 no longer flags token names that contain digits or zero spacing; M2 ignores `TimelineView(.animation…)` schedules; M7 exempts the model and the Local Network prompt helper (not views). A planted probe still fails M2, M3, M4, M7 and L1 | False positives found on the first full-app lint |
