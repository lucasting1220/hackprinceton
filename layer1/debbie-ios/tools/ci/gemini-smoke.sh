#!/usr/bin/env bash
# One tiny Gemini call to prove the key and model work (D-031). Reads ~/.config/debbie-ios/gemini.env.
# Prints only the model, the HTTP status and the first words of the reply: never the key.
#   tools/ci/gemini-smoke.sh
set -uo pipefail
GEMINI_FILE="$HOME/.config/debbie-ios/gemini.env"
[[ -f "$GEMINI_FILE" ]] || { echo "BLOCKED: $GEMINI_FILE is missing (GEMINI_API_KEY=…, optional GEMINI_MODEL=…)"; exit 1; }
value() { { grep -E "^(export )?$1=" "$GEMINI_FILE" || true; } | head -1 | sed -E "s/^(export )?$1=//; s/[[:space:]]+#.*$//" | tr -d '"'"'"' '; }
key="$(value GEMINI_API_KEY)"; model="$(value GEMINI_MODEL)"; model="${model:-gemini-3.5-flash-lite}"
[[ -n "$key" ]] || { echo "BLOCKED: GEMINI_API_KEY is empty"; exit 1; }
out="$(mktemp)"; trap 'rm -f "$out"' EXIT
# The key goes in a header read from stdin (curl -H @-), so it never appears in the process list or the URL.
status="$(printf 'x-goog-api-key: %s\n' "$key" | curl -sS --max-time 30 -o "$out" -w '%{http_code}' -H @- \
  -H 'Content-Type: application/json' \
  -d '{"contents":[{"role":"user","parts":[{"text":"Reply with exactly: Debbie is ready."}]}],"generationConfig":{"maxOutputTokens":40,"thinkingConfig":{"thinkingLevel":"minimal"}}}' \
  "https://generativelanguage.googleapis.com/v1/models/${model}:generateContent")"
reply="$(python3 -I -c 'import json,sys
try:
    d=json.load(open(sys.argv[1]))
    print((d.get("candidates") or [{}])[0].get("content",{}).get("parts",[{}])[0].get("text","")[:80].strip() or d.get("error",{}).get("status",""))
except Exception: print("(unreadable reply)")' "$out")"
echo "model: $model · HTTP $status · reply: $reply"
[[ "$status" == "200" ]]
