"""AIR v1.4에서 브라우저용 실측 binaural late-field 응답을 만든다.

각 출력은 서로 다른 실제 공간에서 측정된 좌/우 MAT 응답을 사용한다. 앱이
직접음과 초기 방향 반사를 별도로 렌더링하므로 45 ms 이전 구간만 제거하며,
측정 tail의 복제·시간 신장·인공 잔향 합성은 수행하지 않는다.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from scipy.io import loadmat, wavfile


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "data/brir"
SAMPLE_RATE = 48_000
LATE_START_SECONDS = 0.045
FADE_IN_SECONDS = 0.018
FADE_OUT_SECONDS = 0.18
TARGET_CHANNEL_ENERGY = 0.30
AIR_ARCHIVE_SHA256 = "4baa3a0ea31dc72647ff61f53b0bf0b962876de31b6b0569ebc504987898aa02"

PROFILES = (
    {
        "id": "meeting",
        "label": "AIR Meeting Room",
        "file": "air_meeting_room_front_late.wav",
        "left": "air_binaural_meeting_0_1_3.mat",
        "right": "air_binaural_meeting_1_1_3.mat",
        "maximumSeconds": 1.1,
        "roomClass": "small",
        "description": "AIR 회의실에서 측정한 짧고 명료한 binaural late field",
    },
    {
        "id": "lecture",
        "label": "AIR Lecture Room",
        "file": "air_lecture_room_front_late.wav",
        "left": "air_binaural_lecture_0_1_4.mat",
        "right": "air_binaural_lecture_1_1_4.mat",
        "maximumSeconds": 1.8,
        "roomClass": "medium",
        "description": "AIR 강의실에서 측정한 균형 잡힌 binaural late field",
    },
    {
        "id": "stairway",
        "label": "AIR Stairway",
        "file": "air_stairway_front_late.wav",
        "left": "air_binaural_stairway_0_1_2_90.mat",
        "right": "air_binaural_stairway_1_1_2_90.mat",
        "maximumSeconds": 2.5,
        "roomClass": "tall",
        "description": "AIR 계단실에서 측정한 수직감과 긴 감쇠의 binaural late field",
    },
    {
        "id": "aula",
        "label": "AIR Aula Carolina",
        "file": "air_aula_carolina_front_late.wav",
        "left": "air_binaural_aula_carolina_0_1_3_90_3.mat",
        "right": "air_binaural_aula_carolina_1_1_3_90_3.mat",
        "maximumSeconds": 3.2,
        "roomClass": "concert",
        "description": "AIR Aula Carolina 3 m 정면 측정의 대형 홀 binaural late field",
    },
)


def load_channel(path: Path) -> tuple[np.ndarray, int]:
    payload = loadmat(path, squeeze_me=True, struct_as_record=False)
    samples = np.asarray(payload["h_air"], dtype=np.float64).reshape(-1)
    sample_rate = int(payload["air_info"].fs)
    if sample_rate != SAMPLE_RATE:
        raise ValueError(f"{path.name}: expected {SAMPLE_RATE} Hz, got {sample_rate} Hz")
    return samples, sample_rate


def build_measured_late_field(left_path: Path, right_path: Path, maximum_seconds: float) -> np.ndarray:
    left, sample_rate = load_channel(left_path)
    right, right_rate = load_channel(right_path)
    if right_rate != sample_rate:
        raise ValueError("AIR left/right sample rates differ")
    length = min(len(left), len(right), round(maximum_seconds * sample_rate))
    stereo = np.column_stack((left[:length], right[:length]))
    late_start = min(length, round(LATE_START_SECONDS * sample_rate))
    fade_in = min(length - late_start, round(FADE_IN_SECONDS * sample_rate))
    stereo[:late_start] = 0
    if fade_in:
        stereo[late_start : late_start + fade_in] *= np.linspace(0, 1, fade_in, endpoint=False)[:, None]
    fade_out = min(length, round(FADE_OUT_SECONDS * sample_rate))
    if fade_out:
        stereo[-fade_out:] *= np.linspace(1, 0, fade_out, endpoint=True)[:, None]
    energies = np.sqrt(np.sum(np.square(stereo), axis=0))
    stereo *= TARGET_CHANNEL_ENERGY / max(float(np.max(energies)), 1e-12)
    return np.round(np.clip(stereo, -0.98, 0.98) * 32767).astype(np.int16)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--air-root", type=Path, required=True, help="Extracted AIR_1_4 directory")
    parser.add_argument("--archive", type=Path, help="Optional original ZIP for SHA-256 verification")
    args = parser.parse_args()
    air_root = args.air_root.resolve()
    if args.archive and sha256(args.archive.resolve()) != AIR_ARCHIVE_SHA256:
        raise ValueError("AIR v1.4 archive SHA-256 mismatch")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {
        "schema": "SpatialAudioEssential.BRIRLibrary/2.0",
        "defaultId": "aula",
        "source": {
            "name": "Aachen Impulse Response Database v1.4",
            "archiveSha256": AIR_ARCHIVE_SHA256,
            "url": "https://www2.iks.rwth-aachen.de/air/air_database_release_1_4.zip",
        },
        "profiles": [],
    }
    for definition in PROFILES:
        output = build_measured_late_field(
            air_root / definition["left"],
            air_root / definition["right"],
            definition["maximumSeconds"],
        )
        target = OUTPUT_DIR / definition["file"]
        wavfile.write(target, SAMPLE_RATE, output)
        manifest["profiles"].append({
            "id": definition["id"],
            "label": definition["label"],
            "file": definition["file"],
            "seconds": round(len(output) / SAMPLE_RATE, 4),
            "roomClass": definition["roomClass"],
            "description": definition["description"],
            "measured": True,
            "sourceLeft": definition["left"],
            "sourceRight": definition["right"],
            "sha256": sha256(target),
        })
    (OUTPUT_DIR / "profiles.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"profiles={len(PROFILES)} output={OUTPUT_DIR}")


if __name__ == "__main__":
    main()
