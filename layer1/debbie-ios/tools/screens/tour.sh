#!/usr/bin/env bash
# Screen-gate tour (brief §8; CRAFT.md §9): runs UITests/ScreenTourUITests across the gate matrix
# (SE + Max × light/dark × default/AX5, plus Reduce Motion and Increase Contrast), exports every
# screenshot attachment, and tiles one contact sheet per configuration into Design/reviews/screens/.
#   tools/screens/tour.sh [--quick|--preview|--access]   (--quick: SE light default; --preview: SE light + Max dark;
#   --access: SE at AX5, and SE with Increase Contrast)
set -uo pipefail
cd "$(dirname "$0")/../.."
out="Design/reviews/screens"; mkdir -p "$out/raw" build/results
configs=(
  "small light large off off" "small dark large off off"
  "small light accessibility-extra-extra-extra-large off off"
  "large light large off off" "large dark large off off"
  "large dark accessibility-extra-extra-extra-large off off"
  "small light large on off" "small dark large off on"
)
[[ "${1:-}" == "--quick" ]] && configs=("small light large off off")
# --preview: the smallest phone in light and the largest in dark, for a first look at a redesign.
[[ "${1:-}" == "--preview" ]] && configs=("small light large off off" "large dark large off off")
# --access: the smallest phone at the largest text size, and with Increase Contrast (the app is light only, D-032).
[[ "${1:-}" == "--access" ]] && configs=("small light accessibility-extra-extra-extra-large off off" "small light large off on")
fail=0
for c in "${configs[@]}"; do
  read -r dev appearance size reduce contrast <<<"$c"
  udid="$(tools/sim/sim.sh udid "$dev")"
  tools/sim/sim.sh prep "$dev" --appearance "$appearance" --size "$size" --contrast "$([[ $contrast == on ]] && echo enabled || echo disabled)" >/dev/null
  xcrun simctl spawn "$udid" defaults write com.apple.Accessibility ReduceMotionEnabled -bool "$([[ $reduce == on ]] && echo true || echo false)"
  [[ "$(xcrun simctl ui "$udid" appearance)" == "$appearance" ]] || { echo "✗ appearance not applied"; fail=1; }
  [[ "$(xcrun simctl ui "$udid" content_size)" == "$size" ]] || { echo "✗ content size not applied"; fail=1; }
  tag="$([[ $dev == small ]] && echo SE || echo Max)-$appearance-$([[ $size == large ]] && echo default || echo AX5)$([[ $reduce == on ]] && echo -RM)$([[ $contrast == on ]] && echo -IC)"
  rb="build/results/tour-$tag.xcresult"; rm -rf "$rb" "$out/raw/$tag"
  TEST_RUNNER_DEBBIE_GATE_CONFIG="$tag" TEST_RUNNER_DEBBIE_REDUCE_MOTION="$reduce" \
  tools/ci/xcb.sh "tour-$tag" 1200 test -project Debbie.xcodeproj -scheme Debbie \
    -destination "platform=iOS Simulator,id=$udid" -derivedDataPath build/DD \
    -resultBundlePath "$rb" -only-testing:DebbieUITests/ScreenTourUITests -parallel-testing-enabled NO >/dev/null \
    || { echo "✗ tour had failures: $tag (logs/tour-$tag.log)"; fail=1; }
  grep -qE "Executed [1-9][0-9]* tests?" "logs/tour-$tag.log" || { echo "✗ $tag: no tests ran"; fail=1; }
  xcrun xcresulttool export attachments --path "$rb" --output-path "$out/raw/$tag" >/dev/null 2>&1 || true
  # Name each exported file from the manifest's attachment name.
  python3 -I - "$out/raw/$tag" <<'PY'
import json, os, sys
d = sys.argv[1]
try: tests = json.load(open(os.path.join(d, "manifest.json")))
except Exception: sys.exit(0)
for t in tests:
    for a in t.get("attachments", []):
        src = os.path.join(d, a["exportedFileName"]); name = a.get("suggestedHumanReadableName", "")
        if os.path.exists(src) and "__" in name:
            os.replace(src, os.path.join(d, name.split("__", 1)[1].split("_0_")[0].replace(".png", "") + ".png"))
PY
  # Keep only the named screenshots; failure videos and UI snapshots stay in the .xcresult bundle.
  find "$out/raw/$tag" -type f ! -name '[0-9][0-9]-*.png' -delete 2>/dev/null
  inputs=(); for png in "$out/raw/$tag"/[0-9][0-9]-*.png; do [[ -f "$png" ]] && inputs+=("$png=$(basename "$png" .png)"); done
  if [[ ${#inputs[@]} -gt 0 ]]; then
    swift tools/design/contact-sheet.swift --out "$out/$tag.png" --columns 6 --cell 300 --background "#8E8E93" --title "Debbie screens: $tag" "${inputs[@]}" >/dev/null
    echo "• $tag: ${#inputs[@]} screens → $out/$tag.png"
  else echo "✗ $tag: no screenshots"; fail=1; fi
done
for d in small large; do tools/sim/sim.sh reset-ui "$d" >/dev/null; xcrun simctl spawn "$(tools/sim/sim.sh udid $d)" defaults write com.apple.Accessibility ReduceMotionEnabled -bool false; done
exit $fail
