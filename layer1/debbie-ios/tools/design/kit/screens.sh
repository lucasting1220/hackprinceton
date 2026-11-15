#!/usr/bin/env bash
# Designer kit, part "screens, copy and the demo script": DesignerKit/11-screens and DesignerKit/12-copy-and-demo.
#
#   tools/design/kit/screens.sh          (run from the repo root; safe to re-run)
#
# 1. Copies the CURRENT build-3 screenshots into DesignerKit/11-screens under descriptive names:
#      Design/reviews/screens/raw/SE-light-default     → iphone-se/
#      Design/reviews/screens/raw/Max-dark-default     → iphone-17-pro-max/        (the app renders light; D-032)
#      Design/reviews/screens/raw/SE-light-AX5         → accessibility/largest-text-se/
#      Design/reviews/screens/raw/SE-light-default-IC  → accessibility/increase-contrast-se/
#      Design/reviews/screens/onboarding-back          → onboarding-back/          (renumbered in forward order)
#    Never the 12:xx sets from before the redesign: SE-dark-default, SE-dark-default-IC, SE-light-default-RM,
#    Max-light-default, Max-dark-AX5.
# 2. Draws one labelled 2x contact sheet per set into DesignerKit/11-screens/contact-sheets/ (screens-sheet.swift).
# 3. Regenerates Debbie's sample answers inside DesignerKit/12-copy-and-demo/voice-and-copy.md, between its
#    "generated: debbie-answers" markers, by running the app's own on-device wording (screens-answers.swift).
# screens.md, voice-and-copy.md (outside the markers) and demo-script.md are written by hand.
set -euo pipefail
cd "$(dirname "$0")/../../.."

kit=DesignerKit/11-screens
raw=Design/reviews/screens/raw
sheets="$kit/contact-sheets"

# Screen tour number (UITests/ScreenTourUITests.swift) | file name in the kit | label on the contact sheet
tour_map() { cat <<'MAP'
01-welcome|01-welcome|Welcome
02-role|02-setup-role-family-member|Set Up: who uses this iPhone
03-name|03-setup-name-this-iphone|Set Up: name this iPhone
04-code|04-setup-check-the-code|Set Up: check the code
05-paired|05-setup-paired|Set Up: paired
06-notifications|06-setup-notifications-priming|Set Up: alerts priming
07-home-alert|07-home-urgent-alert|Home: urgent alert
08-alert-detail|08-alert-detail|Alert detail
09-devices|09-devices|Devices tab
10-add-laptop|10-add-a-laptop|Add a Laptop sheet
11-history|11-history|History tab
12-debbie|12-debbie-chat|Debbie tab
13-live-tab|13-live-tab|Live tab
14-live-requesting|14-live-view-connecting|Live view: connecting
15-live-playing|15-live-view-playing|Live view: playing
16-live-ended|16-live-view-ended|Live view: ended
17-live-again|17-live-view-playing-again|Live view: Keep Watching
18-home-acknowledged|18-home-after-im-on-it|Home: after I'm On It
19-settings|19-settings|Settings sheet
20-demo-controls|20-demo-controls|Demo Controls sheet
21-role-resident|21-setup-role-person-at-home|Set Up: the person at home
22-health|22-setup-health-priming|Set Up: heart-rate priming
23-resident|23-person-at-home|The person at home
24-resident-synced|24-person-at-home-after-sync-now|After Sync Now
MAP
}

# OnboardingBackUITests captured these stepping BACK from Scan the Code; the kit numbers them in forward order.
back_map() { cat <<'MAP'
5-back-to-welcome|01-welcome|Welcome
4-back-to-role|02-setup-role|Set Up: who uses this iPhone
3-back-to-local-network|03-setup-local-network-priming|Set Up: find the home laptop
2-back-to-camera-priming|04-setup-camera-priming|Set Up: camera priming
1-scan-step|05-setup-scan-the-code|Set Up: scan the code
MAP
}

captured() { stat -f '%Sm' -t '%d %b %Y %H:%M' "$1"; }

# copy_set <source dir> <kit dir> <map function> <sheet name> <columns> <corner> <title> <subtitle>
copy_set() {
  local src="$1" dst="$2" map="$3" sheet="$4" columns="$5" corner="$6" title="$7" subtitle="$8"
  local from to label n=0 items=()
  rm -rf "$dst"
  mkdir -p "$dst"
  while IFS='|' read -r from to label; do
    [[ -f "$src/$from.png" ]] || { echo "✗ missing $src/$from.png" >&2; exit 1; }
    cp "$src/$from.png" "$dst/$to.png"
    cmp -s "$src/$from.png" "$dst/$to.png" || { echo "✗ copy differs: $dst/$to.png" >&2; exit 1; }
    items+=("$dst/$to.png|$label")
    n=$((n + 1))
  done < <("$map")
  swift tools/design/kit/screens-sheet.swift --out "$sheets/$sheet.png" --columns "$columns" --height 260 \
    --corner "$corner" --title "$title" --subtitle "$subtitle" "${items[@]}" >/dev/null
  echo "• $dst: $n screens; contact sheet $sheets/$sheet.png"
}

rm -rf "$sheets"
mkdir -p "$sheets" "$kit/accessibility"

