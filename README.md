# dbt-package-template

**`dbt_package_template`** is a dbt package of reusable **macros**. Add it as a dependency in your dbt project, run `dbt deps`, and call macros from the `dbt_package_template` namespace.

If you maintain this repository (template author or fork), see [CONTRIBUTING.md](./CONTRIBUTING.md) for tests, linting, and development layout.

## Installation

In your **root** dbt project, add a [package](https://docs.getdbt.com/docs/build/packages) entry. For example, to install from Git (replace `YOUR_ORG` / `YOUR_REPO` with your fork or published copy):

```yaml
packages:
  - git: "https://github.com/YOUR_ORG/YOUR_REPO.git"
    revision: main # or a tag / SHA
```

Then run:

```bash
dbt deps
```

Published **dbt Hub** or **private registry** installs follow the same pattern using the URL or package name your registry provides.

## Requirements

- **dbt Core** **1.10 or newer** (see `require-dbt-version` in this package’s [`dbt_project.yml`](./dbt_project.yml)).
- Your project should use an adapter this package is exercised against: **Postgres** or **DuckDB** (see [Supported warehouses](#supported-warehouses)). Other adapters may work if SQL is portable, but are not covered by this package’s test harness.

Developing the package locally (tests, Docker, `uv`, pre-commit) is documented in [CONTRIBUTING.md](./CONTRIBUTING.md).

## Supported warehouses

This package is tested on:

- Postgres
- DuckDB

## What is in this package

- **Macros** under [`macros/`](./macros), including the starter [`normalize_text`](./macros/example/normalize_text.sql) implementation.
- **Macro documentation** for **dbt docs** in [`macros/properties.yml`](./macros/properties.yml) (surfaced when your project runs `dbt docs generate` and includes this package).

## Macros

### `normalize_text`

`normalize_text(expression)` returns a **SQL expression** (fragment) that:

- casts the value to the adapter string type
- lowercases it
- trims surrounding whitespace
- converts empty strings to `null`

**Example** (in a model or analysis):

```sql
select
  {{ dbt_package_template.normalize_text("customer_name") }} as normalized_name
from {{ ref("my_customers") }}
```

Use any column or SQL expression in place of `"customer_name"` (quoted identifiers are Jinja string arguments to the macro, not literal SQL quotes around the column).

For **overriding** dispatched macros and how **dbt docs** surfaces macro metadata from this package, see [CONTRIBUTING.md — Downstream projects: overrides and dbt docs](./CONTRIBUTING.md#downstream-projects-overrides-and-dbt-docs).
