#!/usr/bin/env python3
"""Designer kit helper for Debbie's avatar and the illustrations (used only by tools/design/kit/icons-debbie.sh).

Standard library only. Run from the repo root with python3 -I. Nothing here ships in the app.

  check-app <DebbieAvatar.swift> <Tokens.swift> <Components.swift> <out.json> <out-IdlePose.swift>
      Reads the app's own avatar code and fails if it no longer has the shape this kit reproduces (body breathing
      from the bottom, head tilt around a UnitPoint, head lift, the blink squash, the circle crop, 30 fps). Writes
      the numbers it read (JSON) and the IdlePose struct, copied verbatim, so the idle render runs the app's code.
  layers <src.svg> <kit-debbie-dir>
      Writes source/debbie.svg (the source plus a designer header), source/debbie-layered.svg (all nine layers as
      named groups with inline colours) and layers/svg/NN-<layer>.svg (one layer each on the full 200 x 200 canvas).
  statics <src.svg> <app.json> <mint-tint-hex> <out-dir>
      Composite SVGs for the renders: rest and eyes closed, on transparent and on the mint.tint circle.
  frames <src.svg> <app.json> <mint-tint-hex> <poses.csv> <out-transparent> <out-on-circle> <kit-csv>
      One composite SVG per idle frame (transparent, and on the mint.tint circle over white), plus the
      designer's per-frame pose table.
  art <colors.json> <name>:<shipped.svg>:<token-source.svg> ...
      Compares each shipped illustration with its token source resolved against today's colors.json, and prints
      every colour that differs (the kit ships what the app ships).
"""
import csv
import json
import os
import re
import sys

LAYERS = ["body", "hair-back", "head", "cheeks", "eyes-open", "eyes-closed", "brows", "mouth", "hair-front"]
HEAD = LAYERS[1:]          # everything above the body tilts around the neck
CANVAS = 200.0             # the avatar's canvas, in SVG units

# What each layer holds and what each palette class colours (for the designer's header comment and the docs).
LAYER_NOTES = {
    "body": "neck, neck shadow, mint top and the dark-green collar. Never tilts; it breathes",
    "hair-back": "the bun and the dark hair mass behind the head",
    "head": "ear, face, nose and the two lid creases",
    "cheeks": "two soft cheek ovals",
    "eyes-open": "two plain dark rounds, no white",
    "eyes-closed": "the blink frame: closed lids (hidden at rest)",
    "brows": "two brows",
    "mouth": "a closed smile",
    "hair-front": "the fringe and the side hair that frame the face",
}
CLASS_NOTES = {
    "mint": "top (= mint.fill)",
    "collar": "crew neckline (= accent.text)",
    "skin": "face, ear, neck",
    "shade": "neck shadow, inner ear, nose, lid creases",
    "cheek": "cheeks",
    "hair": "bun, fringe, side hair, brows",
    "deep": "back hair, open eyes, closed lids",
    "lip": "mouth",
}


def fail(msg):
    sys.stderr.write(f"icons-debbie-avatar: {msg}\n")
    sys.exit(1)


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def write(path, text):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def num(v):
    """Compact, exact-enough number for SVG output."""
    s = format(v, ".9f").rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


# ---------------------------------------------------------------------------------------------------------------
# The app's avatar code

def extract_struct(text, name):
    start = text.find(f"struct {name}")
    if start < 0:
        fail(f"DebbieAvatar.swift has no struct {name}")
    # Back up to the start of the line, so a doc comment directly above stays out but the declaration is whole.
    line_start = text.rfind("\n", 0, start) + 1
    depth, i, opened = 0, start, False
    while i < len(text):
        if text.startswith("//", i):          # skip line comments: braces in prose must not count
            i = text.find("\n", i)
            if i < 0:
                break
            continue
        c = text[i]
        if c == "{":
            depth += 1
            opened = True
        elif c == "}":
            depth -= 1
            if opened and depth == 0:
                return text[line_start:i + 1]
        i += 1
    fail(f"could not find the end of struct {name}")


