"""
Audio Transcription Service using faster-whisper.

Provides word-level timestamped transcription for lyric synchronization.
Runs locally on CUDA GPU - no cloud dependencies.

This module is the single implementation shared by the API layer
(`app/api/transcription.py`, which owns the HTTP routes).

Usage:
    # Single file transcription
    POST /api/audio/transcribe
    { "filename": "track.mp3", "language": "en" }

    # Get stored transcription
    GET /api/audio/transcript/{filename}

    # Get LRC format
    GET /api/audio/transcript/lrc/{filename}
"""

import logging
import os
import re
from pathlib import Path
from typing import Optional

from ..core.config import PROJECT_ROOT

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Directory for storing transcriptions (project root level, CWD-independent)
TRANSCRIPT_DIR = PROJECT_ROOT / "transcriptions"
TRANSCRIPT_DIR.mkdir(parents=True, exist_ok=True)

# Model size: "tiny", "base", "small", "medium", "large-v3"
# "large-v3" is most accurate but needs ~6GB VRAM
# "medium" is good balance (~3GB VRAM)
# "small" works on most GPUs (~2GB VRAM)
DEFAULT_MODEL_SIZE = os.getenv("WHISPER_MODEL_SIZE", "medium")

# ---------------------------------------------------------------------------
# Lazy-initialized model (loads on first use to avoid startup delay)
# ---------------------------------------------------------------------------

_model = None
_model_size: Optional[str] = None


def get_model(model_size: str = DEFAULT_MODEL_SIZE):
    """Lazy-load the Whisper model."""
    global _model, _model_size
    if _model is None or _model_size != model_size:
        try:
            from faster_whisper import WhisperModel
        except ImportError:
            raise RuntimeError(
                "faster-whisper not installed. Run: pip install faster-whisper"
            )

        # Use GPU if available, fall back to CPU with int8
        device = "cuda"
        compute_type = "float16"
        try:
            import torch
            if not torch.cuda.is_available():
                device = "cpu"
                compute_type = "int8"
        except ImportError:
            device = "cpu"
            compute_type = "int8"

        logger.info(f"Loading Whisper model '{model_size}' on {device} ({compute_type})")
        _model = WhisperModel(model_size, device=device, compute_type=compute_type)
        _model_size = model_size
    return _model


# ---------------------------------------------------------------------------
# Transcription logic
# ---------------------------------------------------------------------------

def transcribe_audio(
    audio_path: str,
    language: Optional[str] = None,
    model_size: str = DEFAULT_MODEL_SIZE,
) -> dict:
    """
    Transcribe audio file with word-level timestamps.

    Returns dict with:
        - language: detected language
        - duration: audio duration in seconds
        - segments: list of {text, start, end, words: [{word, start, end, probability}]}
    """
    model = get_model(model_size)

    segments_gen, info = model.transcribe(
        audio_path,
        language=language,
        vad_filter=True,  # Voice Activity Detection - skips silence
        beam_size=5,
    )

    result = {
        "language": info.language,
        "language_probability": info.language_probability,
        "duration": info.duration,
        "segments": [],
    }

    for segment in segments_gen:
        seg_data = {
            "text": segment.text.strip(),
            "start": round(segment.start, 3),
            "end": round(segment.end, 3),
            "words": [],
        }
        if segment.words:
            for word in segment.words:
                seg_data["words"].append({
                    "word": word.word.strip(),
                    "start": round(word.start, 3),
                    "end": round(word.end, 3),
                    "probability": round(word.probability, 3),
                })
        result["segments"].append(seg_data)

    return result


def result_to_lrc(result: dict) -> str:
    """Convert transcription result to LRC (lyric) format.

    LRC format:
        [mm:ss.xx] lyric text
        [mm:ss.xx] next line

    Word-level highlighting (optional):
        [mm:ss.xx]<mm:ss.xx> word <mm:ss.xx> word ...
    """
    lines = []
    lines.append(f"[ti:{result.get('filename', '')}]")
    lines.append(f"[lang:{result.get('language', 'unknown')}]")
    lines.append("")

    for seg in result["segments"]:
        # Convert seconds to mm:ss.xx
        mins = int(seg["start"] // 60)
        secs = seg["start"] % 60
        timestamp = f"[{mins:02d}:{secs:05.2f}]"
        lines.append(f"{timestamp} {seg['text']}")

    return "\n".join(lines)


def result_to_word_level_lrc(result: dict) -> str:
    """Convert to LRC with word-level timestamps for karaoke-style display.

    Format:
        [mm:ss.xx] line text
        [mm:ss.xx]<mm:ss.xx> word1 <mm:ss.xx> word2 ...
    """
    lines = []
    lines.append(f"[ti:{result.get('filename', '')}]")
    lines.append("")

    for seg in result["segments"]:
        if not seg["words"]:
            mins = int(seg["start"] // 60)
            secs = seg["start"] % 60
            lines.append(f"[{mins:02d}:{secs:05.2f}] {seg['text']}")
            continue

        # Line-level timestamp
        line_start = seg["words"][0]["start"]
        mins = int(line_start // 60)
        secs = line_start % 60
        line_ts = f"[{mins:02d}:{secs:05.2f}]"

        # Word-level timestamps for highlighting
        word_parts = []
        for w in seg["words"]:
            w_mins = int(w["start"] // 60)
            w_secs = w["start"] % 60
            word_parts.append(f"<{w_mins:02d}:{w_secs:05.2f}>{w['word']}")

        lines.append(f"{line_ts} {' '.join(word_parts)}")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# File paths
# ---------------------------------------------------------------------------

def get_audio_path(filename: str) -> Optional[Path]:
    """Resolve audio file path from filename.

    Searches the known audio locations first, then falls back to treating
    the filename as an absolute/relative path (used when the frontend passes
    a stored_path from the Media Library).
    """
    search_paths = [
        PROJECT_ROOT / "output" / "audio" / filename,
        PROJECT_ROOT / "uploads" / "audio" / filename,
        PROJECT_ROOT / "audio" / filename,
        Path(filename),
    ]
    for p in search_paths:
        if p.exists() and p.is_file():
            return p
    return None


def get_transcript_path(filename: str) -> Path:
    """Get path for stored transcription JSON (sanitized, no traversal)."""
    safe_name = re.sub(r"[^\w\-.]", "_", filename)
    return TRANSCRIPT_DIR / f"{safe_name}.json"
