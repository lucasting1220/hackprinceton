#!/usr/bin/env bash
# Fails if a Release build contains mock-home, debug-menu, fixture or test-hook
# code (brief §3: "keep mocks, debug menus, fixtures and test hooks out of Release
# builds"). Inspects every Mach-O in the .app (app, extensions, frameworks) for
# forbidden symbol names and strings. Usage:
#   tools/ci/check-release-clean.sh path/to/Debbie.app [--expect-no-demo]
# --expect-no-demo also forbids the demo home (use on a Release build made with
# DEBBIE_DEMO_HOME off, to prove the demo is removable with one build setting).
set -euo pipefail
app="${1:?usage: check-release-clean.sh <Release .app> [--expect-no-demo]}"
forbidden="$(dirname "$0")/release-forbidden.txt"
patterns="$(grep -vE '^\s*(#|$)' "$forbidden")"
if [[ "${2:-}" == "--expect-no-demo" ]]; then patterns="$(printf '%s\nDemoHome\nFakeMediaEngine\nDEBBIE-DEMO-CANARY' "$patterns")"; fi
fail=0
while IFS= read -r -d '' bin; do
  if file "$bin" | grep -q 'Mach-O'; then
    hits="$( { nm -a "$bin" 2>/dev/null | swift demangle 2>/dev/null; strings -a "$bin" 2>/dev/null; } | grep -E -f <(printf '%s\n' "$patterns") | sort -u | head -20 || true)"
    if [[ -n "$hits" ]]; then
      echo "✗ forbidden content in ${bin#$app/}:"
      printf '   %s\n' "$hits"
      fail=1
    fi
  fi
done < <(find "$app" -type f -print0)
if [[ $fail -ne 0 ]]; then exit 1; fi
echo "✓ $app contains no mock, debug-menu, fixture or test-hook code"
