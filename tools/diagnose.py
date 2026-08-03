from __future__ import annotations

import importlib.metadata
import importlib.util
import json
import platform
import os
import shutil
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def version(name: str) -> str | None:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return None


def main() -> int:
    sys.path.insert(0, str(ROOT))
    from app import validate_spatial_assets

    required = {name: version(name) for name in ("fastapi", "uvicorn", "numpy", "scipy", "soundfile", "h5py")}
    assets = validate_spatial_assets()
    report = {
        "project": str(ROOT),
        "python": {"version": platform.python_version(), "executable": sys.executable},
        "dependencies": required,
        "ffmpeg": shutil.which("ffmpeg"),
        "demucs": {
            "installed": importlib.util.find_spec("demucs") is not None,
            "maintenance": "archived-upstream",
            "model": os.environ.get("SPATIAL_SEPARATOR_MODEL", "htdemucs_ft"),
        },
        "spatialAssets": assets,
    }
    try:
        import torch
        report["compute"] = {
            "torch": torch.__version__,
            "cudaAvailable": bool(torch.cuda.is_available()),
            "cudaDevice": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        }
    except Exception:
        report["compute"] = {"torch": None, "cudaAvailable": False, "cudaDevice": None}
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if all(required.values()) and assets.get("status") == "ready" else 1


if __name__ == "__main__":
    raise SystemExit(main())
