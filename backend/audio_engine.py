from __future__ import annotations

import math
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any
import numpy as np
from backend.features import (
    ANALYSIS_SR,
    AnalysisFrames,
    choose_hop_length,
    chromagram_from_magnitude,
    clamp01,
    clamp_curve,
    clamp_value,
    compress_series,
    estimate_tempo,
    estimate_tempo_confidence,
    mel_filterbank,
    normalize_curve,
    resample_linear,
    resize_curve,
    spectral_centroid,
    spectral_flatness,
    spectral_flux,
    spectral_rolloff,
    stft_magnitude,
)
from backend.audio_io import db, estimate_true_peak_8x, integrated_loudness_bs1770, load_audio
from backend.separation import detect_demucs_device, inspect_demucs, raise_if_cancelled

MAX_BODY_BYTES = 420 * 1024 * 1024
ANALYSIS_PROFILE_VERSION = "fullband-neutral-v7-batched"


@dataclass(frozen=True)
class Instrument:
    id: str
    label: str
    family: str
    x: float
    y: float
    z: float
    freq: float
    q: float
    color: str


INSTRUMENTS: tuple[Instrument, ...] = (
    Instrument("violins1", "1st Violins", "strings", -3.7, 0.2, -1.35, 2300, 0.82, "#78a95d"),
    Instrument("violins2", "2nd Violins", "strings", -2.15, 0.1, -1.75, 1600, 0.78, "#71a7c7"),
    Instrument("violas", "Violas", "strings", -0.55, 0.05, -1.95, 820, 0.92, "#9a9a62"),
    Instrument("cellos", "Cellos", "strings", 1.35, 0.0, -1.7, 360, 0.95, "#d4a84d"),
    Instrument("basses", "Double Basses", "strings", 3.2, 0.0, -1.35, 115, 0.9, "#a07058"),
    Instrument("flute", "Flute", "woodwinds", -1.3, 0.15, -3.05, 3600, 0.7, "#a9c9a2"),
    Instrument("oboe", "Oboe", "woodwinds", -0.35, 0.12, -3.1, 1900, 0.8, "#d5bc75"),
    Instrument("clarinet", "Clarinet", "woodwinds", 0.55, 0.08, -3.1, 1050, 0.82, "#77a36c"),
    Instrument("bassoon", "Bassoon", "woodwinds", 1.35, 0.05, -3.0, 420, 0.9, "#a67c52"),
    Instrument("horn", "Horn", "brass", -1.75, 0.35, -4.25, 520, 0.86, "#cfaa62"),
    Instrument("trumpet", "Trumpet", "brass", 0.55, 0.45, -4.35, 2100, 0.75, "#e68355"),
    Instrument("trombone", "Trombone", "brass", 1.65, 0.4, -4.45, 760, 0.82, "#c46b50"),
    Instrument("timpani", "Timpani", "percussion", -2.85, 0.15, -5.05, 105, 0.92, "#955251"),
    Instrument("percussion", "Percussion", "percussion", 2.85, 0.55, -5.1, 4300, 0.72, "#d1795c"),
    Instrument("harp", "Harp", "plucked", -3.15, 0.25, -3.45, 3100, 0.62, "#f2b38f"),
    Instrument("piano", "Piano", "keyboard", -2.35, 0.2, -3.7, 1250, 0.72, "#d6c4a0"),
)


