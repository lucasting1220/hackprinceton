#!/usr/bin/env python3
"""Generates the hand-drawn "debbie" wordmark (Design/brand/wordmark.svg): monoline geometric
lowercase built from circles and stems (CRAFT.md §2.8 B2: never traced from a font). Spacing is
computed from each glyph's outer extent so the gaps are optically even."""
import os
SW = 10            # stroke weight (units)
R = 21             # bowl radius (to the stroke centre)
BASE, XH, ASC = 80, 34, 8   # baseline, x-height top (outer), ascender top
CY = BASE - (R + SW / 2)    # bowl centre so the bowl sits on the baseline
GAP = 10
parts, x = [], 6.0
def bowl(cx): return f'<circle cx="{cx:.1f}" cy="{CY:.1f}" r="{R}"/>'
def stem(sx, top): return f'<path d="M{sx:.1f} {top} V{BASE - SW/2:.1f}"/>'
def e(cx):
    import math
    a = math.radians(38)
    ex, ey = cx + R * math.cos(a), CY + R * math.sin(a)
    return f'<path d="M{cx - R:.1f} {CY:.1f} H{cx + R:.1f} A{R} {R} 0 1 0 {ex:.1f} {ey:.1f}"/>'
glyphs = ["d", "e", "b", "b", "i", "e"]
for g in glyphs:
    left = x
    if g == "d":
        cx = left + SW / 2 + R; parts += [bowl(cx), stem(cx + R, ASC + SW / 2)]; x = cx + R + SW / 2
    elif g == "b":
        sx = left + SW / 2; cx = sx + R; parts += [stem(sx, ASC + SW / 2), bowl(cx)]; x = cx + R + SW / 2
    elif g == "e":
        cx = left + SW / 2 + R; parts.append(e(cx)); x = cx + R + SW / 2
    elif g == "i":
        sx = left + SW / 2; parts += [stem(sx, BASE - 2 * (R + SW / 2) + SW / 2), f'<circle cx="{sx:.1f}" cy="{ASC + 7:.1f}" r="{SW * 0.62:.1f}" fill="#000" stroke="none"/>']; x = sx + SW / 2
    x += GAP
W = x - GAP + 6
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.0f} 90" width="{W:.0f}" height="90">
<g fill="none" stroke="#000" stroke-width="{SW}" stroke-linecap="round" stroke-linejoin="round">
{chr(10).join(parts)}
</g></svg>
'''
out = os.path.join(os.path.dirname(__file__), "..", "brand", "wordmark.svg")
open(out, "w").write(svg)
print(f"wrote wordmark.svg ({W:.0f}×90 units)")
