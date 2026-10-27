"""
Typed dataclass models for database rows.

Extracted from packages/backend/app/core/database.py (was 4121 lines).
Each model represents a typed representation of a database table row.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class PromptRow:
    """Typed representation of a prompts table row."""
    id: str
    name: str
    prompt_type: str
    text: str
    tags: list[str]
    category: str
    description: str
    is_favorite: bool
    use_count: int
    last_used_at: str | None
    created_at: str
    updated_at: str


@dataclass
class AudioFileRow:
    """Typed representation of an audio_files table row."""
    id: str
    filename: str
    original_name: str
    stored_path: str
    file_size: int
    duration: float
    sample_rate: int
    channels: int
    format: str
    bpm: float | None
    key: str | None
    genre: str | None
    music_prompt_id: str | None
    analysis_result: dict[str, Any]
    created_at: str


@dataclass
class AIVisualRow:
    """Typed representation of an ai_visuals table row."""
    id: str
    prompt_id: str | None
    style_id: str
    checkpoint: str
    width: int
    height: int
    steps: int
    cfg: float
    seed: int
    sampler: str
    scheduler: str
    filename: str
    stored_path: str
    comfyui_prompt_id: str
    is_selected: bool
    is_favorite: bool
    rating: int
    tags: list[str]
    generation_time_seconds: float
    created_at: str


@dataclass
class SessionRow:
    """Typed representation of a generation_sessions table row."""
    id: str
    audio_id: str | None
    music_prompt_id: str | None
    status: str
    config: dict[str, Any]
    selected_visuals: list[Any]
    output_path: str | None
    total_frames: int
    generated_frames: int
    estimated_time_seconds: float
    actual_time_seconds: float
    created_at: str
    completed_at: str | None


@dataclass
class TrackRow:
    """Typed representation of a tracks table row."""
    id: str
    filename: str
    artist: str
    title: str
    duration_seconds: float
    size_mb: float
    source_path: str
    music_prompt: str
    lyrics: str
    visual_style: str
    visual_prompt: str
    status: str
    tags: list[str]
    comfyui_visual_ids: list[str]
    output_path: str | None
    created_at: str
    updated_at: str


@dataclass
class VizPresetRow:
    """Typed representation of a visualization_presets table row."""
    id: str
    track_name: str
    track_hash: str
    preset_name: str
    visualization_style: str
    params: dict[str, Any]
    ollama_model: str | None
    prompt: str
    lyrics: str
    mood_tags: list[str]
    genre_tags: list[str]
    bpm: int
    energy_level: str
    is_unique: bool
    usage_count: int
    last_used: str | None
    created_at: str
    updated_at: str


@dataclass
class SystemResourceRow:
    """Typed representation of a system_resources table row."""
    id: int
    timestamp: str
    gpu_name: str | None
    gpu_memory_total: int | None
    gpu_memory_used: int | None
    gpu_memory_free: int | None
    gpu_utilization: int | None
    cpu_percent: int | None
    ram_total: int | None
    ram_used: int | None
    ram_free: int | None
    ollama_available: bool
    ollama_models: list[str]


@dataclass
class OllamaModelRow:
    """Typed representation of an ollama_models table row."""
    id: str
    model_name: str
    model_size: int | None
    model_digest: str | None
    is_tool_capable: bool
    vram_required: int | None
    last_checked: str | None
    is_available: bool
    capabilities: list[str]
    created_at: str


@dataclass
class OllamaAnalysisRow:
    """Typed representation of an ollama_analysis_responses table row."""
    id: str
    track_name: str
    track_filename: str
    model_name: str
    prompt: str
    lyrics: str
    bpm: int
    html_response: str
    raw_response: str
    status: str
    created_at: str


@dataclass
class LogEventRow:
    id: int
    ts_iso: str
    ts_ms: int
    level: str
    logger: str
    message: str
    source: str


@dataclass
class GpuTelemetryRow:
    id: int
    ts_ms: int
    ts_iso: str
    gpu_name: str | None
    memory_total: int | None
    memory_used: int | None
    memory_free: int | None
    memory_percent: float | None
    gpu_util: int | None
    mem_controller_util: int | None
    temperature_c: int | None
    processes: list[dict]


@dataclass
class VisionOcrRow:
    id: str
    relative_path: str
    filename: str
    ocr_text: str
    model: str
    prompt: str
    file_type: str | None
    size_bytes: int | None
    created_at: str


@dataclass
class NativeOpenRow:
    id: str
    relative_path: str
    filename: str
    app: str
    method: str | None
    success: bool
    created_at: str


@dataclass
class StudioSceneRow:
    id: str
    filename: str
    code: str
    track: str | None
    model: str | None
    preview_image: str | None
    created_at: str
    updated_at: str


@dataclass
class CharacterBibleRow:
    id: str
    filename: str
    name: str | None
    notes: str | None
    seed: int | None
    prompt: str | None
    created_at: str
    updated_at: str
