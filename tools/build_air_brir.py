"""Build the compact Aula Carolina binaural late-field response used by the app.

The AIR database stores one ear per MAT file. This script combines the frontal
3 m dummy-head measurement into a stereo WAV, removes the direct/early segment
already rendered by the Web Audio graph, and keeps a bounded late tail.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from scipy.io import loadmat, wavfile


SAMPLE_RATE = 48_000
LATE_START_SECONDS = 0.045
LATE_FADE_IN_SECONDS = 0.018
OUTPUT_SECONDS = 2.8
OUTPUT_FADE_SECONDS = 0.28
TARGET_CHANNEL_ENERGY = 0.34


def load_channel(path: Path) -> np.ndarray:
    payload = loadmat(path, squeeze_me=True, struct_as_record=False)
    samples = np.asarray(payload["h_air"], dtype=np.float64).reshape(-1)
    sample_rate = int(payload["air_info"].fs)
    if sample_rate != SAMPLE_RATE:
        raise ValueError(f"{path.name}: expected {SAMPLE_RATE} Hz, got {sample_rate} Hz")
    return samples


def build_response(left_path: Path, right_path: Path) -> np.ndarray:
    left = load_channel(left_path)
    right = load_channel(right_path)
    length = min(len(left), len(right), round(OUTPUT_SECONDS * SAMPLE_RATE))
    stereo = np.column_stack((left[:length], right[:length]))

    late_start = round(LATE_START_SECONDS * SAMPLE_RATE)
    fade_in = round(LATE_FADE_IN_SECONDS * SAMPLE_RATE)
    stereo[:late_start] = 0
    stereo[late_start : late_start + fade_in] *= np.linspace(
        0,
        1,
        fade_in,
        endpoint=False,
    )[:, None]

    fade_out = min(round(OUTPUT_FADE_SECONDS * SAMPLE_RATE), length)
    stereo[-fade_out:] *= np.linspace(1, 0, fade_out, endpoint=True)[:, None]

    energies = np.sqrt(np.sum(np.square(stereo), axis=0))
    safe_energy = max(float(np.max(energies)), 1e-12)
    stereo *= TARGET_CHANNEL_ENERGY / safe_energy
    stereo = np.clip(stereo, -0.98, 0.98)
    return np.round(stereo * 32767).astype(np.int16)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--left", type=Path, required=True)
    parser.add_argument("--right", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    response = build_response(args.left, args.right)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    wavfile.write(args.output, SAMPLE_RATE, response)
    print(
        f"Wrote {args.output} "
        f"({len(response) / SAMPLE_RATE:.2f}s, stereo, {SAMPLE_RATE}Hz)"
    )


if __name__ == "__main__":
    main()