def analyze_audio(
    input_path: Path,
    *,
    job_id: str,
    output_dir: Path,
    request_demucs: bool = False,
    demucs_model: str = "htdemucs_ft",
    cache_key: str | None = None,
    demucs_cache_key: str | None = None,
    cancel_event: threading.Event | None = None,
) -> dict[str, Any]:
    # 업로드된 오디오를 분석해 프론트엔드가 바로 렌더링할 수 있는 표준 JSON payload를 만든다.
    # 로드, 리샘플, STFT, 템포/키/믹스/악기 추정, Demucs 확인이 이 함수 안에서 순서대로 이어진다.
    analysis_started = time.perf_counter()
    timings: dict[str, float] = {}
    raise_if_cancelled(cancel_event)
    y, source_sr = load_audio(input_path)
    timings["decodeSeconds"] = time.perf_counter() - analysis_started
    raise_if_cancelled(cancel_event)
    if y.ndim == 1:
        channels = 1
        mono = y.astype(np.float32, copy=False)
    else:
        channels = int(y.shape[1])
        mono = np.mean(y, axis=1).astype(np.float32, copy=False)

    if source_sr != ANALYSIS_SR:
        mono_analysis = resample_linear(mono, source_sr, ANALYSIS_SR)
    else:
        mono_analysis = mono

    mono_analysis = np.nan_to_num(mono_analysis.astype(np.float32, copy=False))
    duration = float(len(mono) / max(1, source_sr))
    hop_length = choose_hop_length(len(mono_analysis))
    n_fft = 4096

    frames = AnalysisFrames(mono_analysis, n_fft, hop_length)
    magnitude = frames.magnitude()
    power = magnitude**2
    freqs = np.fft.rfftfreq(n_fft, d=1.0 / ANALYSIS_SR).astype(np.float32)
    times = (np.arange(magnitude.shape[1], dtype=np.float32) * hop_length / ANALYSIS_SR).astype(np.float32)

    rms = frames.rms()
    onset_env = spectral_flux(magnitude)
    centroid = spectral_centroid(magnitude, freqs)
    rolloff = spectral_rolloff(power, freqs, roll_percent=0.85)
    flatness = spectral_flatness(magnitude)
    zcr = frames.zero_crossings()
    chroma = chromagram_from_magnitude(power, freqs)
    raise_if_cancelled(cancel_event)

    tempo = estimate_tempo(onset_env, ANALYSIS_SR, hop_length)

    feature_started = time.perf_counter()
    nmf_result = run_nmf_instrument_model(mono_analysis, hop_length, n_fft, magnitude=magnitude)
    timings["nmfSeconds"] = time.perf_counter() - feature_started
    raise_if_cancelled(cancel_event)
    curves = refine_instrument_curves(
        nmf_result["curves"],
        rms=rms,
        onset_env=onset_env,
        centroid=centroid,
        flatness=flatness,
    )

    active_ids = select_active_instruments(curves)
    waveform = make_waveform_preview(mono, 720)
    mix = analyze_mix(
        mono,
        source_sr,
        rms,
        centroid,
        rolloff,
        flatness,
        zcr,
        power=power,
        freqs=freqs,
        multichannel=y,
    )
    stereo_image = build_stereo_image(y, source_sr, curves, n_fft=n_fft, hop_length=hop_length)
    key = estimate_key(chroma)
    sections = build_sections(times, rms, centroid, onset_env, curves, duration)
    timings["featureSeconds"] = time.perf_counter() - analysis_started
    separator_started = time.perf_counter()
    demucs = inspect_demucs(
        request_demucs,
        input_path,
        output_dir,
        job_id,
        cache_key=demucs_cache_key or cache_key,
        model=demucs_model,
        cancel_event=cancel_event,
    )
    raise_if_cancelled(cancel_event)
    timings["separatorSeconds"] = time.perf_counter() - separator_started
    timings["wallSeconds"] = time.perf_counter() - analysis_started

    return {
        "jobId": job_id,
        "cacheKey": cache_key or job_id,
        "analysisProfile": ANALYSIS_PROFILE_VERSION,
        "analysisTiming": {key: round(value, 3) for key, value in timings.items()},
        "file": {
            "name": input_path.name,
            "sampleRate": int(source_sr),
            "channels": channels,
            "duration": duration,
        },
        "models": {
            "primary": "NMF Instrument Activity v2",
            "features": "NumPy STFT/chroma/onset/spectral features",
            "deepSeparator": demucs,
        "notes": [
            "NMF is kept as a fast fallback analysis path.",
            "Demucs uses a fine-tuned four-stem core and promotes quality-gated guitar/piano candidates from an auxiliary six-stem pass.",
        ],
        },
        "timeline": {
            "times": compress_series(times.tolist(), 4),
            "rms": compress_series(normalize_curve(rms).tolist(), 4),
            "onset": compress_series(normalize_curve(onset_env).tolist(), 4),
            "centroid": compress_series(normalize_curve(centroid).tolist(), 4),
        },
        "waveform": waveform,
        "tempo": {"bpm": round(tempo, 1), "confidence": estimate_tempo_confidence(onset_env)},
        "key": key,
        "mix": mix,
        "stereoImage": stereo_image,
        "instruments": [
            build_instrument_payload(
                instrument,
                curves[instrument.id],
                active_ids,
                stereo_image.get("instruments", {}).get(instrument.id),
            )
            for instrument in INSTRUMENTS
        ],
        "activeIds": active_ids,
        "sections": sections,
        "recommendations": build_clean_recommendations(active_ids, mix, demucs),
    }


def analyze_audio_optimized(
    input_path: Path,
    *,
    job_id: str,
    output_dir: Path,
    request_demucs: bool = False,
    demucs_model: str = "htdemucs_ft",
    cache_key: str | None = None,
    demucs_cache_key: str | None = None,
    cancel_event: threading.Event | None = None,
) -> dict[str, Any]:
    """CUDA 분리와 CPU 특성 분석을 겹쳐 전체 대기 시간을 줄인다."""
    started = time.perf_counter()
    options = dict(job_id=job_id, output_dir=output_dir, demucs_model=demucs_model,
                   cache_key=cache_key, demucs_cache_key=demucs_cache_key, cancel_event=cancel_event)
    if not request_demucs or detect_demucs_device() != "cuda":
        return analyze_audio(input_path, request_demucs=request_demucs, **options)

    effective_cancel_event = cancel_event or threading.Event()
    with ThreadPoolExecutor(max_workers=2, thread_name_prefix="spatial-analysis") as executor:
        options["cancel_event"] = effective_cancel_event
        feature_future = executor.submit(analyze_audio, input_path, request_demucs=False, **options)
        separator_future = executor.submit(
            inspect_demucs,
            True,
            input_path,
            output_dir,
            job_id,
            cache_key=demucs_cache_key or cache_key,
            model=demucs_model,
            cancel_event=effective_cancel_event,
        )
        try:
            result = feature_future.result()
            separator = separator_future.result()
        except Exception:
            effective_cancel_event.set()
            raise

    result["models"]["deepSeparator"] = separator
    result["recommendations"] = build_clean_recommendations(
        result.get("activeIds", []),
        result.get("mix", {}),
        separator,
    )
    result["analysisExecution"] = "parallel-cpu-features-cuda-demucs"
    result.setdefault("analysisTiming", {}).update({
        "wallSeconds": round(time.perf_counter() - started, 3),
        "separatorSeconds": separator.get("timing", {}).get("totalSeconds", 0),
    })
    return result


