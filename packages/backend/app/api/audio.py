"""
Audio upload and analysis API routes.
Handles file uploads for music video creation and audio analysis.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import shutil
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from ..core.config import PROJECT_ROOT
from ..services.analysis_resolver import (
    hash_prefix,
    resolve_analysis,
    resolve_by_job_id,
    scan_analysis_dir_cached,
)
from ..services.video_import import (
    VIDEO_EXTENSIONS,
    ExtractionResult,
    extract_audio,
    target_stem,
)
from ..sse.handler import sse_manager

# Analysis helpers (result builder, curve maths, visualization suggestions,
# section labelling) moved to app/api/audio_analysis.py. No routes moved - those
# stay here - so this module keeps the endpoints and imports the pure functions
# they call. The list is exactly what is referenced, verified by an AST pass.
from .audio_analysis import (  # noqa: E402
    _ENERGY_CURVE_POINTS,
    _ENVELOPE_POINTS,
    ANALYSIS_SCHEMA_VERSION,
    _apply_llm_sections,
    _build_analysis_result,
    _check_backend_available,
    _downsample_curve,
    _relative_audio_path,
)

# Shared audio path/extension constants (single source of truth; also used by
# audio_stems.py and audio_edit.py under the same /api/audio prefix).
from .audio_common import (  # noqa: E402
    ALLOWED_EXTENSIONS,
    AUDIO_DIR,
    VIDEO_EXTRACTED_AUDIO_DIR,
)

# File size limit for uploads — audio.py-specific (not shared with stems/edit).
MAX_FILE_SIZE = 500 * 1024 * 1024  # 500 MB

# Stem separation (source_separation, SEPARATION_DIR, source_separator,
# urllib.parse, typing.Any) moved to app/api/audio_stems.py; main.py includes
# that router alongside this one, so the /api/audio paths are unchanged.

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/audio", tags=["Audio"])

# Audio analysis directory is audio.py-specific (not shared with stems/edit).
ANALYSIS_DIR = PROJECT_ROOT / "output" / "audio_analysis"
ANALYSIS_DIR.mkdir(parents=True, exist_ok=True)
ANALYSIS_INDEX = ANALYSIS_DIR / "index.json"
# Disk cache for /spectral-timeline: the endpoint decodes the whole file and
# runs a full-track STFT per request, and the result is deterministic per
# (file content, fps, sr, hop_length, n_fft) — a perfect cache candidate.
SPECTRAL_CACHE_DIR = PROJECT_ROOT / "output" / "cache" / "spectral_timeline"
SPECTRAL_CACHE_DIR.mkdir(parents=True, exist_ok=True)


def _find_by_content_id(audio_dir: Path, content_id: str) -> Path | None:
    """Return an already-stored file whose name carries `content_id`, if any.

    Sorted so the answer does not depend on directory iteration order when a
    duplicate pair somehow exists.
    """
    if not audio_dir.exists():
        return None
    prefix = f"{content_id}_"
    matches = sorted(p for p in audio_dir.iterdir() if p.is_file() and p.name.startswith(prefix))
    return matches[0] if matches else None


async def _store_upload(file: UploadFile) -> str:
    """Stream an upload to AUDIO_DIR and return the filename it is stored under.

    The id is sha256(content)[:8], not a random uuid. A random id meant every
    upload of the same track produced a different filename, a different
    database row and a different index entry - and because each request then
    arrived under a new name, the analysis cache could never hit. A content hash
    makes the identity stable, so the same audio always resolves to the same
    file and the same cached analysis.

    Writes to a temporary name first and renames on success, so a failed or
    oversized upload never leaves a half-written file under a real name.

    Returns the stored *filename*, not the bare id, because re-uploading a file
    that is already prefixed (`32129cfa_03c5fbfd_Song.mp3`) computes the same
    content id as `03c5fbfd_Song.mp3` and must reuse that existing name. Callers
    used to rebuild the name from `id + original filename`, which would have
    pointed at a file this function decided not to write.
    """

    digest = hashlib.sha256()
    size = 0
    # Write to the system temp dir, not inside AUDIO_DIR: a crashed upload
    # leaves an orphan .upload in output/audio/ otherwise, and system temp
    # is cleaned by the OS on reboot. audio_stems.py already uses this same
    # pattern for its uploads.
    tmp_path = Path(tempfile.gettempdir()) / (uuid.uuid4().hex + ".upload")
    try:
        with open(tmp_path, "wb") as buffer:
            while chunk := await file.read(8192):
                size += len(chunk)
                if size > MAX_FILE_SIZE:
                    raise HTTPException(
                        status_code=413,
                        detail=f"File too large. Maximum size: {MAX_FILE_SIZE // (1024 * 1024)} MB",
                    )
                digest.update(chunk)
                buffer.write(chunk)
    except HTTPException:
        tmp_path.unlink(missing_ok=True)
        raise
    except Exception as e:
        tmp_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}") from e

    unique_id = digest.hexdigest()[:8]

    # The audio is already on disk under some name. Writing `{unique_id}_` +
    # the incoming filename again would append a second content-hash prefix to
    # an already-prefixed name (`32129cfa_03c5fbfd_Song.mp3`), which is how one
    # track ended up with eleven filenames and a matching pile of analyses.
    # Reuse the existing file and drop the temp copy.
    existing = _find_by_content_id(AUDIO_DIR, unique_id)
    if existing is not None:
        tmp_path.unlink(missing_ok=True)
        logger.info(f"Upload of '{existing.name}' deduplicated by content id {unique_id}")
        return existing.name

    final_path = AUDIO_DIR / f"{unique_id}_{file.filename}"
    try:
        tmp_path.replace(final_path)  # atomic within the same volume
    except OSError:
        # Cross-volume move (e.g. system temp on C:, repo on D:) -- fall back
        # to copy + delete. Not atomic, but the unique temp name means a crash
        # still leaves nothing under a real filename.
        shutil.move(str(tmp_path), str(final_path))
    return final_path.name


def _schema_of(path: Path) -> int | None:
    """Read just the `schema_version` out of an analysis file.

    Shared by every lookup in this module so the staleness rule is applied the
    same way everywhere. A file that cannot be read is treated as unstamped,
    which is the safe direction: it is rejected and re-analyzed rather than
    served.
    """
    try:
        with open(path, encoding="utf-8") as fh:
            parsed = json.load(fh)
    except (OSError, ValueError):
        return None
    return parsed.get("schema_version") if isinstance(parsed, dict) else None


def _analysis_candidates() -> list:
    """Snapshot the analysis directory, with schema versions memoized."""
    return scan_analysis_dir_cached(ANALYSIS_DIR, _schema_of)


def _analysis_is_stale(data: dict | None) -> bool:
    """Return True when a cached analysis predates the current schema.

    A missing stamp counts as stale: those entries predate versioning entirely,
    so there is no version to compare and assuming they are current is what let
    incomplete results persist.
    """
    if not isinstance(data, dict):
        return True
    try:
        return int(data.get("schema_version", 0)) < ANALYSIS_SCHEMA_VERSION
    except (TypeError, ValueError):
        return True


def _stamp_analysis(data: dict) -> dict:
    """Record the current schema version on an analysis before it is stored."""
    if isinstance(data, dict):
        data["schema_version"] = ANALYSIS_SCHEMA_VERSION
    return data


# In-memory cache for analysis data (avoids DB hits on every frontend poll).
# Keys are ``filename:backend`` so different analysis backends do not clobber
# each other's results.
_analysis_cache: dict[str, dict] = {}
_cache_max_size = 200  # Max files to cache in memory


def _cache_set(filename: str, value: dict, backend: str = "") -> None:
    """Store value in cache, evicting oldest entry if over limit.

    Re-setting an existing key refreshes its position (true LRU) — plain
    dict assignment kept the original insertion slot, so hot entries could
    be evicted while colder ones survived.
    """
    key = f"{filename}:{backend}"
    if key in _analysis_cache:
        _analysis_cache.pop(key)
    elif len(_analysis_cache) >= _cache_max_size:
        _analysis_cache.pop(next(iter(_analysis_cache)), None)
    _analysis_cache[key] = value


def _cache_get(filename: str, backend: str = "") -> dict | None:
    """Get cached value by filename (+ optional backend)."""
    return _analysis_cache.get(f"{filename}:{backend}")


def _cache_delete(filename: str, backend: str = "") -> None:
    """Remove a cached value.

    Used to evict an entry that is stale by schema version, so it stops being
    served and does not get re-checked on every request.
    """
    _analysis_cache.pop(f"{filename}:{backend}", None)


def _cache_delete_by_content_id(content_id: str) -> None:
    """Remove every cached entry for the file stored under `content_id`.

    Stored filenames are ``{content_id}_{original name}`` and cache keys are
    ``{stored filename}:{backend}``, so no single ``_cache_delete`` call can
    evict a file's entries -- the cleanup path tried exactly that with the
    bare content id and popped a key that never exists, leaving deleted
    analyses servable until they aged out of the cache. Match the
    stored-name prefix across all backends instead; this also covers
    orphans, whose audio file (and exact stored name) is already gone.
    """
    prefix = f"{content_id}_"
    for key in list(_analysis_cache):
        filename = key.split(":", 1)[0]
        if filename == content_id or filename.startswith(prefix):
            _analysis_cache.pop(key, None)


# ---------------------------------------------------------------------------
# Analyze-all job store (in-memory, per-process).
# analyze-all is long-running (70+ files), so it returns a job_id immediately
# and processes in the background, broadcasting progress via SSE so the
# frontend can show real-time progress instead of staring at a hanging request.
# ---------------------------------------------------------------------------
_analyze_all_jobs: dict[str, dict[str, Any]] = {}
_analyze_all_jobs_lock = asyncio.Lock()


async def _analyze_all_job_set(job_id: str, **fields):
    async with _analyze_all_jobs_lock:
        job = _analyze_all_jobs.get(job_id)
        if job is None:
            job = {}
            _analyze_all_jobs[job_id] = job
        job.update(fields)


async def _analyze_all_job_get(job_id: str) -> dict[str, Any] | None:
    async with _analyze_all_jobs_lock:
        return dict(_analyze_all_jobs.get(job_id, {}))


class AudioUploadResponse(BaseModel):
    """Response model for audio upload"""

    success: bool
    filename: str
    stored_path: str
    size_bytes: int
    message: str
    # Set when the upload arrived as video and was converted to .m4a. The
    # frontend uses this to tell the user a conversion happened rather than
    # reporting a plain upload.
    converted: bool = False
    #: The video filename the user actually dropped, for the message.
    source_filename: str | None = None
    #: True when the audio was remuxed with `-c:a copy` (bit-identical).
    lossless: bool = False
    #: True when an existing library file with the same content was reused
    #: instead of writing a new copy.
    deduplicated: bool = False
    #: Output-relative path (e.g. "audio/video-extracted/x.m4a") for serving.
    relative_path: str = ""


class AudioAnalysisResponse(BaseModel):
    """Response model for audio analysis request"""

    job_id: str
    status: str
    message: str


class AudioAnalysisResult(BaseModel):
    """Response model for completed audio analysis -- now energy-aware (2026)"""

    tempo_bpm: float
    duration_seconds: float
    beat_count: int
    sections: list[dict]
    beat_times: list[float] = []
    onset_times: list[float] = []
    energy_curve: list[float] = []  # normalized 0-1, 60-100 points for viz
    confidence: float = 0.0
    amplitude_envelope: list[float] = []
    # Key detection. These were missing from the model, so a fresh analysis
    # dropped them on the way out and every stored result predated the
    # chroma->hue work. The frontend mapper reads key_confidence_r (raw r) to
    # decide between a direct hue, a runner-up blend, and the neutral fallback;
    # key_confidence is the clamped display value.
    # See docs/architecture/chroma-hue-mapping.md.
    estimated_key: str | None = None
    key_confidence: float | None = None
    key_confidence_r: float | None = None
    key_runner_up: str | None = None
    key_runner_up_r: float | None = None
    # Tier 2 chroma (chroma-hue-mapping.md): per-0.5s dominant pitch class +
    # confidence, emitted by analyze.py / audio_agent_profile.py. Optional —
    # analyses stored before it existed simply lack the key.
    chroma_frames: dict | None = None
    stored_path: str | None = None
    # Output-relative path (e.g. "audio/track.wav") — the only safe input for
    # /api/audio/file/*. Undeclared until now, so fresh /analyze responses
    # dropped it under extra="ignore" and the frontend fell back to the
    # absolute stored_path, which that route cannot serve.
    relative_path: str | None = None
    job_id: str | None = None
    beats_truncated: bool = False  # True when beat_times hit the response cap
    downbeat_times: list[float] = []
    # Aggregate spectral summary + per-frame spectral curves emitted by the
    # analyzer. Same extra="ignore" trap as relative_path: undeclared fields
    # were stripped from fresh /analyze responses but present on cached
    # by-filename reads, so the UI showed different data depending on path.
    spectral: dict | None = None
    spectral_centroid: list[float] = []
    spectral_rolloff: list[float] = []
    spectral_bandwidth: list[float] = []
    zero_crossing_rate: list[float] = []
    # Analyzer provenance block (backend name, sonara loudness/dynamics, etc.)
    metadata: dict | None = None
    # Timing contract (shared with frontend + Remotion + AI agents)
    timing_contract: dict | None = None
    # Suggested visualization parameters for AI/agent-driven presets
    suggested_visualization: str | None = None
    suggested_visualization_confidence: float | None = None
    suggested_visualization_candidates: list[dict] | None = None
    suggested_kinetic_preset: str | None = None
    suggested_kinetic_preset_confidence: float | None = None
    suggested_theme_seed: str | None = None
    suggested_theme_seed_confidence: float | None = None
    # Schema version of this payload. Absent on results stored before stamping
    # existed, which is what makes them detectable as stale.
    schema_version: int = 0
    # "GPU" when the spectral pass ran on CUDA, "CPU" otherwise. Declared here
    # because the model sets extra="ignore": with it undeclared the field was
    # silently dropped on the way out, so a successful GPU run reported no
    # computed_on at all and looked exactly like a CPU fallback.
    computed_on: str | None = None

    model_config = {"extra": "ignore"}


class EnsureAnalysisRequest(BaseModel):
    """Request model for ensuring cached analysis exists for an audio file."""

    filename: str
    backend: str = "sonara"


class AudioSearchRequest(BaseModel):
    """Filters for searching the audio library by analysis fields.

    All filters are optional and combined with AND. Tempo/energy/sections
    read from the stored analysis JSON; `key` matches the detected key
    (e.g. "E major", "A minor") case-insensitively.
    """

    min_tempo: float | None = None
    max_tempo: float | None = None
    min_energy: float | None = None
    max_energy: float | None = None
    min_sections: int | None = None
    max_sections: int | None = None
    key: str | None = None
    limit: int = 100


@router.get("/backends")
async def list_audio_backends():
    """List available audio analysis backends."""
    from ..services.audio_analyzer import (
        LIBROSA_AVAILABLE,
        MADMOM_AVAILABLE,
        SONARA_AVAILABLE,
    )

    return {
        "available": [
            b
            for b, avail in [
                ("sonara", SONARA_AVAILABLE),
                ("madmom", MADMOM_AVAILABLE),
                ("librosa", LIBROSA_AVAILABLE),
            ]
            if avail
        ],
        "default": "sonara" if SONARA_AVAILABLE else "librosa",
    }


@router.get("/analysis/summary/{filename:path}")
async def get_analysis_summary(filename: str):
    """Agent-friendly summary of cached analysis for a file.
    Returns a compact view optimized for AI consumption:
    - tempo, duration, beat count, confidence
    - section labels with start/end/energy
    - whether spectral/onset data is present
    """
    import urllib.parse

    filename = urllib.parse.unquote(filename)
    if ".." in filename or filename.startswith("/"):
        raise HTTPException(status_code=400, detail="Invalid filename")
    try:
        data = await get_analysis_by_filename(filename)
    except HTTPException:
        raise
    return {
        "filename": filename,
        "tempo_bpm": data.get("tempo_bpm"),
        "duration_seconds": data.get("duration_seconds"),
        "beat_count": data.get("beat_count"),
        "beats_truncated": data.get("beats_truncated", False),
        "confidence": data.get("confidence"),
        "sections": data.get("sections", []),
        "spectral": data.get("spectral", {}),
        "has_beat_times": bool(data.get("beat_times")),
        "has_downbeats": bool(data.get("downbeat_times")),
        "has_onset_times": bool(data.get("onset_times")),
        "has_energy_curve": bool(data.get("energy_curve")),
        # Legacy key: older summaries advertised raw spectral curve arrays that
        # this payload never carried, so it always reported false.
        "has_spectral": bool(
            data.get("spectral") or data.get("spectral_centroid") or data.get("spectral_rolloff")
        ),
        "job_id": data.get("job_id"),
        "stored_path": data.get("stored_path"),
    }


# Documented JSON paths inside audio_files.analysis_result. Agents should
# read this instead of guessing field names — every key here is emitted by
# _build_analysis_result (app/api/audio_analysis.py) at schema v3.
ANALYSIS_FIELDS: dict[str, str] = {
    # Identity / timing
    "tempo_bpm": "Detected tempo in BPM",
    "duration_seconds": "Track duration in seconds",
    "beat_count": "Number of detected beats",
    "beat_times": "List of beat timestamps (seconds), capped for response size",
    "downbeat_times": "List of downbeat timestamps (seconds)",
    "onset_times": "List of onset timestamps (seconds)",
    "beats_truncated": "True when beat_times hit the response cap",
    # Energy / dynamics
    "energy_curve": "Normalized 0-1 energy curve for visualization",
    "amplitude_envelope": "Normalized amplitude envelope",
    "avg_energy": "Mean energy value (used by library search)",
    "spectral": "Aggregate spectral summary (centroid, rolloff, bandwidth, zcr)",
    "spectral_centroid": "Per-frame spectral centroid curve (Hz)",
    "spectral_rolloff": "Per-frame spectral rolloff curve (Hz)",
    "spectral_bandwidth": "Per-frame spectral bandwidth curve (Hz)",
    "zero_crossing_rate": "Per-frame zero-crossing rate curve",
    # Key / chroma
    "estimated_key": "Detected key, e.g. 'E major'",
    "key_confidence": "Clamped 0-1 display confidence",
    "key_confidence_r": "Raw key-profile correlation (-1..1); hue mapping uses this",
    "key_runner_up": "Second-best key candidate",
    "key_runner_up_r": "Raw correlation for the runner-up key",
    "chroma_frames": "Per-0.5s chroma: {fps, t0, pc (pitch class 0-11, -1 none), conf}",
    # Structure
    "sections": "List of {type, start, end, energy} song sections",
    "confidence": "Overall beat-tracking confidence 0-1",
    # Provenance / suggestions
    "metadata": "Analyzer provenance: backend name; sonara adds loudness_lufs, dynamic_range_db, rms_mean/max, onset_density, bpm_candidates",
    "suggested_visualization": "Suggested visualizer preset",
    "suggested_kinetic_preset": "Suggested kinetic preset",
    "suggested_theme_seed": "Suggested theme seed",
    "timing_contract": "Timing metadata shared with frontend/Remotion/agents",
    "schema_version": "Analysis schema version; stale versions trigger re-analysis",
    "computed_on": "Device that ran the spectral pass ('GPU'/'CPU')",
    "stored_path": "Absolute path of the analyzed file",
    "relative_path": "Output-relative path safe for /api/audio/file/*",
    "job_id": "Analysis job id when produced via the job queue",
}


@router.get("/analysis-fields")
async def get_analysis_fields():
    """List the documented fields inside analysis_result JSON.

    Agent-facing: call this before constructing json_extract paths or
    expecting fields, so queries use real keys instead of guesses.
    """
    return {
        "schema_version_current": ANALYSIS_SCHEMA_VERSION,
        "fields": ANALYSIS_FIELDS,
        "search_endpoint": "POST /api/audio/search",
        "summary_endpoint": "GET /api/audio/analysis/summary/{filename}",
        "full_endpoint": "GET /api/audio/analysis/by-filename/{filename}",
    }


@router.post("/search")
async def search_audio_library(body: AudioSearchRequest):
    """Search the audio library by cached analysis fields.

    Agent-facing discovery endpoint: find tracks by tempo range, key,
    energy, or section count without fetching every analysis blob.
    Returns compact rows (no full analysis payload).
    """
    from ..core import database

    rows = database.search_audio_by_analysis(
        min_tempo=body.min_tempo,
        max_tempo=body.max_tempo,
        min_energy=body.min_energy,
        max_energy=body.max_energy,
        min_sections=body.min_sections,
        max_sections=body.max_sections,
        key=body.key,
        limit=body.limit,
    )
    results = []
    for row in rows:
        analysis = row.get("analysis_result") or {}
        results.append(
            {
                "filename": row.get("filename"),
                "original_name": row.get("original_name"),
                "duration": row.get("duration"),
                "bpm": row.get("bpm"),
                "key": row.get("key") or analysis.get("estimated_key"),
                "file_size": row.get("file_size"),
                "created_at": row.get("created_at"),
                "schema_version": analysis.get("schema_version"),
                "section_count": len(analysis.get("sections") or []),
                "has_analysis": bool(analysis),
            }
        )
    return {"count": len(results), "results": results}


@router.post("/upload", response_model=AudioUploadResponse)
async def upload_audio(file: UploadFile = File(...)) -> AudioUploadResponse:
    """Upload a track -- audio is stored as-is; video is converted to .m4a.

    A dropped `.mp4` used to be rejected outright, which made Suno drafts
    invisible: the library listing and `analyze-all` both filter on
    ALLOWED_EXTENSIONS, so a video in `output/audio/` was never listed, never
    analyzed and never playable. Video is now converted to .m4a here so dropping
    a file into the app is all it takes to add a track.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    safe_name, was_converted, extraction, deduped = await _store_track(file)
    # Video conversions land in the video-extracted subfolder, not AUDIO_DIR.
    file_dir = VIDEO_EXTRACTED_AUDIO_DIR if was_converted else AUDIO_DIR
    file_path = file_dir / safe_name
    size = file_path.stat().st_size
    root = PROJECT_ROOT.resolve()
    rel = file_path.resolve().relative_to(root).as_posix().removeprefix("output/")

    if not was_converted:
        return AudioUploadResponse(
            success=True,
            filename=file.filename,
            stored_path=str(file_path),
            size_bytes=size,
            message=f"Audio file uploaded successfully ({size // 1024} KB)",
            deduplicated=deduped,
            relative_path=rel,
        )

    how = "stream copy" if extraction and extraction.lossless else "re-encoded to AAC"
    verb = "Added (already in library)" if deduped else "Converted"
    return AudioUploadResponse(
        success=True,
        filename=file_path.name,
        stored_path=str(file_path),
        size_bytes=size,
        message=(f"{verb}: {file.filename} -> {file_path.name} ({how}, {size // 1024} KB)"),
        converted=True,
        source_filename=file.filename,
        lossless=bool(extraction and extraction.lossless),
        deduplicated=deduped,
        relative_path=rel,
    )


