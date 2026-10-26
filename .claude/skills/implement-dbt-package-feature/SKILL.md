---
name: implement-dbt-package-feature
description: Implement or extend features in a macro-first dbt package (e.g. dbt-package-template), including public macro surfaces, docs, nested integration_tests, and verification via make run-unit-tests / make run-integration-tests. Use when a change spans more than a single macro file.
license: Apache-2.0
compatibility: Designed for Agent Skills compatible clients, with Codex loading from repo-root skills/ via .codex-plugin/plugin.json, Claude via .claude-plugin/plugin.json, and Cursor via .cursor-plugin/plugin.json.
metadata:
  owner: yu-iskw
  repository: dbt-package-template
  source-domain: ubie-oss/dbt-data-privacy
---

# Implement dbt package features

Use this skill when the requested change crosses package boundaries: public macros, docs, nested integration tests, package configuration, or release-facing behavior.

## Goal

Treat the package as a product with:

- a public macro API
- internal helper layers
- a nested `integration_tests/` project
- docs and CI that need to stay in sync

## Apply this skill when

- adding a new public feature backed by multiple macros
- changing package structure or namespace
- modifying docs plus code plus tests together
- adjusting package-level configuration, codegen behavior, or integration workflows

## Workflow

1. If the macro-runner harness is missing or not smoke-verified (`dbt deps` + `dbt run-operation test_macros` from `integration_tests/`), bootstrap or fix it using [CONTRIBUTING.md](../../../CONTRIBUTING.md) and [AGENTS.md](../../../AGENTS.md) before large changes that assume tests run. Use a scaffold skill only if this repository includes one under `.claude/skills/`.
2. Classify the change: public API, internal helper, generated output, testing only, or docs only.
3. Map the package boundaries: root package files versus nested `integration_tests/` files.
4. Update the minimum correct set of files in one pass: implementation, tests, docs, and any package-level configuration.
5. Keep consumer-facing behavior explicit. If a macro signature or generated artifact changes, document it.
6. If the feature changes codegen, adapter dispatch, or privacy metadata handling, also read `../implement-dbt-macro/` before editing.
7. Choose the right test type: macro-runner tests for macro logic, generated-model or integration runs for end-to-end artifact changes, or both when the feature crosses layers.
8. Verify using the package's current local scripts or CI workflow, not a guessed dbt command. In **dbt-package-template**, from the repo root: `make run-unit-tests` and `make run-integration-tests` (see [AGENTS.md](../../../AGENTS.md)).

## Output expectations

When you use this skill, you should explicitly answer:

- what the public package contract is before and after the change
- which root-package files must change
- which `integration_tests/` files must change
- whether README or docs must change
- which validation path proves the feature works

## Read before broad changes

- [CLAUDE.md](../../../CLAUDE.md) when working in **dbt-package-template**
- [references/package-change-checklist.md](references/package-change-checklist.md)
- [macros/CLAUDE.md](../../../macros/CLAUDE.md) when the change touches public macros or dispatch in **dbt-package-template**

## Guardrails

- Do not treat a macro package like a single-model project.
- Do not update README examples without checking the real scripts and current package behavior.
- Keep the nested integration test project wired to the local package.
- Greenfield or broken macro-runner harness: follow [CONTRIBUTING.md](../../../CONTRIBUTING.md); do not reference scaffold skills that are not present under `.claude/skills/`.
- If the change is actually just a macro test, use `../implement-dbt-macro-unit-test/` instead.
