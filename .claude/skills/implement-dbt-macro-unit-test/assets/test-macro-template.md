# Test macro template

Use this as a starting point for macro-runner tests in a nested `integration_tests/` project.

## File template

```jinja
{% macro test_<feature_name>() %}
  {# Happy path #}
  {% set result = <package_name>.<macro_name>(<input_args>) %}
  {% if result != <expected_value> %}
    {{ exceptions.raise_compiler_error(
      "Failed: expected " ~ <expected_value> ~ " but got " ~ result
    ) }}
  {% endif %}

  {# Edge case #}
  {% set edge_result = <package_name>.<macro_name>(<edge_case_args>) %}
  {% if edge_result != <edge_expected_value> %}
    {{ exceptions.raise_compiler_error(
      "Failed edge case for <macro_name>"
    ) }}
  {% endif %}
{% endmacro %}
```

## Aggregator registration

After creating the new test file, add it to the suite aggregator:

```jinja
{% macro test_macros() %}
  {% do test_<feature_name>() %}
{% endmacro %}
```

If the repository uses adapter-dispatched aggregators, register it in the adapter-specific implementation instead:

```jinja
{% macro bigquery__test_macros() %}
  {% do test_<feature_name>() %}
{% endmacro %}
```

## Notes

- Keep one test macro focused on one behavior or macro family.
- Prefer literal inputs and exact expected outputs.
- If the package already exposes assertion helpers, use them instead of open-coded comparisons when that matches the repository style.
- After local verification, confirm the CI workflow runs the same macro test command or wrapper.
