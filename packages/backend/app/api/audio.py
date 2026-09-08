"""
Audio upload and analysis API routes.
Handles file uploads for music video creation and audio analysis.
"""

from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path

# In-memory cache for analysis data (avoids DB hits on every frontend poll)
_analysis_cache: dict[str, dict] = {}
_cache_max_size = 200  # Max files to cache in memory

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

ALLOWED_EXTENSIONS = {".mp3", ".wav", ".flac", ".ogg", ".m4a", ".wma", ".aac"}
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
    # Timing contract (shared with frontend + Remotion + AI agents)
    timing_contract: dict | None = None
    # Suggested visualization parameters for AI/agent-driven presets
    suggested_visualization: str | None = None
    suggested_kinetic_preset: str | None = None
    suggested_theme_seed: str | None = None


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
        "confidence": data.get("confidence"),
        "sections": data.get("sections", []),
        "has_beat_times": bool(data.get("beat_times")),
        "has_onset_times": bool(data.get("onset_times")),
        "has_energy_curve": bool(data.get("energy_curve")),
        "has_spectral": bool(data.get("spectral_centroid") or data.get("spectral_rolloff")),
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
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")

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
            content = await file.read()
            buffer.write(content)

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
        with open(analysis_file, "w") as f:
            import json
            json.dump(analysis_result, f, indent=2)

        return AudioAnalysisResult(**analysis_result)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")


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
            content = await file.read()
            buffer.write(content)

        from ..services.audio_analyzer import LIBROSA_AVAILABLE, AudioAnalyzer
        if not LIBROSA_AVAILABLE:
            raise HTTPException(status_code=503, detail="librosa not installed")

        analyzer = AudioAnalyzer()

        # Try CUDA first, fall back to CPU
        try:
            from ..services.audio_analyzer import analyze_with_cuda
            cuda_result = analyze_with_cuda(str(file_path))
        except Exception:
            cuda_result = None

        if cuda_result and cuda_result.get("computed_on") == "GPU":
            # CUDA succeeded — use CPU beat tracking + CUDA spectral features
            result = analyzer.analyze_file(str(file_path), job_id=unique_id)
            analysis_result = _build_analysis_result(result, unique_id, file_path, analyzer)
            analysis_result["computed_on"] = "GPU"
            # Override energy curve with CUDA spectral data when available
            if cuda_result.get("amplitude_envelope"):
                analysis_result["energy_curve"] = [round(float(v), 4) for v in cuda_result["amplitude_envelope"]]
                analysis_result["amplitude_envelope"] = analysis_result["energy_curve"]
            await _apply_llm_sections(analysis_result, result, cuda_result.get("rms_energy", []))
        else:
            # CUDA unavailable — fall back to CPU
            result = analyzer.analyze_file(str(file_path), job_id=unique_id)
            analysis_result = _build_analysis_result(result, unique_id, file_path, analyzer)
            analysis_result["computed_on"] = "CPU"
            await _apply_llm_sections(analysis_result, result, result.waveform.rms_energy if result.waveform else [])

        # Cache the analysis index
        index = _load_analysis_index()
        index[safe_name] = unique_id
        _save_analysis_index(index)

        # Save full analysis
        analysis_file = ANALYSIS_DIR / f"{unique_id}_analysis.json"
        with open(analysis_file, "w") as f:
            import json
            json.dump(analysis_result, f, indent=2)

        return AudioAnalysisResult(**analysis_result)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")


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