async def _store_video_as_audio(file: UploadFile) -> tuple[str, ExtractionResult, bool]:
    """Convert an uploaded video to .m4a and store it in the library.

    Returns `(stored_filename, extraction_result, deduplicated)`.

    The video is streamed to a temp file outside the library so a failed
    conversion can never leave a `.mp4` (which the library ignores) or a
    truncated `.m4a` behind. The result is then content-addressed like any other
    upload, so re-dropping the same video reuses the existing track.
    """
    tmp_dir = AUDIO_DIR.parent / "_import_tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    src = tmp_dir / f"{uuid.uuid4().hex}{Path(file.filename).suffix.lower()}"
    # Declared before the try: the finally block references it, and an early
    # raise (413/400) would otherwise leave the name unbound.
    converted: Path | None = None

    try:
        digest = hashlib.sha256()
        total = 0
        with open(src, "wb") as out:
            while chunk := await file.read(1 << 20):
                total += len(chunk)
                if total > MAX_FILE_SIZE:
                    raise HTTPException(
                        status_code=413,
                        detail=f"File too large. Maximum size: {MAX_FILE_SIZE // (1024 * 1024)} MB",
                    )
                digest.update(chunk)
                out.write(chunk)

        if total == 0:
            raise HTTPException(status_code=400, detail="File is empty")

        stem = target_stem(file.filename or "track")
        converted = tmp_dir / f"{digest.hexdigest()[:8]}_{stem}.m4a"
        result = extract_audio(src, converted)

        if not result.ok:
            raise HTTPException(
                status_code=503,
                detail=f"Could not extract audio from '{file.filename}': {result.detail}",
            )

        # Content-address the result, then reuse an identical existing track
        # rather than writing a second copy of the same audio.
        audio_id = hashlib.sha256(converted.read_bytes()).hexdigest()[:8]
        existing = _find_by_content_id(VIDEO_EXTRACTED_AUDIO_DIR, audio_id)
        if existing is not None:
            deduped = True
        else:
            final_path = VIDEO_EXTRACTED_AUDIO_DIR / f"{audio_id}_{stem}.m4a"
            converted.replace(final_path)
            deduped = False

        return existing.name if existing is not None else final_path.name, result, deduped
    finally:
        src.unlink(missing_ok=True)
        if converted is not None:
            converted.unlink(missing_ok=True)
        # Remove the temp directory itself so a conversion leaves no empty
        # _import_tmp dir behind in output/. The directory may still hold
        # files if something went wrong mid-conversion; ignore errors on
        # removal so a leftover file never masks the real result.
        try:
            tmp_dir.rmdir()
        except OSError:
            pass


