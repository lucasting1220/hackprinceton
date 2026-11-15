#!/usr/bin/env bash
# Every xcodebuild call goes through here (research note 12 R5): stdin closed, a hard time limit
# (macOS has no `timeout`, so perl alarm), output redacted into logs/<name>.log, exit status kept.
#   tools/ci/xcb.sh <log-name> <seconds> <xcodebuild args...>
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
name="${1:?log name}"; secs="${2:?seconds}"; shift 2
mkdir -p "$ROOT/logs"
# The credential values are loaded only so redact.pl can mask them. xcodebuild must not inherit them: it records its whole
# environment in DerivedData's build description, where tools/ci/check-logs.sh found them (17:13).
ENV_FILE="$HOME/.config/debbie-ios/asc.env"
if [[ -f "$ENV_FILE" ]]; then set -a; . "$ENV_FILE"; set +a; fi
GEMINI_FILE="$HOME/.config/debbie-ios/gemini.env"
if [[ -f "$GEMINI_FILE" ]]; then set -a; . "$GEMINI_FILE"; set +a; fi
perl -e 'alarm shift; exec @ARGV' "$secs" env -u ASC_KEY_ID -u ASC_ISSUER_ID -u ASC_KEY_PATH -u GEMINI_API_KEY \
  xcodebuild "$@" < /dev/null 2>&1 | perl "$ROOT/tools/ci/redact.pl" > "$ROOT/logs/$name.log"
status=${PIPESTATUS[0]}
[[ $status -eq 142 ]] && echo "✗ xcodebuild timed out after ${secs}s (logs/$name.log)"
grep -E "^\*\* .* (SUCCEEDED|FAILED) \*\*" "$ROOT/logs/$name.log" | tail -1
exit "$status"
