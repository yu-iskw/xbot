{% macro normalize_text(expression) -%}
  {{ return(adapter.dispatch('normalize_text', 'dbt_package_template')(expression)) }}
{%- endmacro %}

{% macro default__normalize_text(expression) -%}
  {%- set normalized_expression -%}
    nullif(trim(lower(cast({{ expression }} as {{ dbt.type_string() }}))), '')
  {%- endset -%}

  {{- return(normalized_expression | trim) -}}
{%- endmacro %}
