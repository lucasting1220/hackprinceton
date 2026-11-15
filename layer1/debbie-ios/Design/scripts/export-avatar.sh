#!/usr/bin/env bash
# Debbie's avatar: exports the layered source Design/avatar/src/debbie.svg as one vector PDF imageset per layer,
# checks the geometry, colours and asset catalog, and renders the review sheet. Owner direction: "let's give debbie
# a face". The app draws her at 30 pt (centre tab), 44 pt (chat), 64 pt (onboarding guide), 111 pt (badge view)
# and 148 pt (welcome hero): Tokens.swift Size.tabAvatar … avatarHero.
#
#   Design/scripts/export-avatar.sh
#
#  1. Split every <g id> layer into its own SVG on the same 200 x 200 canvas (avatar.swift split, which also
#     validates the source: layer ids and order, the pivot note, one palette, no strokes, gradients, text or raster
#     art). A layer whose group lists data-appearances (hair-back, hair-front) also gets a rendition per appearance,
#     in its <class>-<appearance> colours: mint.tint, the circle behind her, darkens in Dark and again in Dark +
#     Increase Contrast, and the hair has to stay visible on it.
#  2. Convert each layer and rendition to a 200 x 200 pt PDF with rsvg-convert (reproducible: fixed timestamp).
#  3. Write Debbie-<layer>.imageset into the design system's Art.xcassets: single-scale vector PDF,
#     preserves-vector-representation, template-rendering-intent "original". Appearance renditions use the same
#     "appearances" entries as welcome.imageset (luminosity dark; contrast high). Light + Increase Contrast keeps the
#     universal PDF.
#  4. Check that nothing leaves the 200 x 200 canvas; that the body stays inside the circle crop; that the head
#     layers stay inside it at rest and tilted -3 and +3 degrees around the neck pivot (100, 150); that at rest they
#     clear the 30 pt tab's selected ring; that 'deep' never forms the outer silhouette; that every face colour stays
#     clear of the status fills (CIEDE2000 >= 17 from every urgent, caution and live fill, pressed included, in each
#     appearance the colour shows in: CRAFT.md C5); and that the hair stands off mint.tint in every appearance.
#  5. Compile the catalog with actool for iOS 26, fail on any error or warning, and confirm every appearance
#     rendition reached Assets.car.
#  6. Render Design/reviews/avatar/debbie.png from the PDFs that ship.
# Intermediate files and logs go to build/avatar (gitignored). Needs rsvg-convert (Homebrew librsvg, already used for
# review renders), Xcode's command-line tools, and python3 for tools/design/tokens.py's colour maths. Unlike the
# review renders, these PDFs ship in the app.
set -euo pipefail
cd "$(dirname "$0")/../.."

SRC="Design/avatar/src/debbie.svg"
CATALOG="Packages/DebbieKit/Sources/DebbieDesignSystem/Resources/Art.xcassets"
APP_SRC="Packages/DebbieKit/Sources/DebbieDesignSystem"   # read only: avatar sizes and the blink squash, for the sheet
WORK="build/avatar"
REVIEW="Design/reviews/avatar"
LAYERS=(body hair-back head cheeks eyes-open eyes-closed brows mouth hair-front)
APPEARANCES=(dark lightHC darkHC)   # renditions a layer may add; split writes them to $WORK/layers/<appearance>/
HEAD_LIMIT=97        # the tilting layers must stay within this radius of the r = 100 crop
# DebbieTabBar draws the selected 30 pt tab avatar's 2 pt ring inside the circle, so its inner edge sits at
# (15 - 2) / 15 of the radius: 86.7 units. Tab avatars don't idle, so the rest pose must clear it, with 0.25 pt spare.
TAB_RING_LIMIT=85
MIN_DE=17            # CIEDE2000 floor between the face's colours and any status fill
# The hair against mint.tint, in the colours each appearance resolves to. The review measured 1.39:1 (protanopia
# ΔE00 7.0) on the Dark circle and 1.05:1 (3.0) on the Dark + Increase Contrast one as sinking into it, and accepted
# 1.83:1 (12.6) and 1.69:1 (10.1). These floors keep the accepted values and reject the failing ones.
HAIR_MIN_RATIO=1.6
HAIR_MIN_DE=10       # in every vision: normal, protanopia, deuteranopia, tritanopia
export SOURCE_DATE_EPOCH=1794614400   # 2026-11-14 UTC: same source, byte-identical PDFs

for tool in rsvg-convert xcrun python3; do
  command -v "$tool" >/dev/null || { echo "export-avatar: $tool not found" >&2; exit 1; }
