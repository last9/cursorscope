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

# Drain stdin before exiting: runners may close the producer's pipe at exit.
# Buffer with head: a timed Bash read checks the clock per byte on large input.
# Only the tiny completion notification uses read's one-second deadline.
export LC_ALL=C
payload_file=$(mktemp "${TMPDIR:-/tmp}/cursorscope-hook.XXXXXXXX") || exit 0
trap 'rm -f "$payload_file"' EXIT
if [[ "${CURSOR_HOOK_READ_STDIN:-true}" != "false" && "${CURSOR_HOOK_READ_STDIN:-true}" != "0" && ! -t 0 ]]; then
  exec 3< <(
    head -c 1048577 <&0 > "$payload_file" &
    reader=$!
    printf '%s\n' "$reader"
    wait "$reader"
    printf '%s\n' "$?"
  )
  IFS= read -r reader <&3
  if ! IFS= read -r -t 1 read_status <&3; then
    kill "$reader" 2>/dev/null || true
    exec 3<&-
    exit 0
  fi
  exec 3<&-
  if [[ "$read_status" != 0 ]]; then
    exit 0
  fi
fi

# Close all inherited output pipes; Cursor must not wait for network or startup.
(
  trap 'rm -f "$payload_file"' EXIT
  # Size validation can run after releasing Cursor; head already bounded storage.
  if [[ $(wc -c < "$payload_file") -gt 1048576 ]]; then
    exit 0
  fi
  if [[ "$event" == "sessionStart" ]]; then
    "$CURSORSCOPE_HOME/scripts/ensure-cursorscope.sh" || true
  fi

  # Form encoding preserves arbitrary JSON and caller metadata without a JSON
  # parser or an interpreter startup. Keep payload contents out of process args.
  curl -q -sf --connect-timeout 0.2 --max-time 0.5 \
    --data-urlencode "hook_input@$payload_file" \
    --data-urlencode "user=${USER:-unknown}" \
    --data-urlencode "repo=$(pwd -P)" \
    --data-urlencode "event=$event" \
    "${CURSOR_HOOK_ENDPOINT:-http://127.0.0.1:${PORT:-4327}/cursor/hooks}"
) </dev/null >/dev/null 2>&1 &

# The sender now owns cleanup of the private payload file.
trap - EXIT
exit 0
