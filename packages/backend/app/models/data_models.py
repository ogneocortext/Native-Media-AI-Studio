"""
Database models for persistent data storage.
Includes prompts, audio metadata, AI visuals, and user preferences.
"""

import uuid
from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, computed_field


class PromptType(str, Enum):
    """Types of prompts stored."""
    MUSIC_GENERATION = "music_generation"  # Original prompt used to generate music
    VISUAL_GENERATION = "visual_generation"  # Prompt for AI image generation
    STYLE_TEMPLATE = "style_template"  # Reusable style template


class Prompt(BaseModel):
    """Stored prompt for reuse across sessions."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str = ""  # User-friendly name
    prompt_type: PromptType
    text: str  # The actual prompt text
    tags: list[str] = Field(default_factory=list)  # Searchable tags
    category: str = ""  # e.g., "synthwave", "cinematic", "nature"
    description: str = ""
    is_favorite: bool = False
    use_count: int = 0  # Track how often this prompt is used
    last_used_at: datetime | None = None
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)

    model_config = ConfigDict(use_enum_values=True)


class AudioFileRecord(BaseModel):
    """Stored audio file metadata."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    filename: str
    original_name: str
    stored_path: str
    file_size: int = 0
    duration: float = 0.0
    sample_rate: int = 44100
    channels: int = 2
    format: str = ""  # mp3, wav, flac, etc
    bpm: float | None = None
    key: str | None = None
    genre: str | None = None
    music_prompt_id: str | None = None  # Link to music generation prompt
    analysis_result: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=datetime.now)

    model_config = ConfigDict(use_enum_values=True)


class AIVisualRecord(BaseModel):
    """Record of AI-generated visual."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    prompt_id: str | None = None  # Link to visual prompt used
    style_id: str = ""  # e.g., "cinematic", "abstract"
    checkpoint: str = ""
    width: int = 512
    height: int = 512
    steps: int = 20
    cfg: float = 7.0
    seed: int = 0
    sampler: str = "euler"
    scheduler: str = "normal"
    filename: str = ""  # Stored image filename
    stored_path: str = ""
    comfyui_prompt_id: str = ""  # ComfyUI's prompt ID for history lookup
    is_selected: bool = False  # Whether user selected this for the video
    is_favorite: bool = False
    rating: int = 0  # 1-5 user rating
    tags: list[str] = Field(default_factory=list)
    generation_time_seconds: float = 0.0
    created_at: datetime = Field(default_factory=datetime.now)

    model_config = ConfigDict(use_enum_values=True)


class GenerationSession(BaseModel):
    """Tracks a full music video generation session."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    audio_id: str | None = None  # Link to audio file
    music_prompt_id: str | None = None
    status: str = "draft"  # draft, generating, completed, failed
    config: dict[str, Any] = Field(default_factory=dict)
    selected_visuals: list[str] = Field(default_factory=list)  # IDs of selected AIVisualRecords
    output_path: str | None = None
    total_frames: int = 0
    generated_frames: int = 0
    estimated_time_seconds: float = 0.0
    actual_time_seconds: float = 0.0
    created_at: datetime = Field(default_factory=datetime.now)
    completed_at: datetime | None = None

    model_config = ConfigDict(use_enum_values=True)


class UserPreference(BaseModel):
    """User preferences and defaults."""
    key: str  # Unique key for the preference
    value: Any  # JSON-serialized value
    category: str = "general"  # general, generation, ui, prompts
    updated_at: datetime = Field(default_factory=datetime.now)

    model_config = ConfigDict(use_enum_values=True)


__all__ = [
    "PromptType",
    "Prompt",
    "AudioFileRecord",
    "AIVisualRecord",
    "GenerationSession",
    "UserPreference",
]
