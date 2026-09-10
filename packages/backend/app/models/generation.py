"""
Shared generation request models used by the integrations API.

These Pydantic models are the single source of truth for generation request
schemas.  Both ``integrations_config`` and ``integrations_generation`` import
from here so validation rules cannot drift between routers.
"""

from __future__ import annotations

from pydantic import BaseModel, field_validator


class ImageGenerationRequest(BaseModel):
    """Request for image generation via ComfyUI or other backends."""

    prompt: str
    negative_prompt: str = ""
    steps: int = 20
    cfg_scale: float = 7.0
    width: int = 512
    height: int = 512
    seed: int = -1
    sampler: str = "Euler a"
    backend: str = "comfyui"
    ckpt_name: str = ""
    enrich_prompt: bool = False  # Explicit opt-in for LLM prompt enrichment

    @field_validator("steps")
    @classmethod
    def validate_steps(cls, v: int) -> int:
        if v < 1 or v > 150:
            raise ValueError("steps must be between 1 and 150")
        return v

    @field_validator("cfg_scale")
    @classmethod
    def validate_cfg(cls, v: float) -> float:
        if v < 0.0 or v > 30.0:
            raise ValueError("cfg_scale must be between 0.0 and 30.0")
        return v

    @field_validator("width", "height")
    @classmethod
    def validate_dimension(cls, v: int) -> int:
        if v < 64 or v > 4096 or v % 8 != 0:
            raise ValueError("dimensions must be between 64 and 4096 and divisible by 8")
        return v


class VideoGenerationRequest(BaseModel):
    """Request for video generation using AnimateDiff."""

    prompt: str
    negative_prompt: str = ""
    steps: int = 15
    cfg_scale: float = 7.0
    width: int = 512
    height: int = 512
    seed: int = -1
    sampler: str = "Euler a"
    num_frames: int = 16
    fps: int = 8
    motion_module: str = "mm_sd_v15_v2.safetensors"

    @field_validator("steps")
    @classmethod
    def validate_steps(cls, v: int) -> int:
        if v < 1 or v > 150:
            raise ValueError("steps must be between 1 and 150")
        return v

    @field_validator("cfg_scale")
    @classmethod
    def validate_cfg(cls, v: float) -> float:
        if v < 0.0 or v > 30.0:
            raise ValueError("cfg_scale must be between 0.0 and 30.0")
        return v

    @field_validator("width", "height")
    @classmethod
    def validate_dimension(cls, v: int) -> int:
        if v < 64 or v > 4096 or v % 8 != 0:
            raise ValueError("dimensions must be between 64 and 4096 and divisible by 8")
        return v

    @field_validator("num_frames")
    @classmethod
    def validate_frames(cls, v: int) -> int:
        if v < 1 or v > 256:
            raise ValueError("num_frames must be between 1 and 256")
        return v

    @field_validator("fps")
    @classmethod
    def validate_fps(cls, v: int) -> int:
        if v < 1 or v > 60:
            raise ValueError("fps must be between 1 and 60")
        return v
