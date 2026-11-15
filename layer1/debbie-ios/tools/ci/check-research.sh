#!/usr/bin/env bash
# Phase 1 gate (brief §8): notes exist for every topic, with dated sources, and
# the independent review's findings are resolved (each note has a Review log and
# docs/research/research-review.md records the cross-note review).
set -uo pipefail
cd "$(dirname "$0")/../.."
fail=0
declare -a topics=(
  "01:docs/research/01-featured-apps-craft.md"
  "02:docs/research/02-ios-design-language.md"
  "03:docs/research/03-motion-springs.md"
  "04:docs/research/04-haptics.md"
  "05:docs/research/05-transitions.md"
  "06:docs/research/06-colour.md"
  "07:docs/research/07-typography-layout.md"
  "08:docs/research/08-icons-logos-app-icons.md"
  "09:docs/research/09-buttons-controls.md"
  "10:docs/research/10-caregivers-older-adults-alerting.md"
  "11:docs/research/11a-engineering-architecture.md"
  "11:docs/research/11b-engineering-webrtc-testing-perf.md"
  "11:docs/research/11c-routes-network-changes.md"
  "12:docs/research/12-delivery-fastlane.md"
  "13:docs/research/13-platform-extras.md"
)
for t in "${topics[@]}"; do
  n="${t%%:*}"; f="${t#*:}"
  if [[ ! -s "$f" ]]; then echo "✗ topic $n: missing $f"; fail=1; continue; fi
  sources=$(awk '/^## Sources/{on=1;next} /^## /{on=0} on' "$f" | grep -cE '^\s*([-*] |[0-9]+\. )?\[S[0-9]+\]' || true)
  dated=$(awk '/^## Sources/{on=1;next} /^## /{on=0} on' "$f" | grep -c 'accessed 2026-11-14' || true)
  recs=$(grep -cE '^(- |[0-9]+\. )?\*{0,2}R[0-9]+[.:]' "$f" || true)
  log=$(grep -c '^## Review log' "$f" || true)
  status="ok"
  [[ $sources -lt 5 ]] && status="few sources ($sources)" && fail=1
  [[ $dated -lt $sources ]] && status="$status; undated sources ($((sources-dated)))" && fail=1
  [[ $log -lt 1 ]] && status="$status; no Review log" && fail=1
  printf '%s topic %s %-52s sources=%-3s dated=%-3s recs=%-3s %s\n' "$([[ $status == ok ]] && echo ✓ || echo ✗)" "$n" "$f" "$sources" "$dated" "$recs" "$status"
done
if [[ -s docs/research/research-review.md ]]; then echo "✓ docs/research/research-review.md present"; else echo "✗ docs/research/research-review.md missing"; fail=1; fi
exit $fail