done
rm -rf "$WORK/layers" "$WORK/pdf" "$WORK/stage" "$WORK/check" "$WORK/actool"
mkdir -p "$WORK/layers" "$WORK/pdf" "$WORK/stage" "$WORK/check" "$WORK/actool" "$REVIEW"

TOOL="$WORK/avatar-tool"
if [[ ! -x "$TOOL" || "$TOOL" -ot Design/scripts/avatar.swift ]]; then
  xcrun swiftc -O -o "$TOOL" Design/scripts/avatar.swift
fi

echo "== 1. split"
"$TOOL" split "$SRC" "$WORK/layers"
renditions=()   # "<layer> <appearance>" for every appearance rendition split wrote
rendition_names="none"
for id in "${LAYERS[@]}"; do
  for ap in "${APPEARANCES[@]}"; do
    if [[ -f "$WORK/layers/$ap/$id.svg" ]]; then
      renditions+=("$id $ap")
      [[ "$rendition_names" == "none" ]] && rendition_names="Debbie-$id-$ap" || rendition_names+=", Debbie-$id-$ap"
    fi
  done
done

echo "== 4. geometry and colour checks (before anything is written to the catalog)"
for check in all body head-rest head-minus3 head-plus3; do
  rsvg-convert -w 600 -h 600 -o "$WORK/check/$check.png" "$WORK/layers/check-$check.svg"
done
"$TOOL" measure "$WORK/check/all.png" 2 --box
"$TOOL" measure "$WORK/check/body.png" 2 --box --max-radius 100.5
reach=()
for check in head-rest head-minus3 head-plus3; do
  line="$("$TOOL" measure "$WORK/check/$check.png" 2 --box --max-radius "$HEAD_LIMIT")"
  echo "$line"
  reach+=("$(sed -E 's/.*reaches ([0-9.]+).*/\1/' <<<"$line")")
done
"$TOOL" measure "$WORK/check/head-rest.png" 2 --box --max-radius "$TAB_RING_LIMIT" >/dev/null
echo "tab ring: at rest the head layers reach ${reach[0]}, inside the selected ring's inner edge (limit $TAB_RING_LIMIT)"
rsvg-convert -w 1200 -h 1200 -o "$WORK/check/deep-edge.png" "$WORK/layers/check-deep-edge.svg"
"$TOOL" edge "$WORK/check/deep-edge.png" 4 "#FF00FF" deep
colour_lines="$(python3 -I - "$SRC" "$MIN_DE" "$HAIR_MIN_RATIO" "$HAIR_MIN_DE" <<'PY'
import importlib.util, json, re, sys
spec = importlib.util.spec_from_file_location("tokens", "tools/design/tokens.py")
t = importlib.util.module_from_spec(spec)
spec.loader.exec_module(t)
tokens = json.load(open("Design/tokens/colors.json", encoding="utf-8"))["tokens"]
appearances = ("light", "dark", "lightHC", "darkHC")
fills = {f"{name}/{ap}": tokens[name][ap] for name in ("urgent.fill", "urgent.fill.pressed", "caution.fill", "live.fill")
         for ap in appearances if tokens[name].get(ap)}
svg = open(sys.argv[1], encoding="utf-8").read()
style = re.search(r"<style>(.*?)</style>", svg, re.S).group(1)
palette = {name: hexv.upper() for name, hexv in re.findall(r"\.([A-Za-z][\w-]*)\s*\{\s*fill\s*:\s*(#[0-9A-Fa-f]{6})", style)}
brand = {tokens["mint.fill"]["light"].upper(), tokens["accent.text"]["light"].upper()}
missing = brand - set(palette.values())
if missing:
    sys.exit(f"export-avatar: the top must use the brand mint and accent green; missing {sorted(missing)}")
# Every colour in the palette, against the status fills of every appearance it shows in. A base colour shows in all
# four. An appearance colour (hair-dark, deep-darkHC …) shows only in its own appearance (a -dark colour also in
# darkHC when the class has no -darkHC one), and the fills of the other appearances never share the screen with it.
def shown_in(name):
    for ap in ("darkHC", "lightHC", "dark"):
        base = name[: -len(ap) - 1]
        if name.endswith("-" + ap) and base in palette:
            return [ap] + (["darkHC"] if ap == "dark" and f"{base}-darkHC" not in palette else [])
    return list(appearances)
