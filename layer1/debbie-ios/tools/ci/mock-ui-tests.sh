#!/usr/bin/env bash
# The UI tests that need the mock home (DeviceBugsUITests, MockHomeUITests, PairingRetryUITests), against a mock started here on its own
# ports, so they run beside a mock already up on 7570 and never reach a real bridge (7470, 7480). Those tests skip when
# no mock answers, and a skip reads as a pass, so this fails if any test was skipped (the build-8 review, F6).
#   tools/ci/mock-ui-tests.sh [simulator name]        log: logs/mock-ui-tests.log, the mock's: logs/mockhome-ui-tests.log
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
sim="${1:-Debbie SE}"
base="${DEBBIE_MOCK_UI_PORT_BASE:-7770}"
mkdir -p logs

DEBBIE_MOCK_PORT_BASE="$base" node MockHome/server.mjs --auto-confirm > logs/mockhome-ui-tests.log 2>&1 &
mock=$!
trap 'kill "$mock" 2>/dev/null' EXIT
for _ in $(seq 1 50); do
  curl -s -m 1 "http://127.0.0.1:$base/control/state" 2>/dev/null | grep -q '"pairing"' && break
  kill -0 "$mock" 2>/dev/null || break
  sleep 0.2
done
if ! curl -s -m 1 "http://127.0.0.1:$base/control/state" 2>/dev/null | grep -q '"pairing"'; then
  echo "✗ the mock home didn't start on 127.0.0.1:$base (logs/mockhome-ui-tests.log)"; exit 1
fi

TEST_RUNNER_DEBBIE_MOCK_PORT_BASE="$base" tools/ci/xcb.sh mock-ui-tests 1500 -project Debbie.xcodeproj -scheme Debbie \
  -destination "platform=iOS Simulator,name=$sim" -derivedDataPath build/DD \
  -only-testing:DebbieUITests/DeviceBugsUITests -only-testing:DebbieUITests/MockHomeUITests -only-testing:DebbieUITests/PairingRetryUITests test
status=$?
passed=$(grep -c "' passed (" logs/mock-ui-tests.log)
failed=$(grep -c "' failed (" logs/mock-ui-tests.log)
skipped=$(grep -c "' skipped (" logs/mock-ui-tests.log)
echo "mock-home UI tests: passed=$passed failed=$failed skipped=$skipped"
[[ $status -eq 0 ]] || exit "$status"
if [[ $skipped -ne 0 || $passed -eq 0 ]]; then echo "✗ a mock-home UI test was skipped or none ran"; exit 1; fi
echo "✓ mock-home UI tests ran, none skipped"
