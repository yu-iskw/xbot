# Initialize / rename package checklist

Use this after copying **dbt-package-template** into a new repository. Replace placeholders:

| Placeholder | Meaning | Example |
|-------------|---------|---------|
| `PACKAGE_SNAKE` | Root `dbt_project.yml` `name` (underscores) | `acme_dbt_utils` |
| `PACKAGE_INTEGRATION` | Nested integration project `name` | `acme_dbt_utils_integration_tests` |
| `PACKAGE_KEBAB` | Docker container / display slug (hyphens) | `acme-dbt-utils` |

**Rule:** The Jinja namespace `{{ PACKAGE_SNAKE.macro_name(...) }}` and every `adapter.dispatch('macro_name', 'PACKAGE_SNAKE')` must use the **same** string as root `dbt_project.yml` `name`.

## 1. dbt project names

| File | Change |
|------|--------|
| [`dbt_project.yml`](../../../../dbt_project.yml) | `name: "PACKAGE_SNAKE"` |
| [`integration_tests/dbt_project.yml`](../../../../integration_tests/dbt_project.yml) | `name: "PACKAGE_INTEGRATION"` and under `models:` rename the top-level key from `dbt_package_template_integration_tests` to `PACKAGE_INTEGRATION` (must match project `name`) |

## 2. Macros (dispatch namespace)

| File | Change |
|------|--------|
| All [`macros/**/*.sql`](../../../../macros/) | Second argument of `adapter.dispatch(..., 'PACKAGE_SNAKE')` |

## 3. SQL that calls the package

| File | Change |
|------|--------|
| [`integration_tests/models/**/*.sql`](../../../../integration_tests/models/) | `{{ PACKAGE_SNAKE.... }}` |
| [`integration_tests/macros/tests/**/*.sql`](../../../../integration_tests/macros/tests/) | Same |

## 4. Local package install and dependency files

| File | Change |
|------|--------|
| [`integration_tests/packages.yml`](../../../../integration_tests/packages.yml) | Keep the `local: ../` entry pointed at the renamed package root, then run `dbt deps` from `integration_tests/` after updating root `dbt_project.yml` |
| [`integration_tests/uv.lock`](../../../../integration_tests/uv.lock) | Only refresh if Python dependencies changed; this lockfile does not control dbt package resolution |

## 5. Profiles, Docker, CI, scripts (defaults)

These default Postgres database/schema and DuckDB schema to the old name. Align with your org or keep separate from the dbt package name if you prefer.

| File | Change |
|------|--------|
| [`integration_tests/profiles/profiles.yml`](../../../../integration_tests/profiles/profiles.yml) | Env var defaults for `DBT_POSTGRES_*`, `DBT_DUCKDB_SCHEMA` |
| [`integration_tests/docker-compose.postgres.yml`](../../../../integration_tests/docker-compose.postgres.yml) | `container_name`, `POSTGRES_DB`, healthcheck `-d` database |
| [`integration_tests/scripts/run_with_postgres_container.sh`](../../../../integration_tests/scripts/run_with_postgres_container.sh) | `CONTAINER_NAME` (suggest `PACKAGE_KEBAB-postgres`) |
| [`integration_tests/Makefile`](../../../../integration_tests/Makefile) | `docker inspect` / error messages referencing `dbt-package-template-postgres` |
| [`.github/workflows/integration-tests.yml`](../../../../.github/workflows/integration-tests.yml) | `POSTGRES_DB`, healthcheck, `DBT_POSTGRES_*` env |
| [`integration_tests/nox_helpers.py`](../../../../integration_tests/nox_helpers.py) | DuckDB filename prefix `dbt_package_template_` → `PACKAGE_SNAKE_` in `build_env` |

## 6. Documentation and contributor text

| File | Change |
|------|--------|
| [`README.md`](../../../../README.md) | Title, examples, dispatch namespace prose |
| [`CONTRIBUTING.md`](../../../../CONTRIBUTING.md) | Title, prose, examples |
| [`CLAUDE.md`](../../../../CLAUDE.md) | Package `name` line |
| [`macros/CLAUDE.md`](../../../../macros/CLAUDE.md) | `macro_namespace` examples |
| [`integration_tests/CLAUDE.md`](../../../../integration_tests/CLAUDE.md) | Namespace in examples |
| [`integration_tests/README.md`](../../../../integration_tests/README.md) | Title, database/schema bullets |
| [`integration_tests/pyproject.toml`](../../../../integration_tests/pyproject.toml) | `description` string |

## 7. Agent skills (examples that hard-code the template namespace)

Search under [`.claude/skills/`](../../../../.claude/skills/) for `dbt_package_template` and `dbt-package-template`. Update **example** text in `SKILL.md` files (especially [`implement-dbt-macro/SKILL.md`](../../implement-dbt-macro/SKILL.md)) so forked repos do not mislead contributors.

## 8. Verification

1. From repo root: `rg 'dbt_package_template|dbt-package-template' -S .` (adjust ignores for `.git` / `dbt_packages` / `.nox` as needed) until only intentional historical strings remain.
2. `make run-unit-tests` and `make run-integration-tests` (see [`AGENTS.md`](../../../../AGENTS.md)).

## Optional

- **Human-readable repo title** (GitHub, README H1) may use spaces or Title Case; keep **machine identifiers** as `PACKAGE_SNAKE` / `PACKAGE_KEBAB` per above.
- Do not change **Hub** package names in `integration_tests/packages.yml` (e.g. `dbt_unittest`) unless you are replacing dependencies.
