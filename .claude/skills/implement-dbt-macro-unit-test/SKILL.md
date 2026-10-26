---
name: implement-dbt-macro-unit-test
description: Add or update macro-runner unit tests in nested integration_tests projects (mirrored paths under macros/tests/ in dbt-package-template), test_<macro>() files, aggregator registration, and verification via make run-unit-tests or dbt run-operation. Use when testing dbt macros instead of dbt Core YAML unit_tests.
license: Apache-2.0
compatibility: Designed for Agent Skills compatible clients, with Codex loading from repo-root skills/ via .codex-plugin/plugin.json, Claude via .claude-plugin/plugin.json, and Cursor via .cursor-plugin/plugin.json.
metadata:
  owner: yu-iskw
  repository: dbt-package-template
  source-domain: ubie-oss/dbt-data-privacy
---

# Implement dbt macro unit tests

Use this skill when the package tests macros through `dbt run-operation` and a nested `integration_tests/` project.

## Goal

Add deterministic macro tests that:

- run through the package's actual macro-runner harness
- check macro return values or generated SQL fragments
- register in the suite aggregator so CI actually executes them
- avoid confusing this pattern with dbt Core YAML `unit_tests:`

## Apply this skill when

- adding a new `test_<macro>()` macro
- extending a macro-runner suite
- wiring a new test into `test_macros`
- validating generated SQL or macro helper behavior

## Prerequisites

If the nested project, `packages.yml` local install, profiles, `test_macros` aggregator, or smoke `dbt run-operation test_macros` path is missing or failing, fix or bootstrap the harness using [CONTRIBUTING.md](../../../CONTRIBUTING.md) and [integration_tests/CLAUDE.md](../../../integration_tests/CLAUDE.md). Use a scaffold skill only if this repository includes one under `.claude/skills/`.

## Workflow

1. Locate the macro under test and identify whether it is a public macro, adapter implementation, or helper.
2. Match the repository's existing test style before writing anything new.
3. Add a focused `test_<name>()` macro under the nested `integration_tests/macros/tests/` tree. In **dbt-package-template**, **mirror** the package macro directories: e.g. `macros/example/foo.sql` → `integration_tests/macros/tests/example/test_foo.sql` (see [integration_tests/CLAUDE.md](../../../integration_tests/CLAUDE.md)); only `test_macros.sql` stays at `macros/tests/` root.
4. Match the repository's aggregator style. Some repos use a plain `test_macros()` body, while others dispatch into `adapter__test_macros()`.
5. Register the new test in the aggregator macro so it will run.
6. Run the repository's real macro test entrypoint. In **dbt-package-template**, from the repo root: `make run-unit-tests` (runs `integration_tests/run_unit_tests.sh` and `dbt run-operation test_macros`). Elsewhere, use the project's shell wrapper or documented command.
7. Check the CI workflow and confirm it invokes the same command or wrapper that you ran locally.

## Output expectations

When you use this skill, you should explicitly answer:

- where the new test file belongs
- what exact inputs and expected outputs to assert
- where the aggregator registration belongs
- which command proves the test actually runs

## Read before writing tests

- [integration_tests/CLAUDE.md](../../../integration_tests/CLAUDE.md) when working in **dbt-package-template**
- [references/macro-test-patterns.md](references/macro-test-patterns.md)
- [assets/test-macro-template.md](assets/test-macro-template.md)

## Guardrails

- Do not use dbt Core YAML `unit_tests:` when the package uses macro-runner tests.
- A new test file is incomplete until it is referenced by the aggregator macro.
- Prefer literals and deterministic structures over warehouse-dependent side effects for unit-level checks.
- If the change spans docs and package structure too, also use `../implement-dbt-package-feature/`.
