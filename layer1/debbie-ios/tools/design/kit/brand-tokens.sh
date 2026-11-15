#!/usr/bin/env bash
# Designer kit, part "brand-tokens": builds DesignerKit/01-brand, 02-color, 03-type and 04-layout from the app's sources
# (Design/brand, Design/tokens, Tokens.swift and the component code), then checks what it wrote.
#
# Usage, from the repo root:  tools/design/kit/brand-tokens.sh
# Needs: python3 (stdlib only), swiftc (Xcode command-line tools), rsvg-convert, sips.
# Re-runnable: the four folders are rebuilt from scratch each time. Temporary files live in a mktemp folder that is removed on exit.
#   tools/design/kit/brand-tokens-data.py      docs, JSON, CSS, Figma tokens, ASE, render specs, rsvg job list
#   tools/design/kit/brand-tokens-render.swift palette.png, specimen.png, brand-usage.png, the lockup tile's corner path
set -euo pipefail
cd "$(dirname "$0")/../../.."
[[ -f Design/tokens/colors.json && -f Packages/DebbieKit/Sources/DebbieDesignSystem/Tokens/Tokens.swift ]] \
  || { echo "brand-tokens: run inside the Debbie repo" >&2; exit 1; }
for tool in python3 swiftc rsvg-convert sips; do
  command -v "$tool" >/dev/null || { echo "brand-tokens: missing $tool" >&2; exit 1; }
done

KIT=DesignerKit
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

for d in 01-brand 02-color 03-type 04-layout; do
  rm -rf "${KIT:?}/$d"
  mkdir -p "$KIT/$d"
done

# 1. The renderer, compiled once.
swiftc -O -o "$TMP/render" tools/design/kit/brand-tokens-render.swift
"$TMP/render" squircle 64 64 20 > "$TMP/squircle.txt"

# 2. Docs, data and render specs.
python3 -I tools/design/kit/brand-tokens-data.py --tmp "$TMP" --squircle "$TMP/squircle.txt"

# 3. Vector art to PNG and PDF (PDF pages are sized in points: 72 dpi makes 1 px = 1 pt).
# A fixed PDF creation date (2026-11-14, build 3) keeps re-runs byte-identical.
export SOURCE_DATE_EPOCH=1794614400
while IFS=$'\t' read -r svg w h kind out; do
  if [[ $kind == pdf ]]; then
    rsvg-convert -f pdf --dpi-x 72 --dpi-y 72 -w "$w" -h "$h" "$svg" -o "$out"
  else
    rsvg-convert -f png -w "$w" -h "$h" "$svg" -o "$out"
  fi
done < "$TMP/rsvg-jobs.tsv"
# rsvg-convert leaves PNGs untagged; tag them sRGB (pixels unchanged) so colour-managed apps show exact token values.
find "$KIT/01-brand/png" "$TMP/art" -name '*.png' -print0 | xargs -0 python3 -I tools/design/kit/brand-tokens-data.py tag-srgb

# 4. Sheets, rendered with the system fonts.
"$TMP/render" palette "$TMP/palette.json" "$KIT/02-color/palette.png"
"$TMP/render" specimen "$TMP/specimen.json" "$KIT/03-type/specimen.png"
"$TMP/render" sheet "$TMP/sheet.json" "$KIT/01-brand/brand-usage.png"

# 5. Checks: every PNG has the size its name promises; brand art is transparent; app icons are opaque; colours are exact.
fail=0
check_png() { # file width height alpha(yes|no)
  local out w h a
  out="$(sips -g pixelWidth -g pixelHeight -g hasAlpha "$1")"
  w="$(awk '/pixelWidth/{print $2}' <<<"$out")"; h="$(awk '/pixelHeight/{print $2}' <<<"$out")"; a="$(awk '/hasAlpha/{print $2}' <<<"$out")"
  if [[ $w != "$2" || $h != "$3" || $a != "$4" ]]; then
    echo "CHECK FAILED: $1 is ${w}x${h} alpha=$a, expected $2x$3 alpha=$4" >&2; fail=1
  fi
}
for c in ink white; do
  for pt in 64 128; do
    for k in 1 2 3; do check_png "$KIT/01-brand/png/mark-$c-${pt}pt@${k}x.png" $((pt * k)) $((pt * k)) yes; done
  done
  for k in 1 2 3; do check_png "$KIT/01-brand/png/wordmark-$c-120pt@${k}x.png" $((120 * k)) $((30 * k)) yes; done
done
for c in ink white mint; do
  check_png "$KIT/01-brand/png/mark-$c-1024px.png" 1024 1024 yes
  check_png "$KIT/01-brand/png/wordmark-$c-1024px.png" 1024 256 yes
done
check_png "$KIT/01-brand/png/lockup-welcome-1024px.png" 1024 1024 yes
for v in any dark tinted; do
  for s in 1024 180 120 87 80 60 58 40 16; do check_png "$KIT/01-brand/app-icon/app-icon-$v-$s.png" "$s" "$s" no; done
done
expect() { # file x,y "#RRGGBB a=1.00"
  local got
  got="$("$TMP/render" sample "$1" "$2" | cut -d' ' -f2-)"
  [[ $got == "$3" ]] || { echo "CHECK FAILED: $1 at $2 is '$got', expected '$3'" >&2; fail=1; }
}
# Mark master (68-unit box from x 19, y 16): the stem at (25, 50) is solid ink; the window's centre (49, 50) is clear.
expect "$KIT/01-brand/png/mark-ink-1024px.png" 90,512 "#14201B a=1.00"
expect "$KIT/01-brand/png/mark-ink-1024px.png" 452,512 "#000000 a=0.00"
expect "$KIT/01-brand/png/mark-mint-1024px.png" 90,512 "#6CDCB0 a=1.00"
# Lockup at 7 px/pt (origin -14.12, -16.92 pt): tile pt (33, 32) is mint; the D's stem, pt (50, 32), is text.onMint.
expect "$KIT/01-brand/png/lockup-welcome-1024px.png" 330,342 "#6CDCB0 a=1.00"
expect "$KIT/01-brand/png/lockup-welcome-1024px.png" 449,342 "#06392A a=1.00"
# Wordmark master (x 6-326, y 4-84 at 3.2 px/unit): the first d's stem at x 53, y 50 is solid ink.
expect "$KIT/01-brand/png/wordmark-ink-1024px.png" 150,147 "#14201B a=1.00"
[[ $fail == 0 ]] || { echo "brand-tokens: checks failed" >&2; exit 1; }

echo "brand-tokens: wrote and checked $(find "$KIT/01-brand" "$KIT/02-color" "$KIT/03-type" "$KIT/04-layout" -type f | wc -l | tr -d ' ') files in $KIT/01-brand, 02-color, 03-type, 04-layout"
