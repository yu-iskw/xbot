# Macros

Add reusable package macros in this directory.

The template includes one starter macro in `macros/example/normalize_text.sql` so new package authors have:

- a working package namespace
- a macro unit test example under `integration_tests/macros/tests/example/test_normalize_text.sql` (mirrors this folder)
- a matching integration model example

Conventions for dispatch and file layout are in [`CLAUDE.md`](CLAUDE.md) in this directory.

Macro descriptions and arguments for **dbt docs** live in [`properties.yml`](properties.yml); run `dbt docs generate` in a project that depends on this package to see them.

Replace or extend the starter macro as your package takes shape.
