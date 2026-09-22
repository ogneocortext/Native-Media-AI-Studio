"""
Audio upload and analysis API routes.
Handles file uploads for music video creation and audio analysis.
"""

from __future__ import annotations

import asyncio
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
from ..services.source_separation import SEPARATION_DIR, source_separator

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/audio", tags=["Audio"])

AUDIO_DIR = PROJECT_ROOT / "output" / "audio"
AUDIO_DIR.mkdir(parents=True, exist_ok=True)
ANALYSIS_DIR = PROJECT_ROOT / "output" / "audio_analysis"
ANALYSIS_DIR.mkdir(parents=True, exist_ok=True)
ANALYSIS_INDEX = ANALYSIS_DIR / "index.json"


def _is_downbeat(index: int, beats_per_bar: int = 4) -> bool:
    """Return True when this beat index is a strong downbeat.

    Uses the 4/4 assumption by default (every ``beats_per_bar``-th beat).
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
    stored_path: str | None = None
    job_id: str | None = None
    beats_truncated: bool = False  # True when beat_times hit the response cap
    # Timing contract (shared with frontend + Remotion + AI agents)
    timing_contract: dict | None = None
    # Suggested visualization parameters for AI/agent-driven presets
    suggested_visualization: str | None = None
    suggested_kinetic_preset: str | None = None
    suggested_theme_seed: str | None = None


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

    unique_id = str(uuid.uuid4())[:8]
    safe_name = f"{unique_id}_{file.filename}"
    file_path = AUDIO_DIR / safe_name

    size = 0
    try:
        with open(file_path, "wb") as buffer:
            while chunk := await file.read(8192):
                size += len(chunk)
                if size > MAX_FILE_SIZE:
                    file_path.unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=413,
                        detail=f"File too large. Maximum size: {MAX_FILE_SIZE // (1024*1024)} MB",
                    )
                buffer.write(chunk)
    except HTTPException:
        raise
    except Exception as e:
        file_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}") from e

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

    unique_id = str(uuid.uuid4())[:8]
    safe_name = f"{unique_id}_{file.filename}"
    file_path = AUDIO_DIR / safe_name

    try:
        with open(file_path, "wb") as buffer:
            size = 0
            while chunk := await file.read(8192):
                size += len(chunk)
                if size > MAX_FILE_SIZE:
                    file_path.unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=413,
                        detail=f"File too large. Maximum size: {MAX_FILE_SIZE // (1024*1024)} MB",
                    )
                buffer.write(chunk)

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

    unique_id = str(uuid.uuid4())[:8]
    safe_name = f"{unique_id}_{file.filename}"
    file_path = AUDIO_DIR / safe_name

    try:
        with open(file_path, "wb") as buffer:
            size = 0
            while chunk := await file.read(8192):
                size += len(chunk)
                if size > MAX_FILE_SIZE:
                    file_path.unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=413,
                        detail=f"File too large. Maximum size: {MAX_FILE_SIZE // (1024*1024)} MB",
                    )
                buffer.write(chunk)

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

        # Try CUDA first, fall back to CPU
        cuda_result = None
        try:
            from ..services.audio_analyzer import analyze_with_cuda
            if y is not None:
                # CUDA spectral pass on the already-decoded audio; skip its beat
                # tracking since analyze_from_audio does that below.
                cuda_result = analyze_with_cuda(str(file_path), y=y, sr=sr, include_beats=False)
            else:
                cuda_result = analyze_with_cuda(str(file_path))
        except Exception as e:
            logger.debug("CUDA analysis unavailable: %s", e)
            cuda_result = None

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


def _check_backend_available(backend: str) -> None:
    """Raise 503 if the requested analysis backend is not installed."""
    from ..services.audio_analyzer import (
        LIBROSA_AVAILABLE,
        MADMOM_AVAILABLE,
        SONARA_AVAILABLE,
    )
    backend = (backend or "sonara").lower()
    if backend == "sonara" and not SONARA_AVAILABLE:
        raise HTTPException(status_code=503, detail="sonara not installed. Run: pip install sonara")
    if backend == "madmom" and not MADMOM_AVAILABLE:
        raise HTTPException(status_code=503, detail="madmom-infer not installed. Run: pip install madmom-infer")
    if backend == "librosa" and not LIBROSA_AVAILABLE:
        raise HTTPException(status_code=503, detail="librosa not installed. Run: pip install librosa soundfile")
    if backend not in ("sonara", "madmom", "librosa"):
        raise HTTPException(status_code=400, detail=f"Unknown backend: {backend}. Choose sonara, madmom, or librosa.")


def _downsample_curve(curve, max_points):
    """Downsample a curve to at most `max_points` points via uniform sampling."""
    if not curve:
        return []
    if max_points < 2:
        return [curve[0]]
    if len(curve) <= max_points:
        return list(curve)
    indices = [int(round(i * (len(curve) - 1) / (max_points - 1))) for i in range(max_points)]
    return [curve[i] for i in indices]


def _rms_at_time(rms, sr, hop_length, time):
    if not rms:
        return 0.5
    frame = int(round(time * sr / hop_length))
    frame = max(0, min(frame, len(rms) - 1))
    return rms[frame]


_RESPONSE_SIZE_CONTRACT = """
Response-size contract for analysis payloads.
Historical bug: the full-resolution RMS envelope (~23k points on a 4-min
track) was emitted four times per response (~2.4 MB JSON) even though
``energy_curve`` is documented as "60-100 points for viz". Curves are now
downsampled once and reused; beats are capped at a level that covers long,
high-tempo tracks instead of silently dropping data at 800.
"""
_ENERGY_CURVE_POINTS = 100
_ENVELOPE_POINTS = 1024
_MAX_BEATS = 4000
# Spectral curves for visualization: 512 points keeps the payload small while
# preserving enough resolution for per-frame brightness/rolloff/noisiness lookups.
_SPECTRAL_POINTS = 512


def _build_analysis_result(
    result,
    unique_id: str,
    file_path: Path,
    analyzer,
) -> dict:
    """Build the standard analysis response dict from an AudioAnalysisResult."""
    tempo = result.beats.tempo_bpm if result.beats else 120.0
    duration = result.waveform.duration_seconds if result.waveform else 0.0
    beat_times_full = list(result.beats.beat_times) if result.beats else []
    onset_times_full = list(result.beats.onset_times) if result.beats else []
    confidence = result.beats.confidence if result.beats else 0.0
    envelope_full = list(result.waveform.amplitude_envelope) if result.waveform else []
    rms = result.waveform.rms_energy if result.waveform and result.waveform.rms_energy else []
    sr = result.waveform.sample_rate if result.waveform else 22050
    hop = analyzer.hop_length

    # Normalize raw RMS to 0..1 so BeatEvent.energy matches the shared contract
    # (it was previously raw RMS, i.e. ~0.05 instead of a 0-1 level).
    if rms:
        rms_peak = max(max(rms), 1e-10)
        rms_norm = [float(v) / rms_peak for v in rms]
    else:
        rms_norm = []

    sections = _generate_sections_from_analysis(
        duration=duration,
        tempo=tempo,
        beat_times=beat_times_full,
        onset_times=onset_times_full,
        rms_energy=rms,
        hop_length=analyzer.hop_length,
        sample_rate=sr,
    )

    # Downsample each curve exactly once and reuse it everywhere it appears.
    envelope = [round(float(v), 4) for v in _downsample_curve(envelope_full, _ENVELOPE_POINTS)]
    energy_curve = [round(float(v), 4) for v in _downsample_curve(envelope_full, _ENERGY_CURVE_POINTS)]

    beat_times = [round(float(t), 3) for t in beat_times_full[:_MAX_BEATS]]
    beats_truncated = len(beat_times_full) > _MAX_BEATS
    downbeat_times = (
        [round(float(t), 3) for t in (result.beats.downbeat_times or [])[:1000]] if result.beats else []
    )

    return {
        "tempo_bpm": round(float(tempo), 1),
        "duration_seconds": round(float(duration), 2),
        "beat_count": int(len(beat_times_full)),
        "beats_truncated": beats_truncated,
        "sections": sections,
        "beat_times": beat_times,
        "downbeat_times": downbeat_times,
        "onset_times": [round(float(t), 3) for t in onset_times_full[:800]],
        "energy_curve": energy_curve,
        "confidence": round(float(confidence), 3),
        "amplitude_envelope": envelope,
        "spectral": _spectral_summary(result),
        # Full spectral curves for visualization (downsampled to keep payload small).
        # Consumers that only need timbre summary should continue using ``spectral``.
        "spectral_centroid": [
            round(float(v), 3)
            for v in _downsample_curve(
                list(result.waveform.centroid or []), _SPECTRAL_POINTS
            )
        ],
        "spectral_rolloff": [
            round(float(v), 3)
            for v in _downsample_curve(
                list(result.waveform.spectral_rolloff or []), _SPECTRAL_POINTS
            )
        ],
        "spectral_bandwidth": [
            round(float(v), 3)
            for v in _downsample_curve(
                list(result.waveform.spectral_bandwidth or []), _SPECTRAL_POINTS
            )
        ],
        "zero_crossing_rate": [
            round(float(v), 3)
            for v in _downsample_curve(
                list(result.waveform.zero_crossing_rate or []), _SPECTRAL_POINTS
            )
        ],
        "stored_path": str(file_path),
        "relative_path": _relative_audio_path(file_path),
        "job_id": unique_id,
        "metadata": result.metadata,
        # Timing contract for frontend + Remotion + AI agents
        "timing_contract": {
            "filename": file_path.name,
            "duration": round(float(duration), 2),
            "bpm": round(float(tempo), 1),
            "bpmConfidence": round(float(confidence), 3),
            "beats": [
                {
                    "time": bt,
                    "drumType": None,
                    "energy": round(float(_rms_at_time(rms_norm, sr, hop, bt)), 4),
                    # 4/4 assumption — matches scripts/generate_timing_contract.py
                    # and the stillIRise reference contract (336 beats / 84 hits)
                    "isDownbeat": _is_downbeat(i),
                    "bpm": round(float(tempo), 1),
                }
                for i, bt in enumerate(beat_times)
            ],
            "sections": sections,
            "energyCurve": [
                {"time": round(float(i) * duration / max(len(energy_curve) - 1, 1), 3), "value": v}
                for i, v in enumerate(energy_curve)
            ],
            "amplitudeEnvelope": envelope,
        },
        # Visualization hints for AI-driven preset generation
        "suggested_visualization": _suggest_visualization(tempo, duration, sections, envelope_full),
        "suggested_kinetic_preset": _suggest_kinetic_preset(tempo, sections),
        "suggested_theme_seed": _suggest_theme_seed(sections, envelope_full),
    }


def _relative_audio_path(file_path: Path) -> str:
    """Return the AUDIO_DIR-relative POSIX path, tolerating external paths."""
    try:
        return file_path.relative_to(AUDIO_DIR).as_posix()
    except ValueError:
        return file_path.name


def _spectral_summary(result) -> dict:
    """Compact spectral statistics (means), so agents can reason about timbre.

    Only a handful of numbers per track — the full spectral curves stay in the
    analyzer's own JSON, never in this API payload.
    """
    wf = getattr(result, "waveform", None)
    if wf is None:
        return {}

    def _mean(values):
        vals = [float(v) for v in (values or []) if v is not None]
        if not vals:
            return None
        return round(sum(vals) / len(vals), 3)

    summary = {
        "centroid_mean": _mean(wf.centroid),
        "rolloff_mean": _mean(wf.spectral_rolloff),
        "bandwidth_mean": _mean(wf.spectral_bandwidth),
        "zcr_mean": _mean(wf.zero_crossing_rate),
    }
    return {k: v for k, v in summary.items() if v is not None}


def _suggest_visualization(tempo: float, duration: float, sections: list[dict], energy_curve: list[float]) -> str | None:
    """Suggest a visualization style based on track characteristics."""
    avg_energy = sum(energy_curve) / len(energy_curve) if energy_curve else 0.5
    if avg_energy > 0.65 and tempo > 135:
        return "geometric"
    if avg_energy > 0.65 and tempo <= 135:
        return "pulse"
    if avg_energy > 0.45 and tempo > 120:
        return "particles"
    if avg_energy < 0.4 and tempo < 100:
        return "aurora"
    if any(s.get("type") == "chorus" for s in sections) and avg_energy > 0.5:
        return "synthwave"
    if avg_energy < 0.35:
        return "cosmic"
    if tempo > 140:
        return "pulse"
    if tempo < 90:
        return "aurora"
    return "geometric"


def _suggest_kinetic_preset(tempo: float, sections: list[dict]) -> str | None:
    """Suggest a kinetic typography preset based on track characteristics."""
    has_chorus = any(s.get("type") == "chorus" for s in sections)
    if tempo > 140 and has_chorus:
        return "dubstep"
    if tempo > 130:
        return "cinematic"
    if tempo < 100:
        return "ambient"
    return "synthwave"


def _suggest_theme_seed(sections: list[dict], energy_curve: list[float]) -> str | None:
    """Suggest a theme seed string for AI-driven color generation."""
    avg_energy = sum(energy_curve) / len(energy_curve) if energy_curve else 0.5
    if avg_energy > 0.7:
        return "neon"
    if avg_energy < 0.35:
        return "ethereal"
    return "balanced"


def _generate_sections_from_analysis(
    duration: float,
    tempo: float,
    beat_times: list[float],
    onset_times: list[float],
    rms_energy: list[float],
    hop_length: int,
    sample_rate: int,
) -> list[dict]:
    """Energy-aware section generation from real librosa features.

    Uses RMS energy percentiles + positional priors + beat snapping +
    onset-density transitions. Falls back to uniform heuristic if energy unavailable.
    """
    if duration <= 0:
        return [{"type": "full", "start": 0.0, "end": 10.0, "energy": 0.5, "confidence": 0.5}]

    # Tempo-proportional beat-snap tolerance: half a beat, capped at 0.6s
    beat_tolerance = min(0.6, (60.0 / max(tempo, 1.0)) * 0.5) if tempo > 0 else 0.6

    # Estimate num sections from duration (~25s per section) + beat heuristic
    # Cap 8 to keep wizard manageable
    if beat_times and tempo > 0:
        # Prefer beat-based: ~32 beats per section (8 bars), adjusted for genre feel
        beats_per_section = 32.0
        if tempo > 150:
            beats_per_section = 24.0  # EDM/hip-hop: shorter sections
        elif tempo < 90:
            beats_per_section = 48.0  # Ambient: longer sections
        num_sections = max(4, min(8, round(len(beat_times) / beats_per_section)))
    else:
        num_sections = max(4, min(8, round(duration / 25))) or 4

    # If rms unavailable, fall back to uniform types
    if not rms_energy or len(rms_energy) < 10:
        section_types = ["intro", "verse", "chorus", "verse", "chorus", "bridge", "chorus", "outro"]
        sec_dur = duration / num_sections
        out = []
        for i in range(num_sections):
            s, e = i * sec_dur, min((i + 1) * sec_dur, duration)
            # snap to nearest beat
            if beat_times:
                s = min(beat_times, key=lambda b: abs(b - s)) if abs(min(beat_times, key=lambda b: abs(b - s)) - s) < beat_tolerance else s
                e = min(beat_times, key=lambda b: abs(b - e)) if abs(min(beat_times, key=lambda b: abs(b - e)) - e) < beat_tolerance else e
            t = section_types[min(i, len(section_types) - 1)]
            energy = 0.85 if "chorus" in t else 0.55 if "verse" in t else 0.35
            out.append({"type": t, "start": round(float(s), 2), "end": round(float(e), 2), "energy": round(float(energy), 3), "confidence": 0.6})
        return out

    # Compute mean energy per provisional section
    sec_dur = duration / num_sections
    provisional = []
    for i in range(num_sections):
        s, e = i * sec_dur, min((i + 1) * sec_dur, duration)
        # Map time -> rms index
        idx_s = int((s / duration) * len(rms_energy)) if duration > 0 else 0
        idx_e = int((e / duration) * len(rms_energy)) if duration > 0 else len(rms_energy)
        idx_s = max(0, min(idx_s, len(rms_energy) - 1))
        idx_e = max(idx_s + 1, min(idx_e, len(rms_energy)))
        window = rms_energy[idx_s:idx_e]
        mean_e = float(sum(window) / len(window)) if window else 0.0
        provisional.append((s, e, mean_e))

    # Normalize energies 0-1 for comparison
    energies = [p[2] for p in provisional]
    emin, emax = min(energies), max(energies)
    erange = (emax - emin) or 1.0
    # Percentile thresholds
    sorted_e = sorted(energies)
    p33 = sorted_e[len(sorted_e) // 3] if sorted_e else 0
    p66 = sorted_e[(len(sorted_e) * 2) // 3] if sorted_e else 0

    # Compute onset density per provisional section for transition detection
    def onset_density(t_start: float, t_end: float) -> int:
        if not onset_times:
            return 0
        return sum(1 for ot in onset_times if t_start <= ot <= t_end)

    onset_densities = [onset_density(s, e) for s, e, _ in provisional]
    max_onset = max(onset_densities) if onset_densities else 1

    sections = []
    for i, (s, e, mean_e) in enumerate(provisional):
        confidence = 0.7  # base confidence

        # Snap to nearest beat for clean cuts (except intro/outro boundaries)
        if beat_times and 0 < i < num_sections - 1:
            nearest_s = min(beat_times, key=lambda b: abs(b - s))
            if abs(nearest_s - s) < beat_tolerance:
                s = nearest_s
        if beat_times and i < num_sections - 1:
            nearest_e = min(beat_times, key=lambda b: abs(b - e))
            if abs(nearest_e - e) < beat_tolerance:
                e = nearest_e

        # Normalize energy 0-1
        norm = (mean_e - emin) / erange

        # Positional prior
        if i == 0:
            typ = "intro"
            confidence = 0.85
        elif i == num_sections - 1:
            typ = "outro"
            confidence = 0.85
        elif norm >= 0.66 or mean_e >= p66:
            typ = "chorus"
            confidence = 0.75 + norm * 0.2
        elif norm <= 0.33 or mean_e <= p33:
            # In middle, low energy + low onset density = bridge/interlude
            # High onset density + low energy = pre-chorus/build
            od = onset_densities[i] / max_onset if max_onset > 0 else 0
            mid_pos = i >= num_sections // 3 and i <= 2 * num_sections // 3
            if mid_pos and od < 0.4:
                typ = "bridge"
                confidence = 0.7
            elif od > 0.6:
                typ = "pre-chorus"
                confidence = 0.65
            else:
                typ = "interlude" if mid_pos else "verse"
                confidence = 0.6
        else:
            # Medium energy: verse or pre-chorus based on onset density
            od = onset_densities[i] / max_onset if max_onset > 0 else 0
            if od > 0.65 and i > 0 and i < num_sections - 1:
                typ = "pre-chorus"
                confidence = 0.65
            else:
                typ = "verse"
                confidence = 0.7

        # Energy for UI (0-1 normalized + boost for chorus/drop)
        ui_energy = round(min(1.0, max(0.05, (norm * 0.7 + 0.3) if typ in ("chorus", "drop") else norm * 0.6 + 0.2)), 3)

        sections.append({
            "type": typ,
            "start": round(float(s), 2),
            "end": round(float(e), 2),
            "energy": ui_energy,
            "confidence": round(min(1.0, confidence), 2),
        })

    # Ensure chronological and non-overlapping
    for i in range(1, len(sections)):
        if sections[i]["start"] < sections[i - 1]["end"]:
            sections[i]["start"] = sections[i - 1]["end"]
        if sections[i]["end"] <= sections[i]["start"]:
            sections[i]["end"] = round(min(duration, sections[i]["start"] + sec_dur * 0.8), 2)

    return sections


async def _generate_sections_llm(
    duration: float,
    tempo: float,
    beat_times: list[float],
    rms_energy: list[float],
    lyrics_hint: str = "",
) -> list[dict] | None:
    """Try LLM (deepseek-r1:7b → qwen3.5:4b fallback) to label sections semantically.
    Returns None on failure so caller can fall back to heuristic."""
    from ..core.config import config as app_config

    # Summarize energy curve (downsample to ~20 points for prompt)
    if rms_energy and len(rms_energy) > 20:
        step = len(rms_energy) / 20
        sampled = [rms_energy[int(i*step)] for i in range(20)]
    else:
        sampled = rms_energy or []
    energy_str = ", ".join(f"{v:.2f}" for v in sampled[:20])
    beat_count = len(beat_times)
    sys = (
        "You are a music structure analyzer. Given tempo, beat count, duration and "
        "normalized RMS energy curve (0-1, 20 samples over track), output ONLY JSON: "
        '{"sections":[{"type":"intro|verse|chorus|bridge|outro","start":0.0,"end":12.5,"energy":0.7}]} '
        "Rules: 4-8 sections, chronological, non-overlapping, cover 0..duration, "
        "energy 0-1 correlates with loudness. Use chorus for peaks, intro/outro for edges."
    )
    user = f"tempo: {tempo:.1f} BPM, beats: {beat_count}, duration: {duration:.1f}s, energy: [{energy_str}]{' lyrics: '+lyrics_hint[:200] if lyrics_hint else ''}"
    from ..core import ollama_client as _oc
    from ..core.text import strip_code_fences
    for model in ["deepseek-r1:7b", app_config.default_model, "qwen3.5:4b"]:
        try:
            # Some Ollama builds reject unknown keys like `think`; omit it.
            content = await _oc.chat_content(
                [{"role": "system", "content": sys}, {"role": "user", "content": user}],
                model=model,
                timeout=25,
                extra={"format": "json", "options": {"temperature": 0.2, "num_ctx": 4096}},
            )
            if not content:
                continue
            parsed = json.loads(strip_code_fences(content))
            secs = parsed.get("sections") if isinstance(parsed, dict) else parsed
            if isinstance(secs, list) and 2 <= len(secs) <= 8:
                # Validate and clamp
                out = []
                for s in secs:
                    if not isinstance(s, dict):
                        continue
                    typ = str(s.get("type", "verse")).lower()
                    if typ not in ("intro","verse","chorus","bridge","outro","pre-chorus","drop"):
                        typ = "verse"
                    out.append({
                        "type": typ,
                        "start": round(float(s.get("start", 0)), 2),
                        "end": round(float(s.get("end", duration)), 2),
                        "energy": round(max(0.05, min(1.0, float(s.get("energy", 0.5)))), 3),
                    })
                if not out:
                    continue
                out.sort(key=lambda x: x["start"])
                # Ensure coverage
                out[0]["start"] = 0.0
                out[-1]["end"] = round(duration, 2)
                return out
        except Exception:
            continue
    return None


async def _apply_llm_sections(analysis_result: dict, result, rms_energy: list[float]) -> None:
    """Best-effort LLM section refinement. Mutates `analysis_result["sections"]` on success."""
    try:
        llm_secs = await _generate_sections_llm(
            analysis_result["duration_seconds"],
            analysis_result["tempo_bpm"],
            result.beats.beat_times,
            rms_energy,
        )
        if llm_secs:
            analysis_result["sections"] = llm_secs
    except Exception as e:
        # Best-effort: keep the fallback sections on any failure, but surface
        # the reason so silent LLM degradations remain debuggable.
        logger.debug("LLM section refinement failed, using fallback sections: %s", e, exc_info=True)


def _generate_sections(duration: float, tempo: float, beat_count: int) -> list[dict]:
    """Legacy fallback — uniform slicing (kept for queue path)."""
    return _generate_sections_from_analysis(duration, tempo, [], [], [], 512, 22050)


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
        return cached

    # Check database second
    from ..core import database
    db_analysis = database.get_audio_analysis(normalized)
    if db_analysis:
        # Populate cache
        _cache_set(normalized, db_analysis, "")
        return db_analysis

    # Fallback: try basename for backward compatibility with old entries
    if "/" in normalized:
        basename = Path(normalized).name
        if basename != normalized:
            db_analysis = database.get_audio_analysis(basename)
            if db_analysis:
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


class StemSeparationResponse(BaseModel):
    """Response model for audio stem separation."""
    success: bool
    audio_file: str
    model: str
    stems: dict[str, str]
    duration: float
    computed_at: str
    error: str | None = None
    stems_mp3: dict[str, str] = {}


@router.post("/separate", response_model=StemSeparationResponse)
async def separate_audio(
    file: UploadFile = File(...),
    model: str = "htdemucs",
) -> StemSeparationResponse:
    """Separate an uploaded audio file into isolated stems (vocals, drums, bass, other)."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    # Save uploaded file to audio dir
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    saved_name = f"{uuid.uuid4().hex}{ext}"
    saved_path = AUDIO_DIR / saved_name
    size = 0
    with open(saved_path, "wb") as buffer:
        while chunk := await file.read(8192):
            size += len(chunk)
            if size > MAX_FILE_SIZE:
                saved_path.unlink(missing_ok=True)
                raise HTTPException(
                    status_code=413,
                    detail=f"File too large. Maximum size: {MAX_FILE_SIZE // (1024*1024)} MB",
                )
            buffer.write(chunk)

    try:
        result = await source_separator.separate(
            audio_path=str(saved_path),
            model=model,
        )
        return StemSeparationResponse(
            success=bool(result.stems) and not result.error,
            audio_file=result.audio_file,
            model=result.model,
            stems=result.stems,
            duration=result.duration,
            computed_at=result.computed_at,
            error=result.error,
            stems_mp3=result.stems_mp3,
        )
    except Exception as e:
        logger.exception("Stem separation failed")
        raise HTTPException(status_code=500, detail=f"Separation failed: {e}") from e