async def _store_track(file: UploadFile) -> tuple[str, bool, ExtractionResult | None, bool]:
    """Store an audio *or* video upload in the library.

    Returns `(stored_filename, converted, extraction_result, deduplicated)`.
    Shared by /upload, /analyze and /analyze-cuda so a dropped .mp4 works on
    every path -- previously only /upload learned about video, so the analysis
    routes still answered 400 for the same file.
    """
    ext = Path(file.filename or "").suffix.lower()
    _validate_upload_extension(ext)
    if ext in VIDEO_EXTENSIONS:
        name, result, deduped = await _store_video_as_audio(file)
        return name, True, result, deduped
    return await _store_upload(file), False, None, False


def _validate_upload_extension(ext: str) -> None:
    if ext in VIDEO_EXTENSIONS or ext in ALLOWED_EXTENSIONS:
        return
    raise HTTPException(
        status_code=400,
        detail=(
            f"Invalid file type. Allowed audio: "
            f"{', '.join(sorted(ALLOWED_EXTENSIONS))}; "
            f"video (converted to M4A): {', '.join(sorted(VIDEO_EXTENSIONS))}"
        ),
    )


@router.post("/analyze", response_model=AudioAnalysisResult)
async def analyze_audio(
    file: UploadFile = File(...),
    backend: str = "sonara",
) -> AudioAnalysisResult:
    """Analyze audio file for tempo, beats, and sections.

    backend: one of librosa, madmom, sonara. Falls back to librosa if unavailable.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    # Accepts audio and video alike: a dropped .mp4 is converted to .m4a
    # here, so the analysis routes work on video without a separate step.
    safe_name, _converted, _extraction, _deduped = await _store_track(file)
    file_path = AUDIO_DIR / safe_name
    normalized = safe_name.replace("\\", "/")
    # The stored name always begins with the content hash, so the job id is
    # read back from it. These endpoints used to bind `unique_id` from the
    # upload call itself; now that the call returns the chosen filename, the
    # id has to come from there or it is undefined at analysis time.
    unique_id = hash_prefix(safe_name) or str(uuid.uuid4())[:8]

    try:
        _check_backend_available(backend)

        from ..services.audio_analyzer import AudioAnalyzer

        analyzer = AudioAnalyzer()
        result = analyzer.analyze_file(str(file_path), job_id=unique_id, backend=backend)
        analysis_result = _build_analysis_result(result, unique_id, file_path, analyzer)

        # Save full analysis. `index.json` is deliberately not updated: it had
        # grown to 62 keys pointing at 17 files (49 dangling), every lookup now
        # resolves against the directory directly, and writing to it only kept
        # manufacturing entries nobody reads.
        analysis_file = ANALYSIS_DIR / f"{unique_id}_analysis.json"
        with open(analysis_file, "w", encoding="utf-8") as f:
            json.dump(analysis_result, f, indent=2, ensure_ascii=False)

        # Persist to the database so analyze-all / ensure-analysis / by-filename
        # can serve this result from a persistent store instead of re-analyzing.
        # analyze_audio previously wrote only to JSON, so any file analyzed via
        # this route was re-analyzed by analyze-all (which keys on the DB).
        from ..core import database

        database.update_audio_analysis(normalized, analysis_result)
        _cache_set(normalized, analysis_result, "")
        _cache_set(normalized, analysis_result, backend)

        return AudioAnalysisResult(**analysis_result)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}") from e


@router.get("/beat-map/{filename:path}")
async def get_beat_map(
    filename: str,
    backend: str = "sonara",
) -> dict:
    """Get beat-synced data for a previously analyzed audio file.

    Returns tempo, beat times, downbeats, onsets, and energy curve optimized
    for beat-synced visualizations in Remotion and similar tools.

    Args:
        filename: Name of the audio file (as returned by upload or list endpoints).
        backend: Analysis backend to use if analysis needs to be run
                 (librosa, madmom, sonara). Falls back to librosa if unavailable.

    Returns:
        Dict with tempo_bpm, beat_times, downbeat_times, onset_times,
        duration_seconds, confidence, energy_curve, estimated_key,
        key_confidence.
    """
    import urllib.parse

    filename = urllib.parse.unquote(filename)
    if ".." in filename or filename.startswith("/"):
        raise HTTPException(status_code=400, detail="Invalid filename")

    # Normalize path separators
    normalized = filename.replace("\\", "/")
    if normalized.startswith(str(AUDIO_DIR).replace("\\", "/")):
        normalized = str(Path(normalized).relative_to(AUDIO_DIR).as_posix())

    # Try to get cached analysis
    cached = _cache_get(normalized, backend)
    if cached is not None and not _analysis_is_stale(cached):
        return _build_beat_map_response(cached)

    # Analyze if not cached or stale
    try:
        _check_backend_available(backend)
    except Exception as exc:
        raise HTTPException(
            status_code=503, detail=f"Backend {backend} not available: {exc}"
        ) from exc

    from ..services.audio_analyzer import AudioAnalyzer

    analyzer = AudioAnalyzer()
    unique_id = hash_prefix(normalized) or str(uuid.uuid4())[:8]
    result = analyzer.analyze_file(str(AUDIO_DIR / normalized), job_id=unique_id, backend=backend)
    analysis_result = _build_analysis_result(result, unique_id, AUDIO_DIR / normalized, analyzer)

    return _build_beat_map_response(analysis_result)


def _build_beat_map_response(data: dict) -> dict:
    """Build beat-synced response from analysis result dict."""
    return {
        "tempo_bpm": data.get("tempo_bpm"),
        "duration_seconds": data.get("duration_seconds"),
        "beat_times": data.get("beat_times", []),
        "downbeat_times": data.get("downbeat_times", []),
        "onset_times": data.get("onset_times", []),
        "confidence": data.get("confidence", 0.0),
        "energy_curve": data.get("energy_curve", []),
        "estimated_key": data.get("estimated_key"),
        "key_confidence": data.get("key_confidence"),
        "key_confidence_r": data.get("key_confidence_r"),
        "key_runner_up": data.get("key_runner_up"),
        "key_runner_up_r": data.get("key_runner_up_r"),
        "chroma_frames": data.get("chroma_frames"),
    }


@router.post("/analyze-cuda", response_model=AudioAnalysisResult)
async def analyze_audio_cuda(file: UploadFile = File(...)) -> AudioAnalysisResult:
    """Analyze audio file using GPU-accelerated CUDA when available, with CPU fallback."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    # Accepts audio and video alike: a dropped .mp4 is converted to .m4a
    # here, so the analysis routes work on video without a separate step.
    safe_name, _converted, _extraction, _deduped = await _store_track(file)
    file_path = AUDIO_DIR / safe_name
    # The stored name always begins with the content hash, so the job id is
    # read back from it. These endpoints used to bind `unique_id` from the
    # upload call itself; now that the call returns the chosen filename, the
    # id has to come from there or it is undefined at analysis time.
    unique_id = hash_prefix(safe_name) or str(uuid.uuid4())[:8]

    try:
        from ..services.audio_analyzer import (
            LIBROSA_AVAILABLE,
            SONARA_AVAILABLE,
            AudioAnalyzer,
        )

        if not LIBROSA_AVAILABLE:
            raise HTTPException(status_code=503, detail="librosa not installed")

        analyzer = AudioAnalyzer()

        # Load the audio once and run the librosa/GPU passes on that buffer --
        # this used to decode + beat-track the whole file twice per request.
        try:
            from tools.lib.audio import load_audio as _load_audio

            y, sr = _load_audio(str(file_path), sr=None)
        except Exception:
            y, sr = None, None

        # Try CUDA first, fall back to CPU.
        #
        # Ollama holds ~1.5 GB on this 8 GB card, which is enough to push the
        # spectral pass into a failure that silently drops to CPU at ~300x the
        # cost. Free VRAM first, then restore it in the finally block below so
        # a failed analysis still hands the GPU back.
        from ..services.vram_manager import vram_manager

        try:
            await vram_manager.begin_audio_analysis()
        except Exception as vram_exc:
            # Never fail the request over VRAM bookkeeping: CPU analysis still
            # produces a correct result, just slowly.
            logger.warning("VRAM preflight for audio analysis failed: %s", vram_exc)

        cuda_result = None
        cuda_error = None
        try:
            from ..services.audio_analyzer import analyze_with_cuda

            if y is not None:
                # CUDA spectral pass on the already-decoded audio; skip its beat
                # tracking since analyze_from_audio does that below.
                cuda_result = analyze_with_cuda(str(file_path), y=y, sr=sr, include_beats=False)
            else:
                cuda_result = analyze_with_cuda(str(file_path))
        except Exception as e:
            cuda_error = e
            cuda_result = None

        # A GPU->CPU drop costs roughly 300x on this track (0.3s vs ~92s
        # measured on a GTX 1070 Ti), so it must not be silent. Log at WARNING
        # so the error is visible at the default logging level, not hidden at DEBUG.
        if cuda_error is not None:
            logger.warning("CUDA error detected: %s", cuda_error)
            logger.warning(
                "CUDA analysis failed, falling back to CPU (~300x slower on this hardware): %s: %s",
                type(cuda_error).__name__,
                cuda_error,
            )
        elif cuda_result is None:
            logger.warning(
                "CUDA analysis returned no result, falling back to CPU "
                "(~300x slower on this hardware)"
            )

        if y is not None:
            # Beat tracking is the dominant cost, not the spectral pass: on a
            # 157 s track the CUDA spectral pass costs ~2.6 s but librosa's beat
            # tracker costs ~80 s. `analyze_from_audio` ignored the backend
            # argument entirely (it only recorded it as metadata), so this route
            # silently ran the slow tracker while reporting a GPU analysis.
            # sonara is a Rust extension and does the same job in well under a
            # second on the buffer already decoded here.
            result = analyzer.analyze_from_audio(
                y,
                sr,
                job_id=unique_id,
                audio_file=str(file_path),
                backend="cuda"
                if cuda_result and cuda_result.get("computed_on") == "GPU"
                else "librosa",
                beat_backend="sonara" if SONARA_AVAILABLE else None,
            )
        else:
            result = analyzer.analyze_file(str(file_path), job_id=unique_id, backend="sonara")

        analysis_result = _build_analysis_result(result, unique_id, file_path, analyzer)

        if cuda_result and cuda_result.get("computed_on") == "GPU":
            analysis_result["computed_on"] = "GPU"
            # Override the energy curve with CUDA spectral data when available
            # (downsampled to the same contract length -- it used to inject the
            # full-resolution array here).
            if cuda_result.get("amplitude_envelope"):
                analysis_result["energy_curve"] = [
                    round(float(v), 4)
                    for v in _downsample_curve(
                        cuda_result["amplitude_envelope"], _ENERGY_CURVE_POINTS
                    )
                ]
                analysis_result["amplitude_envelope"] = [
                    round(float(v), 4)
                    for v in _downsample_curve(cuda_result["amplitude_envelope"], _ENVELOPE_POINTS)
                ]
                analysis_result["timing_contract"]["energyCurve"] = [
                    {
                        "time": round(
                            float(i)
                            * analysis_result["duration_seconds"]
                            / max(len(analysis_result["energy_curve"]) - 1, 1),
                            3,
                        ),
                        "value": v,
                    }
                    for i, v in enumerate(analysis_result["energy_curve"])
                ]
                analysis_result["timing_contract"]["amplitudeEnvelope"] = analysis_result[
                    "amplitude_envelope"
                ]
        else:
            analysis_result["computed_on"] = "CPU"

        await _apply_llm_sections(
            analysis_result,
            result,
            (cuda_result or {}).get("rms_energy")
            or (
                result.waveform.rms_energy if result.waveform and result.waveform.rms_energy else []
            ),
        )

        # Save full analysis (see the note in analyze_audio: index.json is not written)
        analysis_file = ANALYSIS_DIR / f"{unique_id}_analysis.json"
        with open(analysis_file, "w", encoding="utf-8") as f:
            json.dump(analysis_result, f, indent=2, ensure_ascii=False)

        return AudioAnalysisResult(**analysis_result)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}") from e
    finally:
        # Hand VRAM back. In the finally so a failed analysis still restores
        # Ollama - otherwise one bad request leaves it offloaded until the next
        # process restart. Guarded because this runs on the error path too, and
        # a bookkeeping failure must not mask the real error above.
        try:
            vram_end = await vram_manager.end_audio_analysis()
            if vram_end.get("actions"):
                logger.info("Audio analysis VRAM handover: %s", vram_end["actions"])
        except Exception as vram_exc:
            logger.warning("VRAM restore after audio analysis failed: %s", vram_exc)


