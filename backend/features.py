"""Pure audio features with bounded FFT blocks and reusable read-only analysis data."""
from __future__ import annotations

import math
from functools import lru_cache

import numpy as np
from scipy.signal import resample_poly

ANALYSIS_SR = 22050
TARGET_TIMELINE_POINTS = 900


@lru_cache(maxsize=8)
def _analysis_window(n_fft: int) -> np.ndarray:
    window = np.hanning(n_fft).astype(np.float32)
    window.flags.writeable = False
    return window


class AnalysisFrames:
    """One padded signal and read-only frame view shared by spectral and time features."""

    def __init__(self, samples: np.ndarray, n_fft: int, hop_length: int):
        self.samples = np.asarray(samples, dtype=np.float32)
        self.n_fft = n_fft
        self.hop_length = hop_length
        self.padded = np.pad(self.samples, (n_fft // 2, n_fft // 2), mode="constant")
        if len(self.padded) < n_fft:
            self.padded = np.pad(self.padded, (0, n_fft - len(self.padded)))
        self.frames = np.lib.stride_tricks.sliding_window_view(self.padded, n_fft)[::hop_length]

    def blocks(self, count: int | None = None):
        stop = len(self.frames) if count is None else min(count, len(self.frames))
        for start in range(0, stop, 256):
            yield start, self.frames[start:min(start + 256, stop)]

    def magnitude(self) -> np.ndarray:
        output = np.empty((self.n_fft // 2 + 1, len(self.frames)), dtype=np.float32, order="F")
        window = _analysis_window(self.n_fft)
        for start, frames in self.blocks():
            spectrum = np.fft.rfft(frames * window[None, :], axis=1)
            output[:, start:start + len(frames)] = np.abs(spectrum).T.astype(np.float32)
        return output

    def rms(self, count: int | None = None) -> np.ndarray:
        count = len(self.frames) if count is None else count
        output = np.empty(count, dtype=np.float32)
        for start, frames in self.blocks(count):
            # Match the scalar float32 mean and float64 sqrt of the original meter.
            means = np.mean(frames * frames, axis=1).astype(np.float64)
            output[start:start + len(frames)] = np.sqrt(means + 1e-12)
        for index in range(len(self.frames), count):
            frame = self.padded[index * self.hop_length:index * self.hop_length + self.n_fft]
            frame = np.pad(frame, (0, self.n_fft - len(frame)))
            output[index] = np.sqrt(np.mean(frame * frame) + 1e-12)
        return output

    def zero_crossings(self, count: int | None = None) -> np.ndarray:
        count = len(self.frames) if count is None else count
        output = np.zeros(count, dtype=np.float32)
        if self.n_fft < 2:
            return output
        for start, frames in self.blocks(count):
            signs = np.signbit(frames)
            output[start:start + len(frames)] = np.mean(signs[:, 1:] != signs[:, :-1], axis=1)
        for index in range(len(self.frames), count):
            frame = self.padded[index * self.hop_length:index * self.hop_length + self.n_fft]
            if len(frame) >= 2:
                signs = np.signbit(frame)
                output[index] = np.mean(signs[1:] != signs[:-1])
        return output



def resample_linear(samples: np.ndarray, source_sr: int, target_sr: int) -> np.ndarray:
    """Anti-aliased analysis resampling; retain the historical API name."""
    if source_sr <= 0 or target_sr <= 0:
        raise ValueError("Sample rates must be positive")
    if source_sr == target_sr or len(samples) == 0:
        return samples.astype(np.float32, copy=False)
    divisor = math.gcd(source_sr, target_sr)
    return resample_poly(samples, target_sr // divisor, source_sr // divisor,
                         axis=0, window=("kaiser", 8.6)).astype(np.float32)


def stft_magnitude(samples: np.ndarray, n_fft: int, hop_length: int) -> np.ndarray:
    return AnalysisFrames(samples, n_fft, hop_length).magnitude()


def frame_rms(samples: np.ndarray, n_fft: int, hop_length: int, frame_count: int) -> np.ndarray:
    return AnalysisFrames(samples, n_fft, hop_length).rms(frame_count)


def spectral_flux(magnitude: np.ndarray) -> np.ndarray:
    log_mag = np.log1p(magnitude)
    diff = np.diff(log_mag, axis=1, prepend=log_mag[:, :1])
    flux = np.mean(np.maximum(diff, 0), axis=0)
    return normalize_curve(flux)


def spectral_centroid(magnitude: np.ndarray, freqs: np.ndarray) -> np.ndarray:
    denom = np.sum(magnitude, axis=0) + 1e-9
    return (np.sum(magnitude * freqs[:, None], axis=0) / denom).astype(np.float32)


def spectral_rolloff(power: np.ndarray, freqs: np.ndarray, roll_percent: float) -> np.ndarray:
    cumulative = np.cumsum(power, axis=0)
    threshold = cumulative[-1, :] * roll_percent
    indices = np.argmax(cumulative >= threshold[None, :], axis=0)
    return freqs[np.clip(indices, 0, len(freqs) - 1)].astype(np.float32)


def spectral_flatness(magnitude: np.ndarray) -> np.ndarray:
    safe = np.maximum(magnitude, 1e-9)
    geometric = np.exp(np.mean(np.log(safe), axis=0))
    arithmetic = np.mean(safe, axis=0) + 1e-9
    return np.clip(geometric / arithmetic, 0, 1).astype(np.float32)


def zero_crossing_rate(samples: np.ndarray, n_fft: int, hop_length: int, frame_count: int) -> np.ndarray:
    return AnalysisFrames(samples, n_fft, hop_length).zero_crossings(frame_count)


def chromagram_from_magnitude(power: np.ndarray, freqs: np.ndarray) -> np.ndarray:
    chroma = np.zeros((12, power.shape[1]), dtype=np.float32)
    valid = freqs > 27.5
    valid_freqs = freqs[valid]
    if valid_freqs.size == 0:
        return chroma
    midi = np.rint(12 * np.log2(valid_freqs / 440.0) + 69).astype(int)
    pitch_classes = np.mod(midi, 12)
    valid_power = power[valid]
    for pitch_class in range(12):
        mask = pitch_classes == pitch_class
        if np.any(mask):
            chroma[pitch_class] = np.sum(valid_power[mask], axis=0)
    denom = np.max(chroma, axis=0, keepdims=True) + 1e-9
    return np.clip(chroma / denom, 0, 1)


def estimate_tempo(onset_env: np.ndarray, sample_rate: int, hop_length: int) -> float:
    onset = normalize_curve(onset_env)
    if onset.size < 8 or np.max(onset) <= 0:
        return 0.0
    onset = onset - np.mean(onset)
    min_bpm, max_bpm = 50, 190
    min_lag = max(1, int(round((60 * sample_rate) / (max_bpm * hop_length))))
    max_lag = min(len(onset) - 1, int(round((60 * sample_rate) / (min_bpm * hop_length))))
    if max_lag <= min_lag:
        return 0.0
    # Only compute lags corresponding to the supported BPM range.
    corr = [np.dot(onset[:-lag], onset[lag:]) for lag in range(min_lag, max_lag + 1)]
    lag = int(np.argmax(corr) + min_lag)
    return round(float(60 * sample_rate / (lag * hop_length)), 1)


@lru_cache(maxsize=16)
def mel_filterbank(
    *,
    sample_rate: int,
    n_fft: int,
    n_mels: int,
    fmin: float,
    fmax: float,
) -> tuple[np.ndarray, np.ndarray]:
    def hz_to_mel(freq: np.ndarray | float) -> np.ndarray | float:
        return 2595.0 * np.log10(1.0 + np.asarray(freq) / 700.0)

    def mel_to_hz(mel: np.ndarray | float) -> np.ndarray | float:
        return 700.0 * (10 ** (np.asarray(mel) / 2595.0) - 1.0)

    mel_points = np.linspace(hz_to_mel(fmin), hz_to_mel(fmax), n_mels + 2)
    hz_points = mel_to_hz(mel_points).astype(np.float32)
    freqs = np.fft.rfftfreq(n_fft, d=1.0 / sample_rate)
    filters = np.zeros((n_mels, len(freqs)), dtype=np.float32)
    for index in range(n_mels):
        left, center, right = hz_points[index], hz_points[index + 1], hz_points[index + 2]
        left_slope = (freqs - left) / max(center - left, 1e-9)
        right_slope = (right - freqs) / max(right - center, 1e-9)
        filters[index] = np.maximum(0, np.minimum(left_slope, right_slope))
        total = np.sum(filters[index])
        if total > 0:
            filters[index] /= total
    centers = hz_points[1:-1]
    filters.flags.writeable = centers.flags.writeable = False
    return filters, centers


def choose_hop_length(sample_count: int) -> int:
    if sample_count <= 0:
        return 512
    raw = int(math.ceil(sample_count / TARGET_TIMELINE_POINTS))
    return int(np.clip(round_to_powerish(raw), 512, 8192))


def round_to_powerish(value: int) -> int:
    choices = np.array([512, 768, 1024, 1536, 2048, 3072, 4096, 6144, 8192])
    return int(choices[np.argmin(np.abs(choices - value))])


def resize_curve(curve: np.ndarray, length: int) -> np.ndarray:
    curve = np.asarray(curve, dtype=np.float32)
    if len(curve) == length:
        return curve
    if len(curve) == 0:
        return np.zeros(length, dtype=np.float32)
    x_old = np.linspace(0, 1, len(curve))
    x_new = np.linspace(0, 1, length)
    return np.interp(x_new, x_old, curve).astype(np.float32)


def normalize_curve(curve: np.ndarray | list[float]) -> np.ndarray:
    arr = np.asarray(curve, dtype=np.float32)
    if arr.size == 0:
        return arr
    arr = np.nan_to_num(np.maximum(arr, 0))
    peak = float(np.percentile(arr, 97) + 1e-9)
    return np.clip(arr / peak, 0, 1).astype(np.float32)


def clamp_curve(curve: np.ndarray) -> np.ndarray:
    return np.clip(np.nan_to_num(curve), 0, 1).astype(np.float32)


def compress_series(values: list[float], digits: int = 4) -> list[float]:
    return [round(float(value), digits) for value in values]


def estimate_tempo_confidence(onset_env: np.ndarray) -> float:
    onset = normalize_curve(onset_env)
    if onset.size < 4:
        return 0.0
    return round(clamp01(float(np.std(onset) * 1.6 + np.mean(onset > 0.52) * 0.45)), 3)


def clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def clamp_value(value: float, min_value: float, max_value: float) -> float:
    return max(min_value, min(max_value, float(value)))
