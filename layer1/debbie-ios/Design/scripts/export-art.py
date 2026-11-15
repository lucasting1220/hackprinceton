#!/usr/bin/env python3
"""Export Debbie's illustrations and brand art from token-coloured SVG sources.

Sources use colour placeholders instead of literal colours, e.g. fill="{mint.fill}",
stroke="{text.secondary}". Each placeholder is a token name from
Design/tokens/colors.json. For every source this script writes an imageset with
four SVG variants (light, dark, light + Increase Contrast, dark + Increase
Contrast), so art follows the same tokens as the UI (CRAFT.md §2.7 IL3/IL6,
§2.8 B2). It also writes the LaunchBackground colour set (= bg.canvas) used by
UILaunchScreen (CRAFT.md §2.8 B5), and renders every variant to PNG with
rsvg-convert for review.

Usage (from the repo root):
  python3 -I Design/scripts/export-art.py
Inputs:  Design/illustrations/src/*.svg, Design/brand/*.svg (brand art may use a
         single placeholder {ink}, exported as a template image instead).
Outputs: Packages/DebbieKit/Sources/DebbieDesignSystem/Resources/Art.xcassets,
         App/Assets.xcassets/LaunchBackground.colorset,
         Design/reviews/art/<name>.png (light/dark/IC side by side).
"""
import json
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
TOKENS = os.path.join(ROOT, "Design", "tokens", "colors.json")
ART_SRC = os.path.join(ROOT, "Design", "illustrations", "src")
BRAND_SRC = os.path.join(ROOT, "Design", "brand")
CATALOG = os.path.join(ROOT, "Packages", "DebbieKit", "Sources", "DebbieDesignSystem", "Resources", "Art.xcassets")
APP_ASSETS = os.path.join(ROOT, "App", "Assets.xcassets")
REVIEW = os.path.join(ROOT, "Design", "reviews", "art")
APPEARANCES = [
    ("light", []),
    ("dark", [{"appearance": "luminosity", "value": "dark"}]),
    ("lightHC", [{"appearance": "contrast", "value": "high"}]),
    ("darkHC", [{"appearance": "luminosity", "value": "dark"}, {"appearance": "contrast", "value": "high"}]),
]
PLACEHOLDER = re.compile(r"\{([a-z]+(?:\.[a-zA-Z]+)+)\}")
FORBIDDEN_HUES = ("caution.", "urgent.", "live.")  # CRAFT.md C5 / IL3: no decorative amber, red or indigo


def load_tokens():
    with open(TOKENS, encoding="utf-8") as fh:
        return json.load(fh)["tokens"]


def resolve(tokens, name, appearance):
    t = tokens.get(name)
    if t is None:
        raise SystemExit(f"unknown colour token {{{name}}}")
    v = t.get(appearance) or (t.get(appearance[:-2]) if appearance.endswith("HC") else None)
    if v is None:
        raise SystemExit(f"token {name} has no {appearance} value")
    return v


def write_json(path, obj):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=2)
        fh.write("\n")


def ensure_catalog(path):
    os.makedirs(path, exist_ok=True)
    contents = os.path.join(path, "Contents.json")
    if not os.path.exists(contents):
        write_json(contents, {"info": {"author": "xcode", "version": 1}})


