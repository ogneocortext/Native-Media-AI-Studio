"""Extract a track's audio from a video file so it can join the audio library.

Why this exists
---------------
Suno v6-mini drafts arrive as `.mp4` and get copied into `output/audio/`, but
`ALLOWED_EXTENSIONS` in `api/audio.py` lists audio formats only. The library
listing and `analyze-all` both filter on that set, so a dropped `.mp4` is
invisible: it is not listed, not analyzed, and not playable as a track. The
workaround was converting by hand outside the app.

This module does the conversion server-side, so dropping a video into the app
produces a real `.m4a` track. It lives in `services/` rather than in the route so
the ffmpeg invocation is testable without HTTP (D14: pure logic in services,
routes stay thin).

Copy-first is deliberate. When the source audio is already AAC — which Suno
output always is — `-c:a copy` remuxes without touching a single sample, so the
m4a is bit-identical to the source track and costs no CPU. Re-encoding is a
fallback for containers whose audio the MP4 muxer cannot carry (e.g. some
`.webm`/Opus or `.mov`/PCM sources).
"""

from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

#: Video containers accepted for import. Anything here is converted to .m4a.
VIDEO_EXTENSIONS = frozenset(
    {".mp4", ".m4v", ".mov", ".webm", ".mkv", ".avi", ".mpeg", ".mpg", ".wmv", ".flv"}
)

#: Audio formats the library already understands. Passed through untouched.
AUDIO_EXTENSIONS = frozenset(
    {".mp3", ".wav", ".flac", ".ogg", ".opus", ".m4a", ".wma", ".aac"}
)

DEFAULT_AAC_BITRATE = "192k"


def is_video_name(name: str) -> bool:
    return Path(name).suffix.lower() in VIDEO_EXTENSIONS


def is_audio_name(name: str) -> bool:
    return Path(name).suffix.lower() in AUDIO_EXTENSIONS


def ffmpeg_path() -> str | None:
    """Locate ffmpeg on PATH, or None when it is unavailable."""
    return shutil.which("ffmpeg")


def target_stem(name: str) -> str:
    """`Song Final.mp4` -> `Song Final` (the m4a keeps the original name)."""
    return Path(name).stem


@dataclass(frozen=True)
class ExtractionResult:
    ok: bool
    #: True when the audio was remuxed with `-c:a copy` (lossless, no re-encode).
    lossless: bool
    detail: str


def extract_audio(
    src: Path,
    dest: Path,
    ffmpeg: str | None = None,
    bitrate: str = DEFAULT_AAC_BITRATE,
) -> ExtractionResult:
    """Write `src`'s audio track to `dest` as .m4a.

    Tries a stream copy first and falls back to an AAC transcode. Never leaves a
    partial file behind: a failed attempt is removed before returning.
    """
    binary = ffmpeg or ffmpeg_path()
    if not binary:
        return ExtractionResult(
            ok=False,
            lossless=False,
            detail="ffmpeg is not on PATH; cannot extract audio from video",
        )

    attempts = (
        # Remux only: no decode, no re-encode. Correct for AAC sources.
        ["-vn", "-c:a", "copy", "-movflags", "+faststart"],
        # Fallback: transcode for audio the MP4 muxer cannot carry (Opus, PCM).
        ["-vn", "-c:a", "aac", "-b:a", bitrate, "-movflags", "+faststart"],
    )

    last_error = ""
    for index, codec_args in enumerate(attempts):
        cmd = [
            binary, "-y", "-hide_banner", "-loglevel", "error",
            "-i", str(src), *codec_args, str(dest),
        ]
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                timeout=900,
                encoding="utf-8",
                errors="replace",
            )
        except subprocess.TimeoutExpired:
            dest.unlink(missing_ok=True)
            return ExtractionResult(ok=False, lossless=False, detail="ffmpeg timed out")

        if proc.returncode == 0 and dest.exists() and dest.stat().st_size > 0:
            lossless = index == 0
            return ExtractionResult(
                ok=True,
                lossless=lossless,
                detail="stream copy (no re-encode)" if lossless else f"re-encoded to AAC {bitrate}",
            )

        last_error = (proc.stderr or "").strip().splitlines()[-1:] or ["unknown ffmpeg error"]
        last_error = last_error[0]
        dest.unlink(missing_ok=True)  # never leave a truncated m4a behind

    return ExtractionResult(ok=False, lossless=False, detail=last_error)
