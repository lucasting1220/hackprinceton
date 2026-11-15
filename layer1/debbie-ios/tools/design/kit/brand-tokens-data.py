#!/usr/bin/env python3
"""Designer kit, part "brand-tokens": the data and docs half of the generator.

Called by tools/design/kit/brand-tokens.sh (run from the repo root); it is not meant to be run on its own.
It reads the app's own sources and writes, in DesignerKit/:
  01-brand  brand.md, svg/ (masters copied, welcome lockup generated), app-icon/ (copied review renders)
  02-color  colors.json (copy), colors.css, figma-tokens.json, debbie-colors.ase, color.md
  03-type   typography.md, type-scale.json
  04-layout layout.md, layout.json
plus, in the temporary folder given by --tmp, the render specs for brand-tokens-render.swift and the
rsvg-convert job list (rsvg-jobs.tsv) that the shell script runs.

Sources: Design/tokens/colors.json, Design/tokens/contrast-report.md, Design/brand/*.svg,
Design/scripts/app-icon.sh, App/Assets.xcassets/LaunchBackground.colorset,
Packages/DebbieKit/Sources/DebbieDesignSystem/Tokens/Tokens.swift (+ the component files it checks for drift),
and Apple's HIG Typography tables (iOS Dynamic Type sizes and tracking, embedded below with their source).
Every contrast ratio is recomputed and must equal contrast-report.md, or the run fails.
"""
import json
import math
import os
import re
import shutil
import struct
import sys

KIT = "DesignerKit"
BRAND, COLOR, TYPE, LAYOUT = (os.path.join(KIT, d) for d in ("01-brand", "02-color", "03-type", "04-layout"))
SRC_COLORS = "Design/tokens/colors.json"
SRC_REPORT = "Design/tokens/contrast-report.md"
SRC_TOKENS = "Packages/DebbieKit/Sources/DebbieDesignSystem/Tokens/Tokens.swift"
SRC_MARK = "Design/brand/mark.svg"
SRC_WORDMARK = "Design/brand/wordmark.svg"
SRC_ICON_SCRIPT = "Design/scripts/app-icon.sh"
SRC_ICON_RAW = "Design/reviews/app-icon/raw"
SRC_ICON_SET = "App/Assets.xcassets/AppIcon.appiconset"
SRC_LAUNCH = "App/Assets.xcassets/LaunchBackground.colorset/Contents.json"
DS = "Packages/DebbieKit/Sources/DebbieDesignSystem"
REGEN = "Regenerate everything in this folder with `tools/design/kit/brand-tokens.sh` (run from the repo root). Do not edit by hand."

WARNINGS = []


def warn(msg):
    WARNINGS.append(msg)
    print(f"WARNING: {msg}", file=sys.stderr)


def die(msg):
    print(f"brand-tokens-data: {msg}", file=sys.stderr)
    sys.exit(1)


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text if text.endswith("\n") else text + "\n")


def write_json(path, obj):
    write(path, json.dumps(obj, indent=2, ensure_ascii=False))


def fmt(v):
    """3.0 -> '3', 3.5 -> '3.5'."""
    return str(int(v)) if float(v).is_integer() else f"{v:g}"


def table(headers, rows):
    out = ["| " + " | ".join(headers) + " |", "|" + "|".join("---" for _ in headers) + "|"]
    out += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(out)


def code_has(path, snippet):
    """Drift check: a layout fact quoted in the docs must still be in the code."""
    if snippet not in read(path):
        warn(f"{path} no longer contains `{snippet}`; check the matching value in {LAYOUT}/layout.md")


# ---------------------------------------------------------------- colour maths (WCAG 2.x, CIELAB D65)

def hex_rgb(h):
    h = h.lstrip("#")
    if not re.fullmatch(r"[0-9A-Fa-f]{6}", h):
        die(f"bad hex #{h}")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def luminance(h):
    r, g, b = (lin(c) for c in hex_rgb(h))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = luminance(a), luminance(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def lch(h):
    r, g, b = (lin(c) for c in hex_rgb(h))
    x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047
    y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b
    z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883
    f = lambda t: t ** (1 / 3) if t > 216 / 24389 else (24389 / 27 * t + 16) / 116
    L, A, B = 116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))
    return L, math.hypot(A, B), math.degrees(math.atan2(B, A)) % 360


# ---------------------------------------------------------------- sources

def load_colors():
    data = json.loads(read(SRC_COLORS))
    tokens = data["tokens"]
    for name, t in tokens.items():
        for k in ("light", "lightHC", "dark", "darkHC"):
            t[k] = "#" + t[k].lstrip("#").upper()
    return data


def parse_report():
    text = read(SRC_REPORT)
    try:
        pairs_sec = text.split("## Pairings")[1].split("## Colour-vision")[0]
        cvd_sec = text.split("## Colour-vision separation")[1].split("## Result")[0]
    except IndexError:
        die(f"{SRC_REPORT} has an unexpected layout")
    pairs, cvd = [], []
    for line in pairs_sec.splitlines():
        if line.startswith("| `"):
            c = [x.strip() for x in line.strip().strip("|").split("|")]
            pairs.append(dict(fg=c[0].strip("`"), bg=c[1].strip("`"), use=c[2], min=c[3], light=float(c[4]),
                              dark=float(c[5]), lightHC=float(c[6]), darkHC=float(c[7]), result=c[8]))
    for line in cvd_sec.splitlines():
        if line.startswith("| `"):
            c = [x.strip() for x in line.strip().strip("|").split("|")]
            a, b = (s.strip().strip("`") for s in c[0].split(" vs "))
            cvd.append(dict(a=a, b=b, appearance=c[1], normal=c[2], protanopia=c[3], deuteranopia=c[4], tritanopia=c[5]))
    min_de = re.search(r"CIEDE2000; minimum (\d+)", text)
    return pairs, cvd, int(min_de.group(1)) if min_de else None


def parse_tokens_swift():
    src = read(SRC_TOKENS)

    def block(name):
        m = re.search(r"public (?:nonisolated )?enum %s \{(.*?)\n\}" % name, src, re.S)
        if not m:
            die(f"enum {name} not found in {SRC_TOKENS}")
        return m.group(1)

    def values(name):
        vals = [(n, int(float(v)) if float(v).is_integer() else float(v)) for n, v in re.findall(r"(\w+): CGFloat = ([\d.]+)", block(name))]
        if not vals:
            die(f"no values in enum {name}")
        return vals

    dtypes = []
    for m in re.finditer(r"public static let (\w+) = Font\.system\(\.(\w+)(?:, design: \.(\w+))?\)([^\n]*)", block("DType")):
        name, style, design, mods = m.groups()
        w = re.search(r"\.weight\(\.(\w+)\)", mods)
        dtypes.append(dict(token=name, style=style, design=design or "default", weight=w.group(1) if w else None,
                           monoDigits=".monospacedDigit()" in mods, swift=m.group(0).split(" = ", 1)[1].strip()))
    colors = dict(re.findall(r"static let (d\w+) = Color\(uiColor: DebbiePalette\.(\w+)\)", src))
    return dict(space=values("Space"), radius=values("Radius"), size=values("Size"), dtypes=dtypes, colors=colors)


def camel(token):
    parts = token.replace(".", " ").split()
    return parts[0] + "".join(p[0].upper() + p[1:] for p in parts[1:])


# ---------------------------------------------------------------- 02-color

GROUPS = [
    ("Surfaces", "White screens, soft grey-green cards and wells. Depth comes from these steps, never from shadows.",
     ["bg.canvas", "bg.surface", "bg.sunken", "surface.pressed"]),
    ("Text", "Primary and secondary text measure at least 7:1 on every light surface.",
     ["text.primary", "text.secondary", "text.tertiary"]),
    ("Mint, the signature", "Mint means calm and go. Words on mint use text.onMint; mint-coloured words and icons on white use accent.text. Mint itself is never text.",
     ["mint.fill", "mint.fill.pressed", "mint.tint", "text.onMint", "accent.text", "ok.icon", "ok.tint", "focus.ring"]),
    ("Caution: needs attention soon", "Amber. Only for something that needs attention soon, such as a home that can't be reached.",
     ["caution.fill", "caution.tint", "caution.text", "text.onCaution"]),
    ("Urgent: act now", "Red. The only strong fill in the app, kept for an urgent alert nobody has answered yet (and Stop, Unpair and the tab badge).",
     ["urgent.fill", "urgent.fill.pressed", "urgent.tint", "urgent.text", "urgent.border", "text.onUrgent"]),
    ("Live: the camera is on", "Indigo, only while live video plays. The live-view screen is always dark.",
     ["live.fill", "live.scrim", "live.border", "text.onLive"]),
    ("Lines and states", "Outlines, disabled controls and hairlines.",
     ["border.control", "separator", "fill.disabled", "label.disabled"]),
]

WHERE = {
    "bg.canvas": "Every screen's background, including the strip behind buttons pinned to the bottom. Also the 3 pt ring around the badge on Debbie's onboarding portrait.",
    "bg.surface": "Cards (Settings, Heart rate, Devices, older alerts); Debbie's chat bubbles, typing bubble and onboarding speech bubble; the chat field; secondary and destructive buttons; unselected choice cards; the resident's \"Sent to home\" pill; the Home status card when monitoring is unknown.",
    "bg.sunken": "Wells: the four pairing-code digit boxes, text-field backgrounds, a switch track that's off, the camera-unavailable panel.",
    "surface.pressed": "Secondary, quiet and destructive buttons, and round icon buttons (Back, Close), while pressed.",
    "text.primary": "Headings, sentences and key facts on every light surface; the wordmark on the welcome screen; the corner Settings gear.",
    "text.secondary": "Times, details, subtitles and helper lines; the \"Needs attention\" label and glyph on alert cards; unknown and info status glyphs; unselected tab icons and labels; a switch knob that's off; the typing dots; the chat field's placeholder.",
    "text.tertiary": "Defined for placeholders and hints. Not used on any build-3 screen.",
    "mint.fill": "The one primary button per screen (Get Started, Continue, Start Live View, Sync Now, I'm On It on the leading attention card); the round Send button; a switch that's on; the badge on Debbie's onboarding portrait. Also the Any app icon's background.",
    "mint.fill.pressed": "A primary button or Send while pressed. It goes lighter, not darker, so the label stays above 7:1.",
    "mint.tint": "Calm surfaces: the Home status card when monitoring is on, the Live tab's intro card, the resident's heart card, your own chat bubbles, the selected tab's highlight, a selected choice card, the Demo badge, the circle behind Debbie's face.",
    "text.onMint": "Words and icons on mint: primary button labels, the Send arrow, a switch knob that's on, the icon in the badge on Debbie's portrait, the mark on the lockup tile.",
    "accent.text": "Mint-family words and icons on light surfaces: secondary and quiet button labels (Try the Demo; I'm On It on red), the selected tab's icon, label and avatar ring, Back and Close, feature icons (camera, heart, laptop), suggestion chips, the Demo badge outline, links.",
    "ok.icon": "The healthy status glyph (a tick in a circle) in status rows. Same value as accent.text on purpose: the glyph's shape and its words tell them apart.",
    "ok.tint": "Same value as mint.tint, named for healthy rows. Screens use mint.tint directly.",
    "focus.ring": "The 2 pt outline of a focused text field or chat field.",
    "caution.fill": "Defined for a small attention badge. Not used on any build-3 screen.",
    "caution.tint": "The Home status card when home can't be reached or monitoring is limited; the Settings notifications card when alerts are off.",
    "caution.text": "Attention glyphs and words in status rows (for example a laptop that's \"Not reporting\").",
    "text.onCaution": "Defined for words on caution.fill. Not used on any build-3 screen.",
    "urgent.fill": "The newest unanswered urgent alert card on Home (\"Possible fall\"), the red count badge on the Home tab, the Stop button in live view (which is always dark, so there it is the dark value #D42A3C), and the Unpair button in its confirmation sheet.",
    "urgent.fill.pressed": "Stop or Unpair while pressed.",
    "urgent.tint": "The urgent row pinned to the top of Debbie's chat.",
    "urgent.text": "Urgent words and glyphs on light surfaces: an answered urgent alert's \"Urgent\" label and glyph, the urgent row's glyph in chat, the Leave Demo and Unpair This iPhone labels, error messages and a text field's error outline.",
    "urgent.border": "Defined for an urgent banner's outline. Not used on any build-3 screen.",
    "text.onUrgent": "Words, icons and the count on urgent.fill: the alert card, the tab badge, Stop.",
    "live.fill": "The LIVE bar at the top of the live-view screen (opaque, never over the video).",
    "live.scrim": "The live-view screen's background. It's always dark, even though the rest of the app is light.",
    "live.border": "The 1.5 pt white outline around the LIVE bar (the code draws plain white, the same value).",
    "text.onLive": "Every word on the live-view screen: LIVE, the place, the countdown, the status panels.",
    "border.control": "Outlines: secondary buttons (1.5 pt); suggestion chips, text fields, the chat field and the switch track (1 pt); unselected choice cards (1 pt); the unselected Debbie tab ring (1 pt at 35 % opacity); every Increase Contrast outline (1.5 pt).",
    "separator": "Defined for hairlines. Build 3 has none: cards separate from the canvas by colour.",
    "fill.disabled": "A disabled button's fill.",
    "label.disabled": "A disabled button's label.",
}

# Fill tokens get an "Aa" sample on the palette sheet in the colour that goes on them.
ON = {"bg.canvas": "text.primary", "bg.surface": "text.primary", "bg.sunken": "text.primary", "surface.pressed": "text.primary",
      "mint.fill": "text.onMint", "mint.fill.pressed": "text.onMint", "mint.tint": "text.primary", "ok.tint": "text.primary",
      "caution.fill": "text.onCaution", "caution.tint": "text.primary", "urgent.fill": "text.onUrgent",
      "urgent.fill.pressed": "text.onUrgent", "urgent.tint": "text.primary", "live.fill": "text.onLive",
      "live.scrim": "text.onLive", "fill.disabled": "label.disabled"}

QUICK = [
    ("bg.canvas", "Screen background"), ("bg.surface", "Cards"), ("text.primary", "Text"), ("text.secondary", "Secondary text"),
    ("mint.fill", "Signature mint: primary button, brand"), ("mint.tint", "Calm surfaces, your chat bubbles"),
    ("accent.text", "Mint-family words and icons on white"), ("urgent.fill", "An unanswered urgent alert"),
]


def css_name(token):
    return "--debbie-" + re.sub(r"([a-z])([A-Z])", r"\1-\2", token).replace(".", "-").lower()


def figma_path(token):
    parts = token.split(".")
    return [parts[0]] if len(parts) == 1 else [parts[0], "-".join(parts[1:])]


