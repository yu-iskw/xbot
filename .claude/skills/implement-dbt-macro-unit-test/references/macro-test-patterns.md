# Macro test patterns

This reference documents the macro-runner testing style used by packages such as `ubie-oss/dbt-data-privacy` and `dbt-unittest`.

## What "unit test" means here

These are not dbt Core YAML model unit tests.

Instead, the package defines Jinja test macros and runs them through `dbt run-operation`, often behind a shell wrapper such as `run_unit_tests.sh`.

## Typical file layout

Common paths:

- `integration_tests/macros/tests/test_<feature>.sql`
- `integration_tests/macros/tests/test_macros.sql`
- `integration_tests/run_unit_tests.sh`
- `integration_tests/noxfile_core.py` / `integration_tests/noxfile_fusion.py`

The nested `integration_tests/` project installs the package locally and provides the test execution context.

## Mirrored layout (dbt-package-template)

In the **dbt-package-template** repository, macro test files **mirror** the package macro directories under `macros/`:

- `macros/example/normalize_text.sql` pairs with `integration_tests/macros/tests/example/test_normalize_text.sql`
- use the same relative path under `integration_tests/macros/tests/` as under `macros/`, with a `test_` prefix on the basename
- keep the `dbt run-operation` entry macro at `integration_tests/macros/tests/test_macros.sql` only (not nested); register new suites with `{% do test_*() %}` there

Authoritative rules: [`integration_tests/CLAUDE.md`](../../../../integration_tests/CLAUDE.md) at the repository root.

## Aggregator pattern

The most important pattern is the aggregator macro.

There are two common variants:

- a plain `test_macros()` macro that directly calls every `test_*()` macro
- a dispatched runner where `test_macros()` forwards into an adapter-specific implementation such as `bigquery__test_macros()`

In `dbt-data-privacy`, the public test runner dispatches into an adapter-specific implementation:

```jinja
{% macro test_macros() %}
  {{- return(adapter.dispatch("test_macros", "dbt_data_privacy_integration_tests")()) -}}
{% endmacro %}
```

Then the adapter-specific body calls each test macro:

```jinja
{% macro bigquery__test_macros() %}
  {% do test_generate_secured_model_schema_v2_legacy() %}
  {% do test_deep_copy_dict() %}
  {% do test_get_data_privacy_configs() %}
{% endmacro %}
```

If a new test is not added to the aggregator, it does not run.

In `dbt-unittest`, the simpler variant is used: `test_macros()` directly lists each `{% do test_*() %}` call.

## Individual test shape

Each test macro should be focused and deterministic:

- name it `test_<feature>()`
- call the package macro directly
- compare the result against a literal expected output
- raise a compiler error on failure, either directly or through a package assertion helper

Two common styles:

### Assertion-helper style

Used in `dbt-unittest`:

```jinja
{% macro test_assert_equals() %}
  {{ dbt_unittest.assert_equals(1, 1) }}
  {{ dbt_unittest.assert_equals("1", "1") }}
  {{ dbt_unittest.assert_equals(none, none) }}
{% endmacro %}
```

### Explicit comparison plus compiler error

Useful when the package returns booleans or SQL strings:

```jinja
{% macro test_equals() %}
  {% set result = dbt_unittest.equals(5, 5) %}
  {% if not result %}
    {{ exceptions.raise_compiler_error("Failed: 5 should equal 5") }}
  {% endif %}
{% endmacro %}
```

## What to test

Prefer focused checks:

- exact SQL string output for codegen or pseudonymization macros
- list or dict equality for helper macros
- `none`, empty values, and edge-case inputs
- adapter-specific output when dispatch is involved

## Verification flow

Use the package's real test harness:

1. `dbt deps` in `integration_tests/`
2. run the macro test command, often via `run_unit_tests.sh` (in **dbt-package-template**, from the repository root: `make run-unit-tests`)
3. if the repo uses `nox`, prefer the session that wraps the real unit-test shell script
4. inspect the CI workflow and confirm it invokes the same wrapper or underlying command
5. if the workflow uses path filters, verify your changed files will actually trigger that job

Typical wrapper command shape:

```bash
dbt run-operation test_macros
```

For `dbt-data-privacy`, upstream `integration_tests/noxfile.py` runs:

- `bash run_unit_tests.sh --target bigquery --vars-path ...`

For `dbt-unittest`, `integration_tests/run_unit_tests.sh` runs `dbt run-operation test_macros`, and local CI runs `bash run_unit_tests.sh` from `integration_tests/`, so local verification should mirror that path.

## Common failure modes

- forgetting to register the test in `test_macros.sql`
- writing the test in the wrong project tree
- using dbt YAML `unit_tests:` instead of macro-runner tests
- testing the wrong layer, such as a helper macro when the regression lives in the dispatch wrapper
- trusting stale README text over the current shell scripts or CI workflow
