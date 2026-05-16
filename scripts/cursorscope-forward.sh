#!/usr/bin/env bash
# User-level hook entry: auto-start ingestor, then forward event to OTLP pipeline.
set -euo pipefail

export CURSORSCOPE_HOME="${CURSORSCOPE_HOME:-$HOME/Projects/cursorscope}"

"$CURSORSCOPE_HOME/scripts/ensure-cursorscope.sh" || true

export CURSOR_HOOK_READ_STDIN=true
exec node "$CURSORSCOPE_HOME/scripts/cursor-hook-forwarder.js"
