"""
Shared generation request models used by the integrations API.

These Pydantic models are the single source of truth for generation request
schemas.  Both ``integrations_config`` and ``integrations_generation`` import
from here so validation rules cannot drift between routers.
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, field_validator


def _check_steps(v: int) -> int:
    if v < 1 or v > 150:
        raise ValueError("steps must be between 1 and 150")
    return v


def _check_cfg(v: float) -> float:
    if v < 0.0 or v > 30.0:
        raise ValueError("cfg_scale must be between 0.0 and 30.0")
    return v


def _check_dimension(v: int) -> int:
    if v < 64 or v > 4096 or v % 8 != 0:
        raise ValueError("dimensions must be between 64 and 4096 and divisible by 8")
    return v


class VideoModelVariant(str, Enum):
    """Precision / packaging variant for a video generation checkpoint."""
    FP16 = "fp16"
    GGUF_Q4 = "gguf_q4"
    GGUF_Q5 = "gguf_q5"
    STANDARD = "standard"


class VideoModelCapabilities(BaseModel):
    """Describes what a video model can do and what hardware it needs."""

    name: str
    variant: VideoModelVariant = VideoModelVariant.STANDARD
    min_vram_mb: int = 4000
    recommended_vram_mb: int = 6000
    max_vram_mb: int = 8000
    best_for: str = "Short video clips"
    supports_8gb: bool = True
    requires_cpu_offload: bool = False


class ImageGenerationRequest(BaseModel):
    """Request for image generation via ComfyUI or other backends.

    Quality-focused defaults (updated 2026-10-28):
    - steps: 30 (was 20) - better quality, matches SD 1.5/SDXL best practice
    - cfg_scale: 6.0 (was 7.0) - better balance, less oversaturation artifacts
    - width/height: 768x512 (was 512x512) - higher resolution for better detail
    - sampler: "DPM++ 2M Karras" (was "Euler a") - higher quality sampler
    - scheduler: "karras" (was "normal") - better convergence with DPM++

    Best practices from research:
    - Standard models (SD 1.5, SDXL): 25-50 steps, 30 is optimal
    - CFG 5-8 for SD 1.5, 5-7 for SDXL, 3.5-6 for newer models
    - DPM++ 2M Karras is best all-around sampler for SDXL
    - Karras scheduler improves convergence
    """

    prompt: str
    negative_prompt: str = ""
    steps: int = 30
    cfg_scale: float = 6.0
    width: int = 768
    height: int = 512
    seed: int = -1
    sampler: str = "DPM++ 2M Karras"
    scheduler: str = "karras"
    backend: str = "comfyui"
    ckpt_name: str = ""
    enrich_prompt: bool = False  # Explicit opt-in for LLM prompt enrichment

    @field_validator("steps")
    @classmethod
    def validate_steps(cls, v: int) -> int:
        return _check_steps(v)

    @field_validator("cfg_scale")
    @classmethod
    def validate_cfg(cls, v: float) -> float:
        return _check_cfg(v)

    @field_validator("width", "height")
    @classmethod
    def validate_dimension(cls, v: int) -> int:
        return _check_dimension(v)

    def to_adapter_params(self) -> dict:
        """Single conversion from API request to adapter params.

        Consolidates the dict-building previously duplicated in
        ``generate_image`` and ``queue_image_job`` (which also drifted:
        the queue path used ``sampler`` while the adapter read
        ``sampler_name`` -- both keys are now emitted).
        """
        params = {
            "prompt": self.prompt,
            "negative_prompt": self.negative_prompt,
            "steps": self.steps,
            "cfg_scale": self.cfg_scale,
            "width": self.width,
            "height": self.height,
            "seed": self.seed,
            "sampler_name": self.sampler,
            "sampler": self.sampler,
            "scheduler": self.scheduler,
        }
        if self.ckpt_name:
            params["ckpt_name"] = self.ckpt_name
        return params


class VideoGenerationRequest(BaseModel):
    """Request for video generation using AnimateDiff or Wan 2.2 GGUF.

    Quality-focused defaults (updated 2026-10-28):
    - steps: 25 (was 15) - better quality, especially for WAN (best practice: 40-50)
    - cfg_scale: 5.0 (was 7.0) - better for WAN (5.0) and closer to LTX needs (1.0 for distilled)
    - width/height: 768x512 (was 512x512) - higher resolution quality
    - num_frames: 25 (was 16) - more coherent motion
    - fps: 12 (was 8) - smoother motion

    Note: LTX distilled variants override cfg to 1.0 in the workflow builder.
    WAN GGUF enforces minimum 40 steps in the workflow builder.
    """

    prompt: str
    negative_prompt: str = ""
    steps: int = 25
    cfg_scale: float = 5.0
    width: int = 768
    height: int = 512
    seed: int = -1
    sampler: str = "Euler a"
    num_frames: int = 25
    fps: int = 12
    motion_module: str = "mm_sd_v15_v2.ckpt"
    motion_lora: str = ""
    motion_lora_strength: float = 0.8
    scheduler: str = "normal"
    # Wan 2.2 GGUF additions
    model_variant: VideoModelVariant = VideoModelVariant.STANDARD
    ckpt_name: str = ""  # explicit checkpoint override for Wan/other pipelines
    image_path: str | None = None  # image-to-video: path to input image (uploaded via /api/integrations/comfyui/upload-image)
    image_role: str | None = None  # I2V role: "first_frame", "inspiration", or "editing_target"
    camera_motion: str = "none"  # camera move: "none", "push_in", "pull_out", "pan_left", "pan_right", "tilt_up", "tilt_down", "zoom_in", "orbit"
    motion_strength: float = 5.0  # 1-10 motion intensity for I2V
    enrich_prompt: bool = False  # LLM prompt enhancement

    @field_validator("steps")
    @classmethod
    def validate_steps(cls, v: int) -> int:
        return _check_steps(v)

    @field_validator("cfg_scale")
    @classmethod
    def validate_cfg(cls, v: float) -> float:
        return _check_cfg(v)

    @field_validator("width", "height")
    @classmethod
    def validate_dimension(cls, v: int) -> int:
        return _check_dimension(v)

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

    def to_adapter_params(self) -> dict:
        """Single conversion from video request to adapter params."""
        variant = self.model_variant.value if hasattr(self.model_variant, "value") else str(self.model_variant)
        params: dict[str, Any] = {
            "prompt": self.prompt,
            "negative_prompt": self.negative_prompt,
            "steps": self.steps,
            "cfg_scale": self.cfg_scale,
            "width": self.width,
            "height": self.height,
            "seed": self.seed,
            "sampler_name": self.sampler,
            "sampler": self.sampler,
            "scheduler": self.scheduler,
            "video": True,
            "num_frames": self.num_frames,
            "fps": self.fps,
            "motion_module": self.motion_module,
            "motion_lora": self.motion_lora,
            "motion_lora_strength": self.motion_lora_strength,
            "model_variant": variant,
            "ckpt_name": self.ckpt_name,
        }
        if self.image_path:
            params["image_path"] = self.image_path
        if self.image_role:
            params["image_role"] = self.image_role
        if self.camera_motion:
            params["camera_motion"] = self.camera_motion
        params["motion_strength"] = self.motion_strength
        params["enrich_prompt"] = self.enrich_prompt
        return params
