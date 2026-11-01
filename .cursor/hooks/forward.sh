#!/bin/sh
# Use the same sender as the global installation, including its event argument.
CURSORSCOPE_HOME="${CURSORSCOPE_HOME:-$(CDPATH= cd -- "${0%/*}/../.." && pwd)}"
export CURSORSCOPE_HOME
exec "$CURSORSCOPE_HOME/scripts/cursorscope-forward.sh" "$@"
