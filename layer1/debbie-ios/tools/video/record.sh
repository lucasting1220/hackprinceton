#!/usr/bin/env bash
# Start/stop a Simulator screen recording for the screen gate (brief §8).
#   tools/video/record.sh start <small|large|udid> <out.mp4>   # returns immediately
#   tools/video/record.sh stop  <out.mp4>                      # finalises the file
# Then: swift tools/video/frames.swift <out.mp4> <frames-dir> --fps 30
set -euo pipefail
cd "$(dirname "$0")/../.."
cmd="${1:?start|stop}"
case "$cmd" in
  start)
    dev="${2:?device}"; out="${3:?out.mp4}"
    [[ "$dev" == small || "$dev" == large ]] && dev="$(tools/sim/sim.sh udid "$dev")"
    mkdir -p "$(dirname "$out")"
    nohup xcrun simctl io "$dev" recordVideo --codec=h264 --force "$out" >/dev/null 2>&1 &
    echo $! > "$out.pid"; sleep 1; echo "recording $out (pid $(cat "$out.pid"))" ;;
  stop)
    out="${2:?out.mp4}"; pid="$(cat "$out.pid")"
    kill -INT "$pid" 2>/dev/null || true
    for _ in $(seq 1 50); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
    rm -f "$out.pid"; ls -la "$out" ;;
  *) echo "usage: record.sh start <dev> <out> | stop <out>"; exit 2 ;;
esac
