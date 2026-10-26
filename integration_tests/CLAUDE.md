# Integration tests project

## Macro unit tests

- Mirror the package macro tree: for each path under [`macros/`](../macros/), place the corresponding test file under `macros/tests/` with the **same relative directories**, prefixed with `test_` on the basename.
  - Example: [`macros/example/normalize_text.sql`](../macros/example/normalize_text.sql) → `macros/tests/example/test_normalize_text.sql`
- **Exception:** the single entry macro for `dbt run-operation` stays at `macros/tests/test_macros.sql` (not nested). New suites are invoked from `test_macros()` there.

## Assertions and SQL

- Use [dbt-unittest](https://github.com/yu-iskw/dbt-unittest) (`dbt_unittest.*`) for assertions.
- Call package macros as `dbt_package_template.<macro>(...)`, compile or run SQL with `run_query` as needed.

## Contributor details

See [`CONTRIBUTING.md`](../CONTRIBUTING.md) for setup (`make setup-integration-tests`) and full testing instructions.
