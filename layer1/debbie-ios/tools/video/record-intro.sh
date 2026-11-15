#!/usr/bin/env bash
# Records the launch intro on a Simulator and extracts its frames for inspection (CRAFT.md §3.7 N7; brief §8).
#   tools/video/record-intro.sh [small|large] [on|off]     # device, Reduce Motion (default: small, off)
# Launches the Debug app built by the UI tests (build/DD) straight from simctl, so the recording starts a moment
# before the first frame. Writes Design/reviews/recordings/intro[-RM].mp4, a 10 fps contact sheet from the launch
# beside it, and 30 fps frames in build/intro[-RM]-frames/.
set -euo pipefail
cd "$(dirname "$0")/../.."
dev="${1:-small}"; rm="${2:-off}"
tag="intro"; [[ "$rm" == on ]] && tag="intro-RM"
out="Design/reviews/recordings/$tag.mp4"; frames="build/$tag-frames"
mkdir -p Design/reviews/recordings build logs
udid="$(tools/sim/sim.sh udid "$dev")"
bundle="$(grep -E '^DEBBIE_BUNDLE_ID' Config/Local.xcconfig | sed 's/.*= *//')"
app="build/DD/Build/Products/Debug-iphonesimulator/Debbie.app"
if [[ ! -d "$app" ]]; then
  tools/ci/xcb.sh intro-build 1800 build-for-testing -project Debbie.xcodeproj -scheme Debbie \
    -destination "platform=iOS Simulator,name=Debbie $([[ $dev == small ]] && echo SE || echo Max)" -derivedDataPath build/DD >/dev/null 2>&1
fi
xcrun simctl bootstatus "$udid" -b >/dev/null
# Reduce Motion is set for the take and switched back off at the end, whatever happens, so later test runs on this
# simulator see the normal motion (the screen gate sets it per configuration itself).
trap 'xcrun simctl spawn "$udid" defaults write com.apple.Accessibility ReduceMotionEnabled -bool false >/dev/null 2>&1 || true' EXIT
xcrun simctl spawn "$udid" defaults write com.apple.Accessibility ReduceMotionEnabled -bool "$([[ $rm == on ]] && echo true || echo false)"
xcrun simctl terminate "$udid" "$bundle" 2>/dev/null || true
xcrun simctl install "$udid" "$app"
# A fresh install has no pairing, so the app opens on the welcome and the intro plays.
# simctl's recorder starts with a variable delay (up to about 3 s), so the launch waits for it, and the take runs long.
tools/video/record.sh start "$dev" "$out" >/dev/null
sleep 3.5
SIMCTL_CHILD_DEBBIE_ASSISTANT=offline xcrun simctl launch "$udid" "$bundle" >/dev/null
sleep 7
tools/video/record.sh stop "$out" >/dev/null
# The launch is the first frame that is white nearly everywhere (the launch screen): the 10th-percentile luma must be
# high too, which a light Home Screen wallpaper with dark icons never reaches. Video luma is limited range (white = 235).
stats="$(mktemp)"
ffmpeg -v error -i "$out" -vf "signalstats,metadata=print:key=lavfi.signalstats.YLOW:file=$stats" -f null - 2>/dev/null
launch="$(awk '/pts_time/ {split($0,a,"pts_time:"); t=a[2]+0} /YLOW/ {split($0,b,"="); if (b[2]+0 > 220) {print t; exit}}' "$stats")"
rm -f "$stats"
launch="${launch:-0}"
rm -rf "$frames"
swift tools/video/frames.swift "$out" "$frames" --fps 30 --start "$launch" --duration 5.5 > "logs/$tag-frames.log" 2>&1 || true
# The sheet comes from the exact frames (the recording's frame rate is variable, which misleads ffmpeg's own sampling).
ffmpeg -v error -y -framerate 30 -i "$frames/frame-%04d.png" -vf "select='not(mod(n,3))',scale=180:-1,tile=12x5:padding=4:margin=4:color=0x777777" \
  -frames:v 1 "Design/reviews/recordings/$tag-10fps.png"
echo "✓ $out (launch at ${launch}s); frames in $frames; sheet Design/reviews/recordings/$tag-10fps.png"
