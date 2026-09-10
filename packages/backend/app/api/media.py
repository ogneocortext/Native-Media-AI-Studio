"""Media inspection API routes.

Exposes previously internal-only FFmpeg capabilities to the frontend:
- GET /api/media/probe       -> FFprobe metadata
- GET /api/media/loudness    -> EBU R128 loudness (LUFS)
- GET /api/media/waveform    -> downsampled waveform peaks
- POST /api/media/thumbnail  -> timestamp-specific frame extraction
- POST /api/media/cover      -> manual cover regeneration
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from ..core.config import PROJECT_ROOT, config
from ..services.ffmpeg_tools import (
    compute_loudness,
    extract_thumbnail_at_time,
    extract_waveform,
    probe_media,
    regenerate_cover,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/media", tags=["Media"])

# Resolve media roots the same way outputs.py does.
OUTPUT_BASE = Path(config.output_dir)
AUDIO_DIR = PROJECT_ROOT / "output" / "audio"
VIDEO_DIR = PROJECT_ROOT / "output" / "video"


def _resolve_relative_path(relative_path: str) -> Path | None:
    """Resolve a frontend-provided relative path inside the output directory."""
    candidate = (OUTPUT_BASE / relative_path).resolve()
    try:
        candidate.relative_to(OUTPUT_BASE.resolve())
    except ValueError:
        return None
    return candidate if candidate.exists() and candidate.is_file() else None


# =============================================================================
# Probe
# =============================================================================

class ProbeResponse(BaseModel):
    path: str
    relative_path: str | None = None
    probe: dict | None = None
    error: str | None = None


@router.get("/probe", response_model=ProbeResponse)
async def probe(
    request: Request,
    path: str = Query(..., description="Absolute or relative path under output/"),
) -> ProbeResponse:
    """Return FFprobe metadata for a media file.

    Accepts either an absolute path inside the project's output directory or a
    path relative to ``output/``.
    """
    target = Path(path)
    if not target.is_absolute():
        target = OUTPUT_BASE / path
    target = target.resolve()

    try:
        target.relative_to(OUTPUT_BASE.resolve())
    except ValueError:
        # Also allow absolute paths outside output when they exist (e.g. ComfyUI outputs).
        if not target.exists() or not target.is_file():
            raise HTTPException(status_code=400, detail="path must point to an existing media file")

    data = await probe_media(target)
    rel = None
    try:
        rel = target.relative_to(OUTPUT_BASE.resolve()).as_posix()
    except ValueError:
        pass
    return ProbeResponse(path=str(target), relative_path=rel, probe=data or None)


# =============================================================================
# Loudness
# =============================================================================

class LoudnessResponse(BaseModel):
    path: str
    relative_path: str | None = None
    integrated_lufs: float | None = None
    loudness_range: float | None = None
    true_peak: float | None = None
    error: str | None = None


@router.get("/loudness", response_model=LoudnessResponse)
async def loudness(
    request: Request,
    path: str = Query(..., description="Absolute or relative path under output/"),
) -> LoudnessResponse:
    """Compute EBU R128 loudness metrics for a media file."""
    target = Path(path)
    if not target.is_absolute():
        target = OUTPUT_BASE / path
    target = target.resolve()
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="file not found")

    result = await compute_loudness(target)
    rel = None
    try:
        rel = target.relative_to(OUTPUT_BASE.resolve()).as_posix()
    except ValueError:
        pass
    return LoudnessResponse(
        path=str(target),
        relative_path=rel,
        integrated_lufs=result.get("integrated_lufs"),
        loudness_range=result.get("loudness_range"),
        true_peak=result.get("true_peak"),
        error=result.get("error"),
    )


# =============================================================================
# Waveform
# =============================================================================

class WaveformResponse(BaseModel):
    path: str
    relative_path: str | None = None
    peaks: list[float] = []
    count: int = 0
    error: str | None = None


@router.get("/waveform", response_model=WaveformResponse)
async def waveform(
    request: Request,
    path: str = Query(..., description="Absolute or relative path under output/"),
    max_points: int = Query(240, ge=16, le=1200),
) -> WaveformResponse:
    """Return a downsampled amplitude envelope for waveform visualization."""
    target = Path(path)
    if not target.is_absolute():
        target = OUTPUT_BASE / path
    target = target.resolve()
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="file not found")

    result = await extract_waveform(target, max_points=max_points)
    rel = None
    try:
        rel = target.relative_to(OUTPUT_BASE.resolve()).as_posix()
    except ValueError:
        pass
    return WaveformResponse(
        path=str(target),
        relative_path=rel,
        peaks=result.get("peaks", []),
        count=int(result.get("count", 0)),
        error=result.get("error"),
    )


# =============================================================================
# Thumbnail at timestamp
# =============================================================================

class ThumbnailRequest(BaseModel):
    path: str = Field(..., description="Absolute or relative path under output/")
    time_sec: float = Field(default=1.0, ge=0.0, le=3600.0)
    width: int = Field(default=480, ge=64, le=7680)


class ThumbnailResponse(BaseModel):
    path: str
    relative_path: str | None = None
    thumbnail_path: str | None = None
    error: str | None = None


@router.post("/thumbnail", response_model=ThumbnailResponse)
async def thumbnail(body: ThumbnailRequest, request: Request) -> ThumbnailResponse:
    """Extract a frame at an arbitrary timestamp from a video file."""
    target = Path(body.path)
    if not target.is_absolute():
        target = OUTPUT_BASE / body.path
    target = target.resolve()
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="file not found")

    thumb = await extract_thumbnail_at_time(
        target,
        time_sec=body.time_sec,
        width=body.width,
    )
    rel = None
    if thumb:
        try:
            rel = Path(thumb).relative_to(OUTPUT_BASE.resolve()).as_posix()
        except ValueError:
            rel = thumb
    return ThumbnailResponse(
        path=str(target),
        relative_path=rel,
        thumbnail_path=thumb,
    )


# =============================================================================
# Cover regeneration
# =============================================================================

class CoverRegenerateResponse(BaseModel):
    path: str
    relative_path: str | None = None
    cover_image: str | None = None
    error: str | None = None


@router.post("/cover", response_model=CoverRegenerateResponse)
async def cover_regenerate(
    request: Request,
    path: str = Query(..., description="Absolute or relative path under output/"),
) -> CoverRegenerateResponse:
    """Force re-extraction of embedded cover art for an audio file."""
    target = Path(path)
    if not target.is_absolute():
        target = OUTPUT_BASE / path
    target = target.resolve()
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="file not found")

    cover = await regenerate_cover(target)
    rel = None
    if cover:
        cover_path = Path(cover)
        if cover_path.is_absolute():
            try:
                rel = cover_path.relative_to(OUTPUT_BASE.resolve()).as_posix()
            except ValueError:
                rel = None
        else:
            rel = cover_path.as_posix()
    return CoverRegenerateResponse(
        path=str(target),
        relative_path=rel,
        cover_image=rel,
    )