@router.get("/stems/{filename:path}")
async def get_stems(filename: str) -> dict:
    """Get previously separated stems for an audio file, if available."""
    import urllib.parse
    filename = urllib.parse.unquote(filename)
    stem_dir = _find_stem_dir(filename)
    stems = {}
    if stem_dir is not None and stem_dir.exists():
        for stem_name in ["vocals", "drums", "bass", "other"]:
            stem_path = stem_dir / f"{stem_name}.wav"
            if stem_path.exists():
                stems[stem_name] = str(stem_path)
    return {
        "audio_file": filename,
        "stems": {
            # HTTP URLs for the Visualizer / wizard (relative to API base)
            name: f"/api/audio/stem-file/{Path(p).parent.name}/{Path(p).stem}"
            for name, p in stems.items()
        },
        # Lightweight MP3 URLs (~13% of WAV size). Served from cache when the
        # MP3 exists, otherwise encoded on demand on first request.
        "stems_mp3": {
            name: f"/api/audio/stem-file/{Path(p).parent.name}/{Path(p).stem}?format=mp3"
            for name, p in stems.items()
        },
        "found": bool(stems),
    }


def _find_stem_dir(filename: str) -> Path | None:
    """Locate the Demucs output dir for a library file, tolerating renames.

    Separation output dirs are created from the *source* filename at separation
    time (`output/stems/htdemucs/<stem>/`), so hash prefixes (`85a406ef_…`),
    renames, and case/spacing differences all break an exact lookup. Resolve:
    exact → normalized equality → normalized containment (deterministic order).
    """
    base = SEPARATION_DIR / "htdemucs"
    stem = Path(filename).stem
    exact = base / stem
    if exact.exists():
        return exact
    if not base.exists():
        return None

    def norm(s: str) -> str:
        return re.sub(r"[^a-z0-9]", "", s.lower())

    stripped = re.sub(r"^([0-9a-f]{8}_)+", "", stem, flags=re.IGNORECASE)
    targets = {norm(stripped), norm(stem)} - {""}
    try:
        dirs = sorted([d for d in base.iterdir() if d.is_dir()], key=lambda d: d.name)
    except OSError:
        return None
    for d in dirs:
        if norm(d.name) in targets:
            return d
    for d in dirs:
        dn = norm(d.name)
        if dn and any(t in dn or dn in t for t in targets):
            return d
    return None


