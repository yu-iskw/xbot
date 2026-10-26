# Macros directory

## Layout

- Group related macros by folder (for example `example/`).
- **One primary `.sql` file per macro family**, named after the public macro (for example `normalize_text.sql`).
- Put the **dispatcher**, **`default__*`**, and any **`postgres__*`** / **`duckdb__*`** (or other adapter) implementations **in that same file**.

## Dispatch (required for public macros)

Every public macro that should be overridable must:

1. Define a thin dispatcher whose only job is to call `adapter.dispatch` with **string literals** for `macro_name` and `macro_namespace`.
2. Use `macro_namespace: 'dbt_package_template'` — it **must** match `name` in the root [`dbt_project.yml`](../dbt_project.yml).

Pattern:

```jinja
{% macro my_macro(arg) -%}
  {{ return(adapter.dispatch('my_macro', 'dbt_package_template')(arg)) }}
{%- endmacro %}

{% macro default__my_macro(arg) -%}
  {# cross-adapter or shared implementation #}
{%- endmacro %}
```

Add `postgres__my_macro`, `duckdb__my_macro`, etc. only when behavior or SQL **differs** by adapter.

Reference: [About dispatch config](https://docs.getdbt.com/reference/dbt-jinja-functions/dispatch?version=1.12).

## dbt docs (macro properties)

- Document **public** macros in [`properties.yml`](properties.yml) at the `macros/` root (or additional properties files under `macros/` if the package splits them). dbt merges resource properties.
- Use the **dispatcher** macro `name` in YAML (for example `normalize_text`), not `default__normalize_text` or adapter-specific variants, unless those are meant to be called directly.
- Keep `arguments` aligned with the Jinja signature for future optional validation. See [Document macros](https://docs.getdbt.com/faqs/Docs/documenting-macros?version=1.12).

## Tests

Macro unit tests mirror this tree under [`integration_tests/macros/tests/`](../integration_tests/macros/tests/) (see [`integration_tests/CLAUDE.md`](../integration_tests/CLAUDE.md)).
