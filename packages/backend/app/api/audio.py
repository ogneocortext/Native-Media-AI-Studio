"""
Audio upload and analysis API routes.
Handles file uploads for music video creation and audio analysis.
"""

import json
import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ..core.config import PROJECT_ROOT

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
            with open(ANALYSIS_INDEX, "r", encoding="utf-8") as f:
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
async def analyze_audio(file: UploadFile = File(...)) -> AudioAnalysisResult:
    """Analyze audio file for tempo, beats, and sections."""
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

        from ..services.audio_analyzer import AudioAnalyzer, LIBROSA_AVAILABLE
        if not LIBROSA_AVAILABLE:
            raise HTTPException(status_code=503, detail="librosa not installed. Run: pip install librosa soundfile")

        analyzer = AudioAnalyzer()
        result = analyzer.analyze_file(str(file_path), job_id=unique_id)

        # Convert to wizard-friendly format — now with real librosa features
        tempo = result.beats.tempo_bpm if result.beats else 120.0
        duration = result.waveform.duration_seconds if result.waveform else 0.0
        beat_count = len(result.beats.beat_times) if result.beats else 0
        beat_times = result.beats.beat_times if result.beats else []
        onset_times = result.beats.onset_times if result.beats else []
        confidence = result.beats.confidence if result.beats else 0.0
        # Energy curve for frontend viz (downsampled envelope + full rms mean)
        energy_curve = result.waveform.amplitude_envelope if result.waveform else []
        rms = result.waveform.rms_energy if result.waveform and result.waveform.rms_energy else []

        # Generate sections from REAL energy + beats, not uniform slicing
        sections = _generate_sections_from_analysis(
            duration=duration,
            tempo=tempo,
            beat_times=beat_times,
            onset_times=onset_times,
            rms_energy=rms,
            hop_length=analyzer.hop_length,
            sample_rate=result.waveform.sample_rate if result.waveform else 22050,
        )

        analysis_result = {
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
        }

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

        from ..services.audio_analyzer import AudioAnalyzer, LIBROSA_AVAILABLE
        if not LIBROSA_AVAILABLE:
            raise HTTPException(status_code=503, detail="librosa not installed")

        # Try CUDA first, fall back to CPU
        try:
            from ..services.audio_analyzer import analyze_with_cuda
            cuda_result = analyze_with_cuda(str(file_path))
        except Exception:
            cuda_result = None

        if cuda_result and cuda_result.get("computed_on") == "GPU":
            # CUDA succeeded — use its spectral features + CPU beat tracking
            analyzer = AudioAnalyzer()
            result = analyzer.analyze_file(str(file_path), job_id=unique_id)
            tempo = result.beats.tempo_bpm
            beat_times = result.beats.beat_times
            confidence = result.beats.confidence
            sections = _generate_sections_from_analysis(
                duration=cuda_result.get("duration_seconds", 0),
                tempo=tempo,
                beat_times=beat_times,
                onset_times=result.beats.onset_times,
                rms_energy=cuda_result.get("rms_energy", []),
                hop_length=analyzer.hop_length,
                sample_rate=result.waveform.sample_rate,
            )

            analysis_result = {
                "tempo_bpm": round(float(tempo), 1),
                "duration_seconds": round(float(cuda_result.get("duration_seconds", 0)), 2),
                "beat_count": len(beat_times),
                "sections": sections,
                "beat_times": [round(float(t), 3) for t in beat_times[:800]],
                "onset_times": [round(float(t), 3) for t in result.beats.onset_times[:800]],
                "energy_curve": [round(float(v), 4) for v in cuda_result.get("amplitude_envelope", [])],
                "confidence": round(float(confidence), 3),
                "amplitude_envelope": [round(float(v), 4) for v in cuda_result.get("amplitude_envelope", [])],
                "stored_path": str(file_path),
                "job_id": unique_id,
                "computed_on": "GPU",
            }
        else:
            # CUDA unavailable — fall back to CPU
            analyzer = AudioAnalyzer()
            result = analyzer.analyze_file(str(file_path), job_id=unique_id)

            tempo = result.beats.tempo_bpm if result.beats else 120.0
            duration = result.waveform.duration_seconds if result.waveform else 0.0
            beat_count = len(result.beats.beat_times) if result.beats else 0
            beat_times = result.beats.beat_times if result.beats else []
            onset_times = result.beats.onset_times if result.beats else []
            confidence = result.beats.confidence if result.beats else 0.0
            energy_curve = result.waveform.amplitude_envelope if result.waveform else []

            sections = _generate_sections_from_analysis(
                duration=duration,
                tempo=tempo,
                beat_times=beat_times,
                onset_times=onset_times,
                rms_energy=result.waveform.rms_energy if result.waveform else [],
                hop_length=analyzer.hop_length,
                sample_rate=result.waveform.sample_rate if result.waveform else 22050,
            )

            analysis_result = {
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
                "computed_on": "CPU",
            }

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


