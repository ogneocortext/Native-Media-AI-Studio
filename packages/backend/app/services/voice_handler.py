"""Queue handler for VOICE_SYNTHESIS jobs (F5-TTS, zero-shot cloning).

Synthesizes speech in a cloned voice via the local F5-TTS adapter. Long
work goes through the queue, never ad-hoc threads. The output WAV lands in
``output/audio/`` so it is served by ``GET /api/audio/file/...`` and shows
up in the media library automatically -- and it can feed straight into
``POST /api/video/lipsync`` as the audio input (MuseTalk syncs best to
isolated vocal audio, which is exactly what this produces).
"""

import asyncio
import logging
from typing import Any

from ..core.logging_config import structured_logger
from ..queue.manager import queue_manager

logger = logging.getLogger(__name__)

#: Tracked fire-and-forget background tasks so progress / completion updates
#: are not silently garbage-collected (same pattern as lipsync_handler).
_background_tasks: set[asyncio.Task] = set()


def _spawn(coro) -> asyncio.Task:
    task = asyncio.create_task(coro)
    _background_tasks.add(task)

    def _on_done(t: asyncio.Task) -> None:
        _background_tasks.discard(t)
        if t.cancelled():
            return
        exc = t.exception()
        if exc is not None:
            logger.error(
                "voice.background_task_failed",
                error=str(exc),
                error_type=type(exc).__name__,
            )

    task.add_done_callback(_on_done)
    return task


class VoiceSynthesisHandler:
    """Processes voice-synthesis jobs via the local F5-TTS adapter."""

    async def process_job(self, job: Any) -> dict[str, Any]:
        """Process a voice-synthesis job."""
        try:
            return await self._process_job_inner(job)
        except Exception as e:
            structured_logger.error(
                "voice.job_failed",
                job_id=getattr(job, "id", "?"),
                error=str(e),
                error_type=type(e).__name__,
            )
            raise

    async def _process_job_inner(self, job: Any) -> dict[str, Any]:
        """Inner implementation of voice-synthesis job processing."""
        from .voice.f5tts_adapter import F5TTSAdapter, VoiceNotConfiguredError

        params = job.params or {}
        text = params.get("text")
        voice_id = params.get("voice_id")
        ref_audio_path = params.get("ref_audio_path")
        ref_text = params.get("ref_text")

        if not text or not str(text).strip():
            raise ValueError("text is required")

        structured_logger.info(
            "voice.job_started",
            job_id=job.id,
            voice_id=voice_id,
            text_len=len(str(text)),
            has_ref_audio=bool(ref_audio_path),
        )

        adapter = F5TTSAdapter()
        try:
            status = adapter.check_installation()
        except Exception:
            status = {"installed": False, "message": "check failed"}
        if not status["installed"]:
            raise VoiceNotConfiguredError(
                "F5-TTS is not ready on this machine: "
                + status.get("message", "unknown")
                + " -- see config/voice.json"
            )

        output_path = params.get("output_path")
        if not output_path:
            from ..core.config import PROJECT_ROOT as _PR

            out_dir = _PR / "output" / "audio"
            out_dir.mkdir(parents=True, exist_ok=True)
            voice_tag = (voice_id or "custom").replace(" ", "_")
            output_path = str(out_dir / f"voice_{voice_tag}_{job.id[:8]}.wav")

        # Persist the resolved output path on the job so pollJob can read it.
        _spawn(queue_manager.update_job(job.id, output_path=output_path))

        def _progress(frac: float, message: str) -> None:
            logger.info("voice %s: %.0f%% %s", job.id[:8], frac * 100, message)
            try:
                _spawn(queue_manager.update_job(job.id, progress=frac, message=message))
            except RuntimeError:
                logger.debug("voice progress update skipped (no event loop) for %s", job.id[:8])

        # Budget = configured inference timeout + 5 min headroom for model
        # load, chunking, and WAV write. Synthesis is ~realtime on the 1070 Ti
        # but cold model load alone is ~20 s.
        handler_timeout_s = adapter.config.inference_timeout_s + 300
        cancel_watcher = _spawn(self._watch_job_cancel(job.id, adapter))
        try:
            async with asyncio.timeout(handler_timeout_s):
                result = await adapter.synthesize(
                    str(text),
                    output_path,
                    voice_id=voice_id,
                    ref_audio_path=ref_audio_path,
                    ref_text=ref_text,
                    progress_cb=_progress,
                )
        except TimeoutError as exc:
            structured_logger.error(
                "voice.job_timeout",
                job_id=job.id,
                voice_id=voice_id,
            )
            raise TimeoutError(
                f"F5-TTS synthesis timed out after {handler_timeout_s} s"
            ) from exc
        finally:
            cancel_watcher.cancel()
        result["job_id"] = job.id

        structured_logger.info(
            "voice.job_completed",
            job_id=job.id,
            output_path=output_path,
            voice_id=voice_id,
            backend=result.get("backend"),
            chunks=result.get("chunks"),
        )
        return result

    async def _watch_job_cancel(self, job_id: str, adapter: Any) -> None:
        """Poll queue cancellation and forward it to the adapter."""
        try:
            while True:
                await asyncio.sleep(2)
                if await queue_manager.is_cancelled(job_id):
                    logger.info("voice %s: cancellation requested, stopping adapter", job_id[:8])
                    adapter.cancel()
                    return
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.debug("voice cancel watcher stopped for %s", job_id[:8], exc_info=True)


# Handler instance (mirrors lipsync_handler convention)
voice_synthesis_handler = VoiceSynthesisHandler()
