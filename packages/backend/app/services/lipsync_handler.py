"""Queue handler for LIPSYNC jobs (D8, D42).

Lip-syncs a video clip (or still portrait) to an audio track using the local
MuseTalk adapter. Long-running work goes through the queue, never ad-hoc
threads. For songs, pass the isolated vocals stem as audio_path -- the full
mix syncs markedly worse (research notes, D42).
"""

import asyncio
import logging
from pathlib import Path
from typing import Any

from ..core.logging_config import structured_logger
from ..queue.manager import queue_manager

logger = logging.getLogger(__name__)

#: Tracked fire-and-forget background tasks so progress / completion updates
#: are not silently garbage-collected (asyncio holds only a weak reference to
#: unowned tasks -- see Python 3.12+ docs on asyncio.create_task).
_background_tasks: set[asyncio.Task] = set()


def _spawn(coro) -> asyncio.Task:
    """Schedule a fire-and-forget coroutine and keep it alive until done.

    The returned task is held in a strong-reference set and removed via a
    done callback. Any exception is logged instead of vanishing silently.
    """
    task = asyncio.create_task(coro)
    _background_tasks.add(task)

    def _on_done(t: asyncio.Task) -> None:
        _background_tasks.discard(t)
        if t.cancelled():
            return
        exc = t.exception()
        if exc is not None:
            logger.error(
                "lipsync.background_task_failed",
                error=str(exc),
                error_type=type(exc).__name__,
            )

    task.add_done_callback(_on_done)
    return task


class LipSyncHandler:
    """Processes lip-sync jobs via the local MuseTalk adapter."""

    async def process_job(self, job: Any) -> dict[str, Any]:
        """Process a lip-sync job."""
        try:
            return await self._process_job_inner(job)
        except Exception as e:
            structured_logger.error(
                "lipsync.job_failed",
                job_id=getattr(job, "id", "?"),
                error=str(e),
                error_type=type(e).__name__,
            )
            raise

    async def _process_job_inner(self, job: Any) -> dict[str, Any]:
        """Inner implementation of lip-sync job processing."""
        from .lipsync import LipSyncNotConfiguredError, MuseTalkAdapter

        params = job.params or {}
        video_path = params.get("video_path")
        image_path = params.get("image_path")
        audio_path = params.get("audio_path")
        section = params.get("section", "chorus")

        source = video_path or image_path
        if not source:
            structured_logger.error(
                "lipsync.validation_failed",
                job_id=getattr(job, "id", "?"),
                error="missing_video_or_image_path",
            )
            raise ValueError("video_path or image_path is required")
        if not audio_path:
            structured_logger.error(
                "lipsync.validation_failed",
                job_id=getattr(job, "id", "?"),
                error="missing_audio_path",
            )
            raise ValueError("audio_path is required (isolated vocals recommended)")
        if not Path(source).is_file():
            structured_logger.error(
                "lipsync.validation_failed",
                job_id=getattr(job, "id", "?"),
                error="source_not_found",
                source=str(source),
            )
            raise FileNotFoundError(f"Source not found: {source}")
        if not Path(audio_path).is_file():
            structured_logger.error(
                "lipsync.validation_failed",
                job_id=getattr(job, "id", "?"),
                error="audio_not_found",
                audio_path=str(audio_path),
            )
            raise FileNotFoundError(f"Audio not found: {audio_path}")

        structured_logger.info(
            "lipsync.job_started",
            job_id=job.id,
            source=source,
            audio_path=audio_path,
            section=section,
        )

        adapter = MuseTalkAdapter()
        try:
            status = adapter.check_installation()
        except Exception:
            status = {"installed": False, "message": "check failed"}
        if not status["installed"]:
            structured_logger.error(
                "lipsync.adapter_not_ready",
                job_id=job.id,
                message=status.get("message", "unknown"),
            )
            raise LipSyncNotConfiguredError(
                "MuseTalk is not ready on this machine: "
                + status.get("message", "unknown")
                + " -- see config/lipsync.json"
            )

        structured_logger.info(
            "lipsync.adapter_ready",
            job_id=job.id,
            weights_found=status.get("weights_found", False),
            ffmpeg_found=status.get("ffmpeg_found", False),
            use_float16=status.get("use_float16", False),
        )

        output_path = params.get("output_path")
        if not output_path:
            from ..core.config import PROJECT_ROOT as _PR

            out_dir = _PR / "output" / "video"
            out_dir.mkdir(parents=True, exist_ok=True)
            stem = Path(source).stem.replace(" ", "_")
            output_path = str(out_dir / f"{stem}_lipsync_{job.id[:8]}.mp4")

        # Persist the resolved output path on the job so the frontend's
        # pollJob can read it from job.output_path (not just result.output_path).
        _spawn(queue_manager.update_job(job.id, output_path=output_path))

        def _progress(frac: float, message: str) -> None:
            # Report real-time progress to the queue (broadcasts job.progress via SSE).
            logger.info("lipsync %s: %.0f%% %s", job.id[:8], frac * 100, message)
            try:
                _spawn(queue_manager.update_job(job.id, progress=frac, message=message))
            except RuntimeError:
                # No running event loop (e.g. callback invoked from a thread) --
                # best-effort: log only.
                logger.debug("lipsync progress update skipped (no event loop) for %s", job.id[:8])

        # Bound the adapter call so a hung MuseTalk process cannot block the
        # job indefinitely. 10 minutes is generous for a lipsync render.
        try:
            async with asyncio.timeout(600):
                result = await adapter.lipsync(
                    video_path=source,
                    audio_path=audio_path,
                    output_path=output_path,
                    progress_cb=_progress,
                )
        except TimeoutError as exc:
            structured_logger.error(
                "lipsync.job_timeout",
                job_id=job.id,
                source=source,
                audio_path=audio_path,
            )
            raise TimeoutError("MuseTalk lipsync timed out after 600 s") from exc
        result["section"] = section
        result["job_id"] = job.id

        structured_logger.info(
            "lipsync.job_completed",
            job_id=job.id,
            output_path=output_path,
            backend=result.get("backend"),
            duration_sec=result.get("duration_sec"),
            source_fps=result.get("source_fps"),
            target_fps=result.get("target_fps"),
            use_float16=result.get("use_float16"),
        )
        return result


# Handler instance (mirrors music_video_handler convention)
lipsync_handler = LipSyncHandler()
