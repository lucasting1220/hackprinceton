#!/usr/bin/env bash
# Regenerates every custom symbol from Design/symbols/src, compiles them, renders each
# beside system text, and tiles the renders into Design/reviews/icons/<name>.png.
#   Design/scripts/render-symbols.sh [sheet-name] [icon-name ...]   (default: all icons, sheet "all")
set -euo pipefail
cd "$(dirname "$0")/../.."
CATALOG="Packages/DebbieKit/Sources/DebbieDesignSystem/Resources/Symbols.xcassets"
WORK="build/symbols"
SHEET="${1:-all}"; shift || true
mkdir -p "$WORK/bundle" "$WORK/Review.bundle/Contents/Resources" "$WORK/renders" Design/reviews/icons
swift Design/scripts/symbols.swift Design/symbols/src "$CATALOG"
xcrun actool "$CATALOG" --compile "$WORK/bundle" --platform macosx --minimum-deployment-target 14.0 \
  --output-format human-readable-text --warnings --errors | grep -E "error|warning" && exit 1 || true
cp "$WORK/bundle/Assets.car" "$WORK/Review.bundle/Contents/Resources/"
[[ -x "$WORK/symrender" && "$WORK/symrender" -nt Design/scripts/symrender.swift ]] || xcrun swiftc -O -o "$WORK/symrender" Design/scripts/symrender.swift
names=("$@")
if [[ ${#names[@]} -eq 0 ]]; then
  for f in Design/symbols/src/*.svg; do names+=("$(basename "$f" .svg)"); done
fi
inputs=()
for n in "${names[@]}"; do
  "$WORK/symrender" "$WORK/Review.bundle" "dx.$n" "$WORK/renders/$n.png" >/dev/null
  inputs+=("$WORK/renders/$n.png=$n")
done
swift tools/design/contact-sheet.swift --out "Design/reviews/icons/$SHEET.png" --columns 4 --cell 300 --title "Debbie icons: $SHEET (UL17 · R17 · B17 · R34 · SB56)" "${inputs[@]}"