def check_app(avatar_swift, tokens_swift, components_swift, out_json, out_swift):
    src = read(avatar_swift)
    tokens = read(tokens_swift)
    comps = read(components_swift)

    def need(key, pattern, text=src, flags=re.S):
        m = re.search(pattern, text, flags)
        if not m:
            fail(f"{key}: the avatar code changed shape (pattern {pattern!r} not found); update this kit helper "
                 f"so the renders still reproduce the app")
        return m

    need("body breathing", r'layer\("body"\)\.scaleEffect\(pose\.breath,\s*anchor:\s*\.bottom\)')
    rot = need("head tilt", r'\.rotationEffect\(\.degrees\(pose\.tilt\),\s*anchor:\s*UnitPoint\(x:\s*([0-9.]+),\s*y:\s*([0-9.]+)\)\)')
    need("head lift", r'\.rotationEffect\([^\n]*\)\s*\.offset\(y:\s*pose\.lift\s*\*\s*size\)')
    sq = need("blink squash", r'layer\("eyes-open"\)\.scaleEffect\(x:\s*1,\s*y:\s*state\s*==\s*\.squash\s*\?\s*([0-9.]+)\s*:\s*1,'
                              r'\s*anchor:\s*UnitPoint\(x:\s*([0-9.]+),\s*y:\s*([0-9.]+)\)\)')
    need("closed frame", r'if state == \.closed \{\s*layer\("eyes-closed"\)')
    fps = need("frame rate", r'TimelineView\(\.animation\(minimumInterval:\s*1\.0\s*/\s*([0-9.]+)')
    need("circle crop", r'\.background\(Color\.dMintTint,\s*in:\s*Circle\(\)\)\s*\.clipShape\(Circle\(\)\)')
    need("reduce motion", r'if motion\.reduce \|\| !lively \{\s*face\(IdlePose\.rest\)')
    lively = need("lively sizes", r'self\.lively = lively \?\? \(size >= Size\.(\w+)\)')
    need("head order", r'ZStack \{\s*layer\("hair-back"\)\s*layer\("head"\)\s*layer\("cheeks"\)\s*eyes\(pose\.eyes\)\s*'
                       r'layer\("brows"\)\s*layer\("mouth"\)\s*layer\("hair-front"\)\s*\}')
    badge = need("badge view size", r'DebbieAvatar\(size:\s*Size\.avatarHero\s*\*\s*([0-9.]+)\)')

    def token(name):
        m = re.search(r"\b" + name + r"\s*:\s*CGFloat\s*=\s*([0-9.]+)", tokens)
        if not m:
            fail(f"Tokens.swift has no {name}")
        return float(m.group(1))

    sizes = {k: token(k) for k in ("tabAvatar", "avatarSmall", "avatarGuide", "avatarHero")}
    empty = re.search(r'DArt\(art\)\.frame\(maxHeight:\s*([0-9.]+)\)', comps)
    if not empty:
        fail("Components.swift: DEmptyState's art height not found")

    struct = extract_struct(src, "IdlePose")
    for needle in ("init(at date: Date)", "static func eyes(at t: TimeInterval)", "private static func hash"):
        if needle not in struct:
            fail(f"IdlePose no longer has {needle}")
    write(out_swift, "// Copied verbatim from Packages/DebbieKit/Sources/DebbieDesignSystem/Persona/DebbieAvatar.swift by\n"
                     "// tools/design/kit/icons-debbie-avatar.py (check-app), so the kit's idle render runs the app's own code.\n"
                     "import CoreGraphics\nimport Foundation\n\n" + struct + "\n")
    data = {
        "bodyAnchor": [0.5, 1.0],                       # .bottom
        "headAnchor": [float(rot.group(1)), float(rot.group(2))],
        "squash": float(sq.group(1)),
        "squashAnchor": [float(sq.group(2)), float(sq.group(3))],
        "fps": float(fps.group(1)),
        "livelyFrom": lively.group(1),
        "sizes": sizes,
        "badgeScale": float(badge.group(1)),
        "welcomeArt": token("welcomeArt"),
        "emptyStateArtHeight": float(empty.group(1)),
    }
    write(out_json, json.dumps(data, indent=2) + "\n")
    print("app code: body breathes from the bottom; head tilts around UnitPoint(%g, %g) and lifts with the breath; "
          "blink squash %g around UnitPoint y %g; %g fps; idle from Size.%s; sizes %s; badge view %g x hero"
          % (data["headAnchor"][0], data["headAnchor"][1], data["squash"], data["squashAnchor"][1], data["fps"],
             data["livelyFrom"], ", ".join(f"{k} {v:g}" for k, v in sizes.items()), data["badgeScale"]))