@router.get("/timing-metadata/{filename:path}")
async def get_timing_metadata(filename: str):
    """Get Remotion-ready timing metadata for a file.

    Returns a TimingContract with beat events, section boundaries, energy
    curve, amplitude envelope, and visualization hints. Optimized for AI
    agents and Remotion renderers.
    """
    import urllib.parse

    filename = urllib.parse.unquote(filename)

    if ".." in filename or filename.startswith("/"):
        raise HTTPException(status_code=400, detail="Invalid filename")

    data = await get_analysis_by_filename(filename)
    tc = data.get("timing_contract")
    if not tc:
        raise HTTPException(
            status_code=404, detail="No timing metadata found -- run audio analysis first"
        )
    return tc


@router.get("/hyperframes-payload/{filename:path}")
async def get_hyperframes_payload(filename: str, fps: int = 30, bands: int = 16):
    """Return deterministic embedded audio data for HyperFrames compositions."""
    import urllib.parse

    filename = urllib.parse.unquote(filename)
    if ".." in filename or filename.startswith("/"):
        raise HTTPException(status_code=400, detail="Invalid filename")
    from ..services.storyboard_hyperframes import build_hyperframes_audio_payload
    from ..services.transcription import get_transcript_path

    analysis = await get_analysis_by_filename(filename)
    transcript = None
    transcript_path = get_transcript_path(filename)
    if transcript_path.exists():
        transcript = json.loads(transcript_path.read_text(encoding="utf-8"))
    try:
        return build_hyperframes_audio_payload(analysis, transcript, fps=fps, bands=bands)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/spectral-timeline/{filename:path}")