floor, worst = float(sys.argv[2]), None
for name, hexv in palette.items():
    if hexv in brand or hexv == "#FFFFFF":
        continue   # brand tokens, and white catch-lights
    lab = t.to_lab(t.hex_to_rgb(hexv))
    aps = shown_in(name)
    de, against = min((t.ciede2000(lab, t.to_lab(t.hex_to_rgb(v))), k) for k, v in fills.items() if k.split("/")[1] in aps)
    seen = "all appearances" if len(aps) == len(appearances) else "+".join(aps) + " only"
    print(f"  {name:12} {hexv}  shown in {seen:16} nearest status fill {against}: CIEDE2000 {de:.1f}", file=sys.stderr)
    if de < floor:
        sys.exit(f"export-avatar: {name} {hexv} is only {de:.1f} from {against}; keep the face clear of status colours")
    worst = de if worst is None else min(worst, de)
# The hair forms the outer silhouette of the head (deep never does: avatar edge checks it), so it must stand off
# the circle. (No apostrophes in this block: bash 3.2 misparses them in a heredoc inside a command substitution.)
min_ratio, min_de = float(sys.argv[3]), float(sys.argv[4])
def resolve(name, ap):   # as the asset catalog falls back: darkHC -> dark -> universal
    chain = {"light": [], "dark": ["dark"], "lightHC": ["lightHC"], "darkHC": ["darkHC", "dark"]}[ap]
    return next((palette[f"{name}-{a}"] for a in chain if f"{name}-{a}" in palette), palette[name])
hair = []
for ap in appearances:
    fg, bg = resolve("hair", ap), tokens["mint.tint"][ap]
    a, b = t.hex_to_rgb(fg), t.hex_to_rgb(bg)
    ratio = t.contrast(a, b)
    des = {k: t.ciede2000(t.to_lab(t.simulate(a, k)), t.to_lab(t.simulate(b, k)))
           for k in ("normal", "protanopia", "deuteranopia", "tritanopia")}
    low = min(des, key=des.get)
    print(f"  hair {ap:8} {fg} on mint.tint {bg}: {ratio:.2f}:1, ΔE00 " + ", ".join(f"{k} {v:.1f}" for k, v in des.items()), file=sys.stderr)
    if ratio < min_ratio or des[low] < min_de:
        sys.exit(f"export-avatar: hair {fg} on mint.tint {bg} ({ap}) is {ratio:.2f}:1, {low} ΔE00 {des[low]:.1f}; "
                 f"the floors are {min_ratio}:1 and {min_de}")
    hair.append(f"{ap} {ratio:.2f}:1 (lowest ΔE00 {des[low]:.1f}, {low})")
print(f"{worst:.1f}")
print("; ".join(hair))
PY
)"
palette_line="$(sed -n 1p <<<"$colour_lines")"
hair_line="$(sed -n 2p <<<"$colour_lines")"
echo "palette: every face colour is at least CIEDE2000 $palette_line from every status fill in the appearances it shows in (floor $MIN_DE)"
echo "hair on mint.tint: $hair_line (floors $HAIR_MIN_RATIO:1, ΔE00 $HAIR_MIN_DE)"

echo "== 2. PDFs"
for id in "${LAYERS[@]}"; do
  rsvg-convert -f pdf --dpi-x 72 --dpi-y 72 -o "$WORK/pdf/Debbie-$id.pdf" "$WORK/layers/$id.svg"
done
for r in ${renditions[@]+"${renditions[@]}"}; do
  read -r id ap <<<"$r"
  rsvg-convert -f pdf --dpi-x 72 --dpi-y 72 -o "$WORK/pdf/Debbie-$id-$ap.pdf" "$WORK/layers/$ap/$id.svg"
