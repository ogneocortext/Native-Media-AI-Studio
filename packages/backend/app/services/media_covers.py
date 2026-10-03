"""Cover-art extraction (embedded ID3/FLAC pictures) via FFmpeg.

Lives in `services/` rather than `api/outputs.py` because `ffmpeg_tools`
genuinely needs it: that service used to do `from ..api.outputs import
extract_audio_cover`, which pointed a dependency from the service layer back
up into the API layer - the one layering inversion in the codebase. API
modules import from here instead, which is the correct direction.
"""

import logging
import shutil
from pathlib import Path

from .subprocess_runner import run_subprocess_thread

logger = logging.getLogger(__name__)


async def extract_audio_cover(audio_path: Path, relative_base: Path) -> str | None:
    """Extract embedded cover art from audio file (ID3, FLAC, etc.) using FFmpeg.

    Checks for existing {stem}.jpg first (cached). If missing, tries FFmpeg:
    `ffmpeg -y -i audio.mp3 -an -vcodec copy -frames:v 1 -update 1 cover.jpg`
    Returns relative cover path if successful, else None. Never raises.
    """
    # 1) Check existing sidecar image
    for ext in (".jpg", ".jpeg", ".png", ".webp"):
        cand = audio_path.with_suffix(ext)
        if cand.exists():
            try:
                return cand.relative_to(relative_base).as_posix()
            except ValueError:
                continue
        cand2 = audio_path.with_name(audio_path.stem + ext)
        if cand2.exists():
            try:
                return cand2.relative_to(relative_base).as_posix()
            except ValueError:
                continue

    # 2) Try FFmpeg extract — skip if no attached picture stream

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return None

    # Quick probe: does file have a video stream (cover)?
    try:
        probe = await run_subprocess_thread(
            [ffmpeg, "-hide_banner", "-i", str(audio_path)],
            capture_output=True, text=True, timeout=5,
        )
        # FFmpeg prints stream info to stderr; cover shows as `Video: png` or `Video: mjpeg (attached pic)`
        stderr = (probe.stderr or "") + (probe.stdout or "")
        if "attached pic" not in stderr.lower() and "video:" not in stderr.lower():
            # Also need to check for Video stream specifically, not just video codec
            if "Stream #0:0: Video" not in stderr and "Stream #0:1: Video" not in stderr:
                return None
    except Exception:
        return None

    cover_path = audio_path.with_suffix(".jpg")
    # Avoid overwriting if we just checked and it didn't exist, now create
    try:
        # -frames:v 1 and -update 1 ensures single image, not sequence
        result = await run_subprocess_thread(
            [ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
             "-i", str(audio_path), "-an", "-vcodec", "copy", "-frames:v", "1", "-update", "1", str(cover_path)],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0 and cover_path.exists() and cover_path.stat().st_size > 1024:
            try:
                return cover_path.relative_to(relative_base).as_posix()
            except ValueError:
                return None
        # Cleanup tiny failed file
        if cover_path.exists() and cover_path.stat().st_size < 1024:
            try:
                cover_path.unlink()
            except Exception:
                pass
    except Exception:
        pass
    return None
