"""Measure complete backend analysis, recording cache state rather than hiding it."""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--iterations", type=int, default=2)
    args = parser.parse_args()
    from backend.audio_engine import analyze_audio_optimized

    digest = hashlib.sha256()
    with args.input.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    for index in range(max(1, args.iterations)):
        started = time.perf_counter()
        analysis = analyze_audio_optimized(args.input, job_id=f"benchmark-{index}",
            output_dir=args.output_dir, request_demucs=True,
            cache_key=digest.hexdigest(), demucs_cache_key=digest.hexdigest())
        separator = analysis["models"]["deepSeparator"]
        row = {"seconds": round(time.perf_counter() - started, 3),
               "durationSeconds": analysis["file"]["duration"],
               "separatorCached": separator["cached"], "separatorStatus": separator["status"],
               "stems": len(separator["stems"]), "analysisTiming": analysis.get("analysisTiming"),
               "separatorTiming": separator.get("timing"), "settings": separator["settings"]}
        rows.append(row)
        print(json.dumps(row), flush=True)
        if separator["status"] != "completed":
            raise RuntimeError(f"Separation incomplete: {separator.get('reason', separator['status'])}")
    report = {"python": platform.python_version(), "source": str(args.input),
              "sha256": digest.hexdigest(), "runs": rows}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