copy_set "$raw/SE-light-default" "$kit/iphone-se" tour_map iphone-se 8 0 \
  "Debbie build 3 · iPhone SE (3rd generation) · light · default text size" \
  "Demo home on the iOS 26.5 Simulator, captured $(captured "$raw/SE-light-default/01-welcome.png") by the screen tour UI test. Each screen is 375 × 667 pt (750 × 1334 px at @2x); this sheet is drawn at 2x. Files: 11-screens/iphone-se/. What each screen is for: 11-screens/screens.md."

copy_set "$raw/Max-dark-default" "$kit/iphone-17-pro-max" tour_map iphone-17-pro-max 8 0.125 \
  "Debbie build 3 · iPhone 17 Pro Max · light (the phone was in Dark Mode; the app stays light) · default text size" \
  "Demo home on the iOS 26.5 Simulator, captured $(captured "$raw/Max-dark-default/01-welcome.png"), before one late fix: on 12 the urgent row now puts the time on its own line, as in the iPhone SE set. Each screen is 440 × 956 pt (1320 × 2868 px at @3x); this sheet is drawn at 2x. Files: 11-screens/iphone-17-pro-max/."

copy_set "$raw/SE-light-AX5" "$kit/accessibility/largest-text-se" tour_map largest-text-se 8 0 \
  "Debbie build 3 · iPhone SE (3rd generation) · largest text size (AX5)" \
  "Demo home on the iOS 26.5 Simulator, captured $(captured "$raw/SE-light-AX5/01-welcome.png"). Each shot is the top of a screen that scrolls at this size; text wraps instead of truncating. Each screen is 375 × 667 pt (750 × 1334 px at @2x); this sheet is drawn at 2x. Files: 11-screens/accessibility/largest-text-se/."

copy_set "$raw/SE-light-default-IC" "$kit/accessibility/increase-contrast-se" tour_map increase-contrast-se 8 0 \
  "Debbie build 3 · iPhone SE (3rd generation) · Increase Contrast on · default text size" \
  "Demo home on the iOS 26.5 Simulator, captured $(captured "$raw/SE-light-default-IC/01-welcome.png"). Cards, buttons, chips and the tab bar gain 1.5 pt outlines, and the colours switch to their Increase Contrast values. Each screen is 375 × 667 pt (750 × 1334 px at @2x); this sheet is drawn at 2x. Files: 11-screens/accessibility/increase-contrast-se/."

copy_set "Design/reviews/screens/onboarding-back" "$kit/onboarding-back" back_map onboarding-back 5 0 \
  "Debbie build 3 · the real pairing path (not the demo) · iPhone SE (3rd generation)" \
  "Captured $(captured "Design/reviews/screens/onboarding-back/1-scan-step.png") by OnboardingBackUITests, stepping back from Scan the Code with Back; numbered here in forward order. A Debug build on the Simulator: there is no camera, and the paste field on 05 never ships. 05 predates a late fix: in build 3 its Set Up bar sits as high as on the other steps. Files: 11-screens/onboarding-back/."

# Debbie's sample answers: the app's own OfflineAssistant and HomeFacts, pasted into screens-answers.swift at its marker.
chat=Packages/DebbieKit/Sources/DebbieFeatures/DebbieChat.swift
tpl=tools/design/kit/screens-answers.swift
doc=DesignerKit/12-copy-and-demo/voice-and-copy.md
[[ -f "$doc" ]] || { echo "✗ $doc is missing (it holds the generated-answers markers)" >&2; exit 1; }
wording="$(awk '/^public struct OfflineAssistant/{on=1} /^\/\/ MARK: Screen/{on=0} on' "$chat")"
[[ -n "$wording" ]] || { echo "✗ couldn't find OfflineAssistant in $chat" >&2; exit 1; }
# The answers assume these demo facts; say so if one has changed.
for fact in 'elapsed > 6' 'elapsed > 4' '(60..<90)' 'heartRateBPM: 72' 'trend: .steady' '"Kitchen laptop"' '"Living room laptop"' \
            'heard no answer.' 'no movement in the kitchen for 2 hours.' 'addingTimeInterval(-300)' 'addingTimeInterval(-14 * 60)'; do
  grep -qF -- "$fact" App/DemoHome/DemoHomeService.swift || echo "warning: DemoHomeService.swift no longer has '$fact'; check screens-answers.swift" >&2
done
grep -qF 'startRefreshing(every seconds: TimeInterval = 10)' Packages/DebbieKit/Sources/DebbieFeatures/AppModel.swift \
  || echo "warning: Home no longer updates every 10 s; check screens-answers.swift and demo-script.md" >&2
answers="$( { sed '/^\/\/ @@OFFLINE_ASSISTANT@@$/,$d' "$tpl"; printf '%s\n' "$wording"; sed '1,/^\/\/ @@OFFLINE_ASSISTANT@@$/d' "$tpl"; } | swift - )"
ANSWERS="$answers" python3 -I - "$doc" <<'PY'
import os, sys
doc = sys.argv[1]
begin = "<!-- BEGIN generated: debbie-answers (tools/design/kit/screens.sh) -->"
end = "<!-- END generated: debbie-answers -->"
text = open(doc, encoding="utf-8").read()
i, j = text.find(begin), text.find(end)
if i < 0 or j < i:
    sys.exit(f"✗ {doc}: the generated-answers markers are missing")
new = text[: i + len(begin)] + "\n" + os.environ["ANSWERS"].strip("\n") + "\n" + text[j:]
if new != text:
    open(doc, "w", encoding="utf-8").write(new)
print(f"• {doc}: Debbie's sample answers {'updated' if new != text else 'unchanged'}")
PY
