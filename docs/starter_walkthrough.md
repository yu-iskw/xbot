# Starter Walkthrough

This template ships with one example macro and one example integration model so new package authors can start from a working baseline.

## Starter macro

The package macro lives at `macros/example/normalize_text.sql`.

It returns a SQL expression that:

- casts the input to the adapter string type
- lowercases the value
- trims surrounding whitespace
- converts empty strings to `null`

## Unit tests

Macro unit tests live under `integration_tests/macros/tests/`, **mirroring** the package macro tree (for example `macros/example/normalize_text.sql` pairs with `integration_tests/macros/tests/example/test_normalize_text.sql`). The `dbt run-operation` entry macro stays at `integration_tests/macros/tests/test_macros.sql`.

The test runner:

1. installs the local package via `packages.yml`
2. runs `dbt deps`
3. executes `dbt run-operation test_macros`

The starter unit tests demonstrate how to:

- evaluate a macro with literal input
- execute SQL against the target adapter
- fail fast with custom assertion helpers

## Integration tests

The example project uses the seed in `integration_tests/data/raw_users.csv` and the model in `integration_tests/models/example/stg_users.sql`.

Run the full local test flow from the repository root:

```bash
make setup-integration-tests
make run-unit-tests
make run-integration-tests
```

The integration suite executes on:

- `postgres`
- `duckdb`
