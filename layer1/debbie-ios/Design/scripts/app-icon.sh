#!/usr/bin/env bash
# App icon (CRAFT.md §2.8 B3, D-013): renders AppIcon.appiconset (Any, Dark, Tinted, 1024 px, no
# alpha) from Design/brand/mark.svg, plus review sheets at every size in Design/reviews/app-icon/.
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="App/Assets.xcassets/AppIcon.appiconset"; REV="Design/reviews/app-icon"; TMP="build/app-icon"
mkdir -p "$OUT" "$REV/raw" "$TMP"
path_d="$(sed -n 's/.*d="\([^"]*\)".*/\1/p' Design/brand/mark.svg)"
render() { # name field glyph
  cat > "$TMP/$1.svg" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
<rect width="1024" height="1024" fill="$2"/>
<g transform="translate(512 512) scale(7.4) translate(-53 -50)"><path fill-rule="evenodd" fill="$3" d="$path_d"/></g>
</svg>
SVG
  rsvg-convert -w 1024 -h 1024 "$TMP/$1.svg" -o "$TMP/$1-rgba.png"
  sips -s format jpeg -s formatOptions best "$TMP/$1-rgba.png" --out "$TMP/$1.jpg" >/dev/null
  sips -s format png "$TMP/$1.jpg" --out "$OUT/AppIcon-$1.png" >/dev/null
}
render Any "#6CDCB0" "#0B2E24"
render Dark "#0E2A22" "#6CDCB0"
render Tinted "#000000" "#E6E6E6"
cat > "$OUT/Contents.json" <<'JSON'
{
  "images" : [
    { "filename" : "AppIcon-Any.png", "idiom" : "universal", "platform" : "ios", "size" : "1024x1024" },
    { "appearances" : [ { "appearance" : "luminosity", "value" : "dark" } ], "filename" : "AppIcon-Dark.png", "idiom" : "universal", "platform" : "ios", "size" : "1024x1024" },
    { "appearances" : [ { "appearance" : "luminosity", "value" : "tinted" } ], "filename" : "AppIcon-Tinted.png", "idiom" : "universal", "platform" : "ios", "size" : "1024x1024" }
  ],
  "info" : { "author" : "xcode", "version" : 1 }
}
JSON
[[ -f App/Assets.xcassets/Contents.json ]] || echo '{"info":{"author":"xcode","version":1}}' > App/Assets.xcassets/Contents.json
inputs=()
for v in Any Dark Tinted; do
  for s in 1024 180 120 87 80 60 58 40 16; do
    sips -z "$s" "$s" "$OUT/AppIcon-$v.png" --out "$REV/raw/$v-$s.png" >/dev/null
  done
  inputs+=("$REV/raw/$v-1024.png=$v 1024" "$REV/raw/$v-180.png=$v 180" "$REV/raw/$v-60.png=$v 60" "$REV/raw/$v-40.png=$v 40" "$REV/raw/$v-16.png=$v 16")
done
swift tools/design/contact-sheet.swift --out "$REV/sizes.png" --columns 5 --cell 160 --background "#8E8E93" --title "AppIcon (asset catalog): Any / Dark / Tinted at 1024, 180, 60, 40, 16 px" "${inputs[@]}" >/dev/null
python3 -I - "$OUT" <<'PY'
import sys, subprocess
for v in ("Any","Dark","Tinted"):
    out = subprocess.run(["sips","-g","hasAlpha", f"{sys.argv[1]}/AppIcon-{v}.png"], capture_output=True, text=True).stdout
    print(v, "hasAlpha:", out.strip().split()[-1])
PY
echo "wrote $OUT and $REV/sizes.png"
