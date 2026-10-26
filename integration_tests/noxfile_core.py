"""Nox sessions for dbt Core (Python × dbt group × adapter matrix)."""

import importlib.util
from pathlib import Path

import nox

_root = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("nox_helpers", _root / "nox_helpers.py")
if _spec is None or _spec.loader is None:
    raise RuntimeError(f"Cannot load nox_helpers from {_root / 'nox_helpers.py'}")
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)

from nox_helpers import ADAPTERS, get_dbt_command, install_dependencies, run_dbt_shell_script

nox.options.sessions = ["dev_unit_tests", "dev_integration_tests"]
nox.options.default_venv_backend = "uv"

PYTHON_VERSIONS = ["3.10", "3.11", "3.12"]
LOCAL_DBT_GROUPS = ["dbt-core-1-10", "dbt-core-1-11"]
SETUP_DBT_GROUPS = ["dbt-core-1-10", "dbt-core-1-11"]


@nox.session(python="3.12")
def dev_unit_tests(session):
    """Run the starter macro unit tests quickly on Postgres."""
    unit_tests(session, "dbt-core-1-10", "postgres")


@nox.session(python="3.12")
def dev_integration_tests(session):
    """Run the starter integration tests quickly on Postgres."""
    integration_tests(session, "dbt-core-1-10", "postgres")


@nox.session(python=PYTHON_VERSIONS)
@nox.parametrize("uv_group", LOCAL_DBT_GROUPS)
@nox.parametrize("adapter", ADAPTERS)
def unit_tests(session, uv_group, adapter):
    """Run macro unit tests for a dbt-core line and adapter."""
    run_dbt_shell_script(session, uv_group, adapter, "run_unit_tests.sh")


@nox.session(python=PYTHON_VERSIONS)
@nox.parametrize("uv_group", LOCAL_DBT_GROUPS)
@nox.parametrize("adapter", ADAPTERS)
def integration_tests(session, uv_group, adapter):
    """Run dbt build for the example project for a dbt-core line and adapter."""
    run_dbt_shell_script(session, uv_group, adapter, "run_integration_tests.sh")


@nox.session(python=PYTHON_VERSIONS)
@nox.parametrize("uv_group", SETUP_DBT_GROUPS)
def setup_dbt_env(session, uv_group):
    """Install dbt dependencies for a version group and print the bin path."""
    install_dependencies(session, uv_group)
    dbt_cmd = get_dbt_command(session, uv_group)
    print(f"DBT_CMD={dbt_cmd}")
    print(f"BIN_PATH={session.bin}")
