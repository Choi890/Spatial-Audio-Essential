from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import shutil
import time
import threading
import uuid
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Any, AsyncIterator

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from backend.audio_engine import (
    AnalysisCancelledError,
    AudioChannelLayoutError,
    MAX_BODY_BYTES,
    analyze_audio,
    measure_master_output,
)


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
OUTPUT_DIR = DATA_DIR / "outputs"
BRIR_DIR = DATA_DIR / "brir"
HRTF_DIR = DATA_DIR / "hrtf"
ASSET_MANIFEST_PATH = DATA_DIR / "assets-manifest.json"
ANALYSIS_CACHE_DIR = OUTPUT_DIR / "_cache" / "analysis"
STATIC_JS_DIR = STATIC_DIR / "js"
UPLOAD_MAX_AGE_SECONDS = 24 * 60 * 60
OUTPUT_MAX_AGE_SECONDS = 14 * 24 * 60 * 60
ANALYSIS_CACHE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60
ANALYSIS_CACHE_MAX_ENTRIES = 256
WORKSPACE_CLEANUP_INTERVAL_SECONDS = 6 * 60 * 60
SUPPORTED_DEMUCS_MODELS = frozenset({"htdemucs_ft", "htdemucs"})
DEMUCS_MODEL = os.environ.get("SPATIAL_SEPARATOR_MODEL", "htdemucs_ft")
if DEMUCS_MODEL not in SUPPORTED_DEMUCS_MODELS:
    DEMUCS_MODEL = "htdemucs_ft"
ANALYSIS_PROFILE_VERSION = "fullband-neutral-v3-bs1770"
APP_VERSION = "1.11.0"
UPLOAD_CHUNK_WRITE_LIMIT = MAX_BODY_BYTES
ALLOWED_AUDIO_EXTENSIONS = {
    ".aac",
    ".flac",
    ".m4a",
    ".mp3",
    ".ogg",
    ".opus",
    ".wav",
    ".webm",
}
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]{8,64}$")
LOCAL_ORIGIN_PATTERN = r"https?://(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$"
SECURITY_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; "
        "script-src 'self'; style-src-elem 'self'; style-src-attr 'unsafe-inline'; "
        "img-src 'self' data:; "
        "media-src 'self' blob:; connect-src 'self' http://127.0.0.1:8768"
    ),
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
}


def read_bounded_int_env(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


ANALYSIS_CONCURRENCY = read_bounded_int_env("SPATIAL_ANALYSIS_CONCURRENCY", 1, 1, 2)
LOGGER = logging.getLogger("spatial_audio")
_analysis_slots = asyncio.Semaphore(ANALYSIS_CONCURRENCY)
_cleanup_lock = asyncio.Lock()
_active_analyses = 0
_queued_analyses = 0
_last_workspace_cleanup = 0.0

for directory in (UPLOAD_DIR, OUTPUT_DIR, BRIR_DIR, HRTF_DIR, ANALYSIS_CACHE_DIR):
    directory.mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    await run_workspace_cleanup(force=True)
    LOGGER.info(
        "Spatial Audio Essential %s ready (analysis concurrency=%s)",
        APP_VERSION,
        ANALYSIS_CONCURRENCY,
    )
    yield


app = FastAPI(
    title="Spatial Audio Essential",
    version=APP_VERSION,
    docs_url=None,
    redoc_url=None,
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["null"],
    allow_origin_regex=LOCAL_ORIGIN_PATTERN,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-Request-ID"],
    expose_headers=["Server-Timing", "X-Analysis-Queue-Ms", "X-Request-ID"],
    max_age=3600,
)
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["127.0.0.1", "localhost", "testserver"],
    www_redirect=False,
)


