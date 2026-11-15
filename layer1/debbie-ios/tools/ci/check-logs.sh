#!/usr/bin/env bash
# Fails if any ASC credential value appears in logs/ or build/ (research note 12 R5).
# Prints only file names, never the values.
set -uo pipefail
cd "$(dirname "$0")/../.."
ENV_FILE="$HOME/.config/debbie-ios/asc.env"
[[ -f "$ENV_FILE" ]] || { echo "check-logs: no asc.env; nothing to compare"; exit 0; }
set -a; . "$ENV_FILE"; set +a
fail=0
for var in ASC_KEY_ID ASC_ISSUER_ID ASC_KEY_PATH; do
  val="${!var:-}"; [[ -n "$val" ]] || continue
  hits="$(grep -rlF -- "$val" logs build 2>/dev/null || true)"
  if [[ -n "$hits" ]]; then echo "✗ $var value found in:"; printf '   %s\n' $hits; fail=1; fi
done
# The Gemini key is built into the app by the owner's decision (D-031), so build/ holds it by design; logs/ must not.
GEMINI_FILE="$HOME/.config/debbie-ios/gemini.env"
if [[ -f "$GEMINI_FILE" ]]; then
  gkey="$({ grep -E '^(export )?GEMINI_API_KEY=' "$GEMINI_FILE" || true; } | head -1 | sed -E 's/^(export )?GEMINI_API_KEY=//; s/[[:space:]]+#.*$//' | tr -d '"'"'"' ')"
  if [[ -n "$gkey" ]]; then
    hits="$(grep -rlF -- "$gkey" logs 2>/dev/null || true)"
    if [[ -n "$hits" ]]; then echo "✗ GEMINI_API_KEY value found in:"; printf '   %s\n' $hits; fail=1; fi
  fi
fi
[[ $fail -eq 0 ]] && echo "✓ no credential values in logs/ or build/"
exit $fail
