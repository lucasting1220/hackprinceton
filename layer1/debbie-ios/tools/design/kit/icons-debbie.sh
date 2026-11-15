#!/usr/bin/env bash
# Designer kit, part "icons, illustrations and Debbie": regenerates every exported file in DesignerKit/05-icons,
# 06-illustrations and 07-debbie from the design sources, the shipped asset catalogs (read only) and the app's own
# avatar code. The hand-written guides (icons.md, illustrations.md, debbie.md) are left alone.
#
#   tools/design/kit/icons-debbie.sh          (works from the repo root wherever it is started)
#
# Helpers: icons-debbie-icons.swift (icon PNGs and outline SVGs, checked against SwiftUI), icons-debbie-avatar.py
# (avatar layers, composites, idle frames; reads the app's avatar code), icons-debbie-idle.swift (the idle pose per
# frame, computed by the app's own IdlePose, copied out of DebbieAvatar.swift at run time).
# Needs rsvg-convert, ffmpeg and ffprobe (Homebrew), Xcode's command-line tools (swift, swiftc, actool) and python3.
# Intermediate files go to build/designer-kit/icons-debbie (gitignored); the idle animation's 1024 px transparent
# frames go to build/designer-kit/debbie-frames. Nothing in Design/, the asset catalogs or the app is written.
set -euo pipefail
cd "$(dirname "$0")/../../.."

KIT=DesignerKit
ICONS=$KIT/05-icons
ART=$KIT/06-illustrations
DEB=$KIT/07-debbie
WORK=build/designer-kit/icons-debbie
FRAMES=build/designer-kit/debbie-frames
DS=Packages/DebbieKit/Sources/DebbieDesignSystem
SYMBOLS=$DS/Resources/Symbols.xcassets
ARTCAT=$DS/Resources/Art.xcassets
TOKENS=Design/tokens/colors.json
AVATAR_SRC=Design/avatar/src/debbie.svg
HELPER=tools/design/kit/icons-debbie-avatar.py
JOBS=$(sysctl -n hw.ncpu 2>/dev/null || echo 4)
export SOURCE_DATE_EPOCH=1794614400   # 2026-11-14 UTC: the layer PDFs carry a fixed date, so reruns are identical

# The idle clip starts 2,329,734 x 350.4 s after 2001-01-01 00:00 UTC (2026-11-14 08:46:33.6 UTC), the clock IdlePose
# reads. 350.4 s is the common period of the breath (4.8 s) and the head tilt (7.3 s), so both start at zero (the rest
# pose) and After Effects expressions driven by `time` match the clip frame for frame. This start also puts two whole
# blinks inside the 9 s (1.673 s and 6.191 s), neither cut by the ends.
T0=816338793.6
CLIP_SECONDS=9

for tool in rsvg-convert ffmpeg ffprobe xcrun swift python3; do
  command -v "$tool" >/dev/null || { echo "icons-debbie: $tool not found" >&2; exit 1; }
done
mkdir -p "$WORK/avatar" "$ICONS" "$ART" "$DEB"

token() { python3 -I -c 'import json, sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["tokens"][sys.argv[2]]["light"].upper())' "$TOKENS" "$1"; }
INK=$(token text.primary)
ACCENT=$(token accent.text)
MINT_TINT=$(token mint.tint)
echo "colours (light): ink = text.primary $INK; accent = accent.text $ACCENT; Debbie's circle = mint.tint $MINT_TINT"

# The app's avatar code: fails if it no longer has the shape the renders reproduce; writes the numbers it read and a
# verbatim copy of IdlePose for the idle tool.
python3 -I "$HELPER" check-app "$DS/Persona/DebbieAvatar.swift" "$DS/Tokens/Tokens.swift" "$DS/Components/Components.swift" \
  "$WORK/avatar/app.json" "$WORK/avatar/IdlePose.swift"
app() { python3 -I -c 'import json, sys; v = json.load(open(sys.argv[1], encoding="utf-8")); [v := v[k] for k in sys.argv[2:]]; print(f"{v:g}")' "$WORK/avatar/app.json" "$@"; }

