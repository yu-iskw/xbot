# Documenting package macros (dbt docs)

Official pattern: [How do I document macros?](https://docs.getdbt.com/faqs/Docs/documenting-macros?version=1.12)

## Properties file

- Add a YAML file under the package macro tree (this template uses [`macros/properties.yml`](../../../../macros/properties.yml) at the `macros/` root).
- Use a top-level `macros:` key; each item has `name`, `description`, and optionally `arguments` (`name`, `type`, `description` per argument).

## Dispatched macros

- Document the **public** macro name—the thin dispatcher users call (e.g. `normalize_text`), **not** `default__normalize_text` or adapter-specific implementations unless those are meant to be called directly.
- In `description`, state what the macro **returns** (for example: a SQL expression fragment suitable for embedding in `select` lists).

## Arguments

- Match Jinja parameter names exactly so future opt-in validation (`validate_macro_args` behavior change in dbt 1.10+) can align docs with definitions.
- If an argument is a SQL expression passed through to the compiled SQL, say so in the argument `description`; pick a `type` that fits your style (see dbt docs for supported formats when validation is enabled).

## Example (normalize_text)

```yaml
macros:
  - name: normalize_text
    description: >
      Returns a SQL expression that normalizes string input (cast to string type,
      lowercased, trimmed; blank strings become null). Suitable for use inside SELECT.
    arguments:
      - name: expression
        type: string
        description: >
          SQL expression or column reference to normalize (not quoted literal text
          unless the macro caller passes a valid SQL fragment).
```

## Splitting files

- One `properties.yml` at `macros/` is enough for small packages. Split or nest additional property files only when maintainability requires it; dbt merges resource properties from the project.
