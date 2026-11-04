"""Audio decoding and production loudness/peak measurement."""
from __future__ import annotations

import math
import shutil
import subprocess
from pathlib import Path
from typing import Any
import numpy as np
import soundfile as sf
from scipy.signal import lfilter


class AudioChannelLayoutError(ValueError):
    """Raised when input is not mono or stereo, the supported binaural source layouts."""


def _validate_audio_channels(data: np.ndarray) -> np.ndarray:
    channel_count = 1 if data.ndim == 1 else int(data.shape[1])
    if channel_count not in (1, 2):
        raise AudioChannelLayoutError(
            f"Only mono or stereo sources are supported; received {channel_count} channels"
        )
    return np.nan_to_num(data)


def load_audio(input_path: Path) -> tuple[np.ndarray, int]:
    try:
        data, sample_rate = sf.read(str(input_path), always_2d=True, dtype="float32")
    except Exception:
        data = None
    if data is not None:
        return _validate_audio_channels(data), int(sample_rate)
    converted = input_path.with_suffix(".decoded.wav")
    try:
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            raise RuntimeError("Audio decoder unavailable")
        command = [
            ffmpeg,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(input_path),
            "-vn",
            "-acodec",
            "pcm_f32le",
            str(converted),
        ]
        subprocess.run(command, check=True, capture_output=True, text=True, timeout=240)
        data, sample_rate = sf.read(str(converted), always_2d=True, dtype="float32")
        return _validate_audio_channels(data), int(sample_rate)
    except Exception:
        converted.unlink(missing_ok=True)
        raise


def measure_master_output(input_path: Path) -> dict[str, Any]:
    """Measure the final rendered mono/stereo master with the production meters."""
    samples, sample_rate = load_audio(input_path)
    sample_peak = float(np.max(np.abs(samples))) if samples.size else 0.0
    true_peak = estimate_true_peak_8x(samples)
    return {
        "sampleRate": sample_rate,
        "channels": int(samples.shape[1]) if samples.ndim > 1 else 1,
        "duration": round(float(len(samples) / max(sample_rate, 1)), 4),
        "samplePeakDb": round(db(max(sample_peak, 1e-9)), 3),
        "estimatedTruePeakDb": round(db(true_peak), 3),
        "truePeakOversampling": 8,
        "integratedLufs": round(integrated_loudness_bs1770(samples, sample_rate), 3),
        "loudnessStandard": "ITU-R BS.1770-5 gated",
    }


def estimate_true_peak_8x(samples: np.ndarray) -> float:
    """Estimate 8x inter-sample peak with bounded windowed-sinc polyphase filtering."""
    data = np.nan_to_num(np.asarray(samples, dtype=np.float32))
    if data.size == 0:
        return 1e-9
    if data.ndim == 1:
        data = data[:, None]
    peak = float(np.max(np.abs(data)))
    tap_count = 24
    half = tap_count // 2
    offsets = np.arange(-half + 1, half + 1, dtype=np.float64)
    window = np.blackman(tap_count).astype(np.float64)
    kernels = []
    for fraction in tuple(index / 8 for index in range(1, 8)):
        kernel = np.sinc(offsets - fraction) * window
        kernel /= np.sum(kernel)
        kernels.append(kernel.astype(np.float32))

    chunk_frames = 262_144
    for channel in range(data.shape[1]):
        channel_data = data[:, channel]
        for start in range(0, len(channel_data), chunk_frames):
            stop = min(len(channel_data), start + chunk_frames)
            padded_start = max(0, start - half)
            padded_stop = min(len(channel_data), stop + half)
            segment = channel_data[padded_start:padded_stop]
            core_start = start - padded_start
            core_stop = core_start + (stop - start)
            for kernel in kernels:
                interpolated = np.convolve(segment, kernel, mode="same")
                peak = max(peak, float(np.max(np.abs(interpolated[core_start:core_stop]))))
    return max(peak, 1e-9)


