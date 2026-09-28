"""
Job processor - handles actual job execution with serial processing.
"""

import asyncio
import inspect
import logging
from collections.abc import Callable
from datetime import datetime
from typing import Any

from ..models.job import Job, JobStatus, JobType
from ..queue.manager import queue_manager
from ..services.audio_analysis_handler import AudioAnalysisHandler
from ..services.comfyui_workflow_handler import ComfyUIWorkflowHandler
from ..services.image_generator import ImageGenerationHandler
from ..services.music_video_handler import MusicVideoHandler, MusicVideoPreviewHandler
from ..services.storyboard_generator import StoryboardGeneratorHandler
from ..sse.handler import sse_manager

logger = logging.getLogger(__name__)

# Maximum wall-clock seconds a single handler may run before the processor
# aborts it. Keeps the serial queue from stalling on a hung adapter.
HANDLER_TIMEOUT_SECONDS = 3600

# How often (in seconds) to poll for cancellation while a handler runs.
CANCELLATION_HEARTBEAT_INTERVAL = 5.0


class JobProcessor:
    """
    Processes jobs from the queue serially (one at a time) by default.
    Designed for local hardware with limited VRAM.
    """

    def __init__(self):
        self._running = False
        self._current_job: Job | None = None
        self._handlers: dict[JobType, Callable] = {}
        self._task: asyncio.Task | None = None

        # Register default handlers
        self._register_default_handlers()

    def _register_default_handlers(self):
        """Register default job handlers"""
        # Register image generation handler
        self.register_handler(
            JobType.IMAGE_GENERATION, ImageGenerationHandler().process_job
        )

        # Register storyboard generation handler (Ollama)
        self.register_handler(
            JobType.STORYBOARD_GENERATION, StoryboardGeneratorHandler().process_job
        )

        # Register ComfyUI workflow handler
        self.register_handler(
            JobType.COMFYUI_WORKFLOW,
            ComfyUIWorkflowHandler().process_job,
        )

        # Register audio feature extraction handler (librosa beat/waveform extraction)
        self.register_handler(
            JobType.AUDIO_FEATURE_EXTRACTION, AudioAnalysisHandler().process_job
        )

        # Register music video generation handler
        self.register_handler(
            JobType.MUSIC_VIDEO, MusicVideoHandler().process_job
        )

        # Register music video preview handler (short draft)
        self.register_handler(
            JobType.MUSIC_VIDEO_PREVIEW, MusicVideoPreviewHandler().process_job
        )

    def register_handler(self, job_type: JobType, handler: Callable[[Job], Any]):
        """Register a handler for a specific job type"""
        self._handlers[job_type] = handler

    async def start(self):
        """Start the job processor"""
        self._running = True
        self._task = asyncio.create_task(self._process_loop())

    async def stop(self):
        """Stop the job processor"""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _process_loop(self):
        """Main processing loop - runs jobs serially, event-driven."""
        while self._running:
            try:
                # Find next queued job (priority DESC, created_at ASC)
                queued_jobs = await queue_manager.get_jobs_by_status(JobStatus.QUEUED)
                if queued_jobs:
                    job = queued_jobs[0]
                    await self._process_job(job)
                else:
                    # Short wait for new jobs, then re-check to keep latency low
                    await queue_manager.wait_for_jobs(timeout=1.0)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Error in process loop: %s", e)
                await asyncio.sleep(1)

    async def _backoff_sleep(self, retry_count: int, base_seconds: float = 2.0, max_seconds: float = 60.0) -> None:
        """Exponential backoff with jitter for retries."""
        delay = min(base_seconds * (2 ** retry_count), max_seconds)
        jitter = delay * 0.1  # 10% jitter
        await asyncio.sleep(delay + (jitter * (0.5 - hash(str(retry_count)) % 100 / 100.0)))

    async def _broadcast_progress(self, job: Job):
        """Broadcast job progress to SSE clients"""
        try:
            await sse_manager.broadcast(
                "job.progress", {"job": job.model_dump(mode="json")}
            )
        except Exception as e:
            logger.error("Error broadcasting progress: %s", e)

    async def _check_cancelled(self, job: Job) -> bool:
        """Return True if the current job has been cancelled mid-run."""
        current = await queue_manager.get_job(job.id)
        if current is None or current.status == JobStatus.CANCELLED:
            logger.warning("Job %s was cancelled during processing", job.id)
            try:
                await queue_manager.update_job(
                    job.id,
                    status=JobStatus.CANCELLED,
                    message="Job cancelled",
                    completed_at=datetime.now(),
                )
            except Exception:
                pass
            return True
        return False

    async def _process_job(self, job: Job):
        """Process a single job"""
        self._current_job = job

        try:
            # Update status to running
            await queue_manager.update_job(
                job.id,
                status=JobStatus.RUNNING,
                progress=0.0,
                message="Starting job...",
            )
            await self._broadcast_progress(job)

            # Get handler for job type
            handler = self._handlers.get(job.job_type)
            if not handler:
                raise ValueError(f"No handler registered for job type: {job.job_type}")

            # Run the handler with a hard timeout so a hung adapter cannot
            # stall the serial queue forever.
            if inspect.iscoroutinefunction(handler):
                handler_task = asyncio.create_task(handler(job))
                watcher_task = asyncio.create_task(self._cancellation_watcher(job))
                try:
                    result = await asyncio.wait_for(
                        asyncio.shield(handler_task),
                        timeout=HANDLER_TIMEOUT_SECONDS,
                    )
                except asyncio.TimeoutError:
                    handler_task.cancel()
                    try:
                        await handler_task
                    except asyncio.CancelledError:
                        pass
                    raise RuntimeError(
                        f"Job {job.id} exceeded handler timeout of {HANDLER_TIMEOUT_SECONDS}s"
                    ) from None
                finally:
                    watcher_task.cancel()
                    try:
                        await watcher_task
                    except asyncio.CancelledError:
                        pass
            else:
                result = handler(job)

            # Update status to completed
            current = await queue_manager.get_job(job.id)
            if current is None or current.status == JobStatus.CANCELLED:
                # Job was deleted or cancelled while running - keep terminal state
                logger.warning("Job %s was cancelled/deleted during processing; not marking complete", job.id)
                return

            await queue_manager.update_job(
                job.id,
                status=JobStatus.COMPLETED,
                progress=1.0,
                message="Job completed",
                result=result if isinstance(result, dict) else {"result": str(result)},
            )

        except Exception as e:
            error_msg = str(e)
            logger.error("Job %s failed: %s", job.id, error_msg)

            # Re-read the job in case it was cancelled while running
            current = await queue_manager.get_job(job.id)
            if current is None or current.status == JobStatus.CANCELLED:
                logger.warning("Job %s was cancelled/deleted during processing; not retrying", job.id)
                return

            # Check if we should retry
            if current is not None and current.retry_count < job.max_retries:
                next_retry = current.retry_count + 1
                await queue_manager.update_job(
                    job.id,
                    status=JobStatus.RETRYING,
                    progress=0.0,
                    error=error_msg,
                    message=f"Retry {next_retry}/{job.max_retries}",
                    retry_count=next_retry,
                )
                logger.info("Job %s scheduled for retry %d/%d with backoff", job.id, next_retry, job.max_retries)
                await self._backoff_sleep(current.retry_count)
                # Re-queue for processing
                await queue_manager.update_job(job.id, status=JobStatus.QUEUED)
                queue_manager._signal_new_job()
            else:
                # Exhausted retries -> dead-letter queue
                logger.warning("Job %s moved to DLQ after %d retries", job.id, current.retry_count if current else job.retry_count)
                await queue_manager._move_to_dead_letter(
                    job.id,
                    error_msg if current is None else (current.error or error_msg),
                )

        finally:
            self._current_job = None

    async def _cancellation_watcher(self, job: Job):
        """Background watcher that polls for cancellation while the handler runs."""
        while True:
            await asyncio.sleep(CANCELLATION_HEARTBEAT_INTERVAL)
            if await self._check_cancelled(job):
                # Cancellation is already persisted by _check_cancelled; raise to
                # interrupt the active handler path.
                raise asyncio.CancelledError()

    async def get_current_job(self) -> Job | None:
        """Get the currently running job"""
        return self._current_job

    async def process_now(self, job: Job) -> bool:
        """Immediately process a job (bypasses queue)"""
        if self._current_job:
            return False  # Already processing

        await queue_manager.update_job(job.id, status=JobStatus.QUEUED)
        await self._process_job(job)
        return True


# Global processor instance
processor = JobProcessor()
