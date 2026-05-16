#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export CURSORSCOPE_HOME="${CURSORSCOPE_HOME:-$ROOT}"

"$ROOT/scripts/ensure-cursorscope.sh" || true

export CURSOR_HOOK_READ_STDIN=true
exec node "$ROOT/scripts/cursor-hook-forwarder.js"