class SeparateFileRequest(BaseModel):
    """Separate an existing library file (no re-upload)."""
    filename: str
    model: str = "htdemucs"


@router.post("/separate-file", response_model=StemSeparationResponse)
async def separate_library_file(body: SeparateFileRequest) -> StemSeparationResponse:
    """Separate a file already in the audio library via Demucs.

    Powers Visualizer "Load Stems": separating a 2–4 min track takes a few
    minutes (CUDA) — the request stays open up to 10 min like Demucs itself.
    """
    from ..services.source_separation import SourceSeparator

    if not body.filename or ".." in body.filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    if body.model not in SourceSeparator.SUPPORTED_MODELS:
        raise HTTPException(
            status_code=400, detail=f"Unknown model: {body.model}. Choose: {', '.join(SourceSeparator.SUPPORTED_MODELS)}"
        )
    path = (AUDIO_DIR / body.filename).resolve()
    if not str(path).startswith(str(AUDIO_DIR.resolve())) or not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail=f"Audio file not found: {body.filename}")
    if path.suffix.lower() not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Invalid file type: {path.suffix}")

    try:
        result = await source_separator.separate(audio_path=str(path), model=body.model)
        return StemSeparationResponse(
            success=bool(result.stems) and not result.error,
            audio_file=result.audio_file,
            model=result.model,
            stems=result.stems,
            duration=result.duration,
            computed_at=result.computed_at,
            error=result.error,
            stems_mp3=result.stems_mp3,
        )
    except Exception as e:
        logger.exception("Stem separation failed")
        raise HTTPException(status_code=500, detail=f"Separation failed: {e}") from e