def ase_bytes(group, swatches):
    """Adobe Swatch Exchange 1.0: 'ASEF', version 1.0, block count, then blocks (big-endian).
    Group start 0xC001 / colour entry 0x0001 / group end 0xC002; names are UTF-16BE with a terminating NUL and a
    length prefix counted in UTF-16 units (NUL included); colours are 'RGB ' + three float32 in 0-1 + type (0 = global)."""
    def name(s):
        u = (s + "\0").encode("utf-16-be")
        return struct.pack(">H", len(u) // 2) + u
    blocks = []
    g = name(group)
    blocks.append(struct.pack(">HI", 0xC001, len(g)) + g)
    for n, hx in swatches:
        r, gr, b = hex_rgb(hx)
        body = name(n) + b"RGB " + struct.pack(">fff", r, gr, b) + struct.pack(">H", 0)
        blocks.append(struct.pack(">HI", 0x0001, len(body)) + body)
    blocks.append(struct.pack(">HI", 0xC002, 0))
    return b"ASEF" + struct.pack(">HHI", 1, 0, len(blocks)) + b"".join(blocks)


def ase_read(data):
    """Independent reader, used to prove the file round-trips."""
    if data[:4] != b"ASEF":
        die("ASE signature missing")
    major, minor, count = struct.unpack(">HHI", data[4:12])
    pos, out = 12, []
    for _ in range(count):
        kind, length = struct.unpack(">HI", data[pos:pos + 6])
        body = data[pos + 6:pos + 6 + length]
        pos += 6 + length
        if kind in (0xC001, 0x0001):
            n = struct.unpack(">H", body[:2])[0]
            label = body[2:2 + 2 * n].decode("utf-16-be").rstrip("\0")
            if kind == 0x0001:
                model = body[2 + 2 * n:6 + 2 * n]
                rgb = struct.unpack(">fff", body[6 + 2 * n:18 + 2 * n])
                ctype = struct.unpack(">H", body[18 + 2 * n:20 + 2 * n])[0]
                out.append((label, model, rgb, ctype))
    if pos != len(data):
        die("ASE length mismatch")
    return (major, minor, count), out


def build_color(colors, pairs, cvd, min_de, swift, tmp):
    tokens = colors["tokens"]
    grouped = [t for _, _, ts in GROUPS for t in ts]
    if sorted(grouped) != sorted(tokens):
        die(f"colour groups out of date: missing {sorted(set(tokens) - set(grouped))}, unknown {sorted(set(grouped) - set(tokens))}")
    for t in tokens:
        if t not in WHERE:
            die(f"no 'where used' text for {t}")
    # Recompute every pairing and require it to equal the published report.
    for p in pairs:
        for k in ("light", "lightHC", "dark", "darkHC"):
            got = round(contrast(tokens[p["fg"]][k], tokens[p["bg"]][k]), 2)
            if abs(got - p[k]) > 0.006:
                die(f"{p['fg']} on {p['bg']} ({k}) measures {got:.2f} but {SRC_REPORT} says {p[k]:.2f}: regenerate the report")
    declared = {(p["fg"], p["bg"]) for p in colors["pairings"]}
    if declared != {(p["fg"], p["bg"]) for p in pairs}:
        die(f"{SRC_REPORT} and {SRC_COLORS} list different pairings: regenerate the report")
    swift_by_token = {}
    for dname, camel_name in swift["colors"].items():
        for t in tokens:
            if camel(t) == camel_name:
                swift_by_token[t] = "Color." + dname

    os.makedirs(COLOR, exist_ok=True)
    shutil.copyfile(SRC_COLORS, os.path.join(COLOR, "colors.json"))

    # colors.css
    def css_block(selector, key, indent=""):
        lines = [f"{indent}{selector} {{"]
        for _, _, ts in GROUPS:
            for t in ts:
                lines.append(f"{indent}  {css_name(t)}: {tokens[t][key]}; /* {t}: {tokens[t]['role']} */")
        lines.append(f"{indent}}}")
        return "\n".join(lines)
    css = [
        "/*",
        " * Debbie colour tokens as CSS custom properties.",
        f" * Generated by tools/design/kit/brand-tokens.sh from {SRC_COLORS}. Do not edit by hand.",
        " * The app is LIGHT ONLY (docs/DECISIONS.md D-032): use the :root values. The Increase Contrast",
        " * values switch in under (prefers-contrast: more), or add the class .debbie-increase-contrast.",
        " * Names: token \"mint.fill.pressed\" -> --debbie-mint-fill-pressed, \"text.onMint\" -> --debbie-text-on-mint.",
        " */",
        "",
        "/* Light: the app's only appearance. */",
        css_block(":root", "light"),
        "",
        "/* Light with Increase Contrast (Settings > Accessibility > Display & Text Size). */",
        "@media (prefers-contrast: more) {",
        css_block(":root", "lightHC", "  "),
        "}",
        css_block(".debbie-increase-contrast", "lightHC"),
        "",
        "/* ------------------------------------------------------------------------------------------------",
        " * REFERENCE ONLY. The app is light-only and never shows these. They stay defined and measured in the",
        " * token file so following the system's Dark Mode again is a one-line change. Don't design with them.",
        " * ------------------------------------------------------------------------------------------------ */",
        css_block(".debbie-dark-reference-only", "dark"),
        css_block(".debbie-dark-increase-contrast-reference-only", "darkHC"),
    ]
    write(os.path.join(COLOR, "colors.css"), "\n".join(css))

    # figma-tokens.json (Tokens Studio for Figma, one file with two sets and two themes)
    def token_set(key):
        out = {}
        for _, _, ts in GROUPS:
            for t in ts:
                node = out
                path = figma_path(t)
                for p in path[:-1]:
                    node = node.setdefault(p, {})
                if path[-1] in node:
                    die(f"Figma token name clash at {t}")
                node[path[-1]] = {"value": tokens[t][key], "type": "color", "description": f"{t}: {tokens[t]['role']}"}
        return out
    figma = {
        "light": token_set("light"),
        "lightHC": token_set("lightHC"),
        "$themes": [
            {"id": "debbie-light", "name": "Light", "selectedTokenSets": {"light": "enabled"}},
            {"id": "debbie-light-increase-contrast", "name": "Light + Increase Contrast", "selectedTokenSets": {"lightHC": "enabled"}},
        ],
        "$metadata": {"tokenSetOrder": ["light", "lightHC"]},
    }
    write_json(os.path.join(COLOR, "figma-tokens.json"), figma)

    # debbie-colors.ase (light values), proven by reading it back
    order = [t for _, _, ts in GROUPS for t in ts]
    data = ase_bytes("Debbie (light)", [(t, tokens[t]["light"]) for t in order])
    with open(os.path.join(COLOR, "debbie-colors.ase"), "wb") as f:
        f.write(data)
    header, entries = ase_read(data)
    if header != (1, 0, len(order) + 2) or [e[0] for e in entries] != order:
        die("ASE round trip failed")
    for (n, model, rgb, ctype), t in zip(entries, order):
        back = "#" + "".join(f"{round(c * 255):02X}" for c in rgb)
        if model != b"RGB " or back != tokens[t]["light"] or ctype != 0:
            die(f"ASE entry {n} reads back as {back}")

    # palette.png spec
    ratio = {(p["fg"], p["bg"]): p["light"] for p in pairs}
    groups = []
    for gname, note, ts in GROUPS:
        items = []
        for t in ts:
            sample = None
            if t in ON:
                fg = ON[t]
                r = ratio.get((fg, t)) or round(contrast(tokens[fg]["light"], tokens[t]["light"]), 2)
                sample = {"fg": tokens[fg]["light"], "text": "Aa", "ratio": f"{fg} {r:.2f}:1"}
            items.append({"name": t, "hex": tokens[t]["light"], "hc": tokens[t]["lightHC"], "role": tokens[t]["role"], "sample": sample})
        groups.append({"name": gname, "note": note, "tokens": items})
    write_json(os.path.join(tmp, "palette.json"), {
        "title": "Debbie colour tokens",
        "subtitle": "Light, the app's only appearance (D-032). Each card: the token's swatch, name, sRGB hex, its Increase Contrast value and its role. "
                    "\"Aa\" shows the text colour that goes on a fill, with the measured WCAG contrast.",
        "footer": f"Source: {SRC_COLORS}, measured in {SRC_REPORT}. Rendered at 2x by tools/design/kit/brand-tokens.sh. "
                  "Exact values are in color.md, colors.css, figma-tokens.json and debbie-colors.ase.",
        "scale": 2, "width": 1184, "columns": 6,
        "ink": tokens["text.primary"]["light"], "ink2": tokens["text.secondary"]["light"],
        "canvas": tokens["bg.canvas"]["light"], "hairline": tokens["separator"]["light"], "groups": groups})

    # color.md
    L, C, H = lch(tokens["mint.fill"]["light"])
    mint_white = contrast(tokens["mint.fill"]["light"], "#FFFFFF")
    md = []
    md.append("# Colour\n")
    md.append("Debbie is calm on purpose: white screens, soft grey-green cards, dark green-black text and one signature **mint**. "
              "Red, amber and indigo each mean exactly one thing and appear only when that thing is happening.\n")
    md.append("**The app is light only** (owner direction, `docs/DECISIONS.md` D-032): an iPhone in Dark Mode still shows the white app. "
              "Every token also has dark values; they're kept in `colors.json` and in a clearly marked block of `colors.css` for reference only. "
              "Don't design dark screens. The one exception is the live-view screen, which is always dark (see Live below).\n")
    md.append("## Files in this folder\n")
    md.append(table(["File", "What it is", "How to use it"], [
        ["`palette.png`", "Swatch sheet at 2x: every token's colour, name, hex, Increase Contrast value and role", "Look here first"],
        ["`colors.json`", f"The app's colour source, copied unchanged from `{SRC_COLORS}` (light, dark and both Increase Contrast values, plus the pairings that are measured)", "Reference; engineers' source of truth"],
        ["`colors.css`", "CSS custom properties: light, light + Increase Contrast, and a reference-only dark block", "Web mock-ups, or copy hex values"],
        ["`figma-tokens.json`", "Tokens Studio for Figma file with two sets (`light`, `lightHC`) and two themes", "Figma: Tokens Studio plugin > Tools > Load from file. Names nest by their first word: `mint.fill.pressed` becomes `mint` > `fill-pressed`"],
        ["`debbie-colors.ase`", "Adobe Swatch Exchange, light values, one group \"Debbie (light)\", named by token", "Illustrator, Photoshop, InDesign: Swatches panel menu > Open Swatch Library > Other Library"],
    ]) + "\n")
    md.append("In Keynote and After Effects, type the hex values from the tables below. All values are sRGB.\n")
    md.append("## If you only remember eight colours\n")
    md.append(table(["Colour", "Token", "Hex"], [[w, f"`{t}`", f"`{tokens[t]['light']}`"] for t, w in QUICK]) + "\n")
    md.append("## The rules that matter\n")
    md.append(f"1. **Mint must read as mint.** `mint.fill` `{tokens['mint.fill']['light']}` measures CIELAB L\\* {L:.1f}, C\\* {C:.1f}, hue {H:.0f}°; "
              "the app's rule keeps it within hue 158–170°, chroma ≥ 35 and lightness ≥ 78 (CRAFT.md C3). "
              "Never shift it toward teal, sage or forest green, and never darken it to make text readable.")
    md.append(f"2. **Text never sits in mint.** Mint on white is only {mint_white:.2f}:1, so mint is never used for words or icons on light surfaces. "
              f"Words and icons *on* a mint fill use `text.onMint` `{tokens['text.onMint']['light']}` (7.69:1). "
              f"Mint-coloured words and icons on white use `accent.text` `{tokens['accent.text']['light']}` (6.52:1).")
    md.append("3. **Mint has a few jobs only** (CRAFT C4): the brand mark and app icon; **one** primary button per screen (in the chat, Send); "
              "and calm surfaces in `mint.tint`. In build 3 it also fills a switch that's on and the badge on Debbie's onboarding portrait, and it's Debbie's top. "
              "Nothing else is mint.")
    md.append("4. **One meaning per hue** (C5): mint = calm and go; amber = needs attention soon; red = act now; indigo = the camera is live. "
              "No decorative amber, red or indigo anywhere, illustrations included.")
    md.append("5. **Colour is never the only signal** (C7): every status is a glyph shape plus words plus position. See Colour-blind safety below.")
    md.append("6. **No shadows on content.** Cards sit on the white canvas as `bg.surface` with no shadow and no outline; depth comes from the surface colours (CRAFT D6). "
              "Only the floating Liquid Glass tab bar and corner button cast the system's glass effect.\n")
    md.append("## All tokens\n")
    md.append("\"Light + IC\" is the value under Settings > Accessibility > Display & Text Size > Increase Contrast. "
              "Where it's the same as Light, the cell says so.\n")
    for gname, note, ts in GROUPS:
        md.append(f"### {gname}\n")
        md.append(note + "\n")
        rows = []
        for t in ts:
            v = tokens[t]
            hc = "same" if v["lightHC"] == v["light"] else f"`{v['lightHC']}`"
            rows.append([f"`{t}`", v["role"], f"`{v['light']}`", hc, WHERE[t]])
        md.append(table(["Token", "Role", "Light", "Light + IC", "Where you'll see it"], rows) + "\n")
    md.append("## Urgency colours: rare on purpose\n")
    md.append("The app is calm until something matters (CRAFT P1). Amber, red and indigo carry meaning, so they're used sparingly and never for decoration.\n")
    md.append(table(["Hue", "Means", "Tokens", "Appears only on"], [
        ["Amber", "Needs attention soon", "`caution.tint`, `caution.text` (`caution.fill`, `text.onCaution` defined, unused)",
         "The Home status card when home can't be reached or monitoring is limited; attention rows; the Settings card when notifications are off"],
        ["Red", "Act now", "`urgent.fill`, `urgent.text`, `urgent.tint`, `text.onUrgent`",
         "Solid red: the newest urgent alert nobody has answered (it turns neutral once someone taps I'm On It), the Home tab's count badge, Stop in live view, Unpair in its confirmation sheet. Red words and glyphs: answered urgent alerts, errors, the urgent row in chat"],
        ["Indigo", "The camera is live", "`live.fill`, with `live.scrim` behind and white text", "Only the LIVE bar while video plays"],
    ]) + "\n")
    md.append("- At most one solid red card is on screen at a time: only the newest unanswered urgent alert is filled red; older ones are neutral cards with red words.")
    md.append("- In the demo video and slides, keep the same discipline: use red only where the app shows red, and don't use red, amber or indigo for titles, highlights or backgrounds.")
    md.append("- Difference from CRAFT.md (the code wins): CRAFT C6 says `urgent.fill` appears only on the newest unanswered urgent alert. "
              "Build 3 also uses it for the Home tab's count badge, the live-view Stop button and the Unpair confirmation button.\n")
    md.append("## Colour-blind safety\n")
    md.append("Colour is never the only signal (CRAFT C7). Every status has its own glyph shape (healthy, attention, urgent, unknown, info; see `../05-icons`) "
              "and its own words (\"Monitoring is on\", \"Needs attention\", \"Urgent\"), and urgent things come first. Tints alone would collapse: two status tints can "
              "differ by only ΔE00 0.8–1.7 for some colour-blind people, so a tint is never the only difference between two states. "
              "When you design for the video, keep the glyph and the words with every coloured status.\n")
    md.append(f"The signal colours themselves stay far apart under simulated colour blindness (CIEDE2000; the app's minimum is {min_de}; Machado et al. 2009, severity 1.0):\n")
    md.append(table(["Pair", "Appearance", "Normal", "Protanopia", "Deuteranopia", "Tritanopia"],
                    [[f"`{c['a']}` vs `{c['b']}`", c["appearance"], c["normal"], c["protanopia"], c["deuteranopia"], c["tritanopia"]]
                     for c in cvd if c["appearance"] in ("Light", "Light + Increase Contrast")]) + "\n")
    md.append("## Measured contrast\n")
    md.append("Every text and icon pairing, measured with the WCAG 2.x ratio (from `Design/tokens/contrast-report.md`; this generator re-measures each one and stops if any differs). "
              "Minimums: primary and secondary text 7:1; tertiary text 4.5:1 (7:1 with IC); labels on mint and amber fills 7:1; labels on red and indigo 4.5:1 (7:1 with IC); "
              "icons, outlines and focus rings 3:1 (4.5:1 with IC). The large-text exception is never used (CRAFT C2).\n")
    md.append(table(["Foreground", "Background", "Use", "Minimum", "Light", "Light + IC", "Result"],
                    [[f"`{p['fg']}`", f"`{p['bg']}`", p["use"], p["min"], f"{p['light']:.2f}", f"{p['lightHC']:.2f}", p["result"]] for p in pairs]) + "\n")
    md.append("## Increase Contrast\n")
    md.append("With Increase Contrast on, each token switches to its Light + IC value (text and outlines go darker; cards and tints go a touch deeper). "
              "Filled buttons, cards, chat bubbles, the floating tab bar and the corner button gain a 1.5 pt `border.control` outline, and suggestion chips a 1.5 pt `accent.text` one (CRAFT C9). "
              "With Show Borders on, text-only and icon-only buttons get the same 1.5 pt outline.\n")
    md.append("## Dark values\n")
    md.append("Reference only. They're in `colors.json` (`dark`, `darkHC`) and at the end of `colors.css`. The app never shows them (D-032).\n")
    md.append("## Sources\n")
    md.append(f"- `{SRC_COLORS}` and `{SRC_REPORT}` (generated by `tools/design/tokens.py`)")
    md.append("- `CRAFT.md` §2.1 (C1–C10) and §2.5 (D6); `docs/DECISIONS.md` D-029 (white canvas), D-032 (light only)")
    md.append(f"- Where each colour is used: `{DS}/Components/`, `Chrome/`, `Persona/`, `Packages/DebbieKit/Sources/DebbieCareScreens/CareScreens.swift`, "
              "`Packages/DebbieKit/Sources/DebbieFeatures/Views.swift` and `DebbieChat.swift` (build 3). Code names: "
              + ", ".join(f"`{t}` = `{swift_by_token[t]}`" for t in order if t in swift_by_token) + ".")
    md.append(f"- {REGEN}")
    write(os.path.join(COLOR, "color.md"), "\n".join(md))
    return tokens


# ---------------------------------------------------------------- 03-type
# Apple HIG, Typography > Specifications (https://developer.apple.com/design/human-interface-guidelines/typography),
# read 2026-11-14: "iOS, iPadOS Dynamic Type sizes" (size/leading in pt) and the iOS tracking tables.
# Same values as docs/research/07-typography-layout.md F2.
HIG_SIZES = ["xSmall", "Small", "Medium", "Large", "xLarge", "xxLarge", "xxxLarge", "AX1", "AX2", "AX3", "AX4", "AX5"]
HIG_STYLES = ["Large Title", "Title 1", "Title 2", "Title 3", "Headline", "Body", "Callout", "Subhead", "Footnote", "Caption 1", "Caption 2"]
HIG_DT = {  # style -> 12 (size, leading) pairs in HIG_SIZES order
    "Large Title": [(31, 38), (32, 39), (33, 40), (34, 41), (36, 43), (38, 46), (40, 48), (44, 52), (48, 57), (52, 61), (56, 66), (60, 70)],
    "Title 1": [(25, 31), (26, 32), (27, 33), (28, 34), (30, 37), (32, 39), (34, 41), (38, 46), (43, 51), (48, 57), (53, 62), (58, 68)],
    "Title 2": [(19, 24), (20, 25), (21, 26), (22, 28), (24, 30), (26, 32), (28, 34), (34, 41), (39, 47), (44, 52), (50, 59), (56, 66)],
    "Title 3": [(17, 22), (18, 23), (19, 24), (20, 25), (22, 28), (24, 30), (26, 32), (31, 38), (37, 44), (43, 51), (49, 58), (55, 65)],
    "Headline": [(14, 19), (15, 20), (16, 21), (17, 22), (19, 24), (21, 26), (23, 29), (28, 34), (33, 40), (40, 48), (47, 56), (53, 62)],
    "Body": [(14, 19), (15, 20), (16, 21), (17, 22), (19, 24), (21, 26), (23, 29), (28, 34), (33, 40), (40, 48), (47, 56), (53, 62)],
    "Callout": [(13, 18), (14, 19), (15, 20), (16, 21), (18, 23), (20, 25), (22, 28), (26, 32), (32, 39), (38, 46), (44, 52), (51, 60)],
    "Subhead": [(12, 16), (13, 18), (14, 19), (15, 20), (17, 22), (19, 24), (21, 28), (25, 31), (30, 37), (36, 43), (42, 50), (49, 58)],
    "Footnote": [(12, 16), (12, 16), (12, 16), (13, 18), (15, 20), (17, 22), (19, 24), (23, 29), (27, 33), (33, 40), (38, 46), (44, 52)],
    "Caption 1": [(11, 13), (11, 13), (11, 13), (12, 16), (14, 19), (16, 21), (18, 23), (22, 28), (26, 32), (32, 39), (37, 44), (43, 51)],
    "Caption 2": [(11, 13), (11, 13), (11, 13), (11, 13), (13, 18), (15, 20), (17, 22), (20, 25), (24, 30), (29, 35), (34, 41), (40, 48)],
}
HIG_WEIGHT = {"Headline": "semibold"}  # every other style's default weight is Regular
# Tracking in 1/1000 em and in points, per point size (iOS, iPadOS, visionOS).
TRACK = {
    "SF Pro": {11: (6, 0.06), 12: (0, 0.0), 13: (-6, -0.08), 14: (-11, -0.15), 15: (-16, -0.23), 16: (-20, -0.31), 17: (-26, -0.43),
               18: (-25, -0.44), 19: (-24, -0.45), 20: (-23, -0.45), 21: (-18, -0.36), 22: (-12, -0.26), 23: (-4, -0.10), 24: (3, 0.07),
               25: (6, 0.15), 26: (8, 0.22), 27: (11, 0.29), 28: (14, 0.38), 29: (14, 0.40), 30: (14, 0.40), 31: (13, 0.39), 32: (13, 0.41),
               33: (12, 0.40), 34: (12, 0.40), 35: (11, 0.38), 36: (10, 0.37), 64: (4, 0.22)},
    "SF Pro Rounded": {11: (52, 0.56), 12: (46, 0.54), 13: (40, 0.51), 14: (35, 0.48), 15: (30, 0.44), 16: (26, 0.41), 17: (22, 0.37),
                       18: (21, 0.37), 19: (20, 0.37), 20: (18, 0.36), 21: (17, 0.35), 22: (16, 0.34), 23: (16, 0.35), 24: (15, 0.35),
                       25: (14, 0.35), 26: (14, 0.36), 27: (14, 0.36), 28: (13, 0.36), 29: (13, 0.37), 30: (12, 0.37), 31: (12, 0.36),
                       32: (12, 0.38), 33: (12, 0.39), 34: (12, 0.38), 35: (11, 0.38), 36: (11, 0.39), 64: (3, 0.19)},
}
STYLE_HIG = {"largeTitle": "Large Title", "title": "Title 1", "title2": "Title 2", "title3": "Title 3", "headline": "Headline",
             "body": "Body", "callout": "Callout", "subheadline": "Subhead", "footnote": "Footnote", "caption": "Caption 1", "caption2": "Caption 2"}
WEIGHT_VALUE = {"regular": 400, "medium": 500, "semibold": 600, "bold": 700}
TYPE_USE = {
    "hero": "The one biggest line per screen: Home's status headline (\"Monitoring is on\"), tab titles (Live View, History, Devices), the welcome's \"Hi, I'm Debbie.\", the resident's greeting. It also sizes the big feature icons (the Live tab's camera, the resident's heart).",
    "title": "Titles inside content: the welcome's promise, Debbie's onboarding lines, \"Check the code\", \"Paired with …\", sheet titles (Settings, Add a Laptop), empty-state titles, the live-view status panels, the chat header \"Debbie\". It also sizes the status headline's glyph.",
    "headline": "Card and row titles (Heart rate, Laptops, This iPhone), alert titles (\"Possible fall\"), top-bar titles, the home's name on Home's top row, the LIVE word. It also sizes most inline icons.",
    "body": "Every sentence: explanations, chat bubbles, typed text, switch labels, Devices row labels, alert details.",
    "bodyStrong": "Key facts inside body text: status values (\"Connected to home\"), text-field labels, the chat's urgent row title, \"No heart data\", the live countdown.",
    "button": "Every button label except the resident's.",
    "secondary": "Times, details, subtitles and helper lines (\"Home last in touch 6:14 PM\"). In Semibold: the alert tier word (\"Urgent\", \"Needs attention\"), inline status values, suggestion chips, the Demo badge.",
    "footnote": "The smallest text in the app: the AI note at the top of the chat, \"Written on this iPhone from your home's data\", the version line in Settings.",
    "metric": "Numbers that matter: the heart rate on Home's card, the four pairing-code digits.",
    "residentBody": "Every sentence on the resident's screen (the person at home).",
    "residentLabel": "The resident's labels (\"beats a minute\", \"No heart readings yet\") and the label of their Sync Now button.",
    "tabIcon": "Sizes the tab bar's icons. No text.",
    "tabLabel": "Tab bar labels (Home, Live, Debbie, History, Devices) and the red count badge.",
    "cornerIcon": "Sizes the corner Settings gear. No text.",
}
SAMPLES = {
    "hero": "Monitoring is on", "title": "See the home now", "headline": "Possible fall",
    "body": "Look through the home camera for up to 5 minutes at a time. The laptop at home shows a notice while you watch.",
    "bodyStrong": "Connected to home", "button": "Get Started", "secondary": "Home last in touch 6:14 PM",
    "footnote": "Written on this iPhone from your home's data", "metric": "72  4719",
    "residentBody": "I share your heart rate with your family.", "residentLabel": "beats a minute",
    "tabLabel": "Home    Live    Debbie    History    Devices",
}
CLAMP_XLARGE = {"tabIcon", "tabLabel", "cornerIcon"}  # .dynamicTypeSize(...DynamicTypeSize.xLarge) in Chrome/
SHOWN = ["Large", "xLarge", "xxxLarge", "AX1", "AX3", "AX5"]


def tracking(family, size):
    fam = "SF Pro Rounded" if family == "SF Pro Rounded" else "SF Pro"
    if size not in TRACK[fam]:
        die(f"no HIG tracking value for {fam} {size} pt")
    return TRACK[fam][size]


def type_family(design, size):
    if design == "rounded":
        return "SF Pro Rounded"
    return "SF Pro Display" if size >= 20 else "SF Pro Text"


def build_type(swift, tokens, tmp):
    dts = swift["dtypes"]
    if {d["token"] for d in dts} != set(TYPE_USE):
        die(f"type tokens changed: code has {sorted(d['token'] for d in dts)}")
    rows_json = []
    for d in dts:
        hig = STYLE_HIG.get(d["style"]) or die(f"unknown text style {d['style']}")
        weight = d["weight"] or HIG_WEIGHT.get(hig, "regular")
        size, lead = HIG_DT[hig][HIG_SIZES.index("Large")]
        fam = type_family(d["design"], size)
        em, pt = tracking("SF Pro Rounded" if d["design"] == "rounded" else "SF Pro", size)
        clamp = d["token"] in CLAMP_XLARGE
        scale = {}
        for s in HIG_SIZES:
            eff = "xLarge" if clamp and HIG_SIZES.index(s) > HIG_SIZES.index("xLarge") else s
            scale[s] = dict(zip(("size", "lineHeight"), HIG_DT[hig][HIG_SIZES.index(eff)]))
        rows_json.append({
            "token": d["token"], "swift": f"DType.{d['token']} = {d['swift']}", "iosTextStyle": d["style"], "higStyle": hig,
            "design": d["design"], "weight": weight.capitalize(), "weightValue": WEIGHT_VALUE[weight], "size": size, "lineHeight": lead,
            "monospacedDigits": d["monoDigits"], "figma": {"family": fam, "style": weight.capitalize(), "size": size, "lineHeight": lead,
                                                            "letterSpacingPercent": round(em / 10, 1), "letterSpacingPt": pt},
            "tracking1000em": em, "trackingPt": pt, "isIconSizeOnly": d["token"] in ("tabIcon", "cornerIcon"),
            "maxDynamicType": "xLarge (clamped in code)" if clamp else "AX5", "dynamicType": scale, "usedFor": TYPE_USE[d["token"]],
        })
    extras = [
        {"name": "DReading", "what": "The resident's heart-rate number", "family": "SF Pro Rounded", "weight": "Bold", "size": 64,
         "monospacedDigits": True, "scales": "with Large Title (@ScaledMetric relativeTo: .largeTitle): about 113 pt at AX5",
         "figmaLetterSpacingPercent": round(TRACK["SF Pro Rounded"][64][0] / 10, 1), "trackingPt": TRACK["SF Pro Rounded"][64][1],
         "source": f"{DS}/Components/Components.swift DReading"},
        {"name": "DebbieWithBadge badge", "what": "The mint circle with an icon on Debbie's onboarding portrait", "size": 36,
         "scales": "with Title 1 (@ScaledMetric relativeTo: .title)", "source": f"{DS}/Persona/DebbieAvatar.swift"},
    ]
    code_has(f"{DS}/Components/Components.swift", "@ScaledMetric(relativeTo: .largeTitle) private var size: CGFloat = 64")
    code_has(f"{DS}/Components/Components.swift", ".font(.system(size: size, weight: .bold, design: .rounded).monospacedDigit())")
    code_has(f"{DS}/Persona/DebbieAvatar.swift", "@ScaledMetric(relativeTo: .title) private var badge: CGFloat = 36")
    code_has(f"{DS}/Chrome/DebbieTabBar.swift", ".dynamicTypeSize(...DynamicTypeSize.xLarge)")
    code_has(f"{DS}/Chrome/DebbieCornerButton.swift", ".dynamicTypeSize(...DynamicTypeSize.xLarge)")
    data = {
        "about": "Debbie's type tokens (DType in Tokens.swift) mapped to iOS text styles, at the default Dynamic Type size (Large) unless a size is named. Points (pt).",
        "fonts": {"text": "SF Pro (SF Pro Text below 20 pt, SF Pro Display at 20 pt and above)", "rounded": "SF Pro Rounded",
                  "download": "https://developer.apple.com/fonts/", "bundledInApp": False,
                  "licence": "Apple licenses the San Francisco fonts for creating mock-ups of user interfaces for Apple platforms (registered Apple developers)."},
        "letterSpacing": "From Apple's HIG tracking tables. iOS applies it automatically; set it yourself in design tools. Figma percent = 1/1000 em / 10; After Effects tracking uses 1/1000 em directly.",
        "tokens": rows_json, "components": extras,
        "iosTextStyles": {"sizes": HIG_SIZES, "styles": {s: {"defaultWeight": HIG_WEIGHT.get(s, "regular").capitalize(),
                                                            "byDynamicTypeSize": {sz: {"size": a, "lineHeight": b} for sz, (a, b) in zip(HIG_SIZES, HIG_DT[s])}}
                                                        for s in HIG_STYLES}},
        "sources": ["Packages/DebbieKit/Sources/DebbieDesignSystem/Tokens/Tokens.swift (DType)",
                    "https://developer.apple.com/design/human-interface-guidelines/typography (Specifications; read 2026-11-14)",
                    "docs/research/07-typography-layout.md F2-F3", "CRAFT.md §2.2"],
    }
    write_json(os.path.join(TYPE, "type-scale.json"), data)

    # specimen spec
    ink, ink2 = tokens["text.primary"]["light"], tokens["text.secondary"]["light"]
    rows = []
    for r in rows_json:
        if r["isIconSizeOnly"]:
            continue
        f = r["figma"]
        lines = [f"{r['higStyle']} · {f['family']} {f['style']}" + (" · tabular digits" if r["monospacedDigits"] else ""),
                 f"{r['size']} pt on a {r['lineHeight']} pt line · tracking {r['trackingPt']:+.2f} pt"]
        rows.append({"token": r["token"], "lines": lines, "sample": SAMPLES[r["token"]], "size": r["size"], "lineHeight": r["lineHeight"],
                     "weight": r["weight"].lower(), "design": r["design"], "monoDigits": r["monospacedDigits"],
                     "wrapWidth": 335 if r["token"] == "body" else None})
    rows.append({"token": "DReading", "lines": ["Resident heart rate (a component, not a DType)", "SF Pro Rounded Bold 64 pt · tabular digits",
                                                f"tracking {TRACK['SF Pro Rounded'][64][1]:+.2f} pt · grows with Large Title"],
                 "sample": "68", "size": 64, "lineHeight": 76, "weight": "bold", "design": "rounded", "monoDigits": True, "wrapWidth": None})
    icon_note = ", ".join(f"{r['token']} ({r['size']} pt, {r['weight']})" for r in rows_json if r["isIconSizeOnly"])
    write_json(os.path.join(tmp, "specimen.json"), {
        "title": "Debbie type specimen",
        "subtitle": "Every type token at the default text size (Large), set in the real system fonts at their iOS sizes and line heights. "
                    "Rendered at 2x. The grey band is one line height. The body sample wraps at 335 pt, the content width on iPhone SE.",
        "footer": f"Icon-size tokens with no text: {icon_note}. Text colour: text.primary {ink}. "
                  "Fonts: SF Pro and SF Pro Rounded (system fonts; https://developer.apple.com/fonts/). Generated by tools/design/kit/brand-tokens.sh.",
        "scale": 2, "width": 820, "labelWidth": 270, "ink": ink, "ink2": ink2, "canvas": tokens["bg.canvas"]["light"],
        "band": tokens["bg.surface"]["light"], "rows": rows})

    # typography.md
    md = ["# Type\n"]
    md.append("Debbie uses Apple's system fonts: **SF Pro** for running text and **SF Pro Rounded** for the big, friendly lines "
              "(the status headline, screen titles and important numbers). The app bundles no font files; iOS supplies them. "
              "Every piece of text uses one of the tokens below, and every token is an iOS text style, so it grows with the iPhone's text-size setting.\n")
    md.append("## Fonts to install\n")
    md.append("- Download **SF Pro** from https://developer.apple.com/fonts/. The package includes SF Pro Text, SF Pro Display and SF Pro Rounded. Don't use any other typeface for the app's UI.")
    md.append("- Use **SF Pro Text below 20 pt** and **SF Pro Display at 20 pt and above** (iOS switches automatically). SF Pro Rounded is one family at every size.")
    md.append("- Licence: Apple's San Francisco licence covers creating mock-ups of user interfaces for Apple platforms. For slide headings that aren't app mock-ups, check the licence or ask the owner.")
    md.append("- `specimen.png` is rendered with the real system fonts on a Mac. Checked against build-3 screenshots, its line widths match the iPhone to within 1 % (SF Pro to within 0.5 pt), so use it to check your mock-ups.\n")
    md.append("## If you only remember five styles\n")
    md.append(table(["What", "Token", "Set it as"], [
        ["The big headline", "`hero`", "SF Pro Rounded Bold 34 / 41"],
        ["A title in content", "`title`", "SF Pro Rounded Bold 22 / 28"],
        ["Card and alert titles", "`headline`", "SF Pro Text Semibold 17 / 22"],
        ["Sentences, and button labels in Semibold", "`body`, `button`", "SF Pro Text Regular (Semibold) 17 / 22"],
        ["Times and details", "`secondary`", "SF Pro Text Regular 15 / 20, in `text.secondary`"],
    ]) + "\n")
    md.append("## The scale\n")
    md.append("At the default text size (Large). \"Size / line\" is point size over line height, both in pt. "
              "Letter spacing is Apple's tracking for that font and size: iOS applies it automatically, so set it in design tools. "
              "Figma takes percent (1 % = 10/1000 em); After Effects' tracking takes the 1/1000 em number as it is. "
              "Apple doesn't document what Keynote's Character Spacing percentage is relative to, so in Keynote compare with `specimen.png`.\n")
    rows = []
    for r in rows_json:
        f = r["figma"]
        ls = f"{f['letterSpacingPercent']:+.1f} % ({r['tracking1000em']:+d}/1000 em, {r['trackingPt']:+.2f} pt)"
        name = f"`{r['token']}`" + (" (icon size)" if r["isIconSizeOnly"] else "")
        rows.append([name, f"`.{r['iosTextStyle']}` ({r['higStyle']})", f"{f['family']} {f['style']}" + (", tabular digits" if r["monospacedDigits"] else ""),
                     f"{r['size']} / {r['lineHeight']}", "n/a" if r["isIconSizeOnly"] else ls, r["usedFor"]])
    md.append(table(["Token", "iOS text style", "Font and weight", "Size / line (pt)", "Letter spacing", "Where it's used"], rows) + "\n")
    md.append("Two sizes in the app aren't text-style tokens:\n")
    md.append(f"- **`DReading`**, the resident's heart-rate number: SF Pro Rounded Bold **64 pt**, tabular digits, letter spacing "
              f"{TRACK['SF Pro Rounded'][64][0] / 10:+.1f} % ({TRACK['SF Pro Rounded'][64][1]:+.2f} pt). It grows with Large Title (about 113 pt at AX5).")
    md.append("- **The badge on Debbie's onboarding portrait**: a 36 pt mint circle that grows with Title 1.\n")
    md.append("## Numbers\n")
    md.append("Numbers that change in place use **tabular (monospaced) digits**, so they don't jiggle as they change: `metric` (the heart rate on Home, the pairing code), "
              "the live countdown (`bodyStrong` + tabular digits), the tab badge count (`tabLabel` + tabular digits) and `DReading`. "
              "In Figma: Type details > Numbers > Monospaced (OpenType `tnum`). The heart rate rolls to a new value (a numeric content transition; see `../09-motion`).\n")
    md.append("## Colour of text\n")
    md.append(f"Text is `text.primary` `{tokens['text.primary']['light']}` or `text.secondary` `{tokens['text.secondary']['light']}` on light surfaces, "
              f"`text.onMint` `{tokens['text.onMint']['light']}` on mint, white on red and on the live screen, and `accent.text` `{tokens['accent.text']['light']}` "
              "for mint-family button labels and links. Never mint text. Full list in `../02-color/color.md`.\n")
    md.append("## Dynamic Type: how text grows\n")
    md.append("People can choose 7 standard text sizes, and 5 larger accessibility sizes (AX1–AX5). Every token follows its iOS text style through **AX5**, "
              "except the tab bar and the corner gear, which stop at xLarge (as Apple's own bars do) and show a large preview on long-press instead. "
              "Layouts reflow rather than truncate: rows of text plus an accessory stack vertically at AX sizes, and screens scroll.\n")
    rows = []
    for r in rows_json:
        cells = [f"`{r['token']}`"]
        for s in SHOWN:
            v = r["dynamicType"][s]
            cells.append(f"{v['size']} / {v['lineHeight']}")
        rows.append(cells)
    md.append(table(["Token"] + [f"{s}{' (default)' if s == 'Large' else ''}" for s in SHOWN], rows) + "\n")
    md.append("Values in pt (size / line height), from Apple's HIG table. AX5 body text is 53 pt, 3.1 times the default. "
              "Difference from CRAFT.md (the code wins): CRAFT §2.2 and §7 say `hero` clamps at AX3 (52 pt); build 3 has no clamp, so it reaches AX5 (60 / 70) and wraps.\n")
    md.append("### iOS text styles (Apple HIG), all sizes\n")
    md.append("For reference. Debbie never uses Callout, Caption 1 or Caption 2 (CRAFT T1 bans the captions).\n")
    md.append(table(["Style", "Default weight"] + HIG_SIZES,
                    [[s, HIG_WEIGHT.get(s, "regular").capitalize()] + [f"{a}/{b}" for a, b in HIG_DT[s]] for s in HIG_STYLES]) + "\n")
    md.append("## Rules (CRAFT.md §2.2, short version)\n")
    md.append("- Weights: Regular, Medium (icons only), Semibold, Bold. Never Ultralight, Thin or Light. No italic running text.")
    md.append("- Sentence case everywhere. The only all-caps word is **LIVE**. Button labels are title case (Get Started, I'm On It).")
    md.append("- No manual letter spacing or kerning beyond Apple's tracking above, and no shrinking text to fit (the only exception: tab labels may shrink to 80 % on the narrowest screen).")
    md.append("- Text wraps; it never truncates alerts, status lines, errors or button labels. Paragraphs are 12 pt apart.")
    md.append("- Icons next to text are sized by that text's style, so they grow together (see `../05-icons`).\n")
    md.append("## Files\n")
    md.append(table(["File", "What it is"], [
        ["`specimen.png`", "Every token rendered at 2x with the real fonts"],
        ["`type-scale.json`", "The same data for tools: each token's style, font, weight, size, line height, letter spacing, all 12 Dynamic Type sizes and where it's used; plus Apple's full iOS text-style table"],
    ]) + "\n")
    md.append("## Sources\n")
    md.append(f"- `{SRC_TOKENS}` (`DType`), `{DS}/Chrome/DebbieTabBar.swift` and `DebbieCornerButton.swift` (the xLarge clamp), `{DS}/Components/Components.swift` (`DReading`)")
    md.append("- Apple HIG, Typography > Specifications: iOS Dynamic Type sizes and tracking tables (https://developer.apple.com/design/human-interface-guidelines/typography, read 2026-11-14); same values as `docs/research/07-typography-layout.md` F2")
    md.append("- `CRAFT.md` §2.2 (T1–T6) and §7")
    md.append(f"- {REGEN}")
    write(os.path.join(TYPE, "typography.md"), "\n".join(md))


# ---------------------------------------------------------------- 04-layout

SPACE_USE = {
    "s4": "Tightest: a title and its subtitle, the tab bar's inner padding and its gap above the home indicator, the top bar's vertical padding, the chat's typing dots",
    "s8": "Related things: icon to label in buttons and rows, lines inside a card, header rows' top and bottom padding, chips 8 apart, the field to Send",
    "s12": "Glyph to text in status rows, rows inside the status card, alert cards in History, chat messages, a button's top and bottom padding, the pinned-button strip's top and bottom padding",
    "s16": "Card padding on every side, the gap between cards and blocks on a screen, chat bubbles' side padding, text fields' side padding, the top bar's side padding",
    "s20": "Screen side margins, buttons' side padding, sheet padding, the floating tab bar's inset from the screen edges, the welcome stack",
    "s24": "Between groups: priming and onboarding stacks, empty-state padding, the bottom padding under scrolling content, the resident heart card's top and bottom padding",
    "s32": "Major breaks: the welcome screen's top padding, the gap above Leave Demo / Unpair in Settings",
    "s48": "The minimum empty space beside a chat bubble, on the far side",
}
RADIUS_USE = {
    "r12": "Text fields, pairing-code boxes, the LIVE bar, the urgent row in chat",
    "r20": "Cards (status, alerts, heart rate, settings), choice cards, chat bubbles, Debbie's speech bubble, the \"Sent to home\" pill, the live video and the camera frame",
    "r28": "Large hero surfaces: the resident's heart card",
    "brandTile": "The brand tile behind the mark at the hero size (the launch intro's lockup): the app icon's corner ratio, 22.4 %, on 148 pt",
}
SIZE_USE = {
    "minTarget": "Smallest touch target (44 × 44): icon buttons, the corner gear, compact buttons, rows, chips",
    "regular": "Regular buttons, text fields, the chat field, switch rows, the Send button",
    "large": "The screen's main button (full width); choice cards' minimum height; pairing-code box width",
    "prominent": "Alert responses (I'm On It on the leading card), live-view Stop (full width); pairing-code box height",
    "resident": "Every control on the resident's screen (Sync Now)",
    "brandMark": "The mint tile of the welcome lockup (build 1; not on a build-3 screen)",
    "brandGlyph": "The mark's frame inside that tile (not on a build-3 screen)",
    "brandWordmark": "The wordmark's height on the welcome screen",
    "brandWordmarkWidth": "The wordmark's width at that height (its art is 332 × 90): the slot the launch intro's wordmark glides into",
    "welcomeArt": "Welcome illustration height (build 1; not on a build-3 screen)",
    "scannerMax": "Tallest the QR camera frame gets",
    "scannerMin": "Shortest the QR camera frame (or its unavailable panel) gets",
    "scannerSheet": "The camera frame in the Add a Laptop sheet",
    "tabItem": "Each tab item's minimum height",
    "tabIcon": "The box each tab icon sits in",
    "tabAvatar": "Debbie's face in the centre tab",
    "avatarSmall": "Debbie's face in the chat header",
    "avatarGuide": "Debbie beside her onboarding lines and the resident's greeting",
    "avatarHero": "Debbie on the welcome screen",
    "featureIcon": "Defined for a large feature icon; not used on a build-3 screen",
}

DEVICES = [
    {"device": "iPhone SE (2nd/3rd gen)", "points": [375, 667], "scale": 2, "pixels": [750, 1334], "safeArea": {"top": 20, "bottom": 0},
     "note": "The smallest supported iPhone; content width 335 pt"},
    {"device": "iPhone 17 Pro Max", "points": [440, 956], "scale": 3, "pixels": [1320, 2868], "safeArea": {"top": 62, "bottom": 34},
     "note": "The largest; content width 400 pt; safe areas measured from build-3 screenshots"},
]


def build_layout(swift, tokens):
    space = {n: v for n, v in swift["space"]}
    radius = {n: v for n, v in swift["radius"]}
    size = {n: v for n, v in swift["size"]}
    for n in space:
        SPACE_USE.get(n) or die(f"Space.{n} has no description")
    for n in radius:
        RADIUS_USE.get(n) or die(f"Radius.{n} has no description")
    for n in size:
        SIZE_USE.get(n) or die(f"Size.{n} has no description")
    S, R, Z = (lambda k: space[k]), (lambda k: radius[k]), (lambda k: size[k])
    tab_bar_h = Z("tabItem") + 2 * S("s4")
    item_w = {d["device"]: round((d["points"][0] - 2 * S("s20") - 2 * S("s4")) / 5, 1) for d in DEVICES}
    bubble = {d["device"]: d["points"][0] - 2 * S("s20") - S("s8") - S("s48") for d in DEVICES}

    # Facts quoted below must still be in the code (warnings, not failures).
    tb, cb, comp, chat, av = (f"{DS}/Chrome/DebbieTabBar.swift", f"{DS}/Chrome/DebbieCornerButton.swift", f"{DS}/Components/Components.swift",
                              f"{DS}/Components/Chat.swift", f"{DS}/Persona/DebbieAvatar.swift")
    views = "Packages/DebbieKit/Sources/DebbieFeatures/Views.swift"
    for path, snip in [
        (tb, ".padding(Space.s4)"), (tb, ".padding(.horizontal, Space.s20)"), (tb, ".padding(.bottom, Space.s4)"),
        (tb, ".frame(maxWidth: .infinity, minHeight: Size.tabItem)"), (tb, ".frame(minHeight: Size.tabIcon)"),
        (tb, "DebbieAvatar(size: Size.tabAvatar)"), (tb, "lineWidth: selected ? 2 : 1"), (tb, ".frame(minWidth: Space.s16 + Space.s4)"),
        (tb, ".offset(x: Space.s12, y: -Space.s4)"), (tb, "Capsule().strokeBorder(Color.dBorder, lineWidth: 1.5)"),
        (cb, ".frame(width: Size.minTarget, height: Size.minTarget)"),
        (comp, ".padding(.horizontal, Space.s20)\n        .padding(.vertical, Space.s12)"), (comp, ".padding(Space.s16)\n            .frame(maxWidth: .infinity, alignment: .leading)"),
        (comp, "RoundedRectangle(cornerRadius: Radius.r20, style: .continuous)"), (comp, ".frame(width: 52, height: 32)"),
        (comp, ".frame(width: 24, height: 24).padding(4)"), (comp, ".frame(minWidth: Size.large, minHeight: Size.prominent)"),
        (comp, ".frame(minHeight: Size.minTarget + Space.s8)"), (comp, ".frame(width: 18, height: 18)"),
        (comp, ".padding(.horizontal, Space.s12).frame(minHeight: Size.minTarget - Space.s12)"),
        (chat, "Spacer(minLength: Space.s48)"), (chat, "HStack(alignment: .bottom, spacing: Space.s8)"),
        (chat, ".frame(width: Space.s8, height: Space.s8)"), (chat, "RoundedRectangle(cornerRadius: Size.regular / 2, style: .continuous)"),
        (av, "DebbieAvatar(size: Size.avatarHero * 0.75)"), (av, ".overlay(Circle().strokeBorder(Color.dCanvas, lineWidth: 3))"),
        (views, "RoundedRectangle(cornerRadius: Radius.r28, style: .continuous)"), (views, ".padding(.top, Space.s32)"),
    ]:
        code_has(path, snip)

    data = {
        "about": "Debbie's layout values in iOS points (pt). 1 pt = 2 px on iPhone SE (@2x) and 3 px on iPhone 17 Pro / Pro Max (@3x). "
                 "Read from Tokens.swift and the component code (build 3). The app is light only.",
        "devices": DEVICES,
        "space": [{"token": f"Space.{n}", "craft": f"space.{n[1:]}", "value": v, "use": SPACE_USE[n]} for n, v in swift["space"]],
        "radius": [{"token": f"Radius.{n}", "craft": f"radius.{n[1:]}", "value": v, "use": RADIUS_USE[n]} for n, v in swift["radius"]]
                  + [{"token": "Capsule", "value": "height / 2", "use": "Buttons, badges, chips, the tab bar, its selection highlight, switches"}],
        "cornerStyle": "continuous (Apple's smooth squircle corners). Figma: set corner smoothing to 60 % (the iOS preset).",
        "size": [{"token": f"Size.{n}", "value": v, "use": SIZE_USE[n]} for n, v in swift["size"]],
        "touchTargets": [
            {"tier": "every control", "min": "44 × 44", "for": "All controls, icon buttons (glyph 20–28 pt inside), rows"},
            {"tier": "compact", "minHeight": Z("minTarget"), "for": "Small in-row buttons (the chat's urgent-row Open)"},
            {"tier": "regular", "minHeight": Z("regular"), "for": "Secondary actions in content, Cancel, Try the Demo"},
            {"tier": "large", "minHeight": Z("large"), "fullWidth": True, "for": "The screen's main action"},
            {"tier": "prominent", "minHeight": Z("prominent"), "fullWidth": True, "for": "Alert responses and live-view Stop"},
            {"tier": "resident", "minHeight": Z("resident"), "fullWidth": True, "for": "Every resident control"},
        ],
        "gaps": {"betweenBezeledControls": 12, "aroundBorderlessButtons": 24, "beforeDestructiveAction": 32},
        "screen": {"sideMargin": S("s20"), "headerRowPaddingTopBottom": S("s8"), "contentTopPadding": S("s8"), "gapBetweenBlocks": S("s16"),
                   "contentBottomPadding": S("s24"), "pinnedActionStrip": {"sidePadding": S("s20"), "topBottomPadding": S("s12"), "gapBetweenButtons": S("s8"),
                                                                           "background": "bg.canvas"}},
        "topBar": {"minHeight": Z("minTarget"), "sidePadding": S("s16"), "topBottomPadding": S("s4"), "backButton": [Z("minTarget"), Z("minTarget")],
                   "title": "headline, text.primary", "gap": S("s8")},
        "sheetHeader": {"close": [Z("minTarget"), Z("minTarget")], "closeEdge": "leading", "title": "title (22/28 rounded bold)", "gap": S("s8"),
                        "sidePadding": S("s20"), "topPadding": S("s16")},
        "tabBar": {
            "material": "Liquid Glass (system .regular, interactive) capsule; 1.5 pt border.control outline with Increase Contrast",
            "insetFromScreenEdges": S("s20"), "gapAboveBottomSafeArea": S("s4"), "innerPadding": S("s4"), "height": tab_bar_h,
            "pageClearance": tab_bar_h + S("s4"), "items": 5, "itemWidth": item_w, "itemMinHeight": Z("tabItem"), "iconBox": Z("tabIcon"),
            "iconSize": "title3 (20 pt) Medium", "label": "tabLabel: footnote 13/18 Semibold, no gap under the icon",
            "selected": "mint.tint capsule filling the item (item width × 52), filled glyph, glyph and label in accent.text; unselected: outline glyph in text.secondary",
            "avatarTab": {"size": Z("tabAvatar"), "selectedRing": "2 pt accent.text", "unselectedRing": "1 pt border.control at 35 % opacity"},
            "badge": {"fill": "urgent.fill", "minWidth": S("s16") + S("s4"), "height": 18, "sidePadding": S("s4"), "text": "tabLabel, tabular digits, text.onUrgent, '9+' above 9",
                      "offsetFromIconTopRight": {"x": S("s12"), "y": -S("s4")}},
            "pressedScale": 0.97, "dynamicTypeMax": "xLarge", "hidesWhile": "typing to Debbie on her tab"},
        "cornerButton": {"size": [Z("minTarget"), Z("minTarget")], "shape": "circle, Liquid Glass", "glyph": "gear at title3 (20 pt) Medium, text.primary",
                         "outline": "1.5 pt border.control with Increase Contrast or Show Borders", "pressedScale": 0.97,
                         "placement": "top-right of each main screen's header row; the Demo badge sits 8 pt to its left in the demo"},
        "cards": {"padding": S("s16"), "radius": R("r20"), "fill": "bg.surface (or a tint)", "shadow": "none", "gapBetween": S("s16"),
                  "increaseContrastOutline": "1.5 pt border.control"},
        "statusCard": {"rowsGap": S("s12"), "headline": "hero, with the status glyph at title size 12 pt to its left", "rowMinHeight": Z("minTarget"),
                       "fill": "mint.tint when on, caution.tint when limited or unreachable, bg.surface when unknown"},
        "alertCard": {"stackGap": S("s8"), "button": "I'm On It: prominent (64) on the leading card, large (56) on others", "tierRow": "glyph + tier word, 8 apart"},
        "statusRow": {"minHeight": Z("minTarget"), "glyphToText": S("s12"), "glyph": "headline size"},
        "buttons": {"shape": "capsule", "padding": {"sides": S("s20"), "topBottom": S("s12")}, "heights": {"compact": Z("minTarget"), "regular": Z("regular"),
                    "large": Z("large"), "prominent": Z("prominent"), "resident": Z("resident")}, "fullWidth": ["large", "prominent", "resident"],
                    "iconToLabel": S("s8"), "label": "button (17/22 Semibold); resident: residentLabel (20/25 Semibold)", "pressedScale": 0.97,
                    "secondaryOutline": "1.5 pt border.control", "spinner": "18 pt ring, 2.5 pt stroke, 8 pt before the label"},
        "controls": {
            "switch": {"track": [52, 32], "knob": 24, "knobInset": 4, "rowMinHeight": Z("regular"), "outline": "1 pt border.control",
                       "on": "mint.fill track, text.onMint knob", "off": "bg.sunken track, text.secondary knob"},
            "textField": {"labelGap": S("s8"), "minHeight": Z("regular"), "sidePadding": S("s16"), "radius": R("r12"), "fill": "bg.sunken",
                          "outline": "1 pt border.control; 2 pt focus.ring when focused; 2 pt urgent.text with an error"},
            "choiceCard": {"padding": S("s16"), "minHeight": Z("large"), "radius": R("r20"), "iconToText": S("s12"),
                           "unselected": "bg.surface + 1 pt border.control", "selected": "mint.tint + 2.5 pt accent.text"},
            "codeDisplay": {"digits": 4, "box": [Z("large"), Z("prominent")], "radius": R("r12"), "fill": "bg.sunken", "gap": S("s12"), "type": "metric"},
            "demoBadge": {"height": Z("minTarget") - S("s12"), "sidePadding": S("s12"), "fill": "mint.tint", "outline": "1 pt accent.text",
                          "text": "secondary Semibold, text.primary"},
        },
        "avatar": {"sizes": {"tab": Z("tabAvatar"), "chatHeader": Z("avatarSmall"), "guide": Z("avatarGuide"), "primingPortrait": Z("avatarHero") * 0.75,
                             "welcome": Z("avatarHero")}, "background": "mint.tint circle", "idleMotionFrom": Z("avatarGuide"),
                   "primingBadge": {"size": 36, "fill": "mint.fill", "ring": "3 pt bg.canvas", "placement": "bottom-right of the 111 pt portrait"},
                   "guideBubble": {"gap": S("s12"), "padding": S("s16"), "radius": R("r20"), "fill": "bg.surface"}},
        "chat": {"bubble": {"padding": {"sides": S("s16"), "topBottom": S("s12")}, "radius": R("r20"),
                            "maxWidth": "screen width − 96 pt", "maxWidthByDevice": bubble,
                            "debbie": "left, bg.surface", "you": "right, mint.tint", "text": "body, text.primary"},
                 "messageGap": S("s12"), "typing": {"dots": 3, "dot": S("s8"), "dotGap": S("s4")},
                 "chips": {"shape": "capsule, 1 pt border.control", "padding": {"sides": S("s16"), "topBottom": S("s8")}, "minHeight": Z("minTarget"),
                           "gap": S("s8"), "text": "secondary Semibold, accent.text"},
                 "composer": {"field": {"minHeight": Z("regular"), "radius": Z("regular") / 2, "fill": "bg.surface", "padding": {"sides": S("s16"), "topBottom": S("s8")},
                                        "outline": "1 pt border.control; 2 pt focus.ring when focused", "grows": "to 4 lines"},
                              "send": {"size": Z("regular"), "fill": "mint.fill", "glyph": "headline size, text.onMint"}, "gap": S("s8")},
                 "header": {"avatar": Z("avatarSmall"), "gap": S("s12"), "title": "title + secondary subtitle"},
                 "urgentRow": {"fill": "urgent.tint", "radius": R("r12"), "padding": S("s12")}},
        "liveView": {"background": "live.scrim", "contentPadding": S("s20"), "videoRadius": R("r20"),
                     "liveBar": {"minHeight": Z("minTarget") + S("s8"), "radius": R("r12"), "fill": "live.fill", "outline": "1.5 pt white",
                                 "sidePadding": S("s16"), "gap": S("s12"), "placement": "pinned 8 pt below the top safe area, 20 pt margins"},
                     "stop": "urgent, prominent (64 pt), pinned 8 pt above the bottom safe area, 20 pt margins"},
        "resident": {"greeting": {"avatar": Z("avatarGuide"), "gap": S("s16")},
                     "heartCard": {"fill": "mint.tint", "radius": R("r28"), "padding": {"topBottom": S("s24"), "sides": S("s16")}, "stackGap": S("s8"),
                                   "reading": "DReading 64 pt"},
                     "sentPill": {"fill": "bg.surface", "radius": R("r20"), "padding": {"sides": S("s16"), "topBottom": S("s12")}},
                     "syncNow": "resident button: 96 pt tall, full width, mint, pinned"},
        "welcome": {"stackGap": S("s20"), "topPadding": S("s32"), "avatar": Z("avatarHero"), "wordmarkHeight": Z("brandWordmark"),
                    "actions": "Get Started (large 56) and Try the Demo (quiet, regular 48), pinned"},
        "strokes": {"1": "chips, text fields, chat field, switch track, unselected choice cards, unselected Debbie tab ring",
                    "1.5": "secondary buttons, every Increase Contrast outline, the LIVE bar's white outline",
                    "2": "focus ring, a field's error outline, the selected Debbie tab ring", "2.5": "a selected choice card; the spinner",
                    "3": "the canvas ring around the badge on Debbie's portrait"},
        "differencesFromCraft": [
            "Chat bubble width: CRAFT §5 says screen − 48 pt; the code keeps 48 pt plus the 8 pt stack gap free beside the 20 pt margins, so the widest bubble is screen − 96 pt.",
            "Your chat bubbles: CRAFT §5 says mint.fill with text.onMint; the code uses mint.tint with text.primary (Send keeps the mint fill).",
            "Demo badge: CRAFT §5 says 44 pt tall; the code draws a 32 pt capsule (44 − 12).",
            "Space.s48: CRAFT §2.3 reserves it for breathing room on hero, empty and onboarding screens; build 3 uses it only beside chat bubbles.",
            "Top bar side padding is 16 pt (Space.s16), not the 20 pt screen margin.",
        ],
        "sources": [SRC_TOKENS, f"{DS}/Chrome/DebbieTabBar.swift", f"{DS}/Chrome/DebbieCornerButton.swift", f"{DS}/Components/Components.swift",
                    f"{DS}/Components/Chat.swift", f"{DS}/Persona/DebbieAvatar.swift", views, "CRAFT.md §2.3–§2.5, §5"],
    }
    write_json(os.path.join(LAYOUT, "layout.json"), data)

    f = fmt
    md = ["# Layout\n"]
    md.append("Every value here is in **iOS points (pt)**. On iPhone SE 1 pt = 2 px; on iPhone 17 Pro and Pro Max 1 pt = 3 px. "
              "Values come from the app's code (build 3), mostly `Tokens.swift`, which is the only place the app writes them down. "
              "Where `CRAFT.md` and the code disagree, the code wins and the difference is listed at the end.\n")
    md.append("## The grid in one minute\n")
    md.append(f"- **{f(S('s20'))} pt side margins** on every screen. Content is {f(DEVICES[0]['points'][0] - 2 * S('s20'))} pt wide on iPhone SE and {f(DEVICES[1]['points'][0] - 2 * S('s20'))} pt on iPhone 17 Pro Max.")
    md.append(f"- **Cards**: {f(S('s16'))} pt padding, {f(R('r20'))} pt continuous corners, `bg.surface` fill, no shadow, {f(S('s16'))} pt apart.")
    md.append(f"- **One main button** per screen, pinned above the home indicator: full width, {f(Z('large'))} pt tall, capsule.")
    md.append(f"- **Touch targets** are at least {f(Z('minTarget'))} × {f(Z('minTarget'))} pt; bigger for alerts ({f(Z('prominent'))}) and for the person at home ({f(Z('resident'))}).")
    md.append(f"- **Floating tab bar**: a glass capsule {f(tab_bar_h)} pt tall, {f(S('s20'))} pt in from the screen edges, {f(S('s4'))} pt above the home indicator.")
    md.append("- **Spacing comes from one scale**: 4, 8, 12, 16, 20, 24, 32, 48. **Corners from three radii**: 12, 20, 28, plus capsules.\n")
    md.append("## Screens\n")
    md.append(table(["Device", "Points", "Scale", "Pixels", "Safe area top / bottom", "Note"],
                    [[d["device"], f"{d['points'][0]} × {d['points'][1]}", f"@{d['scale']}x", f"{d['pixels'][0]} × {d['pixels'][1]}",
                      f"{d['safeArea']['top']} / {d['safeArea']['bottom']}", d["note"]] for d in DEVICES]) + "\n")
    md.append("## Spacing scale (`Space`)\n")
    md.append(table(["Token", "Value", "Used for"], [[f"`Space.{n}`", f"{f(v)} pt", SPACE_USE[n]] for n, v in swift["space"]]) + "\n")
    md.append("Gaps between controls: at least 12 pt between filled or outlined buttons, 24 pt around text-only buttons, 32 pt before a destructive action.\n")
    md.append("## Corner radii (`Radius`)\n")
    md.append(table(["Token", "Value", "Used on"], [[f"`Radius.{n}`", f"{f(v)} pt", RADIUS_USE[n]] for n, v in swift["radius"]]
                    + [["Capsule", "height ÷ 2", "Buttons, badges, chips, the tab bar and its highlight, switches"]]) + "\n")
    md.append("All corners are **continuous** (Apple's smooth squircle corners, `style: .continuous`), not plain circular arcs. "
              "In Figma set **corner smoothing to 60 %** (the iOS preset). A shape inside another rounded shape uses a smaller, concentric radius (outer radius minus the padding).\n")
    md.append("## Fixed sizes (`Size`)\n")
    md.append(table(["Token", "Value", "What"], [[f"`Size.{n}`", f"{f(v)} pt", SIZE_USE[n]] for n, v in swift["size"]]) + "\n")
    md.append("## Touch targets\n")
    md.append(table(["Tier", "Minimum height", "Width", "For"], [
        ["Every control", "44 × 44 hit area", "—", "All controls, icon buttons (glyph 20–28 pt inside), rows"],
        ["compact", f"{f(Z('minTarget'))} pt", "fits its label", "Small in-row buttons (the chat's urgent-row Open)"],
        ["regular", f"{f(Z('regular'))} pt", "fits its label", "Secondary actions, Cancel, Try the Demo, Send"],
        ["large", f"{f(Z('large'))} pt", "full width", "The screen's main action"],
        ["prominent", f"{f(Z('prominent'))} pt", "full width", "Alert responses (I'm On It on the leading card), live-view Stop"],
        ["resident", f"{f(Z('resident'))} pt", "full width", "Every control on the resident's screen (Sync Now)"],
    ]) + "\n")
    md.append("## Screen structure\n")
    md.append(f"- **Tab screens** (Home, Live, History, Devices): a header row with the title in `hero` (34 / 41 rounded bold) on the left and the corner controls on the right, "
              f"{f(S('s8'))} pt above and below. Home's header row shows the home's name in `headline` instead; the status card's headline is Home's title. "
              f"Content starts {f(S('s8'))} pt below the header, blocks are {f(S('s16'))} pt apart, and the content ends {f(S('s24'))} pt above the tab bar's clearance. "
              "The header stays put while content scrolls under it; at accessibility text sizes it scrolls away with the content.")
    md.append(f"- **Pinned main button**: a strip above the home indicator with {f(S('s20'))} pt side padding, {f(S('s12'))} pt above and below, on `bg.canvas`; two buttons stack {f(S('s8'))} pt apart.")
    md.append(f"- **Pushed screens** (an alert's detail): a top bar at least {f(Z('minTarget'))} pt tall with {f(S('s16'))} pt side padding and {f(S('s4'))} pt above and below: "
              f"Back ({f(Z('minTarget'))} × {f(Z('minTarget'))}, glyph in `accent.text`), then the title in `headline`, {f(S('s8'))} pt apart.")
    md.append(f"- **Sheets** (Settings, Add a Laptop, confirmations): Close ({f(Z('minTarget'))} × {f(Z('minTarget'))}) on the leading edge, then the title in `title` (22 / 28 rounded bold), "
              f"{f(S('s8'))} pt apart, with {f(S('s20'))} pt side padding and {f(S('s16'))} pt above.\n")
    md.append("## Floating tab bar\n")
    md.append(table(["Part", "Value"], [
        ["Shape and material", "A capsule of Liquid Glass (the system's regular, interactive glass). Increase Contrast adds a 1.5 pt `border.control` outline."],
        ["Position", f"{f(S('s20'))} pt in from the left and right screen edges; {f(S('s4'))} pt above the bottom safe area (the home indicator; 0 pt on iPhone SE). Floats over the content."],
        ["Size", f"{f(tab_bar_h)} pt tall: {f(Z('tabItem'))} pt items inside {f(S('s4'))} pt padding. Pages reserve {f(tab_bar_h + S('s4'))} pt at the bottom so content scrolls clear of it."],
        ["Items", "5 equal items: Home, Live, Debbie (centre), History, Devices. Width = (screen − 48) ÷ 5: "
                  + ", ".join(f"{v} pt on {k}" for k, v in item_w.items()) + "."],
        ["Item content", f"Icon in a {f(Z('tabIcon'))} pt tall box (drawn at Title 3 size, 20 pt, Medium), label in `tabLabel` (Footnote Semibold 13 / 18) directly under it, no gap."],
        ["Selected", f"A `mint.tint` capsule fills the item (item width × {f(Z('tabItem'))} pt); the icon switches to its filled version; icon and label in `accent.text`. "
                     "Unselected: outline icon and label in `text.secondary`. The highlight slides between tabs (see `../09-motion`)."],
        ["Debbie tab", f"Her face, {f(Z('tabAvatar'))} pt circle, instead of an icon: 2 pt `accent.text` ring when selected, 1 pt `border.control` at 35 % opacity when not."],
        ["Badge", f"Unanswered urgent alerts on Home: an `urgent.fill` capsule at least {f(S('s16') + S('s4'))} pt wide and 18 pt tall, {f(S('s4'))} pt side padding, "
                  f"count in `tabLabel` with tabular digits in `text.onUrgent` (\"9+\" above 9), offset {f(S('s12'))} pt right and {f(S('s4'))} pt up from the icon's top-right corner."],
        ["Pressed", "The item shrinks to 97 %. No haptic (Apple's tab bars have none)."],
        ["Text size", "Icons and labels stop growing at xLarge; a long-press shows the large preview at accessibility sizes."],
        ["Hidden", "Only while you type to Debbie on her own tab, so the field sits on the keyboard."],
    ]) + "\n")
    md.append("## Corner button (Settings gear)\n")
    md.append(f"A {f(Z('minTarget'))} × {f(Z('minTarget'))} pt Liquid Glass circle in the top-right of each main screen's header row. The gear is drawn at Title 3 size (20 pt, Medium) in `text.primary`. "
              "It shrinks to 97 % when pressed, turns one tooth on tap (`../09-motion`), has no haptic, and gets a 1.5 pt `border.control` outline with Increase Contrast or Show Borders. "
              f"In the demo, the Demo badge sits {f(S('s8'))} pt to its left.\n")
    md.append("## Cards, rows and buttons\n")
    md.append(table(["Element", "Geometry"], [
        ["Card", f"{f(S('s16'))} pt padding on all sides, {f(R('r20'))} pt continuous corners, full content width, `bg.surface` or a tint, no shadow; {f(S('s16'))} pt between cards. Increase Contrast: 1.5 pt `border.control`."],
        ["Home status card", f"A card tinted `mint.tint` (on), `caution.tint` (limited or unreachable) or `bg.surface` (unknown). Headline in `hero` with the status glyph at Title 2 size {f(S('s12'))} pt to its left; then three status rows, {f(S('s12'))} pt apart."],
        ["Alert card", f"A card ({f(S('s8'))} pt stack): tier glyph + word (Subheadline Semibold), title (`headline`), time (`secondary`), then I'm On It: {f(Z('prominent'))} pt on the leading card, {f(Z('large'))} pt on others. Solid `urgent.fill` only for the newest unanswered urgent alert."],
        ["Status row", f"At least {f(Z('minTarget'))} pt tall. Glyph at Headline size, {f(S('s12'))} pt to the text. Value (Body Semibold) over detail (Subheadline)."],
        ["Choice card", f"{f(S('s16'))} pt padding, at least {f(Z('large'))} pt tall, {f(R('r20'))} pt corners; icon {f(S('s12'))} pt from a Headline title over a Subheadline detail. Unselected `bg.surface` + 1 pt `border.control`; selected `mint.tint` + 2.5 pt `accent.text`."],
        ["Button", f"Capsule. {f(S('s20'))} pt side padding, {f(S('s12'))} pt top and bottom; heights {f(Z('minTarget'))} / {f(Z('regular'))} / {f(Z('large'))} / {f(Z('prominent'))} / {f(Z('resident'))} pt "
                   f"(compact / regular / large / prominent / resident); large and up are full width. Icon {f(S('s8'))} pt before the label. Secondary buttons have a 1.5 pt `border.control` outline. Pressed: 97 %."],
        ["Spinner", "18 pt ring, 2.5 pt stroke with round ends, 70 % of a circle, 8 pt before the button label."],
        ["Switch", f"Track 52 × 32 pt capsule (1 pt `border.control`), knob 24 pt with 4 pt inset. On: `mint.fill` track, `text.onMint` knob. Off: `bg.sunken` track, `text.secondary` knob. Row at least {f(Z('regular'))} pt."],
        ["Text field", f"Label (Body Semibold) {f(S('s8'))} pt above a field at least {f(Z('regular'))} pt tall, {f(S('s16'))} pt side padding, {f(R('r12'))} pt corners, `bg.sunken`, 1 pt `border.control` (2 pt `focus.ring` focused, 2 pt `urgent.text` with an error)."],
        ["Pairing code", f"4 boxes, each at least {f(Z('large'))} × {f(Z('prominent'))} pt, {f(R('r12'))} pt corners, `bg.sunken`, {f(S('s12'))} pt apart; digits in `metric`."],
        ["Demo badge", f"Capsule {f(Z('minTarget') - S('s12'))} pt tall, {f(S('s12'))} pt side padding, `mint.tint` with a 1 pt `accent.text` outline; \"Demo\" in Subheadline Semibold."],
        ["Empty state", f"Centred: illustration up to 140 pt tall, title (`title`), message (`body`, `text.secondary`), {f(S('s12'))} pt apart, {f(S('s24'))} pt padding."],
    ]) + "\n")
    md.append("## Debbie's avatar\n")
    md.append(table(["Where", "Size", "Notes"], [
        ["Centre tab", f"{f(Z('tabAvatar'))} pt", "Holds still"],
        ["Chat header", f"{f(Z('avatarSmall'))} pt", f"Beside \"Debbie\" (`title`) and her subtitle, {f(S('s12'))} pt apart; holds still"],
        ["Onboarding guide and the resident's greeting", f"{f(Z('avatarGuide'))} pt", f"Beside a `bg.surface` speech bubble ({f(R('r20'))} pt corners, {f(S('s16'))} pt padding), {f(S('s12'))} pt apart; idle motion"],
        ["Permission screens", f"{f(Z('avatarHero') * 0.75)} pt", "With a 36 pt `mint.fill` badge at the bottom-right (3 pt `bg.canvas` ring, icon in `text.onMint`)"],
        ["Welcome", f"{f(Z('avatarHero'))} pt", "Above the wordmark; idle motion"],
    ]) + "\n")
    md.append(f"Always a circle on `mint.tint`. She breathes, tilts and blinks only at {f(Z('avatarGuide'))} pt and above (details in `../07-debbie`).\n")
    md.append("## Chat with Debbie\n")
    md.append(table(["Part", "Geometry"], [
        ["Bubbles", f"{f(S('s16'))} pt side padding, {f(S('s12'))} pt top and bottom, {f(R('r20'))} pt corners; text in `body`, `text.primary`. Debbie's on the left in `bg.surface`; yours on the right in `mint.tint`. "
                    f"Messages {f(S('s12'))} pt apart."],
        ["Widest bubble", "Screen width − 96 pt (20 pt margins on both sides, then 8 pt + 48 pt kept free on the far side): "
                          + ", ".join(f"{f(v)} pt on {k}" for k, v in bubble.items()) + "."],
        ["Typing bubble", f"Three {f(S('s8'))} pt dots, {f(S('s4'))} pt apart, in a `bg.surface` bubble with the same padding."],
        ["Suggestion chips", f"Capsules with a 1 pt `border.control` outline, {f(S('s16'))} pt side and {f(S('s8'))} pt top and bottom padding, at least {f(Z('minTarget'))} pt tall, {f(S('s8'))} pt apart, wrapping onto new lines; text in Subheadline Semibold, `accent.text`."],
        ["Message field", f"At least {f(Z('regular'))} pt tall with {f(Z('regular') / 2)} pt corners, `bg.surface`, 1 pt `border.control` (2 pt `focus.ring` focused), {f(S('s16'))} pt side padding; grows to 4 lines."],
        ["Send / Stop", f"A {f(Z('regular'))} pt `mint.fill` circle, {f(S('s8'))} pt right of the field, glyph at Headline size in `text.onMint`. Appears only when there's text."],
        ["Urgent row", f"`urgent.tint`, {f(R('r12'))} pt corners, {f(S('s12'))} pt padding, pinned under the chat header while an urgent alert is unanswered."],
    ]) + "\n")
    md.append("## Live view\n")
    md.append(f"Always dark: `live.scrim` background, {f(S('s20'))} pt padding, video with {f(R('r20'))} pt corners. "
              f"The LIVE bar is at least {f(Z('minTarget') + S('s8'))} pt tall, `live.fill` with a 1.5 pt white outline and {f(R('r12'))} pt corners, {f(S('s16'))} pt side padding, "
              f"pinned {f(S('s8'))} pt below the top safe area with {f(S('s20'))} pt margins. Stop is a full-width {f(Z('prominent'))} pt `urgent.fill` button pinned {f(S('s8'))} pt above the bottom safe area.\n")
    md.append("## The resident's screen\n")
    md.append(f"No tab bar. A greeting row (Debbie {f(Z('avatarGuide'))} pt, then the greeting in `hero` over one `residentBody` line, {f(S('s16'))} pt apart); "
              f"the heart card (`mint.tint`, {f(R('r28'))} pt corners, {f(S('s24'))} pt top and bottom and {f(S('s16'))} pt side padding, centred stack {f(S('s8'))} pt apart, reading in `DReading` 64 pt); "
              f"the \"Sent to home\" pill (`bg.surface`, {f(R('r20'))} pt corners, {f(S('s16'))} / {f(S('s12'))} pt padding); and Sync Now, a full-width {f(Z('resident'))} pt mint button pinned at the bottom.\n")
    md.append("## Welcome screen\n")
    md.append(f"A centred stack {f(S('s20'))} pt apart, starting {f(S('s32'))} pt below the safe area: Debbie ({f(Z('avatarHero'))} pt), the wordmark ({f(Z('brandWordmark'))} pt tall), "
              f"\"Hi, I'm Debbie.\" (`hero`), the promise (`title`) and the safety note (`secondary`). Get Started ({f(Z('large'))} pt, mint) and Try the Demo ({f(Z('regular'))} pt, quiet) are pinned at the bottom.\n")
    md.append("## Line widths\n")
    md.append(table(["Width", "Used for"], [[f"{k} pt", v] for k, v in data["strokes"].items()]) + "\n")
    md.append("## Differences from CRAFT.md (the code wins)\n")
    md.append("\n".join(f"- {d}" for d in data["differencesFromCraft"]) + "\n")
    md.append("## Files and sources\n")
    md.append("- `layout.json`: every value above, for tools.")
    md.append("- Sources: " + ", ".join(f"`{s}`" for s in data["sources"]) + ".")
    md.append(f"- {REGEN}")
    write(os.path.join(LAYOUT, "layout.md"), "\n".join(md))


# ---------------------------------------------------------------- 01-brand

def svg_inner(svg):
    m = re.search(r"<svg[^>]*>(.*)</svg>", svg, re.S)
    if not m:
        die("can't parse SVG")
    return m.group(1).strip()


def recolour(svg, hexv):
    return svg.replace('"#000"', f'"{hexv}"').replace('"#000000"', f'"{hexv}"')


def reframe(svg, vb, w, h):
    head = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="{fmt(w)}" height="{fmt(h)}">'
    return re.sub(r"<svg[^>]*>", head, svg, count=1)


def build_brand(tokens, tmp, squircle_path):
    mark_src, word_src = read(SRC_MARK), read(SRC_WORDMARK)
    mark_d = re.search(r' d="([^"]+)"', mark_src).group(1)
    vb_word = [float(v) for v in re.search(r'viewBox="([^"]+)"', word_src).group(1).split()]
    if re.search(r'viewBox="([^"]+)"', mark_src).group(1).split() != ["0", "0", "100", "100"]:
        die("mark.svg is no longer on the 100-unit grid; update the brand geometry in brand-tokens-data.py")
    # Geometry this script relies on (brand.md quotes it): the D spans x 20-86, y 16-84; the wordmark ink spans x 6-326, y 8-80.
    for snip in ("M30 16 H52 A34 34 0 0 1 52 84 H30 Q20 84 20 74 V26 Q20 16 30 16 Z", "M49 39 A11 11 0 1 0 49.001 39 Z"):
        if snip not in mark_d:
            die("mark.svg geometry changed; update brand-tokens-data.py")
    if vb_word != [0, 0, 332, 90]:
        die("wordmark.svg canvas changed; update brand-tokens-data.py")
    T = {k: tokens[k]["light"] for k in ("mint.fill", "text.primary", "text.onMint", "bg.canvas", "mint.tint")}
    icon = {v: (field.upper(), glyph.upper())
            for v, field, glyph in re.findall(r'render (\w+) "(#[0-9A-Fa-f]{6})" "(#[0-9A-Fa-f]{6})"', read(SRC_ICON_SCRIPT))}
    if set(icon) != {"Any", "Dark", "Tinted"}:
        die("app-icon.sh variants changed")
    scale = re.search(r"scale\(([\d.]+)\) translate\(-53 -50\)", read(SRC_ICON_SCRIPT))
    icon_scale = float(scale.group(1)) if scale else die("app-icon.sh glyph transform changed")
    launch = json.loads(read(SRC_LAUNCH))
    launch_light = next(c for c in launch["colors"] if not c.get("appearances"))["color"]["components"]
    launch_hex = "#" + "".join(f"{round(float(launch_light[k]) * 255):02X}" for k in ("red", "green", "blue"))
    colours = {"ink": T["text.primary"], "white": "#FFFFFF", "mint": T["mint.fill"]}

    for sub in ("svg", "png", "pdf", "app-icon"):
        os.makedirs(os.path.join(BRAND, sub), exist_ok=True)
    shutil.copyfile(SRC_MARK, os.path.join(BRAND, "svg", "mark.svg"))
    shutil.copyfile(SRC_WORDMARK, os.path.join(BRAND, "svg", "wordmark.svg"))

    art = os.path.join(tmp, "art")
    os.makedirs(art, exist_ok=True)
    jobs = []  # (svg, width px, height px, format, out)

    def mark_svg(hexv, vb="19 16 68 68", w=68, h=68, outline=False):
        body = (f'<path fill="none" stroke="{hexv}" stroke-width="2.5" stroke-linejoin="round" d="{mark_d}"/>' if outline
                else f'<path fill-rule="evenodd" fill="{hexv}" d="{mark_d}"/>')
        return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="{fmt(w)}" height="{fmt(h)}">{body}</svg>\n'

    def word_svg(hexv):
        return reframe(recolour(word_src, hexv), "6 4 320 80", 320, 80)

    for c, hx in colours.items():
        ms, ws = os.path.join(art, f"mark-{c}.svg"), os.path.join(art, f"wordmark-{c}.svg")
        write(ms, mark_svg(hx))
        write(ws, word_svg(hx))
        if c != "mint":
            for pt in (64, 128):
                for k in (1, 2, 3):
                    jobs.append((ms, pt * k, pt * k, "png", os.path.join(BRAND, "png", f"mark-{c}-{pt}pt@{k}x.png")))
            for k in (1, 2, 3):
                jobs.append((ws, 120 * k, 30 * k, "png", os.path.join(BRAND, "png", f"wordmark-{c}-120pt@{k}x.png")))
        jobs.append((ms, 1024, 1024, "png", os.path.join(BRAND, "png", f"mark-{c}-1024px.png")))
        jobs.append((ws, 1024, 256, "png", os.path.join(BRAND, "png", f"wordmark-{c}-1024px.png")))
        jobs.append((ms, 1024, 1024, "pdf", os.path.join(BRAND, "pdf", f"mark-{c}.pdf")))
        jobs.append((ws, 1024, 256, "pdf", os.path.join(BRAND, "pdf", f"wordmark-{c}.pdf")))

    # The welcome lockup, in points: tile 64 (r20 continuous) at the top, mark frame 36 centred in it, 20 gap, wordmark frame 32 tall.
    tile, glyph, gap, wm_h = 64, 36, 20, 32
    wm_w = 332 * wm_h / 90
    tile_x = (wm_w - tile) / 2
    ink_left, ink_right, ink_bottom = 6 * wm_h / 90, 326 * wm_h / 90, tile + gap + 80 * wm_h / 90
    cx, cy = (ink_left + ink_right) / 2, ink_bottom / 2
    side = 1024 / 7  # 7 px per point in the 1024 px export
    if side - (ink_right - ink_left) < 2 * 16 or side - ink_bottom < 2 * 16:
        die("lockup clear space below 16 pt")
    vb = f"{cx - side / 2:.4f} {cy - side / 2:.4f} {side:.4f} {side:.4f}"
    word_inner = recolour(svg_inner(word_src), T["text.primary"])
    lockup_body = (
        f'<path fill="{T["mint.fill"]}" transform="translate({tile_x:.4f} 0)" d="{squircle_path}"/>\n'
        f'<path fill-rule="evenodd" fill="{T["text.onMint"]}" transform="translate({tile_x + (tile - glyph) / 2:.4f} {(tile - glyph) / 2:.4f}) scale({glyph / 100:.4f})" d="{mark_d}"/>\n'
        f'<g transform="translate(0 {tile + gap}) scale({wm_h / 90:.6f})">\n{word_inner}\n</g>\n')
    lockup = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="{side:.4f}" height="{side:.4f}">\n'
              f'<!-- Debbie welcome lockup (build-1 welcome screen). Units are iOS points. Tile 64 pt, continuous corners radius 20 ({T["mint.fill"]} mint.fill); '
              f'mark in a 36 pt frame ({T["text.onMint"]} text.onMint); 20 pt gap; wordmark 32 pt tall ({T["text.primary"]} text.primary). '
              f'Clear space of at least 16 pt is included. Generated by tools/design/kit/brand-tokens.sh. -->\n'
              + lockup_body + "</svg>\n")
    lockup_path = os.path.join(BRAND, "svg", "lockup-welcome.svg")
    write(lockup_path, lockup)
    jobs.append((lockup_path, 1024, 1024, "png", os.path.join(BRAND, "png", "lockup-welcome-1024px.png")))
    jobs.append((lockup_path, 1024, 1024, "pdf", os.path.join(BRAND, "pdf", "lockup-welcome.pdf")))

    # Temporary art for brand-usage.png (never shipped on its own).
    write(os.path.join(art, "mark-onmint.svg"), mark_svg(T["text.onMint"]))
    write(os.path.join(art, "mark-teal.svg"), mark_svg("#2A9D9A"))
    write(os.path.join(art, "mark-outline.svg"), mark_svg(T["text.primary"], vb="17 13 72 74", w=72, h=74, outline=True))
    write(os.path.join(art, "mark-tight.svg"), mark_svg(T["text.primary"], vb="20 16 66 68", w=66, h=68))
    write(os.path.join(art, "wordmark-tight.svg"), reframe(recolour(word_src, T["text.primary"]), "6 8 320 72", 320, 72))
    write(os.path.join(art, "lockup-tight.svg"), reframe(lockup, f"{ink_left:.4f} 0 {ink_right - ink_left:.4f} {ink_bottom:.4f}",
                                                          ink_right - ink_left, ink_bottom))
    for name, w, h in (("mark-onmint", 512, 512), ("mark-teal", 512, 512), ("mark-outline", 512, 526), ("mark-tight", 330, 340)):
        jobs.append((os.path.join(art, f"{name}.svg"), w, h, "png", os.path.join(art, f"{name}.png")))
    jobs.append((os.path.join(art, "mark-ink.svg"), 16, 16, "png", os.path.join(art, "min-mark.png")))
    jobs.append((os.path.join(art, "wordmark-ink.svg"), 64, 16, "png", os.path.join(art, "min-wordmark.png")))
    jobs.append((os.path.join(art, "lockup-tight.svg"), 96, round(96 * ink_bottom / (ink_right - ink_left)), "png", os.path.join(art, "min-lockup.png")))
    jobs.append((os.path.join(art, "wordmark-tight.svg"), 960, 216, "png", os.path.join(art, "wordmark-tight.png")))
    with open(os.path.join(tmp, "rsvg-jobs.tsv"), "w", encoding="utf-8") as f:
        for svg, w, h, kind, out in jobs:
            f.write(f"{svg}\t{w}\t{h}\t{kind}\t{out}\n")

    # App icon: copy the review renders (same pixels as the shipped 1024 px files) under kit names.
    sizes = [1024, 180, 120, 87, 80, 60, 58, 40, 16]
    for v in ("Any", "Dark", "Tinted"):
        for s in sizes:
            src = os.path.join(SRC_ICON_RAW, f"{v}-{s}.png")
            if not os.path.exists(src):
                die(f"missing {src}: run Design/scripts/app-icon.sh")
            shutil.copyfile(src, os.path.join(BRAND, "app-icon", f"app-icon-{v.lower()}-{s}.png"))
        if read_bytes(os.path.join(SRC_ICON_RAW, f"{v}-1024.png")) != read_bytes(os.path.join(SRC_ICON_SET, f"AppIcon-{v}.png")):
            warn(f"{SRC_ICON_RAW}/{v}-1024.png differs from the shipped {SRC_ICON_SET}/AppIcon-{v}.png: re-run Design/scripts/app-icon.sh")

    # Measured pairings for brand.md
    deep, icon_ink = icon["Dark"][0], icon["Any"][1]
    pr = lambda a, b: f"{contrast(a, b):.2f}:1"
    d_w, d_h = 66 * icon_scale, 68 * icon_scale

    # brand-usage.png spec
    usage = {
        "title": "Debbie brand usage",
        "subtitle": "The mark and wordmark are one flat colour from an approved pairing, with clear space around them. Everything on this sheet is drawn from the shipped artwork.",
        "footer": f"Sources: {SRC_MARK}, {SRC_WORDMARK}, CRAFT.md §2.8 (B1, B6). Rendered at 2x by tools/design/kit/brand-tokens.sh.",
        "scale": 2, "width": 1100, "ink": T["text.primary"], "ink2": tokens["text.secondary"]["light"], "canvas": T["bg.canvas"],
        "accent": tokens["accent.text"]["light"],
        "pairings": [
            {"label": "Ink on white", "detail": f"{T['text.primary']} on #FFFFFF · {pr(T['text.primary'], '#FFFFFF')}", "background": "#FFFFFF",
             "image": os.path.join(BRAND, "png", "mark-ink-1024px.png"), "caption": ""},
            {"label": "White on ink", "detail": f"#FFFFFF on {T['text.primary']} · {pr('#FFFFFF', T['text.primary'])}", "background": T["text.primary"],
             "image": os.path.join(BRAND, "png", "mark-white-1024px.png"), "caption": ""},
            {"label": "Ink on mint", "detail": f"{T['text.onMint']} on {T['mint.fill']} · {pr(T['text.onMint'], T['mint.fill'])}", "background": T["mint.fill"],
             "image": os.path.join(art, "mark-onmint.png"), "caption": ""},
            {"label": "Mint on deep green", "detail": f"{T['mint.fill']} on {deep} · {pr(T['mint.fill'], deep)}", "background": deep,
             "image": os.path.join(BRAND, "png", "mark-mint-1024px.png"), "caption": ""},
        ],
        "donts": [
            {"label": "Mint on white", "detail": f"{pr(T['mint.fill'], '#FFFFFF')}: it disappears", "background": "#FFFFFF",
             "image": os.path.join(BRAND, "png", "mark-mint-1024px.png"), "mode": "normal"},
            {"label": "Shifted to teal", "detail": "Mint stays mint", "background": "#FFFFFF", "image": os.path.join(art, "mark-teal.png"), "mode": "normal"},
            {"label": "Stretched", "detail": "Keep the proportions", "background": "#FFFFFF", "image": os.path.join(BRAND, "png", "mark-ink-1024px.png"), "mode": "stretch"},
            {"label": "Outlined or shadowed", "detail": "Flat and solid only", "background": "#FFFFFF", "image": os.path.join(art, "mark-outline.png"), "mode": "shadow"},
        ],
        "clearMarkImage": os.path.join(art, "mark-tight.png"), "clearMarkWidthPt": 96 * 66 / 68, "clearMarkHeightPt": 96, "clearPadPt": 0.25 * 96 * 66 / 68,
        "clearCaption": "Mark: clear space = 25 % of the mark's width on every side (CRAFT B6). About 16 pt around a 64 pt mark.",
        "wordmarkClearImage": os.path.join(art, "wordmark-tight.png"), "wordmarkClearWidthPt": 240, "wordmarkClearHeightPt": 54,
        "wordmarkClearPadPt": 240 * 52 / 320,
        "wordmarkClearCaption": "Wordmark: clear space = its x-height, the height of the \"e\" (derived from the geometry; CRAFT sets none). 19.5 pt at 120 pt wide.",
        "minSizes": [
            {"label": "Mark: 16 px", "image": os.path.join(art, "min-mark.png"), "widthPt": 8, "heightPt": 8},
            {"label": "Wordmark: 64 px wide", "image": os.path.join(art, "min-wordmark.png"), "widthPt": 32, "heightPt": 8},
            {"label": "Lockup: 96 px wide", "image": os.path.join(art, "min-lockup.png"), "widthPt": 48, "heightPt": 48 * ink_bottom / (ink_right - ink_left)},
        ],
        "minCaption": "Shown at their real minimum pixel sizes (this sheet is 2x, so each is drawn at half that many points). Never smaller (CRAFT B6).",
    }
    write_json(os.path.join(tmp, "sheet.json"), usage)

    md = ["# Brand: mark, wordmark, lockup and app icon\n"]
    md.append("Debbie's brand is two pieces of custom vector art: the **mark** (a rounded \"D\" with a round window cut through it) and the **wordmark** "
              "(\"debbie\", hand-drawn in lowercase). Both are flat, one colour, built from simple geometry, and never traced from a font. "
              f"Mint `{T['mint.fill']}` is the signature colour. Everything here is generated from the app's own sources, so it matches build 3 exactly.\n")
    md.append("## What's in this folder\n")
    md.append(table(["File", "What it is", "Use it for"], [
        ["`brand-usage.png`", "One page: approved pairings, things not to do, clear space and minimum sizes", "Quick visual reference"],
        ["`svg/mark.svg`, `svg/wordmark.svg`", "The master vectors, copied unchanged from `Design/brand/`. They're drawn in black on purpose: set the colour to an approved one when you use them", "Figma (drag in, set the fill or stroke)"],
        ["`svg/lockup-welcome.svg`", "The welcome lockup: the mark on its mint tile with the wordmark beneath, in its real colours, clear space included. 1 unit = 1 iOS point", "Title slides, end cards"],
        ["`pdf/mark-*.pdf`, `pdf/wordmark-*.pdf`, `pdf/lockup-welcome.pdf`", "The same art as vector PDFs, in ink, white and mint", "Keynote and After Effects (both import PDF as vector; in AE turn on Continuously Rasterize)"],
        ["`png/mark-{ink,white}-64pt@1x/2x/3x.png`, `-128pt@…`", "The mark trimmed to its edges, transparent background. \"64pt\" means the D is 64 pt tall (64, 128, 192 px)", "Pixel-exact phone mock-ups"],
        ["`png/mark-{ink,white,mint}-1024px.png`", "1024 × 1024 px masters", "Everything else"],
        ["`png/wordmark-{ink,white}-120pt@1x/2x/3x.png`", "The wordmark 120 pt wide on a 120 × 30 pt canvas (letters 27 pt tall)", "Phone mock-ups"],
        ["`png/wordmark-{ink,white,mint}-1024px.png`", "1024 × 256 px masters", "Everything else"],
        ["`png/lockup-welcome-1024px.png`", "The welcome lockup, 1024 × 1024 px, transparent, 7 px per point", "Slides"],
        ["`app-icon/app-icon-{any,dark,tinted}-<size>.png`", "The app icon exactly as shipped, three variants at nine sizes", "Home Screen mock-ups, slides"],
    ]) + "\n")
    md.append(f"Colour names in file names: **ink** = `{T['text.primary']}` (`text.primary`), **white** = `#FFFFFF`, **mint** = `{T['mint.fill']}` (`mint.fill`). "
              "White art on a transparent background looks empty in Finder's preview; it's there.\n")
    md.append("## The mark\n")
    md.append("- **\"Window D\"**: a D whose counter is a lit window (`MORNING_REPORT.md`). It was chosen over two other directions, which are kept in `Design/brand/explore/`.")
    md.append("- Geometry on the 100-unit grid of `mark.svg`: the D is 66 × 68 units (x 20–86, y 16–84). Its two left corners are rounded (radius 10); "
              "its right side is a half-circle of radius 34 centred at (52, 50). The window is a circle 22 units across, centred at (49, 50), slightly left of the bowl's centre.")
    md.append("- Two shapes, one colour, no outlines: CRAFT.md §2.8 B1 allows at most 3 primitives and nothing thinner than 6.25 % of the width, so it holds up at 16 px.\n")
    md.append("## The wordmark\n")
    md.append("- \"debbie\" in lowercase, built from circles and straight stems by `Design/scripts/wordmark.py` on its own grid. It is not a font, so never retype it (B2).")
    md.append("- Geometry (units of `wordmark.svg`, a 332 × 90 canvas): strokes 10 units wide with round ends; letter bowls of radius 21 (52 across, outside edge to outside edge); "
              "x-height 52; ascenders to y 8; baseline y 80; letters 10 units apart; the i's dot is 12.4 across. The letters fill 320 × 72 units.\n")
    md.append("## The welcome lockup\n")
    md.append("The mark on its mint tile, with the wordmark centred beneath. It was the header of the welcome screen in build 1. Since the redesign, the welcome screen shows "
              "Debbie's face (148 pt) above the wordmark instead (owner direction, D-030), so the lockup is now for slides, title cards and the end of the video.\n")
    md.append(table(["Part", "Value", "Colour"], [
        ["Tile", "64 × 64 pt with continuous corners of radius 20 (`Size.brandMark`, `Radius.r20`)", f"`mint.fill` `{T['mint.fill']}`"],
        ["Mark", "A 36 × 36 pt frame for the 100-unit artwork (`Size.brandGlyph`), centred in the tile; the D itself is 23.8 × 24.5 pt", f"`text.onMint` `{T['text.onMint']}`"],
        ["Gap", "20 pt (`Space.s20`)", ""],
        ["Wordmark", f"A 32 pt tall frame for the 90-unit artwork (`Size.brandWordmark`), {wm_w:.1f} pt wide; the letters are {ink_right - ink_left:.1f} × {72 * wm_h / 90:.1f} pt", f"`text.primary` `{T['text.primary']}`"],
        ["Overall", f"{ink_right - ink_left:.1f} × {ink_bottom:.1f} pt of artwork; the files add at least 16 pt of clear space", ""],
    ]) + "\n")
    md.append("Continuous corners are Apple's smooth \"squircle\" corners. In Figma use radius 20 with **corner smoothing 60 %** (the iOS preset); "
              "the SVG and PDF already contain the exact shape, taken from SwiftUI's own `RoundedRectangle(cornerRadius: 20, style: .continuous)`.\n")
    md.append("## Brand colours\n")
    md.append(table(["Colour", "Hex", "Token", "Used for"], [
        ["Mint", f"`{T['mint.fill']}`", "`mint.fill`", "The lockup tile, the Any app icon's background, primary buttons"],
        ["Ink", f"`{T['text.primary']}`", "`text.primary`", "The wordmark in the app; artwork on white"],
        ["Ink on mint", f"`{T['text.onMint']}`", "`text.onMint`", "The mark on the mint tile"],
        ["Icon ink", f"`{icon_ink}`", "app icon only", "The D on the Any app icon"],
        ["Deep green", f"`{deep}`", "app icon only", "The Dark app icon's background; the only background for mint artwork"],
        ["White", "`#FFFFFF`", "`bg.canvas`", "Backgrounds; white artwork on ink"],
        ["Mint tint", f"`{T['mint.tint']}`", "`mint.tint`", "The circle behind Debbie's face, calm surfaces"],
    ]) + "\n")
    md.append("## Approved pairings\n")
    md.append("Only these (CRAFT B1), each measured with the WCAG 2.x contrast ratio:\n")
    md.append(table(["Art", "On", "Contrast", "Seen in"], [
        [f"Ink `{T['text.primary']}`", "White `#FFFFFF`", pr(T["text.primary"], "#FFFFFF"), "The wordmark on the welcome screen"],
        ["White `#FFFFFF`", f"Ink `{T['text.primary']}`", pr("#FFFFFF", T["text.primary"]), "Dark slides"],
        [f"Ink on mint `{T['text.onMint']}`", f"Mint `{T['mint.fill']}`", pr(T["text.onMint"], T["mint.fill"]), "The lockup tile"],
        [f"Mint `{T['mint.fill']}`", f"Deep green `{deep}`", pr(T["mint.fill"], deep), "The Dark app icon"],
    ]) + "\n")
    md.append(f"The app icon's other pairs: icon ink `{icon_ink}` on mint is {pr(icon_ink, T['mint.fill'])} (Any); light grey `{icon['Tinted'][1]}` on black is "
              f"{pr(icon['Tinted'][1], icon['Tinted'][0])} (Tinted). **Never mint on white**: {pr(T['mint.fill'], '#FFFFFF')}, the mark disappears.\n")
    md.append("## Clear space and minimum sizes\n")
    md.append(table(["Art", "Clear space on every side", "Minimum size"], [
        ["Mark", "25 % of the mark's width (CRAFT B6): about 16 pt around a 64 pt mark", "16 px tall"],
        ["Wordmark", "Its x-height, the height of the letter \"e\" (72 % of the wordmark's height): 19.5 pt at 120 pt wide. CRAFT sets none for the wordmark; this one is derived from its geometry", "64 px wide"],
        ["Lockup", "25 % of the tile's width: 16 pt around the 64 pt tile (included in the lockup files)", "96 px wide"],
    ]) + "\n")
    md.append("## Don'ts\n")
    md.append("- Don't recolour outside the approved pairings. Never shift mint toward teal, sage or forest green, and never darken it to pass contrast: put ink on mint instead.")
    md.append("- Don't put mint art on white or other light backgrounds.")
    md.append("- Don't stretch, skew or rotate it, and don't add outlines, shadows, glows, gradients or bevels. Don't place it on photos or live footage (B6).")
    md.append("- Don't retype the wordmark in any font, re-space it or capitalise it. In sentences the name is \"Debbie\", with a capital D.")
    md.append("- Don't fill or move the D's window.")
    md.append("- Don't put the logo in the app's bars, on the launch screen or inside notifications: in the app the brand lives in content (B5, CRAFT P4).")
    md.append("- Don't use SF Symbols or any other system glyphs, icon packs, stock art or emoji for Debbie's icons: every glyph is custom (`../05-icons`).")
    md.append("- Don't add rounded corners, shadows or gloss to the app icon art: iOS draws the mask (B3).\n")
    md.append("## Where they appear in the app\n")
    md.append(table(["Where", "What", "Size", "Colour"], [
        ["Home Screen, Spotlight, Settings, notification banners", "App icon (Any, Dark or Tinted, following the iPhone's icon appearance)", "60 pt on the Home Screen", "As drawn"],
        ["Welcome screen (first launch), centred under Debbie's 148 pt portrait", "Wordmark", "32 pt tall frame; letters 113.8 × 25.6 pt", f"`text.primary` `{T['text.primary']}`"],
        ["Inside Debbie's avatar circle, only if her art fails to load (never in build 3)", "Mark on a mint circle", "The mark's 100-unit art is 52 % of the circle", "`text.onMint` on `mint.fill`"],
    ]) + "\n")
    md.append("Nowhere else: not in tab bars, top bars, the launch screen or notification content. Settings shows a text line (\"Debbie 0.1.0 (3)\"), not the wordmark: "
              "CRAFT B2 also lists Settings › About, but build 3 doesn't show it there (the code wins).\n")
    md.append("## App icon\n")
    md.append(table(["Variant", "Files", "Background", "Glyph", "When iOS shows it"], [
        ["Any", "`app-icon-any-*.png`", f"mint `{icon['Any'][0]}`", f"icon ink `{icon['Any'][1]}`", "The default Home Screen"],
        ["Dark", "`app-icon-dark-*.png`", f"deep green `{icon['Dark'][0]}`", f"mint `{icon['Dark'][1]}`", "The dark icon appearance"],
        ["Tinted", "`app-icon-tinted-*.png`", f"black `{icon['Tinted'][0]}`", f"light grey `{icon['Tinted'][1]}`", "The tinted appearance; iOS recolours it with the person's tint"],
    ]) + "\n")
    md.append(f"- Each variant is a flat, opaque 1024 × 1024 px square made by `Design/scripts/app-icon.sh` from `Design/brand/mark.svg`: the mark scaled {fmt(icon_scale)}× "
              f"(the D is {d_w:.0f} × {d_h:.0f} px) and centred on its own bounds. The app ships only the three 1024 px files (`App/Assets.xcassets/AppIcon.appiconset`) and iOS makes the smaller sizes.")
    md.append("- The smaller files here are the project's review renders (`Design/reviews/app-icon/raw/`), resized from the 1024 px art by the same script. "
              "Where iOS uses each size (@2x / @3x): 120 and 180 = Home Screen; 80 and 120 = Spotlight; 58 and 87 = Settings; 40 and 60 = notifications; "
              "1024 = App Store and TestFlight; 16 = the smallest size the brand is checked at (CRAFT B4).")
    md.append("- iOS adds the rounded-corner mask and its own lighting. For a masked icon in a slide, mask the square yourself or take it from a Home Screen screenshot; never bake corners or shadows into the art.\n")
    md.append("## Launch screen\n")
    md.append(f"A plain colour with no logo and no text (CRAFT B5). In build 3 that colour is `{launch_hex}` (the `LaunchBackground` colour, the canvas tint from before the white redesign), "
              "so the very first frame is a faint grey-green before the white welcome screen appears. CRAFT B5 says it should equal `bg.canvas` `#FFFFFF`; "
              f"the code wins, so mock the launch frame as `{launch_hex}`.\n")
    md.append("## Sources\n")
    md.append(f"- `{SRC_MARK}`, `{SRC_WORDMARK}`, `Design/scripts/wordmark.py`, `{SRC_ICON_SCRIPT}`, `{SRC_ICON_RAW}/`, `{SRC_LAUNCH}`")
    md.append("- `CRAFT.md` §2.8 (B1–B6); `docs/DECISIONS.md` D-013 (app icon through the asset catalog), D-030 (Debbie's face on the welcome screen)")
    md.append(f"- `Packages/DebbieKit/Sources/DebbieFeatures/Views.swift` (WelcomeView), `{DS}/Persona/DebbieAvatar.swift`, `{SRC_TOKENS}`; the build-1 lockup from git history (`de9d1ae`)")
    md.append(f"- {REGEN}")
    write(os.path.join(BRAND, "brand.md"), "\n".join(md))


