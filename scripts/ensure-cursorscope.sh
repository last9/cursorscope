#!/usr/bin/env bash
# Start cursorscope ingestor in the background if not already healthy (matching version).
set -euo pipefail

if [[ "${CURSORSCOPE_AUTO_START:-true}" == "false" ]]; then
  exit 0
fi

CURSORSCOPE_HOME="${CURSORSCOPE_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
PORT="${PORT:-8787}"
PID_FILE="${CURSORSCOPE_PID_FILE:-$HOME/.cursor/cursorscope.pid}"
LOG_FILE="${CURSORSCOPE_LOG_FILE:-$HOME/.cursor/cursorscope.log}"
HEALTH_URL="http://127.0.0.1:${PORT}/healthz"
EXPECTED_VERSION="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$CURSORSCOPE_HOME/package.json','utf8')).version)")"

stop_running() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      sleep 0.3
    fi
    rm -f "$PID_FILE"
  fi
}

running_version() {
  curl -sf --max-time 1 "$HEALTH_URL" 2>/dev/null | node -e "
    let s='';
    process.stdin.on('data',d=>s+=d);
    process.stdin.on('end',()=>{ try { console.log(JSON.parse(s).version||''); } catch { console.log(''); } });
  " 2>/dev/null || true
}

if curl -sf --max-time 1 "$HEALTH_URL" >/dev/null 2>&1; then
  current="$(running_version)"
  if [[ "$current" == "$EXPECTED_VERSION" ]]; then
    exit 0
  fi
  echo "cursorscope: restarting (running v${current:-?}, expected v${EXPECTED_VERSION})" >>"$LOG_FILE"
  stop_running
fi

if [[ -f "$PID_FILE" ]]; then
  existing_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" 2>/dev/null; then
    for _ in 1 2 3 4 5; do
      if curl -sf --max-time 1 "$HEALTH_URL" >/dev/null 2>&1; then
        current="$(running_version)"
        if [[ "$current" == "$EXPECTED_VERSION" ]]; then
          exit 0
        fi
        stop_running
        break
      fi
      sleep 0.4
    done
    if [[ -f "$PID_FILE" ]]; then
      stop_running
    fi
  else
    rm -f "$PID_FILE"
  fi
fi

if [[ ! -d "$CURSORSCOPE_HOME" ]]; then
  echo "cursorscope: CURSORSCOPE_HOME not found: $CURSORSCOPE_HOME" >&2
  exit 1
fi

if [[ ! -f "$CURSORSCOPE_HOME/src/server.js" ]]; then
  echo "cursorscope: missing src/server.js under $CURSORSCOPE_HOME" >&2
  exit 1
fi

mkdir -p "$(dirname "$PID_FILE")" "$(dirname "$LOG_FILE")"

cd "$CURSORSCOPE_HOME"

if [[ ! -d node_modules ]]; then
  echo "cursorscope: installing dependencies (first run)..." >>"$LOG_FILE"
  npm install >>"$LOG_FILE" 2>&1
fi

ENV_FILE="$CURSORSCOPE_HOME/.env"
START_CMD=(node)
if [[ -f "$ENV_FILE" ]]; then
  START_CMD+=(--env-file="$ENV_FILE")
fi
START_CMD+=(src/server.js)

nohup "${START_CMD[@]}" >>"$LOG_FILE" 2>&1 &
echo $! >"$PID_FILE"

for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sf --max-time 1 "$HEALTH_URL" >/dev/null 2>&1; then
    exit 0
  fi
  sleep 0.3
done

echo "cursorscope: started (pid $(cat "$PID_FILE")) but health check pending — see $LOG_FILE" >&2
exit 0
