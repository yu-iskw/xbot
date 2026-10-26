{#
  Drop target_schema prefix so custom schemas are used as-is.
  https://docs.getdbt.com/docs/building-a-dbt-project/building-models/using-custom-schemas/#jinja-context-available-in-generate_schema_name
#}
{% macro generate_schema_name(custom_schema_name, node) -%}
  {%- if custom_schema_name is none -%}
    {{ target.schema }}
  {%- else -%}
    {{ custom_schema_name | trim }}
  {%- endif -%}
{%- endmacro %}
