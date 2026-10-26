#!/usr/bin/env bash
# PreToolUse hook: block writes to integration_tests/profiles/ (connection credentials).
# Input: Claude tool call JSON on stdin.
# Exits 2 to block the tool call with an explanatory message.
# shellcheck disable=SC1091
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "${HOOK_DIR}/lib.sh"

file_path="$(hook_tool_file_path)"
if [[ "$file_path" == *"integration_tests/profiles/"* ]]; then
  echo "BLOCKED: integration_tests/profiles/ contains connection credentials. Edit manually if needed."
  exit 2
fi
