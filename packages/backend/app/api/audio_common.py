"""
Shared audio path/extension constants for the /api/audio route modules.

Extracted from ``app/api/audio.py``, ``app/api/audio_stems.py`` and
``app/api/audio_edit.py`` which previously mirrored these values by hand to
avoid circular imports (all three routers are registered under the same
``/api/audio`` prefix in ``main.py``, so no one module can import another).

Single source of truth: change here and all three route modules stay in sync.
"""

from __future__ import annotations

from ..core.config import PROJECT_ROOT

# Root directory for all audio library files.
AUDIO_DIR = PROJECT_ROOT / "output" / "audio"
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

# Audio extracted/converted from video lives in its own subfolder so it is not
# mixed with native audio library files.
VIDEO_EXTRACTED_AUDIO_DIR = AUDIO_DIR / "video-extracted"
VIDEO_EXTRACTED_AUDIO_DIR.mkdir(parents=True, exist_ok=True)

# File extensions accepted for audio uploads / edits.
ALLOWED_EXTENSIONS = {".mp3", ".wav", ".flac", ".ogg", ".opus", ".m4a", ".wma", ".aac"}

__all__ = ["AUDIO_DIR", "VIDEO_EXTRACTED_AUDIO_DIR", "ALLOWED_EXTENSIONS"]
