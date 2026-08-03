from __future__ import annotations

import hashlib
import json
import math
import struct
from pathlib import Path

import h5py
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "data" / "hrtf"
PROFILE_PATH = OUTPUT_DIR / "universal-listener-v1.json"
SOFA_PATH = OUTPUT_DIR / "universal-listener-v1.sofa"
RUNTIME_PATH = OUTPUT_DIR / "universal-listener-v1.hrir"
SAMPLE_RATE = 48_000
IMPULSE_LENGTH = 256
SPEED_OF_SOUND = 343.0
HEAD_RADIUS_M = 0.0875
BASE_INDEX = 24


def woodworth_itd(azimuth_degrees: float) -> float:
    angle = math.radians(abs(((azimuth_degrees + 180) % 360) - 180))
    folded = min(angle, math.pi - angle)
    folded = min(folded, math.pi / 2)
    return HEAD_RADIUS_M / SPEED_OF_SOUND * (folded + math.sin(folded))


def add_fractional_tap(signal: np.ndarray, index: float, gain: float) -> None:
    left = int(math.floor(index))
    fraction = index - left
    if 0 <= left < len(signal):
        signal[left] += gain * (1 - fraction)
    if 0 <= left + 1 < len(signal):
        signal[left + 1] += gain * fraction


def generate_hrir(azimuth: float, elevation: float) -> np.ndarray:
    normalized_azimuth = ((azimuth + 180) % 360) - 180
    side = math.sin(math.radians(normalized_azimuth))
    lateral = abs(side)
    rear = max(0.0, -math.cos(math.radians(normalized_azimuth)))
    height = max(-1.0, min(1.0, elevation / 70.0))
    itd_samples = woodworth_itd(normalized_azimuth) * SAMPLE_RATE
    ild_db = 9.0 * lateral**0.78
    far_gain = 10 ** (-ild_db / 20)

    left = np.zeros(IMPULSE_LENGTH, dtype=np.float64)
    right = np.zeros(IMPULSE_LENGTH, dtype=np.float64)
    source_on_right = side >= 0
    left_delay = itd_samples if source_on_right else 0.0
    right_delay = 0.0 if source_on_right else itd_samples
    left_gain = far_gain if source_on_right else 1.0
    right_gain = 1.0 if source_on_right else far_gain

    front_presence = 1.0 + 0.055 * max(0.0, math.cos(math.radians(normalized_azimuth)))
    rear_attenuation = 1.0 - 0.12 * rear
    direct_gain = front_presence * rear_attenuation
    add_fractional_tap(left, BASE_INDEX + left_delay, direct_gain * left_gain)
    add_fractional_tap(right, BASE_INDEX + right_delay, direct_gain * right_gain)

    notch_hz = max(5200.0, min(11_500.0, 8900.0 + elevation * 38.0 - rear * 2200.0))
    notch_delay = SAMPLE_RATE / (2 * notch_hz)
    notch_strength = 0.19 + 0.075 * rear + 0.035 * abs(height)
    add_fractional_tap(left, BASE_INDEX + left_delay + notch_delay, -notch_strength * left_gain)
    add_fractional_tap(right, BASE_INDEX + right_delay + notch_delay, -notch_strength * right_gain)

    pinna_delay = SAMPLE_RATE * (0.00038 + 0.00016 * rear + 0.00007 * max(0.0, height))
    pinna_gain = 0.115 + 0.035 * max(0.0, height) - 0.02 * rear
    add_fractional_tap(left, BASE_INDEX + left_delay + pinna_delay, pinna_gain * left_gain)
    add_fractional_tap(right, BASE_INDEX + right_delay + pinna_delay, pinna_gain * right_gain)

    shoulder_delay = SAMPLE_RATE * (0.0037 + 0.0013 * rear - 0.00045 * height)
    shoulder_gain = 0.042 + 0.028 * rear + 0.012 * max(0.0, -height)
    add_fractional_tap(left, BASE_INDEX + left_delay + shoulder_delay, shoulder_gain * left_gain)
    add_fractional_tap(right, BASE_INDEX + right_delay + shoulder_delay, shoulder_gain * right_gain)

    if lateral > 0.02:
        far = left if source_on_right else right
        delayed = far.copy()
        coefficient = 0.28 + 0.34 * lateral
        for index in range(1, len(far)):
            delayed[index] = (1 - coefficient) * delayed[index] + coefficient * delayed[index - 1]
        if source_on_right:
            left = delayed
        else:
            right = delayed

    pair = np.stack([left, right])
    energy = float(np.sqrt(np.sum(pair * pair) / 2) + 1e-12)
    pair *= min(1.0, 0.92 / energy)
    return pair.astype(np.float32)


def build_profile(directions: list[tuple[float, float]]) -> dict[str, object]:
    return {
        "schema": "SpatialAudioEssential.HRTFProfile/1.0",
        "id": "universal-listener-v1",
        "label": "Universal Listener v1",
        "profileType": "generic-parametric-symmetric",
        "sofaConvention": "SimpleFreeFieldHRIR",
        "aes69Edition": "AES69-2022 / SOFA 2.1",
        "sampleRate": SAMPLE_RATE,
        "impulseLength": IMPULSE_LENGTH,
        "anthropometry": {
            "headRadiusMeters": HEAD_RADIUS_M,
            "earSpacingMeters": HEAD_RADIUS_M * 2,
            "speedOfSoundMetersPerSecond": SPEED_OF_SOUND,
        },
        "cueModel": {
            "itd": "Woodworth rigid-sphere folded rear model",
            "maximumIldDb": 9.0,
            "frontPinnaNotchHz": 8900,
            "rearPinnaNotchHz": 6700,
            "elevationNotchSlopeHzPerDegree": 38,
            "diffuseFieldTarget": "bounded neutral; no headphone-specific compensation",
        },
        "rendering": {
            "symmetryRequired": True,
            "minimumPhaseMagnitudeWithExplicitItd": True,
            "recommendedDistanceMeters": [1.0, 3.0],
            "fallback": "Web Audio native HRTF",
            "runtimeAsset": "universal-listener-v1.hrir",
        },
        "directions": [
            {"azimuth": azimuth, "elevation": elevation, "distance": 1.0}
            for elevation, azimuth in directions
        ],
        "references": [
            "AES69-2022 Spatial acoustic data file format (SOFA 2.1)",
            "Woodworth-Schlosberg rigid sphere ITD model",
            "Duda and Martens (1998), Range dependence of a spherical head model",
        ],
        "limitations": [
            "This is a deterministic generic profile, not an individualized ear measurement.",
            "Headphone transfer functions and OS-level spatial processing are not compensated.",
        ],
    }


