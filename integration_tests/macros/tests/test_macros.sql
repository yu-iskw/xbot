{% macro test_macros() %}
  {% do test_normalize_text_trims_and_lowercases() %}
  {% do test_normalize_text_returns_none_for_blank_input() %}
  {% do test_normalize_text_returns_none_for_null_input() %}
{% endmacro %}