def _generate_sections(duration: float, tempo: float, beat_count: int) -> list[dict]:
    """Legacy fallback — uniform slicing (kept for queue path)."""
    return _generate_sections_from_analysis(duration, tempo, [], [], [], 512, 22050)


@router.get("/analysis/by-filename/{filename}")
async def get_analysis_by_filename(filename: str):
    """Get cached analysis for an audio file by filename."""
    import urllib.parse
    filename = urllib.parse.unquote(filename)

    if ".." in filename or filename.startswith("/"):
        raise HTTPException(status_code=400, detail="Invalid filename")

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

    with open(analysis_path, "r", encoding="utf-8") as f:
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
async def ensure_analysis(body: dict):
    """Ensure analysis exists for a file — run analysis if not cached.
    Used by frontend features that depend on analysis data."""
    filename = body.get("filename", "")
    if not filename:
        raise HTTPException(status_code=400, detail="filename required")

    if ".." in filename or filename.startswith("/"):
        raise HTTPException(status_code=400, detail="Invalid filename")

    # Check if already cached
    index = _load_analysis_index()
    job_id = index.get(filename)
    if job_id:
        analysis_path = _get_analysis_path(job_id)
        if analysis_path.exists():
            with open(analysis_path, "r", encoding="utf-8") as f:
                return {"status": "cached", "analysis": json.load(f)}

    # Find the audio file
    file_path = AUDIO_DIR / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"Audio file not found: {filename}")

    # Run analysis
    from ..services.audio_analyzer import AudioAnalyzer, LIBROSA_AVAILABLE
    if not LIBROSA_AVAILABLE:
        raise HTTPException(status_code=503, detail="librosa not installed")

    try:
        unique_id = str(uuid.uuid4())[:8]
        analyzer = AudioAnalyzer()
        result = analyzer.analyze_file(str(file_path), job_id=unique_id)

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

        analysis_result = {
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
        }

        # Save to index and file
        index[filename] = unique_id
        _save_analysis_index(index)

        analysis_file = ANALYSIS_DIR / f"{unique_id}_analysis.json"
        with open(analysis_file, "w") as f:
            json.dump(analysis_result, f, indent=2)

        logger.info(f"Analysis completed for '{filename}': {tempo:.1f} BPM, {beat_count} beats")
        return {"status": "analyzed", "analysis": analysis_result}
    except Exception as e:
        logger.error(f"Analysis failed for '{filename}': {e}")
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")
async def rename_audio_file(body: dict):
    """Rename an audio file."""
    old_filename = body.get("old_filename", "")
    new_filename = body.get("new_filename", "")

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


@router.get("/file/{filename:path}")
async def serve_audio_file(request: Request, filename: str):
    """Serve an audio file by filename."""
    import urllib.parse
    
    # Decode URL-encoded filename (handles spaces, special chars)
    filename = urllib.parse.unquote(filename)
    
    # Security: prevent directory traversal
    if ".." in filename or filename.startswith("/"):
        raise HTTPException(status_code=400, detail="Invalid filename")

    file_path = AUDIO_DIR / filename

    # Check if file exists in AUDIO_DIR
    if not file_path.exists() or not file_path.is_file():
        # Also check output/audio directory as fallback
        alt_path = PROJECT_ROOT / "output" / "audio" / filename
        if alt_path.exists() and alt_path.is_file():
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

    # Echo back the requesting origin for CORS (works with credentials)
    origin = request.headers.get("origin", "*")
    return FileResponse(
        str(file_path),
        media_type=media_type,
        filename=file_path.name,
        headers={
             "Accept-Ranges": "bytes",
             "Cache-Control": "public, max-age=3600",
             "Access-Control-Allow-Origin": origin,
        },
     )

