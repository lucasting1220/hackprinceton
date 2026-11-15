# CRAFT.md review (Phase 2)

**Method.** The brief asks for a fresh subagent to try to break CRAFT.md. At 10:5x the account hit its 5-hour API limit ("resets 3pm"), so no subagent could run. The brief's alternative applies: "do the review yourself as a separate pass against the checklist, and say so in the report." This is that pass, run on 2026-11-14 at 11:1x through four lenses, with mechanical checks where possible. MORNING_REPORT says so.

| Lens | Check | Result |
|---|---|---|
| Coverage (brief §10) | All ten required sections present, including §1's per-screen simplicity, §2's mint-identity rule, §3's motion verification, §5's "replaces" column, and §8's testing strategy with motion and token enforcement | ✓ (grep of every heading and key rule: each present once) |
| Vagueness | Search for "appropriate / generous / subtle / where possible / consider / should feel" | ✓ none found. Every rule has a number, a token, an API name or a named test or lint |
| Sourcing | Count of `[NN Rk]` / `[Xn]` / `[D-nnn]` citations: 133. Rules without a research source carry "Reasoning:" (illustrations §2.7, simplicity budgets §1.1) | ✓ |
| Conflicts | Cross-checked against `lead-decisions.md` X1–X59, which settles every conflict found by the per-note reviewers and by the independent review of the lead notes (sizes → X21 table; live Stop → X16; haptics start/stop → X3; status deck → X5/X54; app icon → X55/D-013; chrome → X44/D-014; confirmations → D-012) | ✓ no remaining contradiction found |
| Checkability | Every §9 line names its check: A (automated), L (lint), S (screenshot or recording), D (device). The colour table is generated and re-measured by `ColorTokenTests` | ✓ |
| Measured values | `tools/design/tokens.py`: 49 pairings × 4 appearances pass; CVD separations pass | ✓ (Design/tokens/contrast-report.md) |

**Known limits, recorded instead of hidden.**
- Note 15's state matrix and notes 11c/14 carry independent-review findings that their fixer couldn't apply (API limit). CRAFT.md §1.1, §5 (the Unpair procedure) and §8 E8 (routes) hold the corrected rules, so the build follows the corrected rules.
- Seven per-note fixers stopped mid-way (owner pivot and API limit). The reviewers' high and medium findings are listed in `docs/research/research-review.md`; those that change what we build are settled in `lead-decisions.md` and cited here.
- Device-only checks (haptic feel, hitches on hardware, the real Wi-Fi → cellular test, notification extension decryption on a locked phone) are marked D or LATER, never claimed.

**Verdict:** passes the Phase 2 gate as a self-review, with the limits above recorded.
