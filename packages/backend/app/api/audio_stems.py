"""
Stem separation endpoints, split out of app/api/audio.py.

Owns: /separate, /stems*, /separate-*, /stem-*, /enhance-stems.

Split from audio.py for size, not behaviour: every path, method and operation
id is unchanged, so the public API is identical. tools/snapshot-audio-routes.py
--check is the guard - run it before and after any further change here.

Endpoints call out to services/{source_separation,stem_analysis,
stem_visualization,suno_enhancer}.py. The only state shared with the parent
module is where audio lives and the logger, so this module deliberately does not
import audio.py - that would be circular, since main.py includes both routers.

The module-level names below were verified with an AST pass for free variables,
not by reading. The first attempt at this split got it wrong twice: it omitted
SEPARATION_DIR/source_separator, and /api/audio/stems-status then raised
NameError -> HTTP 500. The route snapshot still passed, because OpenAPI is
generated from decorators and never executes the handler body. Importing the
module is not enough either - py_compile does not resolve names. Exercise the
endpoints.
"""
from __future__ import annotations

import asyncio
import logging
import re
import urllib.parse
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ..core.config import PROJECT_ROOT
from ..services import source_separation
from ..services.source_separation import SEPARATION_DIR, source_separator

logger = logging.getLogger(__name__)

# Mirrors audio.py's own definitions rather than importing them (see module
# docstring). These must stay identical to the parent or the two modules would
# disagree about where audio lives.
AUDIO_DIR = PROJECT_ROOT / "output" / "audio"
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_EXTENSIONS = {".mp3", ".wav", ".flac", ".ogg", ".opus", ".m4a", ".wma", ".aac"}
MAX_FILE_SIZE = 500 * 1024 * 1024  # 500 MB