@router.get("/stem-file/{track_name}/{stem_name}")
async def serve_stem_file(track_name: str, stem_name: str, format: str = "wav"):
    """Serve a separated stem (WAV, or MP3 via ?format=mp3) for per-stem playback/analysis.

    Per ai-video-trends-2026 Trend 2 (music-native per-stem mapping):
    the Visualizer / wizard fetch individual stems to map drums→pulse,
    bass→camera shake, vocals→lyric glow, other→palette.
    """
    import re
    import urllib.parse

    track_name = urllib.parse.unquote(track_name)
    stem_name = urllib.parse.unquote(stem_name)
    if stem_name not in {"vocals", "drums", "bass", "other"}:
        raise HTTPException(status_code=400, detail="stem_name must be vocals|drums|bass|other")
    if format not in {"wav", "mp3"}:
        raise HTTPException(status_code=400, detail="format must be wav|mp3")
    # Track dirs are derived from source stems — sanitize aggressively.
    safe_track = re.sub(r"[^A-Za-z0-9_\- .()\[\]]", "", track_name).strip()
    if not safe_track or ".." in safe_track:
        raise HTTPException(status_code=400, detail="Invalid track name")

    base_dir = SEPARATION_DIR.resolve()
    stem_path = (SEPARATION_DIR / "htdemucs" / safe_track / f"{stem_name}.{format}").resolve()
    if not str(stem_path).startswith(str(base_dir)):
        raise HTTPException(status_code=400, detail="Invalid track name")

    if format == "mp3" and not stem_path.exists():
        # Lazy encode: stems separated before MP3 support have WAV only.
        from ..services.source_separation import encode_wav_to_mp3
        wav_path = (SEPARATION_DIR / "htdemucs" / safe_track / f"{stem_name}.wav").resolve()
        if wav_path.exists() and str(wav_path).startswith(str(base_dir)):
            encoded = await asyncio.to_thread(encode_wav_to_mp3, wav_path)
            if encoded is not None:
                stem_path = encoded

    if not stem_path.exists():
        raise HTTPException(status_code=404, detail=f"Stem not found: {safe_track}/{stem_name}.{format} — run POST /api/audio/separate first")

    media_type = "audio/mpeg" if format == "mp3" else "audio/wav"
    return FileResponse(str(stem_path), media_type=media_type, filename=f"{safe_track}_{stem_name}.{format}")


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

    # CORS: allowlist local origins only; omit ACAO for untrusted origins.
    from ..core.cors import is_local_origin

    origin = request.headers.get("origin", "")
    cors_origin = origin if is_local_origin(origin) else ""
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