# ------------------------------------------------------------------------------------------------------------------
echo "== 05-icons"
rm -rf "$WORK/symbols" "$ICONS/svg" "$ICONS/svg-outlined" "$ICONS/png" "$ICONS/sheets"
mkdir -p "$WORK/symbols/bundle" "$WORK/symbols/Review.bundle/Contents/Resources" "$ICONS/svg" "$ICONS/sheets"
# The kit draws what ships. A fresh run of the symbol generator must reproduce the shipped catalog exactly; if it
# doesn't, the sources changed without Design/scripts/render-symbols.sh, and the kit would disagree with the app.
swift Design/scripts/symbols.swift Design/symbols/src "$WORK/symbols/fresh/Symbols.xcassets" >/dev/null
if ! diff -rq "$WORK/symbols/fresh/Symbols.xcassets" "$SYMBOLS" >/dev/null; then
  echo "icons-debbie: $SYMBOLS is out of date with Design/symbols/src; run Design/scripts/render-symbols.sh first" >&2
  exit 1
fi
echo "symbols: the shipped catalog matches a fresh run of Design/scripts/symbols.swift on Design/symbols/src"
if ! xcrun actool "$SYMBOLS" --compile "$WORK/symbols/bundle" --platform macosx --minimum-deployment-target 14.0 \
     --output-format human-readable-text --warnings --errors > "$WORK/symbols/actool.log" 2>&1 \
   || grep -qiE "error|warning" "$WORK/symbols/actool.log"; then
  cat "$WORK/symbols/actool.log" >&2; echo "icons-debbie: actool failed" >&2; exit 1
fi
cp "$WORK/symbols/bundle/Assets.car" "$WORK/symbols/Review.bundle/Contents/Resources/"
if [[ ! -x "$WORK/icons-debbie-icons" || "$WORK/icons-debbie-icons" -ot tools/design/kit/icons-debbie-icons.swift ]]; then
  xcrun swiftc -O -o "$WORK/icons-debbie-icons" tools/design/kit/icons-debbie-icons.swift
fi
names=()
for f in Design/symbols/src/*.svg; do names+=("$(basename "$f" .svg)"); done
"$WORK/icons-debbie-icons" "$WORK/symbols/Review.bundle" "$SYMBOLS" "$ICONS" "$INK" "$ACCENT" "${names[@]}"
cp Design/symbols/src/*.svg "$ICONS/svg/"
cp Design/reviews/icons/*.png "$ICONS/sheets/"
echo "icons: ${#names[@]} sources copied to svg/; review sheets copied to sheets/"

# ------------------------------------------------------------------------------------------------------------------
echo "== 06-illustrations"
rm -rf "$ART/svg" "$ART/png" "$ART/review-sheets"
mkdir -p "$ART/svg/token-source" "$ART/png" "$ART/review-sheets"
# What the app draws: the light rendition in the asset catalog. Its token source sits beside it for the token names.
# Display heights: welcome at Size.welcomeArt (its old place on the welcome screen; build 3 doesn't draw it),
# no-alerts at DEmptyState's maxHeight. Width follows the art's aspect ratio.
art_specs=()
for spec in "welcome:$(app welcomeArt)" "no-alerts:$(app emptyStateArtHeight)"; do
  name=${spec%%:*}; hpt=${spec##*:}
  cp "$ARTCAT/$name.imageset/$name-light.svg" "$ART/svg/$name.svg"
  cp "Design/illustrations/src/$name.svg" "$ART/svg/token-source/$name.svg"
  read -r vw vh < <(sed -nE 's/.*viewBox="0 0 ([0-9.]+) ([0-9.]+)".*/\1 \2/p' "$ART/svg/$name.svg" | head -1)
  wpt=$(python3 -I -c 'import sys; w, h, H = map(float, sys.argv[1:]); print(f"{H * w / h:g}")' "$vw" "$vh" "$hpt")
  for k in 1 2 3; do
    w=$(python3 -I -c 'import sys; print(round(float(sys.argv[1]) * int(sys.argv[2])))' "$wpt" "$k")
    h=$(python3 -I -c 'import sys; print(round(float(sys.argv[1]) * int(sys.argv[2])))' "$hpt" "$k")
    suffix=""; [[ $k -gt 1 ]] && suffix="@${k}x"
    rsvg-convert -w "$w" -h "$h" -o "$ART/png/$name$suffix.png" "$ART/svg/$name.svg"
  done
  rsvg-convert -w 2048 -o "$ART/png/$name-2048px.png" "$ART/svg/$name.svg"
  echo "art $name: ${wpt} x ${hpt} pt; PNG @1x/@2x/@3x and a 2048 px master"
  art_specs+=("$name:$ART/svg/$name.svg:Design/illustrations/src/$name.svg")
