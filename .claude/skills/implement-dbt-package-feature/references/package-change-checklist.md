# Package change checklist

Use this checklist when a change spans package code, public docs, nested integration tests, or release-facing behavior.

## 1. Classify the change

Decide which category applies:

- internal helper only
- public macro API change
- generated SQL or YAML change
- test harness change
- docs-only change
- package configuration or release metadata change

This determines how much of the package surface must be touched.

## 2. Root package responsibilities

Check the root package first:

- `dbt_project.yml`
- `macros/`
- `docs/`
- `README.md`
- CI or workflow files if package commands changed

Questions to answer:

- Did the public package namespace change?
- Did any macro signature, default, or return shape change?
- Did the feature add a new documented entrypoint?
- Did generated output semantics change?

## 3. Nested integration project responsibilities

Then check the nested `integration_tests/` project:

- `integration_tests/dbt_project.yml`
- `integration_tests/packages.yml`
- `integration_tests/macros/tests/`
- `integration_tests/models/`
- `integration_tests/data/`
- `integration_tests/scripts/` or shell entrypoints

Questions to answer:

- Does the local package still install correctly from the relative path?
- Does the feature need new fixtures, seeds, or generated model outputs?
- Does the macro test aggregator need to register a new test?
- Do any scripts or profiles need adjustment?

## 4. Documentation

Update docs whenever the feature changes user-facing behavior:

- `README.md` for quickstart and usage
- `docs/` for deeper package behavior
- macro YAML docs if the package uses them

Prefer the current implementation and CI entrypoints over stale README text.

## 5. Validation

Always use the real package workflow:

- run the macro-runner test path for macro changes
- run integration generation/build steps for generated-model changes
- use matrix or CI-equivalent validation when the package supports multiple dbt versions
- confirm the local command you run matches the CI command or wrapper

**dbt-package-template:** from the repository root, run `make run-unit-tests` for macro-runner coverage and `make run-integration-tests` for the example project build; see `AGENTS.md`.

For `dbt-data-privacy`-style packages, look for:

- `integration_tests/run_unit_tests.sh`
- `integration_tests/run_integration_tests.sh`
- `integration_tests/scripts/generate_secured_models.sh`
- `integration_tests/noxfile_core.py`, `integration_tests/noxfile_fusion.py`, `integration_tests/nox_helpers.py`

These are example upstream entrypoints, not guaranteed filenames in every host repo. Discover the repository's real local and CI commands before editing workflow docs or validation steps.

If the repo has workflow path filters, verify that your changed files are inside the paths that actually trigger the macro or integration jobs.

## 6. Release and compatibility

If the feature changes a public contract, also check:

- package versioning in `dbt_project.yml`
- changelog or release notes if the repo uses them
- migration notes for breaking behavior
- multi-dbt-version or multi-adapter coverage if the package advertises it

## 7. Common failure modes

- Updating package code but forgetting nested `integration_tests/`
- Creating a test file but not registering it in the aggregator macro
- Changing docs to mention a script that does not exist
- Treating BigQuery-specific behavior as if it were adapter-agnostic
- Touching the wrong `dbt_project.yml` in a two-project repo
- changing a public macro contract without versioning or release notes
- running a local command that CI never executes

## 8. Done checklist

A package change is not done until:

- implementation files are updated
- relevant macro tests are updated
- nested integration project still resolves the local package
- user-facing docs are updated if behavior changed
- the real verification path passes
- the CI workflow still exercises the changed area
- release metadata is updated when the public contract changed
