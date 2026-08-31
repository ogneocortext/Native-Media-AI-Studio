"""
Audio Transcription API routes.

Thin HTTP layer over `app.services.transcription` (the single shared
implementation). Provides endpoints for transcribing audio files with
word-level timestamps using faster-whisper running locally on CUDA.
"""

import json
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services.transcription import (
    DEFAULT_MODEL_SIZE,
    get_audio_path,
    get_transcript_path,
    result_to_lrc,
    result_to_word_level_lrc,
    transcribe_audio,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/audio", tags=["Transcription"])


class TranscriptionRequest(BaseModel):
    filename: str
    language: Optional[str] = None  # Auto-detect if None
    model_size: Optional[str] = DEFAULT_MODEL_SIZE


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------

@router.post("/transcribe")
async def transcribe_track(request: TranscriptionRequest):
    """
    Transcribe an audio file with word-level timestamps.

    Returns segments with text, start/end times, and per-word timing.
    The result is stored as JSON for later retrieval.
    """
    # Find the audio file
    audio_path = get_audio_path(request.filename)
    if not audio_path:
        raise HTTPException(404, f"Audio file not found: {request.filename}")

    try:
        result = transcribe_audio(
            str(audio_path),
            language=request.language,
            model_size=request.model_size or DEFAULT_MODEL_SIZE,
        )
        result["filename"] = request.filename

        # Store for later retrieval
        transcript_path = get_transcript_path(request.filename)
        transcript_path.write_text(json.dumps(result, indent=2))

        return result
    except Exception as e:
        logger.error(f"Transcription failed: {e}")
        raise HTTPException(500, f"Transcription failed: {str(e)}")


# NOTE: More specific routes must come BEFORE the generic {filename:path} route
# because FastAPI matches routes in registration order and {filename:path} is greedy

@router.get("/transcript/lyrics/{filename:path}")
async def get_lyrics_for_sync(filename: str):
    """Get lyrics formatted for frontend sync display."""
    transcript_path = get_transcript_path(filename)
    if not transcript_path.exists():
        raise HTTPException(404, "No transcription found. POST /transcribe first.")

    result = json.loads(transcript_path.read_text())

    lines = []
    for seg in result["segments"]:
        lines.append({
            "start": seg["start"],
            "end": seg["end"],
            "text": seg["text"],
            "words": seg.get("words", []),
        })

    return {
        "filename": filename,
        "language": result["language"],
        "duration": result["duration"],
        "lines": lines,
    }


@router.get("/transcript/lrc/{filename:path}")
async def get_lrc_format(filename: str):
    """Get transcription in standard LRC format."""
    transcript_path = get_transcript_path(filename)
    if not transcript_path.exists():
        raise HTTPException(404, "No transcription found. POST /transcribe first.")

    result = json.loads(transcript_path.read_text())
    lrc = result_to_lrc(result)
    return {"lrc": lrc, "format": "lrc"}


@router.get("/transcript/lrc-word/{filename:path}")
async def get_word_level_lrc(filename: str):
    """Get transcription in word-level LRC format for karaoke display."""
    transcript_path = get_transcript_path(filename)
    if not transcript_path.exists():
        raise HTTPException(404, "No transcription found. POST /transcribe first.")

    result = json.loads(transcript_path.read_text())
    lrc = result_to_word_level_lrc(result)
    return {"lrc": lrc, "format": "lrc-word"}


@router.get("/transcript/{filename:path}")
async def get_transcription(filename: str):
    """Get stored transcription result."""
    transcript_path = get_transcript_path(filename)
    if not transcript_path.exists():
        raise HTTPException(404, "No transcription found. POST /transcribe first.")
    return json.loads(transcript_path.read_text())