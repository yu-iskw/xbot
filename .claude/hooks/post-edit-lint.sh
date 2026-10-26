#!/usr/bin/env bash
# PostToolUse hook: run pre-commit on the edited file for lintable extensions.
# Input: Claude tool call JSON on stdin.
# Always exits 0 (informational only — never blocks Claude).
# shellcheck disable=SC1091
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "${HOOK_DIR}/lib.sh"

file_path="$(hook_tool_file_path)"
if [[ -z "$file_path" ]]; then
  exit 0
fi

case "$file_path" in
  *.sql|*.yml|*.yaml|*.md|*.sh|*.json) ;;
  *) exit 0 ;;
esac

uv run --group dev pre-commit run --files "$file_path" 2>&1 || true
