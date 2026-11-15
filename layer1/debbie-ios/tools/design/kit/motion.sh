#!/usr/bin/env bash
# Designer kit, parts 09-motion and 10-haptics: regenerates
#   DesignerKit/09-motion/{motion.md, motion-tokens.json, curves.png, icon-animations.md}
#   DesignerKit/10-haptics/haptics.md
# from the app's Swift sources (Motion.swift, IconMotion.swift, Haptics.swift and the screens that use them).
# DesignerKit/09-motion/recordings/ is not touched.
#
# Run from the repo root:  tools/design/kit/motion.sh
# Needs Xcode's Swift toolchain (macOS 14 or later for SwiftUI's Spring and UnitCurve). Re-runnable; writes nothing else.
set -euo pipefail

if [[ ! -f Packages/DebbieKit/Sources/DebbieDesignSystem/Motion/Motion.swift ]]; then
  echo "motion.sh: run this from the repo root" >&2
  exit 1
fi

build="$(mktemp -d "${TMPDIR:-/tmp}/debbie-kit-motion.XXXXXX")"
trap 'rm -rf "$build"' EXIT

xcrun swiftc -O tools/design/kit/motion.swift -o "$build/motion"
"$build/motion"
