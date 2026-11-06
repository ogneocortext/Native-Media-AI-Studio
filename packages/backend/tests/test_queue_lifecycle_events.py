"""Regression tests for queue lifecycle/statistics fixes.

Covers: terminal_jobs double-counting DEAD, the never-cleared
_new_job_event busy-spin, RETRYING cancellability, job.deleted /
job.retrying SSE events, and the processing_rate_per_min unit error.
"""

from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timedelta
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.models.job import Job, JobStatus, QueueStats  # noqa: E402
from app.queue.manager import QueueManager  # noqa: E402


def _manager(jobs):
    m = QueueManager.__new__(QueueManager)
    m._jobs = {j.id: j for j in jobs}
    m._lock = asyncio.Lock()
    m._running_job = None
    m._processing = False
    m._subscribers = []
    m._new_job_event = asyncio.Event()
    m._completed_count = 0
    m._max_completed_cache = 100
    m._last_progress_at = {}
    return m


def _job(job_id: str, status: JobStatus, **kw) -> Job:
    return Job(
        id=job_id,
        job_type="image_generation",
        status=status,
        params={"prompt": "x"},
        **kw,
    )


@pytest.fixture(autouse=True)
def _no_persistence(monkeypatch):
    from app.queue import manager as mgr

    async def noop_update(*a, **k):
        return True

    async def noop_delete(*a, **k):
        return True

    monkeypatch.setattr(mgr.JobDatabaseManager, "update_job_async", noop_update)
    monkeypatch.setattr(mgr.JobDatabaseManager, "delete_job_async", noop_delete)
    monkeypatch.setattr(mgr.JobDatabaseManager, "delete_jobs_batch_async", noop_delete)


class TestTerminalJobs:
    def test_dead_is_not_double_counted(self):
        """failed already includes DEAD; terminal must not add it again."""
        stats = QueueStats(
            total_jobs=4,
            completed=1,
            failed=2,   # FAILED + DEAD (dead is a subset of failed)
            dead=1,
            cancelled=1,
        )
        assert stats.terminal_jobs == 4
        assert stats.success_rate == 25.0


class TestWaitForJobsEvent:
    @pytest.mark.asyncio
    async def test_stale_set_event_does_not_busy_spin(self):
        """After an enqueue sets the event, the next idle wait must block.

        Regression: the event was never cleared, so every wait_for_jobs
        call after the first enqueue returned instantly and the processor
        busy-looped on get_jobs_by_status.
        """
        m = _manager([])
        m._signal_new_job()  # simulate a previous enqueue
        assert m._new_job_event.is_set()

        # First wait consumes (clears) the stale signal and times out.
        assert await m.wait_for_jobs(timeout=0.05) is False
        assert not m._new_job_event.is_set()

        # A fresh signal still wakes the wait.
        async def signal():
            await asyncio.sleep(0.02)
            m._signal_new_job()

        task = asyncio.create_task(signal())
        assert await m.wait_for_jobs(timeout=1.0) is True
        await task


class TestCancelRetrying:
    @pytest.mark.asyncio
    async def test_retrying_job_can_be_cancelled(self):
        m = _manager([_job("r1", JobStatus.RETRYING)])
        assert await m.cancel_job("r1") is True
        assert m._jobs["r1"].status == JobStatus.CANCELLED

    def test_can_cancel_includes_retrying(self):
        assert _job("r", JobStatus.RETRYING).can_cancel is True
        assert _job("d", JobStatus.DEAD).can_cancel is False


class TestLifecycleEvents:
    @pytest.mark.asyncio
    async def test_delete_job_broadcasts_job_deleted(self):
        m = _manager([_job("d1", JobStatus.COMPLETED)])
        events: list[str] = []

        async def fake_broadcast(event_type, job, priority="medium"):
            events.append(event_type)

        m._broadcast_job_event = fake_broadcast  # type: ignore[method-assign]
        assert await m.delete_job("d1") is True
        assert "job.deleted" in events
        assert "d1" not in m._jobs

    @pytest.mark.asyncio
    async def test_delete_missing_job_returns_false_no_event(self):
        m = _manager([])
        events: list[str] = []

        async def fake_broadcast(event_type, job, priority="medium"):
            events.append(event_type)

        m._broadcast_job_event = fake_broadcast  # type: ignore[method-assign]
        assert await m.delete_job("nope") is False
        assert events == []

    @pytest.mark.asyncio
    async def test_update_to_retrying_broadcasts_job_retrying(self):
        m = _manager([_job("t1", JobStatus.RUNNING)])
        events: list[str] = []

        async def fake_broadcast(event_type, job, priority="medium"):
            events.append(event_type)

        m._broadcast_job_event = fake_broadcast  # type: ignore[method-assign]
        await m.update_job("t1", status=JobStatus.RETRYING, progress=0.0)
        assert "job.retrying" in events


class TestProcessingRate:
    @pytest.mark.asyncio
    async def test_processing_rate_is_per_minute_not_per_second(self):
        """recent_completed counts jobs in a 60 s window - that IS the
        per-minute rate. Dividing by 60 under-reported by 60x."""
        now = datetime.now()
        done = _job(
            "c1",
            JobStatus.COMPLETED,
            created_at=now - timedelta(seconds=40),
            started_at=now - timedelta(seconds=30),
            completed_at=now - timedelta(seconds=10),
        )
        m = _manager([done])
        metrics = await m.get_metrics()
        # One completion inside the 60 s window -> 1 job/min, not 0.02.
        assert metrics["processing_rate_per_min"] == 1.0


class TestTtlExpiry:
    @pytest.mark.asyncio
    async def test_expire_old_terminal_jobs_removes_only_old_terminal(self):
        now = datetime.now()
        old_done = _job(
            "old",
            JobStatus.COMPLETED,
            created_at=now - timedelta(days=8),
            completed_at=now - timedelta(days=8),
        )
        new_done = _job(
            "new",
            JobStatus.COMPLETED,
            created_at=now - timedelta(hours=1),
            completed_at=now - timedelta(hours=1),
        )
        old_active = _job(
            "act",
            JobStatus.QUEUED,
            created_at=now - timedelta(days=30),
        )
        old_no_completed = _job(
            "nc",
            JobStatus.DEAD,
            created_at=now - timedelta(days=30),
            completed_at=None,
        )
        m = _manager([old_done, new_done, old_active, old_no_completed])

        removed = await m.expire_old_terminal_jobs(ttl_seconds=604800)

        assert removed == 1
        assert "old" not in m._jobs
        assert "new" in m._jobs
        assert "act" in m._jobs
        # DEAD with no completed_at is kept - there is no timestamp to age it by.
        assert "nc" in m._jobs