@app.middleware("http")
async def add_operational_headers(request: Request, call_next):
    started_at = time.perf_counter()
    request_id = normalize_request_id(request.headers.get("X-Request-ID"))
    request.state.request_id = request_id
    response = await call_next(request)
    elapsed_ms = (time.perf_counter() - started_at) * 1000

    response.headers["X-Request-ID"] = request_id
    response.headers["Server-Timing"] = f"app;dur={elapsed_ms:.1f}"
    for name, value in SECURITY_HEADERS.items():
        response.headers.setdefault(name, value)

    path = request.url.path
    if path == "/" or path.endswith(".html"):
        response.headers["Cache-Control"] = "no-store, max-age=0"
    elif path.endswith((".css", ".js")):
        response.headers["Cache-Control"] = (
            "public, max-age=31536000, immutable"
            if request.query_params.get("v")
            else "no-cache"
        )
    elif path.startswith("/outputs/"):
        response.headers["Cache-Control"] = "private, max-age=86400"
    elif path.startswith(("/brir/", "/hrtf/")):
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    elif path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/js", StaticFiles(directory=STATIC_JS_DIR), name="js")
app.mount("/outputs", StaticFiles(directory=OUTPUT_DIR), name="outputs")
app.mount("/brir", StaticFiles(directory=BRIR_DIR), name="brir")
app.mount("/hrtf", StaticFiles(directory=HRTF_DIR), name="hrtf")


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/styles.css")
async def styles() -> FileResponse:
    return FileResponse(STATIC_DIR / "styles.css")


@app.get("/app.js")
async def script() -> FileResponse:
    return FileResponse(STATIC_DIR / "app.js")


@app.get("/mushra")
async def mushra() -> FileResponse:
    return FileResponse(STATIC_DIR / "mushra.html")


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "Spatial Audio Essential",
        "version": APP_VERSION,
        "demucsModel": DEMUCS_MODEL,
        "separatorProvider": {
            "id": "facebookresearch-demucs",
            "maintenance": "archived-upstream",
            "replaceable": True,
            "supportedModels": sorted(SUPPORTED_DEMUCS_MODELS),
        },
        "analysis": {
            "active": _active_analyses,
            "queued": _queued_analyses,
            "capacity": ANALYSIS_CONCURRENCY,
        },
        "limits": {"maxUploadBytes": MAX_BODY_BYTES},
        "spatialAssets": validate_spatial_assets(),
    }


def validate_spatial_assets() -> dict[str, Any]:
    """Verify immutable spatial assets without allowing manifest path traversal."""
    try:
        manifest = json.loads(ASSET_MANIFEST_PATH.read_text(encoding="utf-8"))
        records = manifest.get("assets", [])
    except (OSError, json.JSONDecodeError):
        return {"status": "degraded", "reason": "asset manifest unavailable", "assets": []}

    results: list[dict[str, Any]] = []
    required_ok = True
    data_root = DATA_DIR.resolve()
    for record in records:
        relative = str(record.get("path", ""))
        expected_size = int(record.get("size", -1))
        expected_hash = str(record.get("sha256", "")).lower()
        required = bool(record.get("required", True))
        candidate = (DATA_DIR / relative).resolve()
        safe = candidate == data_root or data_root in candidate.parents
        exists = safe and candidate.is_file()
        size_ok = exists and candidate.stat().st_size == expected_size
        digest = ""
        if size_ok:
            digest = hashlib.sha256(candidate.read_bytes()).hexdigest()
        valid = bool(size_ok and digest == expected_hash)
        if required and not valid:
            required_ok = False
        results.append({"path": relative, "required": required, "valid": valid})
    return {"status": "ready" if required_ok else "degraded", "assets": results}


