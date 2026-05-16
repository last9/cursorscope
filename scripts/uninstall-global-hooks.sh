#!/usr/bin/env bash
# Remove only cursorscope entries from ~/.cursor/hooks.json; keep all other hooks.
set -euo pipefail

HOOKS_JSON="$HOME/.cursor/hooks.json"
FORWARD_SCRIPT="$HOME/.cursor/hooks/cursorscope-forward.sh"

if [[ ! -f "$HOOKS_JSON" ]]; then
  echo "No $HOOKS_JSON — nothing to uninstall"
  exit 0
fi

cp "$HOOKS_JSON" "$HOOKS_JSON.bak.$(date +%Y%m%d%H%M%S)"

python3 - <<'PY' "$HOOKS_JSON"
import json
import re
import sys
from pathlib import Path

hooks_json = Path(sys.argv[1])
data = json.loads(hooks_json.read_text())
hooks = data.get("hooks", {})

LEGACY = re.compile(
    r"cursorscope-forward|cursor-otel|cursor-hook-forwarder|session-start-otel|before-submit-prompt-otel",
    re.I,
)

removed = 0
for event, entries in list(hooks.items()):
    if not isinstance(entries, list):
        continue
    filtered = [h for h in entries if not LEGACY.search(str(h.get("command", "")))]
    removed += len(entries) - len(filtered)
    if filtered:
        hooks[event] = filtered
    else:
        del hooks[event]

hooks_json.write_text(json.dumps(data, indent=2) + "\n")
print(f"Removed {removed} cursorscope hook(s) from {hooks_json}")
PY

rm -f "$FORWARD_SCRIPT"
echo "Done. Your other hooks were left unchanged."
