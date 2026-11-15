#!/usr/bin/env bash
# Fails if an xcodebuild log contains any compiler/linker warning (brief §3:
# "keep the final build free of compiler warnings"). Usage:
#   tools/ci/check-warnings.sh build/logs/build.log
# Lines matching tools/ci/warnings-allowlist.txt (one ERE per line, each with a
# justification comment) are ignored; the allowlist should stay empty.
set -euo pipefail
log="${1:?usage: check-warnings.sh <xcodebuild log>}"
allow="$(dirname "$0")/warnings-allowlist.txt"
warnings="$(grep -E '(^|: )warning: ' "$log" | sort -u || true)"
if [[ -s "$allow" ]]; then
  patterns="$(grep -vE '^\s*(#|$)' "$allow" || true)"
  if [[ -n "$patterns" ]]; then
    warnings="$(printf '%s\n' "$warnings" | grep -vE -f <(printf '%s\n' "$patterns") || true)"
  fi
fi
count="$(printf '%s' "$warnings" | grep -c . || true)"
if [[ "$count" -gt 0 ]]; then
  echo "✗ $count warning(s) in $log:"
  printf '%s\n' "$warnings"
  exit 1
fi
echo "✓ no warnings in $log"
