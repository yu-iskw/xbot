#!/bin/sh
set -eu

found=0

for path in "$@"; do
  if [ "$path" = ".claude/settings.json" ] || [ "$path" = ".cursor/sandbox.json" ]; then
    found=1
    break
  fi
done

if [ "$found" -eq 0 ]; then
  exit 0
fi

cat <<'EOF'
Sandbox parity reminder:
- Keep `.cursor/sandbox.json` aligned with the `sandbox` section of `.claude/settings.json`
- Re-check `.cursor/rules/sandbox.mdc` if the shared rule needs to mention new paths or domains
- Use `git diff -- .claude/settings.json .cursor/sandbox.json .cursor/rules/sandbox.mdc` before finishing
EOF
