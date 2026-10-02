"""
Audio upload and analysis API routes.
Handles file uploads for music video creation and audio analysis.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import shutil
import subprocess
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ..core.config import PROJECT_ROOT

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

# Stem separation (source_separation, SEPARATION_DIR, source_separator,
# urllib.parse, typing.Any) moved to app/api/audio_stems.py; main.py includes
# that router alongside this one, so the /api/audio paths are unchanged.

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/audio", tags=["Audio"])

AUDIO_DIR = PROJECT_ROOT / "output" / "audio"
AUDIO_DIR.mkdir(parents=True, exist_ok=True)
ANALYSIS_DIR = PROJECT_ROOT / "output" / "audio_analysis"
ANALYSIS_DIR.mkdir(parents=True, exist_ok=True)
ANALYSIS_INDEX = ANALYSIS_DIR / "index.json"


async def _store_upload(file: UploadFile) -> str:
    """Stream an upload to AUDIO_DIR and return its content-derived id.

    The id is sha256(content)[:8], not a random uuid. A random id meant every
    upload of the same track produced a different filename, a different
    database row and a different index entry - and because each request then
    arrived under a new name, the analysis cache could never hit. A content hash
    makes the identity stable, so the same audio always resolves to the same
    file and the same cached analysis.

    Writes to a temporary name first and renames on success, so a failed or
    oversized upload never leaves a half-written file under a real name.
    """
    digest = hashlib.sha256()
    size = 0
    tmp_path = AUDIO_DIR / (uuid.uuid4().hex + ".upload")
    try:
        with open(tmp_path, "wb") as buffer:
            while chunk := await file.read(8192):
                size += len(chunk)
                if size > MAX_FILE_SIZE:
                    raise HTTPException(
                        status_code=413,
                        detail=f"File too large. Maximum size: {MAX_FILE_SIZE // (1024*1024)} MB",
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
    final_path = AUDIO_DIR / f"{unique_id}_{file.filename}"
    try:
        tmp_path.replace(final_path)   # atomic within the same volume
    except Exception as e:
        tmp_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}") from e
    return unique_id


def _is_downbeat(index: int, beats_per_bar: int = 4) -> bool:
    """Return True when this beat index is a strong downbeat.

    Uses meter-aware detection by default (``beats_per_bar`` from beat regularity
    analysis), falling back to 4/4 when unavailable.
    """
    return index % beats_per_bar == 0


def _load_analysis_index() -> dict:
    """Load the analysis index mapping filenames to job IDs."""
    if ANALYSIS_INDEX.exists():
        try:
            with open(ANALYSIS_INDEX, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def _save_analysis_index(index: dict) -> None:
    """Save the analysis index."""
    with open(ANALYSIS_INDEX, "w", encoding="utf-8") as f:
        json.dump(index, f, indent=2, ensure_ascii=False)


def _get_analysis_path(job_id: str) -> Path:
    """Get the path to an analysis JSON file."""
    return ANALYSIS_DIR / f"{job_id}_analysis.json"


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
    """Store value in cache, evicting oldest entry if over limit."""
    key = f"{filename}:{backend}"
    if len(_analysis_cache) >= _cache_max_size:
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


ALLOWED_EXTENSIONS = {".mp3", ".wav", ".flac", ".ogg", ".opus", ".m4a", ".wma", ".aac"}
MAX_FILE_SIZE = 500 * 1024 * 1024  # 500 MB


class AudioUploadResponse(BaseModel):
    """Response model for audio upload"""
    success: bool
    filename: str
    stored_path: str
    size_bytes: int
    message: str


class AudioAnalysisResponse(BaseModel):
    """Response model for audio analysis request"""
    job_id: str
    status: str
    message: str


class AudioAnalysisResult(BaseModel):
    """Response model for completed audio analysis — now energy-aware (2026)"""
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
    stored_path: str | None = None
    job_id: str | None = None
    beats_truncated: bool = False  # True when beat_times hit the response cap
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


@router.get("/backends")
async def list_audio_backends():
    """List available audio analysis backends."""
    from ..services.audio_analyzer import (
        LIBROSA_AVAILABLE,
        MADMOM_AVAILABLE,
        SONARA_AVAILABLE,
    )
    return {
        "available": [b for b, avail in [
            ("sonara", SONARA_AVAILABLE),
            ("madmom", MADMOM_AVAILABLE),
            ("librosa", LIBROSA_AVAILABLE),
        ] if avail],
        "default": "sonara" if SONARA_AVAILABLE else "librosa",
    }


@router.get("/analysis/summary/{filename}")
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
        "has_spectral": bool(data.get("spectral") or data.get("spectral_centroid") or data.get("spectral_rolloff")),
        "job_id": data.get("job_id"),
        "stored_path": data.get("stored_path"),
    }


@router.post("/upload", response_model=AudioUploadResponse)
async def upload_audio(file: UploadFile = File(...)) -> AudioUploadResponse:
    """Upload an audio file for music video creation."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    unique_id = await _store_upload(file)
    safe_name = f"{unique_id}_{file.filename}"
    file_path = AUDIO_DIR / safe_name
    size = file_path.stat().st_size

    return AudioUploadResponse(
        success=True,
        filename=file.filename,
        stored_path=str(file_path),
        size_bytes=size,
        message=f"Audio file uploaded successfully ({size // 1024} KB)",
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

    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Invalid file type")

    unique_id = await _store_upload(file)
    safe_name = f"{unique_id}_{file.filename}"
    file_path = AUDIO_DIR / safe_name

    try:
        _check_backend_available(backend)

        from ..services.audio_analyzer import AudioAnalyzer

        analyzer = AudioAnalyzer()
        result = analyzer.analyze_file(str(file_path), job_id=unique_id, backend=backend)
        analysis_result = _build_analysis_result(result, unique_id, file_path, analyzer)

        # Cache the analysis index
        index = _load_analysis_index()
        index[safe_name] = unique_id
        _save_analysis_index(index)

        # Save full analysis
        analysis_file = ANALYSIS_DIR / f"{unique_id}_analysis.json"
        with open(analysis_file, "w", encoding="utf-8") as f:
            json.dump(analysis_result, f, indent=2, ensure_ascii=False)

        return AudioAnalysisResult(**analysis_result)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}") from e