# Same prefix and tag as the parent router: main.py includes both, so /api/audio
# paths are identical whether a route lives here or in audio.py.
router = APIRouter(prefix="/api/audio", tags=["Audio"])


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
    model: str = "mdx_extra_q",
    mode: str = "single",
    segment_size: int | None = None,
    overlap: float | None = None,
    denoise: bool | None = None,
) -> StemSeparationResponse:
    """Separate an uploaded audio file into isolated stems.

    Quality knobs (Gemini UVR5 guidance, 1070 Ti):
      - segment_size: 128 or 256 keeps VRAM under ~6.5 GB.
      - overlap: 0.25–0.75 for quality vs speed.
      - denoise: post-denoise pass.
      - mode: "single" (one-shot) or "hierarchical" (vocal MDX-Net first, then Demucs residual).
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

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
        from ..services.source_separation import SeparationOptions, source_separator
        opts = SeparationOptions(
            model=model,
            segment_size=segment_size,
            overlap=overlap,
            denoise=denoise,
        )
        result = await source_separator.separate(
            audio_path=str(saved_path),
            mode=mode,
            options=opts,
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
        for stem_name in source_separation.STEM_NAMES:
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


@router.get("/stems-analysis/{filename:path}")
async def get_stem_analysis(filename: str) -> dict:
    """Return per-stem visualization data for an audio file, if separated."""
    from ..services.stem_analysis import analyze_stems_for_visualization

    filename = urllib.parse.unquote(filename)
    return await analyze_stems_for_visualization(filename)


@router.get("/stems-status")
async def get_stems_status() -> dict:
    """Return stem availability for every track in the audio library.

    Response shape::

        {
          "tracks": {
            "<relative_path>": {
              "has_stems": true,
              "stems": ["vocals", "drums", "bass", "other"]
            },
            ...
          }
        }
    """
    tracks: dict[str, dict] = {}
    if not AUDIO_DIR.exists():
        return {"tracks": tracks}
    try:
        for f in sorted(AUDIO_DIR.rglob("*"), key=lambda x: x.stat().st_mtime, reverse=True):
            if f.is_file() and f.suffix.lower() in ALLOWED_EXTENSIONS and not f.name.startswith("."):
                relative = f.relative_to(AUDIO_DIR).as_posix()
                stem_dir = _find_stem_dir(relative)
                stems: list[str] = []
                if stem_dir is not None and stem_dir.exists():
                    for stem_name in source_separation.STEM_NAMES:
                        if (stem_dir / f"{stem_name}.wav").exists():
                            stems.append(stem_name)
                tracks[relative] = {"has_stems": bool(stems), "stems": stems}
    except OSError:
        pass
    return {"tracks": tracks}


def _find_stem_dir(filename: str) -> Path | None:
    """Locate the Demucs output dir for a library file, tolerating renames.

    Separation output dirs are created from the *source* filename at separation
    time (`output/stems/<model>/<track>/`), so hash prefixes (`85a406ef_…`),
    renames, and case/spacing differences all break an exact lookup. Resolve:
    exact → normalized equality → normalized containment (deterministic order).

    Checks all known model directories (mdx_extra_q first, then htdemucs)
    so existing stems remain discoverable after the default model change.
    """
    from ..services.source_separation import SourceSeparator

    base_dirs = [SEPARATION_DIR / m for m in SourceSeparator.SUPPORTED_MODELS]
    # Prefer newer models so a track separated with both returns the best one.
    base_dirs.sort(key=lambda p: p.name != "mdx_extra_q")

    stem = Path(filename).stem

    def norm(s: str) -> str:
        return re.sub(r"[^a-z0-9]", "", s.lower())

    stripped = re.sub(r"^([0-9a-f]{8}_)+", "", stem, flags=re.IGNORECASE)
    targets = {norm(stripped), norm(stem)} - {""}

    for base in base_dirs:
        exact = base / stem
        if exact.exists():
            return exact
        if not base.exists():
            continue
        try:
            dirs = sorted([d for d in base.iterdir() if d.is_dir()], key=lambda d: d.name)
        except OSError:
            continue
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
    model: str = "mdx_extra_q"
    mode: str = "single"  # "single" | "hierarchical"
    segment_size: int | None = None
    overlap: float | None = None
    denoise: bool | None = None


@router.post("/separate-file", response_model=StemSeparationResponse)
async def separate_library_file(body: SeparateFileRequest) -> StemSeparationResponse:
    """Separate a file already in the audio library via Demucs.

    Powers Visualizer "Load Stems": separating a 2–4 min track takes a few
    minutes (CUDA) — the request stays open up to 10 min like Demucs itself.
    """
    from ..services.source_separation import SeparationOptions, SourceSeparator

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

    # Guard: if stems already exist, return them immediately instead of
    # re-running Demucs (a 2–10 minute operation on CPU).
    existing = await get_stems(body.filename)
    if existing.get("found") and len(existing.get("stems", {})) >= 4:
        return StemSeparationResponse(
            success=True,
            audio_file=body.filename,
            model="existing",
            stems=existing["stems"],
            duration=0.0,
            computed_at="",
            error=None,
            stems_mp3=existing.get("stems_mp3", {}),
        )

    try:
        opts = SeparationOptions(
            model=body.model,
            segment_size=body.segment_size,
            overlap=body.overlap,
            denoise=body.denoise,
        )
        result = await source_separator.separate(
            audio_path=str(path),
            mode=body.mode,
            options=opts,
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


@router.get("/separate-jobs/{job_id}")
async def get_separation_job(job_id: str):
    """Get status of an async separation job (hierarchical / queue)."""
    job = source_separator.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {
        "job_id": job.job_id,
        "status": job.status,
        "error": job.error,
        "audio_file": job.audio_path,
        "model": job.options.model,
        "result": {
            "stems": job.result.stems if job.result else {},
            "stems_mp3": job.result.stems_mp3 if job.result else {},
            "duration": job.result.duration if job.result else 0.0,
        } if job.result else None,
    }


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
    if stem_name not in set(source_separation.STEM_NAMES):
        raise HTTPException(status_code=400, detail="stem_name must be vocals|drums|bass|other")
    if format not in {"wav", "mp3"}:
        raise HTTPException(status_code=400, detail="format must be wav|mp3")
    # Track dirs are derived from source stems — sanitize aggressively.
    safe_track = re.sub(r"[^A-Za-z0-9_\- .()\[\]]", "", track_name).strip()
    if not safe_track or ".." in safe_track:
        raise HTTPException(status_code=400, detail="Invalid track name")

    base_dir = SEPARATION_DIR.resolve()

    # Find the track across known model dirs (mdx_extra_q first, then legacy htdemucs).
    stem_path: Path | None = None
    wav_path: Path | None = None
    for model_dir in sorted(SEPARATION_DIR.iterdir()):
        if not model_dir.is_dir():
            continue
        candidate = (model_dir / safe_track / f"{stem_name}.{format}").resolve()
        if candidate.exists() and str(candidate).startswith(str(base_dir)):
            stem_path = candidate
            break
        wav_candidate = (model_dir / safe_track / f"{stem_name}.wav").resolve()
        if wav_candidate.exists() and str(wav_candidate).startswith(str(base_dir)):
            wav_path = wav_candidate
            stem_path = wav_path
            break

    if not stem_path:
        raise HTTPException(status_code=404, detail=f"Stem not found: {safe_track}/{stem_name}.{format} — run POST /api/audio/separate first")

    if format == "mp3" and not stem_path.exists():
        # Lazy encode: stems separated before MP3 support have WAV only.
        from ..services.source_separation import encode_wav_to_mp3
        if wav_path is None:
            for model_dir in sorted(SEPARATION_DIR.iterdir()):
                if not model_dir.is_dir():
                    continue
                wav_candidate = (model_dir / safe_track / f"{stem_name}.wav").resolve()
                if wav_candidate.exists() and str(wav_candidate).startswith(str(base_dir)):
                    wav_path = wav_candidate
                    break
        if wav_path is not None:
            encoded = await asyncio.to_thread(encode_wav_to_mp3, wav_path)
            if encoded is not None:
                stem_path = encoded

    if not stem_path.exists():
        raise HTTPException(status_code=404, detail=f"Stem not found: {safe_track}/{stem_name}.{format} — run POST /api/audio/separate first")

    media_type = "audio/mpeg" if format == "mp3" else "audio/wav"
    return FileResponse(str(stem_path), media_type=media_type, filename=f"{safe_track}_{stem_name}.{format}")


class StemVisualizationRequest(BaseModel):
    """Request model for stem-reactive visualization data (A5)."""
    filename: str


class StemVisualizationResponse(BaseModel):
    """Response model for stem-reactive visualization data."""
    stems: dict[str, Any]
    separated: bool
    uniforms: dict[str, Any]
    curve_points: int


@router.post("/stem-visualization", response_model=StemVisualizationResponse)
async def stem_visualization(body: StemVisualizationRequest) -> StemVisualizationResponse:
    """Return shader-uniform-ready per-stem data for the WebGL visualizer (A5).

    Maps Demucs stems (vocals/drums/bass/other) to normalized uniform curves
    that the frontend can feed directly into shaders for the deterministic
    stem-reactive fallback mode.
    """
    try:
        from urllib.parse import unquote
        filename = unquote(body.filename)
        if ".." in filename or filename.startswith("/"):
            raise HTTPException(status_code=400, detail="Invalid filename")

        from ..services.stem_visualization import get_stem_visualization_uniforms
        data = await get_stem_visualization_uniforms(filename)
        return StemVisualizationResponse(**data)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Stem visualization failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


class EnhanceStemsRequest(BaseModel):
    """Request model for enhancing separated stems."""
    filename: str
    model: str = "mdx_extra_q"
    target_peak_dbfs: float = -1.0
    attack_ms: float = 5.0
    release_ms: float = 80.0
    ratio: float = 2.5
    threshold_dbfs: float = -24.0
    reverb_decay: float = 0.4
    reverb_mix: float = 0.12
    delay_mix: float = 0.08
    stereo_widen_amount: float = 0.3
    master_ceiling_dbfs: float = -1.0
    output_format: str = "wav"
    # Suno-specific (heuristic)
    pre_highpass_hz: float = 120.0
    vocal_spectral_gate_threshold_db: float = -40.0
    vocal_dynamic_eq_max_reduction_db: float = 4.0
    # KARRA / needs-fallback toggles
    vocal_expander: bool = False
    deess_freq_hz: float = 6500.0
    air_boost_gain_db: float = 2.5
    air_boost_freq_hz: float = 10000.0
    vocal_balance_db: float = 0.0
    # In The Mix upgrades
    parallel_weight_bus_db: float = -15.0
    sidechain_pocket_eq_enabled: bool = False


class EnhanceStemsResponse(BaseModel):
    """Response model for stem enhancement."""
    success: bool
    input_filename: str
    model: str
    stems: list[str]
    wav_path: str | None = None
    mp3_path: str | None = None
    steps: list[dict] = []
    error: str | None = None
    duration: float = 0.0


@router.post("/enhance-stems", response_model=EnhanceStemsResponse)
async def enhance_stems(body: EnhanceStemsRequest) -> EnhanceStemsResponse:
    """Run the 10-step Suno Track Enhancer auto-mix chain on separated stems.

    If stems do not yet exist for the file, separation is run first using the
    requested model. The enhancer then normalizes, EQ-carves, compresses,
    de-esses, widens, adds FX sends, mixes, limits, and exports.
    """
    filename = body.filename
    if not filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    src = (AUDIO_DIR / filename).resolve()
    if not str(src).startswith(str(AUDIO_DIR.resolve())) or not src.exists() or not src.is_file():
        raise HTTPException(status_code=404, detail=f"Audio file not found: {filename}")
    if src.suffix.lower() not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported audio type: {src.suffix}")

    model = body.model or "mdx_extra_q"
    from ..services.source_separation import SourceSeparator
    if model not in SourceSeparator.SUPPORTED_MODELS:
        raise HTTPException(status_code=400, detail=f"Unknown model: {model}. Choose: {', '.join(SourceSeparator.SUPPORTED_MODELS)}")

    stem_info = await get_stems(filename)
    stems_dir: Path | None = None
    if stem_info.get("found") and len(stem_info.get("stems", {})) >= 4:
        first = next(iter(stem_info["stems"].values()))
        stems_dir = Path(first).parent
    else:
        sep = await separate_library_file(SeparateFileRequest(filename=filename, model=model))
        if not sep.success or not sep.stems:
            raise HTTPException(status_code=500, detail=sep.error or "Separation failed")
        first = next(iter(sep.stems.values()))
        stems_dir = Path(first).parent

    if stems_dir is None or not stems_dir.exists():
        raise HTTPException(status_code=500, detail="Stems directory missing after separation")

    from app.services.suno_enhancer import EnhanceConfig
    from app.services.suno_enhancer import enhance_stems as _enhance
    cfg = EnhanceConfig(
        target_peak_dbfs=body.target_peak_dbfs,
        attack_ms=body.attack_ms,
        release_ms=body.release_ms,
        ratio=body.ratio,
        threshold_dbfs=body.threshold_dbfs,
        reverb_decay=body.reverb_decay,
        reverb_mix=body.reverb_mix,
        delay_mix=body.delay_mix,
        stereo_widen_amount=body.stereo_widen_amount,
        master_ceiling_dbfs=body.master_ceiling_dbfs,
        output_format=body.output_format,
        pre_highpass_hz=body.pre_highpass_hz,
        vocal_spectral_gate_threshold_db=body.vocal_spectral_gate_threshold_db,
        vocal_dynamic_eq_max_reduction_db=body.vocal_dynamic_eq_max_reduction_db,
        vocal_expander=body.vocal_expander,
        deess_freq_hz=body.deess_freq_hz,
        air_boost_gain_db=body.air_boost_gain_db,
        air_boost_freq_hz=body.air_boost_freq_hz,
        vocal_balance_db=body.vocal_balance_db,
        parallel_weight_bus_db=body.parallel_weight_bus_db,
        sidechain_pocket_eq_enabled=body.sidechain_pocket_eq_enabled,
    )
    try:
        result = await _enhance(stems_dir, stems_dir / "enhanced", cfg)
    except Exception as exc:
        logger.exception("Suno enhancer failed")
        raise HTTPException(status_code=500, detail=f"Enhancement failed: {exc}") from exc

    all_stems = [p for p in stems_dir.glob("*.wav") if p.is_file()]
    wav_path = result.wav_path or (stems_dir / "enhanced" / f"{stems_dir.name}_enhanced.wav")
    mp3_path = result.mp3_path or (stems_dir / "enhanced" / f"{stems_dir.name}_enhanced.mp3")
    duration = 0.0
    try:
        if wav_path and wav_path.exists():
            import wave
            with wave.open(str(wav_path), "rb") as wf:
                duration = round(wf.getnframes() / max(wf.getframerate(), 1), 3)
    except Exception:
        pass

    return EnhanceStemsResponse(
        success=result.success,
        input_filename=filename,
        model=model,
        stems=[p.name for p in all_stems],
        wav_path=str(wav_path) if wav_path and wav_path.exists() else None,
        mp3_path=str(mp3_path) if mp3_path and mp3_path.exists() else None,
        steps=result.steps,
        error=result.error,
        duration=duration,
    )