@app.post("/api/analyze")
async def analyze(
    request: Request,
    filename: str = "audio",
    demucs: bool = True,
    demucs_model: str = DEMUCS_MODEL,
) -> JSONResponse:
    global _active_analyses, _queued_analyses

    request_id = request.state.request_id
    demucs_model = DEMUCS_MODEL
    safe_name = sanitize_filename(filename)
    validate_audio_filename(safe_name)
    reject_oversized_content_length(request)
    await run_workspace_cleanup()

    upload_token = uuid.uuid4().hex
    temporary_path = UPLOAD_DIR / f".{upload_token}.uploading"
    profile_prefix = (
        f"{ANALYSIS_PROFILE_VERSION}|demucs={int(demucs)}|model={demucs_model}"
    ).encode("utf-8")

    try:
        byte_count, file_hash = await stream_request_to_file(
            request,
            temporary_path,
            profile_prefix=profile_prefix,
        )
        if byte_count == 0:
            raise HTTPException(status_code=400, detail="업로드된 오디오 데이터가 없습니다.")
    except HTTPException:
        temporary_path.unlink(missing_ok=True)
        raise
    except Exception as exc:
        temporary_path.unlink(missing_ok=True)
        LOGGER.warning("Upload stream failed request_id=%s: %s", request_id, exc)
        raise HTTPException(
            status_code=400,
            detail=f"오디오 업로드를 완료하지 못했습니다. 요청 ID: {request_id}",
        ) from exc

    job_id = f"{file_hash[:8]}{uuid.uuid4().hex[:4]}"
    job_dir = UPLOAD_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    audio_path = job_dir / safe_name
    temporary_path.replace(audio_path)

    cached = read_cached_analysis(file_hash, safe_name)
    if cached is not None:
        safely_remove_job_dir(job_dir)
        response = JSONResponse(cached)
        response.headers["X-Analysis-Queue-Ms"] = "0.0"
        return response

    queue_started_at = time.perf_counter()
    _queued_analyses += 1
    analysis_cache_hit = False
    try:
        try:
            await _analysis_slots.acquire()
        finally:
            _queued_analyses -= 1
        queue_ms = (time.perf_counter() - queue_started_at) * 1000
        try:
            cached_after_wait = read_cached_analysis(file_hash, safe_name)
            if cached_after_wait is not None:
                result = cached_after_wait
                analysis_cache_hit = True
            else:
                _active_analyses += 1
                cancel_event = threading.Event()
                disconnect_monitor: asyncio.Task[None] | None = None
                try:
                    analysis_task = asyncio.create_task(
                        asyncio.to_thread(
                            analyze_audio,
                            audio_path,
                            job_id=job_id,
                            output_dir=OUTPUT_DIR,
                            request_demucs=demucs,
                            demucs_model=demucs_model,
                            cache_key=file_hash,
                            cancel_event=cancel_event,
                        )
                    )
                    disconnect_monitor = asyncio.create_task(
                        monitor_client_disconnect(request, analysis_task, cancel_event)
                    )
                    try:
                        result = await asyncio.shield(analysis_task)
                    except asyncio.CancelledError:
                        cancel_event.set()
                        LOGGER.info(
                            "Analysis request cancelled; stopping worker job_id=%s",
                            job_id,
                        )
                        with suppress(AnalysisCancelledError):
                            await analysis_task
                        raise
                    finally:
                        if disconnect_monitor is not None:
                            disconnect_monitor.cancel()
                            with suppress(asyncio.CancelledError):
                                await disconnect_monitor
                finally:
                    _active_analyses -= 1
        finally:
            _analysis_slots.release()
    except AnalysisCancelledError as exc:
        LOGGER.info("Analysis cancelled request_id=%s job_id=%s", request_id, job_id)
        raise HTTPException(
            status_code=499,
            detail=f"오디오 분석이 취소되었습니다. 요청 ID: {request_id}",
        ) from exc
    except AudioChannelLayoutError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        LOGGER.exception(
            "Analysis failed request_id=%s job_id=%s filename=%s",
            request_id,
            job_id,
            safe_name,
        )
        raise HTTPException(
            status_code=500,
            detail=f"오디오 분석에 실패했습니다. 요청 ID: {request_id}",
        ) from exc
    finally:
        safely_remove_job_dir(job_dir)

    if not analysis_cache_hit:
        result["analysisCacheHit"] = False
        write_cached_analysis(file_hash, result)
    response = JSONResponse(result)
    response.headers["X-Analysis-Queue-Ms"] = f"{queue_ms:.1f}"
    return response


