#!/usr/bin/env bash
# Return Cursor's response immediately; telemetry must never gate an action.
export CURSORSCOPE_HOME="${CURSORSCOPE_HOME:-$HOME/.cursorscope}"
event="${1:-${CURSOR_HOOK_EVENT:-}}"

# See https://cursor.com/docs/hooks: permission hooks and prompt submission
# have different response schemas. Telemetry never denies either operation.
case "$event" in
  preToolUse|beforeShellExecution|beforeReadFile|beforeMCPExecution|subagentStart)
    printf '{"permission":"allow"}\n' ;;
  beforeSubmitPrompt)
    printf '{"continue":true}\n' ;;
  "")
    # Compatibility for old installed wrappers; reinstall to pass the event.
    printf '{"continue":true,"permission":"allow"}\n' ;;
  *) printf '{}\n' ;;
esac

# Drain stdin before exiting: hook runners may close the producer's pipe as
# soon as this process exits, truncating large payloads in a background reader.
# EOF completes immediately; the one-second deadline only guards a stuck writer.
export LC_ALL=C
payload=""
if [[ "${CURSOR_HOOK_READ_STDIN:-true}" != "false" && "${CURSOR_HOOK_READ_STDIN:-true}" != "0" && ! -t 0 ]]; then
  IFS= read -r -d '' -n 1048577 -t 1 payload
  read_status=$?
  if [[ "$read_status" != 1 || ${#payload} -gt 1048576 ]]; then
    exit 0
  fi
fi

# Close all inherited output pipes; Cursor must not wait for network or startup.
(
  if [[ "$event" == "sessionStart" ]]; then
    "$CURSORSCOPE_HOME/scripts/ensure-cursorscope.sh" || true
  fi

  # Form encoding preserves arbitrary JSON and caller metadata without a JSON
  # parser or an interpreter startup. Keep payload contents out of process args.
  exec curl -q -sf --connect-timeout 0.2 --max-time 0.5 \
    --data-urlencode 'hook_input@-' \
    --data-urlencode "user=${USER:-unknown}" \
    --data-urlencode "repo=$(pwd -P)" \
    --data-urlencode "event=$event" \
    "${CURSOR_HOOK_ENDPOINT:-http://127.0.0.1:${PORT:-4327}/cursor/hooks}" < <(printf '%s' "$payload")
) </dev/null >/dev/null 2>&1 &

exit 0