@router.post("/analyze-cuda", response_model=AudioAnalysisResult)
async def analyze_audio_cuda(file: UploadFile = File(...)) -> AudioAnalysisResult:
    """Analyze audio file using GPU-accelerated CUDA when available, with CPU fallback."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Invalid file type")

    unique_id = await _store_upload(file)
    safe_name = f"{unique_id}_{file.filename}"
    file_path = AUDIO_DIR / safe_name

    try:
        from ..services.audio_analyzer import LIBROSA_AVAILABLE, AudioAnalyzer
        if not LIBROSA_AVAILABLE:
            raise HTTPException(status_code=503, detail="librosa not installed")

        analyzer = AudioAnalyzer()

        # Load the audio once and run the librosa/GPU passes on that buffer —
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
        # measured on a GTX 1070 Ti), so it must not be silent. This used to
        # log at DEBUG, which is invisible at default level - the endpoint
        # simply reported no computed_on and ran CPU-bound with no explanation.
        if cuda_error is not None:
            logger.warning(
                "CUDA analysis failed, falling back to CPU (~300x slower on "
                "this hardware): %s: %s",
                type(cuda_error).__name__, cuda_error,
            )
        elif cuda_result is None:
            logger.warning(
                "CUDA analysis returned no result, falling back to CPU "
                "(~300x slower on this hardware)"
            )

        if y is not None:
            result = analyzer.analyze_from_audio(
                y, sr, job_id=unique_id, audio_file=str(file_path),
                backend="cuda" if cuda_result and cuda_result.get("computed_on") == "GPU" else "librosa",
            )
        else:
            result = analyzer.analyze_file(str(file_path), job_id=unique_id)

        analysis_result = _build_analysis_result(result, unique_id, file_path, analyzer)

        if cuda_result and cuda_result.get("computed_on") == "GPU":
            analysis_result["computed_on"] = "GPU"
            # Override the energy curve with CUDA spectral data when available
            # (downsampled to the same contract length — it used to inject the
            # full-resolution array here).
            if cuda_result.get("amplitude_envelope"):
                analysis_result["energy_curve"] = [
                    round(float(v), 4)
                    for v in _downsample_curve(cuda_result["amplitude_envelope"], _ENERGY_CURVE_POINTS)
                ]
                analysis_result["amplitude_envelope"] = [
                    round(float(v), 4)
                    for v in _downsample_curve(cuda_result["amplitude_envelope"], _ENVELOPE_POINTS)
                ]
                analysis_result["timing_contract"]["energyCurve"] = [
                    {
                        "time": round(float(i) * analysis_result["duration_seconds"] / max(len(analysis_result["energy_curve"]) - 1, 1), 3),
                        "value": v,
                    }
                    for i, v in enumerate(analysis_result["energy_curve"])
                ]
                analysis_result["timing_contract"]["amplitudeEnvelope"] = analysis_result["amplitude_envelope"]
        else:
            analysis_result["computed_on"] = "CPU"

        await _apply_llm_sections(
            analysis_result,
            result,
            (cuda_result or {}).get("rms_energy")
            or (result.waveform.rms_energy if result.waveform and result.waveform.rms_energy else []),
        )

        # Cache the analysis index
        index = _load_analysis_index()
        index[safe_name] = unique_id
        _save_analysis_index(index)

        # Save full analysis
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


@router.get("/timing-metadata/{filename}")
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
        raise HTTPException(status_code=404, detail="No timing metadata found — run audio analysis first")
    return tc


@router.get("/hyperframes-payload/{filename:path}")
async def get_hyperframes_payload(filename: str, fps: int = 30, bands: int = 16):
    """Return deterministic embedded audio data for HyperFrames compositions."""
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
    centroid, and RMS — the "data bridge" for Remotion/WebGL uniform binding.
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

    from tools.lib.audio import load_audio

    from ..services.spectral_bands import analyze_audio_bands

    y, sr_loaded = load_audio(str(audio_path), sr=sr)
    raw_frames = analyze_audio_bands(y, sr=sr_loaded, hop_length=hop_length, n_fft=n_fft)

    from tools.export_spectral_timeline import resample_timeline_to_fps

    timeline = resample_timeline_to_fps(raw_frames, sr_loaded, hop_length, fps)

    return {
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

    # Fallback to JSON file index
    index = _load_analysis_index()

    # Try exact match first
    job_id = index.get(normalized)

    # Fallback: try matching by display name (strip hash prefixes)
    if not job_id:
        display_name = re.sub(r'^([0-9a-f]{8}_)+', '', normalized, flags=re.IGNORECASE)
        for key, val in index.items():
            key_display = re.sub(r'^([0-9a-f]{8}_)+', '', key, flags=re.IGNORECASE)
            if key_display == display_name:
                job_id = val
                logger.info(f"Analysis fallback match: '{normalized}' -> '{key}'")
                break

    # Fallback 2: try partial match (filename without extension)
    if not job_id:
        stem = Path(normalized).stem
        for key, val in index.items():
            if stem in key or key.startswith(stem[:20]):
                job_id = val
                logger.info(f"Analysis partial match: '{normalized}' -> '{key}'")
                break

    if not job_id:
        logger.warning(f"No cached analysis for '{normalized}'. Index keys: {list(index.keys())[:5]}...")
        raise HTTPException(status_code=404, detail="No cached analysis found for this file")

    analysis_path = _get_analysis_path(job_id)
    if not analysis_path.exists():
        # Try finding by glob pattern
        matches = list(ANALYSIS_DIR.glob(f"{job_id[:8]}*_analysis.json"))
        if matches:
            analysis_path = matches[0]
        else:
            raise HTTPException(status_code=404, detail="Analysis file missing")

    with open(analysis_path, encoding="utf-8") as f:
        data = json.load(f)

    # The JSON index is the last-resort fallback, and its files predate the
    # version stamp just as the database rows do. It needs the same staleness
    # check as the DB path above, otherwise an unstamped result loaded from here
    # is still served - and then cached, making it sticky.
    if _analysis_is_stale(data):
        logger.info(
            f"Indexed analysis for '{normalized}' (job {job_id}) is stale "
            f"(schema < {ANALYSIS_SCHEMA_VERSION}); treating as missing."
        )
        raise HTTPException(
            status_code=404, detail="No cached analysis found for this file"
        )

    # Cache the JSON-index result too — previously only the DB path populated
    # the cache, so every request re-read (and re-parsed) the analysis file.
    _cache_set(normalized, data, "")
    return data


@router.get("/analysis/{job_id}")
async def get_analysis_result(request: Request, job_id: str):
    """Get the result of an audio analysis job by job ID."""
    if not ANALYSIS_DIR.exists():
        raise HTTPException(status_code=404, detail="No analysis results found")

    # Prefix match (job ids are the 8-char file prefix) — a substring match
    # could return an unrelated file whose hash happens to contain the id.
    for json_file in ANALYSIS_DIR.glob(f"{job_id[:8]}*_analysis.json"):
        # CORS is handled by the app-wide allowlist middleware; echoing the
        # request Origin here would bypass that policy.
        return FileResponse(str(json_file), media_type="application/json")

    raise HTTPException(status_code=404, detail="Analysis result not found")


@router.get("/files")
async def list_uploaded_audio():
    """List all uploaded audio files, deduplicated by display name."""
    files = []
    if AUDIO_DIR.exists():
        seen_names = set()
        for f in sorted(AUDIO_DIR.rglob("*"), key=lambda x: x.stat().st_mtime, reverse=True):
            if f.is_file() and f.suffix.lower() in ALLOWED_EXTENSIONS and not f.name.startswith("."):
                # Deduplicate by display name — strip ALL 8-hex hash prefixes (files may have 2-3)
                import re
                display_name = re.sub(r'^([0-9a-f]{8}_)+', '', f.name, flags=re.IGNORECASE)
                if display_name in seen_names:
                    continue
                seen_names.add(display_name)
                stat = f.stat()
                relative = f.relative_to(AUDIO_DIR).as_posix()
                parent = str(Path(relative).parent) if Path(relative).parent != Path(".") else ""
                files.append({
                    "filename": f.name,
                    "relative_path": relative,
                    "size_bytes": stat.st_size,
                    "modified": stat.st_mtime,
                    "folder": parent,
                })
    return {"files": files}


@router.post("/ensure-analysis")
async def ensure_analysis(body: EnsureAnalysisRequest):
    """Ensure analysis exists for a file — run analysis if not cached.
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
    if db_analysis:
        cached_backend = (
            db_analysis.get("timing_contract", {}).get("backend")
            or (db_analysis.get("metadata") or {}).get("backend")
            or ""
        )
        if cached_backend == backend:
            _cache_set(normalized, db_analysis, backend)
            return {"status": "cached", "analysis": db_analysis}

    # Backward compatibility: try basename for old entries
    if "/" in normalized:
        basename = Path(normalized).name
        if basename != normalized:
            db_analysis = database.get_audio_analysis(basename)
            if db_analysis:
                cached_backend = (
                    db_analysis.get("timing_contract", {}).get("backend")
                    or (db_analysis.get("metadata") or {}).get("backend")
                    or ""
                )
                if cached_backend == backend:
                    _cache_set(normalized, db_analysis, backend)
                    return {"status": "cached", "analysis": db_analysis}

    # Check if already cached in JSON index
    index = _load_analysis_index()
    job_id = index.get(normalized)

    # Backward compatibility: try basename in index
    if not job_id and "/" in normalized:
        basename = Path(normalized).name
        if basename != normalized:
            job_id = index.get(basename)

    if job_id:
        analysis_path = _get_analysis_path(job_id)
        if analysis_path.exists():
            with open(analysis_path, encoding="utf-8") as f:
                data = json.load(f)
                # Also save to database for future requests
                database.update_audio_analysis(normalized, data)
                return {"status": "cached", "analysis": data}

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
            rms_for_llm = result.waveform.rms_energy if result.waveform and result.waveform.rms_energy else []
            await _apply_llm_sections(analysis_result, result, rms_for_llm)
        except Exception as e:
            logger.debug("LLM section refinement failed for ensure-analysis: %s", e, exc_info=True)

        # Save to index and file
        index[normalized] = unique_id
        _save_analysis_index(index)

        analysis_file = ANALYSIS_DIR / f"{unique_id}_analysis.json"
        with open(analysis_file, "w", encoding="utf-8") as f:
            json.dump(analysis_result, f, indent=2, ensure_ascii=False)

        logger.info(f"Analysis completed for '{normalized}': {analysis_result['tempo_bpm']} BPM, {analysis_result['beat_count']} beats")

        # Save to database for persistence between server restarts
        from ..core import database
        database.update_audio_analysis(normalized, analysis_result)
        # Populate in-memory cache
        _cache_set(normalized, analysis_result, backend)

        return {"status": "analyzed", "analysis": analysis_result}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Analysis failed for '{normalized}': {e}")
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}") from e


