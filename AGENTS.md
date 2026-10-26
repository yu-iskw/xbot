# AGENTS.md

## Repository Overview

- This repository is a dbt package template for reusable macros and tests.
- The supported execution adapters are Postgres and DuckDB.
- Prefer minimal, focused changes that keep the starter template easy to understand and copy.

## Agent documentation map

- For **Codex**, read [`.codex/config.toml`](.codex/config.toml) for shared defaults, profiles, and repo-local subagents.
- Read [`CLAUDE.md`](CLAUDE.md) for Claude Code–specific notes (subagents, `initialize-dbt-package` skill) and for the same macro and integration pointers in prose form.
- When changing or adding **package macros**, read [`macros/CLAUDE.md`](macros/CLAUDE.md) for folder layout, `adapter.dispatch` / `macro_namespace`, and [`macros/properties.yml`](macros/properties.yml) for **dbt docs** metadata.
- When changing **macro unit tests** or the integration harness layout, read [`integration_tests/CLAUDE.md`](integration_tests/CLAUDE.md) for mirroring `macros/` → `macros/tests/`, `test_` naming, and the `test_macros.sql` exception.

## Codex workflow

- Use `codex --profile fast` for smaller edits and iterative investigation.
- Use `codex --profile deep` for planning, deeper review, or broader changes.
- Use `codex --profile review` when the main job is bug-finding and regression review.
- Use `codex --profile verify` when the main job is lint and test execution.
- Repo-local Codex subagents live under [`.codex/agents/`](.codex/agents/):
  - `macro_package_specialist` for macro changes, macro docs, and mirrored macro-runner tests
  - `verifier` for `make lint`, unit tests, and selective/full integration verification
  - `reviewer` for read-only review of macro, config, workflow, and docs regressions
  - `test_gap_checker` for missing unit, integration, and workflow coverage
- Repo-local advisory hook scripts live under [`.codex/hooks/`](.codex/hooks/):
  - `context_router.sh` suggests which repo docs to read for a file area
  - `verification_hint.sh` suggests the right verification target for changed paths
  - `check_sandbox_parity.sh` reminds you to keep `.claude/settings.json` and `.cursor/sandbox.json` aligned
- Keep Codex-specific orchestration thin. The canonical task knowledge for this repo remains in [`.claude/skills/`](.claude/skills/) and is exposed through [`.agents/skills`](.agents/skills).

## Working Rules

- Read the nearest `README.md`, relevant macro files, and existing tests before editing behavior.
- Keep changes aligned with existing dbt and SQL style in the repository.
- Do not modify unrelated generated or fixture data unless the task requires it.
- If public behavior changes, update the relevant documentation in `README.md` or `docs/`.

## Testing

- Run tests from the `integration_tests` directory.
- For most code changes, run `make run-unit-tests`.
- When behavior changes affect generated SQL or dbt execution flows, also run `make run-integration-tests`.

## Repository-Specific Notes

- Keep `.cursor/sandbox.json` aligned with the sandbox section of `.claude/settings.json` when either file changes.
- GitHub workflow changes should stay consistent with the commands and paths used by this repository's Makefiles and test scripts.
