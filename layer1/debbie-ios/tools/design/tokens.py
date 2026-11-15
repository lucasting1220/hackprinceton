#!/usr/bin/env python3
"""Debbie colour tokens: one source, measured, exported.

Reads Design/tokens/colors.json and:
  1. measures every declared foreground/background pairing with the WCAG 2.x
     contrast ratio, in all four appearances (light, dark, light + increased
     contrast, dark + increased contrast), against each pairing's threshold;
  2. simulates protanopia, deuteranopia and tritanopia (Machado, Oliveira &
     Fernandes 2009, severity 1.0, applied in linear sRGB) and reports the
     CIEDE2000 colour difference between every pair of "must stay distinct"
     colours under normal vision and each simulation;
  3. writes a Markdown report (for CRAFT.md) and the Swift source of the design
     system's colours (dynamic UIColor providers keyed on interface style and
     accessibility contrast).

Usage (from the repo root; -I keeps the interpreter isolated):
  python3 -I tools/design/tokens.py              # report to stdout, exit 1 on any failure
  python3 -I tools/design/tokens.py --write      # also write the report and Swift file

Exit code 1 if any pairing misses its threshold or any distinct pair falls
below the minimum ΔE00 in any vision simulation.
"""
import json
import math
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, "Design", "tokens", "colors.json")
REPORT = os.path.join(ROOT, "Design", "tokens", "contrast-report.md")
SWIFT = os.path.join(ROOT, "Packages", "DebbieKit", "Sources", "DebbieDesignSystem", "Tokens", "Colors.generated.swift")
APPEARANCES = ["light", "dark", "lightHC", "darkHC"]
APPEARANCE_LABEL = {"light": "Light", "dark": "Dark", "lightHC": "Light + Increase Contrast", "darkHC": "Dark + Increase Contrast"}

# Machado et al. (2009) "A Physiologically-based Model for Simulation of Color
# Vision Deficiency", IEEE TVCG 15(6), severity 1.0 matrices (linear RGB).
CVD = {
    "protanopia": [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
    "deuteranopia": [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
    "tritanopia": [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
}


def hex_to_rgb(h):
    h = h.lstrip("#")
    if len(h) != 6:
        raise ValueError(f"expected #RRGGBB, got #{h}")
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def delin(c):
    c = min(1.0, max(0.0, c))
    return 12.92 * c if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055


def luminance(rgb):
    r, g, b = (lin(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def simulate(rgb, kind):
    if kind == "normal":
        return rgb
    m = CVD[kind]
    l = [lin(c) for c in rgb]
    out = [sum(m[i][j] * l[j] for j in range(3)) for i in range(3)]
    return tuple(delin(c) for c in out)


def to_lab(rgb):
    r, g, b = (lin(c) for c in rgb)
    x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047
    y = (0.2126729 * r + 0.7151522 * g + 0.0721750 * b) / 1.0
    z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883

    def f(t):
        return t ** (1 / 3) if t > 216 / 24389 else (24389 / 27 * t + 16) / 116

    fx, fy, fz = f(x), f(y), f(z)
    return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)


def ciede2000(lab1, lab2):
    L1, a1, b1 = lab1
    L2, a2, b2 = lab2
    C1, C2 = math.hypot(a1, b1), math.hypot(a2, b2)
    Cb = (C1 + C2) / 2
    G = 0.5 * (1 - math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)))
    a1p, a2p = (1 + G) * a1, (1 + G) * a2
    C1p, C2p = math.hypot(a1p, b1), math.hypot(a2p, b2)
    h1p = math.degrees(math.atan2(b1, a1p)) % 360
    h2p = math.degrees(math.atan2(b2, a2p)) % 360
    dLp = L2 - L1
    dCp = C2p - C1p
    if C1p * C2p == 0:
        dhp = 0
    elif abs(h2p - h1p) <= 180:
        dhp = h2p - h1p
    elif h2p - h1p > 180:
        dhp = h2p - h1p - 360
    else:
        dhp = h2p - h1p + 360
    dHp = 2 * math.sqrt(C1p * C2p) * math.sin(math.radians(dhp / 2))
    Lbp = (L1 + L2) / 2
    Cbp = (C1p + C2p) / 2
    if C1p * C2p == 0:
        hbp = h1p + h2p
    elif abs(h1p - h2p) <= 180:
        hbp = (h1p + h2p) / 2
    elif h1p + h2p < 360:
        hbp = (h1p + h2p + 360) / 2
    else:
        hbp = (h1p + h2p - 360) / 2
    T = (1 - 0.17 * math.cos(math.radians(hbp - 30)) + 0.24 * math.cos(math.radians(2 * hbp))
         + 0.32 * math.cos(math.radians(3 * hbp + 6)) - 0.20 * math.cos(math.radians(4 * hbp - 63)))
    dtheta = 30 * math.exp(-(((hbp - 275) / 25) ** 2))
    Rc = 2 * math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7))
    Sl = 1 + (0.015 * (Lbp - 50) ** 2) / math.sqrt(20 + (Lbp - 50) ** 2)
    Sc = 1 + 0.045 * Cbp
    Sh = 1 + 0.015 * Cbp * T
    Rt = -math.sin(math.radians(2 * dtheta)) * Rc
    return math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh))


