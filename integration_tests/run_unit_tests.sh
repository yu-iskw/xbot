#!/usr/bin/env bash
# Variables dbt_cmd, dbt_profiles_dir, dbt_target are set in scripts/dbt_harness.sh.
# shellcheck disable=SC1091,SC2154
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "${ROOT}/scripts/dbt_harness.sh"

dbt_harness_parse_args "$@"
dbt_harness_cd

"${dbt_cmd}" deps --profiles-dir "${dbt_profiles_dir}" --target "${dbt_target}"
"${dbt_cmd}" run-operation test_macros \
  --profiles-dir "${dbt_profiles_dir}" \
  --target "${dbt_target}"
