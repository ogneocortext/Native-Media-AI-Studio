"""
Audio upload and analysis API routes.
Handles file uploads for music video creation and audio analysis.
"""

from __future__ import annotations

import hashlib
import json
import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

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


def _find_by_content_id(audio_dir: Path, content_id: str) -> Path | None:
    """Return an already-stored file whose name carries `content_id`, if any.

    Sorted so the answer does not depend on directory iteration order when a
    duplicate pair somehow exists.
    """
    if not audio_dir.exists():
        return None
    prefix = f"{content_id}_"
    matches = sorted(
        p for p in audio_dir.iterdir() if p.is_file() and p.name.startswith(prefix)
    )
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
        tmp_path.replace(final_path)   # atomic within the same volume
    except Exception as e:
        tmp_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}") from e
    return final_path.name


def _is_downbeat(index: int, beats_per_bar: int = 4) -> bool:
    """Return True when this beat index is a strong downbeat.

    Uses meter-aware detection by default (``beats_per_bar`` from beat regularity
    analysis), falling back to 4/4 when unavailable.
    """
    return index % beats_per_bar == 0


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
    """Upload a track — audio is stored as-is; video is converted to .m4a.

    A dropped `.mp4` used to be rejected outright, which made Suno drafts
    invisible: the library listing and `analyze-all` both filter on
    ALLOWED_EXTENSIONS, so a video in `output/audio/` was never listed, never
    analyzed and never playable. Video is now converted to .m4a here so dropping
    a file into the app is all it takes to add a track.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    safe_name, was_converted, extraction, deduped = await _store_track(file)
    file_path = AUDIO_DIR / safe_name
    size = file_path.stat().st_size

    if not was_converted:
        return AudioUploadResponse(
            success=True,
            filename=file.filename,
            stored_path=str(file_path),
            size_bytes=size,
            message=f"Audio file uploaded successfully ({size // 1024} KB)",
            deduplicated=deduped,
        )

    how = "stream copy" if extraction and extraction.lossless else "re-encoded to AAC"
    verb = "Added (already in library)" if deduped else "Converted"
    return AudioUploadResponse(
        success=True,
        filename=file_path.name,
        stored_path=str(file_path),
        size_bytes=size,
        message=(
            f"{verb}: {file.filename} -> {file_path.name} ({how}, {size // 1024} KB)"
        ),
        converted=True,
        source_filename=file.filename,
        lossless=bool(extraction and extraction.lossless),
        deduplicated=deduped,
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
        existing = _find_by_content_id(AUDIO_DIR, audio_id)
        if existing is not None:
            deduped = True
        else:
            final_path = AUDIO_DIR / f"{audio_id}_{stem}.m4a"
            converted.replace(final_path)
            deduped = False

        return existing.name if existing is not None else final_path.name, result, deduped
    finally:
        src.unlink(missing_ok=True)
        if converted is not None:
            converted.unlink(missing_ok=True)


async def _store_track(file: UploadFile) -> tuple[str, bool, ExtractionResult | None, bool]:
    """Store an audio *or* video upload in the library.

    Returns `(stored_filename, converted, extraction_result, deduplicated)`.
    Shared by /upload, /analyze and /analyze-cuda so a dropped .mp4 works on
    every path — previously only /upload learned about video, so the analysis
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
            # Beat tracking is the dominant cost, not the spectral pass: on a
            # 157 s track the CUDA spectral pass costs ~2.6 s but librosa's beat
            # tracker costs ~80 s. `analyze_from_audio` ignored the backend
            # argument entirely (it only recorded it as metadata), so this route
            # silently ran the slow tracker while reporting a GPU analysis.
            # sonara is a Rust extension and does the same job in well under a
            # second on the buffer already decoded here.
            result = analyzer.analyze_from_audio(
                y, sr, job_id=unique_id, audio_file=str(file_path),
                backend="cuda" if cuda_result and cuda_result.get("computed_on") == "GPU" else "librosa",
                beat_backend="sonara" if SONARA_AVAILABLE else None,
            )
        else:
            result = analyzer.analyze_file(str(file_path), job_id=unique_id, backend="sonara")

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

    # Fallback: resolve directly against the files on disk. The JSON index is
    # deliberately NOT consulted. It grew to ~62 keys pointing at only 17 files,
    # so most of its entries were dangling, and every lookup still needed three
    # regex passes plus a glob to work around it. Scanning the directory and
    # applying the explicit policy in `analysis_resolver` is deterministic, has
    # a single defined order, and can explain a miss instead of guessing.
    resolution = resolve_analysis(
        normalized, _analysis_candidates(), ANALYSIS_SCHEMA_VERSION
    )
    if resolution.match is None:
        logger.warning(f"No cached analysis for '{normalized}': {resolution.reason}")
        raise HTTPException(
            status_code=404, detail="No cached analysis found for this file"
        )

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

    # Check if already cached on disk. This used to read `index.json` and serve
    # whatever it pointed at with no schema check, then `update_audio_analysis`
    # wrote that result into the database — so a pre-v2 file was not merely
    # served, it was persisted and became the sticky answer for every later
    # request, including the by-filename route. The resolver refuses unstamped
    # files, so a stale entry now falls through to a real analysis.
    resolution = resolve_analysis(
        normalized, _analysis_candidates(), ANALYSIS_SCHEMA_VERSION
    )
    if resolution.match is not None:
        with open(resolution.match.path, encoding="utf-8") as f:
            data = json.load(f)
            # Also save to database for future requests
            database.update_audio_analysis(normalized, data)
            return {"status": "cached", "analysis": data}
    logger.info(
        f"Re-analyzing '{normalized}': {resolution.reason}"
    )

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

        # Save the analysis file (index.json is not written; see analyze_audio).
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

    return {
        "status": "completed",
        "analyzed": len(analyzed_files),
        "total": len(audio_files),
        "files": analyzed_files,
        "errors": errors,
    }




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


