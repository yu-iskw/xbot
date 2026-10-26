# Shared argument parsing and paths for run_unit_tests.sh / run_integration_tests.sh.
# shellcheck shell=bash disable=SC2034
INTEGRATION_TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dbt_profiles_dir="${INTEGRATION_TESTS_DIR}/profiles"
dbt_target="${DBT_TARGET:-postgres}"
dbt_cmd="${DBT_CMD:-dbt}"

dbt_harness_parse_args() {
  while (($# > 0)); do
    case "$1" in
      --profiles-dir)
        dbt_profiles_dir="${2:?}"
        shift 2
        ;;
      --target)
        dbt_target="${2:?}"
        shift 2
        ;;
      *)
        echo "Unknown option: $1" >&2
        return 1
        ;;
    esac
  done
}

dbt_harness_cd() {
  cd "${INTEGRATION_TESTS_DIR}" || return
}
