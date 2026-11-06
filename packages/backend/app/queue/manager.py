"""Job queue manager with serial execution support."""

import asyncio
import logging
import os
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any

from ..core.config import PROJECT_ROOT
from ..models.job import Job, JobCreateRequest, JobStatus, JobType, QueueStats
from ..sse.handler import sse_manager
from .db_manager import JobDatabaseManager

logger = logging.getLogger(__name__)

#: Statuses that mean "this job did not succeed". ``JobStatus.FAILED`` is never
#: assigned by the processor -- exhausted jobs are moved to the dead-letter queue
#: (``JobStatus.DEAD``) -- so anything counting only ``FAILED`` reports zero
#: failures no matter how many jobs died.
_UNSUCCESSFUL_STATUSES = (JobStatus.FAILED, JobStatus.DEAD)

#: Job types that can do useful work with an empty ``params`` dict. Every handler
#: registered in ``JobProcessor._register_default_handlers`` reads its input from
#: ``job.params`` and passes it straight to an adapter, so an empty dict is not a
#: degraded run - it is a run with no prompt, no model and no input file. Only
#: list a type here if its handler genuinely needs no arguments.
_PARAM_OPTIONAL_JOB_TYPES: frozenset = frozenset()

#: Default silence window (seconds) before a RUNNING job with no recent progress
#: is presumed ownerless. Matches the reaper's age default so a job that never
#: reports anything keeps exactly the old age-based behaviour.
_LEASE_WINDOW_DEFAULT_SECONDS = 900

#: Longer silence windows for job types whose handlers legitimately go quiet
#: between visible milestones -- a Wan or ComfyUI render can run 15+ minutes of
#: GPU work per progress tick. Distinguishes "slow progress" from "no progress",
#: which a longer flat age threshold cannot. Keep every entry well under the
#: processor's HANDLER_TIMEOUT_SECONDS (3600): a job silent past its own abort
#: cannot be live, so a longer lease would only delay the inevitable.
_LEASE_WINDOW_BY_TYPE: dict = {
    JobType.MUSIC_VIDEO: 1800,
    JobType.MUSIC_VIDEO_PREVIEW: 1800,
    JobType.NARRATIVE_VIDEO: 1800,
    JobType.SCENE_RENDER: 1800,
    JobType.COMFYUI_WORKFLOW: 1800,
}

#: Job TTL: terminal jobs older than this many seconds are expired from memory
#: (and the DB) to prevent unbounded growth. Defaults to 7 days; override with
#: the NMA_QUEUE_TTL_SECONDS environment variable.
JOB_TTL_SECONDS = int(os.environ.get("NMA_QUEUE_TTL_SECONDS", "604800"))

#: Priority aging: jobs waiting in QUEUED longer than this many seconds get
#: their effective priority boosted by 1, up to MAX_AGED_PRIORITY_BOOST, to
#: prevent starvation of low-priority jobs behind a flood of high-priority ones.
PRIORITY_AGE_THRESHOLD_SECONDS = 300
MAX_AGED_PRIORITY_BOOST = 10