def _build_analysis_result(
    result,
    unique_id: str,
    file_path: Path,
    analyzer,
) -> dict:
    """Build the standard analysis response dict from an AudioAnalysisResult."""
    tempo = result.beats.tempo_bpm if result.beats else 120.0
    duration = result.waveform.duration_seconds if result.waveform else 0.0
    beat_count = len(result.beats.beat_times) if result.beats else 0
    beat_times = result.beats.beat_times if result.beats else []
    onset_times = result.beats.onset_times if result.beats else []
    confidence = result.beats.confidence if result.beats else 0.0
    energy_curve = result.waveform.amplitude_envelope if result.waveform else []
    rms = result.waveform.rms_energy if result.waveform and result.waveform.rms_energy else []

    sections = _generate_sections_from_analysis(
        duration=duration,
        tempo=tempo,
        beat_times=beat_times,
        onset_times=onset_times,
        rms_energy=rms,
        hop_length=analyzer.hop_length,
        sample_rate=result.waveform.sample_rate if result.waveform else 22050,
    )

    return {
        "tempo_bpm": round(float(tempo), 1),
        "duration_seconds": round(float(duration), 2),
        "beat_count": int(beat_count),
        "sections": sections,
        "beat_times": [round(float(t), 3) for t in beat_times[:800]],
        "onset_times": [round(float(t), 3) for t in onset_times[:800]],
        "energy_curve": [round(float(v), 4) for v in energy_curve],
        "confidence": round(float(confidence), 3),
        "amplitude_envelope": [round(float(v), 4) for v in energy_curve],
        "stored_path": str(file_path),
        "job_id": unique_id,
        # Timing contract for frontend + Remotion + AI agents
        "timing_contract": {
            "filename": file_path.name,
            "duration": round(float(duration), 2),
            "bpm": round(float(tempo), 1),
            "bpmConfidence": round(float(confidence), 3),
            "beats": [
                {
                    "time": round(float(bt), 3),
                    "drumType": None,
                    "energy": round(float(
                        next((e for e in (rms_energy or []) if e > 0), 0.5)
                    ), 4) if rms_energy else 0.5,
                    "isDownbeat": i == 0 or (i > 0 and (bt - beat_times[i - 1]) > 60.0 / max(tempo, 1) * 1.5),
                    "bpm": round(float(tempo), 1),
                }
                for i, bt in enumerate(beat_times[:800])
            ],
            "sections": sections,
            "energyCurve": [
                {"time": round(float(i) * duration / max(len(energy_curve) - 1, 1), 3), "value": round(float(v), 4)}
                for i, v in enumerate(energy_curve)
            ],
            "amplitudeEnvelope": [round(float(v), 4) for v in energy_curve],
        },
        # Visualization hints for AI-driven preset generation
        "suggested_visualization": _suggest_visualization(tempo, duration, sections, energy_curve),
        "suggested_kinetic_preset": _suggest_kinetic_preset(tempo, sections),
        "suggested_theme_seed": _suggest_theme_seed(sections, energy_curve),
    }


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

    Uses RMS energy percentiles + positional priors + beat snapping.
    Falls back to uniform heuristic if energy unavailable.
    """
    if duration <= 0:
        return [{"type": "full", "start": 0.0, "end": 10.0, "energy": 0.5}]

    # Estimate num sections from duration (~25s per section) + beat heuristic
    # Cap 8 to keep wizard manageable
    if beat_times and tempo > 0:
        # Prefer beat-based: ~32 beats per section (8 bars)
        num_sections = max(4, min(8, round(len(beat_times) / 32)))
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
                s = min(beat_times, key=lambda b: abs(b - s)) if abs(min(beat_times, key=lambda b: abs(b - s)) - s) < 0.6 else s
                e = min(beat_times, key=lambda b: abs(b - e)) if abs(min(beat_times, key=lambda b: abs(b - e)) - e) < 0.6 else e
            t = section_types[min(i, len(section_types) - 1)]
            energy = 0.85 if "chorus" in t else 0.55 if "verse" in t else 0.35
            out.append({"type": t, "start": round(float(s), 2), "end": round(float(e), 2), "energy": round(float(energy), 3)})
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

    sections = []
    for i, (s, e, mean_e) in enumerate(provisional):
        # Snap to nearest beat for clean cuts (except intro/outro boundaries)
        if beat_times and 0 < i < num_sections - 1:
            nearest_s = min(beat_times, key=lambda b: abs(b - s))
            if abs(nearest_s - s) < 0.6:
                s = nearest_s
        if beat_times and i < num_sections - 1:
            nearest_e = min(beat_times, key=lambda b: abs(b - e))
            if abs(nearest_e - e) < 0.6:
                e = nearest_e

        # Normalize energy 0-1
        norm = (mean_e - emin) / erange
        # Positional prior
        if i == 0:
            typ = "intro"
        elif i == num_sections - 1:
            typ = "outro"
        elif norm >= 0.66 or mean_e >= p66:
            typ = "chorus"
        elif norm <= 0.33 or mean_e <= p33:
            # In middle, low energy is bridge, else verse
            typ = "bridge" if i in (num_sections // 2, num_sections // 2 + 1) and norm < 0.4 else "verse"
        else:
            typ = "verse"

        # Energy for UI (0-1 normalized + boost for chorus)
        ui_energy = round(min(1.0, max(0.05, (norm * 0.7 + 0.3) if typ == "chorus" else norm * 0.6 + 0.2)), 3)

        sections.append({"type": typ, "start": round(float(s), 2), "end": round(float(e), 2), "energy": ui_energy})

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
    import json

    import aiohttp

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
    for model in ["deepseek-r1:7b", app_config.default_model, "qwen3.5:4b"]:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{app_config.ollama_url}/api/chat",
                    json={
                        "model": model,
                        "messages": [{"role": "system", "content": sys}, {"role": "user", "content": user}],
                        "stream": False,
                        "format": "json",
                        "think": False,
                        "options": {"temperature": 0.2, "num_ctx": 4096},
                    },
                    timeout=aiohttp.ClientTimeout(total=25),
                ) as resp:
                    if resp.status != 200:
                        continue
                    data = await resp.json()
                    content = (data.get("message", {}).get("content") or "").strip()
                    if not content:
                        continue
                    # Strip fences
                    if "```" in content:
                        content = content.split("```")[1] if "```" in content else content
                        if content.startswith("json"):
                            content = content[4:]
                        content = content.strip().split("```")[0].strip()
                    parsed = json.loads(content)
                    secs = parsed.get("sections") if isinstance(parsed, dict) else parsed
                    if isinstance(secs, list) and 2 <= len(secs) <= 8:
                        # Validate and clamp
                        out = []
                        for s in secs:
                            typ = str(s.get("type", "verse")).lower()
                            if typ not in ("intro","verse","chorus","bridge","outro","pre-chorus","drop"):
                                typ = "verse"
                            out.append({
                                "type": typ,
                                "start": round(float(s.get("start", 0)), 2),
                                "end": round(float(s.get("end", duration)), 2),
                                "energy": round(max(0.05, min(1.0, float(s.get("energy", 0.5)))), 3),
                            })
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


@router.get("/analysis/by-filename/{filename}")
async def get_analysis_by_filename(filename: str):
    """Get cached analysis for an audio file by filename."""
    import urllib.parse
    filename = urllib.parse.unquote(filename)

    if ".." in filename or filename.startswith("/"):
        raise HTTPException(status_code=400, detail="Invalid filename")

    # Check in-memory cache first (fastest)
    if filename in _analysis_cache:
        return _analysis_cache[filename]

    # Check database second
    from ..core import database
    db_analysis = database.get_audio_analysis(filename)
    if db_analysis:
        # Populate cache
        _analysis_cache[filename] = db_analysis
        return db_analysis

    # Fallback to JSON file index
    index = _load_analysis_index()

    # Try exact match first
    job_id = index.get(filename)

    # Fallback: try matching by display name (strip hash prefixes)
    if not job_id:
        import re
        display_name = re.sub(r'^([0-9a-f]{8}_)+', '', filename, flags=re.IGNORECASE)
        for key, val in index.items():
            key_display = re.sub(r'^([0-9a-f]{8}_)+', '', key, flags=re.IGNORECASE)
            if key_display == display_name:
                job_id = val
                logger.info(f"Analysis fallback match: '{filename}' -> '{key}'")
                break

    # Fallback 2: try partial match (filename without extension)
    if not job_id:
        stem = Path(filename).stem
        for key, val in index.items():
            if stem in key or key.startswith(stem[:20]):
                job_id = val
                logger.info(f"Analysis partial match: '{filename}' -> '{key}'")
                break

    if not job_id:
        logger.warning(f"No cached analysis for '{filename}'. Index keys: {list(index.keys())[:5]}...")
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

    return data


@router.get("/analysis/{job_id}")
async def get_analysis_result(request: Request, job_id: str):
    """Get the result of an audio analysis job by job ID."""
    if not ANALYSIS_DIR.exists():
        raise HTTPException(status_code=404, detail="No analysis results found")

    for json_file in ANALYSIS_DIR.glob("*_analysis.json"):
        if job_id[:8] in json_file.name:
            origin = request.headers.get("origin", "*")
            return FileResponse(str(json_file), media_type="application/json",
                                headers={"Access-Control-Allow-Origin": origin})

    raise HTTPException(status_code=404, detail="Analysis result not found")


@router.get("/files")
async def list_uploaded_audio():
    """List all uploaded audio files, deduplicated by display name."""
    files = []
    if AUDIO_DIR.exists():
        seen_names = set()
        for f in sorted(AUDIO_DIR.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
            if f.is_file() and f.suffix.lower() in ALLOWED_EXTENSIONS:
                # Deduplicate by display name — strip ALL 8-hex hash prefixes (files may have 2-3)
                import re
                display_name = re.sub(r'^([0-9a-f]{8}_)+', '', f.name, flags=re.IGNORECASE)
                if display_name in seen_names:
                    continue
                seen_names.add(display_name)
                stat = f.stat()
                files.append({
                    "filename": f.name,
                    "size_bytes": stat.st_size,
                    "modified": stat.st_mtime,
                    "path": str(f),
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

    # Check database first (persistent across restarts)
    from ..core import database
    db_analysis = database.get_audio_analysis(filename)
    if db_analysis:
        return {"status": "cached", "analysis": db_analysis}

    # Check if already cached in JSON index
    index = _load_analysis_index()
    job_id = index.get(filename)
    if job_id:
        analysis_path = _get_analysis_path(job_id)
        if analysis_path.exists():
            with open(analysis_path, encoding="utf-8") as f:
                data = json.load(f)
                # Also save to database for future requests
                database.update_audio_analysis(filename, data)
                return {"status": "cached", "analysis": data}

    # Find the audio file
    file_path = AUDIO_DIR / filename
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

        # Save to index and file
        index[filename] = unique_id
        _save_analysis_index(index)

        analysis_file = ANALYSIS_DIR / f"{unique_id}_analysis.json"
        with open(analysis_file, "w") as f:
            json.dump(analysis_result, f, indent=2)

        logger.info(f"Analysis completed for '{filename}': {analysis_result['tempo_bpm']} BPM, {analysis_result['beat_count']} beats")

        # Save to database for persistence between server restarts
        from ..core import database
        database.update_audio_analysis(filename, analysis_result)
        # Populate in-memory cache
        _analysis_cache[filename] = analysis_result

        return {"status": "analyzed", "analysis": analysis_result}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Analysis failed for '{filename}': {e}")
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")


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

    # Get all audio files
    audio_files = [
        f for f in AUDIO_DIR.iterdir()
        if f.is_file() and f.suffix.lower() in ALLOWED_EXTENSIONS
    ]

    for file_path in audio_files:
        filename = file_path.name
        # Skip if already analyzed in database
        existing = database.get_audio_analysis(filename)
        if existing and existing.get("beat_times"):
            continue

        _check_backend_available(backend)

        try:
            unique_id = str(uuid.uuid4())[:8]
            result = analyzer.analyze_file(str(file_path), job_id=unique_id, backend=backend)
            analysis_result = _build_analysis_result(result, unique_id, file_path, analyzer)

            # Save to database
            database.update_audio_analysis(filename, analysis_result)

            # Also save to JSON file for backward compatibility
            index = _load_analysis_index()
            index[filename] = unique_id
            _save_analysis_index(index)
            analysis_file = ANALYSIS_DIR / f"{unique_id}_analysis.json"
            with open(analysis_file, "w") as f:
                json.dump(analysis_result, f, indent=2)

            analyzed_files.append({
                "filename": filename,
                "bpm": analysis_result["tempo_bpm"],
                "beats": analysis_result["beat_count"],
                "confidence": analysis_result["confidence"],
            })
        except Exception as e:
            errors.append({"filename": filename, "error": str(e)})
            logger.warning(f"Failed to analyze '{filename}': {e}")


class EnsureAnalysisRequest(BaseModel):
    """Request model for ensuring cached analysis exists for an audio file."""
    filename: str
    backend: str = "sonara"


class RenameAudioRequest(BaseModel):
    """Request model for renaming an audio file."""
    old_filename: str
    new_filename: str


@router.post("/rename", response_model=dict)
async def rename_audio(body: RenameAudioRequest) -> dict:
    """Rename an audio file."""
    old_filename = body.old_filename
    new_filename = body.new_filename

    if not old_filename or not new_filename:
        raise HTTPException(status_code=400, detail="Both old_filename and new_filename are required")

    if ".." in old_filename or ".." in new_filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    old_path = AUDIO_DIR / old_filename
    if not old_path.exists() or not old_path.is_file():
        raise HTTPException(status_code=404, detail=f"Audio file not found: {old_filename}")

    ext = old_path.suffix
    new_filename_with_ext = new_filename if new_filename.endswith(ext) else new_filename + ext
    new_path = AUDIO_DIR / new_filename_with_ext

    if new_path.exists():
        raise HTTPException(status_code=409, detail=f"A file with that name already exists: {new_filename_with_ext}")

    old_path.rename(new_path)

    return {"success": True, "old_filename": old_filename, "new_filename": new_filename_with_ext}


class StemSeparationResponse(BaseModel):
    """Response model for audio stem separation."""
    success: bool
    audio_file: str
    model: str
    stems: dict[str, str]
    duration: float
    computed_at: str
    error: str | None = None


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
    content = await file.read()
    saved_path.write_bytes(content)

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
        )
    except Exception as e:
        logger.exception("Stem separation failed")
        raise HTTPException(status_code=500, detail=f"Separation failed: {e}")


@router.get("/stems/{filename:path}")
async def get_stems(filename: str) -> dict:
    """Get previously separated stems for an audio file, if available."""
    import urllib.parse
    filename = urllib.parse.unquote(filename)
    stem_dir = SEPARATION_DIR / "htdemucs" / Path(filename).stem
    stems = {}
    if stem_dir.exists():
        for stem_name in ["vocals", "drums", "bass", "other"]:
            stem_path = stem_dir / f"{stem_name}.wav"
            if stem_path.exists():
                stems[stem_name] = str(stem_path)
    return {
        "audio_file": filename,
        "stems": stems,
        "found": bool(stems),
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
        ".m4a": "audio/mp4",
        ".wma": "audio/x-ms-wma",
        ".aac": "audio/aac",
    }
    media_type = media_types.get(ext, "application/octet-stream")

    # CORS: allowlist local origins only (no reflection)
    allowed_origins = {"http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:8000", "http://localhost:8000"}
    origin = request.headers.get("origin", "")
    cors_origin = origin if origin in allowed_origins else "http://127.0.0.1:5173"
    return FileResponse(
        str(file_path),
        media_type=media_type,
        filename=file_path.name,
        headers={
             "Accept-Ranges": "bytes",
             "Cache-Control": "public, max-age=3600",
             "Access-Control-Allow-Origin": cors_origin,
        },
     )

