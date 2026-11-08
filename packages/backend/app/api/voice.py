"""Voice synthesis API -- local F5-TTS zero-shot cloning.

Mirrors the lip-sync contract (docs/guides/LIPSYNC_API.md): submit returns a
job id, poll ``GET /api/jobs/{job_id}``, download the WAV from
``GET /api/audio/file/<name>`` (it also appears in the media library).

Remote callers (e.g. Maya over the tailnet) reach this at
``http://100.95.60.73:8004`` — JSON in, JSON out, no file upload needed
because the voice reference lives on the rig under ``voices/``.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/voice", tags=["Voice"])


class SynthesizeRequest(BaseModel):
    """Request model for voice synthesis.

    Exactly one voice source is required: ``voice_id`` (a profile under
    ``voices/`` with a reference clip + transcript) OR the explicit pair
    ``ref_audio_path`` + ``ref_text``. ``ref_text`` is mandatory in both
    cases -- the F5-TTS ASR fallback is disabled in this environment.
    """

    text: str = Field(..., min_length=1, description="Text to synthesize")
    voice_id: str | None = Field(
        default=None, description="Voice profile id under voices/ (e.g. 'maya')"
    )
    ref_audio_path: str | None = Field(
        default=None, description="Rig-local reference audio (wav/mp3/flac/m4a/ogg, <12s)"
    )
    ref_text: str | None = Field(
        default=None, description="Transcript of the reference audio (required)"
    )
    output_path: str | None = None


class SynthesizeResponse(BaseModel):
    """Response model -- returns the queued job for polling."""

    success: bool
    job_id: str | None = None
    output_path: str | None = None
    voice_id: str | None = None
    chunks: int | None = None
    error: str | None = None
    message: str | None = None


async def _enqueue_synthesis(request: SynthesizeRequest) -> SynthesizeResponse:
    """Shared submit path for POST /synthesize.

    Preflights the local F5-TTS install, resolves the voice source, and
    enqueues a VOICE_SYNTHESIS job. Poll via GET /api/jobs/{job_id}.
    """
    try:
        from ..models.job import JobCreateRequest, JobType
        from ..queue.manager import queue_manager
        from ..services.voice.f5tts_adapter import F5TTSAdapter
        from ..services.voice.text_chunking import (
            DEFAULT_MAX_CHUNK_CHARS,
            DEFAULT_MAX_TOTAL_CHARS,
            chunk_text,
        )

        adapter = F5TTSAdapter()

        # Validate the voice source early so callers get a 400/404 now, not a
        # failed job later. Full resolution repeats inside the handler.
        try:
            ref_audio, _ref_transcript = adapter.resolve_voice(
                request.voice_id,
                ref_audio_path=request.ref_audio_path,
                ref_text=request.ref_text,
            )
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        chunks = chunk_text(
            request.text,
            max_chunk_chars=adapter.config.max_chunk_chars or DEFAULT_MAX_CHUNK_CHARS,
            max_total_chars=adapter.config.max_total_chars or DEFAULT_MAX_TOTAL_CHARS,
        )

        # Preflight the local install before queueing (fail-open with guidance)
        status = adapter.check_installation()
        if not status["installed"]:
            raise RuntimeError(
                "F5-TTS is not ready on this machine: "
                + status["message"]
                + " -- see config/voice.json"
            )

        params = {
            "text": request.text,
            "voice_id": request.voice_id,
            "ref_audio_path": request.ref_audio_path,
            "ref_text": request.ref_text,
            "output_path": request.output_path,
        }
        jcr = JobCreateRequest(job_type=JobType.VOICE_SYNTHESIS, params=params, max_retries=1)
        job = await queue_manager.enqueue(jcr)

        # Mirror the handler's output-path resolution
        # (services/voice_handler.py) so this field names a real file.
        if request.output_path:
            resolved_output = request.output_path
        else:
            from ..core.config import PROJECT_ROOT as _PR

            out_dir = _PR / "output" / "audio"
            voice_tag = (request.voice_id or "custom").replace(" ", "_")
            resolved_output = str(out_dir / f"voice_{voice_tag}_{job.id[:8]}.wav")

        return SynthesizeResponse(
            success=True,
            job_id=job.id,
            output_path=resolved_output,
            voice_id=request.voice_id,
            chunks=len(chunks),
            message=f"Queued voice synthesis as job {job.id[:8]} ({len(chunks)} chunk(s))",
        )
    except HTTPException:
        raise
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        # Not-configured and VRAM-shortfall both surface here as 503
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Voice synthesis endpoint error")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/synthesize", response_model=SynthesizeResponse)
async def synthesize_voice(request: SynthesizeRequest) -> SynthesizeResponse:
    """Enqueue a local F5-TTS voice-synthesis job (zero-shot cloning)."""
    return await _enqueue_synthesis(request)


@router.get("/voices")
async def list_voices() -> dict[str, Any]:
    """List registered voice profiles under voices/."""
    from ..services.voice.f5tts_adapter import F5TTSAdapter

    adapter = F5TTSAdapter()
    voices = adapter.list_voices()
    return {"voices": voices, "count": len(voices)}


@router.get("/status")
async def voice_status() -> dict[str, Any]:
    """F5-TTS install status -- same shape as the lipsync preflight."""
    from ..services.voice.f5tts_adapter import F5TTSAdapter

    return F5TTSAdapter().check_installation()
