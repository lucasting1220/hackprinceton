#!/usr/bin/env python3
"""Checks DesignerKit/08-components/components.md against the code it describes.

Run from the repo root:  python3 -I tools/design/kit/components.py
Exit 1 on any mismatch. Read-only: it writes nothing.

1. Every colour written as `token` #HEX (and every cheat-sheet row) matches Design/tokens/colors.json
   (the light value, or the light Increase Contrast value).
2. Every spring and fade in the motion tables matches Packages/.../Motion/Motion.swift.
3. The gallery's sections (App/DebbieDebugTools/DebbieGallery.swift), the capture test's list
   (UITests/GalleryUITests.swift) and the renders the doc names are the same set, with no duplicates.
4. Every public component in DebbieDesignSystem and DebbieCareScreens is named in the doc.
"""
import json
import pathlib
import re
import sys

DOC = pathlib.Path("DesignerKit/08-components/components.md")
COLORS = pathlib.Path("Design/tokens/colors.json")
MOTION = pathlib.Path("Packages/DebbieKit/Sources/DebbieDesignSystem/Motion/Motion.swift")
GALLERY = pathlib.Path("App/DebbieDebugTools/DebbieGallery.swift")
TEST = pathlib.Path("UITests/GalleryUITests.swift")
COMPONENT_DIRS = [pathlib.Path("Packages/DebbieKit/Sources/DebbieDesignSystem"),
                  pathlib.Path("Packages/DebbieKit/Sources/DebbieCareScreens")]
# Public types that aren't components a designer draws, with the reason.
NOT_COMPONENTS = {
    "MotionPolicy": "an environment value (Reduce Motion), not a view",
    "MotionPolicyReader": "a modifier that reads Reduce Motion",
    "IconPose": "one step inside an icon effect",
    "HomeStatusDetailView": "a pushed screen kept for Layer 4; the app doesn't show it",
    "HistoryView": "a pushed screen kept for Layer 4; the app shows History as a tab",
}

problems = []


def fail(msg):
    problems.append(msg)


def main():
    for p in (DOC, COLORS, MOTION, GALLERY, TEST):
        if not p.exists():
            print(f"✗ missing {p} (run from the repo root)")
            return 1
    doc = DOC.read_text()
    tokens = json.loads(COLORS.read_text())["tokens"]

    # 1. Colours.
    checked = 0
    for line in doc.splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")] if line.startswith("|") else []
        m = re.fullmatch(r"`([a-z]+(?:\.[A-Za-z]+)+)`", cells[0]) if cells else None
        if m and m.group(1) in tokens and len(cells) >= 4 and re.fullmatch(r"#[0-9A-F]{6}", cells[2]):
            t = tokens[m.group(1)]
            if cells[2] != t["light"]:
                fail(f"cheat sheet {m.group(1)}: light {cells[2]} != {t['light']}")
            if cells[3] != t["lightHC"]:
                fail(f"cheat sheet {m.group(1)}: IC {cells[3]} != {t['lightHC']}")
            checked += 1
            continue
        for name, hexv in re.findall(r"`([a-z]+(?:\.[A-Za-z]+)+)`[^`|\n#]{0,40}?(#[0-9A-Fa-f]{6})", line):
            if name not in tokens:
                continue
            t = tokens[name]
            if hexv.upper() not in (t["light"], t["lightHC"]):
                fail(f"`{name}` {hexv}: expected {t['light']} (IC {t['lightHC']}) in: {line.strip()[:110]}")
            checked += 1
    print(f"{'✓' if not problems else '✗'} colours: {checked} token/hex pairs checked against {COLORS}")

    # 2. Motion.
    before = len(problems)
    src = MOTION.read_text()
    springs = {n: (float(d), float(b)) for n, d, b in
               re.findall(r"static let (\w+)Spring = Spring\(duration: ([\d.]+), bounce: ([\d.]+)\)", src)}
    fades = {n: (curve, float(d)) for n, curve, d in
             re.findall(r"static let (\w+) = Animation\.(\w+)\(duration: ([\d.]+)\)", src)}
    curve_words = {"easeInOut": "ease in-out", "easeOut": "ease out", "easeIn": "ease in", "linear": "linear"}
    motion_rows = 0
    for line in doc.splitlines():
        m = re.match(r"\| `Motion\.(\w+)` \| spring \| ([\d.]+) s \| ([\d.]+) \|", line)
        if m:
            name, d, b = m.group(1), float(m.group(2)), float(m.group(3))
            if springs.get(name) != (d, b):
                fail(f"Motion.{name}: doc says {d} s / {b}, code says {springs.get(name)}")
            motion_rows += 1
            continue
        m = re.match(r"\| `Motion\.(\w+)` \| ([a-z -]+) \| ([\d.]+) s", line)
        if m and m.group(1) in fades:
            curve, d = fades[m.group(1)]
            if (curve_words.get(curve), d) != (m.group(2), float(m.group(3))):
                fail(f"Motion.{m.group(1)}: doc says {m.group(2)} {m.group(3)} s, code says {curve} {d} s")
            motion_rows += 1
    missing = set(springs) - {m for m in re.findall(r"\| `Motion\.(\w+)` \| spring", doc)}
    if missing:
        fail(f"springs missing from the motion table: {sorted(missing)}")
    print(f"{'✓' if len(problems) == before else '✗'} motion: {motion_rows} rows checked against {MOTION}")

    # 3. Sections, test list and renders.
    before = len(problems)
    gallery_src = GALLERY.read_text()
    gallery = re.findall(r'(?:GallerySection\(|ButtonLadder\(name: |StatusHeaderSection\(name: )"([a-z0-9-]+)"', gallery_src)
    body = re.search(r"static let sections = \[(.*?)\]", TEST.read_text(), re.S)
    test = re.findall(r'"([a-z0-9-]+)"', body.group(1)) if body else []
    renders = set(re.findall(r"renders/(?:increase-contrast/)?([a-z0-9-]+)\.png", doc))
    for label, names in (("gallery", gallery), ("GalleryUITests.sections", test)):
        dupes = sorted({n for n in names if names.count(n) > 1})
        if dupes:
            fail(f"{label} has duplicates: {dupes}")
    if set(gallery) != set(test):
        fail(f"gallery vs test: only in gallery {sorted(set(gallery) - set(test))}, only in test {sorted(set(test) - set(gallery))}")
    if renders != set(test):
        fail(f"doc renders vs test: only in doc {sorted(renders - set(test))}, never named in doc {sorted(set(test) - renders)}")
    print(f"{'✓' if len(problems) == before else '✗'} sections: {len(set(gallery))} in the gallery, "
          f"{len(test)} in the test, {len(renders)} named in the doc")

    # 4. Coverage.
    before = len(problems)
    public = set()
    for d in COMPONENT_DIRS:
        for f in d.rglob("*.swift"):
            public |= set(re.findall(r"public struct (\w+)", f.read_text()))
    unnamed = sorted(n for n in public - set(NOT_COMPONENTS) if not re.search(rf"\b{n}\b", doc))
    if unnamed:
        fail(f"public components the doc never names: {unnamed}")
    print(f"{'✓' if len(problems) == before else '✗'} coverage: {len(public) - len(NOT_COMPONENTS)} public components, "
          f"{len(NOT_COMPONENTS)} non-visual types skipped")

    for p in problems:
        print(f"   ✗ {p}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
