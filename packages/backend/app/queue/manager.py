"""Job queue manager with serial execution support."""
import asyncio
import logging
from collections.abc import Callable
from datetime import datetime

from ..core.config import PROJECT_ROOT
from ..models.job import Job, JobCreateRequest, JobStatus, QueueStats
from ..sse.handler import sse_manager
from .db_manager import JobDatabaseManager

logger = logging.getLogger(__name__)


class QueueManager:
    """
    Manages the job queue with serial execution by default.
    Designed for local hardware constraints.
    
    Uses SQLite for persistence with in-memory cache for fast access.
    """

    def __init__(self):
        self._jobs: dict[str, Job] = {}
        self._lock = asyncio.Lock()
        self._running_job: Job | None = None
        self._processing = False
        self._queue_dir = PROJECT_ROOT / "storage" / "queue"
        self._queue_dir.mkdir(parents=True, exist_ok=True)
        self._queue_file = self._queue_dir / "jobs.json"
        self._subscribers: list[Callable] = []
        self._completed_count: int = 0  # Track completed jobs for auto-cleanup
        self._max_completed_cache: int = 100  # Auto-cleanup after this many completed
        self._load_jobs()

    def _load_jobs(self):
        """Load persisted jobs from SQLite database."""
        try:
            # Load from SQLite database
            db_jobs = JobDatabaseManager.get_all_jobs()
            for job in db_jobs:
                self._jobs[job.id] = job
        except Exception as e:
            # Table may not exist yet (called before init_db)
            # or database error - jobs will be loaded after init_db
            logger.warning("Database not ready for job loading: %s", e)

    def reload_from_db(self):
        """Reload all jobs from database (called after init_db)."""
        self._jobs.clear()
        try:
            db_jobs = JobDatabaseManager.get_all_jobs()
            for job in db_jobs:
                self._jobs[job.id] = job
            logger.info("Loaded %d jobs from database", len(self._jobs))
        except Exception as e:
            logger.error("Error reloading jobs from database: %s", e)

    def _load_jobs_json(self):
        """Fallback: Load jobs from JSON file."""
        if self._queue_file.exists():
            try:
                import json
                with open(self._queue_file) as f:
                    data = json.load(f)
                    for job_data in data:
                        job = Job(**job_data)
                        self._jobs[job.id] = job
            except Exception as e:
                logger.error("Error loading jobs from JSON: %s", e)

    async def subscribe(self, callback: Callable):
        """Subscribe to job updates"""
        self._subscribers.append(callback)

    async def _notify_subscribers(self, job: Job):
        """Notify subscribers of job updates"""
        for callback in self._subscribers:
            try:
                await callback(job)
            except Exception as e:
                logger.error("Error notifying subscriber: %s", e)
    async def _broadcast_job_event(self, event_type: str, job: Job):
        """Broadcast a job event to all SSE clients"""
        try:
            await sse_manager.broadcast(event_type, {
                "job": job.model_dump(mode="json")
            })
        except Exception as e:
            logger.error("Error broadcasting job event: %s", e)


    async def enqueue(self, request: JobCreateRequest) -> Job:
        """Add a new job to the queue — checks system RAM first and auto-cleans if critical."""
        # System RAM guard: if >90% try cleanup, if still >92% warn
        try:
            import psutil

            mem = psutil.virtual_memory()
            if mem.percent >= 90:
                from ..diagnostics.resources import resource_monitor

                cleanup = await resource_monitor.cleanup_system_memory()
                logger.warning(f"System RAM {mem.percent:.1f}% before enqueue, cleanup: {cleanup['actions']}")
                mem2 = psutil.virtual_memory()
                if mem2.percent >= 92:
                    logger.warning(f"System RAM still {mem2.percent:.1f}% after cleanup — queueing anyway but may OOM")
        except Exception as e:
            logger.debug(f"RAM check before enqueue failed: {e}")

        async with self._lock:
            job = Job(
                job_type=request.job_type,
                params=request.params,
                max_retries=request.max_retries,
                status=JobStatus.QUEUED
            )
            self._jobs[job.id] = job
            # Persist to SQLite
            JobDatabaseManager.create_job(job)
            await self._notify_subscribers(job)
        # Broadcast after release lock to avoid blocking
        await self._broadcast_job_event("job.queued", job)
        return job

    async def get_job(self, job_id: str) -> Job | None:
        """Get a job by ID"""
        return self._jobs.get(job_id)

    async def get_all_jobs(self) -> list[Job]:
        """Get all jobs sorted by creation time"""
        return sorted(self._jobs.values(), key=lambda j: j.created_at, reverse=True)

    async def get_jobs_by_status(self, status: JobStatus) -> list[Job]:
        """Get jobs filtered by status, oldest first (FIFO by creation time)."""
        return sorted(
            (j for j in self._jobs.values() if j.status == status),
            key=lambda j: j.created_at,
        )

    async def get_stats(self) -> QueueStats:
        """Get queue statistics"""
        jobs = list(self._jobs.values())
        return QueueStats(
            total_jobs=len(jobs),
            pending=len([j for j in jobs if j.status == JobStatus.PENDING]),
            queued=len([j for j in jobs if j.status == JobStatus.QUEUED]),
            running=len([j for j in jobs if j.status == JobStatus.RUNNING]),
            retrying=len([j for j in jobs if j.status == JobStatus.RETRYING]),
            completed=len([j for j in jobs if j.status == JobStatus.COMPLETED]),
            failed=len([j for j in jobs if j.status == JobStatus.FAILED]),
            cancelled=len([j for j in jobs if j.status == JobStatus.CANCELLED])
        )

    async def update_job(self, job_id: str, status: JobStatus | None = None,
                        progress: float | None = None, message: str | None = None,
                        error: str | None = None, result: dict | None = None,
                        retry_count: int | None = None, output_path: str | None = None,
                        started_at: datetime | None = None,
                        completed_at: datetime | None = None) -> Job | None:
        """Update job status and progress"""
        job = self._jobs.get(job_id)
        if not job:
            return None

        old_status = job.status

        async with self._lock:
            if status:
                job.status = status
                if status == JobStatus.RUNNING and not job.started_at:
                    job.started_at = datetime.now()
                elif status in (JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED):
                    job.completed_at = datetime.now()
                    # Track completed jobs for auto-cleanup
                    if status == JobStatus.COMPLETED:
                        self._completed_count += 1
                    # Auto-cleanup old completed/failed jobs when threshold exceeded
                    if self._completed_count >= self._max_completed_cache:
                        await self._auto_cleanup_unlocked()
                        self._completed_count = 0

            if progress is not None:
                job.progress = min(max(progress, 0.0), 1.0)

            if message:
                job.message = message

            if error is not None:
                job.error = error

            if result:
                job.result = result

            if retry_count is not None:
                job.retry_count = retry_count

            if output_path is not None:
                job.output_path = output_path

            if started_at is not None:
                job.started_at = started_at

            if completed_at is not None:
                job.completed_at = completed_at

            # Persist to SQLite
            JobDatabaseManager.update_job(
                job_id,
                status=job.status,
                progress=job.progress,
                message=job.message,
                error=job.error,
                result=job.result,
                started_at=job.started_at,
                completed_at=job.completed_at,
                retry_count=job.retry_count,
                output_path=job.output_path
            )
            await self._notify_subscribers(job)

        # Broadcast event outside lock
        if status == JobStatus.RUNNING and old_status != JobStatus.RUNNING:
            await self._broadcast_job_event("job.started", job)
        elif status == JobStatus.COMPLETED:
            await self._broadcast_job_event("job.completed", job)
        elif status == JobStatus.FAILED:
            await self._broadcast_job_event("job.failed", job)
        elif status == JobStatus.CANCELLED:
            await self._broadcast_job_event("job.cancelled", job)
        elif progress is not None and old_status == JobStatus.RUNNING:
            await self._broadcast_job_event("job.progress", job)

        return job

    async def cancel_job(self, job_id: str) -> bool:
        """Cancel a pending, queued, or running job"""
        job = await self.get_job(job_id)
        if not job:
            return False

        if job.status not in (JobStatus.PENDING, JobStatus.QUEUED, JobStatus.RUNNING):
            return False

        async with self._lock:
            job.status = JobStatus.CANCELLED
            job.completed_at = datetime.now()
            # Persist to SQLite
            JobDatabaseManager.update_job(
                job_id,
                status=job.status,
                completed_at=job.completed_at
            )
            await self._notify_subscribers(job)

        await self._broadcast_job_event("job.cancelled", job)
        return True

    async def retry_job(self, job_id: str) -> Job | None:
        """Retry a failed job"""
        job = await self.get_job(job_id)
        if not job or job.status != JobStatus.FAILED:
            return None

        if job.retry_count >= job.max_retries:
            return None

        async with self._lock:
            job.retry_count += 1
            job.status = JobStatus.QUEUED
            job.error = None
            job.progress = 0.0
            job.message = ""
            # Persist to SQLite
            JobDatabaseManager.update_job(
                job_id,
                status=job.status,
                progress=job.progress,
                message=job.message,
                error=job.error,
                retry_count=job.retry_count
            )
            await self._notify_subscribers(job)

        await self._broadcast_job_event("job.queued", job)
        return job

    async def delete_job(self, job_id: str) -> bool:
        """Delete a job from the queue"""
        async with self._lock:
            if job_id in self._jobs:
                del self._jobs[job_id]
                # Remove from SQLite
                JobDatabaseManager.delete_job(job_id)
                return True
            return False

    async def clear_completed(self) -> int:
        """Remove all completed and cancelled jobs"""
        async with self._lock:
            completed_ids = [j.id for j in self._jobs.values()
                           if j.status in (JobStatus.COMPLETED, JobStatus.CANCELLED)]
            for job_id in completed_ids:
                del self._jobs[job_id]
            # Remove from SQLite
            count = JobDatabaseManager.clear_completed()
            return count

    async def clear_failed(self) -> int:
        """Remove all failed jobs"""
        async with self._lock:
            failed_ids = [j.id for j in self._jobs.values()
                         if j.status == JobStatus.FAILED]
            for job_id in failed_ids:
                del self._jobs[job_id]
            count = JobDatabaseManager.clear_failed()
            return count

    async def _auto_cleanup_unlocked(self) -> int:
        """Auto-cleanup old completed/failed/cancelled jobs (must be called under lock).
        
        Keeps the most recent completed jobs and removes older ones to prevent
        unbounded memory growth. Returns the number of jobs removed.
        """
        # Get terminal-state jobs sorted by completion time (oldest first)
        terminal_jobs = [
            j for j in self._jobs.values()
            if j.status in (JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED)
            and j.completed_at is not None
        ]
        terminal_jobs.sort(key=lambda j: j.completed_at)
        
        # Keep the most recent half, remove the rest
        to_remove = terminal_jobs[:max(0, len(terminal_jobs) // 2)]
        removed = 0
        for job in to_remove:
            if job.id in self._jobs:
                del self._jobs[job.id]
                JobDatabaseManager.delete_job(job.id)
                removed += 1
        
        if removed:
            logger.info("Auto-cleanup removed %d old completed jobs", removed)
        return removed


# Global queue instance
queue_manager = QueueManager()
