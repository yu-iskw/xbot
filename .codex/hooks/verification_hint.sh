#!/bin/sh
set -eu

if [ "$#" -eq 0 ]; then
  cat <<'EOF'
Recommended verification:
- make lint
EOF
  exit 0
fi

need_lint=0
need_unit=0
need_integration=0

for path in "$@"; do
  case "$path" in
    macros/*|integration_tests/macros/tests/*)
      need_lint=1
      need_unit=1
      ;;
    integration_tests/*|models/*|seeds/*|snapshots/*)
      need_lint=1
      need_unit=1
      need_integration=1
      ;;
    .codex/*|.claude/*|.cursor/*|*.md|Makefile|*.yml|*.yaml)
      need_lint=1
      ;;
  esac
done

echo "Recommended verification:"

if [ "$need_lint" -eq 1 ]; then
  echo "- make lint"
fi

if [ "$need_unit" -eq 1 ]; then
  echo "- make run-unit-tests"
fi

if [ "$need_integration" -eq 1 ]; then
  echo "- make run-integration-tests"
fi

if [ "$need_lint" -eq 0 ] && [ "$need_unit" -eq 0 ] && [ "$need_integration" -eq 0 ]; then
  echo "- make lint"
fi
