"""
Video generation API routes.
Handles music video generation per section.
"""

import logging
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/video", tags=["Video"])


class VideoGenerateRequest(BaseModel):
    """Request model for video section generation — real queue, no mock"""
    prompt: str
    negative_prompt: str = ""
    steps: int = 20
    cfg_scale: float = 7.0
    seed: int = -1
    section: str = "full"
    duration: float = 10.0
    vertical_first: bool = False
    audio_path: str | None = None
    audio_filename: str | None = None
    method: str = "visualization"
    model: str = ""
    visualization: dict[str, Any] | None = None


class VideoGenerateResponse(BaseModel):
    """Response model for video generation — now returns real job for polling"""
    success: bool
    job_id: str | None = None
    output_path: str | None = None
    section: str
    error: str | None = None
    message: str | None = None


# ---------------------------------------------------------------------------
# Render engine abstraction (stack-extensions-2026.md Phase 2)
# ---------------------------------------------------------------------------

class RenderRequest(BaseModel):
    """Engine-agnostic render request.

    kind: "color" (solid test/underlay clip), "frames" (image sequence),
          "image" (still held for duration).
    engine: "auto" | "coreflux" | "movielite" | "ffmpeg" | "moviepy"
    output_path: relative paths resolve against the project root
                 (defaults into output/video/).
    """
    kind: str = "color"
    engine: str = "auto"
    width: int = Field(default=1280, ge=16, le=7680)
    height: int = Field(default=720, ge=16, le=4320)
    duration: float = Field(default=5.0, gt=0, le=3600)
    fps: int = Field(default=24, ge=1, le=120)
    output_path: str | None = None
    color: str = "#000000"
    frames_dir: str | None = None
    frame_pattern: str = "frame_%04d.png"
    image_path: str | None = None
    audio_path: str | None = None


