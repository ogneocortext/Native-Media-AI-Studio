"""
Three.js Studio API routes.
Handles scene export and frame sequence rendering.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/threestudio", tags=["Three.js Studio"])


class ExportFramesRequest(BaseModel):
    frames: int = Field(default=360, ge=1, le=10000, description="Total frames (360 = 15s @ 24fps)")
    fps: int = Field(default=24, ge=1, le=60, description="Frames per second")
    output_dir: str = Field(..., description="Output directory path")
    scene_name: str | None = Field(default=None, description="Scene name to export")


class ExportFramesResponse(BaseModel):
    success: bool
    frames_rendered: int
    output_path: str | None = None
    message: str


# Rebuild models to ensure they're fully defined
ExportFramesRequest.model_rebuild()
ExportFramesResponse.model_rebuild()


@router.post("/export", response_model=ExportFramesResponse)
async def export_frames(request: ExportFramesRequest):
    """Export a frame sequence from Three.js Studio for video.

    Not implemented: there is no server-side Three.js renderer. The real
    frame-capture path is the Blender frame-package builder
    (tools/blender/frame_package.py, T-VID-17) and the Unity MV renderer.
    Returning 501 rather than a fabricated success keeps the API honest.
    """
    logger.info(f"Frame export requested ({request.frames} frames) but no renderer exists")
    raise HTTPException(
        status_code=501,
        detail=(
            "Three.js frame export is not implemented. Use the Blender "
            "frame-package capture (tools/blender/frame_package.py) or the "
            "Unity MV renderer for frame sequences."
        ),
    )


@router.get("/status", response_model=dict)
async def get_status():
    """Get Three.js Studio status."""
    return {
        "status": "ready",
        "message": "Three.js Studio API is ready"
    }
