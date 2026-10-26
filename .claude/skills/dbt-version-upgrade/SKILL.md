---
name: dbt-version-upgrade
description: Bump supported dbt-core versions in this package—update pyproject.toml dependency groups, noxfile_core.py session matrix, GitHub Actions CI matrix, and dbt_project.yml requires-dbt-version. Use when adding support for a new dbt-core minor release or dropping an old one.
---

# dbt Version Upgrade

Bump or drop a dbt-core version across all four locations where it is pinned.

## Files to change

| File | What to update |
| --- | --- |
| `integration_tests/pyproject.toml` | Add/remove a `[dependency-groups.dbt-core-X-Y]` section with `dbt-core`, `dbt-postgres`, `dbt-duckdb` pins |
| `integration_tests/noxfile_core.py` | Add/remove the uv group from `LOCAL_DBT_GROUPS` / `SETUP_DBT_GROUPS` and `@nox.parametrize`; check `dev_*` sessions still point to a valid group |
| `.github/workflows/integration-tests.yml` | Add/remove the version from the `uv-group` matrix axis |
| `dbt_project.yml` | Update `require-dbt-version` bounds if the new version is outside the current range |

## Step-by-step

### 1. Confirm the target version

Ask the user (or read from their prompt):
- **Adding** version X.Y? → need exact patch pin for `dbt-core`, `dbt-postgres`, `dbt-duckdb` (check PyPI).
- **Dropping** version X.Y? → remove its group and all matrix references.

### 2. Update `integration_tests/pyproject.toml`

**Adding:**
```toml
[dependency-groups.dbt-core-X-Y]
dependencies = [
  "dbt-core>=X.Y.0,<X.Z.0",
  "dbt-postgres>=X.Y.0,<X.Z.0",
  "dbt-duckdb>=X.Y.0,<X.Z.0",
]
# Add conflict markers if needed:
# conflicts = [
#   [{package = "dbt-core-X-Y"}, {package = "dbt-core-A-B"}],
# ]
```

**Dropping:** Remove the section and its `conflicts` references.

### 3. Update `integration_tests/noxfile_core.py`

Find `LOCAL_DBT_GROUPS` / `SETUP_DBT_GROUPS` (and `@nox.parametrize("uv_group", ...)`) that list groups like `"dbt-core-1-10"`.

**Adding:** Append `"dbt-core-X-Y"` to the list.
**Dropping:** Remove the entry. Verify `dev_unit_tests` and `dev_integration_tests` still reference a remaining group.

### 4. Update `.github/workflows/integration-tests.yml`

Find the matrix block:
```yaml
uv-group: [dbt-core-1-10, dbt-core-1-11]
```
**Adding:** Append `dbt-core-X-Y`.
**Dropping:** Remove the entry.

### 5. Update `dbt_project.yml` (if needed)

```yaml
require-dbt-version: [">=1.10.0", "<1.X.0"]
```
Expand the upper bound when adding a version beyond the current range.

### 6. Regenerate the lock file

```bash
cd integration_tests
uv lock
```

If lock conflicts arise, check the `conflicts` section in `pyproject.toml`.

### 7. Verify

```bash
# Quick smoke test with the new version on Postgres
make run-unit-tests
```

For a full matrix run, use `make test`.

## Version naming convention

dbt-core `1.X.Y` → group name `dbt-core-1-X`, nox param `"dbt-core-1-X"`, CI matrix entry `dbt-core-1-X`.

## Reference: current version matrix

Check `integration_tests/noxfile_core.py` for the authoritative Core list — this skill's examples may lag behind the repo.
