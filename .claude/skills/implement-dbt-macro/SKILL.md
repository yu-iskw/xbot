---
name: implement-dbt-macro
description: Implement or refactor dbt Jinja macros for macro-first dbt packages (e.g. dbt-package-template with Postgres/DuckDB, ubie-oss/dbt-data-privacy). Document public macros for dbt docs in macros/properties.yml. Use when adding adapter-dispatched macros, codegen helpers, pseudonymization helpers, or public macro entrypoints under macros/.
license: Apache-2.0
compatibility: Designed for Agent Skills compatible clients, with Codex loading from repo-root skills/ via .codex-plugin/plugin.json, Claude via .claude-plugin/plugin.json, and Cursor via .cursor-plugin/plugin.json.
metadata:
  owner: yu-iskw
  repository: dbt-package-template
  source-domain: ubie-oss/dbt-data-privacy
---

# Implement dbt macros

Use this skill when the main product is a dbt macro library, not a model-only project.

## Goal

Ship macros that are:

- clear about their return type
- safe across adapter boundaries
- easy to verify in a nested `integration_tests/` project
- consistent with package-level docs and public macro contracts
- documented for **dbt docs** via `macros/properties.yml` (or equivalent properties YAML under the macro tree) when the package ships macro metadata

## Apply this skill when

- adding or changing a public macro in this repository’s macro tree (in **dbt-package-template**: grouped folders such as `macros/example/`; do not assume `macros/public/` unless the repo uses that layout)
- changing adapter-dispatched codegen or SQL-fragment macros
- extending pseudonymization or helper logic (other packages)
- touching macro namespaces, arguments, or return shapes

**dbt-package-template:** Read [macros/CLAUDE.md](../../../macros/CLAUDE.md). Public macros use `adapter.dispatch('<name>', 'dbt_package_template')` with `default__<name>` and optional adapter-specific implementations in the **same file** as the dispatcher; `macro_namespace` must match `name` in the root `dbt_project.yml`. For other repositories (e.g. flat `dbt-unittest`), follow that repo’s layout and dispatch rules instead.

## Workflow

1. Inspect the package layout before editing. Identify the package `name` in root `dbt_project.yml` (for dispatched package macros, `macro_namespace` must match), the public entrypoint, helpers, and the test harness. If the nested `integration_tests/` project or smoke `dbt run-operation test_macros` path is missing, bootstrap using [CONTRIBUTING.md](../../../CONTRIBUTING.md) and [AGENTS.md](../../../AGENTS.md). Use a scaffold skill only if this repository includes one under `.claude/skills/`.
2. Decide whether the change belongs in a public macro, adapter implementation, codegen helper, utility helper, or config/system macro.
3. If behavior is warehouse-specific, use `adapter.dispatch(...)` with a thin public wrapper and an adapter implementation rather than embedding BigQuery-specific SQL directly in a generic macro.
4. For `dbt-data-privacy`-style changes, explicitly decide whether the macro is a standalone helper or part of the metadata -> codegen -> generated-model pipeline. If it is pipeline-backed, identify the wiring points before editing.
5. Keep the public macro narrow. Move heavy logic into helpers so the contract, arguments, and return value stay easy to understand.
6. For pseudonymization helpers, document null handling, input normalization, redaction or hashing strategy, and any adapter limitations.
7. Update tests and docs in the same change. For macro-runner tests, follow the patterns in `../implement-dbt-macro-unit-test/`.
8. Add or update entries under `macros:` in `macros/properties.yml` (or split properties files under `macros/` if the package already does) for each **public** macro you add or change. See [references/macro-documentation.md](references/macro-documentation.md) for the dbt pattern, dispatcher naming, and argument alignment.
9. If the change is broader than one macro layer, also use `../implement-dbt-package-feature/`.
10. Verify with the repository's real test path rather than inventing a new one (in **dbt-package-template**: `make run-unit-tests` from the repo root).

## Output expectations

When you use this skill, you should explicitly answer:

- which file is the public entrypoint
- which file is the adapter-specific implementation
- which helper files or metadata paths are involved
- which test macro or integration workflow must change
- which verification commands should run
- which `macros/properties.yml` (or other macro properties file) you touched and which `name` entries under `macros:` you added or updated
- whether README or contributor docs need a usage or behavior cross-link when the change is user-facing

## Read before deep edits

- [CLAUDE.md](../../../CLAUDE.md) and [macros/CLAUDE.md](../../../macros/CLAUDE.md) when working in **dbt-package-template**
- [references/macro-documentation.md](references/macro-documentation.md) before editing macro documentation YAML
- For other upstream macro packages, read **that** repository’s layout and documentation; do not assume `macros/public/` or BigQuery-only patterns.

## Guardrails

- Do not confuse macro-runner tests with dbt Core YAML `unit_tests:`.
- Treat BigQuery-first behavior as a package-specific default, not universal dbt behavior.
- Prefer existing package conventions over generic dbt advice.
- If README or test scripts disagree, trust the current implementation and CI entrypoints over stale docs.
- In **dbt-package-template**, public macros **must** use `adapter.dispatch` per [macros/CLAUDE.md](../../../macros/CLAUDE.md). In other flat macro packages, mirror that repository’s tree and follow **its** dispatch rules—do not copy `dbt-data-privacy` or template patterns blindly.
- Do not add separate `macros:` documentation entries for `default__*` / `postgres__*` (or other adapter) implementations unless they are intentionally user-facing entrypoints; document the **dispatcher** macro name consumers call.
- dbt Core 1.10+ can optionally validate documented macro arguments via the `validate_macro_args` behavior-change flag; enable project-wide only when you intend stricter alignment—do not turn it on casually.