async def get_spectral_timeline(
    filename: str,
    fps: int = 24,
    sr: int = 22050,
    hop_length: int = 512,
    n_fft: int = 2048,
):
    """Get dense frame-accurate spectral timeline for visualization binding.

    Returns per-frame sub/mid/high band energies, transient flags, spectral
    centroid, and RMS -- the "data bridge" for Remotion/WebGL uniform binding.
    Deterministic per-frame, no real-time analysis bottleneck.
    """
    import urllib.parse

    filename = urllib.parse.unquote(filename)

    if ".." in filename or filename.startswith("/"):
        raise HTTPException(status_code=400, detail="Invalid filename")

    normalized = filename.replace("\\", "/")
    if normalized.startswith(str(AUDIO_DIR).replace("\\", "/")):
        normalized = str(Path(normalized).relative_to(AUDIO_DIR).as_posix())

    audio_path = AUDIO_DIR / normalized
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail=f"Audio file not found: {filename}")

    # Disk cache keyed by (path, params); the stored fingerprint (mtime+size)
    # invalidates automatically if the file is replaced in place.
    cache_key = hashlib.sha1(f"{normalized}|{fps}|{sr}|{hop_length}|{n_fft}".encode()).hexdigest()
    cache_path = SPECTRAL_CACHE_DIR / f"{cache_key}.json"
    try:
        st = audio_path.stat()
        fingerprint = {"mtime_ns": st.st_mtime_ns, "size": st.st_size}
        if cache_path.exists():
            cached_doc = json.loads(cache_path.read_text(encoding="utf-8"))
            if cached_doc.get("fingerprint") == fingerprint:
                return cached_doc["payload"]
    except (OSError, ValueError, KeyError):
        pass

    from tools.lib.audio import load_audio

    from ..services.spectral_bands import analyze_audio_bands

    # Decode + full-track STFT are CPU-bound and used to run inline in the
    # event loop, freezing every other request for seconds.
    y, sr_loaded = await asyncio.to_thread(load_audio, str(audio_path), sr)
    raw_frames = await asyncio.to_thread(analyze_audio_bands, y, sr_loaded, hop_length, n_fft)

    from tools.export_spectral_timeline import resample_timeline_to_fps

    timeline = await asyncio.to_thread(
        resample_timeline_to_fps, raw_frames, sr_loaded, hop_length, fps
    )

    payload = {
        "audio_file": str(audio_path.resolve()),
        "duration_seconds": round(len(y) / sr_loaded, 3),
        "sample_rate": sr_loaded,
        "fps": fps,
        "hop_length": hop_length,
        "n_fft": n_fft,
        "frame_count": len(timeline),
        "bands": {"sub": [20, 120], "mid": [500, 2000], "high": [4000, 16000]},
        "timeline": timeline,
    }
    try:
        cache_path.write_text(
            json.dumps({"fingerprint": fingerprint, "payload": payload}),
            encoding="utf-8",
        )
    except OSError:
        pass  # cache is best-effort
    return payload


