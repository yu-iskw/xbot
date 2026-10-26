"""Nox sessions for dbt Fusion (Python matrix; Postgres + DuckDB).

CI must run these with `nox -f noxfile_fusion.py`; default `noxfile.py` loads
only dbt Core sessions from `noxfile_core.py`.
"""

import importlib.util
from pathlib import Path

import nox

_root = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("nox_helpers", _root / "nox_helpers.py")
if _spec is None or _spec.loader is None:
    raise RuntimeError(f"Cannot load nox_helpers from {_root / 'nox_helpers.py'}")
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)

from nox_helpers import ADAPTERS, FUSION_GROUP, get_dbt_command, install_dependencies, run_dbt_shell_script

FUSION_PYTHON = "3.12"
PYTHON_VERSIONS = ["3.10", "3.11", "3.12"]

nox.options.sessions = ["dev_unit_tests_fusion", "dev_integration_tests_fusion"]
nox.options.default_venv_backend = "uv"


@nox.session(python=FUSION_PYTHON)
def dev_unit_tests_fusion(session):
    """Run the starter macro unit tests quickly through dbt Fusion."""
    fusion_unit_tests(session)


@nox.session(python=FUSION_PYTHON)
def dev_integration_tests_fusion(session):
    """Run the starter integration tests quickly through dbt Fusion."""
    fusion_integration_tests(session)


@nox.session(python=PYTHON_VERSIONS)
def fusion_unit_tests(session):
    """Run real Fusion unit tests on Postgres and DuckDB."""
    for adapter in ADAPTERS:
        run_dbt_shell_script(session, FUSION_GROUP, adapter, "run_unit_tests.sh")


@nox.session(python=PYTHON_VERSIONS)
def fusion_integration_tests(session):
    """Run real Fusion integration tests on Postgres and DuckDB."""
    for adapter in ADAPTERS:
        run_dbt_shell_script(session, FUSION_GROUP, adapter, "run_integration_tests.sh")


@nox.session(python=PYTHON_VERSIONS)
def setup_fusion_env(session):
    """Install dbt Fusion dependencies and print the bin path."""
    install_dependencies(session, FUSION_GROUP)
    dbt_cmd = get_dbt_command(session, FUSION_GROUP)
    print(f"DBT_CMD={dbt_cmd}")
    print(f"BIN_PATH={session.bin}")