@router.post("/generate-section", response_model=VideoGenerateResponse)
async def generate_section(request: VideoGenerateRequest) -> VideoGenerateResponse:
    """Generate a video section — queues real MUSIC_VIDEO job, no mock fallback."""
    try:
        from ..models.job import JobType
        from ..queue.manager import queue_manager

        # Validate prompt
        if not request.prompt or not request.prompt.strip():
            raise ValueError("prompt is required")

        # Use the real MUSIC_VIDEO job type (VIDEO_GENERATE does not exist in JobType)
        # Resolve audio_path from audio_filename when not provided directly
        if not request.audio_path:
            from ..core.config import PROJECT_ROOT as _PR
            audio_dir = _PR / "output" / "audio"
            if request.audio_filename and audio_dir.exists():
                candidate = audio_dir / request.audio_filename
                if candidate.exists():
                    request.audio_path = str(candidate)
            if not request.audio_path:
                # Fallback: most recent uploaded audio
                candidates = sorted(audio_dir.glob("*"), key=lambda p: p.stat().st_mtime, reverse=True) if audio_dir.exists() else []
                fallback = str(candidates[0]) if candidates else None
                if not fallback:
                    raise ValueError("audio_path is required — upload audio first via /api/audio/upload or /api/audio/analyze")
                request.audio_path = fallback

        viz_config = (request.visualization or {}).copy()
        viz_config.setdefault("style", "abstract")
        viz_config.setdefault("duration", f"{int(request.duration)}s" if request.duration < 60 else "full")
        viz_config.setdefault("resolution", "1080p")
        viz_config.setdefault("fps", 30)

        job_request = {
            "job_type": JobType.MUSIC_VIDEO,
            "params": {
                "prompt": request.prompt,
                "negative_prompt": request.negative_prompt,
                "steps": request.steps,
                "cfg_scale": request.cfg_scale,
                "seed": request.seed if request.seed >= 0 else None,
                "section": request.section,
                "duration": request.duration,
                "duration_seconds": request.duration,
                "audio_path": request.audio_path,
                "audio_filename": request.audio_filename or Path(request.audio_path).name if request.audio_path else "track.mp3",
                "visualization": viz_config,
                "method": request.method,
                "vertical_first": request.vertical_first,
            },
            "max_retries": 1,
        }
        # queue_manager.enqueue expects JobCreateRequest; use create_job convenience
        from ..models.job import JobCreateRequest

        jcr = JobCreateRequest(job_type=JobType.MUSIC_VIDEO, params=job_request["params"], max_retries=1)
        job = await queue_manager.enqueue(jcr)

        return VideoGenerateResponse(
            success=True,
            job_id=job.id,
            output_path=f"output/video/{request.section}_{job.id}.mp4",
            section=request.section,
            message=f"Queued section {request.section} as job {job.id[:8]}",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class ExportMatrixRequest(BaseModel):
    """Export Matrix request — one master video → publishing derivatives.

    source_path: absolute or project-relative path to a master video
                 (typically output/video/*.mp4).
    beat_times / sections: optional audio-analysis data for beat-aligned
                 loop starts (from POST /api/audio/analyze).
    loop_seconds: Spotify Canvas range 3-8s (default 4.0).
    """
    source_path: str
    beat_times: list[float] | None = None
    sections: list[dict] | None = None
    loop_seconds: float = Field(default=4.0, ge=2.0, le=8.0)


@router.get("/render/engines")
async def list_render_engines() -> dict:
    """List available video render engines with live availability."""
    from ..services.video import available_engines

    return {"engines": available_engines()}


@router.post("/render")
async def render_video(request: RenderRequest) -> dict:
    """Render a clip with the selected engine (VideoRenderer abstraction).

    Unlike /generate-section (full music-video queue jobs), this is the direct
    render path for quick composites — matches stack-extensions-2026.md:
    `/api/video/render?engine=moviepy|coreflux|movielite`.
    """
    from ..core.config import PROJECT_ROOT
    from ..services.video import get_renderer, RenderSpec

    try:
        renderer = get_renderer(request.engine)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    output_path = request.output_path or f"output/video/render_{request.kind}_{renderer.engine_id}.mp4"
    if not Path(output_path).is_absolute():
        # Anchor on project root (the API process runs with CWD=packages/backend)
        output_path = str(Path(PROJECT_ROOT) / output_path)
    spec = RenderSpec(
        kind=request.kind,
        width=request.width,
        height=request.height,
        duration=request.duration,
        fps=request.fps,
        output_path=output_path,
        color=request.color,
        frames_dir=request.frames_dir or "",
        frame_pattern=request.frame_pattern,
        image_path=request.image_path or "",
        audio_path=request.audio_path,
    )
    try:
        result = await renderer.render(spec)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    rel = None
    try:
        rel = Path(result.output_path).resolve().relative_to(Path(PROJECT_ROOT).resolve()).as_posix()
    except ValueError:
        pass
    return {
        "success": result.success,
        "engine": result.engine,
        "output_path": result.output_path,
        "relative_path": rel,
        "render_s": result.render_s,
        "size_bytes": result.size_bytes,
        "error": result.error,
        "notes": result.notes,
    }


@router.post("/export-matrix")
async def export_matrix(request: ExportMatrixRequest) -> dict:
    """Build the Export Matrix for one master video (ai-video-trends-2026 Trend 5).

    Derives: 1080x1920 vertical master, 3-8s beat-aligned Canvas loop,
    3 thumbnail variants (A/B/C), and a manifest sidecar. Artifacts land in
    output/video and output/images so they appear in the Media Library.
    """
    from ..services.export_matrix import build_export_matrix

    try:
        result = await build_export_matrix(
            request.source_path,
            beat_times=request.beat_times,
            sections=request.sections,
            loop_seconds=request.loop_seconds,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return {
        "success": bool(result.artifacts) and not result.errors,
        "source": result.source,
        "artifacts": [a.__dict__ for a in result.artifacts],
        "errors": result.errors,
        "render_s": result.render_s,
        "manifest_path": result.manifest_path,
        "message": f"Export matrix built: {len(result.artifacts)} artifact(s)"
        + (f", {len(result.errors)} error(s)" if result.errors else ""),
    }