@router.get("/analysis/by-filename/{filename:path}")
async def get_analysis_by_filename(filename: str):
    """Get cached analysis for an audio file by filename."""
    import urllib.parse

    filename = urllib.parse.unquote(filename)

    if ".." in filename or filename.startswith("/"):
        raise HTTPException(status_code=400, detail="Invalid filename")

    # Normalize to relative POSIX path from AUDIO_DIR for subdirectory support
    normalized = filename.replace("\\", "/")
    if normalized.startswith(str(AUDIO_DIR).replace("\\", "/")):
        normalized = str(Path(normalized).relative_to(AUDIO_DIR).as_posix())

    # Check in-memory cache first (fastest)
    cached = _cache_get(normalized, "")
    if cached is not None:
        if not _analysis_is_stale(cached):
            return cached
        # Drop the stale entry rather than serving it; the caller is expected to
        # re-analyze, and leaving it in place would make every poll re-check.
        logger.info(
            f"Cached analysis for '{normalized}' is stale "
            f"(schema < {ANALYSIS_SCHEMA_VERSION}); treating as missing."
        )
        _cache_delete(normalized, "")

    # Check database second
    from ..core import database

    db_analysis = database.get_audio_analysis(normalized)
    if db_analysis and not _analysis_is_stale(db_analysis):
        # Populate cache
        _cache_set(normalized, db_analysis, "")
        return db_analysis
    if db_analysis:
        logger.info(
            f"Stored analysis for '{normalized}' is stale "
            f"(schema < {ANALYSIS_SCHEMA_VERSION}); treating as missing."
        )

    # Fallback: try basename for backward compatibility with old entries
    if "/" in normalized:
        basename = Path(normalized).name
        if basename != normalized:
            db_analysis = database.get_audio_analysis(basename)
            if db_analysis and not _analysis_is_stale(db_analysis):
                _cache_set(normalized, db_analysis, "")
                return db_analysis

    # Fallback: resolve directly against the files on disk. The JSON index is
    # deliberately NOT consulted. It grew to ~62 keys pointing at only 17 files,
    # so most of its entries were dangling, and every lookup still needed three
    # regex passes plus a glob to work around it. Scanning the directory and
    # applying the explicit policy in `analysis_resolver` is deterministic, has
    # a single defined order, and can explain a miss instead of guessing.
    resolution = resolve_analysis(normalized, _analysis_candidates(), ANALYSIS_SCHEMA_VERSION)
    if resolution.match is None:
        logger.warning(f"No cached analysis for '{normalized}': {resolution.reason}")
        raise HTTPException(status_code=404, detail="No cached analysis found for this file")

    with open(resolution.match.path, encoding="utf-8") as f:
        data = json.load(f)

    _cache_set(normalized, data, "")
    return data


@router.get("/analysis/{job_id}")
async def get_analysis_result(request: Request, job_id: str):
    """Get the result of an audio analysis job by job ID."""
    if not ANALYSIS_DIR.exists():
        raise HTTPException(status_code=404, detail="No analysis results found")

    # Resolve by job id instead of globbing. `glob(...)[0]` depended on
    # directory iteration order and returned a pre-v2 file when one matched,
    # which is exactly the stale result the by-filename route refuses to serve.
    resolution = resolve_by_job_id(job_id, _analysis_candidates(), ANALYSIS_SCHEMA_VERSION)
    if resolution.match is None:
        logger.info(f"No analysis for job '{job_id}': {resolution.reason}")
        raise HTTPException(status_code=404, detail="Analysis result not found")

    # CORS is handled by the app-wide allowlist middleware; echoing the
    # request Origin here would bypass that policy.
    return FileResponse(str(resolution.match.path), media_type="application/json")


@router.get("/files")
async def list_uploaded_audio():
    """List all uploaded audio files, deduplicated by display name."""
    files = []
    if AUDIO_DIR.exists():
        seen_names = set()
        for f in sorted(AUDIO_DIR.rglob("*"), key=lambda x: x.stat().st_mtime, reverse=True):
            if (
                f.is_file()
                and f.suffix.lower() in ALLOWED_EXTENSIONS
                and not f.name.startswith(".")
            ):
                # Deduplicate by display name -- strip ALL 8-hex hash prefixes (files may have 2-3)
                import re

                display_name = re.sub(r"^([0-9a-f]{8}_)+", "", f.name, flags=re.IGNORECASE)
                if display_name in seen_names:
                    continue
                seen_names.add(display_name)
                stat = f.stat()
                relative = f.relative_to(AUDIO_DIR).as_posix()
                parent = str(Path(relative).parent) if Path(relative).parent != Path(".") else ""
                files.append(
                    {
                        "filename": f.name,
                        "relative_path": relative,
                        "size_bytes": stat.st_size,
                        "modified": stat.st_mtime,
                        "folder": parent,
                    }
                )
    return {"files": files}


@router.post("/ensure-analysis")
async def ensure_analysis(body: EnsureAnalysisRequest):
    """Ensure analysis exists for a file -- run analysis if not cached.
    Used by frontend features that depend on analysis data."""
    filename = body.filename
    backend = body.backend
    if not filename:
        raise HTTPException(status_code=400, detail="filename required")

    if ".." in filename or filename.startswith("/"):
        raise HTTPException(status_code=400, detail="Invalid filename")

    # Normalize to relative POSIX path from AUDIO_DIR (supports subdirectory files)
    normalized = filename.replace("\\", "/")
    if normalized.startswith(str(AUDIO_DIR).replace("\\", "/")):
        normalized = str(Path(normalized).relative_to(AUDIO_DIR).as_posix())

    # Check database first (persistent across restarts).
    # Only accept a cached entry if it was computed with the same backend,
    # otherwise silently re-analyze so backend choice is respected.
    from ..core import database

    db_analysis = database.get_audio_analysis(normalized)
    if db_analysis and not _analysis_is_stale(db_analysis):
        cached_backend = (
            db_analysis.get("timing_contract", {}).get("backend")
            or (db_analysis.get("metadata") or {}).get("backend")
            or ""
        )
        if cached_backend == backend:
            _cache_set(normalized, db_analysis, backend)
            _cache_set(normalized, db_analysis, "")
            return {"status": "cached", "analysis": db_analysis}
    elif db_analysis:
        logger.info(
            f"Stored analysis for '{normalized}' is stale "
            f"(schema < {ANALYSIS_SCHEMA_VERSION}); treating as missing."
        )

    # Backward compatibility: try basename for old entries
    if "/" in normalized:
        basename = Path(normalized).name
        if basename != normalized:
            db_analysis = database.get_audio_analysis(basename)
            if db_analysis and not _analysis_is_stale(db_analysis):
                cached_backend = (
                    db_analysis.get("timing_contract", {}).get("backend")
                    or (db_analysis.get("metadata") or {}).get("backend")
                    or ""
                )
                if cached_backend == backend:
                    _cache_set(normalized, db_analysis, backend)
                    _cache_set(normalized, db_analysis, "")
                    return {"status": "cached", "analysis": db_analysis}

    # Check if already cached on disk. This used to read `index.json` and serve
    # whatever it pointed at with no schema check, then `update_audio_analysis`
    # wrote that result into the database -- so a pre-v2 file was not merely
    # served, it was persisted and became the sticky answer for every later
    # request, including the by-filename route. The resolver refuses unstamped
    # files, so a stale entry now falls through to a real analysis.
    resolution = resolve_analysis(normalized, _analysis_candidates(), ANALYSIS_SCHEMA_VERSION)
    if resolution.match is not None:
        with open(resolution.match.path, encoding="utf-8") as f:
            data = json.load(f)
            # Also save to database for future requests
            database.update_audio_analysis(normalized, data)
            # Populate in-memory cache so subsequent GET requests hit memory
            _cache_set(normalized, data, backend)
            _cache_set(normalized, data, "")
            return {"status": "cached", "analysis": data}
    logger.info(f"Re-analyzing '{normalized}': {resolution.reason}")

    # Find the audio file
    file_path = AUDIO_DIR / normalized
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"Audio file not found: {filename}")

    # Run analysis
    _check_backend_available(backend)

    try:
        unique_id = str(uuid.uuid4())[:8]
        from ..services.audio_analyzer import AudioAnalyzer

        analyzer = AudioAnalyzer()
        result = analyzer.analyze_file(str(file_path), job_id=unique_id, backend=backend)
        analysis_result = _build_analysis_result(result, unique_id, file_path, analyzer)

        # Best-effort LLM section refinement
        try:
            rms_for_llm = (
                result.waveform.rms_energy if result.waveform and result.waveform.rms_energy else []
            )
            await _apply_llm_sections(analysis_result, result, rms_for_llm)
        except Exception as e:
            logger.warning(
                "LLM section refinement failed for ensure-analysis: %s", e, exc_info=True
            )

        # Save the analysis file (index.json is not written; see analyze_audio).
        analysis_file = ANALYSIS_DIR / f"{unique_id}_analysis.json"
        with open(analysis_file, "w", encoding="utf-8") as f:
            json.dump(analysis_result, f, indent=2, ensure_ascii=False)

        logger.info(
            f"Analysis completed for '{normalized}': {analysis_result['tempo_bpm']} BPM, {analysis_result['beat_count']} beats"
        )

        # Save to database for persistence between server restarts
        from ..core import database

        database.update_audio_analysis(normalized, analysis_result)
        # Populate in-memory cache
        _cache_set(normalized, analysis_result, backend)
        _cache_set(normalized, analysis_result, "")

        return {"status": "analyzed", "analysis": analysis_result}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Analysis failed for '{normalized}': {e}")
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}") from e