@router.post("/analyze-all")
async def analyze_all_pending(backend: str = "sonara"):
    """Analyze all audio files in the media library that don't have analysis data.
    Returns a summary of analyzed files."""
    from ..core import database
    from ..services.audio_analyzer import LIBROSA_AVAILABLE, AudioAnalyzer

    if not LIBROSA_AVAILABLE:
        raise HTTPException(status_code=503, detail="librosa not installed")

    if not AUDIO_DIR.exists():
        return {"status": "ok", "analyzed": 0, "total": 0, "files": []}

    analyzer = AudioAnalyzer()
    analyzed_files = []
    errors = []

    # Load the index once — it used to be re-read + rewritten for every file.
    index = _load_analysis_index()

    # Get all audio files recursively (matches list_uploaded_audio behavior)
    audio_files = [
        f for f in AUDIO_DIR.rglob("*")
        if f.is_file() and f.suffix.lower() in ALLOWED_EXTENSIONS and not f.name.startswith(".")
    ]

    for file_path in audio_files:
        # Index keys are AUDIO_DIR-relative POSIX paths (same form the read
        # endpoints normalize to) — previously basenames, which split the index
        # for files in subdirectories like output/audio/Suno-V6-Mini/.
        filename = _relative_audio_path(file_path)
        # Skip if already analyzed in database
        existing = database.get_audio_analysis(filename)
        if existing and existing.get("beat_times"):
            continue

        _check_backend_available(backend)

        try:
            unique_id = str(uuid.uuid4())[:8]
            result = analyzer.analyze_file(str(file_path), job_id=unique_id, backend=backend)
            analysis_result = _build_analysis_result(result, unique_id, file_path, analyzer)

            # Best-effort LLM section refinement
            try:
                rms_for_llm = result.waveform.rms_energy if result.waveform and result.waveform.rms_energy else []
                await _apply_llm_sections(analysis_result, result, rms_for_llm)
            except Exception as e:
                logger.debug("LLM section refinement failed for analyze-all: %s", e, exc_info=True)

            # Save to database
            database.update_audio_analysis(filename, analysis_result)

            # Also save to JSON file for backward compatibility
            index[filename] = unique_id
            analysis_file = ANALYSIS_DIR / f"{unique_id}_analysis.json"
            with open(analysis_file, "w", encoding="utf-8") as f:
                json.dump(analysis_result, f, indent=2, ensure_ascii=False)

            analyzed_files.append({
                "filename": filename,
                "bpm": analysis_result["tempo_bpm"],
                "beats": analysis_result["beat_count"],
                "confidence": analysis_result["confidence"],
            })
        except Exception as e:
            errors.append({"filename": filename, "error": str(e)})
            logger.warning(f"Failed to analyze '{filename}': {e}")

    # Persist the index once (progress is durable per file via the DB writes).
    _save_analysis_index(index)

    return {
        "status": "completed",
        "analyzed": len(analyzed_files),
        "total": len(audio_files),
        "files": analyzed_files,
        "errors": errors,
    }


