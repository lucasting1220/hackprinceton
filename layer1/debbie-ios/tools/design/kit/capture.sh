#!/usr/bin/env bash
# Designer kit, part "capture": component renders and screen recordings from the Simulator, and the Release check.
#
#   tools/design/kit/capture.sh [all]                everything below, in this order (run from the repo root)
#   tools/design/kit/capture.sh renders              DesignerKit/08-components/renders/<section>.png, then
#                                                    renders/increase-contrast/<section>.png (UITests/GalleryUITests), then
#                                                    the retake below
#   tools/design/kit/capture.sh retake               retakes any render that shows the gallery's scroll indicator (the
#                                                    screenshot test shoots right after scrolling, before it fades) with
#                                                    RecordingUITests/testGallerySectionsWithoutScrollIndicator
#   tools/design/kit/capture.sh recordings [name…]   DesignerKit/09-motion/recordings/<name>.mp4, <name>-1fps.png and
#                                                    recordings.md. Names: app-tour icon-animations debbie-idle-app resident
#   tools/design/kit/capture.sh retrim [name…]       trims, encodes and sheets the last raw recordings again (no Simulator)
#   python3 -I tools/design/kit/capture.py doc DesignerKit/09-motion/recordings build/designer-kit/capture
#                                                    rewrites recordings.md only (after editing the step wording)
#   tools/design/kit/capture.sh release              Release Simulator build, then tools/ci/check-release-clean.sh on it
#   tools/design/kit/capture.sh reset                "Debbie Max" back to light, default text size, Increase Contrast off
#
# Uses only the Simulator named "Debbie Max" (iPhone 17 Pro Max, tools/sim/sim.sh "large"), with Reduce Motion off.
# Debug runs share build/DD-gallery; the Release build goes to build/DD-rel. Result bundles go to build/results, raw
# recordings and working files to build/designer-kit/capture, xcodebuild logs to logs/ (all gitignored).
# Helpers: capture.py (attachment names, scroll-indicator check, trimming, recordings.md; the words for each recorded
# step are in its RECORDINGS table) and capture-sheet.swift
# (contact sheets). The recordings keep the Simulator's colour tags (BT.709 primaries and matrix, sRGB transfer).
# Every ffmpeg read of a raw recording uses -fflags +igndts: the Simulator's H.264 has B-frames, and without it ffmpeg
# soon distrusts the presentation times and falls back to decode times that run about 5.6 s early.
# Needs Xcode 26 (xcodebuild, xcresulttool, swift), ffmpeg with libx264 and ffprobe (Homebrew), python3.
set -euo pipefail
cd "$(dirname "$0")/../../.."
[[ -f Debbie.xcodeproj/project.pbxproj && -f UITests/GalleryUITests.swift ]] || { echo "capture: run inside the Debbie repo" >&2; exit 1; }

KIT=DesignerKit
RENDERS=$KIT/08-components/renders
RECS=$KIT/09-motion/recordings
WORK=build/designer-kit/capture
DD=build/DD-gallery
HELPER=tools/design/kit/capture.py
STAMP="$(date +%Y%m%d-%H%M%S)"
UDID="$(tools/sim/sim.sh udid large)"
DEST="platform=iOS Simulator,id=$UDID"
mkdir -p "$WORK" build/results

say() { printf '%s\n' "$*"; }

# Debbie Max in light appearance, default text size, Reduce Motion off and Increase Contrast as asked.
prep() {
  tools/sim/sim.sh prep large --appearance light --size large --contrast "$1" >/dev/null
  xcrun simctl spawn "$UDID" defaults write com.apple.Accessibility ReduceMotionEnabled -bool false
  [[ "$(xcrun simctl ui "$UDID" appearance)" == light && "$(xcrun simctl ui "$UDID" content_size)" == large \
     && "$(xcrun simctl ui "$UDID" increase_contrast)" == "$1" ]] || { say "✗ Debbie Max did not take the settings"; return 1; }
}

xcb_test() { # <log> <seconds> <action> <xcresult> <test id>
  tools/ci/xcb.sh "$1" "$2" -project Debbie.xcodeproj -scheme Debbie -destination "$DEST" -derivedDataPath "$DD" \
    -parallel-testing-enabled NO -resultBundlePath "$4" -only-testing:"DebbieUITests/$5" "$3"
}

