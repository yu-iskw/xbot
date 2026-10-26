{% macro test_normalize_text_trims_and_lowercases() %}
  {% set sql %}
    select {{ dbt_package_template.normalize_text("'  Alice@example.COM  '") }} as value
  {% endset %}
  {% do dbt_unittest.assert_equals(first_query_cell(run_query(sql)), "alice@example.com") %}
{% endmacro %}

{% macro test_normalize_text_returns_none_for_blank_input() %}
  {% set sql %}
    select {{ dbt_package_template.normalize_text("'   '") }} as value
  {% endset %}
  {% do dbt_unittest.assert_is_none(first_query_cell(run_query(sql))) %}
{% endmacro %}

{% macro test_normalize_text_returns_none_for_null_input() %}
  {% set sql %}
    select {{ dbt_package_template.normalize_text("null") }} as value
  {% endset %}
  {% do dbt_unittest.assert_is_none(first_query_cell(run_query(sql))) %}
{% endmacro %}
