#!/usr/bin/env bash
set -euo pipefail

PID_FILE="${CURSORSCOPE_PID_FILE:-$HOME/.cursor/cursorscope.pid}"

if [[ ! -f "$PID_FILE" ]]; then
  echo "cursorscope: not running (no pid file)"
  exit 0
fi

pid="$(cat "$PID_FILE")"
if kill -0 "$pid" 2>/dev/null; then
  kill "$pid"
  echo "cursorscope: stopped (pid $pid)"
else
  echo "cursorscope: stale pid file (process $pid not running)"
fi

rm -f "$PID_FILE"