done
"$TOOL" pdfsize "$WORK"/pdf/*.pdf

echo "== 3. imagesets"
[[ -f "$CATALOG/Contents.json" ]] || { echo "export-avatar: $CATALOG is missing" >&2; exit 1; }
for id in "${LAYERS[@]}"; do
  set_dir="$WORK/stage/Debbie-$id.imageset"
  mkdir -p "$set_dir"
  cp "$WORK/pdf/Debbie-$id.pdf" "$set_dir/"
  aps=()
  for r in ${renditions[@]+"${renditions[@]}"}; do
    read -r rid ap <<<"$r"
    [[ "$rid" == "$id" ]] || continue
    cp "$WORK/pdf/Debbie-$id-$ap.pdf" "$set_dir/"
    aps+=("$ap")
  done
  python3 -I - "$set_dir" "Debbie-$id" ${aps[@]+"${aps[@]}"} <<'PY'
import json, os, sys
set_dir, name, *aps = sys.argv[1:]
# The same "appearances" entries welcome.imageset uses.
traits = {"dark": [("luminosity", "dark")], "lightHC": [("contrast", "high")],
          "darkHC": [("luminosity", "dark"), ("contrast", "high")]}
images = [{"filename": f"{name}.pdf", "idiom": "universal"}]
for ap in aps:
    images.append({"filename": f"{name}-{ap}.pdf", "idiom": "universal",
                   "appearances": [{"appearance": a, "value": v} for a, v in traits[ap]]})
doc = {"images": images, "info": {"author": "xcode", "version": 1},
       "properties": {"preserves-vector-representation": True, "template-rendering-intent": "original"}}
with open(os.path.join(set_dir, "Contents.json"), "w", encoding="utf-8") as f:
    json.dump(doc, f, indent=2)
    f.write("\n")
PY
done
# Swap each finished imageset in whole, so a build running alongside never sees a half-written one.
for id in "${LAYERS[@]}"; do
  rm -rf "$CATALOG/Debbie-$id.imageset"
  mv "$WORK/stage/Debbie-$id.imageset" "$CATALOG/"
done
echo "wrote ${#LAYERS[@]} imagesets: Debbie-${LAYERS[0]} … Debbie-${LAYERS[${#LAYERS[@]}-1]}; appearance renditions: $rendition_names"

echo "== 5. actool"
if ! xcrun actool "$CATALOG" --compile "$WORK/actool" --platform iphoneos --minimum-deployment-target 26.0 \
     --output-format human-readable-text --errors --warnings --notices > "$WORK/actool.log" 2>&1; then
  cat "$WORK/actool.log"; echo "export-avatar: actool failed" >&2; exit 1
fi
if grep -qiE "error|warning" "$WORK/actool.log"; then
  cat "$WORK/actool.log"; echo "export-avatar: actool reported errors or warnings" >&2; exit 1
fi
xcrun assetutil --info "$WORK/actool/Assets.car" > "$WORK/assetutil.json"
compiled="$(python3 -I - "$WORK/assetutil.json" ${renditions[@]+"${renditions[@]}"} <<'PY'
import json, sys
entries = [e for e in json.load(open(sys.argv[1], encoding="utf-8")) if e.get("Name", "").startswith("Debbie-")]
car = {"dark": "UIAppearanceDark", "lightHC": "UIAppearanceHighContrastAny", "darkHC": "UIAppearanceHighContrastDark"}
for pair in sys.argv[2:]:
    layer, ap = pair.split()
    name, file = f"Debbie-{layer}", f"Debbie-{layer}-{ap}.pdf"
    if not any(e["Name"] == name and e.get("RenditionName") == file and e.get("Appearance") == car[ap]
               and e.get("AssetType") == "Vector" for e in entries):
        sys.exit(f"export-avatar: Assets.car has no vector {car[ap]} rendition {file} for {name}")
print(len(entries))
PY
)"
[[ "$compiled" -ge "${#LAYERS[@]}" ]] || { echo "export-avatar: only $compiled Debbie renditions in Assets.car" >&2; exit 1; }
echo "actool: 0 errors, 0 warnings; Assets.car holds $compiled Debbie-* renditions, every appearance rendition among them (log: $WORK/actool.log)"

echo "== 6. review sheet"
"$TOOL" blink "$CATALOG" "$APP_SRC"
note="Checks (export-avatar.sh): nothing leaves the 200 x 200 canvas; the body ends on the r = 100 crop circle; the tilting layers reach at most ${reach[0]} (rest), ${reach[1]} (-3°) and ${reach[2]} (+3°) from the crop centre, limit $HEAD_LIMIT; at rest they clear the 30 pt tab's selected ring (limit $TAB_RING_LIMIT); 'deep' never forms the outer silhouette."
note+="|Face colours: at least CIEDE2000 $palette_line from every urgent, caution and live fill, pressed included, in every appearance each shows in (base colours: all four; appearance colours: their own) (CRAFT.md C5)."
note+="|Hair on mint.tint: $hair_line. Floors $HAIR_MIN_RATIO:1 and ΔE00 $HAIR_MIN_DE in every vision. Brows keep the light hair colour: they sit on skin."
note+="|actool (iphoneos, iOS 26.0): 0 errors, 0 warnings; $compiled Debbie-* renditions compiled. Appearance renditions in Assets.car: $rendition_names."
"$TOOL" sheet "$CATALOG" "$SRC" "$REVIEW/debbie.png" "$note" "$APP_SRC"
echo "done: $REVIEW/debbie.png"