# ----------------------------------------------------------------------------------------------------------- renders
render_pass() { # <contrast enabled|disabled> <log> <dest>
  local rb="build/results/gallery-$2-$STAMP.xcresult" out="$WORK/$2" status=0
  prep "$1" || return 1
  rm -rf "$rb" "$out"
  xcb_test "$2" 2400 test "$rb" GalleryUITests/testCaptureEverySection >/dev/null || status=$?
  [[ $status -eq 0 ]] || say "✗ $2: the screenshot test reported failures (logs/$2.log); keeping what it captured"
  [[ -d "$rb" ]] || { say "✗ $2: no result bundle"; return 1; }
  xcrun xcresulttool export attachments --path "$rb" --output-path "$out" >/dev/null
  python3 -I "$HELPER" renders "$out" "$3" || status=1
  return $status
}

# Retakes the renders in <dest> that show the gallery's scroll indicator, holding each section still for 2 s first.
retake_pass() { # <contrast enabled|disabled> <log> <dest>
  local flagged rb="build/results/gallery-$2-retake-$STAMP.xcresult" out="$WORK/$2-retake" status=0
  flagged="$(python3 -I "$HELPER" indicator "$3")" || return 1
  if [[ -z "$flagged" ]]; then say "• $2: no render shows the scroll indicator"; return 0; fi
  say "• $2: retaking $(tr ',' '\n' <<<"$flagged" | grep -c .) renders that show the scroll indicator"
  prep "$1" || return 1
  rm -rf "$rb" "$out"
  TEST_RUNNER_KIT_SECTIONS="$flagged" xcb_test "$2-retake" 1200 test "$rb" \
    RecordingUITests/testGallerySectionsWithoutScrollIndicator >/dev/null || status=$?
  [[ $status -eq 0 ]] || say "✗ $2-retake: the test reported failures (logs/$2-retake.log)"
  [[ -d "$rb" ]] || { say "✗ $2-retake: no result bundle"; return 1; }
  xcrun xcresulttool export attachments --path "$rb" --output-path "$out" >/dev/null
  python3 -I "$HELPER" renders "$out" "$3" "$flagged" || status=1
  flagged="$(python3 -I "$HELPER" indicator "$3")" || return 1
  [[ -z "$flagged" ]] || { say "✗ $2: still showing the scroll indicator: $flagged"; status=1; }
  return $status
}

retake() {
  local status=0
  retake_pass disabled gallery-shots "$RENDERS" || status=1
  retake_pass enabled gallery-shots-ic "$RENDERS/increase-contrast" || status=1
  prep disabled || status=1
  return $status
}

renders() {
  local status=0
  render_pass disabled gallery-shots "$RENDERS" || status=1
  render_pass enabled gallery-shots-ic "$RENDERS/increase-contrast" || status=1
  retake || status=1
  return $status
}

# -------------------------------------------------------------------------------------------------------- recordings
rec_test() {
  case "$1" in
    app-tour) echo "RecordingUITests/testTransitionsForRecording" ;;
    icon-animations) echo "GalleryUITests/testIconAnimationsForRecording" ;;
    debbie-idle-app) echo "GalleryUITests/testDebbieIdleForRecording" ;;
    resident) echo "RecordingUITests/testResidentForRecording" ;;
    *) say "capture: unknown recording '$1'" >&2; return 2 ;;
  esac
}

rec_title() {
  case "$1" in
    app-tour) echo "app-tour.mp4: the caregiver's demo, end to end" ;;
    icon-animations) echo "icon-animations.mp4: every icon effect" ;;
    debbie-idle-app) echo "debbie-idle-app.mp4: Debbie idling, as the app draws her" ;;
    resident) echo "resident.mp4: the person at home" ;;
  esac
}

record_one() { # <name>: record the Simulator while the test runs, then finish the video
  local name="$1" test raw="$WORK/$1-raw.mp4" rb="build/results/kit-rec-$1-$STAMP.xcresult" status=0 watcher
  test="$(rec_test "$name")" || return 2
  rm -rf "$raw" "$raw.start" "$rb"
  # The recorder creates its file the moment it starts capturing: that instant is the raw video's 0 s.
  python3 -I "$HELPER" watch "$raw" "$raw.start" &
  watcher=$!
  tools/video/record.sh start large "$raw" >/dev/null
  wait "$watcher" || { tools/video/record.sh stop "$raw" >/dev/null || true; say "✗ $name: the recorder never started"; return 1; }
  xcb_test "kit-rec-$name" 900 test-without-building "$rb" "$test" >/dev/null || status=$?
  sleep 1.5   # the app closing after the test, so the trim can find it
  tools/video/record.sh stop "$raw" >/dev/null
  [[ $status -eq 0 ]] || { say "✗ $name: $test failed (logs/kit-rec-$name.log)"; return 1; }
  printf '%s\n' "$rb" > "$WORK/$name.xcresult-path"
  finish_one "$name"
}

