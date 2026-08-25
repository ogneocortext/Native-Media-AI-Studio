"""
Job processor - handles actual job execution with serial processing.
"""

import asyncio
import logging
from collections.abc import Callable
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
        """Main processing loop - runs jobs serially"""
        while self._running:
            try:
                # Find next queued job
                queued_jobs = await queue_manager.get_jobs_by_status(JobStatus.QUEUED)
                if queued_jobs:
                    job = queued_jobs[0]  # Get oldest queued job
                    await self._process_job(job)
                else:
                    await asyncio.sleep(1)  # Wait for new jobs
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Error in process loop: %s", e)
                await asyncio.sleep(1)

    async def _broadcast_progress(self, job: Job):
        """Broadcast job progress to SSE clients"""
        try:
            await sse_manager.broadcast(
                "job.progress", {"job": job.model_dump(mode="json")}
            )
        except Exception as e:
            logger.error("Error broadcasting progress: %s", e)

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

            # Run the handler
            if asyncio.iscoroutinefunction(handler):
                result = await handler(job)
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
            if job.retry_count < job.max_retries:
                await queue_manager.update_job(
                    job.id,
                    status=JobStatus.QUEUED,
                    progress=0.0,
                    error=error_msg,
                    message=f"Retry {job.retry_count + 1}/{job.max_retries}",
                    # Increment retry_count so failing jobs eventually stop retrying
                    retry_count=job.retry_count + 1,
                )
            else:
                await queue_manager.update_job(
                    job.id,
                    status=JobStatus.FAILED,
                    error=error_msg,
                    message="Job failed after max retries",
                )

        finally:
            self._current_job = None

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
