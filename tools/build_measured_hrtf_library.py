"""SADIE II 측정 SOFA를 브라우저용 HRTF 라이브러리로 변환한다.

원본 SOFA는 Zenodo에서 내려받아 체크섬을 확인한 뒤 임시 디렉터리에서만
사용한다. 프로젝트에는 출처가 명시된 프로파일과 무손실 Float32 HRIR만 남긴다.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import struct
import tempfile
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import h5py
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "data" / "hrtf"
ZENODO_RECORD = "https://zenodo.org/records/12542676"
ZENODO_API_FILES = "https://zenodo.org/api/records/12542676/files"
TARGET_FRONT_ENERGY = 0.8
TARGET_MAX_PEAK = 0.98


@dataclass(frozen=True)
class SourceProfile:
    id: str
    label: str
    filename: str
    md5: str
    kind: str


SOURCES = (
    SourceProfile(
        "sadie-kemar",
        "SADIE II · KEMAR",
        "SADIE_KEMAR_DFC_256_order_fir_48000.sofa",
        "3ca38b6a6e55c10a59f4b8013dbfcd76",
        "dummy-head measurement",
    ),
    SourceProfile(
        "sadie-ku100",
        "SADIE II · KU100",
        "SADIE_KU100_DFC_256_order_fir_48000.sofa",
        "ba86b033077fa0efd4add83b0af72262",
        "dummy-head measurement",
    ),
    SourceProfile(
        "sadie-human-003",
        "SADIE II · Human 003",
        "SADIE_003_DFC_256_order_fir_48000.sofa",
        "e4d0303abfb3a34d48ef16d05cf2f2a7",
        "human-ear measurement",
    ),
    SourceProfile(
        "sadie-human-009",
        "SADIE II · Human 009",
        "SADIE_009_DFC_256_order_fir_48000.sofa",
        "8ede5260257fd8874d87371c5f42e96d",
        "human-ear measurement",
    ),
)


def file_md5(path: Path) -> str:
    digest = hashlib.md5(usedforsecurity=False)
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download_source(source: SourceProfile, cache_dir: Path) -> Path:
    target = cache_dir / source.filename
    if not target.exists() or file_md5(target) != source.md5:
        url = f"{ZENODO_API_FILES}/{source.filename}/content"
        print(f"download={url}")
        urllib.request.urlretrieve(url, target)
    actual = file_md5(target)
    if actual != source.md5:
        raise ValueError(f"{source.filename}: md5 {actual} != {source.md5}")
    return target


def normalize_azimuth(azimuth: np.ndarray) -> np.ndarray:
    # SOFA의 양의 방위각은 왼쪽이고 앱 좌표계의 양의 방위각은 오른쪽이다.
    return ((-azimuth + 180.0) % 360.0) - 180.0


def frontal_index(positions: np.ndarray) -> int:
    angular_distance = np.abs(positions[:, 0]) + np.abs(positions[:, 1])
    return int(np.argmin(angular_distance))


def normalize_profile_level(impulses: np.ndarray, positions: np.ndarray) -> tuple[np.ndarray, float]:
    front = impulses[frontal_index(positions)]
    front_energy = float(np.sqrt(np.sum(np.square(front), dtype=np.float64) / 2.0))
    peak = float(np.max(np.abs(impulses)))
    energy_scale = TARGET_FRONT_ENERGY / max(front_energy, 1e-12)
    peak_scale = TARGET_MAX_PEAK / max(peak, 1e-12)
    scale = min(energy_scale, peak_scale)
    return np.asarray(impulses * scale, dtype="<f4"), scale


def load_sofa(path: Path) -> tuple[np.ndarray, np.ndarray, int]:
    with h5py.File(path, "r") as sofa:
        positions = np.asarray(sofa["SourcePosition"], dtype=np.float64)
        impulses = np.asarray(sofa["Data.IR"], dtype=np.float32)
        sample_rate = int(np.asarray(sofa["Data.SamplingRate"]).reshape(-1)[0])
        convention = sofa.attrs.get("SOFAConventions", b"")
    if isinstance(convention, bytes):
        convention = convention.decode("utf-8", errors="replace")
    if convention != "SimpleFreeFieldHRIR" or positions.ndim != 2 or positions.shape[1] != 3:
        raise ValueError(f"{path.name}: unsupported SOFA layout")
    if impulses.ndim != 3 or impulses.shape[0] != positions.shape[0] or impulses.shape[1] != 2:
        raise ValueError(f"{path.name}: expected [directions, 2, taps] Data.IR")
    if sample_rate != 48_000 or impulses.shape[2] != 256:
        raise ValueError(f"{path.name}: expected 48 kHz / 256-tap HRIR")
    positions[:, 0] = normalize_azimuth(positions[:, 0])
    return positions, impulses, sample_rate


def write_runtime(path: Path, positions: np.ndarray, impulses: np.ndarray, sample_rate: int) -> None:
    header = struct.pack(
        "<8sIIII",
        b"SAHRTF1\0",
        len(positions),
        2,
        impulses.shape[2],
        sample_rate,
    )
    path.write_bytes(
        header
        + np.asarray(positions, dtype="<f4").tobytes()
        + np.asarray(impulses, dtype="<f4").tobytes()
    )


def build_profile(source: SourceProfile, positions: np.ndarray, scale: float) -> dict[str, object]:
    runtime_asset = f"{source.id}.hrir"
    return {
        "schema": "SpatialAudioEssential.HRTFProfile/1.1",
        "id": source.id,
        "label": source.label,
        "profileType": "measured-diffuse-field-compensated",
        "measurementKind": source.kind,
        "sofaConvention": "SimpleFreeFieldHRIR",
        "aes69Edition": "AES69 / SOFA",
        "sampleRate": 48_000,
        "impulseLength": 256,
        "rendering": {
            "symmetryRequired": False,
            "minimumPhaseMagnitudeWithExplicitItd": False,
            "interpolation": "onset-aligned spherical inverse-distance",
            "interpolationNeighbors": 4,
            "recommendedDistanceMeters": [1.0, 3.0],
            "fallback": "Universal Listener v1",
            "runtimeAsset": runtime_asset,
        },
        "directions": [
            {
                "azimuth": round(float(position[0]), 4),
                "elevation": round(float(position[1]), 4),
                "distance": round(float(position[2]), 4),
            }
            for position in positions
        ],
        "normalization": {
            "targetFrontPairEnergy": TARGET_FRONT_ENERGY,
            "maximumRuntimePeak": TARGET_MAX_PEAK,
            "appliedScale": round(scale, 8),
        },
        "source": {
            "database": "SADIE II v2.2",
            "record": ZENODO_RECORD,
            "filename": source.filename,
            "md5": source.md5,
            "license": "Apache-2.0",
            "copyright": "University of York",
            "citation": "Armstrong et al., Applied Sciences 2018, 8, 2029",
        },
        "limitations": [
            "This is a non-individual measured HRTF; perceptual fit varies by listener.",
            "Headphone transfer functions and OS-level spatial processing are not part of this asset.",
        ],
    }


def build_source(source: SourceProfile, cache_dir: Path) -> dict[str, object]:
    sofa_path = download_source(source, cache_dir)
    positions, impulses, sample_rate = load_sofa(sofa_path)
    impulses, scale = normalize_profile_level(impulses, positions)
    profile = build_profile(source, positions, scale)
    runtime_path = OUTPUT_DIR / profile["rendering"]["runtimeAsset"]
    profile_path = OUTPUT_DIR / f"{source.id}.json"
    write_runtime(runtime_path, positions, impulses, sample_rate)
    profile_path.write_text(json.dumps(profile, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"profile={profile_path.name} directions={len(positions)} runtime={runtime_path.stat().st_size}")
    return {
        "id": source.id,
        "label": source.label,
        "profileAsset": profile_path.name,
        "kind": source.kind,
        "directions": len(positions),
        "license": "Apache-2.0",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", type=Path)
    args = parser.parse_args()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    if args.cache_dir:
        args.cache_dir.mkdir(parents=True, exist_ok=True)
        profiles = [build_source(source, args.cache_dir) for source in SOURCES]
    else:
        with tempfile.TemporaryDirectory(prefix="spatial-hrtf-") as temporary:
            profiles = [build_source(source, Path(temporary)) for source in SOURCES]
    profiles.append({
        "id": "universal-listener-v1",
        "label": "Universal Listener · Parametric fallback",
        "profileAsset": "universal-listener-v1.json",
        "kind": "deterministic generic fallback",
        "directions": 144,
        "license": "CC0-1.0",
    })
    registry = {
        "schema": "SpatialAudioEssential.HRTFLibrary/1.0",
        "defaultId": "sadie-kemar",
        "profiles": profiles,
    }
    (OUTPUT_DIR / "profiles.json").write_text(
        json.dumps(registry, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
