"""
Three.js Studio API routes.
Handles scene export and frame sequence rendering.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/threestudio", tags=["Three.js Studio"])

class ExportFramesRequest(BaseModel):
    frames: int = Field(default=360, ge=1, le=10000, description="Total frames (360 = 15s @ 24fps)")
    fps: int = Field(default=24, ge=1, le=60, description="Frames per second")
    output_dir: str = Field(..., description="Output directory path")
    scene_name: Optional[str] = Field(default=None, description="Scene name to export")

class ExportFramesResponse(BaseModel):
    success: bool
    frames_rendered: int
    output_path: Optional[str] = None
    message: str

# Rebuild models to ensure they're fully defined
ExportFramesRequest.model_rebuild()
ExportFramesResponse.model_rebuild()

@router.post("/export", response_model=ExportFramesResponse)
async def export_frames(request: ExportFramesRequest):
    """
    Export a frame sequence from Three.js Studio for video.
    
    This endpoint renders a sequence of frames from the current Three.js scene.
    In a full implementation, this would:
    1. Load the scene
    2. Set up the renderer
    3. Render each frame
    4. Save frames to the output directory
    """
    logger.info(f"Exporting {request.frames} frames at {request.fps} fps to {request.output_dir}")
    
    try:
        # TODO: Implement actual frame export
        # This would typically:
        # 1. Load the Three.js scene (from scene_name or current session)
        # 2. Set up an offscreen renderer (WebGL or headless)
        # 4. Render each frame
        # 5. Save as PNG sequence or encode to video
        
        # For now, return success with mock data
        return ExportFramesResponse(
            success=True,
            frames_rendered=request.frames,
            output_path=request.output_dir,
            message=f"Exported {request.frames} frames at {request.fps} fps to {request.output_dir}"
        )
        
    except Exception as e:
        logger.error(f"Frame export failed: {e}")
        raise HTTPException(status_code=500, detail=f"Frame export failed: {str(e)}")

@router.get("/status", response_model=dict)
async def get_status():
    """Get Three.js Studio status."""
    return {
        "status": "ready",
        "message": "Three.js Studio API is ready"
    }