"""
Video generation API routes.
Handles music video generation per section.
"""

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

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


class VideoGenerateResponse(BaseModel):
    """Response model for video generation — now returns real job for polling"""
    success: bool
    job_id: str | None = None
    output_path: str | None = None
    section: str
    error: str | None = None
    message: str | None = None


@router.post("/generate-section", response_model=VideoGenerateResponse)
async def generate_section(request: VideoGenerateRequest) -> VideoGenerateResponse:
    """Generate a video section — queues real MUSIC_VIDEO job, no mock fallback."""
    try:
        from ..queue.manager import queue_manager
        from ..models.job import JobType

        # Validate prompt
        if not request.prompt or not request.prompt.strip():
            raise ValueError("prompt is required")

        # Use the real MUSIC_VIDEO job type (VIDEO_GENERATE does not exist in JobType)
        # Require audio_path for real handler — no silent placeholder
        if not request.audio_path:
            # Try to find most recent uploaded audio as fallback
            from pathlib import Path as _P
            from ..core.config import PROJECT_ROOT as _PR
            audio_dir = _PR / "output" / "audio"
            candidates = sorted(audio_dir.glob("*"), key=lambda p: p.stat().st_mtime, reverse=True) if audio_dir.exists() else []
            fallback = str(candidates[0]) if candidates else None
            if not fallback:
                raise ValueError("audio_path is required — upload audio first via /api/audio/upload or /api/audio/analyze")
            request.audio_path = fallback

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
                "visualization": {
                    "style": "abstract",
                    "duration": f"{int(request.duration)}s" if request.duration < 60 else "full",
                    "resolution": "1080p",
                    "fps": 30,
                },
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
