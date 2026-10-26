"""Shared helpers for integration_tests Nox sessions (core and Fusion)."""

from __future__ import annotations

import os
import sys
from pathlib import Path

INTEGRATION_TESTS_DIR = Path(__file__).resolve().parent
if str(INTEGRATION_TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(INTEGRATION_TESTS_DIR))

ADAPTERS = ["postgres", "duckdb"]
FUSION_GROUP = "dbt-fusion"
FUSION_BINARY_NAME = "dbt"
FUSION_VERSION = os.environ.get("DBT_FUSION_VERSION", "")


def install_dependencies(session, uv_group):
    session.install(".", "--group", uv_group)
    if uv_group == FUSION_GROUP:
        session.run(
            "bash",
            "scripts/ensure_fusion_backend.sh",
            "--install-runtime",
            "--verify-runtime",
            env={
                "DBT_FUSION_BIN_DIR": session.bin,
                "DBT_FUSION_BINARY_NAME": FUSION_BINARY_NAME,
                "DBT_FUSION_VERSION": FUSION_VERSION,
            },
            external=True,
        )


def get_dbt_command(session, uv_group):
    if uv_group == FUSION_GROUP:
        return str(Path(session.bin) / FUSION_BINARY_NAME)
    return "dbt"


def build_env(session, uv_group, adapter, dbt_cmd):
    env = dict(os.environ)
    env.update(session.env)
    env["DBT_CMD"] = dbt_cmd

    if adapter == "duckdb" and "DBT_DUCKDB_PATH" not in env:
        duckdb_dir = INTEGRATION_TESTS_DIR / "target"
        duckdb_dir.mkdir(exist_ok=True)
        py_ver = session.python.replace(".", "")
        uv_slug = uv_group.replace("-", "_")
        env["DBT_DUCKDB_PATH"] = str(
            duckdb_dir / f"dbt_package_template_{uv_slug}_{py_ver}.duckdb"
        )

    return env


def run_deps(session, dbt_cmd, adapter, env):
    session.run(
        dbt_cmd,
        "deps",
        "--profiles-dir",
        "profiles",
        "--target",
        adapter,
        env=env,
        external=True,
    )


def run_dbt_shell_script(session, uv_group, adapter, script_name):
    """Install deps, then run a bash harness script (unit or integration tests)."""
    install_dependencies(session, uv_group)
    dbt_cmd = get_dbt_command(session, uv_group)
    env = build_env(session, uv_group, adapter, dbt_cmd)
    run_deps(session, dbt_cmd, adapter, env)
    session.run(
        "bash",
        script_name,
        "--target",
        adapter,
        env=env,
        external=True,
    )
