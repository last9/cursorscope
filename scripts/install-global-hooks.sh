#!/usr/bin/env bash
# Add cursorscope to ~/.cursor/hooks.json without removing existing user hooks.
set -euo pipefail

CURSORSCOPE_HOME="${CURSORSCOPE_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
CURSOR_DIR="$HOME/.cursor"
HOOKS_DIR="$CURSOR_DIR/hooks"
HOOKS_JSON="$CURSOR_DIR/hooks.json"
FORWARD_SCRIPT="$HOOKS_DIR/cursorscope-forward.sh"

# Default: telemetry + auto-start hooks. Set CURSORSCOPE_HOOK_EVENTS=all for every event type.
DEFAULT_EVENTS=(
  sessionStart sessionEnd beforeSubmitPrompt
  preToolUse postToolUse postToolUseFailure
  beforeShellExecution afterShellExecution
  beforeMCPExecution afterMCPExecution
  beforeReadFile afterFileEdit afterTabFileEdit
  subagentStart subagentStop afterAgentResponse afterAgentThought stop preCompact
)

mkdir -p "$HOOKS_DIR"

cat >"$FORWARD_SCRIPT" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export CURSORSCOPE_HOME="$CURSORSCOPE_HOME"
exec "\$CURSORSCOPE_HOME/scripts/cursorscope-forward.sh"
EOF
chmod +x "$FORWARD_SCRIPT"
chmod +x "$CURSORSCOPE_HOME/scripts/ensure-cursorscope.sh"
chmod +x "$CURSORSCOPE_HOME/scripts/cursorscope-forward.sh"
chmod +x "$CURSORSCOPE_HOME/scripts/stop-cursorscope.sh"

if [[ -f "$HOOKS_JSON" ]]; then
  cp "$HOOKS_JSON" "$HOOKS_JSON.bak.$(date +%Y%m%d%H%M%S)"
fi

EVENTS_CSV="${CURSORSCOPE_HOOK_EVENTS:-}"
if [[ "$EVENTS_CSV" == "all" ]]; then
  EVENTS_CSV="sessionStart sessionEnd beforeSubmitPrompt preToolUse postToolUse postToolUseFailure beforeShellExecution afterShellExecution beforeMCPExecution afterMCPExecution beforeReadFile afterFileEdit afterTabFileEdit subagentStart subagentStop afterAgentResponse afterAgentThought stop preCompact"
fi
if [[ -z "$EVENTS_CSV" ]]; then
  EVENTS_CSV="${DEFAULT_EVENTS[*]}"
fi

python3 - <<'PY' "$HOOKS_JSON" "$FORWARD_SCRIPT" "$EVENTS_CSV"
import json
import re
import sys
from pathlib import Path

hooks_json = Path(sys.argv[1])
forward = sys.argv[2]
events = sys.argv[3].split()

LEGACY_PATTERNS = re.compile(
    r"cursorscope-forward|cursor-otel|cursor-hook-forwarder|session-start-otel|before-submit-prompt-otel",
    re.I,
)

def is_legacy_cursorscope(hook: dict) -> bool:
    cmd = str(hook.get("command", ""))
    return bool(LEGACY_PATTERNS.search(cmd))

def merge_event_hooks(current: list, forward_cmd: str) -> list:
    kept = [h for h in current if not is_legacy_cursorscope(h)]
    if not any(h.get("command") == forward_cmd for h in kept):
        kept.append({"command": forward_cmd})
    return kept

existing = {"version": 1, "hooks": {}}
if hooks_json.exists():
    existing = json.loads(hooks_json.read_text())

hooks = existing.setdefault("hooks", {})
for event in events:
    current = hooks.get(event, [])
    if not isinstance(current, list):
        current = [current]
    hooks[event] = merge_event_hooks(current, forward)

hooks_json.write_text(json.dumps(existing, indent=2) + "\n")
print(f"Merged cursorscope into {hooks_json} (existing hooks preserved)")
PY

echo "Installed: $FORWARD_SCRIPT"
echo "Backup:    $HOOKS_JSON.bak.* (if hooks.json existed)"
echo "Restart Cursor. Logs: ~/.cursor/cursorscope.log"
echo "Remove only cursorscope hooks: npm run uninstall:global-hooks"
