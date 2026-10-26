---
name: test-and-fix
description: Autonomously run tests, analyze failures, and fix them for this dbt package template (Postgres and DuckDB, nested integration_tests). Use make run-unit-tests and make run-integration-tests from the repo root unless the user specifies otherwise.
---

# Test and Fix

## Purpose

This skill provides an autonomous loop to identify, analyze, and fix test failures for **dbt-package-template**: macro-runner unit tests and integration project runs driven from **`integration_tests/`** via root **`make`** targets.

## Loop Logic

1. **Identify**: Run tests from the **repository root** (not inside `integration_tests/` unless debugging).
   - Confirm scope with the user when a **full** run is expensive (full suite = several nox sessions and Postgres Docker).
   - **`make run-unit-tests`** — macro-runner tests on Postgres and DuckDB for dbt-core 1.10 and 1.11.
   - **`make run-integration-tests`** — `dbt build` for the example project on the same adapters and core lines.
   - **`make test`** — runs **both** `run-unit-tests` and `run-integration-tests` (full dbt-core lane).
   - **Fusion** (optional): `make run-unit-tests-fusion`, `make run-integration-tests-fusion`, or **`make run-fusion-tests`** for both Fusion lanes.
2. **Analyze**: Examine test output and `integration_tests/logs/dbt.log` (after a run) for dbt errors, SQL compile failures, and macro assertion mismatches.
3. **Plan fix**: Apply the **smallest** change that addresses the failure; prefer fixing package macros, tests, or harness config—not widening scope without cause.
4. **Execute and re-run**: Re-run the **same** make target that failed until it passes, then broaden (e.g. add `make run-integration-tests` if you only ran unit tests and behavior crosses into models).
5. **Verify**: If you changed shared behavior, prefer **`make test`** before declaring done (when time permits).

## Termination Criteria

- Relevant targets exit with code 0.
- Max iteration limit of **5** attempts per skill loop.
- No progress: same root error after fixes → stop and report.

## Examples

### Scenario: Failing macro unit test

1. Run `make run-unit-tests` from repo root; note failing macro or assertion.
2. Inspect [`integration_tests/macros/tests/`](../../../integration_tests/macros/tests/) and package macros under [`macros/`](../../../macros/).
3. Fix the macro or test; re-run `make run-unit-tests`.
4. If integration models use the macro, run `make run-integration-tests` as well.

### Scenario: Integration project compile error

1. Run `make run-integration-tests`; read `integration_tests/logs/dbt.log`.
2. Fix model/ref/source in `integration_tests/` or package as needed; re-run until green.
