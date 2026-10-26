# Integration tests for `dbt-package-template`

This directory contains the test harness for two runnable lanes:

- a standard dbt-core lane on `postgres` and `duckdb` for `dbt-core-1-10` and `dbt-core-1-11`
- a `dbt Fusion` lane on the same `postgres` and `duckdb` contract

## Setup

```bash
uv sync
```

## Postgres

Local Postgres-backed tests use Docker Compose automatically. The repo starts and tears down a temporary Postgres container for the Postgres test phase.

Prerequisite:

```bash
docker compose version
```

The default profile values are:

- host: `localhost`
- port: `5432`
- user: `postgres`
- password: `postgres`
- database: `dbt_package_template`
- schema: `dbt_package_template`

## Commands

```bash
make run-unit-tests
make run-integration-tests
make run-unit-tests-fusion
make run-integration-tests-fusion
```

Useful helper commands:

```bash
make -C integration_tests postgres-up
make -C integration_tests postgres-down
make -C integration_tests postgres-logs
```

The unit-test harness runs `dbt run-operation test_macros`.
Macro test files mirror `macros/` under `macros/tests/` (for example `macros/tests/example/test_normalize_text.sql`).
The integration harness runs `dbt build` against the example project.

## Fusion lane

Fusion sessions live in [`noxfile_fusion.py`](noxfile_fusion.py) (not the default `noxfile.py` entrypoint). Run them with `uv run nox -f noxfile_fusion.py` (the Makefile fusion targets pass `-f` for you).

The Fusion lane installs the Fusion runtime into the nox session virtual environment and then runs the same Postgres and DuckDB targets as the dbt-core lane. CI runs Fusion on **Python 3.12** only.

Set `DBT_FUSION_VERSION` if you need to pin a specific Fusion build instead of the latest available installer target.