#: Rate limiting: max jobs of a given type that may be QUEUED/RUNNING at once.
#: Empty dict means no limit. Keyed by JobType.
RATE_LIMIT_BY_TYPE: dict[JobType, int] = {}


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
        self._new_job_event = asyncio.Event()
        # Queue pause flag: when True, the processor will not dequeue new jobs.
        # Instance attribute (not module global) so tests sharing the module
        # don't leak pause state between each other.
        self._queue_paused = False
        # Progress-lease table: job_id -> last sign of life (claim or any
        # update while RUNNING). In-memory on purpose: a persisted lease would
        # survive the crash it is meant to detect, letting a dead job look
        # "recently active" until the stale stamp ages out and delaying every
        # restart recovery by up to a full window. The lease only protects live
        # owners; restart recovery stays purely age-based via started_at.
        self._last_progress_at: dict[str, datetime] = {}
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

    async def reload_from_db(self):
        """Reload all jobs from database (called after init_db)."""
        self._jobs.clear()
        # Drop the lease table with the jobs: every entry in it names an owner
        # that is definitionally gone (this is a fresh process), and keeping
        # one would shelter a stranded job through the recovery below.
        self._last_progress_at.clear()
        try:
            db_jobs = await JobDatabaseManager.get_all_jobs_async()
            for job in db_jobs:
                self._jobs[job.id] = job
            logger.info("Loaded %d jobs from database", len(self._jobs))
        except Exception as e:
            logger.error("Error reloading jobs from database: %s", e)
            return
        # Jobs left RUNNING by a process that died (restart, crash, force-kill)
        # are stranded forever: nothing in the queue ever transitions them, and
        # the processor's handler timeout only fires while this process is alive
        # and awaiting that specific job. Recover them on load so a restart
        # cannot silently wedge the queue.
        try:
            await self.recover_stale_running_jobs()
        except Exception as e:
            logger.error("Stale running-job recovery failed: %s", e)
        # Also drop queued/running/retrying jobs that carry no params. The
        # reaper only looks at RUNNING, so without this a job requeued with
        # empty params would keep cycling through the processor and burn its
        # retries on a failure that cannot be fixed by retrying. RETRYING is
        # included because a restart can strand a job there (see
        # recover_stranded_retrying_jobs).
        try:
            await self.quarantine_unrunnable_jobs()
        except Exception as e:
            logger.error("Unrunnable-job quarantine failed: %s", e)
        # RETRYING is a transient backoff state that only lives in memory; a
        # restart strands every job that was mid-backoff. Recover them after
        # quarantine so unrunnable ones are already dead-lettered.
        try:
            await self.recover_stranded_retrying_jobs()
        except Exception as e:
            logger.error("Retrying-job recovery failed: %s", e)

    @staticmethod
    def _lease_window_seconds(job: Job) -> int:
        """How long a RUNNING job of this type may go quiet before it looks dead."""
        return _LEASE_WINDOW_BY_TYPE.get(job.job_type, _LEASE_WINDOW_DEFAULT_SECONDS)

    def _silence_seconds(self, job: Job, now: datetime) -> float:
        """Seconds since this job last showed a sign of life.

        Falls back to ``started_at``/``created_at`` for jobs that never reported
        anything, so those keep the old purely age-based behaviour. A job with no
        timestamp at all reads as infinitely silent: there is nothing to anchor
        a lease to, so reclaiming it is the safe direction.
        """
        last = self._last_progress_at.get(job.id) or job.started_at or job.created_at
        if last is None:
            return float("inf")
        return (now - last).total_seconds()

    @staticmethod
    def is_runnable(job: Job) -> bool:
        """Whether this job could possibly succeed if handed to a handler.

        A job with no params is unrecoverable rather than merely unlucky: every
        handler reads its input from ``job.params``, so an empty dict means no
        prompt, no model and no input file. Retrying it burns the retry budget
        on a guaranteed failure and, because the reaper requeues on every pass,
        it can be revived indefinitely.
        """
        if job.job_type in _PARAM_OPTIONAL_JOB_TYPES:
            return True
        return bool(job.params)

    async def quarantine_unrunnable_jobs(self) -> dict[str, Any]:
        """Dead-letter queued/running/retrying jobs that no handler could ever run.

        ``recover_stale_running_jobs`` only inspects RUNNING jobs, so a job that
        was requeued with empty params would sit in QUEUED and be picked up by the
        processor, fail, and consume a retry for nothing. Sweeping them here keeps
        the queue from spending its budget on guaranteed failures.

        Returns the ids dead-lettered, split by whether they were RUNNING or
        already QUEUED so callers can report the two cases separately.
        """
        quarantined: list[str] = []
        candidates = [
            j
            for j in self._jobs.values()
            if j.status in (JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.RETRYING)
            and not self.is_runnable(j)
        ]
        for job in candidates:
            try:
                ok = await self._move_to_dead_letter(
                    job.id,
                    "job has no params and cannot be run (unrecoverable input; "
                    "not retried because a retry cannot succeed)",
                )
                if ok:
                    quarantined.append(job.id)
            except Exception as e:
                logger.error("Failed to quarantine unrunnable job %s: %s", job.id, e)
        if quarantined:
            logger.warning(
                "Quarantined %d job(s) with no params: they cannot be run, so "
                "they were dead-lettered instead of retried",
                len(quarantined),
            )
        return {"quarantined": quarantined, "examined": len(candidates)}

    async def recover_stale_running_jobs(self, max_age_seconds: int = 900) -> dict[str, Any]:
        """Requeue or dead-letter jobs stranded in RUNNING by a dead process.

        A job only reaches RUNNING once a processor has claimed it, so on
        startup any RUNNING job is by definition orphaned: this process has not
        claimed it. Jobs are only recovered once they are older than
        `max_age_seconds`, because ``reload_from_db`` can race with a processor
        that is legitimately mid-flight in another worker.

        Recovery respects the existing retry budget rather than inventing a
        policy: a job with retries left is requeued, one that has exhausted them
        goes to the dead-letter queue. That keeps a broken adapter (ComfyUI down)
        from being retried forever while still rescuing a job that merely
        outlived a restart.
        """
        now = datetime.now()
        cutoff = now - timedelta(seconds=max_age_seconds)
        requeued: list[str] = []
        dead: list[str] = []
        skipped_fresh: list[str] = []
        skipped_active: list[str] = []
        unrecoverable: list[str] = []

        candidates = [j for j in self._jobs.values() if j.status == JobStatus.RUNNING]
        for job in candidates:
            started = job.started_at or job.created_at
            if started is not None and started > cutoff:
                skipped_fresh.append(job.id)
                continue

            # Age alone cannot distinguish a legitimately long render from a
            # dead owner (that was Q6): only reclaim a job that has ALSO gone
            # quiet past its type's lease window. A Wan render 16 minutes in
            # that reported progress a minute ago stays; one silent for 16
            # minutes goes. Jobs that never reported anything fall back to
            # started_at, i.e. the old age rule exactly.
            silence_s = self._silence_seconds(job, now)
            window_s = self._lease_window_seconds(job)
            if silence_s <= window_s:
                skipped_active.append(job.id)
                continue

            age_s = (now - started).total_seconds() if started else float("inf")
            # An empty-params job can never succeed, so retrying it just burns
            # the budget. Dead-letter it outright with the reason recorded, rather
            # than requeuing a job that is guaranteed to fail again.
            if not self.is_runnable(job):
                ok = await self._move_to_dead_letter(
                    job.id,
                    "job has no params and cannot be run (unrecoverable input; "
                    "not retried because a retry cannot succeed)",
                )
                if ok:
                    dead.append(job.id)
                    unrecoverable.append(job.id)
                    logger.warning(
                        "Dead-lettered stranded job %s (%s): no params, so it cannot be run",
                        job.id,
                        job.job_type,
                    )
                continue
            try:
                if job.retry_count < job.max_retries:
                    async with self._lock:
                        job.retry_count += 1
                        job.status = JobStatus.QUEUED
                        job.progress = 0.0
                        job.message = "requeued after worker restart"
                        job.started_at = None
                        job.error = None
                        self._last_progress_at.pop(job.id, None)
                        await JobDatabaseManager.update_job_async(
                            job.id,
                            status=job.status,
                            progress=job.progress,
                            message=job.message,
                            error=job.error,
                            retry_count=job.retry_count,
                            started_at=None,
                        )
                        await self._notify_subscribers(job)
                    self._signal_new_job()
                    requeued.append(job.id)
                    logger.warning(
                        "Recovered stranded job %s (%s) after %.0fs without an owner; "
                        "requeued (attempt %d/%d)",
                        job.id,
                        job.job_type,
                        age_s,
                        job.retry_count,
                        job.max_retries,
                    )
                else:
                    # Not called while holding self._lock: _move_to_dead_letter
                    # acquires it itself, and an asyncio.Lock is not reentrant.
                    ok = await self._move_to_dead_letter(
                        job.id,
                        "worker restarted while this job was running "
                        f"(no owner for {age_s:.0f}s); retries exhausted",
                    )
                    if ok:
                        dead.append(job.id)
                        logger.warning(
                            "Dead-lettered stranded job %s (%s) after %.0fs: retries exhausted",
                            job.id,
                            job.job_type,
                            age_s,
                        )
            except Exception as e:
                logger.error("Failed to recover stranded job %s: %s", job.id, e)

        if requeued or dead:
            logger.warning(
                "Startup recovery: %d stranded job(s) -> %d requeued, %d dead-lettered",
                len(requeued) + len(dead),
                len(requeued),
                len(dead),
            )

        return {
            "requeued": requeued,
            "dead": dead,
            "unrecoverable": unrecoverable,
            "skipped_fresh": skipped_fresh,
            "skipped_active": skipped_active,
            "examined": len(candidates),
        }

    async def recover_stranded_retrying_jobs(self) -> dict[str, Any]:
        """Requeue or dead-letter jobs stranded in RETRYING by a dead process.

        RETRYING is a transient in-process state: the processor sets it,
        sleeps out the exponential backoff, then flips the job back to
        QUEUED. The backoff timer lives only in memory, so a restart or
        reload orphans every job that was mid-backoff - the process loop
        only ever reads QUEUED, so nothing transitions it again and the
        job reports ``is_active`` forever. ``reload_from_db`` runs before
        the processor starts, so every RETRYING job present here is
        stranded by definition.

        Runnable jobs with retry budget left go back to QUEUED - the
        downtime already exceeded any backoff. Unrunnable jobs are left
        for ``quarantine_unrunnable_jobs``; exhausted ones are
        dead-lettered here.
        """
        requeued: list[str] = []
        dead: list[str] = []

        candidates = [j for j in self._jobs.values() if j.status == JobStatus.RETRYING]
        for job in candidates:
            if not self.is_runnable(job):
                # Leave for the quarantine sweep; it dead-letters with the
                # canonical "no params" reason.
                continue
            if job.retry_count >= job.max_retries:
                ok = await self._move_to_dead_letter(
                    job.id,
                    "worker restarted while this job was waiting out its "
                    "retry backoff; retries exhausted",
                )
                if ok:
                    dead.append(job.id)
                    logger.warning(
                        "Dead-lettered stranded retrying job %s (%s): retries exhausted",
                        job.id,
                        job.job_type,
                    )
                continue
            updated = await self.update_job(
                job.id,
                status=JobStatus.QUEUED,
                progress=0.0,
                message="requeued after restart (was mid-backoff)",
                error=None,
            )
            if updated is not None:
                self._signal_new_job()
                requeued.append(job.id)
                logger.warning(
                    "Recovered stranded retrying job %s (%s); requeued (attempt %d/%d)",
                    job.id,
                    job.job_type,
                    job.retry_count,
                    job.max_retries,
                )

        if requeued or dead:
            logger.warning(
                "Retrying-job recovery: %d requeued, %d dead-lettered",
                len(requeued),
                len(dead),
            )
        return {"requeued": requeued, "dead": dead, "examined": len(candidates)}

    async def count_stale_running_jobs(self, max_age_seconds: int = 900) -> int:
        """How many RUNNING jobs have no live owner. Used by the health check.

        Uses the same silence rule as the reaper (age AND quiet past the
        type's lease window), so a legitimately long render that keeps
        reporting progress no longer flips the queue to unhealthy while it is
        still working -- the exact false-red from the Q6 report.
        """
        now = datetime.now()
        cutoff = now - timedelta(seconds=max_age_seconds)
        count = 0
        for j in self._jobs.values():
            if j.status != JobStatus.RUNNING:
                continue
            started = j.started_at or j.created_at
            if started is None or started > cutoff:
                continue
            if self._silence_seconds(j, now) > self._lease_window_seconds(j):
                count += 1
        return count

    # ------------------------------------------------------------------
    # Job TTL / expiration
    # ------------------------------------------------------------------
    async def expire_old_terminal_jobs(self, ttl_seconds: int | None = None) -> int:
        """Expire terminal jobs older than ``ttl_seconds`` from memory and DB.

        Returns the number of jobs expired. Called periodically by the
        processor to prevent unbounded memory growth from completed jobs.
        Runs asynchronously so DB deletion doesn't block the event loop.
        """
        ttl = ttl_seconds if ttl_seconds is not None else JOB_TTL_SECONDS
        cutoff = datetime.now() - timedelta(seconds=ttl)
        terminal_statuses = {
            JobStatus.COMPLETED,
            JobStatus.FAILED,
            JobStatus.CANCELLED,
            JobStatus.DEAD,
        }
        # Collect and evict under the lock so a concurrent update_job cannot
        # resurrect or mutate a job mid-expiry; DB deletes run after release
        # so slow SQLite I/O does not stall the queue.
        expired: dict[str, Job] = {}
        async with self._lock:
            for job in list(self._jobs.values()):
                if job.status not in terminal_statuses:
                    continue
                if job.completed_at is None:
                    continue
                if job.completed_at > cutoff:
                    continue
                expired[job.id] = job
            for job_id in expired:
                self._jobs.pop(job_id, None)
                self._last_progress_at.pop(job_id, None)

        for job_id in expired:
            try:
                await JobDatabaseManager.delete_job_async(job_id)
            except Exception as e:
                logger.error("Failed to delete expired job %s from DB: %s", job_id, e)

        # Evicted jobs must be retracted from connected clients too, or the
        # frontend keeps showing ghosts until the next manual refresh.
        for job in expired.values():
            try:
                await self._broadcast_job_event("job.deleted", job)
            except Exception as e:
                logger.error("Failed to broadcast expiry for job %s: %s", job.id, e)

        if expired:
            logger.info("Expired %d terminal jobs older than %ds", len(expired), ttl)
        return len(expired)

    # ------------------------------------------------------------------
    # Priority aging (starvation prevention)
    # ------------------------------------------------------------------
    @staticmethod
    def effective_priority(job: Job, now: datetime | None = None) -> int:
        """Return the effective priority of a job, boosted by age.

        Jobs waiting in QUEUED longer than ``PRIORITY_AGE_THRESHOLD_SECONDS``
        get +1 effective priority per threshold interval, capped at
        ``MAX_AGED_PRIORITY_BOOST``. This prevents starvation of low-priority
        jobs behind a flood of high-priority ones (Nov 2026 best practice).
        """
        if job.status != JobStatus.QUEUED:
            return job.priority
        now = now or datetime.now()
        wait_s = (now - job.created_at).total_seconds()
        intervals = int(wait_s // PRIORITY_AGE_THRESHOLD_SECONDS)
        boost = min(intervals, MAX_AGED_PRIORITY_BOOST)
        return job.priority + boost

    # ------------------------------------------------------------------
    # Queue pause / resume
    # ------------------------------------------------------------------
    def pause_queue(self) -> None:
        """Pause the queue: the processor will not dequeue new jobs."""
        self._queue_paused = True
        logger.warning("Job queue paused")

    def resume_queue(self) -> None:
        """Resume the queue: the processor may dequeue new jobs again."""
        self._queue_paused = False
        logger.warning("Job queue resumed")

    def is_paused(self) -> bool:
        """Return True if the queue is paused."""
        return self._queue_paused

    # ------------------------------------------------------------------
    # Rate limiting per job type
    # ------------------------------------------------------------------
    def count_active_by_type(self, job_type: JobType) -> int:
        """Count QUEUED + RUNNING jobs of a given type."""
        return sum(
            1
            for j in self._jobs.values()
            if j.job_type == job_type and j.status in (JobStatus.QUEUED, JobStatus.RUNNING)
        )

    def check_rate_limit(self, job_type: JobType) -> bool:
        """Return True if a new job of ``job_type`` may be enqueued.

        Rate limit is the max number of QUEUED+RUNNING jobs per type.
        An empty/absent entry in ``RATE_LIMIT_BY_TYPE`` means no limit.
        """
        limit = RATE_LIMIT_BY_TYPE.get(job_type)
        if limit is None:
            return True
        return self.count_active_by_type(job_type) < limit

    # ------------------------------------------------------------------
    # Job selection for processor (respects pause, rate limits, priority aging)
    # ------------------------------------------------------------------
    async def get_next_job(self) -> Job | None:
        """Select the next job to process, respecting pause, rate limits, and
        priority aging.

        Returns the highest-effective-priority job that is not rate-limited,
        or None if the queue is paused, empty, or all jobs are rate-limited.
        """
        if self.is_paused():
            return None

        now = datetime.now()
        # Sort by effective priority (aged), then by created_at (oldest first)
        candidates = sorted(
            (j for j in self._jobs.values() if j.status == JobStatus.QUEUED),
            key=lambda j: (-self.effective_priority(j, now), j.created_at),
        )

        for job in candidates:
            if self.check_rate_limit(job.job_type):
                return job
        # All queued jobs are rate-limited: none can run right now.
        return None

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

    async def unsubscribe(self, callback: Callable) -> bool:
        """Remove a previously-registered subscriber.

        Returns True when the callback was registered (and is now removed),
        False when it was not found. Lets the composition root clean up
        subscriptions on shutdown instead of leaking them.
        """
        if callback in self._subscribers:
            self._subscribers.remove(callback)
            return True
        return False

    async def _notify_subscribers(self, job: Job):
        """Notify subscribers of job updates"""
        for callback in self._subscribers:
            try:
                await callback(job)
            except Exception as e:
                logger.error("Error notifying subscriber: %s", e)

    def _signal_new_job(self):
        """Signal the processor that a new job is available."""
        self._new_job_event.set()

    async def wait_for_jobs(self, timeout: float | None = None):
        """Wait for a new job to be enqueued. Returns True if signaled, False on timeout."""
        # The event is level-triggered and nothing else clears it. Without
        # this, the first enqueue sets it permanently and every subsequent
        # wait returns instantly - the processor's idle path then busy-spins
        # on get_jobs_by_status instead of sleeping. Clearing first is safe:
        # the caller only waits after finding no QUEUED jobs, and any enqueue
        # after the clear re-sets the event and wakes the wait immediately.
        self._new_job_event.clear()
        try:
            await asyncio.wait_for(self._new_job_event.wait(), timeout=timeout)
            return True
        except TimeoutError:
            return False

    @staticmethod
    def _job_event_name(
        status: JobStatus | None,
        old_status: JobStatus,
        progress: float | None,
    ) -> str | None:
        """Pick the SSE event name for an update_job transition.

        RUNNING and RETRYING only fire on the transition into the state -
        repeated progress ticks while RUNNING go out as job.progress
        instead of re-announcing job.started. Terminal statuses broadcast
        on every call that sets them (callers only set them once).
        """
        if status == JobStatus.RUNNING and old_status != JobStatus.RUNNING:
            return "job.started"
        if status == JobStatus.RETRYING and old_status != JobStatus.RETRYING:
            return "job.retrying"
        if status == JobStatus.COMPLETED:
            return "job.completed"
        if status == JobStatus.FAILED:
            return "job.failed"
        if status == JobStatus.CANCELLED:
            return "job.cancelled"
        if progress is not None:
            return "job.progress"
        return None

    async def _broadcast_job_event(self, event_type: str, job: Job):
        """Broadcast a job event to all SSE clients"""
        try:
            priority = (
                "urgent"
                if job.status in (JobStatus.FAILED, JobStatus.DEAD)
                else "high"
                if job.status in (JobStatus.COMPLETED, JobStatus.CANCELLED)
                else "medium"
                if job.status == JobStatus.RUNNING
                else "low"
            )
            await sse_manager.broadcast(
                event_type, {"job": job.model_dump(mode="json")}, priority=priority
            )
        except Exception as e:
            logger.error("Error broadcasting job event: %s", e)

    async def enqueue(self, request: JobCreateRequest) -> Job:
        """Add a new job to the queue -- checks system RAM first and auto-cleans if critical."""

        # Rate limiting: reject if too many jobs of this type are already active
        if not self.check_rate_limit(request.job_type):
            active = self.count_active_by_type(request.job_type)
            limit = RATE_LIMIT_BY_TYPE.get(request.job_type)
            raise ValueError(
                f"Rate limit exceeded for job type {request.job_type}: "
                f"{active} active jobs, limit is {limit}"
            )

        # System RAM guard: if >90% try cleanup, if still >92% warn
        try:
            import psutil

            mem = psutil.virtual_memory()
            if mem.percent >= 90:
                from ..diagnostics.resources import resource_monitor

                cleanup = await resource_monitor.cleanup_system_memory()
                logger.warning(
                    f"System RAM {mem.percent:.1f}% before enqueue, cleanup: {cleanup['actions']}"
                )
                mem2 = psutil.virtual_memory()
                if mem2.percent >= 92:
                    logger.warning(
                        f"System RAM still {mem2.percent:.1f}% after cleanup -- queueing anyway but may OOM"
                    )
        except Exception as e:
            logger.debug(f"RAM check before enqueue failed: {e}")

        async with self._lock:
            job = Job(
                job_type=request.job_type,
                params=request.params,
                max_retries=request.max_retries,
                status=JobStatus.QUEUED,
                priority=request.priority,
            )
            self._jobs[job.id] = job
            # Signal processor that a new job is available
            self._signal_new_job()
        # Persist to SQLite offloaded to thread to avoid blocking event loop.
        # Done outside the lock so enqueue operations aren't serialized on DB I/O.
        try:
            await JobDatabaseManager.create_job_async(job)
        except Exception as e:
            logger.error("Failed to persist new job %s: %s", job.id, e)
        # Log creation with the origin and a params fingerprint. Enqueue was
        # previously silent, so a job could exist in the database with nothing in
        # any log explaining who created it or with what - which is why the
        # origin of the 233 empty-params `image_generation` rows could not be
        # traced at all. The keys (not the values) are what matter here: enough to
        # identify the caller and see that input was dropped, without dumping
        # prompts or file paths into the log.
        logger.info(
            "Job queued id=%s type=%s keys=%s n_params=%d priority=%d max_retries=%d",
            job.id,
            job.job_type,
            sorted(request.params.keys()) or "[]",
            len(request.params),
            request.priority,
            request.max_retries,
        )
        if not request.params:
            # Empty params means no handler can run it (D31). Log it loudly here,
            # at the point of origin, where the responsible caller is identifiable
            # by the request id - rather than letting it sit in the queue until
            # the reaper quarantines it with no trace of where it came from.
            logger.warning(
                "Job queued with NO params id=%s type=%s - it cannot be run and "
                "will be dead-lettered; find the caller via request_id above",
                job.id,
                job.job_type,
            )
        # Notify subscribers and broadcast outside the lock to avoid blocking
        # other queue operations on slow subscribers or SSE fans-out.
        await self._notify_subscribers(job)
        await self._broadcast_job_event("job.queued", job)
        return job

    async def get_job(self, job_id: str) -> Job | None:
        """Get a job by ID. Returns a copy to prevent callers from mutating
        the in-memory job object."""
        job = self._jobs.get(job_id)
        if job is None:
            return None
        # Return a model copy so callers cannot mutate the cached job.
        return Job.model_validate(job.model_dump())

    async def is_cancelled(self, job_id: str) -> bool:
        """Check whether a job has been cancelled.

        Handlers call this at safe checkpoints to support cooperative
        cancellation. Returns True when the job status is CANCELLED or the
        job no longer exists (deleted while running).
        """
        job = self._jobs.get(job_id)
        if job is None:
            return True
        return job.status == JobStatus.CANCELLED

    async def get_all_jobs(self) -> list[Job]:
        """Get all jobs sorted by creation time.

        Returns model copies so callers cannot mutate the cached job objects.
        """
        return [
            Job.model_validate(j.model_dump())
            for j in sorted(self._jobs.values(), key=lambda j: j.created_at, reverse=True)
        ]

    async def get_jobs_by_status(self, status: JobStatus) -> list[Job]:
        """Get jobs filtered by status, highest priority first then oldest first."""
        return sorted(
            (j for j in self._jobs.values() if j.status == status),
            key=lambda j: (-j.priority, j.created_at),
        )

    async def get_stats(self) -> QueueStats:
        """Get queue statistics.

        ``failed`` counts every unsuccessful job, including the dead-letter
        queue. The processor never assigns ``FAILED`` (exhausted jobs go to
        ``DEAD``), so counting only ``FAILED`` pinned the queue page's failure
        count at zero. ``dead`` is the DLQ subset of that same number.
        """
        jobs = list(self._jobs.values())
        return QueueStats(
            total_jobs=len(jobs),
            pending=len([j for j in jobs if j.status == JobStatus.PENDING]),
            queued=len([j for j in jobs if j.status == JobStatus.QUEUED]),
            running=len([j for j in jobs if j.status == JobStatus.RUNNING]),
            retrying=len([j for j in jobs if j.status == JobStatus.RETRYING]),
            completed=len([j for j in jobs if j.status == JobStatus.COMPLETED]),
            failed=len([j for j in jobs if j.status in _UNSUCCESSFUL_STATUSES]),
            cancelled=len([j for j in jobs if j.status == JobStatus.CANCELLED]),
            dead=len([j for j in jobs if j.status == JobStatus.DEAD]),
        )

    async def get_metrics(self) -> dict:
        """Extended queue metrics for observability."""
        stats = await self.get_stats()
        jobs = list(self._jobs.values())
        completed_jobs = [
            j for j in jobs if j.status == JobStatus.COMPLETED and j.started_at and j.completed_at
        ]
        wait_times = [
            (j.started_at - j.created_at).total_seconds() for j in completed_jobs if j.started_at
        ]
        durations = [
            (j.completed_at - j.started_at).total_seconds()
            for j in completed_jobs
            if j.started_at and j.completed_at
        ]
        now = datetime.now()
        recent_completed = [
            j for j in completed_jobs if (now - j.completed_at).total_seconds() <= 60.0
        ]
        # recent_completed counts completions inside a 60-second window, so
        # the count itself IS the per-minute rate - dividing by 60 again
        # reported jobs-per-second mislabeled as per-minute (60x low).
        processing_rate = float(len(recent_completed))
        dead_jobs = [j for j in jobs if j.status == JobStatus.DEAD]
        dead_sample = [
            {
                "id": j.id,
                "job_type": j.job_type.value if hasattr(j.job_type, "value") else str(j.job_type),
                "error": j.error,
                "failed_at": j.completed_at.isoformat() if j.completed_at else None,
            }
            for j in sorted(dead_jobs, key=lambda j: j.completed_at or j.created_at, reverse=True)[
                :10
            ]
        ]
        current = self._running_job
        return {
            "stats": stats.model_dump(mode="json"),
            "queue_depth": stats.queued + stats.pending,
            "current_job_id": current.id if current else None,
            "current_job_type": current.job_type.value if current else None,
            "current_job_started_at": current.started_at.isoformat()
            if current and current.started_at
            else None,
            "processing_rate_per_min": round(processing_rate, 2),
            "avg_wait_seconds": round(sum(wait_times) / len(wait_times), 2) if wait_times else 0.0,
            "avg_duration_seconds": round(sum(durations) / len(durations), 2) if durations else 0.0,
            "dead_letter_count": len(dead_jobs),
            "dead_letter_sample": dead_sample,
        }

    async def update_job(
        self,
        job_id: str,
        status: JobStatus | None = None,
        progress: float | None = None,
        message: str | None = None,
        error: str | None = None,
        result: dict | None = None,
        retry_count: int | None = None,
        output_path: str | None = None,
        started_at: datetime | None = None,
        completed_at: datetime | None = None,
    ) -> Job | None:
        """Update job status and progress"""
        job = self._jobs.get(job_id)
        if not job:
            return None

        old_status = job.status

        # Compute new values before mutating in-memory state
        new_status = status or job.status
        new_progress = min(max(progress, 0.0), 1.0) if progress is not None else job.progress
        new_message = message or job.message
        new_error = error if error is not None else job.error
        new_result = result or job.result
        new_retry_count = retry_count if retry_count is not None else job.retry_count
        new_output_path = output_path if output_path is not None else job.output_path
        new_started_at = started_at if started_at is not None else job.started_at
        new_completed_at = completed_at if completed_at is not None else job.completed_at

        if status == JobStatus.RUNNING and not job.started_at:
            new_started_at = datetime.now()
        elif status in (JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED):
            new_completed_at = datetime.now()

        async with self._lock:
            # Persist to SQLite first; only update in-memory on success
            try:
                await JobDatabaseManager.update_job_async(
                    job_id,
                    status=new_status,
                    progress=new_progress,
                    message=new_message,
                    error=new_error,
                    result=new_result,
                    started_at=new_started_at,
                    completed_at=new_completed_at,
                    retry_count=new_retry_count,
                    output_path=new_output_path,
                )
            except Exception as e:
                logger.error("Failed to persist job %s update: %s", job_id, e)
                return None

            # Update in-memory state only after successful DB write
            job.status = new_status
            job.progress = new_progress
            job.message = new_message
            job.error = new_error
            job.result = new_result
            job.retry_count = new_retry_count
            job.output_path = new_output_path
            job.started_at = new_started_at
            job.completed_at = new_completed_at

            # Any successful touch of a running job renews its progress lease --
            # the claim itself, a progress tick, even a message-only heartbeat
            # from a long poll loop. Leaving RUNNING drops the entry so the
            # table cannot grow with finished jobs.
            if new_status == JobStatus.RUNNING:
                self._last_progress_at[job_id] = datetime.now()
            else:
                self._last_progress_at.pop(job_id, None)

            if status == JobStatus.COMPLETED:
                self._completed_count += 1
            expired_jobs: list[Job] = []
            if self._completed_count >= self._max_completed_cache:
                expired_jobs = await self._auto_cleanup_unlocked()
                self._completed_count = 0

        # Notify subscribers outside the lock so a slow subscriber cannot
        # block other queue operations.
        await self._notify_subscribers(job)
        for expired in expired_jobs:
            try:
                await self._broadcast_job_event("job.deleted", expired)
            except Exception as e:
                logger.error("Failed to broadcast auto-cleanup for job %s: %s", expired.id, e)

        # Broadcast event outside lock
        event = self._job_event_name(status, old_status, progress)
        if event is not None:
            await self._broadcast_job_event(event, job)

        return job

    async def cancel_job(self, job_id: str) -> bool:
        """Cancel a pending, queued, or running job"""
        async with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return False

            if job.status not in (
                JobStatus.PENDING,
                JobStatus.QUEUED,
                JobStatus.RUNNING,
                JobStatus.RETRYING,
            ):
                return False

            old_status = job.status
            job.status = JobStatus.CANCELLED
            job.completed_at = datetime.now()
            self._last_progress_at.pop(job_id, None)
            # Persist to SQLite
            await JobDatabaseManager.update_job_async(
                job_id, status=job.status, completed_at=job.completed_at
            )
            await self._notify_subscribers(job)
            logger.info(
                "Job cancelled id=%s type=%s was=%s",
                job_id,
                job.job_type,
                old_status,
            )

        await self._broadcast_job_event("job.cancelled", job)
        return True

    async def _move_to_dead_letter(self, job_id: str, error: str) -> bool:
        """Move a permanently failed job to the dead-letter queue."""
        async with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return False
            job.status = JobStatus.DEAD
            job.error = error
            job.completed_at = datetime.now()
            self._last_progress_at.pop(job_id, None)
            try:
                await JobDatabaseManager.update_job_async(
                    job_id,
                    status=job.status,
                    error=job.error,
                    completed_at=job.completed_at,
                )
            except Exception as e:
                logger.error("Failed to persist dead-letter job %s: %s", job_id, e)
                return False
            await self._notify_subscribers(job)
        await self._broadcast_job_event("job.dead", job)
        return True

    async def get_dead_letter_jobs(self, limit: int = 50) -> list[Job]:
        """Return recently dead-lettered jobs, newest first."""
        dead = [j for j in self._jobs.values() if j.status == JobStatus.DEAD]
        dead.sort(key=lambda j: j.completed_at or j.created_at, reverse=True)
        return dead[: max(1, limit)]

    async def retry_job(self, job_id: str, *, manual: bool = False) -> Job | None:
        """Retry a failed or dead-lettered job.

        With ``manual=True`` (the user pressed Retry) an exhausted job's
        budget is reset instead of rejected: automatic retries stop at
        ``max_retries`` because the same job will probably fail again, but an
        explicit operator retry declares the fault fixed and must be honored.
        The reset restarts the automatic budget for the new attempt.
        """
        async with self._lock:
            job = self._jobs.get(job_id)
            if not job or job.status not in (JobStatus.FAILED, JobStatus.DEAD):
                return None

            if job.retry_count >= job.max_retries and not manual:
                return None
            if job.retry_count >= job.max_retries:
                job.retry_count = 0
                logger.info(
                    "Job %s exhausted its retry budget; manual retry requested, resetting budget",
                    job_id,
                )

            job.retry_count += 1
            job.status = JobStatus.QUEUED
            job.error = None
            job.progress = 0.0
            job.message = ""
            self._last_progress_at.pop(job_id, None)
            logger.info(
                "Job retry queued id=%s type=%s attempt=%d/%d manual=%s",
                job_id,
                job.job_type,
                job.retry_count,
                job.max_retries,
                manual,
            )
            # Persist to SQLite
            await JobDatabaseManager.update_job_async(
                job_id,
                status=job.status,
                progress=job.progress,
                message=job.message,
                error=job.error,
                retry_count=job.retry_count,
            )
            await self._notify_subscribers(job)
            self._signal_new_job()

        await self._broadcast_job_event("job.queued", job)
        return job

    async def delete_job(self, job_id: str) -> bool:
        """Delete a job from the queue"""
        job: Job | None = None
        async with self._lock:
            job = self._jobs.get(job_id)
            if job is not None:
                del self._jobs[job_id]
                self._last_progress_at.pop(job_id, None)
                # Remove from SQLite
                await JobDatabaseManager.delete_job_async(job_id)
        if job is None:
            return False
        logger.info(
            "Job deleted id=%s type=%s status=%s",
            job_id,
            job.job_type,
            job.status,
        )
        # Tell subscribers and SSE clients the job is gone - without this a
        # deleted job lingered in every connected client's store until the
        # next unrelated event or a manual refresh.
        await self._notify_subscribers(job)
        await self._broadcast_job_event("job.deleted", job)
        return True

    async def clear_completed(self) -> int:
        """Remove all completed and cancelled jobs"""
        doomed: list[Job] = []
        async with self._lock:
            doomed = [
                j
                for j in self._jobs.values()
                if j.status in (JobStatus.COMPLETED, JobStatus.CANCELLED)
            ]
            for job in doomed:
                del self._jobs[job.id]
                self._last_progress_at.pop(job.id, None)
        # Also clear from database
        await JobDatabaseManager.clear_completed_async()
        for job in doomed:
            try:
                await self._broadcast_job_event("job.deleted", job)
            except Exception as e:
                logger.error("Failed to broadcast clear for job %s: %s", job.id, e)
        return len(doomed)

    async def clear_failed(self) -> int:
        """Remove all unsuccessful jobs (FAILED and dead-lettered).

        The processor routes exhausted jobs to ``DEAD`` and never assigns
        ``FAILED``, so this endpoint clears both ``FAILED`` and ``DEAD``.
        ``clear_dead`` remains available for the DLQ-only view.
        """
        doomed: list[Job] = []
        async with self._lock:
            doomed = [j for j in self._jobs.values() if j.status in _UNSUCCESSFUL_STATUSES]
            for job in doomed:
                del self._jobs[job.id]
                self._last_progress_at.pop(job.id, None)
            count = 0
            for status in _UNSUCCESSFUL_STATUSES:
                count += await JobDatabaseManager.clear_status_async(status)
        for job in doomed:
            try:
                await self._broadcast_job_event("job.deleted", job)
            except Exception as e:
                logger.error("Failed to broadcast clear for job %s: %s", job.id, e)
        return len(doomed)

    async def clear_dead(self) -> int:
        """Remove all dead-lettered jobs"""
        doomed: list[Job] = []
        async with self._lock:
            doomed = [j for j in self._jobs.values() if j.status == JobStatus.DEAD]
            for job in doomed:
                del self._jobs[job.id]
                self._last_progress_at.pop(job.id, None)
        # Also clear from database
        await JobDatabaseManager.clear_status_async(JobStatus.DEAD)
        for job in doomed:
            try:
                await self._broadcast_job_event("job.deleted", job)
            except Exception as e:
                logger.error("Failed to broadcast clear for job %s: %s", job.id, e)
        return len(doomed)

    async def _auto_cleanup_unlocked(self) -> list[Job]:
        """Auto-cleanup old terminal jobs (must be called under lock).

        Keeps the most recent half of terminal jobs once the cache exceeds
        ``_max_completed_cache``. Returns the evicted Job objects so the
        caller can retract them from clients after releasing the lock.
        """
        terminal_statuses = {
            JobStatus.COMPLETED,
            JobStatus.FAILED,
            JobStatus.CANCELLED,
            JobStatus.DEAD,
        }
        terminal_jobs = [
            j
            for j in self._jobs.values()
            if j.status in terminal_statuses and j.completed_at is not None
        ]
        terminal_jobs.sort(key=lambda j: j.completed_at)

        to_remove = terminal_jobs[: max(0, len(terminal_jobs) // 2)]
        # Capture ids first, then release lock pressure by deleting from DB in batch
        ids_to_delete = [j.id for j in to_remove]
        evicted = []
        for job in to_remove:
            if job.id in self._jobs:
                del self._jobs[job.id]
                self._last_progress_at.pop(job.id, None)
                evicted.append(job)

        if ids_to_delete:
            try:
                await JobDatabaseManager.delete_jobs_batch_async(ids_to_delete)
            except Exception as e:
                logger.error("Batch delete during auto-cleanup failed: %s", e)

        if evicted:
            logger.info("Auto-cleanup removed %d old terminal jobs", len(evicted))
        return evicted


# Global queue instance
queue_manager = QueueManager()