# ---------------------------------------------------------------------------------------------------------------
# The layered source

def load_avatar(path):
    """The layered source, read with regular expressions: it is a flat list of <g id> layers holding self-closing
    shapes (Design/scripts/avatar.swift validates that on every export), and this Python's XML parser may be
    unavailable (a Homebrew python3 whose pyexpat can't load). Anything unexpected fails loudly."""
    text = read(path)
    style = re.search(r"<style>(.*?)</style>", text, re.S)
    if not style:
        fail(f"{path} has no <style> palette")
    entries = re.findall(r"\.([A-Za-z][\w-]*)\s*\{\s*fill\s*:\s*(#[0-9A-Fa-f]{6})\s*;?\s*\}", style.group(1))
    # Appearance variants (hair-dark, deep-darkHC ...) only apply to dark renditions; the app is light only (D-032).
    names = {n for n, _ in entries}
    base, variants = {}, {}
    for n, h in entries:
        suffix = next((ap for ap in ("darkHC", "lightHC", "dark") if n.endswith("-" + ap) and n[: -len(ap) - 1] in names), None)
        (variants if suffix else base)[n] = h.upper()
    body = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    root = re.search(r"<svg\b([^>]*)>", body)
    if not root or 'viewBox="0 0 200 200"' not in root.group(1):
        fail("the avatar's root must be <svg viewBox=\"0 0 200 200\">")
    groups = {}
    for m in re.finditer(r"<g\b([^>]*)>(.*?)</g>", body, re.S):
        gid = re.search(r'\bid="([^"]*)"', m.group(1))
        if not gid or "<g" in m.group(2):
            fail("every layer is one <g id> with no nested groups")
        items = []
        for e in re.finditer(r"<(\w+)\b([^>]*?)\s*/>", m.group(2)):
            items.append((e.group(1), re.findall(r'([\w:-]+)="([^"]*)"', e.group(2))))
        leftover = re.sub(r"<(\w+)\b([^>]*?)\s*/>", "", m.group(2)).strip()
        if leftover:
            fail(f"layer {gid.group(1)} holds something other than self-closing shapes: {leftover[:60]!r}")
        groups[gid.group(1)] = items
    if list(groups) != LAYERS:
        fail(f"layer groups must be {LAYERS}; found {list(groups)}")
    return text, base, variants, groups


def shapes(items, palette, indent, layer="?"):
    out = []
    for tag, attrs in items:
        if tag not in ("path", "circle", "ellipse", "rect"):
            fail(f"unexpected <{tag}> in layer {layer}")
        cls = dict(attrs).get("class")
        if cls not in palette:
            fail(f"class {cls!r} in layer {layer} is not a base palette colour")
        kept = " ".join(f'{k}="{v}"' for k, v in attrs if k != "class")
        out.append(f'{indent}<{tag} {kept} fill="{palette[cls]}"/>')
    return "\n".join(out)