class RenameAudioRequest(BaseModel):
    """Request model for renaming an audio file."""
    old_filename: str
    new_filename: str


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

    cut_points = [s["end"] for s in timing_sections if s.get("type") in ("verse", "pre-chorus", "chorus")]
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
                "estimated_best_intro_s": round(timing_sections[0]["end"], 2) if timing_sections else 0.0,
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
    balance, section labels, scene fit, and EQ suggestions — optimized for
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
                logger.debug("agent-profile re-analysis failed for %s: %s", stored, exc)
    return _agent_profile_from_cached(data)


class ExtractAudioRequest(BaseModel):
    """Extract the audio track from a video file into the audio library.

    Optional `start`/`end` (seconds) extract only that segment directly,
    saving a round-trip through the trim endpoint. Omit both for the full
    audio track.
    """
    source_path: str  # output-relative ("video/foo.mp4") or absolute under PROJECT_ROOT
    format: str = "original"  # "original" = lossless stream copy (best quality); "mp3" = re-encode
    bitrate: str = "192k"  # only used when format == "mp3": one of 128k, 192k, 320k
    start: float | None = None  # segment start in seconds (default 0)
    end: float | None = None    # segment end in seconds (default: end of stream)


def _find_ffmpeg() -> str | None:
    for name in ("ffmpeg", "ffmpeg.exe"):
        found = shutil.which(name)
        if found:
            return found
    return None


