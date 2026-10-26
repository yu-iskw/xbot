{% macro first_query_cell(query_result) -%}
  {{- return(
    none
    if query_result is none or (query_result.rows | length) == 0
    else query_result.rows[0][0]
  ) -}}
{%- endmacro %}
