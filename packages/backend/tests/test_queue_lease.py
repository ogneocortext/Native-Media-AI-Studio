"""Progress-lease protection for the stale-job reaper (Q6).

D31's reaper reclaimed any RUNNING job older than 15 minutes, including a
legitimately long render still working in this process — it could not tell
"slow progress" from "no progress". The manager now keeps an in-memory
progress lease (``_last_progress_at``), refreshed by every successful touch
of a RUNNING job, and the reaper only reclaims jobs that are BOTH old AND
quiet past their type's window. The health count uses the same rule, so a
working long render no longer flips the queue to unhealthy.

These tests build real Job objects and a minimal QueueManager; no database
and no processor loop is involved. Time is controlled by backdating
``started_at`` and lease stamps, never by sleeping.
"""

import asyncio
from datetime import datetime, timedelta

import pytest
from app.models.job import Job, JobStatus
from app.queue.manager import QueueManager


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


def _running_job(
    job_id: str = "j1",
    job_type: str = "image_generation",
    age_seconds: float = 3600.0,
    lease_age_seconds: float | None = None,
    retry_count: int = 0,
    max_retries: int = 3,
) -> tuple[Job, float | None]:
    """An old RUNNING job plus an optional lease-stamp age for the fixture.

    Returns the job and the lease age to stamp (None = never reported, so the
    reaper falls back to started_at exactly like the old age rule).
    """
    started = datetime.now() - timedelta(seconds=age_seconds)
    job = Job(
        id=job_id,
        job_type=job_type,
        status=JobStatus.RUNNING,
        created_at=started - timedelta(seconds=5),
        started_at=started,
        progress=0.0,
        retry_count=retry_count,
        max_retries=max_retries,
        params={"prompt": "a test prompt"},
    )
    return job, lease_age_seconds


def _manager_with(job: Job, lease_age_seconds: float | None) -> QueueManager:
    m = _manager([job])
    if lease_age_seconds is not None:
        m._last_progress_at[job.id] = datetime.now() - timedelta(seconds=lease_age_seconds)
    return m


@pytest.fixture(autouse=True)
def _no_persistence(monkeypatch):
    """Keep recovery off the database and off SSE."""
    from app.queue import manager as mgr

    async def noop_update(*a, **k):
        return True

    monkeypatch.setattr(mgr.JobDatabaseManager, "update_job_async", noop_update)
    monkeypatch.setattr(mgr.JobDatabaseManager, "delete_job_async", noop_update)


class TestLeaseProtectsLiveWork:
    def test_progressing_old_job_is_not_reaped(self):
        """The Q6 symptom: 16 minutes old but reported a minute ago -> stays."""
        job, lease_age = _running_job(age_seconds=960, lease_age_seconds=60)
        m = _manager_with(job, lease_age)
        out = asyncio.run(m.recover_stale_running_jobs())

        assert out["requeued"] == [] and out["dead"] == []
        assert out["skipped_active"] == ["j1"]
        assert m._jobs["j1"].status == JobStatus.RUNNING

    def test_silent_old_job_is_still_reaped(self):
        """No lease stamp: falls back to started_at, i.e. the old age rule."""
        job, lease_age = _running_job(age_seconds=3600)
        m = _manager_with(job, lease_age)
        out = asyncio.run(m.recover_stale_running_jobs())

        assert out["requeued"] == ["j1"]
        assert m._jobs["j1"].status == JobStatus.QUEUED

    def test_stale_lease_is_reaped(self):
        """Lease older than the window is silence, not protection."""
        job, lease_age = _running_job(age_seconds=3600, lease_age_seconds=1000)
        m = _manager_with(job, lease_age)
        out = asyncio.run(m.recover_stale_running_jobs())

        assert out["requeued"] == ["j1"]

    def test_update_job_refreshes_the_lease(self):
        """The real method, not a stamp planted by hand: a progress tick
        through update_job must shelter the job from the next reaper pass."""
        job, _ = _running_job(age_seconds=960)
        m = _manager_with(job, None)

        async def run():
            await m.update_job("j1", progress=0.5, message="still rendering")
            return await m.recover_stale_running_jobs()

        out = asyncio.run(run())
        assert out["skipped_active"] == ["j1"]
        assert m._jobs["j1"].status == JobStatus.RUNNING

    def test_message_only_touch_refreshes_the_lease(self):
        """Long poll loops that only send heartbeats count as signs of life."""
        job, _ = _running_job(age_seconds=960)
        m = _manager_with(job, None)

        async def run():
            await m.update_job("j1", message="waiting on ComfyUI")
            return await m.recover_stale_running_jobs()

        out = asyncio.run(run())
        assert out["skipped_active"] == ["j1"]


class TestPerTypeWindows:
    def test_video_job_gets_a_longer_lease(self):
        """Silent 1000 s: past the default 900 s window but inside video's 1800 s."""
        job, lease_age = _running_job(
            job_id="v1", job_type="music_video", age_seconds=1000, lease_age_seconds=1000
        )
        m = _manager_with(job, lease_age)
        out = asyncio.run(m.recover_stale_running_jobs())

        assert out["skipped_active"] == ["v1"]
        assert m._jobs["v1"].status == JobStatus.RUNNING

    def test_video_lease_eventually_expires(self):
        job, lease_age = _running_job(
            job_id="v1", job_type="music_video", age_seconds=2000, lease_age_seconds=2000
        )
        m = _manager_with(job, lease_age)
        out = asyncio.run(m.recover_stale_running_jobs())

        assert out["requeued"] == ["v1"]

    def test_same_silence_reaps_a_default_type(self):
        """1000 s quiet reaps image_generation while sheltering music_video."""
        img, img_lease = _running_job(job_id="img", age_seconds=1000, lease_age_seconds=1000)
        vid, vid_lease = _running_job(
            job_id="vid", job_type="music_video", age_seconds=1000, lease_age_seconds=1000
        )
        m = _manager([img, vid])
        m._last_progress_at["img"] = datetime.now() - timedelta(seconds=img_lease)
        m._last_progress_at["vid"] = datetime.now() - timedelta(seconds=vid_lease)
        out = asyncio.run(m.recover_stale_running_jobs())

        assert out["requeued"] == ["img"]
        assert out["skipped_active"] == ["vid"]


class TestHealthCountAgrees:
    def test_progressing_long_job_is_not_counted_stranded(self):
        """The second Q6 symptom: health went red while jobs were in flight."""
        job, lease_age = _running_job(age_seconds=1000, lease_age_seconds=60)
        m = _manager_with(job, lease_age)
        assert asyncio.run(m.count_stale_running_jobs()) == 0

    def test_silent_long_job_is_counted_stranded(self):
        job, lease_age = _running_job(age_seconds=1000)
        m = _manager_with(job, lease_age)
        assert asyncio.run(m.count_stale_running_jobs()) == 1


class TestLeaseHygiene:
    def test_completing_a_job_drops_its_lease(self):
        job, lease_age = _running_job(age_seconds=960, lease_age_seconds=60)
        m = _manager_with(job, lease_age)

        async def run():
            await m.update_job("j1", status=JobStatus.COMPLETED, progress=1.0)

        asyncio.run(run())
        assert "j1" not in m._last_progress_at

    def test_claiming_a_job_stamps_the_lease(self):
        job, _ = _running_job(age_seconds=960)
        m = _manager_with(job, None)
        m._jobs["j1"].status = JobStatus.QUEUED

        async def run():
            await m.update_job("j1", status=JobStatus.RUNNING)

        asyncio.run(run())
        assert "j1" in m._last_progress_at
