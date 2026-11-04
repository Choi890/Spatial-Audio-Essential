"""Source-separation execution, quality gates and stem-cache ownership."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import logging
import math
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
from functools import lru_cache
from pathlib import Path
from typing import Any
import numpy as np
import soundfile as sf


def read_int_env(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.environ.get(name, default))
    except (TypeError, ValueError):
        value = default
    return int(np.clip(value, minimum, maximum))


def read_float_env(name: str, default: float, minimum: float, maximum: float) -> float:
    try:
        value = float(os.environ.get(name, default))
    except (TypeError, ValueError):
        value = default
    return float(np.clip(value, minimum, maximum))


DEMUCS_CACHE_MAX_BYTES = 12 * 1024 * 1024 * 1024


DEMUCS_CACHE_MAX_AGE_DAYS = 30


DEMUCS_CACHE_PRUNE_INTERVAL_SECONDS = 6 * 60 * 60


DEMUCS_QUALITY_PROFILE = "spatial-q3-adaptive6-batched-fp32"


DEMUCS_POSTPROCESS_VERSION = "softmask-v2-hybrid"


DEMUCS_CACHE_LAYOUT_VERSION = "content-v3"


DEMUCS_AUXILIARY_MODEL = "htdemucs_6s"


DEMUCS_SHIFTS = read_int_env("SPATIAL_DEMUCS_SHIFTS", 2, 1, 10)


DEMUCS_OVERLAP = read_float_env("SPATIAL_DEMUCS_OVERLAP", 0.36, 0.1, 0.75)


DEMUCS_SEGMENT_SECONDS = read_int_env("SPATIAL_DEMUCS_SEGMENT", 7, 4, 7)


DEMUCS_JOBS = read_int_env("SPATIAL_DEMUCS_JOBS", 1, 1, max(1, min(4, os.cpu_count() or 1)))


DEMUCS_GPU_BATCH_SIZE = read_int_env("SPATIAL_DEMUCS_GPU_BATCH_SIZE", 4, 1, 8)


DEMUCS_CORE_STEM_IDS = frozenset({"vocals", "other", "drums", "bass"})


DEMUCS_OPTIONAL_STEM_IDS = frozenset({"guitar", "piano"})


DEMUCS_STEM_IDS = DEMUCS_CORE_STEM_IDS | DEMUCS_OPTIONAL_STEM_IDS


STEM_MASK_FLOORS = {
    "vocals": 0.16,
    "other": 0.22,
    "drums": 0.18,
    "bass": 0.26,
    "guitar": 0.2,
    "piano": 0.24,
}


LOGGER = logging.getLogger("spatial_audio.engine")


_DEMUCS_CACHE_PRUNE_LOCK = threading.Lock()


_demucs_cache_last_prune = 0.0


class AnalysisCancelledError(RuntimeError):
    """Raised when the caller cancels CPU/GPU analysis work."""


def raise_if_cancelled(cancel_event: threading.Event | None) -> None:
    if cancel_event is not None and cancel_event.is_set():
        raise AnalysisCancelledError("Audio analysis was cancelled")


def inspect_demucs(
    requested: bool,
    input_path: Path,
    output_dir: Path,
    job_id: str,
    *,
    cache_key: str | None = None,
    model: str = "htdemucs_ft",
    cancel_event: threading.Event | None = None,
) -> dict[str, Any]:
    # Demucs stem 분리는 선택 기능이다.
    # 설치되어 있지 않거나 실패해도 전체 분석 앱이 멈추지 않도록 상태, 사유, 캐시 여부만 payload에 담아 반환한다.
    allowed_models = {
        "htdemucs_ft": "Hybrid Transformer Demucs fine-tuned",
        "htdemucs": "Hybrid Transformer Demucs",
    }
    model_name = model if model in allowed_models else "htdemucs_ft"
    module_found = importlib.util.find_spec("demucs") is not None
    command_found = shutil.which("demucs") is not None
    available = module_found or command_found
    device = detect_demucs_device()
    settings = {
        "profile": DEMUCS_QUALITY_PROFILE,
        "postprocess": DEMUCS_POSTPROCESS_VERSION,
        "device": device,
        "shifts": DEMUCS_SHIFTS,
        "overlap": round(DEMUCS_OVERLAP, 3),
        "segment": DEMUCS_SEGMENT_SECONDS,
        "jobs": DEMUCS_JOBS,
        "gpuBatchSize": DEMUCS_GPU_BATCH_SIZE if device == "cuda" else 1,
        "precision": "float32",
        "intermediateFormat": "pcm24",
    }
    payload: dict[str, Any] = {
        "name": f"Demucs / {allowed_models[model_name]} + adaptive 6-stem",
        "model": model_name,
        "auxiliaryModel": DEMUCS_AUXILIARY_MODEL,
        "qualityProfile": DEMUCS_QUALITY_PROFILE,
        "postprocess": DEMUCS_POSTPROCESS_VERSION,
        "settings": settings,
        "available": available,
        "requested": requested,
        "status": "ready" if available else "not-installed",
        "cached": False,
        "stems": [],
        "stemQuality": {},
        "hybridStemProfile": {"accepted": [], "rejected": [], "candidates": {}},
    }
    if not requested:
        return payload
    raise_if_cancelled(cancel_event)

    cache_id = build_demucs_cache_id(cache_key, model_name)
    cache_root = output_dir / "_cache" / "demucs"
    stem_root = cache_root / cache_id if cache_id else output_dir / job_id / "demucs"
    maybe_prune_demucs_cache(cache_root, keep=stem_root if cache_id else None)
    final_root = stem_root / "final"
    cached_stems = collect_demucs_stem_paths(final_root)
    cached_ids = {get_stem_id_from_path(path) for path in cached_stems}
    if DEMUCS_CORE_STEM_IDS.issubset(cached_ids) and cached_demucs_stems_match_source(
        cached_stems,
        input_path,
    ):
        touch_cache_entry(stem_root)
        payload["status"] = "completed"
        payload["cached"] = True
        payload["stems"] = [str(path.relative_to(output_dir)).replace("\\", "/") for path in cached_stems]
        payload["stemQuality"] = read_stem_quality(final_root)
        payload["hybridStemProfile"] = read_hybrid_stem_profile(final_root)
        return payload
    if cached_stems:
        # 불완전하거나 다른 곡에서 남은 캐시는 재생 단계로 넘기지 않고 다시 생성한다.
        LOGGER.warning("Discarding invalid Demucs cache entry: %s", stem_root)
        shutil.rmtree(stem_root, ignore_errors=True)
    if not available:
        return payload

    stem_root.mkdir(parents=True, exist_ok=True)
    primary_root = stem_root / "primary"
    auxiliary_root = stem_root / "adaptive6"
    separation_started = time.perf_counter()
    try:
        primary_started = time.perf_counter()
        run_demucs_model(
            input_path,
            primary_root,
            model_name,
            device,
            cancel_event=cancel_event,
            auxiliary_output_root=auxiliary_root if device == "cuda" else None,
        )
        primary_seconds = time.perf_counter() - primary_started
        raise_if_cancelled(cancel_event)
        primary_stems = collect_demucs_stem_paths(primary_root)
        primary_ids = {get_stem_id_from_path(path) for path in primary_stems}
        if not DEMUCS_CORE_STEM_IDS.issubset(primary_ids):
            raise RuntimeError("The primary Demucs model returned an incomplete core stem set.")

        auxiliary_stems: list[Path] = []
        auxiliary_reason = ""
        auxiliary_started = time.perf_counter()
        worker_timing: dict[str, Any] = {}
        try:
            if device == "cuda":
                worker_timing = json.loads((primary_root / "worker-timing.json").read_text(encoding="utf-8"))
                primary_seconds = float(worker_timing["primarySeconds"])
                auxiliary_reason = str(worker_timing.get("auxiliaryReason", ""))
            else:
                run_demucs_model(
                    input_path,
                    auxiliary_root,
                    DEMUCS_AUXILIARY_MODEL,
                    device,
                    cancel_event=cancel_event,
                )
            auxiliary_stems = collect_demucs_stem_paths(auxiliary_root)
        except AnalysisCancelledError:
            raise
        except Exception as exc:
            auxiliary_reason = str(exc).strip()[-400:]
            LOGGER.warning("Adaptive 6-stem pass failed; keeping the core set: %s", auxiliary_reason)
        auxiliary_seconds = (float(worker_timing.get("auxiliarySeconds", 0)) if device == "cuda"
                             else time.perf_counter() - auxiliary_started)

        postprocess_started = time.perf_counter()
        stems, hybrid_profile = build_adaptive_hybrid_stems(
            primary_stems,
            auxiliary_stems,
            final_root,
            enhance=True,
        )
        if auxiliary_reason:
            hybrid_profile["fallbackReason"] = auxiliary_reason
        stem_quality = read_stem_quality(final_root)
        for stem_id, candidate in hybrid_profile.get("candidates", {}).items():
            if stem_id in stem_quality:
                stem_quality[stem_id].update({
                    "hybridConfidence": candidate.get("confidence", 0),
                    "sourceModel": DEMUCS_AUXILIARY_MODEL,
                    "adaptivelyAccepted": True,
                })
        write_stem_quality(final_root, stem_quality)
        write_hybrid_stem_profile(final_root, hybrid_profile)
        postprocess_seconds = time.perf_counter() - postprocess_started
        # 최종 Stem과 품질 메타데이터만 캐시해 이중 모델의 임시 출력을 남기지 않는다.
        shutil.rmtree(primary_root, ignore_errors=True)
        shutil.rmtree(auxiliary_root, ignore_errors=True)
        raise_if_cancelled(cancel_event)
        payload["status"] = "completed"
        payload["cached"] = False
        payload["stems"] = [str(path.relative_to(output_dir)).replace("\\", "/") for path in stems]
        payload["stemQuality"] = stem_quality
        payload["hybridStemProfile"] = hybrid_profile
        payload["timing"] = {
            "primarySeconds": round(primary_seconds, 2),
            "auxiliarySeconds": round(auxiliary_seconds, 2),
            "postprocessSeconds": round(postprocess_seconds, 2),
            "totalSeconds": round(time.perf_counter() - separation_started, 2),
        }
        if cache_id:
            touch_cache_entry(stem_root)
            maybe_prune_demucs_cache(cache_root, keep=stem_root, force=True)
    except AnalysisCancelledError:
        shutil.rmtree(stem_root, ignore_errors=True)
        raise
    except subprocess.CalledProcessError as exc:  # Demucs failures should not break the analysis app.
        payload["status"] = "failed"
        LOGGER.warning(
            "Demucs process failed for job_id=%s returncode=%s stderr=%s",
            job_id,
            exc.returncode,
            (exc.stderr or "").strip()[-1200:],
        )
        payload["reason"] = "Demucs stem 분리를 완료하지 못해 full-mix fallback으로 전환했습니다."
    except Exception:  # Demucs 실패가 분석 화면 전체를 중단시키지 않도록 원본 기반 결과로 복구한다.
        payload["status"] = "failed"
        LOGGER.exception("Demucs execution failed for job_id=%s", job_id)
        payload["reason"] = "Demucs stem 분리를 완료하지 못해 full-mix fallback으로 전환했습니다."
    return payload


def build_demucs_cache_id(cache_key: str | None, model_name: str) -> str:
    """곡 식별자가 잘리지 않는 충돌 방지형 Demucs 캐시 키를 만든다."""
    if not cache_key:
        return ""
    identity = json.dumps([
        DEMUCS_CACHE_LAYOUT_VERSION, cache_key, model_name, DEMUCS_QUALITY_PROFILE,
        DEMUCS_POSTPROCESS_VERSION, DEMUCS_AUXILIARY_MODEL,
        DEMUCS_SHIFTS, DEMUCS_OVERLAP, DEMUCS_SEGMENT_SECONDS,
    ], ensure_ascii=True, separators=(",", ":"))
    return f"{DEMUCS_CACHE_LAYOUT_VERSION}_{hashlib.sha256(identity.encode('utf-8')).hexdigest()}"


def cached_demucs_stems_match_source(stem_paths: list[Path], input_path: Path) -> bool:
    """캐시 Stem의 기본 포맷과 길이가 현재 원본에 맞는지 빠르게 검증한다."""
    try:
        source = sf.info(str(input_path))
        if source.frames <= 0 or source.samplerate <= 0:
            return False
        duration_tolerance = max(0.08, source.duration * 0.002)
        stem_sample_rate: int | None = None
        for path in stem_paths:
            info = sf.info(str(path))
            if not 1 <= info.channels <= 2 or not 8_000 <= info.samplerate <= 192_000:
                return False
            if stem_sample_rate is None:
                stem_sample_rate = info.samplerate
            elif info.samplerate != stem_sample_rate:
                return False
            if info.frames <= 0 or abs(info.duration - source.duration) > duration_tolerance:
                return False
    except (OSError, RuntimeError, ValueError):
        return False
    return True


def run_cancellable_command(
    command: list[str],
    *,
    cancel_event: threading.Event | None,
    timeout_seconds: float,
) -> subprocess.CompletedProcess[str]:
    """Run a subprocess while honoring cancellation without leaving a GPU worker behind."""
    creation_flags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        creationflags=creation_flags,
        start_new_session=os.name != "nt",
    )
    started_at = time.monotonic()
    stdout = ""
    stderr = ""
    try:
        while True:
            try:
                stdout, stderr = process.communicate(timeout=0.25)
                break
            except subprocess.TimeoutExpired:
                if cancel_event is not None and cancel_event.is_set():
                    terminate_process(process)
                    raise AnalysisCancelledError("Subprocess analysis was cancelled")
                if time.monotonic() - started_at >= timeout_seconds:
                    terminate_process(process)
                    raise subprocess.TimeoutExpired(command, timeout_seconds)
        if process.returncode:
            raise subprocess.CalledProcessError(process.returncode, command, output=stdout, stderr=stderr)
        return subprocess.CompletedProcess(command, process.returncode, stdout, stderr)
    finally:
        if process.poll() is None:
            terminate_process(process)


def terminate_process(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    try:
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                check=False,
                capture_output=True,
                timeout=5,
            )
        else:
            os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=4)
        return
    except (OSError, subprocess.TimeoutExpired):
        pass
    try:
        if os.name != "nt":
            os.killpg(process.pid, signal.SIGKILL)
        else:
            process.kill()
        process.wait(timeout=2)
    except (OSError, subprocess.TimeoutExpired):
        pass


def run_demucs_model(
    input_path: Path,
    output_root: Path,
    model_name: str,
    device: str,
    *,
    cancel_event: threading.Event | None,
    auxiliary_output_root: Path | None = None,
) -> None:
    command = [
        sys.executable,
        "-m",
        "backend.demucs_worker" if device == "cuda" else "demucs.separate",
        "-n",
        model_name,
        "--device",
        device,
        "--shifts",
        str(DEMUCS_SHIFTS),
        "--overlap",
        f"{DEMUCS_OVERLAP:.3f}",
        "--segment",
        str(DEMUCS_SEGMENT_SECONDS),
        "-j",
        str(DEMUCS_JOBS),
        # 최종 출력도 PCM 24-bit이므로, 대용량 중간 float WAV를 만들 필요가 없다.
        "--int24",
        "--clip-mode",
        "rescale",
        "--out",
        str(output_root),
        str(input_path),
    ]
    if device == "cuda":
        command.extend(["--batch-size", str(DEMUCS_GPU_BATCH_SIZE)])
        if auxiliary_output_root is not None:
            command.extend(["--auxiliary-out", str(auxiliary_output_root),
                            "--auxiliary-model", DEMUCS_AUXILIARY_MODEL])
    run_cancellable_command(command, cancel_event=cancel_event, timeout_seconds=900)


def collect_demucs_stem_paths(root: Path) -> list[Path]:
    by_id: dict[str, Path] = {}
    if not root.exists():
        return []
    for path in sorted(root.rglob("*.wav")):
        stem_id = get_stem_id_from_path(path)
        if stem_id in DEMUCS_STEM_IDS and stem_id not in by_id:
            by_id[stem_id] = path
    order = ["vocals", "guitar", "piano", "other", "drums", "bass"]
    return [by_id[stem_id] for stem_id in order if stem_id in by_id]


def _read_stem_audio(path: Path) -> tuple[np.ndarray, int]:
    data, sample_rate = sf.read(str(path), always_2d=True, dtype="float32")
    data = np.nan_to_num(data.astype(np.float32, copy=False))
    if data.size == 0:
        raise ValueError(f"Empty stem: {path.name}")
    return data, int(sample_rate)


def _decimated_mono(data: np.ndarray, limit: int = 180_000) -> np.ndarray:
    mono = np.mean(data, axis=1, dtype=np.float32)
    stride = max(1, int(np.ceil(len(mono) / max(1, limit))))
    return mono[::stride].astype(np.float64, copy=False)


def _normalized_correlation(left: np.ndarray, right: np.ndarray) -> float:
    length = min(len(left), len(right))
    if length <= 8:
        return 0.0
    x = left[:length]
    y = right[:length]
    denominator = float(np.sqrt(np.dot(x, x) * np.dot(y, y)) + 1e-18)
    return float(np.clip(np.dot(x, y) / denominator, -1, 1))


def evaluate_adaptive_stem_candidate(
    stem_id: str,
    candidate: np.ndarray,
    primary_other: np.ndarray,
    core_stems: dict[str, np.ndarray],
) -> tuple[dict[str, Any], np.ndarray]:
    candidate_mono = _decimated_mono(candidate)
    other_mono = _decimated_mono(primary_other)
    length = min(len(candidate_mono), len(other_mono))
    candidate_mono = candidate_mono[:length]
    other_mono = other_mono[:length]
    candidate_power = float(np.dot(candidate_mono, candidate_mono)) + 1e-18
    raw_projection = float(np.dot(other_mono, candidate_mono) / candidate_power)
    projection = float(np.clip(raw_projection, 0, 1.25))
    scaled = candidate * np.float32(projection)
    other_rms = rms_float(primary_other)
    candidate_rms = rms_float(scaled)
    ratio_db = linear_to_db(candidate_rms / (other_rms + 1e-9))

    scaled_mono = candidate_mono * projection
    remaining = other_mono - scaled_mono
    explained = float(np.clip(
        1 - (np.dot(remaining, remaining) / (np.dot(other_mono, other_mono) + 1e-18)),
        0,
        1,
    ))
    leakage = 0.0
    for core in core_stems.values():
        leakage = max(leakage, abs(_normalized_correlation(candidate_mono, _decimated_mono(core))))

    projection_score = float(np.clip(1 - abs(raw_projection - 1) / 0.8, 0, 1))
    energy_score = float(
        np.clip((ratio_db + 34) / 18, 0, 1) * np.clip((-1 - ratio_db) / 6, 0, 1)
    )
    isolation_score = 1 - leakage
    explained_score = float(np.clip(explained / 0.18, 0, 1))
    confidence = float(np.clip(
        projection_score * 0.32
        + isolation_score * 0.28
        + energy_score * 0.24
        + explained_score * 0.16,
        0,
        1,
    ))
    threshold = 0.62 if stem_id == "piano" else 0.54
    accepted = bool(
        0.35 <= raw_projection <= 1.25
        and -34 <= ratio_db <= -1.5
        and leakage < 0.72
        and explained > 0.002
        and confidence >= threshold
    )
    metrics = {
        "accepted": accepted,
        "confidence": round(confidence, 4),
        "threshold": threshold,
        "projection": round(projection, 4),
        "energyRatioDb": round(ratio_db, 2),
        "coreLeakage": round(leakage, 4),
        "explainedEnergy": round(explained, 4),
    }
    return metrics, scaled


def build_adaptive_hybrid_stems(
    primary_paths: list[Path],
    auxiliary_paths: list[Path],
    final_root: Path,
    *,
    enhance: bool = False,
) -> tuple[list[Path], dict[str, Any]]:
    primary_by_id = {get_stem_id_from_path(path): path for path in primary_paths}
    if not DEMUCS_CORE_STEM_IDS.issubset(primary_by_id):
        raise ValueError("Primary Demucs stems are incomplete")

    if final_root.exists():
        shutil.rmtree(final_root)
    final_root.mkdir(parents=True, exist_ok=True)
    primary_audio = {stem_id: _read_stem_audio(primary_by_id[stem_id]) for stem_id in DEMUCS_CORE_STEM_IDS}
    sample_rates = {sample_rate for _, sample_rate in primary_audio.values()}
    shapes = {data.shape for data, _ in primary_audio.values()}
    if len(sample_rates) != 1 or len(shapes) != 1:
        raise ValueError("Primary Demucs stems do not share one sample grid")
    sample_rate = next(iter(sample_rates))
    primary_other = primary_audio["other"][0]
    core_for_leakage = {
        stem_id: primary_audio[stem_id][0]
        for stem_id in ("vocals", "drums", "bass")
    }

    auxiliary_by_id = {get_stem_id_from_path(path): path for path in auxiliary_paths}
    profile: dict[str, Any] = {
        "mode": "adaptive-4-plus-6",
        "primaryModel": "quality-core",
        "auxiliaryModel": DEMUCS_AUXILIARY_MODEL,
        "accepted": [],
        "rejected": [],
        "candidates": {},
    }
    accepted_audio: dict[str, np.ndarray] = {}
    for stem_id in ("guitar", "piano"):
        path = auxiliary_by_id.get(stem_id)
        if path is None:
            profile["rejected"].append(stem_id)
            profile["candidates"][stem_id] = {"accepted": False, "reason": "missing"}
            continue
        try:
            candidate, candidate_sr = _read_stem_audio(path)
        except Exception:
            profile["rejected"].append(stem_id)
            profile["candidates"][stem_id] = {"accepted": False, "reason": "decode-failed"}
            continue
        if candidate_sr != sample_rate or candidate.shape != primary_other.shape:
            profile["rejected"].append(stem_id)
            profile["candidates"][stem_id] = {"accepted": False, "reason": "sample-grid-mismatch"}
            continue
        metrics, scaled = evaluate_adaptive_stem_candidate(
            stem_id,
            candidate,
            primary_other,
            core_for_leakage,
        )
        if metrics["accepted"] and accepted_audio:
            cross_leakage = max(
                abs(_normalized_correlation(_decimated_mono(scaled), _decimated_mono(existing)))
                for existing in accepted_audio.values()
            )
            metrics["crossCandidateLeakage"] = round(cross_leakage, 4)
            if cross_leakage >= 0.72:
                metrics["accepted"] = False
                metrics["reason"] = "candidate-overlap"
        profile["candidates"][stem_id] = metrics
        if metrics["accepted"]:
            accepted_audio[stem_id] = scaled
            profile["accepted"].append(stem_id)
        else:
            profile["rejected"].append(stem_id)

    remaining_other = primary_other.copy() if accepted_audio else primary_other
    for data in accepted_audio.values():
        remaining_other -= data

    final_audio = {
        "vocals": primary_audio["vocals"][0],
        **accepted_audio,
        "other": remaining_other,
        "drums": primary_audio["drums"][0],
        "bass": primary_audio["bass"][0],
    }
    if enhance:
        paths = [final_root / f"{stem_id}.wav" for stem_id in final_audio]
        enhance_demucs_stems(paths, final_root, audio=final_audio, sample_rate=sample_rate)
    else:
        for stem_id, data in final_audio.items():
            sf.write(str(final_root / f"{stem_id}.wav"), data, sample_rate, subtype="PCM_24")
    return collect_demucs_stem_paths(final_root), profile


def read_json_dict(path: Path, default: dict[str, Any] | None = None) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else (default or {})
    except (OSError, json.JSONDecodeError):
        return default or {}


def write_json_dict(path: Path, payload: dict[str, Any]) -> None:
    try:
        path.write_text(json.dumps(payload, ensure_ascii=True, indent=2, sort_keys=True), encoding="utf-8")
    except OSError:
        pass


def read_hybrid_stem_profile(stem_root: Path) -> dict[str, Any]:
    path = stem_root / "hybrid_stem_profile.json"
    return read_json_dict(path, {"accepted": [], "rejected": [], "candidates": {}})


def write_hybrid_stem_profile(stem_root: Path, profile: dict[str, Any]) -> None:
    write_json_dict(stem_root / "hybrid_stem_profile.json", profile)


@lru_cache(maxsize=1)
def detect_demucs_device() -> str:
    try:
        import torch

        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:
        return "cpu"


def read_stem_quality(stem_root: Path) -> dict[str, Any]:
    return {str(key): value for key, value in read_json_dict(stem_root / "stem_quality.json").items()
            if key in DEMUCS_STEM_IDS and isinstance(value, dict)}


def write_stem_quality(stem_root: Path, quality: dict[str, Any]) -> None:
    write_json_dict(stem_root / "stem_quality.json", quality)


def enhance_demucs_stems(stem_paths: list[Path], stem_root: Path, *,
                         audio: dict[str, np.ndarray] | None = None,
                         sample_rate: int | None = None) -> dict[str, Any]:
    loaded: list[dict[str, Any]] = []
    for path in stem_paths:
        stem_id = get_stem_id_from_path(path)
        if stem_id not in DEMUCS_STEM_IDS:
            continue
        try:
            if audio is not None:
                data, item_sample_rate = audio[stem_id], sample_rate
            else:
                data, item_sample_rate = sf.read(str(path), always_2d=True, dtype="float32")
        except Exception:
            continue
        if data.size == 0:
            continue
        loaded.append({
            "id": stem_id,
            "path": path,
            "data": np.nan_to_num(data.astype(np.float32, copy=False)),
            "sample_rate": int(item_sample_rate),
        })

    loaded_ids = {item["id"] for item in loaded}
    if not DEMUCS_CORE_STEM_IDS.issubset(loaded_ids):
        return {}

    reference_sr = loaded[0]["sample_rate"]
    if any(item["sample_rate"] != reference_sr for item in loaded):
        return {}

    frame_size = int(np.clip(round(reference_sr * 0.046), 1024, 4096))
    hop = max(256, frame_size // 2)
    curves = []
    for item in loaded:
        mono = np.mean(item["data"], axis=1)
        curves.append(stem_frame_rms(mono, frame_size, hop))
    common_frames = min((len(curve) for curve in curves), default=0)
    if common_frames <= 1:
        return {}

    matrix = np.vstack([curve[:common_frames] for curve in curves]).astype(np.float32)
    max_curve = np.max(matrix, axis=0) + 1e-8
    total_curve = np.sum(matrix, axis=0) + 1e-8
    quality: dict[str, Any] = {}

    for index, item in enumerate(loaded):
        stem_id = item["id"]
        data = item["data"]
        curve = matrix[index]
        before_rms = rms_float(data)
        dominance = np.clip(curve / max_curve, 0, 1)
        share = np.clip(curve / total_curve, 0, 1)
        activity_ref = float(np.percentile(curve, 92) + 1e-8)
        activity = np.clip(curve / activity_ref, 0, 1.4)
        floor = STEM_MASK_FLOORS.get(stem_id, 0.2)
        clarity = (
            np.clip((dominance - 0.18) / 0.76, 0, 1) * 0.72
            + np.clip((share - 0.08) / 0.5, 0, 1) * 0.28
        )
        activity_gate = 0.48 + 0.52 * np.clip(activity * 1.18, 0, 1)
        target_mask = np.clip((floor + (1.0 - floor) * clarity) * activity_gate, 0.06, 1.0)
        smooth_mask = smooth_envelope(target_mask, attack=0.34, release=0.18)
        sample_mask = resample_mask(smooth_mask, len(data), hop)
        enhanced = data * sample_mask[:, None]
        enhanced = remove_dc_and_apply_fade(enhanced, reference_sr)
        peak = float(np.max(np.abs(enhanced)) + 1e-9)
        if peak > 0.995:
            enhanced *= np.float32(0.995 / peak)
        try:
            sf.write(str(item["path"]), enhanced, reference_sr, subtype="PCM_24")
        except Exception:
            if audio is not None:
                raise
            enhanced = data

        after_rms = rms_float(enhanced)
        mask_mean = float(np.mean(smooth_mask))
        dominance_mean = float(np.mean(dominance))
        retention = float(after_rms / (before_rms + 1e-9))
        separation = float(np.clip(mask_mean * 0.56 + dominance_mean * 0.44, 0, 1))
        spatial_weight = float(np.clip(0.72 + separation * 0.34 + min(0.2, retention) * 0.1, 0.62, 1.08))
        quality[stem_id] = {
            "rmsDb": round(linear_to_db(after_rms), 2),
            "peakDb": round(linear_to_db(float(np.max(np.abs(enhanced)) + 1e-9)), 2),
            "activity": round(float(np.mean(activity > 0.08)), 4),
            "dominance": round(dominance_mean, 4),
            "separation": round(separation, 4),
            "retention": round(float(np.clip(retention, 0, 1.5)), 4),
            "spatialWeight": round(spatial_weight, 4),
        }

    write_stem_quality(stem_root, quality)
    return quality


def get_stem_id_from_path(path: Path) -> str:
    return path.stem.lower()


def stem_frame_rms(samples: np.ndarray, frame_size: int, hop: int) -> np.ndarray:
    samples = np.asarray(samples, dtype=np.float32)
    if samples.size == 0:
        return np.zeros(1, dtype=np.float32)
    padded = np.pad(samples, (frame_size // 2, frame_size // 2), mode="constant")
    frame_count = max(1, 1 + (len(padded) - frame_size) // hop)
    values = np.zeros(frame_count, dtype=np.float32)
    for index in range(frame_count):
        frame = padded[index * hop : index * hop + frame_size]
        values[index] = float(np.sqrt(np.mean(frame * frame) + 1e-12))
    return values


def smooth_envelope(values: np.ndarray, *, attack: float, release: float) -> np.ndarray:
    values = np.asarray(values, dtype=np.float32)
    if values.size == 0:
        return values
    output = np.zeros_like(values)
    output[0] = values[0]
    for index in range(1, len(values)):
        coeff = attack if values[index] >= output[index - 1] else release
        output[index] = output[index - 1] * (1.0 - coeff) + values[index] * coeff
    return np.clip(output, 0, 1)


def resample_mask(mask: np.ndarray, sample_count: int, hop: int) -> np.ndarray:
    if sample_count <= 0:
        return np.zeros(0, dtype=np.float32)
    if mask.size <= 1:
        value = float(mask[0]) if mask.size else 1.0
        return np.full(sample_count, value, dtype=np.float32)
    x_old = np.arange(mask.size, dtype=np.float32) * hop
    x_new = np.arange(sample_count, dtype=np.float32)
    return np.interp(x_new, x_old, mask, left=mask[0], right=mask[-1]).astype(np.float32)


def remove_dc_and_apply_fade(data: np.ndarray, sample_rate: int) -> np.ndarray:
    output = np.asarray(data, dtype=np.float32).copy()
    if output.size == 0:
        return output
    output -= np.mean(output, axis=0, keepdims=True)
    fade_len = min(max(2, int(sample_rate * 0.006)), len(output), 2048)
    if fade_len > 1:
        fade = np.linspace(0.0, 1.0, fade_len, dtype=np.float32)
        output[:fade_len] *= fade[:, None]
        output[-fade_len:] *= fade[::-1, None]
    return np.nan_to_num(output)


def rms_float(data: np.ndarray) -> float:
    data = np.asarray(data, dtype=np.float32)
    if data.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(data * data) + 1e-12))


def linear_to_db(value: float) -> float:
    return float(20.0 * math.log10(max(value, 1e-9)))


def touch_cache_entry(path: Path) -> None:
    # LRU 기준은 캐시 루트의 mtime 하나면 충분하다. 대형 Stem 트리를 순회하지 않는다.
    try:
        path.touch(exist_ok=True)
    except OSError:
        pass


def maybe_prune_demucs_cache(
    cache_root: Path,
    keep: Path | None = None,
    *,
    force: bool = False,
) -> None:
    """요청마다 대형 캐시를 다시 스캔하지 않도록 정리 작업을 제한한다."""
    global _demucs_cache_last_prune
    now = time.monotonic()
    with _DEMUCS_CACHE_PRUNE_LOCK:
        if not force and now - _demucs_cache_last_prune < DEMUCS_CACHE_PRUNE_INTERVAL_SECONDS:
            return
        _demucs_cache_last_prune = now
    prune_demucs_cache(cache_root, keep=keep)


def prune_demucs_cache(cache_root: Path, keep: Path | None = None) -> None:
    if not cache_root.exists():
        return
    try:
        root = cache_root.resolve()
    except Exception:
        return
    keep_resolved = None
    if keep is not None:
        try:
            keep_resolved = keep.resolve()
        except Exception:
            keep_resolved = None

    entries: list[tuple[Path, int, float]] = []
    now = time.time()
    max_age = DEMUCS_CACHE_MAX_AGE_DAYS * 24 * 60 * 60
    for entry in cache_root.iterdir():
        if not entry.is_dir():
            continue
        try:
            resolved = entry.resolve()
        except Exception:
            continue
        if keep_resolved is not None and resolved == keep_resolved:
            continue
        if not is_relative_to(resolved, root):
            continue
        size, last_used = cache_entry_stats(entry)
        entries.append((entry, size, last_used))

    for entry, _size, last_used in entries:
        if now - last_used > max_age:
            safe_remove_cache_entry(entry, root)
    entries = [item for item in entries if item[0].exists()]
    total = sum(size for _entry, size, _last in entries)
    for entry, size, _last_used in sorted(entries, key=lambda item: item[2]):
        if total <= DEMUCS_CACHE_MAX_BYTES:
            break
        safe_remove_cache_entry(entry, root)
        total -= size


def cache_entry_stats(path: Path) -> tuple[int, float]:
    size = 0
    last_used = 0.0
    for item in path.rglob("*"):
        try:
            stat = item.stat()
        except OSError:
            continue
        if item.is_file():
            size += stat.st_size
        last_used = max(last_used, stat.st_mtime)
    try:
        last_used = max(last_used, path.stat().st_mtime)
    except OSError:
        pass
    return size, last_used


def safe_remove_cache_entry(path: Path, root: Path) -> None:
    try:
        resolved = path.resolve()
    except Exception:
        return
    if resolved == root or not is_relative_to(resolved, root):
        return
    shutil.rmtree(resolved, ignore_errors=True)


def is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False