def layers_cmd(src, kit):
    text, base, variants, groups = load_avatar(src)
    order = ", ".join(LAYERS)
    pal_lines = "\n".join(f"      {n:<7} {h}  {CLASS_NOTES.get(n, '')}" for n, h in base.items())
    var_lines = ", ".join(f"{n} {h}" for n, h in variants.items()) or "none"
    layer_lines = "\n".join(f"      {i + 1:02d}  {n:<12} {LAYER_NOTES.get(n, '')}" for i, n in enumerate(LAYERS))
    header = f"""  <!--
    DESIGNER KIT COPY. The source of truth is Design/avatar/src/debbie.svg; tools/design/kit/icons-debbie.sh rewrites
    this copy, so edit the source, not this file. The engineering notes below this comment are the source's own.

    Layer ids: each top-level <g id> is one layer on the same 200 x 200 canvas, so the layers stack exactly.
    Bottom to top (the number is the file prefix in ../layers/):
{layer_lines}
    eyes-closed is hidden here (display="none"): it replaces eyes-open only during a blink.
    Head pivot: (100, 150), the neck centre. Layers 02-09 tilt around it; 01 body does not.
    Circle crop: the app clips her to the inscribed circle, centre (100, 100), radius 100, on mint.tint #DDF5EA.

    Palette: the classes in the <style> block below (light; the app is light only, D-032):
{pal_lines}
    Dark-appearance colours, kept for reference only (they are not used while the app is light only):
      {var_lines}
  -->
"""
    first = text.index(">", text.index("<svg")) + 1
    write(os.path.join(kit, "source", "debbie.svg"), text[:first] + "\n" + header + text[first:].lstrip("\n"))

    # All nine layers as named groups with inline colours (Figma and Illustrator keep the group names).
    parts = []
    for i, n in enumerate(LAYERS):
        extra = ' opacity="0"' if n == "eyes-closed" else ""
        parts.append(f'  <g id="{i + 1:02d}-{n}"{extra}>\n{shapes(groups[n], base, "    ", n)}\n  </g>')
    layered = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">\n'
               f"  <!-- Debbie, all nine layers as named groups, bottom to top, with inline light colours (designer kit).\n"
               f"       Generated from Design/avatar/src/debbie.svg by tools/design/kit/icons-debbie.sh.\n"
               f"       06-eyes-closed is at 0 % opacity: show it (and hide 05-eyes-open) for the blink's closed frame.\n"
               f"       Pivot for the head tilt: (100, 150). The app clips her to the circle centre (100, 100), r 100. -->\n"
               + "\n".join(parts) + "\n</svg>\n")
    write(os.path.join(kit, "source", "debbie-layered.svg"), layered)

    for i, n in enumerate(LAYERS):
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">\n'
               f"  <!-- Debbie layer {i + 1:02d} of {len(LAYERS):02d}: {n} ({LAYER_NOTES.get(n, '')}).\n"
               f"       Full 200 x 200 canvas, so every layer stacks exactly. Order, bottom to top: {order}.\n"
               f"       Generated from Design/avatar/src/debbie.svg by tools/design/kit/icons-debbie.sh. -->\n"
               f'  <g id="{n}">\n{shapes(groups[n], base, "    ", n)}\n  </g>\n</svg>\n')
        write(os.path.join(kit, "layers", "svg", f"{i + 1:02d}-{n}.svg"), svg)
    print(f"layers: {len(LAYERS)} layer SVGs, the layered SVG and the annotated source copy; palette: "
          + ", ".join(f"{n} {h}" for n, h in base.items()))


# ---------------------------------------------------------------------------------------------------------------
# Composites (the way DebbieAvatar stacks the layers)

def composite(groups, palette, app, *, eyes="open", breath=1.0, tilt=0.0, lift=0.0, circle=None, background=None,
              pixels=1024):
    bx, by = app["bodyAnchor"][0] * CANVAS, app["bodyAnchor"][1] * CANVAS
    hx, hy = app["headAnchor"][0] * CANVAS, app["headAnchor"][1] * CANVAS
    sy = app["squashAnchor"][1] * CANVAS
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="{pixels}" height="{pixels}">',
           '  <defs><clipPath id="crop"><circle cx="100" cy="100" r="100"/></clipPath></defs>']
    if background:
        out.append(f'  <rect width="200" height="200" fill="{background}"/>')
    if circle:
        out.append(f'  <circle cx="100" cy="100" r="100" fill="{circle}"/>')
    out.append('  <g clip-path="url(#crop)">')
    body = shapes(groups["body"], palette, "      ", "body")
    if breath != 1.0:
        out.append(f'    <g transform="translate({num(bx)} {num(by)}) scale({num(breath)}) translate({num(-bx)} {num(-by)})">\n{body}\n    </g>')
    else:
        out.append(f"    <g>\n{body}\n    </g>")
    head_t = []
    if lift:
        head_t.append(f"translate(0 {num(lift * CANVAS)})")
    if tilt:
        head_t.append(f"rotate({num(tilt)} {num(hx)} {num(hy)})")
    out.append(f'    <g transform="{" ".join(head_t)}">' if head_t else "    <g>")
    for n in HEAD:
        if n == "eyes-open" and eyes == "closed":
            continue
        if n == "eyes-closed" and eyes != "closed":
            continue
        s = shapes(groups[n], palette, "        ", n)
        if n == "eyes-open" and eyes == "squash":
            f = app["squash"]
            out.append(f'      <g transform="translate(0 {num(sy)}) scale(1 {num(f)}) translate(0 {num(-sy)})">\n{s}\n      </g>')
        else:
            out.append(f"      <g>\n{s}\n      </g>")
    out.append("    </g>")
    out.append("  </g>")
    out.append("</svg>")
    return "\n".join(out) + "\n"


