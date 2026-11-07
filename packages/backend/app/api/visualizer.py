"""
Visualizer API routes.
Handles track selection, style presets, and state management for the visualizer.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/visualizer", tags=["Visualizer"])

# In-memory state (could be moved to Redis or database for production)
_visualizer_state = {
    "current_track": None,
    "style": "default",
    "mode": "3d",
}


class TrackRequest(BaseModel):
    track: str = Field(..., description="Audio track filename to load")


class StyleRequest(BaseModel):
    style: str = Field(..., description="Style preset name (e.g., 'spectral', 'waveform', 'particles', 'shader')")


class ModeRequest(BaseModel):
    mode: str = Field(..., description="Visualization mode: 2d, 3d, or shader")


@router.post("/track", response_model=dict)
async def set_track(request: TrackRequest):
    """Set the active track in the visualizer."""
    track = request.track
    _visualizer_state["current_track"] = track
    logger.info(f"Visualizer track set to: {track}")
    return {
        "success": True,
        "track": track,
        "message": f"Visualizer track set to {track}"
    }


@router.post("/style", response_model=dict)
async def set_style(request: StyleRequest):
    """Apply a visual style preset to the visualizer."""
    style = request.style
    _visualizer_state["style"] = style
    logger.info(f"Visualizer style set to: {style}")
    return {
        "success": True,
        "style": style,
        "message": f"Visualizer style set to {style}"
    }


@router.post("/mode", response_model=dict)
async def set_mode(request: ModeRequest):
    """Set the visualization mode."""
    mode = request.mode
    if mode not in ["2d", "3d", "shader"]:
        raise HTTPException(status_code=400, detail="Invalid mode. Must be 2d, 3d, or shader")
    _visualizer_state["mode"] = mode
    logger.info(f"Visualizer mode set to: {mode}")
    return {
        "success": True,
        "mode": mode,
        "message": f"Visualizer mode set to {mode}"
    }


@router.get("/state", response_model=dict)
async def get_state():
    """Get current visualizer state."""
    return {
        "current_track": _visualizer_state["current_track"],
        "style": _visualizer_state["style"],
        "mode": _visualizer_state["mode"],
    }