def read_bytes(path):
    with open(path, "rb") as f:
        return f.read()


# ---------------------------------------------------------------- main

def tag_srgb(paths):
    """rsvg-convert writes untagged PNGs. Insert an sRGB chunk (rendering intent 0) after IHDR and drop bKGD,
    without touching the pixels, so colour-managed apps show the exact token values."""
    import zlib
    for path in paths:
        data = read_bytes(path)
        if data[:8] != b"\x89PNG\r\n\x1a\n":
            die(f"{path} isn't a PNG")
        pos, chunks = 8, []
        while pos < len(data):
            n, kind = struct.unpack(">I4s", data[pos:pos + 8])
            chunks.append((kind, data[pos:pos + 12 + n]))
            pos += 12 + n
        if any(k in (b"sRGB", b"iCCP") for k, _ in chunks):
            continue
        body = b"sRGB" + b"\x00"
        srgb = struct.pack(">I", 1) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)
        out = [data[:8], chunks[0][1], srgb] + [raw for k, raw in chunks[1:] if k != b"bKGD"]
        with open(path, "wb") as f:
            f.write(b"".join(out))


def main():
    args = sys.argv[1:]
    if args[:1] == ["tag-srgb"]:
        tag_srgb(args[1:])
        return
    try:
        tmp = args[args.index("--tmp") + 1]
        squircle_file = args[args.index("--squircle") + 1]
    except (ValueError, IndexError):
        die("usage: brand-tokens-data.py --tmp DIR --squircle FILE")
    if not os.path.isfile(SRC_COLORS):
        die("run from the repo root")
    squircle = read(squircle_file).strip()
    if not squircle.startswith("M") or not squircle.endswith("Z"):
        die("bad squircle path")
    colors = load_colors()
    pairs, cvd, min_de = parse_report()
    swift = parse_tokens_swift()
    tokens = build_color(colors, pairs, cvd, min_de, swift, tmp)
    build_type(swift, tokens, tmp)
    build_layout(swift, tokens)
    build_brand(tokens, tmp, squircle)
    print(f"brand-tokens-data: wrote 01-brand, 02-color, 03-type, 04-layout docs and data ({len(WARNINGS)} warnings)")


if __name__ == "__main__":
    main()