def export_illustration(tokens, src_path):
    name = os.path.splitext(os.path.basename(src_path))[0]
    with open(src_path, encoding="utf-8") as fh:
        svg = fh.read()
    used = set(PLACEHOLDER.findall(svg))
    bad = [u for u in used if u.startswith(FORBIDDEN_HUES)]
    if bad:
        raise SystemExit(f"{name}: illustrations may not use {bad} (CRAFT.md C5, IL3)")
    if re.search(r'#[0-9a-fA-F]{3,8}\b', PLACEHOLDER.sub("", svg)):
        raise SystemExit(f"{name}: literal colour found; use {{token}} placeholders only")
    iset = os.path.join(CATALOG, f"{name}.imageset")
    shutil.rmtree(iset, ignore_errors=True)
    os.makedirs(iset)
    images = []
    pngs = []
    for appearance, traits in APPEARANCES:
        out = PLACEHOLDER.sub(lambda m: resolve(tokens, m.group(1), appearance), svg)
        fname = f"{name}-{appearance}.svg"
        with open(os.path.join(iset, fname), "w", encoding="utf-8") as fh:
            fh.write(out)
        entry = {"filename": fname, "idiom": "universal"}
        if traits:
            entry["appearances"] = traits
        images.append(entry)
        png = os.path.join(REVIEW, "raw", f"{name}-{appearance}.png")
        bg = resolve(tokens, "bg.canvas", appearance)
        subprocess.run(["rsvg-convert", "-w", "480", "-b", bg, "-o", png, os.path.join(iset, fname)], check=True)
        pngs.append(f"{png}={appearance}")
    write_json(os.path.join(iset, "Contents.json"), {
        "images": images,
        "info": {"author": "xcode", "version": 1},
        "properties": {"preserves-vector-representation": True},
    })
    subprocess.run(["swift", os.path.join(ROOT, "tools", "design", "contact-sheet.swift"), "--out",
                    os.path.join(REVIEW, f"{name}.png"), "--columns", "4", "--cell", "300",
                    "--background", "#808080", "--title", f"{name}: light · dark · light IC · dark IC", *pngs],
                   check=True, stdout=subprocess.DEVNULL)
    return name


def export_brand(src_path):
    """Brand art is single-colour: exported as a vector template image tinted by tokens at runtime."""
    name = os.path.splitext(os.path.basename(src_path))[0]
    with open(src_path, encoding="utf-8") as fh:
        svg = fh.read()
    if PLACEHOLDER.search(svg):
        svg = PLACEHOLDER.sub("#000000", svg)
    iset = os.path.join(CATALOG, f"Brand-{name}.imageset")
    shutil.rmtree(iset, ignore_errors=True)
    os.makedirs(iset)
    with open(os.path.join(iset, f"{name}.svg"), "w", encoding="utf-8") as fh:
        fh.write(svg)
    write_json(os.path.join(iset, "Contents.json"), {
        "images": [{"filename": f"{name}.svg", "idiom": "universal"}],
        "info": {"author": "xcode", "version": 1},
        "properties": {"preserves-vector-representation": True, "template-rendering-intent": "template"},
    })
    return name


def export_launch_background(tokens):
    cs = os.path.join(APP_ASSETS, "LaunchBackground.colorset")
    os.makedirs(cs, exist_ok=True)
    ensure_catalog(APP_ASSETS)
    colors = []
    for appearance, traits in APPEARANCES:
        hexv = resolve(tokens, "bg.canvas", appearance).lstrip("#")
        r, g, b = (int(hexv[i:i + 2], 16) / 255 for i in (0, 2, 4))
        entry = {"idiom": "universal", "color": {"color-space": "srgb", "components": {
            "red": f"{r:.3f}", "green": f"{g:.3f}", "blue": f"{b:.3f}", "alpha": "1.000"}}}
        if traits:
            entry["appearances"] = traits
        colors.append(entry)
    write_json(os.path.join(cs, "Contents.json"), {"colors": colors, "info": {"author": "xcode", "version": 1}})


def main():
    tokens = load_tokens()
    ensure_catalog(CATALOG)
    os.makedirs(os.path.join(REVIEW, "raw"), exist_ok=True)
    done = []
    if os.path.isdir(ART_SRC):
        for f in sorted(os.listdir(ART_SRC)):
            if f.endswith(".svg"):
                done.append(export_illustration(tokens, os.path.join(ART_SRC, f)))
    brand = []
    if os.path.isdir(BRAND_SRC):
        for f in sorted(os.listdir(BRAND_SRC)):
            if f.endswith(".svg") and not f.startswith("concept-"):
                brand.append(export_brand(os.path.join(BRAND_SRC, f)))
    export_launch_background(tokens)
    print(f"illustrations: {', '.join(done) or 'none'}; brand: {', '.join(brand) or 'none'}; LaunchBackground written")
    return 0


if __name__ == "__main__":
    sys.exit(main())
