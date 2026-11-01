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
# Most payloads fit in this bounded builtin read, avoiding foreground helpers.
# Use bytes (not locale characters); -d '' rejects literal NUL, invalid in JSON.
export LC_ALL=C
prefix=
payload_file=
if [[ "${CURSOR_HOOK_READ_STDIN:-true}" != "false" && "${CURSOR_HOOK_READ_STDIN:-true}" != "0" && ! -t 0 ]]; then
  IFS= read -r -d '' -n 1024 -t 1 prefix
  read_status=$?
  if [[ "$read_status" -gt 128 ]]; then
    exit 0
  fi
  if [[ "$read_status" == 0 ]]; then
    [[ ${#prefix} == 1024 ]] || exit 0
    # Buffer larger inputs with head: timed Bash reads check the clock per byte.
    # The remaining limit includes one extra byte to detect oversize payloads.
    payload_file=$(mktemp "${TMPDIR:-/tmp}/cursorscope-hook.XXXXXXXX") || exit 0
    trap 'rm -f "$payload_file"' EXIT
    printf '%s' "$prefix" > "$payload_file"
    exec 3< <(
      head -c 1047553 <&0 >> "$payload_file" &
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
    [[ "$read_status" == 0 ]] || exit 0
  fi
fi

send_payload() {
  # Keep payload contents out of process arguments, including small inputs.
  curl -q -sf --connect-timeout 0.2 --max-time 0.5 \
    --data-urlencode "$1" \
    --data-urlencode "user=${USER:-unknown}" \
    --data-urlencode "repo=$(pwd -P)" \
    --data-urlencode "event=$event" \
    "${CURSOR_HOOK_ENDPOINT:-http://127.0.0.1:${PORT:-4327}/cursor/hooks}"
}

# Close all inherited output pipes; Cursor must not wait for network or startup.
(
  if [[ -n "$payload_file" ]]; then
    trap 'rm -f "$payload_file"' EXIT
    # Size validation can run after releasing Cursor; head already bounded storage.
    [[ $(wc -c < "$payload_file") -le 1048576 ]] || exit 0
  fi
  if [[ "$event" == "sessionStart" ]]; then
    "$CURSORSCOPE_HOME/scripts/ensure-cursorscope.sh" || true
  fi
  if [[ -n "$payload_file" ]]; then
    send_payload "hook_input@$payload_file"
  elif [[ -z "$prefix" ]]; then
    send_payload "hook_input="
  else
    printf '%s' "$prefix" | send_payload "hook_input@-"
  fi
) </dev/null >/dev/null 2>&1 &

# The sender now owns cleanup of any private payload file.
trap - EXIT
exit 0
