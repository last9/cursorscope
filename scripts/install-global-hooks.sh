#!/usr/bin/env bash
# Add cursorscope to ~/.cursor/hooks.json without removing existing user hooks.
set -euo pipefail

CURSORSCOPE_HOME="${CURSORSCOPE_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
HOOKS_JSON="$HOME/.cursor/hooks.json"
FORWARD_SCRIPT="$HOME/.cursor/hooks/cursorscope-forward.sh"

# Keep paired tool and session events; noisy thought/read/tab events are opt-in.
DEFAULT_EVENTS="sessionStart sessionEnd beforeSubmitPrompt preToolUse postToolUse postToolUseFailure beforeShellExecution afterShellExecution beforeMCPExecution afterMCPExecution afterFileEdit subagentStart subagentStop afterAgentResponse stop preCompact"
ALL_EVENTS="$DEFAULT_EVENTS beforeReadFile afterTabFileEdit afterAgentThought"
EVENTS="${CURSORSCOPE_HOOK_EVENTS:-$DEFAULT_EVENTS}"
if [[ "$EVENTS" == "all" ]]; then
  EVENTS="$ALL_EVENTS"
fi

python3 - "$HOOKS_JSON" "$FORWARD_SCRIPT" "$EVENTS" "$ALL_EVENTS" "$CURSORSCOPE_HOME" <<'PY'
import datetime
import json
import re
import shlex
import shutil
import sys
from pathlib import Path

hooks_json = Path(sys.argv[1])
forward = Path(sys.argv[2])
events = list(dict.fromkeys(re.split(r"[,\s]+", sys.argv[3].strip())))
unknown = set(events) - set(sys.argv[4].split())
if unknown:
    sys.exit(f"Unknown CURSORSCOPE_HOOK_EVENTS: {', '.join(sorted(unknown))}")
home = sys.argv[5]

LEGACY_PATTERNS = re.compile(
    r"cursorscope-forward|cursor-otel|cursor-hook-forwarder|session-start-otel|before-submit-prompt-otel",
    re.I,
)

existing = {"version": 1, "hooks": {}}
if hooks_json.exists():
    existing = json.loads(hooks_json.read_text())

hooks = existing.setdefault("hooks", {})
# Reconcile the whole old selection, so switching from all to lean actually
# removes previously installed noisy hooks while preserving user hooks.
for event, current in list(hooks.items()):
    if not isinstance(current, list):
        current = [current]
    kept = [h for h in current if not LEGACY_PATTERNS.search(str(h.get("command", "")))]
    if kept:
        hooks[event] = kept
    else:
        del hooks[event]
for event in events:
    hooks.setdefault(event, []).append({"command": f"{shlex.quote(str(forward))} {event}"})

forward.parent.mkdir(parents=True, exist_ok=True)
if hooks_json.exists():
    suffix = datetime.datetime.now().strftime("%Y%m%d%H%M%S%f")
    shutil.copy2(hooks_json, f"{hooks_json}.bak.{suffix}")
forward.write_text(
    "#!/bin/sh\n"
    f"export CURSORSCOPE_HOME={shlex.quote(home)}\n"
    'exec "$CURSORSCOPE_HOME/scripts/cursorscope-forward.sh" "$@"\n'
)
forward.chmod(0o755)
hooks_json.write_text(json.dumps(existing, indent=2) + "\n")
print(f"Merged cursorscope into {hooks_json} (existing hooks preserved)")
PY

chmod +x "$CURSORSCOPE_HOME/scripts/ensure-cursorscope.sh"
chmod +x "$CURSORSCOPE_HOME/scripts/cursorscope-forward.sh"
chmod +x "$CURSORSCOPE_HOME/scripts/stop-cursorscope.sh"
echo "Installed: $FORWARD_SCRIPT"
echo "Backup:    $HOOKS_JSON.bak.* (if hooks.json existed)"
echo "Restart Cursor. Logs: ~/.cursor/cursorscope.log"
echo "Remove only cursorscope hooks: npm run uninstall:global-hooks"
