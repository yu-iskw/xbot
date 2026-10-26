#!/bin/sh
set -eu

if [ "$#" -eq 0 ]; then
  cat <<'EOF'
Suggested context:
- AGENTS.md
- CLAUDE.md
- CONTRIBUTING.md
EOF
  exit 0
fi

need_root=0
need_macros=0
need_tests=0

for path in "$@"; do
  case "$path" in
    macros/*|macros)
      need_macros=1
      ;;
    integration_tests/*|integration_tests)
      need_tests=1
      ;;
    .codex/*|.claude/*|.cursor/*|AGENTS.md|CLAUDE.md|CONTRIBUTING.md|Makefile)
      need_root=1
      ;;
  esac
done

echo "Suggested context:"
echo "- AGENTS.md"
echo "- CLAUDE.md"
echo "- CONTRIBUTING.md"

if [ "$need_macros" -eq 1 ]; then
  echo "- macros/CLAUDE.md"
  echo "- macros/properties.yml"
fi

if [ "$need_tests" -eq 1 ] || [ "$need_macros" -eq 1 ]; then
  echo "- integration_tests/CLAUDE.md"
fi

if [ "$need_root" -eq 1 ]; then
  echo "- .codex/config.toml"
  echo "- .claude/settings.json"
  echo "- .cursor/sandbox.json"
fi