# Source audio codec -> container that supports a lossless stream copy.
_COPY_CONTAINER = {
    "aac": ".m4a",
    "alac": ".m4a",
    "mp3": ".mp3",
    "opus": ".opus",
    "vorbis": ".ogg",
    "flac": ".flac",
    "pcm_s16le": ".wav",
    "pcm_s24le": ".wav",
    "pcm_s32le": ".wav",
    "pcm_f32le": ".wav",
    "ac3": ".ac3",
    "eac3": ".eac3",
}


@router.post("/extract", response_model=dict)
async def extract_audio_from_video(body: ExtractAudioRequest) -> dict:
    """Extract a video's audio track to `output/audio/<name>.<ext>`.

    `format="original"` (default) probes the source audio codec first and
    remuxes it bit-for-bit into a matching container — no quality loss,
    near-instant, no wasted runs. `format="mp3"` re-encodes with libmp3lame
    at `bitrate`. Powers the Media Library "Extract Audio" panel — the result
    lands in the audio library so it can be analyzed on the Audio Analysis page.

    Optional `start`/`end` (seconds) extract only that segment in one ffmpeg
    pass, avoiding a second trim call.
    """
    from ..services.ffmpeg_tools import probe_media

    raw = (body.source_path or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="source_path is required")
    fmt = (body.format or "original").lower()
    if fmt not in ("original", "m4a", "mp3"):
        raise HTTPException(status_code=400, detail='format must be "original" or "mp3"')
    if fmt == "m4a":
        fmt = "original"  # legacy alias from the first iteration
    if fmt == "mp3" and body.bitrate not in ("128k", "192k", "320k"):
        raise HTTPException(status_code=400, detail="bitrate must be 128k, 192k or 320k")

    root = PROJECT_ROOT.resolve()
    candidate = Path(raw)
    src = (candidate if candidate.is_absolute() else (root / "output" / raw)).resolve()
    if not str(src).startswith(str(root)) or ".." in Path(raw).parts:
        raise HTTPException(status_code=400, detail="Invalid source_path")
    if not src.exists() or not src.is_file():
        raise HTTPException(status_code=404, detail=f"Source file not found: {body.source_path}")
    if src.suffix.lower() not in (".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi"):
        raise HTTPException(status_code=400, detail=f"Not a video file: {src.name}")

    ffmpeg = _find_ffmpeg()
    if not ffmpeg:
        raise HTTPException(status_code=500, detail="ffmpeg not found on PATH")

    # Segment bounds (None = full stream).
    seg_start: float | None = body.start if body.start is not None else None
    seg_end: float | None = body.end if body.end is not None else None
    if seg_start is not None and seg_start < 0:
        raise HTTPException(status_code=400, detail="start must be >= 0")
    if seg_start is not None and seg_end is not None and seg_end <= seg_start:
        raise HTTPException(status_code=400, detail="end must be > start")

    # Detect — don't guess: probe the actual audio codec before choosing a container.
    probe = await probe_media(src)
    audio_codec: str | None = None
    audio_rate: str | None = None
    for st in (probe.get("streams") or []):
        if st.get("codec_type") == "audio":
            audio_codec = (st.get("codec_name") or "").lower() or None
            sr = st.get("sample_rate")
            audio_rate = str(sr) if sr else None
            break
    if not audio_codec:
        raise HTTPException(status_code=400, detail=f"No audio track in {src.name}")

    def _fmt_ts(seconds: float | None) -> str:
        if seconds is None:
            return "end"
        m = int(seconds // 60)
        s = int(seconds % 60)
        return f"{m:02d}-{s:02d}"

    stem = re.sub(r"[^A-Za-z0-9_\- .()\[\]]", "", src.stem).strip() or "extracted"
    if seg_start is not None or seg_end is not None:
        stem = f"{stem}_{_fmt_ts(seg_start)}_to_{_fmt_ts(seg_end)}"
    lossless = False
    if fmt == "mp3":
        ext, cmd_mode = ".mp3", "encode"
    else:
        ext = _COPY_CONTAINER.get(audio_codec)
        cmd_mode = "copy" if ext else "encode-fallback"
        if not ext:
            ext = ".m4a"  # AAC-encode fallback below
    dst = AUDIO_DIR / f"{stem}{ext}"
    n = 1
    while dst.exists():
        n += 1
        dst = AUDIO_DIR / f"{stem}_{n}{ext}"

    def _cmd(mode: str) -> list[str]:
        # Segment flags go before -i for fast seek; for stream copy this is
        # accurate enough (cuts on packet boundaries). For re-encode we could
        # place -ss after -i for frame accuracy, but the current use cases
        # (music/voice) tolerate sub-frame drift at the edges.
        cmd = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error"]
        if seg_start is not None:
            cmd.extend(["-ss", str(seg_start)])
        cmd.extend(["-i", str(src)])
        if seg_end is not None:
            cmd.extend(["-to", str(seg_end)])
        cmd.extend(["-vn"])
        if mode == "copy":
            return [*cmd, "-c:a", "copy", str(dst)]
        if mode == "encode":
            return [*cmd, "-c:a", "libmp3lame", "-b:a", body.bitrate, str(dst)]
        return [*cmd, "-c:a", "aac", "-b:a", "192k", str(dst)]

    started = time.perf_counter()
    try:
        proc = await asyncio.to_thread(
            subprocess.run, _cmd(cmd_mode), capture_output=True, text=True, timeout=600,
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Audio extraction timed out") from None
    if proc.returncode == 0:
        lossless = cmd_mode == "copy"
    elif cmd_mode == "copy":
        # Container rejected the codec despite the map (e.g. odd muxer limits) —
        # one AAC-encode fallback so the user still gets audio.
        try:
            proc = await asyncio.to_thread(
                subprocess.run, _cmd("encode-fallback"), capture_output=True, text=True, timeout=600,
            )
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=504, detail="Audio extraction timed out") from None
    if proc.returncode != 0:
        tail = (proc.stderr or "").strip().splitlines()[-3:]
        detail = "; ".join(tail) if tail else "ffmpeg failed"
        raise HTTPException(status_code=400, detail=detail)
    if not dst.exists() or dst.stat().st_size == 0:
        raise HTTPException(status_code=400, detail=f"No audio track in {src.name}")

    # Best-effort segment duration: probe the output or derive from bounds.
    seg_duration: float | None = None
    try:
        out_probe = await probe_media(dst)
        seg_duration = float((out_probe.get("format") or {}).get("duration") or 0) or None
    except Exception:
        if seg_start is not None and seg_end is not None:
            seg_duration = max(0.0, seg_end - seg_start)
        elif seg_start is not None:
            src_dur = float((probe.get("format") or {}).get("duration") or 0)
            seg_duration = max(0.0, src_dur - seg_start)

    rel = dst.resolve().relative_to(root).as_posix()
    if rel.startswith("output/"):
        rel = rel[len("output/"):]  # output-relative, e.g. "audio/x.m4a" (getOutputUrl convention)
    return {
        "success": True,
        "filename": dst.name,
        "relative_path": rel,
        "stored_path": str(dst),
        "size_bytes": dst.stat().st_size,
        "render_s": round(time.perf_counter() - started, 1),
        "lossless": lossless,
        "source_codec": audio_codec,
        "source_sample_rate": audio_rate,
        "segment_start": seg_start,
        "segment_end": seg_end,
        "segment_duration": seg_duration,
        "message": f"Extracted {dst.name}",
    }


@router.post("/rename", response_model=dict)
async def rename_audio(body: RenameAudioRequest) -> dict:
    """Rename an audio file."""
    old_filename = body.old_filename
    new_filename = body.new_filename

    if not old_filename or not new_filename:
        raise HTTPException(status_code=400, detail="Both old_filename and new_filename are required")

    if ".." in old_filename or ".." in new_filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    # Security: resolve both paths and ensure they stay within AUDIO_DIR
    old_path = (AUDIO_DIR / old_filename).resolve()
    new_path = (AUDIO_DIR / new_filename).resolve()
    if not str(old_path).startswith(str(AUDIO_DIR.resolve())) or not old_path.is_file():
        raise HTTPException(status_code=404, detail=f"Audio file not found: {old_filename}")
    if not str(new_path).startswith(str(AUDIO_DIR.resolve())):
        raise HTTPException(status_code=400, detail="New path escapes audio directory")

    if new_path.exists():
        raise HTTPException(status_code=409, detail=f"A file with that name already exists: {new_filename}")

    old_path.rename(new_path)

    return {"success": True, "old_filename": old_filename, "new_filename": new_filename}


class TrimRange(BaseModel):
    """One [start, end) interval in seconds."""
    start: float
    end: float


class TrimAudioRequest(BaseModel):
    """Cut or keep time ranges of an audio library file, saving the result as new file."""
    filename: str  # existing file in output/audio
    mode: str = "keep"  # "keep" = save only ranges[0]; "remove" = cut ranges out, keep the rest
    ranges: list[TrimRange]


def _clamp_merge_ranges(ranges: list[tuple[float, float]], duration: float) -> list[tuple[float, float]]:
    """Clamp intervals to [0, duration], drop empties, sort and merge overlaps."""
    cleaned: list[tuple[float, float]] = []
    for start, end in ranges:
        s = max(0.0, min(float(start), duration))
        e = max(0.0, min(float(end), duration))
        if e - s > 0.01:
            cleaned.append((s, e))
    cleaned.sort()
    merged: list[tuple[float, float]] = []
    for s, e in cleaned:
        if merged and s <= merged[-1][1] + 0.01:
            merged[-1] = (merged[-1][0], max(merged[-1][1], e))
        else:
            merged.append((s, e))
    return merged


@router.post("/trim", response_model=dict)
async def trim_audio(body: TrimAudioRequest) -> dict:
    """Trim an audio library file and save the edit as a NEW file in `output/audio`.

    `mode="keep"` saves a single `[start, end)` interval; `mode="remove"` cuts
    the given intervals out and concatenates what remains. Same container/codec
    via stream copy (`-c:a copy`) — fast and lossless; cuts land on packet
    boundaries. Powers the Audio Analysis "Trim" editor — the result lands back
    in the audio library so it can be analyzed or sent to Kinetic Typography.
    """
    from ..services.ffmpeg_tools import probe_media

    mode = (body.mode or "keep").lower()
    if mode not in ("keep", "remove"):
        raise HTTPException(status_code=400, detail='mode must be "keep" or "remove"')
    if not body.ranges:
        raise HTTPException(status_code=400, detail="At least one range is required")
    if mode == "keep" and len(body.ranges) != 1:
        raise HTTPException(status_code=400, detail='mode "keep" needs exactly one range')
    for r in body.ranges:
        if r.end <= r.start:
            raise HTTPException(status_code=400, detail="Each range needs end > start")
        if r.start < 0:
            raise HTTPException(status_code=400, detail="Range start must be >= 0")

    if not body.filename or ".." in body.filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    src = (AUDIO_DIR / body.filename).resolve()
    if not str(src).startswith(str(AUDIO_DIR.resolve())) or not src.exists() or not src.is_file():
        raise HTTPException(status_code=404, detail=f"Audio file not found: {body.filename}")
    if src.suffix.lower() not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported audio type: {src.suffix}")

    ffmpeg = _find_ffmpeg()
    if not ffmpeg:
        raise HTTPException(status_code=500, detail="ffmpeg not found on PATH")

    try:
        probe = await probe_media(src)
        duration = float((probe.get("format") or {}).get("duration") or 0)
    except Exception:
        duration = 0.0
    if duration <= 0:
        raise HTTPException(status_code=400, detail=f"Could not probe duration of {src.name}")

    merged = _clamp_merge_ranges([(r.start, r.end) for r in body.ranges], duration)
    if not merged:
        raise HTTPException(status_code=400, detail="Ranges fall outside the audio duration")
    if mode == "keep":
        kept = merged
    else:
        kept = []
        cursor = 0.0
        for s, e in merged:
            if s - cursor > 0.01:
                kept.append((cursor, s))
            cursor = max(cursor, e)
        if duration - cursor > 0.01:
            kept.append((cursor, duration))
        if not kept:
            raise HTTPException(status_code=400, detail="Removal covers the entire file — nothing left to save")
    if len(kept) == 1 and kept[0][0] <= 0.01 and kept[0][1] >= duration - 0.01:
        raise HTTPException(status_code=400, detail="Edit covers the full file — nothing to change")

    stem = re.sub(r"[^A-Za-z0-9_\- .()\[\]]", "", src.stem).strip() or "trimmed"
    ext = src.suffix.lower()
    dst = AUDIO_DIR / f"{stem}_trim{ext}"
    n = 1
    while dst.exists():
        n += 1
        dst = AUDIO_DIR / f"{stem}_trim_{n}{ext}"

    async def _run(cmd: list[str]) -> None:
        try:
            proc = await asyncio.to_thread(
                subprocess.run, cmd, capture_output=True, text=True, timeout=600,
            )
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=504, detail="Audio trim timed out") from None
        if proc.returncode != 0:
            tail = (proc.stderr or "").strip().splitlines()[-3:]
            detail = "; ".join(tail) if tail else "ffmpeg failed"
            raise HTTPException(status_code=400, detail=detail)

    started = time.perf_counter()
    tmpdir: Path | None = None
    try:
        if len(kept) == 1:
            s, e = kept[0]
            await _run([
                ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
                "-i", str(src), "-ss", f"{s:.3f}", "-t", f"{e - s:.3f}",
                "-vn", "-c:a", "copy", str(dst),
            ])
        else:
            import tempfile
            tmpdir = Path(tempfile.mkdtemp(prefix="trim_"))
            parts: list[str] = []
            for i, (s, e) in enumerate(kept):
                part = tmpdir / f"part{i:03d}{ext}"
                await _run([
                    ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
                    "-i", str(src), "-ss", f"{s:.3f}", "-t", f"{e - s:.3f}",
                    "-vn", "-c:a", "copy", str(part),
                ])
                parts.append(str(part))
            lst = tmpdir / "concat.txt"
            lst.write_text("".join(f"file '{p}'\n" for p in parts), encoding="utf-8")
            await _run([
                ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
                "-f", "concat", "-safe", "0", "-i", str(lst),
                "-c", "copy", str(dst),
            ])
    finally:
        if tmpdir is not None:
            shutil.rmtree(tmpdir, ignore_errors=True)
    if not dst.exists() or dst.stat().st_size == 0:
        raise HTTPException(status_code=400, detail="Trim produced no audio")

    try:
        out_probe = await probe_media(dst)
        out_duration = float((out_probe.get("format") or {}).get("duration") or 0)
    except Exception:
        out_duration = 0.0

    return {
        "success": True,
        "filename": dst.name,
        "stored_path": str(dst),
        "relative_path": dst.relative_to(AUDIO_DIR).as_posix(),
        "size_bytes": dst.stat().st_size,
        "duration": round(out_duration, 2),
        "source_filename": src.name,
        "source_duration": round(duration, 2),
        "mode": mode,
        "kept": [{"start": round(s, 2), "end": round(e, 2)} for s, e in kept],
        "lossless": True,
        "render_s": round(time.perf_counter() - started, 1),
        "message": f"Saved {dst.name}",
    }