def _k_weighting_coefficients(sample_rate: int) -> tuple[tuple[np.ndarray, np.ndarray], tuple[np.ndarray, np.ndarray]]:
    """Return the BS.1770 K-weighting shelf and RLB high-pass biquads."""
    rate = float(max(8000, sample_rate))

    shelf_gain_db = 4.0
    shelf_q = 1 / np.sqrt(2)
    shelf_k = np.tan(np.pi * 1500.0 / rate)
    shelf_vh = 10 ** (shelf_gain_db / 20)
    shelf_vb = shelf_vh ** 0.4996667741545416
    shelf_a0 = 1 + shelf_k / shelf_q + shelf_k * shelf_k
    shelf_b = np.asarray([
        (shelf_vh + shelf_vb * shelf_k / shelf_q + shelf_k * shelf_k) / shelf_a0,
        2 * (shelf_k * shelf_k - shelf_vh) / shelf_a0,
        (shelf_vh - shelf_vb * shelf_k / shelf_q + shelf_k * shelf_k) / shelf_a0,
    ], dtype=np.float64)
    shelf_a = np.asarray([
        1,
        2 * (shelf_k * shelf_k - 1) / shelf_a0,
        (1 - shelf_k / shelf_q + shelf_k * shelf_k) / shelf_a0,
    ], dtype=np.float64)

    highpass_q = 0.5
    highpass_k = np.tan(np.pi * 38.0 / rate)
    highpass_a0 = 1 + highpass_k / highpass_q + highpass_k * highpass_k
    highpass_b = np.asarray([
        1 / highpass_a0,
        -2 / highpass_a0,
        1 / highpass_a0,
    ], dtype=np.float64)
    highpass_a = np.asarray([
        1,
        2 * (highpass_k * highpass_k - 1) / highpass_a0,
        (1 - highpass_k / highpass_q + highpass_k * highpass_k) / highpass_a0,
    ], dtype=np.float64)
    return (shelf_b, shelf_a), (highpass_b, highpass_a)


def integrated_loudness_bs1770(samples: np.ndarray, sample_rate: int) -> float:
    """Measure gated integrated loudness using the ITU-R BS.1770 K-weighting algorithm."""
    data = np.nan_to_num(np.asarray(samples, dtype=np.float64))
    if data.size == 0:
        return -120.0
    if data.ndim == 1:
        data = data[:, None]
    if data.shape[0] < data.shape[1] and data.shape[0] <= 8:
        data = data.T

    (shelf_b, shelf_a), (highpass_b, highpass_a) = _k_weighting_coefficients(sample_rate)
    weighted = lfilter(shelf_b, shelf_a, data, axis=0)
    weighted = lfilter(highpass_b, highpass_a, weighted, axis=0)

    block_frames = max(1, int(round(sample_rate * 0.4)))
    step_frames = max(1, int(round(block_frames * 0.25)))
    if len(weighted) < block_frames:
        weighted = np.pad(weighted, ((0, block_frames - len(weighted)), (0, 0)))

    starts = np.arange(0, len(weighted) - block_frames + 1, step_frames, dtype=np.int64)
    if starts.size == 0:
        starts = np.asarray([0], dtype=np.int64)
    # Limit the prefix-sum workspace for long recordings. Each batch includes
    # the complete last block, preserving the same 400 ms windows and gates.
    block_energy = np.empty((len(starts), weighted.shape[1]), dtype=np.float64)
    batch_size = max(1, 262_144 // step_frames)
    for first in range(0, len(starts), batch_size):
        batch_starts = starts[first:first + batch_size]
        begin = int(batch_starts[0])
        end = int(batch_starts[-1]) + block_frames
        cumulative = np.empty((end - begin + 1, weighted.shape[1]), dtype=np.float64)
        cumulative[0] = 0
        np.cumsum(np.square(weighted[begin:end]), axis=0, out=cumulative[1:])
        offsets = batch_starts - begin
        block_energy[first:first + len(batch_starts)] = (
            cumulative[offsets + block_frames] - cumulative[offsets]
        ) / block_frames

    channel_weights = np.ones(block_energy.shape[1], dtype=np.float64)
    if channel_weights.size >= 5:
        channel_weights[3:5] = np.sqrt(2)
    weighted_energy = block_energy @ channel_weights
    block_loudness = -0.691 + 10 * np.log10(np.maximum(weighted_energy, 1e-30))
    absolute_mask = block_loudness >= -70.0
    if not np.any(absolute_mask):
        return -120.0

    absolute_energy = float(np.mean(weighted_energy[absolute_mask]))
    relative_gate = -0.691 + 10 * np.log10(max(absolute_energy, 1e-30)) - 10.0
    gated_mask = absolute_mask & (block_loudness >= relative_gate)
    if not np.any(gated_mask):
        return -120.0
    integrated_energy = float(np.mean(weighted_energy[gated_mask]))
    return float(-0.691 + 10 * np.log10(max(integrated_energy, 1e-30)))


def db(value: float) -> float:
    return 20.0 * math.log10(max(float(value), 1e-12))