def run_nmf_instrument_model(samples: np.ndarray, hop_length: int, n_fft: int,
                             magnitude: np.ndarray | None = None) -> dict[str, Any]:
    # NMF는 스펙트럼에서 반복되는 패턴을 분해해 악기 활동 곡선처럼 해석한다.
    # 실제 악기 분리 모델이 아니라 빠른 fallback 분석이므로, 이후 refine 단계에서 RMS/onset/centroid로 보정한다.
    if magnitude is None:
        magnitude = stft_magnitude(samples, n_fft=n_fft, hop_length=hop_length)
    filterbank, mel_freqs = mel_filterbank(
        sample_rate=ANALYSIS_SR,
        n_fft=n_fft,
        n_mels=176,
        fmin=30,
        fmax=min(11000, ANALYSIS_SR // 2),
    )
    mel = (filterbank @ magnitude).astype(np.float32)

    scale = np.percentile(mel, 96) + 1e-7
    x = np.log1p((mel / scale) * 14.0)
    x = np.maximum(x.T, 1e-7)
    component_count = int(np.clip(x.shape[0] // 28, 14, 28))
    component_count = min(component_count, x.shape[0] - 1, x.shape[1] - 1)
    if component_count < 4:
        component_count = 4

    activations, spectra = numpy_nmf(x, component_count, max_iter=160)

    curves = {instrument.id: np.zeros(activations.shape[0], dtype=np.float32) for instrument in INSTRUMENTS}
    component_payloads: list[dict[str, Any]] = []

    for component_index in range(component_count):
        spectrum = spectra[component_index]
        activation = activations[:, component_index]
        scores = classify_component(spectrum, activation, mel_freqs)
        activation = normalize_curve(activation)
        activation = fast_attack_release(activation, release=0.42)

        for instrument_id, score in scores.items():
            curves[instrument_id] += activation * float(score)

        top = sorted(scores.items(), key=lambda item: item[1], reverse=True)[:3]
        component_payloads.append(
            {
                "index": component_index,
                "top": [{"id": key, "score": round(float(score), 4)} for key, score in top],
            }
        )

    global_peak = np.percentile(np.concatenate([curve for curve in curves.values()]), 97) + 1e-8
    for instrument_id, curve in curves.items():
        curves[instrument_id] = normalize_activity_curve(curve, instrument_id, scale=float(global_peak))

    return {"curves": curves, "components": component_payloads}


def numpy_nmf(x: np.ndarray, component_count: int, max_iter: int = 140) -> tuple[np.ndarray, np.ndarray]:
    matrix = np.maximum(np.asarray(x, dtype=np.float32), 1e-7)
    frames, bins = matrix.shape
    rng = np.random.default_rng(13)
    activations = rng.random((frames, component_count), dtype=np.float32) * 0.12 + 0.08
    spectra = rng.random((component_count, bins), dtype=np.float32) * 0.12 + 0.08
    eps = np.float32(1e-7)

    for iteration in range(max_iter):
        numerator_h = activations.T @ matrix
        denominator_h = (activations.T @ activations @ spectra) + eps
        spectra *= numerator_h / denominator_h

        numerator_w = matrix @ spectra.T
        denominator_w = (activations @ (spectra @ spectra.T)) + eps
        activations *= numerator_w / denominator_w

        if iteration % 12 == 0:
            norms = np.maximum(np.linalg.norm(spectra, axis=1, keepdims=True), eps)
            spectra /= norms
            activations *= norms.T

    return np.nan_to_num(activations).astype(np.float32), np.nan_to_num(spectra).astype(np.float32)


def classify_component(spectrum: np.ndarray, activation: np.ndarray, freqs: np.ndarray) -> dict[str, float]:
    spectrum = np.maximum(np.asarray(spectrum, dtype=np.float32), 0)
    activation = np.maximum(np.asarray(activation, dtype=np.float32), 0)
    total = float(np.sum(spectrum) + 1e-9)
    centroid = float(np.sum(freqs * spectrum) / total)
    spread = float(np.sqrt(np.sum(((freqs - centroid) ** 2) * spectrum) / total))
    p95 = float(np.percentile(activation, 95) + 1e-7)
    activation_norm = np.clip(activation / p95, 0, 2)
    diff = np.diff(activation_norm, prepend=activation_norm[0])
    attack = float(np.mean(np.maximum(diff, 0)) * 6.0)
    sparseness = float(np.mean(activation_norm > 0.48))
    sustain = clamp01(1.0 - attack * 0.72 + sparseness * 0.18)

    low = band_ratio(spectrum, freqs, 35, 180)
    bass = band_ratio(spectrum, freqs, 80, 320)
    low_mid = band_ratio(spectrum, freqs, 220, 700)
    mid = band_ratio(spectrum, freqs, 650, 1800)
    presence = band_ratio(spectrum, freqs, 1800, 4300)
    string_air = band_ratio(spectrum, freqs, 2600, 7200)
    air = band_ratio(spectrum, freqs, 6500, 10500)
    broad = clamp01((low + bass + low_mid + mid + presence + air * 0.6) * 1.42)
    tonal = clamp01(1.0 - (spread / max(centroid + 250, 1)) * 0.62)
    percussive = clamp01(attack * 0.95 + (1.0 - sparseness) * 0.05)

    string_sustain = clamp01((presence * 1.15 + string_air * 0.85 + mid * 0.45) * tonal * (0.56 + sustain * 0.75))
    string_staccato = clamp01((presence * 1.05 + string_air * 0.92 + mid * 0.36) * tonal * (0.45 + percussive * 0.9))
    piano_body = clamp01((bass * 0.55 + low_mid * 0.8 + mid * 0.72 + presence * 0.42) * broad)
    piano_score = clamp01((piano_body * (0.54 + percussive * 0.8) * (0.58 + tonal * 0.48)) - air * 0.12)
    harp_score = clamp01((presence * 0.7 + air * 0.9 + string_air * 0.46) * percussive * tonal * (1.0 - low_mid * 0.38))
    woodwind_core = clamp01((mid * 0.8 + presence * 0.52 + string_air * 0.22) * tonal * (0.7 + sustain * 0.5))
    brass_core = clamp01((low_mid * 0.55 + mid * 0.88 + presence * 0.72) * (0.52 + percussive * 0.35) * (1.0 - air * 0.24))
    percussion_core = clamp01((presence * 0.35 + air * 0.82 + string_air * 0.45) * (0.45 + percussive * 1.2) * (1.0 - tonal * 0.2))

    scores = {
        "basses": bell(centroid, 90, 0.75) * (low * 1.2 + bass * 0.9) * (0.6 + sustain),
        "cellos": bell(centroid, 360, 0.72) * (bass * 0.5 + low_mid * 1.1 + mid * 0.25) * (0.62 + sustain),
        "violas": bell(centroid, 820, 0.62) * (low_mid * 0.65 + mid * 1.1 + presence * 0.26) * (0.58 + string_sustain),
        "violins2": bell(centroid, 1450, 0.6) * (mid * 0.58 + presence * 1.0 + string_air * 0.42) * (0.54 + string_sustain + string_staccato * 0.6),
        "violins1": bell(centroid, 2450, 0.68) * (presence * 1.02 + string_air * 0.72 + mid * 0.22) * (0.48 + string_sustain + string_staccato * 0.72),
        "flute": bell(centroid, 3600, 0.58) * woodwind_core * (0.65 + air * 0.35),
        "oboe": bell(centroid, 1800, 0.46) * woodwind_core * (0.8 + presence * 0.28),
        "clarinet": bell(centroid, 950, 0.55) * woodwind_core * (0.8 + mid * 0.25),
        "bassoon": bell(centroid, 430, 0.5) * woodwind_core * (0.8 + low_mid * 0.45),
        "horn": bell(centroid, 620, 0.58) * brass_core * (0.85 + sustain * 0.25),
        "trumpet": bell(centroid, 2150, 0.55) * brass_core * (0.8 + presence * 0.35),
        "trombone": bell(centroid, 780, 0.54) * brass_core * (0.82 + low_mid * 0.28),
        "timpani": bell(centroid, 115, 0.64) * (low + bass * 0.7) * (0.55 + percussive),
        "percussion": percussion_core,
        "harp": harp_score,
        "piano": piano_score * bell(centroid, 1150, 0.95),
    }

    string_max = max(scores["violins1"], scores["violins2"], scores["violas"], scores["cellos"])
    if string_staccato > 0.46 and string_max > 0.08:
        scores["harp"] *= 0.28
        scores["piano"] *= 0.62
        scores["violins1"] *= 1.35
        scores["violins2"] *= 1.28
        scores["violas"] *= 1.14

    if piano_score > 0.22 and broad > 0.52 and low_mid + bass > 0.15:
        scores["piano"] *= 1.42
        scores["harp"] *= 0.68
        if string_staccato < 0.5 and string_sustain < 0.58:
            for key in ("violins1", "violins2", "violas", "cellos"):
                scores[key] *= 0.72

    if harp_score > 0.2 and low_mid < 0.12 and bass < 0.06:
        scores["harp"] *= 1.35
        scores["piano"] *= 0.58

    string_raw = max(scores["violins1"], scores["violins2"], scores["violas"], scores["cellos"])
    wind_raw = max(scores["flute"], scores["oboe"], scores["clarinet"], scores["bassoon"])
    brass_raw = max(scores["horn"], scores["trumpet"], scores["trombone"])
    if (string_sustain > 0.32 or string_staccato > 0.44) and string_raw >= max(wind_raw, brass_raw) * 0.62:
        for key in ("flute", "oboe", "clarinet", "bassoon"):
            scores[key] *= 0.28
        for key in ("horn", "trumpet", "trombone"):
            scores[key] *= 0.32
    if piano_score > 0.3 and piano_body > 0.28:
        for key in ("horn", "trumpet", "trombone", "oboe", "clarinet"):
            scores[key] *= 0.58

    positive = {key: max(0.0, float(value)) for key, value in scores.items()}
    max_score = max(positive.values()) if positive else 0.0
    if max_score <= 0:
        return {key: 0.0 for key in positive}
    filtered = {
        key: value if value >= max_score * 0.24 and value >= 0.018 else 0.0
        for key, value in positive.items()
    }
    if not any(value > 0 for value in filtered.values()):
        best_key = max(positive, key=positive.get)
        filtered[best_key] = positive[best_key]
    total_score = sum(filtered.values()) + 1e-9
    return {key: clamp01(value / total_score) for key, value in filtered.items()}


def band_ratio(spectrum: np.ndarray, freqs: np.ndarray, low: float, high: float) -> float:
    mask = (freqs >= low) & (freqs < high)
    if not np.any(mask):
        return 0.0
    return float(np.sum(spectrum[mask]) / (np.sum(spectrum) + 1e-9))


def bell(value: float, center: float, width: float) -> float:
    if value <= 0 or center <= 0:
        return 0.0
    return float(math.exp(-((math.log(value / center) ** 2) / (2 * width * width))))


def refine_instrument_curves(
    curves: dict[str, np.ndarray],
    *,
    rms: np.ndarray,
    onset_env: np.ndarray,
    centroid: np.ndarray,
    flatness: np.ndarray,
) -> dict[str, np.ndarray]:
    rms_n = normalize_curve(rms)
    onset_n = normalize_curve(onset_env)
    centroid_n = normalize_curve(centroid)
    flatness_n = normalize_curve(flatness)
    length = len(rms_n)

    refined: dict[str, np.ndarray] = {}
    for instrument in INSTRUMENTS:
        curve = resize_curve(curves[instrument.id], length)
        if instrument.family == "strings":
            bow_gate = clamp_curve(0.58 + centroid_n * 0.32 - flatness_n * 0.24 + onset_n * 0.18)
            curve = curve * bow_gate
        elif instrument.family == "woodwinds":
            wind_gate = clamp_curve(0.62 + centroid_n * 0.22 - onset_n * 0.2 - flatness_n * 0.16)
            curve = curve * wind_gate
        elif instrument.family == "brass":
            brass_gate = clamp_curve(0.54 + centroid_n * 0.18 + onset_n * 0.16 - flatness_n * 0.08)
            curve = curve * brass_gate
        elif instrument.id == "piano":
            piano_gate = clamp_curve(0.48 + onset_n * 0.42 + rms_n * 0.28 - flatness_n * 0.16)
            curve = curve * piano_gate
        elif instrument.id == "harp":
            harp_gate = clamp_curve(0.42 + onset_n * 0.52 + centroid_n * 0.24 - rms_n * 0.08)
            curve = curve * harp_gate
        elif instrument.family == "percussion":
            curve = curve * clamp_curve(0.35 + onset_n * 0.88 + flatness_n * 0.32)

        refined[instrument.id] = normalize_activity_curve(
            curve * clamp_curve(rms_n * 1.15 + 0.08),
            instrument.id,
            scale=1.0,
        )

    suppress_false_harp_from_strings(refined)
    suppress_false_strings_from_piano(refined)
    suppress_false_winds_from_strings(refined)
    suppress_false_brass_from_strings(refined)
    suppress_false_percussion_from_piano(refined)
    return refined


def build_stereo_image(
    samples: np.ndarray,
    sample_rate: int,
    curves: dict[str, np.ndarray],
    *,
    n_fft: int,
    hop_length: int,
) -> dict[str, Any]:
    if samples.ndim != 2 or samples.shape[1] < 2:
        return {
            "status": "mono",
            "pan": 0.0,
            "width": 0.0,
            "correlation": 1.0,
            "confidence": 0.0,
            "instruments": {},
        }

    left = np.nan_to_num(samples[:, 0].astype(np.float32, copy=False))
    right = np.nan_to_num(samples[:, 1].astype(np.float32, copy=False))
    if sample_rate != ANALYSIS_SR:
        left = resample_linear(left, sample_rate, ANALYSIS_SR)
        right = resample_linear(right, sample_rate, ANALYSIS_SR)
    length = min(len(left), len(right))
    if length <= 0:
        return {
            "status": "empty",
            "pan": 0.0,
            "width": 0.0,
            "correlation": 1.0,
            "confidence": 0.0,
            "instruments": {},
        }
    left = left[:length]
    right = right[:length]

    left_mag = stft_magnitude(left, n_fft=n_fft, hop_length=hop_length)
    right_mag = stft_magnitude(right, n_fft=n_fft, hop_length=hop_length)
    frame_count = min(left_mag.shape[1], right_mag.shape[1])
    if frame_count <= 0:
        return {
            "status": "empty",
            "pan": 0.0,
            "width": 0.0,
            "correlation": 1.0,
            "confidence": 0.0,
            "instruments": {},
        }

    left_power = np.square(left_mag[:, :frame_count]).astype(np.float32)
    right_power = np.square(right_mag[:, :frame_count]).astype(np.float32)
    freqs = np.fft.rfftfreq(n_fft, d=1.0 / ANALYSIS_SR).astype(np.float32)
    total_left = np.sum(left_power, axis=0)
    total_right = np.sum(right_power, axis=0)
    total_energy = total_left + total_right + 1e-12
    global_pan_curve = smooth_signed_curve((total_right - total_left) / total_energy, sigma=0.78)

    mid = (left + right) * 0.5
    side = (left - right) * 0.5
    mid_rms = float(np.sqrt(np.mean(mid * mid) + 1e-12))
    side_rms = float(np.sqrt(np.mean(side * side) + 1e-12))
    correlation = stereo_correlation(left, right)
    global_width = clamp01(side_rms / max(mid_rms + side_rms, 1e-9))
    global_pan = weighted_average(global_pan_curve, total_energy)
    energy_reference = float(np.percentile(total_energy, 82) + 1e-9)

    instruments: dict[str, Any] = {}
    for instrument in INSTRUMENTS:
        instruments[instrument.id] = estimate_instrument_stereo_image(
            instrument,
            curves[instrument.id],
            left_power,
            right_power,
            freqs,
            frame_count,
            energy_reference,
            global_width,
        )

    confidence = clamp01(
        float(np.mean(np.clip(total_energy / energy_reference, 0, 1))) * 0.64
        + min(abs(global_pan), 0.5) * 0.32
        + global_width * 0.24
    )
    return {
        "status": "stereo",
        "pan": round(float(global_pan), 4),
        "width": round(float(global_width), 4),
        "correlation": round(float(correlation), 4),
        "confidence": round(float(confidence), 4),
        "instruments": instruments,
    }


def estimate_instrument_stereo_image(
    instrument: Instrument,
    curve: np.ndarray,
    left_power: np.ndarray,
    right_power: np.ndarray,
    freqs: np.ndarray,
    frame_count: int,
    energy_reference: float,
    global_width: float,
) -> dict[str, Any]:
    weights = stereo_frequency_weights(freqs, instrument)
    # Contract directly instead of materializing a full weighted spectrogram
    # for every instrument and channel.
    left_band = np.einsum("ij,i->j", left_power, weights, optimize=False)
    right_band = np.einsum("ij,i->j", right_power, weights, optimize=False)
    band_energy = left_band + right_band + 1e-12
    activity = resize_curve(curve, frame_count)
    activity_weight = np.power(np.clip(activity, 0, 1), 1.35)
    frame_weight = band_energy * (0.1 + activity_weight)
    pan_curve = np.clip((right_band - left_band) / band_energy, -1, 1).astype(np.float32)
    pan_curve = smooth_signed_curve(pan_curve, sigma=0.72)
    pan = weighted_average(pan_curve, frame_weight)
    energy_ratio = clamp01(float(np.mean(frame_weight) / max(energy_reference, 1e-9)) * 8.0)
    activity_confidence = clamp01(float(np.percentile(activity, 86)) * 0.68 + float(np.mean(activity > 0.18)) * 0.32)
    confidence = clamp01(activity_confidence * 0.52 + energy_ratio * 0.34 + min(abs(pan), 0.62) * 0.18)
    width = clamp01(global_width * 0.48 + min(abs(pan), 1.0) * 0.34 + energy_ratio * 0.1)

    return {
        "pan": round(float(pan), 4),
        "width": round(float(width), 4),
        "confidence": round(float(confidence), 4),
        "energy": round(float(energy_ratio), 4),
        "panCurve": compress_series(pan_curve.tolist(), 4),
    }


def stereo_frequency_weights(freqs: np.ndarray, instrument: Instrument) -> np.ndarray:
    center = max(float(instrument.freq), 30.0)
    if instrument.id == "piano":
        width = 0.96
    elif instrument.family == "percussion":
        width = 0.74
    elif instrument.id in {"basses", "timpani"}:
        width = 0.78
    elif instrument.family in {"woodwinds", "brass"}:
        width = 0.52
    elif instrument.family == "strings":
        width = 0.58
    else:
        width = 0.68
    safe_freqs = np.maximum(freqs.astype(np.float32), 1.0)
    weights = np.exp(-0.5 * (np.log(safe_freqs / center) / width) ** 2).astype(np.float32)
    weights[freqs < 28] = 0
    total = float(np.sum(weights) + 1e-9)
    return weights / total


def smooth_signed_curve(curve: np.ndarray, sigma: float) -> np.ndarray:
    curve = np.nan_to_num(np.asarray(curve, dtype=np.float32))
    if curve.size < 3:
        return np.clip(curve, -1, 1).astype(np.float32)
    return np.clip(smooth_curve(curve, sigma=sigma), -1, 1).astype(np.float32)


def weighted_average(values: np.ndarray, weights: np.ndarray) -> float:
    values = np.nan_to_num(np.asarray(values, dtype=np.float32))
    weights = np.nan_to_num(np.maximum(np.asarray(weights, dtype=np.float32), 0))
    total = float(np.sum(weights))
    if total <= 1e-12 or values.size == 0:
        return 0.0
    return float(np.sum(values * weights) / total)


def stereo_correlation(left: np.ndarray, right: np.ndarray) -> float:
    length = min(len(left), len(right))
    if length <= 1:
        return 1.0
    left = left[:length] - float(np.mean(left[:length]))
    right = right[:length] - float(np.mean(right[:length]))
    denom = math.sqrt(float(np.sum(left * left) * np.sum(right * right))) + 1e-12
    return clamp_value(float(np.sum(left * right) / denom), -1.0, 1.0)


def suppress_false_harp_from_strings(curves: dict[str, np.ndarray]) -> None:
    string_curve = np.maximum.reduce([curves["violins1"], curves["violins2"], curves["violas"], curves["cellos"]])
    strong_string = np.clip((string_curve - 0.34) / 0.48, 0, 1)
    curves["harp"] *= 1.0 - strong_string * 0.74
    curves["piano"] *= 1.0 - strong_string * 0.34


def suppress_false_strings_from_piano(curves: dict[str, np.ndarray]) -> None:
    piano_curve = curves["piano"]
    piano_protect = np.clip((piano_curve - 0.28) / 0.45, 0, 1)
    for instrument_id in ("violins1", "violins2", "violas", "cellos"):
        curve = curves[instrument_id]
        protect = np.clip(piano_protect * (1.0 - np.clip((curve - piano_curve * 0.82) / 0.34, 0, 1)), 0, 1)
        curves[instrument_id] *= 1.0 - protect * 0.66


def suppress_false_winds_from_strings(curves: dict[str, np.ndarray]) -> None:
    string_curve = np.maximum.reduce([curves["violins1"], curves["violins2"], curves["violas"]])
    protect = np.clip((string_curve - 0.42) / 0.4, 0, 1)
    for instrument_id in ("flute", "oboe", "clarinet"):
        curves[instrument_id] *= 1.0 - protect * 0.42


def suppress_false_brass_from_strings(curves: dict[str, np.ndarray]) -> None:
    string_curve = np.maximum.reduce([curves["violins1"], curves["violins2"], curves["violas"], curves["cellos"]])
    for instrument_id in ("horn", "trumpet", "trombone", "bassoon"):
        curve = curves[instrument_id]
        protect = np.clip((string_curve - curve * 0.55 - 0.22) / 0.42, 0, 1)
        curves[instrument_id] *= 1.0 - protect * 0.72


def suppress_false_percussion_from_piano(curves: dict[str, np.ndarray]) -> None:
    piano_curve = curves["piano"]
    for instrument_id in ("percussion", "timpani"):
        curve = curves[instrument_id]
        protect = np.clip((piano_curve - curve * 0.62 - 0.18) / 0.38, 0, 1)
        curves[instrument_id] *= 1.0 - protect * 0.55


def normalize_activity_curve(curve: np.ndarray, instrument_id: str, scale: float | None = None) -> np.ndarray:
    curve = np.nan_to_num(np.maximum(curve.astype(np.float32), 0))
    if len(curve) > 5:
        sigma = 0.42 if instrument_id in {"piano", "harp", "percussion", "timpani"} else 0.72
        curve = smooth_curve(curve, sigma=sigma)
    peak = float(scale if scale is not None else np.percentile(curve, 97) + 1e-8)
    curve = np.clip(curve / peak, 0, 1.35)
    curve = fast_attack_release(curve, release=0.34 if instrument_id in {"piano", "harp"} else 0.48)
    return np.clip(curve, 0, 1).astype(np.float32)


def smooth_curve(curve: np.ndarray, sigma: float) -> np.ndarray:
    if sigma <= 0 or len(curve) < 3:
        return curve
    radius = max(1, int(math.ceil(sigma * 4)))
    x = np.arange(-radius, radius + 1, dtype=np.float32)
    kernel = np.exp(-0.5 * (x / float(sigma)) ** 2)
    kernel /= np.sum(kernel) + 1e-9
    padded = np.pad(curve, (radius, radius), mode="edge")
    return np.convolve(padded, kernel, mode="valid").astype(np.float32)


def fast_attack_release(curve: np.ndarray, release: float = 0.45) -> np.ndarray:
    if len(curve) == 0:
        return curve
    out = np.zeros_like(curve, dtype=np.float32)
    out[0] = curve[0]
    for index in range(1, len(curve)):
        target = float(curve[index])
        if target >= out[index - 1]:
            out[index] = target
        else:
            out[index] = out[index - 1] * release + target * (1.0 - release)
    return out


def select_active_instruments(curves: dict[str, np.ndarray]) -> list[str]:
    active: list[str] = []
    for instrument in INSTRUMENTS:
        curve = curves[instrument.id]
        p90 = float(np.percentile(curve, 90))
        p75 = float(np.percentile(curve, 75))
        peak = float(np.max(curve))
        mean = float(np.mean(curve))
        if instrument.family == "strings":
            threshold = 0.24
        elif instrument.family in {"woodwinds", "brass"}:
            threshold = 0.22
        else:
            threshold = 0.2
        transient_allowed = instrument.id in {"piano", "harp", "percussion", "timpani"}
        sustained_active = p90 >= threshold or mean >= 0.12
        transient_active = transient_allowed and peak >= 0.4 and p75 >= 0.08
        tonal_peak_active = (not transient_allowed) and peak >= 0.55 and p75 >= 0.16
        if sustained_active or transient_active or tonal_peak_active:
            active.append(instrument.id)
    return active


def build_instrument_payload(
    instrument: Instrument,
    curve: np.ndarray,
    active_ids: list[str],
    stereo: dict[str, Any] | None = None,
) -> dict[str, Any]:
    display_curve = make_display_curve(curve, active=instrument.id in active_ids)
    return {
        "id": instrument.id,
        "label": instrument.label,
        "family": instrument.family,
        "active": instrument.id in active_ids,
        "confidence": round(float(np.percentile(curve, 92)), 4),
        "peak": round(float(np.max(curve)), 4),
        "mean": round(float(np.mean(curve)), 4),
        "position": {"x": instrument.x, "y": instrument.y, "z": instrument.z},
        "filter": {"freq": instrument.freq, "q": instrument.q},
        "color": instrument.color,
        "stereo": stereo or {"pan": 0.0, "width": 0.0, "confidence": 0.0, "energy": 0.0, "panCurve": []},
        "curve": compress_series(curve.tolist(), 4),
        "displayCurve": compress_series(display_curve.tolist(), 4),
    }


def make_display_curve(curve: np.ndarray, *, active: bool) -> np.ndarray:
    curve = np.asarray(curve, dtype=np.float32)
    if curve.size == 0:
        return curve
    peak = float(np.max(curve))
    if peak < (0.045 if active else 0.075):
        return np.zeros_like(curve, dtype=np.float32)
    scale = max(float(np.percentile(curve, 94)), peak * 0.55, 1e-7)
    visual = np.clip(curve / scale, 0, 1)
    visual = np.where(visual < 0.025, 0, visual)
    visual = np.power(visual, 0.72)
    visual = fast_attack_release(visual.astype(np.float32), release=0.5)
    return np.clip(visual, 0, 1).astype(np.float32)


def analyze_mix(
    mono: np.ndarray,
    sample_rate: int,
    rms: np.ndarray,
    centroid: np.ndarray,
    rolloff: np.ndarray,
    flatness: np.ndarray,
    zcr: np.ndarray,
    power: np.ndarray | None = None,
    freqs: np.ndarray | None = None,
    multichannel: np.ndarray | None = None,
) -> dict[str, Any]:
    peak = float(np.max(np.abs(mono)) + 1e-9)
    rms_value = float(np.sqrt(np.mean(np.square(mono)) + 1e-12))
    crest = db(peak) - db(rms_value)
    clipping = float(np.mean(np.abs(mono) > 0.995) * 100)
    channel_data = multichannel if multichannel is not None else mono
    true_peak = estimate_true_peak_8x(channel_data)
    integrated_lufs = integrated_loudness_bs1770(channel_data, sample_rate)
    return {
        "peakDb": round(db(peak), 2),
        "estimatedTruePeakDb": round(db(true_peak), 2),
        "truePeakOversampling": 8,
        "rmsDb": round(db(rms_value), 2),
        "integratedLufs": round(integrated_lufs, 2),
        "approxLufs": round(integrated_lufs, 2),
        "loudnessStandard": "ITU-R BS.1770-5 gated",
        "crestDb": round(crest, 2),
        "clippingPercent": round(clipping, 4),
        "centroidHz": round(float(np.mean(centroid)), 1),
        "rolloffHz": round(float(np.mean(rolloff)), 1),
        "flatness": round(float(np.mean(flatness)), 4),
        "zcr": round(float(np.mean(zcr)), 4),
        "sampleRate": int(sample_rate),
        "spectralBalance": build_mix_spectral_balance(power, freqs),
    }


def build_mix_spectral_balance(power: np.ndarray | None, freqs: np.ndarray | None) -> dict[str, float]:
    if power is None or freqs is None or power.size == 0 or freqs.size == 0:
        return {
            "sub": 0.0,
            "bass": 0.0,
            "lowMid": 0.0,
            "coreMid": 0.0,
            "upperMid": 0.0,
            "mid": 0.0,
            "presence": 0.0,
            "air": 0.0,
            "low": 0.0,
            "body": 0.0,
            "lowToBody": 0.0,
            "bodyToHigh": 0.0,
            "midToPresence": 0.0,
            "fullRange": 0.0,
        }
    amplitude = np.sqrt(np.maximum(power, 0))
    full_mask = (freqs >= 20) & (freqs <= min(20000, float(freqs[-1])))
    frame_energy = np.sum(amplitude[full_mask], axis=0) + 1e-9
    energy_reference = float(np.percentile(frame_energy, 78) + 1e-9)
    frame_weights = np.clip(frame_energy / energy_reference, 0.18, 1.0)
    frame_normalized = amplitude / frame_energy[None, :]
    spectrum = np.average(frame_normalized, axis=1, weights=frame_weights)
    full_range = float(np.sum(spectrum[full_mask]) + 1e-9)

    def share(low: float, high: float) -> float:
        mask = (freqs >= low) & (freqs < high)
        if not np.any(mask):
            return 0.0
        return float(np.sum(spectrum[mask]) / full_range)

    sub = share(20, 60)
    bass = share(60, 180)
    low_mid = share(180, 500)
    core_mid = share(500, 1200)
    upper_mid = share(1200, 2400)
    mid = core_mid + upper_mid
    presence = share(2400, 6000)
    air = share(6000, 20000)
    low = sub + bass
    body = low_mid + mid
    low_to_body = low / max(body, 1e-9)
    body_to_high = body / max(presence + air, 1e-9)
    return {
        "sub": round(sub, 5),
        "bass": round(bass, 5),
        "lowMid": round(low_mid, 5),
        "coreMid": round(core_mid, 5),
        "upperMid": round(upper_mid, 5),
        "mid": round(mid, 5),
        "presence": round(presence, 5),
        "air": round(air, 5),
        "low": round(low, 5),
        "body": round(body, 5),
        "lowToBody": round(low_to_body, 5),
        "bodyToHigh": round(body_to_high, 5),
        "midToPresence": round(body_to_high, 5),
        "fullRange": round(float(np.sum(spectrum[full_mask]) / full_range), 5),
    }


def estimate_key(chroma: np.ndarray) -> dict[str, Any]:
    if chroma.size == 0:
        return {"label": "--", "confidence": 0}
    profile = np.mean(chroma, axis=1)
    if float(np.sum(profile)) <= 0:
        return {"label": "--", "confidence": 0}
    major = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
    minor = np.array([6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
    profile = (profile - profile.mean()) / (profile.std() + 1e-9)
    names = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
    scores = []
    for index in range(12):
        scores.append((float(np.dot(profile, np.roll(major, index))), f"{names[index]} major"))
        scores.append((float(np.dot(profile, np.roll(minor, index))), f"{names[index]} minor"))
    scores.sort(reverse=True)
    confidence = clamp01((scores[0][0] - scores[1][0]) / (abs(scores[0][0]) + 1e-9))
    return {"label": scores[0][1], "confidence": round(confidence, 3)}


def build_sections(
    times: np.ndarray,
    rms: np.ndarray,
    centroid: np.ndarray,
    onset_env: np.ndarray,
    curves: dict[str, np.ndarray],
    duration: float,
) -> list[dict[str, Any]]:
    count = 8
    sections: list[dict[str, Any]] = []
    length = len(times)
    if length == 0:
        return sections

    for index in range(count):
        start_ratio = index / count
        end_ratio = (index + 1) / count
        lo = int(start_ratio * length)
        hi = max(lo + 1, int(end_ratio * length))
        window = slice(lo, min(hi, length))
        local_scores = {
            instrument_id: float(np.mean(curve[window])) for instrument_id, curve in curves.items()
        }
        leaders = sorted(local_scores.items(), key=lambda item: item[1], reverse=True)[:4]
        sections.append(
            {
                "index": index + 1,
                "start": round(duration * start_ratio, 3),
                "end": round(duration * end_ratio, 3),
                "energy": round(float(np.mean(normalize_curve(rms)[window])), 4),
                "brightness": round(float(np.mean(normalize_curve(centroid)[window])), 4),
                "density": round(float(np.mean(normalize_curve(onset_env)[window])), 4),
                "leaders": [{"id": key, "value": round(value, 4)} for key, value in leaders if value > 0.06],
            }
        )
    return sections


def build_clean_recommendations(
    active_ids: list[str],
    mix: dict[str, Any],
    demucs: dict[str, Any],
) -> list[str]:
    items: list[str] = []
    if "piano" in active_ids:
        items.append("피아노가 감지되어 빠른 어택과 넓은 잔향이 과장되지 않도록 릴리즈와 저중역을 보정합니다.")
    if any(item in active_ids for item in ("violins1", "violins2", "violas", "cellos")):
        items.append("현악군은 스타카토와 지속 보잉을 분리해 하프/피아노 오탐을 억제합니다.")
    if mix["peakDb"] > -0.5:
        items.append("원본 피크가 높으므로 재설계 단계에서 클리핑 여유를 별도로 확인하는 편이 좋습니다.")
    if demucs.get("cached"):
        items.append("이 곡은 Demucs stem 캐시를 재사용해 분석 시간을 줄였습니다.")
    elif not demucs["available"]:
        items.append("Demucs를 설치하면 실제 딥러닝 stem 분리 결과를 공간 렌더링에 사용할 수 있습니다.")
    return items[:4]


def make_waveform_preview(samples: np.ndarray, points: int) -> list[float]:
    samples = np.asarray(samples, dtype=np.float32)
    if samples.size == 0:
        return []
    frame = max(1, samples.size // points)
    usable = samples[: frame * points]
    if usable.size < frame:
        return [0.0]
    view = usable.reshape(points, frame)
    peaks = np.max(np.abs(view), axis=1)
    return compress_series(normalize_curve(peaks).tolist(), 4)