@router.post("/analyze-all")
async def analyze_all_pending(backend: str = "sonara"):
    """Analyze all audio files in the media library that don't have analysis data.

    Returns a job_id immediately and processes in the background. Progress is
    broadcast via SSE on /api/events (event type ``audio_analysis_progress``)
    so the frontend can show real-time progress instead of hanging on a long
    request. Poll ``/api/audio/analyze-all/status/{job_id}`` for final status.
    """
    from ..core import database
    from ..services.audio_analyzer import LIBROSA_AVAILABLE, AudioAnalyzer

    if not LIBROSA_AVAILABLE:
        raise HTTPException(status_code=503, detail="librosa not installed")

    if not AUDIO_DIR.exists():
        return {"status": "ok", "analyzed": 0, "total": 0, "files": [], "job_id": None}

    # Get all audio files recursively (matches list_uploaded_audio behavior)
    audio_files = [
        f
        for f in AUDIO_DIR.rglob("*")
        if f.is_file() and f.suffix.lower() in ALLOWED_EXTENSIONS and not f.name.startswith(".")
    ]

    # Determine which files actually need analysis (skip cached ones)
    pending_files = []
    for file_path in audio_files:
        filename = _relative_audio_path(file_path)
        existing = database.get_audio_analysis(filename)
        if existing and existing.get("beat_times"):
            continue
        resolution = resolve_analysis(filename, _analysis_candidates(), ANALYSIS_SCHEMA_VERSION)
        if resolution.match is not None:
            continue
        pending_files.append(file_path)

    job_id = str(uuid.uuid4())

    async def _run():
        analyzer = AudioAnalyzer()
        analyzed_files = []
        errors = []
        total = len(pending_files)

        for i, file_path in enumerate(pending_files, 1):
            filename = _relative_audio_path(file_path)

            # Broadcast progress before starting this file
            await sse_manager.broadcast(
                "audio_analysis_progress",
                {
                    "job_id": job_id,
                    "file": filename,
                    "index": i,
                    "total": total,
                    "percent": round((i - 1) / max(total, 1) * 100, 1),
                    "status": "processing",
                    "analyzed": len(analyzed_files),
                    "errors": len(errors),
                },
            )

            await _analyze_all_job_set(
                job_id,
                status="running",
                progress=round((i - 1) / max(total, 1) * 100, 1),
                message=f"Analyzing {filename} ({i}/{total})",
                current_file=filename,
                analyzed=len(analyzed_files),
                errors=len(errors),
                total=total,
            )

            try:
                unique_id = str(uuid.uuid4())[:8]
                result = analyzer.analyze_file(str(file_path), job_id=unique_id, backend=backend)
                analysis_result = _build_analysis_result(result, unique_id, file_path, analyzer)

                # Best-effort LLM section refinement
                try:
                    rms_for_llm = (
                        result.waveform.rms_energy
                        if result.waveform and result.waveform.rms_energy
                        else []
                    )
                    await _apply_llm_sections(analysis_result, result, rms_for_llm)
                except Exception as e:
                    logger.warning(
                        "LLM section refinement failed for analyze-all: %s", e, exc_info=True
                    )

                # Save to database
                database.update_audio_analysis(filename, analysis_result)

                # Also save to JSON file for backward compatibility
                analysis_file = ANALYSIS_DIR / f"{unique_id}_analysis.json"
                with open(analysis_file, "w", encoding="utf-8") as f:
                    json.dump(analysis_result, f, indent=2, ensure_ascii=False)

                # Populate caches
                _cache_set(filename, analysis_result, "")
                _cache_set(filename, analysis_result, backend)

                analyzed_files.append(
                    {
                        "filename": filename,
                        "bpm": analysis_result["tempo_bpm"],
                        "beats": analysis_result["beat_count"],
                        "confidence": analysis_result["confidence"],
                    }
                )
            except Exception as e:
                errors.append({"filename": filename, "error": str(e)})
                logger.warning(f"Failed to analyze '{filename}': {e}")

            # Broadcast progress after completing this file
            await sse_manager.broadcast(
                "audio_analysis_progress",
                {
                    "job_id": job_id,
                    "file": filename,
                    "index": i,
                    "total": total,
                    "percent": round(i / max(total, 1) * 100, 1),
                    "status": "completed",
                    "analyzed": len(analyzed_files),
                    "errors": len(errors),
                },
            )

        # Final state
        await _analyze_all_job_set(
            job_id,
            status="completed" if not errors else "completed_with_errors",
            progress=100.0,
            message=(
                f"Analyzed {len(analyzed_files)}/{total} files"
                + (f", {len(errors)} errors" if errors else "")
            ),
            analyzed_files=analyzed_files,
            errors=errors,
            analyzed=len(analyzed_files),
            total=total,
        )

        await sse_manager.broadcast(
            "audio_analysis_complete",
            {
                "job_id": job_id,
                "analyzed": len(analyzed_files),
                "total": total,
                "errors": len(errors),
                "files": analyzed_files,
            },
        )

    asyncio.create_task(_run())

    await _analyze_all_job_set(
        job_id,
        status="pending",
        progress=0.0,
        message=f"Queued {len(pending_files)} files for analysis",
        current_file=None,
        analyzed=0,
        errors=0,
        total=len(pending_files),
    )

    return {
        "status": "queued",
        "job_id": job_id,
        "total": len(pending_files),
        "message": f"Analysis queued for {len(pending_files)} files",
    }


@router.get("/analyze-all/status/{job_id}")
async def analyze_all_status(job_id: str):
    """Get the status of an analyze-all job."""
    job = await _analyze_all_job_get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    return job


@router.get("/analyze-all/stream/{job_id}")
async def analyze_all_stream(job_id: str) -> EventSourceResponse:
    """SSE stream for real-time analyze-all progress.

    Connect with EventSource to receive per-file progress events
    (``audio_analysis_progress``) and a final completion event
    (``audio_analysis_complete``).
    """

    async def event_generator():
        # Send current job state immediately
        job = await _analyze_all_job_get(job_id)
        if job is None:
            yield {
                "event": "error",
                "data": json.dumps({"message": f"Job {job_id} not found"}),
            }
            return

        yield {
            "event": "job_state",
            "data": json.dumps(job),
        }

        # Connect to SSE manager for live updates
        queue = await sse_manager.connect()
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30.0)
                    yield event
                except TimeoutError:
                    yield ":keep-alive\n\n"
        finally:
            await sse_manager.disconnect(queue)

    return EventSourceResponse(event_generator())


