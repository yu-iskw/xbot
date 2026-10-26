# Default entrypoint: exec noxfile_core.py (dbt Core matrix). Fusion: nox -f noxfile_fusion.py

import importlib.util
from pathlib import Path

_core = Path(__file__).resolve().parent / "noxfile_core.py"
_spec = importlib.util.spec_from_file_location("noxfile", _core)
if _spec is None or _spec.loader is None:
    raise RuntimeError(f"Cannot load Nox core module from {_core}")
_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)