@app.post("/api/measure-output")
async def measure_output(request: Request, filename: str = "full-spatial.wav") -> dict[str, Any]:
    safe_name = sanitize_filename(filename)
    if Path(safe_name).suffix.lower() != ".wav":
        raise HTTPException(status_code=415, detail="Final-output measurement accepts WAV audio only")
    reject_oversized_content_length(request)
    temporary_path = UPLOAD_DIR / f".{uuid.uuid4().hex}.measure.wav"
    try:
        byte_count, _ = await stream_request_to_file(
            request,
            temporary_path,
            profile_prefix=b"final-output-meter-v1",
        )
        if byte_count == 0:
            raise HTTPException(status_code=400, detail="The rendered output is empty")
        return await asyncio.to_thread(measure_master_output, temporary_path)
    except AudioChannelLayoutError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        temporary_path.unlink(missing_ok=True)


async def monitor_client_disconnect(
    request: Request,
    analysis_task: asyncio.Task[Any],
    cancel_event: threading.Event,
) -> None:
    while not analysis_task.done():
        if await request.is_disconnected():
            cancel_event.set()
            return
        await asyncio.sleep(0.25)


async def stream_request_to_file(
    request: Request,
    destination: Path,
    *,
    profile_prefix: bytes,
) -> tuple[int, str]:
    digest = hashlib.sha256()
    digest.update(profile_prefix)
    digest.update(b"\0")
    byte_count = 0

    with destination.open("wb", buffering=1024 * 1024) as output:
        async for chunk in request.stream():
            if not chunk:
                continue
            byte_count += len(chunk)
            if byte_count > UPLOAD_CHUNK_WRITE_LIMIT:
                raise HTTPException(
                    status_code=413,
                    detail=f"오디오 파일은 최대 {MAX_BODY_BYTES // (1024 * 1024)}MB까지 업로드할 수 있습니다.",
                )
            digest.update(chunk)
            output.write(chunk)

    return byte_count, digest.hexdigest()


def reject_oversized_content_length(request: Request) -> None:
    header = request.headers.get("content-length")
    if not header:
        return
    try:
        content_length = int(header)
    except ValueError:
        raise HTTPException(status_code=400, detail="잘못된 Content-Length 헤더입니다.")
    if content_length > MAX_BODY_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"오디오 파일은 최대 {MAX_BODY_BYTES // (1024 * 1024)}MB까지 업로드할 수 있습니다.",
        )


def sanitize_filename(filename: str) -> str:
    name = Path(filename or "audio").name
    name = re.sub(r"[^\w .-]+", "_", name, flags=re.UNICODE).strip(" .")
    return name[:180] or "audio"


def validate_audio_filename(filename: str) -> None:
    suffix = Path(filename).suffix.lower()
    if suffix and suffix not in ALLOWED_AUDIO_EXTENSIONS:
        supported = ", ".join(sorted(extension.lstrip(".").upper() for extension in ALLOWED_AUDIO_EXTENSIONS))
        raise HTTPException(
            status_code=415,
            detail=f"지원하지 않는 오디오 형식입니다. 지원 형식: {supported}",
        )


def normalize_request_id(value: str | None) -> str:
    if value and REQUEST_ID_PATTERN.fullmatch(value):
        return value
    return uuid.uuid4().hex[:16]


def analysis_cache_path(file_hash: str) -> Path:
    safe_hash = re.sub(r"[^a-f0-9]", "", file_hash.lower())[:64]
    return ANALYSIS_CACHE_DIR / f"{safe_hash}.json"


def read_cached_analysis(file_hash: str, filename: str) -> dict[str, Any] | None:
    path = analysis_cache_path(file_hash)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict) or not cached_stem_paths_exist(payload):
        path.unlink(missing_ok=True)
        return None

    payload["jobId"] = file_hash[:12]
    payload["cacheKey"] = file_hash
    payload["analysisCacheHit"] = True
    if isinstance(payload.get("file"), dict):
        payload["file"]["name"] = filename
    separator = payload.get("models", {}).get("deepSeparator", {})
    if isinstance(separator, dict) and separator.get("status") == "completed":
        separator["cached"] = True
    try:
        path.touch()
    except OSError:
        pass
    return payload