finish_one() { # <name>: trim the raw recording to the app, encode it at a constant 60 fps, draw its contact sheet
  local name="$1" test raw="$WORK/$1-raw.mp4" rb window start end
  test="$(rec_test "$name")" || return 2
  [[ -f "$raw" && -f "$raw.start" && -f "$WORK/$name.xcresult-path" ]] || { say "✗ $name: no raw recording to finish"; return 1; }
  rb="$(cat "$WORK/$name.xcresult-path")"
  window="$(python3 -I "$HELPER" window "$name" "$rb" "${test}()" "$raw" "$(cat "$raw.start")" "$WORK/$name.json")" \
    || { say "✗ $name: couldn't find the part to keep"; return 1; }
  read -r start end <<<"$window"
  # fps first (it repeats a held frame, so the trim lands on whatever was on screen), then the exact trim.
  ffmpeg -v error -y -fflags +igndts -i "$raw" -vf "fps=60,trim=start=$start:end=$end,setpts=PTS-STARTPTS" \
    -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -profile:v high \
    -color_range tv -colorspace bt709 -color_primaries bt709 -color_trc iec61966-2-1 \
    -movflags +faststart -an "$RECS/$name.mp4" \
    || { say "✗ $name: ffmpeg failed"; return 1; }
  swift tools/design/kit/capture-sheet.swift "$RECS/$name.mp4" "$RECS/$name-1fps.png" --title "$(rec_title "$name")" >/dev/null \
    || { say "✗ $name: the contact sheet failed"; return 1; }
  say "• $name: $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$RECS/$name.mp4") s → $RECS/$name.mp4, $name-1fps.png"
}

all_recordings() { if [[ $# -gt 0 ]]; then printf '%s\n' "$@"; else printf '%s\n' app-tour icon-animations debbie-idle-app resident; fi; }

recordings() {
  local names status=0 n
  names=($(all_recordings "$@"))
  for n in "${names[@]}"; do rec_test "$n" >/dev/null || return 2; done
  mkdir -p "$RECS"
  prep disabled || return 1
  # Build once, outside any recording.
  tools/ci/xcb.sh kit-rec-build 2400 -project Debbie.xcodeproj -scheme Debbie -destination "$DEST" -derivedDataPath "$DD" \
    build-for-testing >/dev/null || { say "✗ build-for-testing failed (logs/kit-rec-build.log)"; return 1; }
  for n in "${names[@]}"; do record_one "$n" || status=1; done
  python3 -I "$HELPER" doc "$RECS" "$WORK" || status=1
  return $status
}

retrim() {
  local names status=0 n
  names=($(all_recordings "$@"))
  for n in "${names[@]}"; do finish_one "$n" || status=1; done
  python3 -I "$HELPER" doc "$RECS" "$WORK" || status=1
  return $status
}

# ----------------------------------------------------------------------------------------------------------- release
release() {
  local app=build/DD-rel/Build/Products/Release-iphonesimulator/Debbie.app
  tools/ci/xcb.sh rel-sim 1800 -project Debbie.xcodeproj -scheme Debbie -configuration Release \
    -destination 'generic/platform=iOS Simulator' -derivedDataPath build/DD-rel build >/dev/null \
    || { say "✗ Release build failed (logs/rel-sim.log)"; return 1; }
  [[ -d "$app" ]] || { say "✗ no $app"; return 1; }
  tools/ci/check-release-clean.sh "$app" || { say "✗ the Release app contains Debug-only code"; return 1; }
  tools/ci/check-warnings.sh logs/rel-sim.log || say "  (reported only: warnings don't fail this kit step)"
}

reset_sim() {
  tools/sim/sim.sh reset-ui large >/dev/null
  xcrun simctl spawn "$UDID" defaults write com.apple.Accessibility ReduceMotionEnabled -bool false
  say "• Debbie Max: $(xcrun simctl ui "$UDID" appearance), $(xcrun simctl ui "$UDID" content_size), Increase Contrast $(xcrun simctl ui "$UDID" increase_contrast)"
}

cmd="${1:-all}"; [[ $# -gt 0 ]] && shift
status=0
case "$cmd" in
  renders) renders || status=1; reset_sim ;;
  retake) retake || status=1; reset_sim ;;
  recordings) recordings "$@" || status=1; reset_sim ;;
  retrim) retrim "$@" || status=1 ;;
  release) release || status=1 ;;
  reset) reset_sim ;;
  all) renders || status=1; recordings || status=1; release || status=1; reset_sim ;;
  *) sed -n '2,18p' "$0"; exit 2 ;;
esac
exit $status
