# Contributing to dbt_package_template

This guide is for **package maintainers**, **template authors**, and **contributors** working in this repository. It also documents **downstream** topics—**dispatch overrides** and **dbt docs** metadata—for projects that depend on this package. For **installation** and a **minimal macro example**, start with [README.md](README.md).

Thank you for helping improve dbt_package_template.

## Before you start

This repository is a starter template for new dbt packages.
Keep changes focused and preserve the local-first workflow.

**User-facing** install and macro documentation: [README.md](README.md).

## Downstream projects: overrides and dbt docs

These notes apply to **root dbt projects** that list this repository (or a fork) under `packages:` and run `dbt deps`.

### Overriding macro implementations

Public macros use dbt’s **`adapter.dispatch`** with namespace **`dbt_package_template`**. In your **root** project you can override implementations with `dispatch` and `search_order` in `dbt_project.yml` ([dispatch docs](https://docs.getdbt.com/reference/dbt-jinja-functions/dispatch?version=1.12)).

### dbt docs

Macro descriptions and arguments are defined in [`macros/properties.yml`](macros/properties.yml). After `dbt deps`, generate your project’s docs as usual; macro pages reflect this metadata.

**Maintainers** run **lint** and **tests** from the repository root (Postgres and DuckDB, dbt-core 1.10 and 1.11, optional Fusion lanes); see [How to develop](#how-to-develop) and [Test harness and Fusion](#test-harness-and-fusion). Workspace rules for agents: [`AGENTS.md`](AGENTS.md). **Claude Code** workflow: [`CLAUDE.md`](CLAUDE.md).

## Development layout and tooling

### Repository map

Paths you touch most often when developing the package:

- **`macros/`** — shipped package macros.
- **[`macros/properties.yml`](macros/properties.yml)** — dbt docs metadata for public macros (see [`macros/CLAUDE.md`](macros/CLAUDE.md)).
- **`models/`**, **`seeds/`**, **`snapshots/`** — placeholders for a full package layout (see root [`dbt_project.yml`](dbt_project.yml)).
- **[`integration_tests/`](integration_tests/)** — nested dbt project for macro-runner unit tests and integration `dbt build` (`uv`, `nox`, Postgres + DuckDB). Details: [`integration_tests/README.md`](integration_tests/README.md).
- **[`docs/`](docs/)** — maintainer walkthroughs and extra docs (for example [`docs/starter_walkthrough.md`](docs/starter_walkthrough.md)).
- **[`.claude/skills/`](.claude/skills/)**, **[`.claude/agents/`](.claude/agents/)** — Claude Code skills and subagents.
- **[`.codex/`](.codex/)** — Codex CLI configuration.
- **[`AGENTS.md`](AGENTS.md)** — workspace rules and agent documentation map (Cursor and other tools).
- **[`CLAUDE.md`](CLAUDE.md)** — Claude Code–specific workflow and links into macro/test conventions.

**`.agents/skills`** is a symlink to **`../.claude/skills/`** for tools that expect that path—do not maintain duplicate skill trees.

### AI assistants and editor tooling

**Codex** — Shared configuration in [`.codex/config.toml`](.codex/config.toml); project instructions also align with [`AGENTS.md`](AGENTS.md) (sandbox, approvals, Cursor-style workflow).

Opt-in Codex CLI profiles:

- `fast`: `gpt-5.4` with low reasoning effort for smaller, iterative tasks
- `deep`: `gpt-5.4` with high reasoning effort for planning, review, and more complex changes
- `review`: `gpt-5.4` with high reasoning effort for bug-finding and regression review
- `verify`: `gpt-5.4` with medium reasoning effort for lint/test orchestration and failure analysis

Read-only review subagents for Codex:

- `reviewer` — macros, SQL generation paths, workflows, and config regressions
- `test_gap_checker` — missing unit, integration, and workflow coverage

Implementation and verification subagents for Codex:

- `macro_package_specialist` — macro changes, public macro docs, mirrored macro-runner tests, and related package docs
- `verifier` — `make lint`, targeted dbt verification, and exact command/outcome reporting

Repo-local advisory Codex hook scripts:

- [`.codex/hooks/context_router.sh`](.codex/hooks/context_router.sh) — suggests which repo docs to read for a file area
- [`.codex/hooks/verification_hint.sh`](.codex/hooks/verification_hint.sh) — suggests the right verification command set for changed paths
- [`.codex/hooks/check_sandbox_parity.sh`](.codex/hooks/check_sandbox_parity.sh) — reminds maintainers to keep [`.claude/settings.json`](.claude/settings.json), [`.cursor/sandbox.json`](.cursor/sandbox.json), and [`.cursor/rules/sandbox.mdc`](.cursor/rules/sandbox.mdc) aligned

The current repo-local Codex setup supports subagents directly. The scripts above are shipped as deterministic helpers for advisory workflows and future Codex hook wiring rather than a second, duplicate instruction system.

```bash
codex --profile fast
codex --profile deep
```

**Claude Code** — See [`CLAUDE.md`](CLAUDE.md) for subagents (for example `dbt-macro-package-specialist`, `verifier`), the package-rename skill, and macro/integration pointers.

### Test harness and Fusion

From the **repository root**, typical flows:

```bash
make setup-integration-tests
make lint
make run-unit-tests
make run-integration-tests
make run-fusion-tests
```

- **dbt Core lane:** Postgres and DuckDB, `dbt-core-1-10` and `dbt-core-1-11` (via default `nox` / [`integration_tests/noxfile.py`](integration_tests/noxfile.py), which loads [`noxfile_core.py`](integration_tests/noxfile_core.py)).
- **Fusion lane:** same adapter contract; install Fusion into the nox environment via [`integration_tests/noxfile_fusion.py`](integration_tests/noxfile_fusion.py) (`nox -f noxfile_fusion.py`). CI runs Fusion on **Python 3.10**, **3.11**, and **3.12** (same matrix as the Fusion GitHub Actions job). Set **`DBT_FUSION_VERSION`** to pin a build (see [`integration_tests/README.md`](integration_tests/README.md)).

`make run-fusion-tests` runs **both** Fusion unit and Fusion integration targets; you can also call `make run-unit-tests-fusion` or `make run-integration-tests-fusion` separately.

Fusion was removed during an earlier BigQuery-oriented harness migration and **restored** as a real lane on the current Postgres/DuckDB contract.

## How to develop

### Prerequisites

- **Docker Engine** and **Docker Compose v2** (Postgres-backed local tests start a Compose-managed container).
- **[uv](https://docs.astral.sh/uv/)** — the harness under `integration_tests/` uses `uv sync` and `uv run nox ...`.
- **Python** — `integration_tests/pyproject.toml` requires Python `>=3.10`. The **dbt Core** and **Fusion** integration jobs in CI run **3.10**, **3.11**, and **3.12**. Local `make` targets for Core use nox sessions pinned to **3.12** in session names; use a compatible interpreter or rely on `uv` to provision one.
- **pre-commit** — install separately (for example `pip install pre-commit` or `pipx install pre-commit`) to run `make lint` from the repo root. There is no root `pyproject.toml` for dev tools.

### How to set up the development environment

Install the integration test environment from the repository root:

```shell
make setup-integration-tests
```

That runs `uv sync` in `integration_tests/`.

### Linting

From the repository root (with **pre-commit** on your `PATH`):

```shell
make lint
```

This runs `pre-commit run -a` (YAML, shell scripts, markdown link check, and other hooks in [`.pre-commit-config.yaml`](.pre-commit-config.yaml)). CI runs the same checks on pull requests.

### How to run unit testing

Unit tests execute dbt macros directly with `dbt run-operation` on both supported adapters and both standard dbt-core lines: `dbt-core-1-10` and `dbt-core-1-11`.

```shell
make run-unit-tests
```

The repository also exposes a separate Fusion lane:

```shell
make run-unit-tests-fusion
```

That target installs the Fusion runtime into the nox virtual environment and runs the Fusion unit lane on Postgres and DuckDB.

### How to implement unit tests

- Add or update package macros under `macros/`.
- Add matching macro tests under `integration_tests/macros/tests/`, **mirroring** the directory layout under `macros/` (for example `macros/example/foo.sql` → `integration_tests/macros/tests/example/test_foo.sql`).
- Use [dbt-unittest](https://github.com/yu-iskw/dbt-unittest) (`dbt_unittest.*`) for assertions.
- Call package macros directly in SQL (for example `{{ dbt_package_template.normalize_text("'x'") }}`) and use dbt’s `run_query` when you need to execute that SQL and assert on the result.
- Register new test macros from `integration_tests/macros/tests/test_macros.sql` (the only test macro file that stays at the `tests/` root).

### How to run integration testing

Integration tests run the example project under `integration_tests/` on Postgres and DuckDB for both standard dbt-core lines: `dbt-core-1-10` and `dbt-core-1-11`.

```shell
make run-integration-tests
```

Fusion integration coverage is exposed separately:

```shell
make run-integration-tests-fusion
```

That target installs the Fusion runtime into the nox virtual environment and runs the Fusion integration lane on Postgres and DuckDB.

Convenience target from the repository root (runs **both** Fusion unit and Fusion integration lanes):

```shell
make run-fusion-tests
```

### Local Postgres

The Postgres target uses a Docker Compose managed container during local test runs.
Contributors need Docker Engine and Docker Compose v2 available locally.

The dbt profile still connects with these defaults:

- host: `localhost`
- port: `5432`
- user: `postgres`
- password: `postgres`
- database: `dbt_package_template`
- schema: `dbt_package_template`

You can override any of them with `DBT_POSTGRES_*` environment variables.

### Starter conventions

- Keep starter content copyable for new package authors.
- Prefer cross-adapter SQL in starter macros and tests.
- Implement public package macros with `adapter.dispatch` and `macro_namespace: 'dbt_package_template'` so downstream projects can override implementations (see [`macros/CLAUDE.md`](macros/CLAUDE.md)).
- When you add or change a **public** macro, update [`macros/properties.yml`](macros/properties.yml) so **dbt docs** stay accurate (dispatcher name and arguments; see [Document macros](https://docs.getdbt.com/faqs/Docs/documenting-macros?version=1.12)).
- Macro unit tests mirror the package tree under `integration_tests/macros/tests/` (see [`integration_tests/CLAUDE.md`](integration_tests/CLAUDE.md)).
- Update [README.md](README.md) for **consumer-facing** behavior and **`docs/`** as needed; see [docs/starter_walkthrough.md](docs/starter_walkthrough.md) for a maintainer-oriented tour of the harness.
