"""배포에 포함되는 공간음향 자산의 크기와 SHA-256 목록을 갱신한다."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
MANIFEST_PATH = DATA_DIR / "assets-manifest.json"
ASSETS = (
    "brir/AIR_DATABASE_NOTICE.txt",
    "brir/profiles.json",
    "brir/air_meeting_room_front_late.wav",
    "brir/air_lecture_room_front_late.wav",
    "brir/air_stairway_front_late.wav",
    "brir/air_aula_carolina_front_late.wav",
    "hrtf/SADIE_II_NOTICE.txt",
    "hrtf/profiles.json",
    "hrtf/sadie-human-003.hrir",
    "hrtf/sadie-human-003.json",
    "hrtf/sadie-human-009.hrir",
    "hrtf/sadie-human-009.json",
    "hrtf/sadie-kemar.hrir",
    "hrtf/sadie-kemar.json",
    "hrtf/sadie-ku100.hrir",
    "hrtf/sadie-ku100.json",
    "hrtf/universal-listener-v1.hrir",
    "hrtf/universal-listener-v1.json",
    "hrtf/universal-listener-v1.sofa",
)


def main() -> None:
    records = []
    for relative in ASSETS:
        path = DATA_DIR / relative
        payload = path.read_bytes()
        records.append({
            "path": relative,
            "size": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
            "required": True,
        })
    manifest = {
        "schema": "SpatialAudioEssential.AssetManifest/1.0",
        "assets": records,
    }
    MANIFEST_PATH.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"assets={len(records)} manifest={MANIFEST_PATH}")


if __name__ == "__main__":
    main()