@router.get("/file/{filename:path}")
async def serve_audio_file(request: Request, filename: str):
    """Serve an audio file by filename."""
    import urllib.parse

    # Decode URL-encoded filename (handles spaces, special chars)
    filename = urllib.parse.unquote(filename)

    # Security: prevent directory traversal via resolve check
    candidate = (AUDIO_DIR / filename).resolve()
    allowed_dirs = [AUDIO_DIR.resolve(), (PROJECT_ROOT / "output" / "audio").resolve()]
    if not any(str(candidate).startswith(str(d)) for d in allowed_dirs) or ".." in Path(filename).parts:
        raise HTTPException(status_code=400, detail="Invalid filename")
    file_path = candidate
    if not file_path.exists() or not file_path.is_file():
        alt_path = (PROJECT_ROOT / "output" / "audio" / filename).resolve()
        if str(alt_path).startswith(str(allowed_dirs[1])) and alt_path.exists() and alt_path.is_file():
            file_path = alt_path
        else:
            raise HTTPException(status_code=404, detail=f"Audio file not found: {filename}")

    # Determine media type based on extension
    ext = file_path.suffix.lower()
    media_types = {
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".flac": "audio/flac",
        ".ogg": "audio/ogg",
        ".opus": "audio/ogg",
        ".m4a": "audio/mp4",
        ".wma": "audio/x-ms-wma",
        ".aac": "audio/aac",
    }
    media_type = media_types.get(ext, "application/octet-stream")

    # CORS: allowlist local + public tunnel origins; omit ACAO for untrusted
    # origins. Use is_origin_allowed (not a raw get_all_origins lookup) so
    # randomized tunnel hostnames such as *.loca.lt are recognised.
    from ..core.cors import is_origin_allowed

    origin = request.headers.get("origin", "")
    cors_origin = origin if is_origin_allowed(origin) else ""
    headers: dict[str, str] = {
         "Accept-Ranges": "bytes",
         "Cache-Control": "public, max-age=3600",
    }
    if cors_origin:
        headers["Access-Control-Allow-Origin"] = cors_origin
    return FileResponse(
        str(file_path),
        media_type=media_type,
        filename=file_path.name,
        headers=headers,
    )
