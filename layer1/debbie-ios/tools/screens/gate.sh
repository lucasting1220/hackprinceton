#!/usr/bin/env bash
# Screen gate runner (brief §8 Phase 6; CRAFT.md §9). For one UI test that screenshots a screen,
# run the matrix: Debbie SE + Debbie Max × light/dark × default text size and AX5, plus Reduce
# Motion (SE, light, default) and Increase Contrast (SE, dark, default). Export the screenshot
# attachments and tile them into Design/reviews/screens/<screen>/sheet.png for the reviewer.
#
#   tools/screens/gate.sh <screen-id> <UITests target/Class/testMethod> [--quick]
#   e.g. tools/screens/gate.sh S09 DebbieUITests/HomeScreenTests/testHomeGate
# --quick runs only SE light default + Max dark AX5 (for iteration; never for the gate itself).
#
# The UI test names its attachments from $DEBBIE_GATE_CONFIG (passed as TEST_RUNNER_DEBBIE_GATE_CONFIG).
set -uo pipefail
cd "$(dirname "$0")/../.."
screen="${1:?screen id, e.g. S09}"; test_id="${2:?UI test identifier}"; quick="${3:-}"
out="Design/reviews/screens/$screen"; mkdir -p "$out/raw" build/results
configs=(
  "small light large off off"
  "small dark large off off"
  "small light accessibility-extra-extra-extra-large off off"
  "small dark accessibility-extra-extra-extra-large off off"
  "large light large off off"
  "large dark large off off"
  "large light accessibility-extra-extra-extra-large off off"
  "large dark accessibility-extra-extra-extra-large off off"
  "small light large on off"
  "small dark large off on"
)
[[ "$quick" == "--quick" ]] && configs=("small light large off off" "large dark accessibility-extra-extra-extra-large off off")
fail=0
for c in "${configs[@]}"; do
  read -r dev appearance size reduce contrast <<<"$c"
  udid="$(tools/sim/sim.sh udid "$dev")"
  tools/sim/sim.sh prep "$dev" --appearance "$appearance" --size "$size" --contrast "$([[ $contrast == on ]] && echo enabled || echo disabled)" >/dev/null
  xcrun simctl spawn "$udid" defaults write com.apple.Accessibility ReduceMotionEnabled -bool "$([[ $reduce == on ]] && echo true || echo false)"
  # Read back every setting; a mismatch fails the gate (research note 11b R8).
  [[ "$(xcrun simctl ui "$udid" appearance)" == "$appearance" ]] || { echo "✗ appearance not applied"; fail=1; }
  [[ "$(xcrun simctl ui "$udid" content_size)" == "$size" ]] || { echo "✗ content size not applied"; fail=1; }
  tag="$dev-$appearance-$([[ $size == large ]] && echo default || echo ax5)$([[ $reduce == on ]] && echo -rm)$([[ $contrast == on ]] && echo -ic)"
  rb="build/results/$screen-$tag.xcresult"; rm -rf "$rb"
  TEST_RUNNER_DEBBIE_GATE_CONFIG="$screen-$tag" TEST_RUNNER_DEBBIE_REDUCE_MOTION="$reduce" \
  tools/ci/xcb.sh "gate-$screen-$tag" 900 test -project Debbie.xcodeproj -scheme Debbie \
    -destination "platform=iOS Simulator,id=$udid" -derivedDataPath build/DerivedData \
    -resultBundlePath "$rb" -only-testing:"$test_id" -parallel-testing-enabled NO >/dev/null || { echo "✗ test failed: $tag (logs/gate-$screen-$tag.log)"; fail=1; }
  xcrun xcresulttool export attachments --path "$rb" --output-path "$out/raw/$tag" >/dev/null 2>&1 || true
  echo "• $tag"
done
tools/sim/sim.sh reset-ui small >/dev/null; tools/sim/sim.sh reset-ui large >/dev/null
for d in small large; do xcrun simctl spawn "$(tools/sim/sim.sh udid $d)" defaults write com.apple.Accessibility ReduceMotionEnabled -bool false; done
inputs=()
while IFS= read -r -d '' png; do
  label="$(basename "$(dirname "$png")")"
  inputs+=("$png=$label")
done < <(find "$out/raw" -name '*.png' -print0 | sort -z)
if [[ ${#inputs[@]} -gt 0 ]]; then
  swift tools/design/contact-sheet.swift --out "$out/sheet.png" --columns 4 --cell 300 --background "#8E8E93" \
    --title "$screen screen gate: SE / Max × light / dark × default / AX5, + Reduce Motion, + Increase Contrast" "${inputs[@]}" >/dev/null
  echo "sheet: $out/sheet.png (${#inputs[@]} screenshots) — open it and review against CRAFT.md §9"
else
  echo "✗ no screenshots exported"; fail=1
fi
exit $fail
