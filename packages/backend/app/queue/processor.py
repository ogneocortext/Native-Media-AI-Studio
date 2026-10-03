"""
Job processor - handles actual job execution with serial processing.
"""

import asyncio
import inspect
import logging
import random
import re
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import aiohttp

from ..core.comfyui_client import WorkflowRejectedError
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

# How long a RUNNING job may sit before it is presumed ownerless, and how often
# the loop checks. A job is RUNNING only while the process that claimed it lives;
# past this age with no progress the claim is presumed gone. Kept well under
# HANDLER_TIMEOUT_SECONDS so a genuinely long render is not reaped underneath a
# live worker.
STALE_JOB_MAX_AGE_SECONDS = 900
STALE_JOB_REAP_INTERVAL_SECONDS = 60

# How often (in seconds) to poll for cancellation while a handler runs.
CANCELLATION_HEARTBEAT_INTERVAL = 5.0

# ---------------------------------------------------------------------------
# Error classification
# ---------------------------------------------------------------------------
#
# The queue used to retry based on `any(sig in message)`, which is too blunt:
# bare digits matched inside durations ("1502ms") and filenames ("clip_502.mp4"),
# a 500 was retryable when its body said "Internal Server Error" but not when it
# said "HTTP 500", and the most common transient failure in this stack â€” ComfyUI
# refusing a busy queue â€” was not retryable at all. Classification is now
# type-first, then status code, then phrase, and it yields a stable category code
# that is stored with the job so the queue UI can explain *why* a job failed.

#: Stable category codes (stored as the ``<category>: <message>`` job error).
TRANSIENT_NETWORK = "transient_network"
UPSTREAM_BUSY = "upstream_busy"
HANDLER_TIMEOUT = "handler_timeout"
WORKFLOW_REJECTED = "workflow_rejected"
DETERMINISTIC = "deterministic"
UNKNOWN = "unknown"

#: Statuses worth retrying. A bare number is **not** enough: it must appear in
#: an HTTP context (a marker before it, or its canonical reason phrase after it),
#: so "render failed after 1502ms", "clip_502.mp4" and "step 503 of 800" cannot
#: be mistaken for a retryable response.
_RETRYABLE_STATUSES = (429, 502, 503, 504)
# Any *recognised* status outside that set (400/401/403/404/405/409/413/415/422/500)
# is treated as deterministic — a code or request problem, not a blip.
_HTTP_CONTEXT_RE = re.compile(
    r"\b(?:https?|status(?:\s+code)?|code|error|err)\W{0,4}(\d{3})\b"
    r"|\b(\d{3})\s+(?:too many requests|bad gateway|service unavailable|gateway timeout"
    r"|internal server error|not found|unauthorized|forbidden|bad request)\b"
)

#: Phrases that mean "the far end is temporarily unable, try again".
_BUSY_PHRASES = (
    "queue is full",
    "queue full",
    "too many queued prompts",
    "server is busy",
    "try again later",
    "temporarily unavailable",
    "service unavailable",
    "rate limit",
    "too many requests",
)

#: Phrases that mean "the far end or the network broke mid-request".
_TRANSIENT_PHRASES = (
    "connection refused",
    "connection reset",
    "connection aborted",
    "connection error",
    "socket hang up",
    "incomplete read",
    "remote end closed connection",
    "network is unreachable",
    "no route to host",
    "timed out",
    "timeout",
)

#: Exception types that are transient regardless of the message.
_TRANSIENT_EXC_TYPES: tuple[type[BaseException], ...] = (
    asyncio.TimeoutError,
    TimeoutError,
    ConnectionError,
    aiohttp.ClientError,
)

#: Exception types that are deterministic: same input, same failure.
_DETERMINISTIC_EXC_TYPES: tuple[type[BaseException], ...] = (
    ValueError,  # also covers json.JSONDecodeError and pydantic ValidationError
    TypeError,
    KeyError,
    IndexError,
    AssertionError,
    NotImplementedError,
    FileNotFoundError,
    PermissionError,
)


class HandlerTimeoutError(RuntimeError):
    """A handler exceeded ``HANDLER_TIMEOUT_SECONDS``.

    Deliberately **not** retryable: the same job, on the same 8GB card, will
    hit the same wall. Retrying burned up to four hours of queue time.
    """


@dataclass(frozen=True)
class ErrorClassification:
    """Outcome of classifying a job failure."""

    category: str
    retryable: bool
    status: int | None = None

    def describe(self, message: str) -> str:
        """Format the message with its category code for storage/logging."""
        return f"{self.category}: {message}"


def _http_status_from_text(normalized: str) -> int | None:
    """Extract an HTTP status from a message, requiring HTTP context.

    Returns ``None`` when the message merely *contains* a three-digit number
    ("after 1502ms", "clip_502.mp4", "step 503 of 800").
    """
    match = _HTTP_CONTEXT_RE.search(normalized)
    if match is None:
        return None
    raw = match.group(1) or match.group(2)
    try:
        return int(raw)
    except (TypeError, ValueError):  # pragma: no cover - regex guarantees digits
        return None


