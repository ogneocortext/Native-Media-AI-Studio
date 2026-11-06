"""
Output file data models.

Extracted from outputs.py. Contains the Pydantic models used by the
outputs listing API and the file-type classification helper.
"""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel


class OutputFile(BaseModel):
    """Model for an output file with its metadata"""

    filename: str
    path: str
    relative_path: str
    file_type: str  # image, video, audio
    size_bytes: int
    created_at: str
    modified_at: str | None = None
    cover_image: str | None = None
    has_cover: bool = False  # Whether a thumbnail/cover exists
    metadata: dict | None = None
    job_id: str | None = None
    # Audio analysis fields (populated from sidecar metadata when available)
    duration_seconds: float | None = None
    loudness_lufs: float | None = None
    waveform: list[float] | None = None  # Downsampled amplitude envelope (~50 points)


class OutputsResponse(BaseModel):
    """Response model for outputs listing"""

    outputs: list[OutputFile]
    total: int
    images_count: int
    videos_count: int
    audio_count: int
    models_3d_count: int = 0


class BulkDeleteRequest(BaseModel):
    paths: list[str]


class RenameRequest(BaseModel):
    new_name: str  # new filename only, no path


def get_file_type(filename: str) -> str:
    """Determine file type from extension"""
    ext = Path(filename).suffix.lower()
    image_exts = {
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".webp",
        ".bmp",
        ".svg",
        ".tiff",
        ".tif",
        ".avif",
        ".heic",
        ".heif",
    }
    video_exts = {".mp4", ".webm", ".avi", ".mov", ".mkv", ".m4v", ".ogv"}
    audio_exts = {
        ".mp3",
        ".wav",
        ".flac",
        ".ogg",
        ".oga",
        ".opus",
        ".m4a",
        ".aac",
        ".wma",
        ".aiff",
        ".aif",
        ".alac",
        ".amr",
    }
    model_exts = {".glb", ".gltf", ".obj", ".fbx", ".ply", ".stl"}

    if ext in image_exts:
        return "image"
    elif ext in video_exts:
        return "video"
    elif ext in audio_exts:
        return "audio"
    elif ext in model_exts:
        return "3d"
    return "other"