def statics_cmd(src, app_json, mint_tint, out_dir):
    _, base, _, groups = load_avatar(src)
    app = json.loads(read(app_json))
    for pose in ("rest", "eyes-closed"):
        eyes = "closed" if pose == "eyes-closed" else "open"
        write(os.path.join(out_dir, f"{pose}-transparent.svg"), composite(groups, base, app, eyes=eyes))
        write(os.path.join(out_dir, f"{pose}-on-mint-circle.svg"), composite(groups, base, app, eyes=eyes, circle=mint_tint))
    print(f"statics: rest and eyes-closed composites, transparent and on mint.tint {mint_tint}")


def frames_cmd(src, app_json, mint_tint, poses_csv, out_t, out_c, kit_csv):
    _, base, _, groups = load_avatar(src)
    app = json.loads(read(app_json))
    rows = list(csv.DictReader(open(poses_csv, encoding="utf-8")))
    if not rows:
        fail("no poses")
    lines = ["frame,time_s,body_scale_pct,head_tilt_deg,head_offset_y_px_at_1024,eyes_layer,eyes_open_scale_y_pct"]
    for r in rows:
        i = int(r["frame"])
        breath, tilt, lift, eyes = float(r["breath"]), float(r["tilt"]), float(r["lift"]), r["eyes"]
        kw = dict(eyes=eyes, breath=breath, tilt=tilt, lift=lift)
        write(os.path.join(out_t, f"{i:04d}.svg"), composite(groups, base, app, **kw))
        write(os.path.join(out_c, f"{i:04d}.svg"), composite(groups, base, app, circle=mint_tint, background="#FFFFFF", **kw))
        lines.append(",".join([str(i), f"{float(r['t']):.4f}", f"{breath * 100:.4f}", f"{tilt:.4f}",
                               f"{lift * 1024:.4f}", "closed" if eyes == "closed" else "open",
                               f"{app['squash'] * 100:g}" if eyes == "squash" else "100"]))
    write(kit_csv, "\n".join(lines) + "\n")
    print(f"frames: {len(rows)} frame SVGs per background; pose table {kit_csv}")


# ---------------------------------------------------------------------------------------------------------------
# Illustrations: what ships against today's tokens

def art_cmd(colors_json, specs):
    tokens = json.loads(read(colors_json))["tokens"]
    for spec in specs:
        name, shipped, source = spec.split(":")
        src = read(source)
        resolved = re.sub(r"\{([a-z]+(?:\.[a-zA-Z]+)+)\}", lambda m: tokens[m.group(1)]["light"], src)
        if resolved.strip() == read(shipped).strip():
            print(f"art {name}: the shipped light SVG matches its source resolved with today's tokens")
            continue
        placeholders = re.findall(r'(fill|stroke)="\{([^}]+)\}"', src)
        ship_cols = re.findall(r'(fill|stroke)="(#[0-9A-Fa-f]{6})"', read(shipped))
        diffs = sorted({f"{tok} ships {got.upper()}, today's token is {tokens[tok]['light'].upper()}"
                        for (_, tok), (_, got) in zip(placeholders, ship_cols)
                        if got.upper() != tokens[tok]["light"].upper()})
        print(f"art {name}: the shipped SVG differs from its source resolved today: " + "; ".join(diffs))


def main(argv):
    if len(argv) < 2:
        fail(__doc__)
    cmd, args = argv[1], argv[2:]
    if cmd == "check-app" and len(args) == 5:
        check_app(*args)
    elif cmd == "layers" and len(args) == 2:
        layers_cmd(*args)
    elif cmd == "statics" and len(args) == 4:
        statics_cmd(*args)
    elif cmd == "frames" and len(args) == 7:
        frames_cmd(*args)
    elif cmd == "art" and len(args) >= 2:
        art_cmd(args[0], args[1:])
    else:
        fail(__doc__)


if __name__ == "__main__":
    main(sys.argv)
