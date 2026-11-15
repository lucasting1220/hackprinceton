#!/usr/bin/env bash
# Simulator helpers for Debbie's screen gates (CRAFT.md §9). Only touches the two
# simulators it creates ("Debbie SE" and "Debbie Max"), never the owner's others.
#
#   tools/sim/sim.sh ensure            # create (if needed) and print both UDIDs
#   tools/sim/sim.sh udid small|large  # print one UDID
#   tools/sim/sim.sh boot small|large
#   tools/sim/sim.sh prep small|large [--appearance light|dark] [--size <content size>]
#                         [--contrast enabled|disabled]
#   tools/sim/sim.sh shot small|large <out.png>
#   tools/sim/sim.sh reset-ui small|large   # light, default text size, contrast off
#
# Content sizes: extra-small … extra-extra-extra-large, accessibility-medium …
# accessibility-extra-extra-extra-large (AX5, the largest).
set -euo pipefail

RUNTIME_ID="${DEBBIE_SIM_RUNTIME:-com.apple.CoreSimulator.SimRuntime.iOS-26-5}"
SMALL_NAME="Debbie SE"
SMALL_TYPE="com.apple.CoreSimulator.SimDeviceType.iPhone-SE-3rd-generation"
LARGE_NAME="Debbie Max"
LARGE_TYPE="com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro-Max"

udid_for_name() {
  xcrun simctl list devices available -j | python3 -I -c '
import json, sys
name, runtime = sys.argv[1], sys.argv[2]
devs = json.load(sys.stdin)["devices"].get(runtime, [])
for d in devs:
    if d["name"] == name:
        print(d["udid"]); break
' "$1" "$RUNTIME_ID"
}

ensure_one() {
  local name="$1" type="$2" id
  id="$(udid_for_name "$name")"
  if [[ -z "$id" ]]; then
    id="$(xcrun simctl create "$name" "$type" "$RUNTIME_ID")"
  fi
  echo "$id"
}

resolve() {
  case "$1" in
    small) ensure_one "$SMALL_NAME" "$SMALL_TYPE" ;;
    large) ensure_one "$LARGE_NAME" "$LARGE_TYPE" ;;
    *) echo "unknown device '$1' (small|large)" >&2; exit 2 ;;
  esac
}

boot() {
  local id="$1"
  xcrun simctl bootstatus "$id" -b >/dev/null 2>&1 || true
  # Consistent status bar for every screenshot.
  xcrun simctl status_bar "$id" override --time "9:41" --dataNetwork wifi --wifiMode active --wifiBars 3 \
    --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100 >/dev/null 2>&1 || true
}

cmd="${1:-}"; shift || true
case "$cmd" in
  ensure)
    echo "small $(resolve small)"
    echo "large $(resolve large)"
    ;;
  udid) resolve "$1" ;;
  boot) boot "$(resolve "$1")" ;;
  prep)
    id="$(resolve "$1")"; shift
    boot "$id"
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --appearance) xcrun simctl ui "$id" appearance "$2"; shift 2 ;;
        --size) xcrun simctl ui "$id" content_size "$2"; shift 2 ;;
        --contrast) xcrun simctl ui "$id" increase_contrast "$2"; shift 2 ;;
        *) echo "unknown option $1" >&2; exit 2 ;;
      esac
    done
    ;;
  reset-ui)
    id="$(resolve "$1")"
    boot "$id"
    xcrun simctl ui "$id" appearance light
    xcrun simctl ui "$id" content_size large
    xcrun simctl ui "$id" increase_contrast disabled
    ;;
  shot)
    id="$(resolve "$1")"
    xcrun simctl io "$id" screenshot --type=png "$2" >/dev/null
    echo "$2"
    ;;
  *)
    sed -n '2,16p' "$0"; exit 2 ;;
esac
