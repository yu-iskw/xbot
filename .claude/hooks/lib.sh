# Shared helpers for Claude Code hooks (sourced, not executed).
# shellcheck shell=bash

# Read tool_input.file_path from a Claude hook JSON payload on stdin.
hook_tool_file_path() {
  python3 -c "
import json, sys
d = json.load(sys.stdin)
print(d.get('tool_input', {}).get('file_path', ''))
" 2>/dev/null || true
}
