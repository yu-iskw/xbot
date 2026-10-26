---
name: initialize-dbt-package
description: Rename the dbt package identity after copying dbt-package-template—dbt_project.yml name, adapter.dispatch macro_namespace, Jinja refs, integration_tests project, Docker/CI defaults, docs, and skill examples. Use when forking the template, initializing a new macro package repo, or replacing dbt_package_template with a real package name.
license: Apache-2.0
compatibility: Designed for Agent Skills compatible clients loading skills from `.claude/skills/`.
metadata:
  owner: yu-iskw
  repository: dbt-package-template
---

# Initialize / rename dbt package (from template)

Use this skill when someone copies **dbt-package-template** and must make the repository **their** package: one consistent **package name** across dbt config, Jinja, SQL, tests, and tooling defaults.

## Goal

- Pick a valid dbt project `name` (typically **snake_case** / underscores).
- Propagate it everywhere the template currently says `dbt_package_template` (and related integration project, Docker, CI, docs).
- Keep `adapter.dispatch(..., macro_namespace)` **identical** to root [`dbt_project.yml`](../../../dbt_project.yml) `name` (see [`macros/CLAUDE.md`](../../../macros/CLAUDE.md)).

## Gather inputs

1. **`PACKAGE_SNAKE`** — value for root `dbt_project.yml` `name` (e.g. `acme_dbt_utils`).
2. **`PACKAGE_INTEGRATION`** — usually `{PACKAGE_SNAKE}_integration_tests`; must match [`integration_tests/dbt_project.yml`](../../../integration_tests/dbt_project.yml) `name` **and** the `models:` top-level key.
3. **`PACKAGE_KEBAB`** — for Docker container names (e.g. `acme-dbt-utils`); derive from `PACKAGE_SNAKE` by replacing `_` with `-`.

## Workflow

1. Open [references/init-package-checklist.md](references/init-package-checklist.md) and work through sections **in order**.
2. Edit **macros first** (`adapter.dispatch` second argument), then **SQL** (`{{ PACKAGE_SNAKE.macro(...) }}`), then **YAML** projects, then **profiles / Docker / CI / scripts / noxfile**, then **docs** and **`.claude/skills/**` examples.
3. Confirm the local package entry in [`integration_tests/packages.yml`](../../../integration_tests/packages.yml) still points at `local: ../`, then run `dbt deps` from `integration_tests/` after the root `name` is final. Treat [`integration_tests/uv.lock`](../../../integration_tests/uv.lock) separately as Python environment locking, not dbt package resolution.
4. Run `rg 'dbt_package_template|dbt-package-template'` from the repo root (exclude vendor dirs) and fix stragglers.
5. Verify with `make run-unit-tests` and `make run-integration-tests` from the repo root ([`AGENTS.md`](../../../AGENTS.md)).

## Output expectations

When you use this skill, state explicitly:

- the three chosen names (`PACKAGE_SNAKE`, `PACKAGE_INTEGRATION`, `PACKAGE_KEBAB`)
- files changed (grouped: macros, SQL, dbt_project, infra, docs, skills)
- confirmation that **no** `adapter.dispatch` namespace disagrees with root `dbt_project.yml` `name`
- test commands run and result

## Guardrails

- Renaming is **not** only [`dbt_project.yml`](../../../dbt_project.yml); missing SQL or dispatch updates will break compilation.
- Do not rename third-party packages in [`integration_tests/packages.yml`](../../../integration_tests/packages.yml) unless the user asked to change dependencies.
- Postgres **database/schema** defaults in CI/Docker are **environmental**; they may match `PACKAGE_SNAKE` or follow org policy—document what you chose.

## Read next

- [references/init-package-checklist.md](references/init-package-checklist.md)
- [macros/CLAUDE.md](../../../macros/CLAUDE.md)
- [integration_tests/CLAUDE.md](../../../integration_tests/CLAUDE.md)