def resolve(tokens, name, appearance):
    t = tokens[name]
    value = t.get(appearance)
    if value is None and appearance.endswith("HC"):
        value = t.get(appearance[:-2])
    if value is None:
        raise KeyError(f"token {name} has no value for {appearance}")
    return value


def swift_ident(name):
    parts = name.replace("-", ".").split(".")
    head, rest = parts[0], parts[1:]
    return head + "".join(p[:1].upper() + p[1:] for p in rest)


def rgb_literal(hexv):
    r, g, b = hex_to_rgb(hexv)
    return f"UIColor(red: {r:.4f}, green: {g:.4f}, blue: {b:.4f}, alpha: 1)"


def main():
    write = "--write" in sys.argv
    with open(SRC, encoding="utf-8") as fh:
        spec = json.load(fh)
    tokens = spec["tokens"]
    failures = []
    lines = ["# Colour token report", "",
             "_Generated by `tools/design/tokens.py` from `Design/tokens/colors.json`. Do not edit by hand._", "",
             "WCAG 2.x contrast ratio, (L1 + 0.05) / (L2 + 0.05), with sRGB linearisation threshold 0.04045.", ""]

    lines += ["## Tokens", "", "| Token | Role | Light | Dark | Light + IC | Dark + IC |", "|---|---|---|---|---|---|"]
    for name, t in tokens.items():
        vals = [resolve(tokens, name, a) for a in APPEARANCES]
        lines.append(f"| `{name}` | {t.get('role', '')} | " + " | ".join(f"`{v}`" for v in vals) + " |")

    lines += ["", "## Pairings (foreground on background)", "",
              "| Foreground | Background | Use | Min | Light | Dark | Light + IC | Dark + IC | Result |",
              "|---|---|---|---|---|---|---|---|---|"]
    for p in spec["pairings"]:
        fg, bg, minimum = p["fg"], p["bg"], p["min"]
        min_hc = p.get("min_hc", minimum)
        cells, ok = [], True
        for a in APPEARANCES:
            ratio = contrast(hex_to_rgb(resolve(tokens, fg, a)), hex_to_rgb(resolve(tokens, bg, a)))
            need = min_hc if a.endswith("HC") else minimum
            passed = ratio + 1e-9 >= need
            ok &= passed
            cells.append(f"{ratio:.2f}" + ("" if passed else " ✗"))
            if not passed:
                failures.append(f"{fg} on {bg} [{a}] = {ratio:.2f} < {need}")
        need_label = f"{minimum}" + (f" / {min_hc} IC" if min_hc != minimum else "")
        lines.append(f"| `{fg}` | `{bg}` | {p.get('use', '')} | {need_label} | " + " | ".join(cells) + f" | {'PASS' if ok else 'FAIL'} |")

    distinct = spec.get("distinct", {})
    if distinct:
        min_de = distinct.get("min_delta_e2000", 20)
        lines += ["", f"## Colour-vision separation (CIEDE2000; minimum {min_de})", "",
                  "Simulated with Machado et al. 2009 (severity 1.0). Colour is never the only signal, and this checks that the hues still separate.", ""]
        sims = ["normal", "protanopia", "deuteranopia", "tritanopia"]
        lines += ["| Pair | Appearance | " + " | ".join(s.capitalize() for s in sims) + " |", "|---|---|" + "---|" * len(sims)]
        for a_name, b_name in distinct["pairs"]:
            for a in APPEARANCES:
                ra, rb = hex_to_rgb(resolve(tokens, a_name, a)), hex_to_rgb(resolve(tokens, b_name, a))
                cells = []
                for s in sims:
                    de = ciede2000(to_lab(simulate(ra, s)), to_lab(simulate(rb, s)))
                    cells.append(f"{de:.1f}" + ("" if de >= min_de else " ✗"))
                    if de < min_de:
                        failures.append(f"{a_name} vs {b_name} [{a}, {s}] ΔE00 = {de:.1f} < {min_de}")
                lines.append(f"| `{a_name}` vs `{b_name}` | {APPEARANCE_LABEL[a]} | " + " | ".join(cells) + " |")

    lines += ["", "## Result", "", "All pairings and separations pass." if not failures else "**Failures:**", ""]
    lines += [f"- {f}" for f in failures]
    report = "\n".join(lines) + "\n"
    print(report)

    if write:
        with open(REPORT, "w", encoding="utf-8") as fh:
            fh.write(report)
        os.makedirs(os.path.dirname(SWIFT), exist_ok=True)
        out = ["// Generated by tools/design/tokens.py from Design/tokens/colors.json. Do not edit.",
               "// Each colour resolves for light, dark, and Increase Contrast (light and dark).",
               "",
               "import SwiftUI",
               "import UIKit",
               "",
               "public enum DebbiePalette {"]
        for name, t in tokens.items():
            ident = swift_ident(name)
            vals = {a: resolve(tokens, name, a) for a in APPEARANCES}
            out += [f"    /// {t.get('role', name)}",
                    f"    public static let {ident} = UIColor {{ traits in",
                    "        let dark = traits.userInterfaceStyle == .dark",
                    "        let high = traits.accessibilityContrast == .high",
                    "        switch (dark, high) {",
                    f"        case (false, false): return {rgb_literal(vals['light'])} // {vals['light']}",
                    f"        case (true, false): return {rgb_literal(vals['dark'])} // {vals['dark']}",
                    f"        case (false, true): return {rgb_literal(vals['lightHC'])} // {vals['lightHC']}",
                    f"        case (true, true): return {rgb_literal(vals['darkHC'])} // {vals['darkHC']}",
                    "        }",
                    "    }"]
        out += ["", "    /// Every token, for tests and the component gallery.",
                "    public static let all: [(name: String, color: UIColor)] = ["]
        out += [f"        (\"{n}\", {swift_ident(n)})," for n in tokens]
        out += ["    ]", "", "    /// Every measured pairing from colors.json: (foreground, background, minimum, minimum with Increase Contrast).",
                "    public static let pairings: [(fg: String, bg: String, min: Double, minHC: Double)] = ["]
        out += [f"        (\"{p['fg']}\", \"{p['bg']}\", {float(p['min'])}, {float(p.get('min_hc', p['min']))})," for p in spec["pairings"]]
        out += ["    ]", "}", ""]
        with open(SWIFT, "w", encoding="utf-8") as fh:
            fh.write("\n".join(out))
        print(f"wrote {os.path.relpath(REPORT, ROOT)} and {os.path.relpath(SWIFT, ROOT)}", file=sys.stderr)

    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