def _agent_profile_from_cached(data: dict) -> dict:
    """Build a lightweight agent profile from cached analysis JSON.

    Used when the original audio file is no longer on disk and we cannot
    re-run librosa. Returns the same schema as ``profile_for_file`` but
    with ``None`` for fields that require raw audio.
    """
    spectral = data.get("spectral", {}) or {}
    sections = data.get("sections", []) or []
    beat_times = data.get("beat_times", []) or []
    duration = float(data.get("duration_seconds") or 0.0)
    tempo = float(data.get("tempo_bpm") or 0.0)
    tc = data.get("timing_contract", {}) or {}
    timing_sections = tc.get("sections", []) or sections

    band_energy = {}
    raw_bands = data.get("band_energy_pct")
    if isinstance(raw_bands, dict):
        band_energy = {k: float(v) for k, v in raw_bands.items() if isinstance(v, (int, float))}

    centroid = spectral.get("centroid_mean")
    rolloff = spectral.get("rolloff_mean")
    zcr = spectral.get("zcr_mean")

    # Infer some fields from cached data
    high_energy = any(s.get("energy", 0) > 0.65 for s in timing_sections)
    has_chorus = any(s.get("type") == "chorus" for s in timing_sections)

    energy_level = "medium"
    if tempo > 135 and high_energy:
        energy_level = "very high"
    elif high_energy or tempo > 120:
        energy_level = "high"
    elif tempo > 100:
        energy_level = "medium"
    else:
        energy_level = "low"

    mood: list[str] = []
    if band_energy.get("sub_20_120", 0) > 28 and energy_level in ("high", "very high"):
        mood.append("driving")
    if (centroid or 0) > 3000 and energy_level in ("high", "very high"):
        mood.append("aggressive")
    if has_chorus and energy_level == "medium":
        mood.append("balanced")
    if not mood:
        mood.append("neutral")

    scene_fit: list[str] = []
    if energy_level == "very high":
        scene_fit.extend(["action", "chase", "sports", "title_sequence"])
    elif energy_level == "high":
        scene_fit.extend(["promo", "trailer", "montage"])
    elif has_chorus:
        scene_fit.extend(["narrative", "emotional_peak"])
    elif energy_level == "low":
        scene_fit.extend(["ambient", "credits", "slow_pan"])
    else:
        scene_fit.append("general")

    eq_preset = "flat"
    if band_energy.get("sub_20_120", 0) > 28 and (centroid or 0) > 3000:
        eq_preset = "warm"
    elif band_energy.get("sub_20_120", 0) > 28:
        eq_preset = "vocalPresence"
    elif (centroid or 0) > 3000:
        eq_preset = "bassBoost"
    elif energy_level == "low":
        eq_preset = "bright"

    cut_points = [
        s["end"] for s in timing_sections if s.get("type") in ("verse", "pre-chorus", "chorus")
    ]
    loop_candidates = [s["start"] for s in timing_sections if s.get("type") == "chorus"]
    best_loop = loop_candidates[0] if loop_candidates else beat_times[0] if beat_times else 0.0

    return {
        "file": data.get("relative_path") or data.get("stored_path", "unknown"),
        "path": data.get("stored_path"),
        "duration_seconds": duration,
        "tempo_bpm": tempo,
        "beat_count": data.get("beat_count", 0),
        "estimated_key": data.get("estimated_key"),
        "key_confidence": data.get("key_confidence"),
        # Raw correlation and runner-up: consumed by the chroma->hue palette
        # mapper (docs/architecture/chroma-hue-mapping.md). key_confidence alone
        # is the clamped display value and loses the sub-0.4 signal that drives
        # the neutral fallback.
        "key_confidence_r": data.get("key_confidence_r"),
        "key_runner_up": data.get("key_runner_up"),
        "key_runner_up_r": data.get("key_runner_up_r"),
        # Tier 2 chroma frames for per-frame palette shifts; absent on
        # pre-Tier-2 analyses, which the frontend treats as "no chroma".
        "chroma_frames": data.get("chroma_frames"),
        "dynamic_range_db": data.get("dynamic_range_db"),
        "band_energy_pct": band_energy,
        "spectral": {
            "centroid_mean": round(centroid) if centroid is not None else None,
            "rolloff_mean": round(rolloff) if rolloff is not None else None,
            "zcr_mean": round(zcr, 4) if zcr is not None else None,
        },
        "stereo_correlation": data.get("stereo_correlation"),
        "sections": timing_sections,
        "agent_profile": {
            "energy_level": energy_level,
            "moods": mood[:4],
            "scene_fit": scene_fit[:5],
            "suggested_eq_preset": eq_preset,
            "editing": {
                "cut_points_s": cut_points[:10],
                "best_loop_start_s": round(best_loop, 2),
                "estimated_best_intro_s": round(timing_sections[0]["end"], 2)
                if timing_sections
                else 0.0,
            },
            "description": (
                f"{tempo:.1f} BPM track, {duration:.1f}s, {energy_level} energy, "
                f"{', '.join(mood)}. "
                f"Scene fit: {', '.join(scene_fit[:3])}. "
                f"Suggested EQ preset: {eq_preset}."
            ),
        },
    }


@router.get("/agent-profile/{filename:path}")
async def get_agent_profile(filename: str):
    """Return an agent-facing audio profile for *filename*.

    Compact, plain-language-friendly view of tempo, key, energy, spectral
    balance, section labels, scene fit, and EQ suggestions -- optimized for
    AI agents that cannot process raw audio themselves.
    """
    import urllib.parse

    filename = urllib.parse.unquote(filename)

    if ".." in filename or filename.startswith("/"):
        raise HTTPException(status_code=400, detail="Invalid filename")

    data = await get_analysis_by_filename(filename)
    stored = data.get("stored_path") or data.get("relative_path")
    if stored:
        # Resolve relative paths against AUDIO_DIR, not the process CWD.
        stored_path = Path(stored)
        if not stored_path.is_absolute():
            stored_path = AUDIO_DIR / stored_path
        if stored_path.exists():
            try:
                from tools.audio_agent_profile import profile_for_file

                return profile_for_file(str(stored_path))
            except Exception as exc:
                logger.warning("agent-profile re-analysis failed for %s: %s", stored, exc)
    return _agent_profile_from_cached(data)


class CleanupRequest(BaseModel):
    """Request for cleaning up orphaned analysis files."""

    keep_days: int = 30
    remove_orphans: bool = True


@router.post("/cleanup")
async def cleanup_audio_files(body: CleanupRequest | None = None) -> dict:
    """Remove orphaned and aged analysis cache files.

    Analysis JSONs in ``output/audio_analysis/`` accumulate with no expiry:
    every /analyze, /analyze-cuda and /ensure-analysis writes a new
    ``{id}_analysis.json`` and nothing ever removes it. This endpoint removes:

    1. Analysis files whose source audio no longer exists in ``output/audio/``
       (orphans from deleted or renamed tracks).
    2. Analysis files older than ``keep_days``.

    Returns the count and names of removed files plus any errors.
    """
    opts = body or CleanupRequest()
    removed: list[dict] = []
    errors: list[dict] = []

    if not ANALYSIS_DIR.exists():
        return {"removed": 0, "files": [], "errors": []}

    cutoff = time.time() - (opts.keep_days * 86400)

    for analysis_file in sorted(ANALYSIS_DIR.glob("*_analysis.json")):
        try:
            should_remove = False
            reason = ""
            unique_id = analysis_file.stem.removesuffix("_analysis")

            if opts.remove_orphans:
                matching_audio = _find_by_content_id(AUDIO_DIR, unique_id)
                if matching_audio is None:
                    should_remove = True
                    reason = "orphaned (source audio missing)"

            if not should_remove and analysis_file.stat().st_mtime < cutoff:
                should_remove = True
                reason = f"older than {opts.keep_days} days"

            if should_remove:
                analysis_file.unlink()
                removed.append({"filename": analysis_file.name, "reason": reason})
                # Evict from the in-memory cache so stale entries stop being served
                _cache_delete_by_content_id(unique_id)
        except Exception as e:
            errors.append({"filename": analysis_file.name, "error": str(e)})

    return {
        "removed": len(removed),
        "files": removed,
        "errors": errors,
    }