done
python3 -I "$HELPER" art "$TOKENS" "${art_specs[@]}"
cp Design/reviews/art/*.png "$ART/review-sheets/"

# ------------------------------------------------------------------------------------------------------------------
echo "== 07-debbie"
rm -rf "$DEB/source" "$DEB/layers" "$DEB/renders" "$DEB/idle-animation" "$FRAMES" \
       "$WORK/avatar/static" "$WORK/avatar/frames-svg" "$WORK/avatar/frames-on-circle"
mkdir -p "$DEB/layers/png" "$DEB/layers/pdf" "$DEB/renders/transparent" "$DEB/renders/on-mint-circle" "$DEB/idle-animation" "$FRAMES"
python3 -I "$HELPER" layers "$AVATAR_SRC" "$DEB"
for svg in "$DEB"/layers/svg/*.svg; do
  b=$(basename "$svg" .svg)
  rsvg-convert -w 1024 -h 1024 -o "$DEB/layers/png/$b.png" "$svg"
  rsvg-convert -f pdf --dpi-x 72 --dpi-y 72 -o "$DEB/layers/pdf/$b.pdf" "$svg"
done
# The layer PDFs are made the way Design/scripts/export-avatar.sh makes the app's, so they should match the shipped
# imagesets byte for byte. A difference means the source changed without that export, or rsvg-convert changed.
same=0
for pdf in "$DEB"/layers/pdf/*.pdf; do
  layer=$(basename "$pdf" .pdf); layer=${layer#[0-9][0-9]-}
  cmp -s "$pdf" "$ARTCAT/Debbie-$layer.imageset/Debbie-$layer.pdf" && same=$((same + 1))
done
if [[ $same -eq 9 ]]; then
  echo "layers: all 9 layer PDFs are byte-identical to the shipped Debbie-<layer> imagesets"
else
  echo "layers: NOTE only $same of 9 layer PDFs match the shipped imagesets byte for byte; if Design/avatar/src/debbie.svg"
  echo "        changed, run Design/scripts/export-avatar.sh so the app and this kit agree"
fi

# Renders: rest and eyes closed at the app's sizes @3x and a 1024 px master, on transparent and on the mint.tint circle.
python3 -I "$HELPER" statics "$AVATAR_SRC" "$WORK/avatar/app.json" "$MINT_TINT" "$WORK/avatar/static"
sizes=("$(app sizes tabAvatar)" "$(app sizes avatarSmall)" "$(app sizes avatarGuide)" "$(app sizes avatarHero)")
for pose in rest eyes-closed; do
  for bg in transparent on-mint-circle; do
    for pt in "${sizes[@]}"; do
      px=$(python3 -I -c 'import sys; print(round(float(sys.argv[1]) * 3))' "$pt")
      rsvg-convert -w "$px" -h "$px" -o "$DEB/renders/$bg/debbie-$pose-${pt}pt@3x.png" "$WORK/avatar/static/$pose-$bg.svg"
    done
    rsvg-convert -w 1024 -h 1024 -o "$DEB/renders/$bg/debbie-$pose-1024px.png" "$WORK/avatar/static/$pose-$bg.svg"
  done
done
echo "renders: rest and eyes-closed at ${sizes[*]} pt @3x and 1024 px, transparent and on mint.tint"

# Idle: the pose per frame from the app's own IdlePose, then one composite per frame.
FPS=$(app fps)
NFRAMES=$(python3 -I -c 'import sys; print(round(float(sys.argv[1]) * float(sys.argv[2])))' "$CLIP_SECONDS" "$FPS")
IDLE_TOOL="$WORK/avatar/icons-debbie-idle"
xcrun swiftc -O -parse-as-library -o "$IDLE_TOOL" tools/design/kit/icons-debbie-idle.swift "$WORK/avatar/IdlePose.swift"
"$IDLE_TOOL" "$T0" "$FPS" "$NFRAMES" "$WORK/avatar/poses.csv" "$WORK/avatar/blinks.txt"
grep -v '^#' "$WORK/avatar/blinks.txt" | sed 's/^/  blink: /'
python3 -I "$HELPER" frames "$AVATAR_SRC" "$WORK/avatar/app.json" "$MINT_TINT" "$WORK/avatar/poses.csv" \
  "$WORK/avatar/frames-svg/transparent" "$WORK/avatar/frames-svg/on-circle" "$DEB/idle-animation/debbie-idle-poses.csv"
render_frames() {   # <svg-dir> <png-dir>: every frame at 1024 px, in parallel
  mkdir -p "$2"
  for f in "$1"/*.svg; do printf '%s\0%s\0' "$f" "$2/$(basename "$f" .svg).png"; done |
    xargs -0 -n 2 -P "$JOBS" sh -c 'rsvg-convert -w 1024 -h 1024 -o "$1" "$0"'
}
render_frames "$WORK/avatar/frames-svg/transparent" "$FRAMES"
render_frames "$WORK/avatar/frames-svg/on-circle" "$WORK/avatar/frames-on-circle"
echo "frames: $(ls "$FRAMES" | wc -l | tr -d ' ') transparent 1024 px PNGs in $FRAMES"

FF=(ffmpeg -hide_banner -loglevel error -y -framerate "$FPS")
TAGS=(-color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv)
# H.264 on the mint.tint circle over white. RGB -> YUV uses the BT.709 matrix the file is tagged with.
"${FF[@]}" -i "$WORK/avatar/frames-on-circle/%04d.png" \
  -vf "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p" \
  -c:v libx264 -preset slow -crf 14 -tune animation "${TAGS[@]}" -movflags +faststart "$DEB/idle-animation/debbie-idle.mp4"
# ProRes 4444 with straight (unmatted) alpha, from the transparent frames. The frames' alpha is 8-bit, so 8 alpha
# bits lose nothing; quantiser 8 keeps the colour at about 57 dB PSNR against the PNGs (visually lossless) at about
# half the size of the default (measured 2026-11-14: 32 MB against 59 MB).
"${FF[@]}" -i "$FRAMES/%04d.png" \
  -vf "scale=out_color_matrix=bt709:out_range=tv,format=yuva444p10le" \
  -c:v prores_ks -profile:v 4444 -alpha_bits 8 -q:v 8 -vendor apl0 "${TAGS[@]}" "$DEB/idle-animation/debbie-idle-transparent.mov"
# GIF at 512 px on the circle over white: one palette for the whole clip, no dithering (flat art), and only the
# changed rectangle stored per frame.
"${FF[@]}" -i "$WORK/avatar/frames-on-circle/%04d.png" \
  -vf "scale=512:512:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" \
  -loop 0 "$DEB/idle-animation/debbie-idle.gif"

# Checks: each file's size, frame count, length and format; the circle's colour after H.264; ProRes alpha.
probe() { ffprobe -v error -select_streams v:0 -count_frames -show_entries stream=codec_name,width,height,pix_fmt,nb_read_frames:format=duration -of default=nw=1:nk=1 "$1" | paste -sd' ' -; }
for f in debbie-idle.mp4 debbie-idle-transparent.mov debbie-idle.gif; do
  info=$(probe "$DEB/idle-animation/$f")
  echo "  $f: $info ($(du -h "$DEB/idle-animation/$f" | cut -f1 | tr -d ' '))"
  [[ " $info " == *" $NFRAMES "* ]] || { echo "icons-debbie: $f does not have $NFRAMES frames" >&2; exit 1; }
done
pixel() { ffmpeg -v error -i "$1" -vf "select=eq(n\,0),format=$4,crop=1:1:$2:$3" -frames:v 1 -f rawvideo - | od -An -tu1 | tr -s ' ' | sed 's/^ //'; }
circle=$(pixel "$DEB/idle-animation/debbie-idle.mp4" 512 40 rgb24)
corner=$(pixel "$DEB/idle-animation/debbie-idle-transparent.mov" 2 2 rgba)
middle=$(pixel "$DEB/idle-animation/debbie-idle-transparent.mov" 512 900 rgba)
python3 -I - "$MINT_TINT" "$circle" "$corner" "$middle" <<'PY'
import sys
want = [int(sys.argv[1][i:i + 2], 16) for i in (1, 3, 5)]
got = [int(v) for v in sys.argv[2].split()]
off = max(abs(a - b) for a, b in zip(want, got))
corner, middle = [int(v) for v in sys.argv[3].split()], [int(v) for v in sys.argv[4].split()]
print(f"  mp4: the circle decodes as {got} for mint.tint {want} (largest channel difference {off})")
print(f"  mov: alpha {corner[3]} outside the circle, {middle[3]} on her top")
if off > 3 or corner[3] != 0 or middle[3] != 255:
    sys.exit("icons-debbie: colour or alpha check failed")
PY

echo "== done"
for d in "$ICONS" "$ART" "$DEB"; do
  echo "  $d: $(find "$d" -type f ! -name '*.md' | wc -l | tr -d ' ') generated files, $(du -sh "$d" | cut -f1 | tr -d ' ')"
done
