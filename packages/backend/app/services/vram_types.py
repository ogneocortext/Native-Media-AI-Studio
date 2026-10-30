"""
VRAM types and enums.

Extracted from vram_manager.py. Contains GPU workload and state enums.
"""

from __future__ import annotations

from enum import StrEnum


class GPUWorkload(StrEnum):
    """Types of GPU workloads"""
    IDLE = "idle"
    LLM_INFERENCE = "llm_inference"
    RENDER_3D = "render_3d"
    IMAGE_GENERATION = "image_generation"
    MUSIC_GENERATION = "music_generation"
    AUDIO_ANALYSIS = "audio_analysis"
    LIPSYNC = "lipsync"


class GPUState(StrEnum):
    """States of GPU resource allocation"""
    AVAILABLE = "available"
    BUSY = "busy"
    CRITICAL = "critical"


__all__ = ["GPUWorkload", "GPUState"]