def cached_stem_paths_exist(payload: dict[str, Any]) -> bool:
    separator = payload.get("models", {}).get("deepSeparator", {})
    if not isinstance(separator, dict) or separator.get("status") != "completed":
        return False
    stems = separator.get("stems")
    if not isinstance(stems, list) or len(stems) < 4:
        return False
    try:
        output_root = OUTPUT_DIR.resolve()
        for relative_path in stems:
            candidate = (OUTPUT_DIR / str(relative_path)).resolve()
            candidate.relative_to(output_root)
            if not candidate.is_file():
                return False
    except (OSError, ValueError):
        return False
    return True


def write_cached_analysis(file_hash: str, payload: dict[str, Any]) -> None:
    if not cached_stem_paths_exist(payload):
        return
    cache_path = analysis_cache_path(file_hash)
    temporary_path = cache_path.with_suffix(f".{uuid.uuid4().hex}.tmp")
    try:
        temporary_path.write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        temporary_path.replace(cache_path)
    except OSError:
        temporary_path.unlink(missing_ok=True)
        LOGGER.warning("Could not write analysis cache for %s", file_hash[:12])


async def run_workspace_cleanup(force: bool = False) -> None:
    if not force and time.time() - _last_workspace_cleanup < WORKSPACE_CLEANUP_INTERVAL_SECONDS:
        return
    async with _cleanup_lock:
        if not force and time.time() - _last_workspace_cleanup < WORKSPACE_CLEANUP_INTERVAL_SECONDS:
            return
        await asyncio.to_thread(maybe_prune_workspace_storage, force)


def maybe_prune_workspace_storage(force: bool = False) -> None:
    global _last_workspace_cleanup
    now = time.time()
    if not force and now - _last_workspace_cleanup < WORKSPACE_CLEANUP_INTERVAL_SECONDS:
        return
    _last_workspace_cleanup = now
    prune_child_dirs(UPLOAD_DIR, UPLOAD_MAX_AGE_SECONDS)
    prune_child_dirs(OUTPUT_DIR, OUTPUT_MAX_AGE_SECONDS, skip_names={"_cache"})
    prune_analysis_cache()


def prune_child_dirs(root: Path, max_age_seconds: int, skip_names: set[str] | None = None) -> None:
    if not root.exists():
        return
    skip_names = skip_names or set()
    try:
        root_resolved = root.resolve()
    except OSError:
        return
    cutoff = time.time() - max_age_seconds
    for child in root.iterdir():
        if child.name in skip_names or not child.is_dir():
            continue
        try:
            resolved = child.resolve()
            resolved.relative_to(root_resolved)
            last_used = child.stat().st_mtime
            for item in child.rglob("*"):
                last_used = max(last_used, item.stat().st_mtime)
        except (OSError, ValueError):
            continue
        if last_used < cutoff:
            shutil.rmtree(resolved, ignore_errors=True)


def prune_analysis_cache() -> None:
    try:
        entries = [
            path
            for path in ANALYSIS_CACHE_DIR.glob("*.json")
            if path.is_file()
        ]
    except OSError:
        return
    cutoff = time.time() - ANALYSIS_CACHE_MAX_AGE_SECONDS
    fresh_entries: list[Path] = []
    for path in entries:
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink(missing_ok=True)
            else:
                fresh_entries.append(path)
        except OSError:
            continue
    fresh_entries.sort(key=lambda path: path.stat().st_mtime, reverse=True)
    for path in fresh_entries[ANALYSIS_CACHE_MAX_ENTRIES:]:
        path.unlink(missing_ok=True)


def safely_remove_job_dir(job_dir: Path) -> None:
    try:
        upload_root = UPLOAD_DIR.resolve()
        resolved = job_dir.resolve()
        resolved.relative_to(upload_root)
    except (OSError, ValueError):
        return
    if resolved == upload_root:
        return
    shutil.rmtree(resolved, ignore_errors=True)