def classify_job_error(exc: BaseException, message: str | None = None) -> ErrorClassification:
    """Classify a job failure as transient or deterministic.

    Order matters: the exception type is the most reliable signal, then the HTTP
    status, then the wording. Anything unrecognised is treated as deterministic
    so a novel bug is not retried three more times.
    """
    text = (message if message is not None else str(exc)).strip()
    normalized = text.lower()

    # 1. Explicit handler timeout: deterministic for this job + hardware.
    if isinstance(exc, HandlerTimeoutError):
        return ErrorClassification(HANDLER_TIMEOUT, retryable=False)

    # 2. ComfyUI refused the graph itself: fixing it needs a code/prompt change.
    if isinstance(exc, WorkflowRejectedError):
        return ErrorClassification(WORKFLOW_REJECTED, retryable=False, status=exc.status)
    if "rejected workflow" in normalized or "invalid_prompt" in normalized:
        return ErrorClassification(WORKFLOW_REJECTED, retryable=False)

    # 3. Type-driven transience.
    if isinstance(exc, _TRANSIENT_EXC_TYPES):
        return ErrorClassification(TRANSIENT_NETWORK, retryable=True)
    if isinstance(exc, _DETERMINISTIC_EXC_TYPES):
        return ErrorClassification(DETERMINISTIC, retryable=False)

    # 4. HTTP status carried inside a plain RuntimeError message.
    status = _http_status_from_text(normalized)
    if status in _RETRYABLE_STATUSES:
        return ErrorClassification(TRANSIENT_NETWORK, retryable=True, status=status)
    if status is not None:
        return ErrorClassification(DETERMINISTIC, retryable=False, status=status)

    # 5. Wording.
    if any(phrase in normalized for phrase in _BUSY_PHRASES):
        return ErrorClassification(UPSTREAM_BUSY, retryable=True)
    if any(phrase in normalized for phrase in _TRANSIENT_PHRASES):
        return ErrorClassification(TRANSIENT_NETWORK, retryable=True)

    return ErrorClassification(UNKNOWN, retryable=False)


def _is_retryable_error(error_msg: str) -> bool:
    """Backwards-compatible text-only check.

    Kept because handlers in other modules call it with a bare string; new code
    should prefer :func:`classify_job_error`, which also returns a category.
    """
    return classify_job_error(RuntimeError(error_msg)).retryable


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
        """Main processing loop - runs jobs serially, event-driven.

        Also reaps jobs stranded in RUNNING. Startup recovery only runs when the
        process boots, so a job orphaned by any later crash - or by a dev-server
        reload - would sit in RUNNING and block the queue until the next
        restart. Without this the queue only self-heals on a clean deploy.
        """
        last_reap = 0.0
        while self._running:
            try:
                now = time.monotonic()
                if now - last_reap >= STALE_JOB_REAP_INTERVAL_SECONDS:
                    last_reap = now
                    try:
                        reaped = await queue_manager.recover_stale_running_jobs(
                            max_age_seconds=STALE_JOB_MAX_AGE_SECONDS
                        )
                        if reaped["requeued"] or reaped["dead"]:
                            logger.warning(
                                "Reaped %d stranded job(s): %d requeued, %d dead-lettered",
                                len(reaped["requeued"]) + len(reaped["dead"]),
                                len(reaped["requeued"]),
                                len(reaped["dead"]),
                            )
                    except Exception as e:
                        # Never let the reaper kill the loop.
                        logger.error("Stale-job reaper failed: %s", e)

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
        await asyncio.sleep(delay + (jitter * random.uniform(-0.5, 0.5)))

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
                    raise HandlerTimeoutError(
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
            verdict = classify_job_error(e)
            logger.error(
                "Job %s failed [%s%s]: %s",
                job.id,
                verdict.category,
                f" http={verdict.status}" if verdict.status else "",
                error_msg,
            )

            # Re-read the job in case it was cancelled while running
            current = await queue_manager.get_job(job.id)
            if current is None or current.status == JobStatus.CANCELLED:
                logger.warning("Job %s was cancelled/deleted during processing; not retrying", job.id)
                return

            described = verdict.describe(error_msg)

            # Check if we should retry
            if current is not None and current.retry_count < job.max_retries and verdict.retryable:
                next_retry = current.retry_count + 1
                await queue_manager.update_job(
                    job.id,
                    status=JobStatus.RETRYING,
                    progress=0.0,
                    error=described,
                    message=f"Retry {next_retry}/{job.max_retries}",
                    retry_count=next_retry,
                )
                logger.info("Job %s scheduled for retry %d/%d with backoff", job.id, next_retry, job.max_retries)
                await self._backoff_sleep(current.retry_count)
                # Re-queue for processing
                await queue_manager.update_job(job.id, status=JobStatus.QUEUED)
                queue_manager._signal_new_job()
            else:
                # Exhausted retries (or a deterministic failure) -> dead-letter queue
                logger.warning(
                    "Job %s moved to DLQ after %d retries (%s)",
                    job.id,
                    current.retry_count if current else job.retry_count,
                    verdict.category,
                )
                # Record *this* attempt's message. The job row still carries the
                # previous attempt's error from the RETRYING transition, so
                # reusing `current.error` here reported a stale cause.
                await queue_manager._move_to_dead_letter(job.id, described)

        finally:
            self._current_job = None

    async def _cancellation_watcher(self, job: Job):
        """Background watcher that polls for cancellation while the handler runs."""
        while True:
            await asyncio.sleep(CANCELLATION_HEARTBEAT_INTERVAL)
            if await self._check_cancelled(job):
                # Cancellation is already persisted by _check_cancelled; raise to
                # interrupt the active handler path.
                raise asyncio.CancelledError

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