def write_sofa(directions: list[tuple[float, float]], impulses: np.ndarray) -> None:
    with h5py.File(SOFA_PATH, "w") as sofa:
        sofa.attrs.update({
            "Conventions": "SOFA",
            "Version": "2.1",
            "SOFAConventions": "SimpleFreeFieldHRIR",
            "SOFAConventionsVersion": "1.0",
            "APIName": "Spatial Audio Essential generator",
            "APIVersion": "1.0",
            "ApplicationName": "Spatial Audio Essential",
            "ApplicationVersion": "1.4.0",
            "AuthorContact": "Locally generated deterministic generic profile",
            "Organization": "Spatial Audio Essential",
            "License": "CC0-1.0 (generated model parameters and FIR data)",
            "DataType": "FIR",
            "RoomType": "free field",
            "Title": "Universal Listener v1 generic symmetric HRTF",
            "Comment": "Parametric average-head model; not an individualized measurement.",
            "History": "Generated by tools/build_universal_hrtf.py",
            "References": "AES69-2022; Woodworth ITD; Duda and Martens 1998",
            "DateCreated": "2026-08-02",
        })
        source_position = np.asarray(
            [[azimuth, elevation, 1.0] for elevation, azimuth in directions],
            dtype=np.float64,
        )
        dataset = sofa.create_dataset("SourcePosition", data=source_position)
        dataset.attrs["Type"] = "spherical"
        dataset.attrs["Units"] = "degree, degree, metre"
        listener_position = sofa.create_dataset("ListenerPosition", data=np.asarray([[0.0, 0.0, 0.0]], dtype=np.float64))
        listener_position.attrs["Type"] = "cartesian"
        listener_position.attrs["Units"] = "metre"
        listener_view = sofa.create_dataset("ListenerView", data=np.asarray([[1.0, 0.0, 0.0]], dtype=np.float64))
        listener_view.attrs["Type"] = "cartesian"
        listener_view.attrs["Units"] = "metre"
        listener_up = sofa.create_dataset("ListenerUp", data=np.asarray([[0.0, 0.0, 1.0]], dtype=np.float64))
        listener_up.attrs["Type"] = "cartesian"
        listener_up.attrs["Units"] = "metre"
        receiver = sofa.create_dataset(
            "ReceiverPosition",
            data=np.asarray([[[0.0], [HEAD_RADIUS_M], [0.0]], [[0.0], [-HEAD_RADIUS_M], [0.0]]]),
        )
        receiver.attrs["Type"] = "cartesian"
        receiver.attrs["Units"] = "metre"
        emitter = sofa.create_dataset("EmitterPosition", data=np.zeros((1, 3, 1), dtype=np.float64))
        emitter.attrs["Type"] = "cartesian"
        emitter.attrs["Units"] = "metre"
        sofa.create_dataset("Data.IR", data=impulses, compression="gzip", compression_opts=6)
        sampling_rate = sofa.create_dataset("Data.SamplingRate", data=np.asarray([SAMPLE_RATE], dtype=np.float64))
        sampling_rate.attrs["Units"] = "hertz"
        sofa.create_dataset("Data.Delay", data=np.zeros((1, 2), dtype=np.float64))


def write_runtime_asset(directions: list[tuple[float, float]], impulses: np.ndarray) -> None:
    positions = np.asarray(
        [[azimuth, elevation, 1.0] for elevation, azimuth in directions],
        dtype="<f4",
    )
    data = np.asarray(impulses, dtype="<f4")
    header = struct.pack(
        "<8sIIII",
        b"SAHRTF1\0",
        len(directions),
        2,
        IMPULSE_LENGTH,
        SAMPLE_RATE,
    )
    RUNTIME_PATH.write_bytes(header + positions.tobytes() + data.tobytes())


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    elevations = [-45.0, -20.0, 0.0, 20.0, 45.0, 70.0]
    azimuths = [float(value) for value in range(-180, 180, 15)]
    directions = [(elevation, azimuth) for elevation in elevations for azimuth in azimuths]
    impulses = np.stack([generate_hrir(azimuth, elevation) for elevation, azimuth in directions])
    profile = build_profile(directions)
    PROFILE_PATH.write_text(json.dumps(profile, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_sofa(directions, impulses)
    write_runtime_asset(directions, impulses)
    print(f"profile={PROFILE_PATH} sha256={hashlib.sha256(PROFILE_PATH.read_bytes()).hexdigest()}")
    print(f"sofa={SOFA_PATH} sha256={hashlib.sha256(SOFA_PATH.read_bytes()).hexdigest()}")
    print(f"runtime={RUNTIME_PATH} sha256={hashlib.sha256(RUNTIME_PATH.read_bytes()).hexdigest()}")


if __name__ == "__main__":
    main()
