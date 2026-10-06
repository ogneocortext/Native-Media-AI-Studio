"""Recovery of jobs stranded in RUNNING by a dead worker.

A job only enters RUNNING once a processor claims it. If that process dies —
restart, crash, force-kill — nothing ever transitions the job again: the
processor's handler timeout only fires while the process is alive and awaiting
that specific job. So the job sits in RUNNING forever, inflating the queue's
"active" count while nothing is running. This module's production symptom was 25
`image_generation` jobs stuck at progress 0.0 with `is_healthy: true`.

These tests build real Job objects and a minimal QueueManager; no database and
no processor loop is involved.
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
    age_seconds: float = 3600.0,
    retry_count: int = 0,
    max_retries: int = 3,
    status: JobStatus = JobStatus.RUNNING,
    params: dict | None = None,
) -> Job:
    started = datetime.now() - timedelta(seconds=age_seconds)
    return Job(
        id=job_id,
        job_type="image_generation",
        status=status,
        created_at=started - timedelta(seconds=5),
        started_at=started,
        progress=0.0,
        retry_count=retry_count,
        max_retries=max_retries,
        # A real job carries a prompt. Default to one so these tests exercise the
        # normal recovery path; pass params={} to test the unrunnable case.
        params={"prompt": "a test prompt"} if params is None else params,
    )


@pytest.fixture(autouse=True)
def _no_persistence(monkeypatch):
    """Keep recovery off the database and off SSE."""
    from app.queue import manager as mgr

    async def noop_update(*a, **k):
        return True

    monkeypatch.setattr(mgr.JobDatabaseManager, "update_job_async", noop_update)
    monkeypatch.setattr(mgr.JobDatabaseManager, "delete_job_async", noop_update)


class TestRecovery:
    def test_requeues_a_stranded_job_with_retries_left(self):
        m = _manager([_running_job()])
        out = asyncio.run(m.recover_stale_running_jobs())

        job = m._jobs["j1"]
        assert len(out["requeued"]) == 1
        assert job.status == JobStatus.QUEUED
        assert job.retry_count == 1
        assert job.progress == 0.0

    def test_clears_started_at_so_it_is_not_still_considered_running(self):
        m = _manager([_running_job()])
        asyncio.run(m.recover_stale_running_jobs())
        assert m._jobs["j1"].started_at is None

    def test_dead_letters_when_retries_are_exhausted(self):
        m = _manager([_running_job(retry_count=3, max_retries=3)])
        out = asyncio.run(m.recover_stale_running_jobs())

        assert out["dead"] == ["j1"]
        assert m._jobs["j1"].status == JobStatus.DEAD
        assert "retries exhausted" in m._jobs["j1"].error

    def test_leaves_a_recently_started_job_alone(self):
        """A worker may legitimately still be mid-flight when the loader runs."""
        m = _manager([_running_job(age_seconds=5)])
        out = asyncio.run(m.recover_stale_running_jobs())

        assert out["requeued"] == [] and out["dead"] == []
        assert out["skipped_fresh"] == ["j1"]
        assert m._jobs["j1"].status == JobStatus.RUNNING

    def test_ignores_non_running_jobs(self):
        done = _running_job(job_id="done", status=JobStatus.COMPLETED)
        m = _manager([done])
        out = asyncio.run(m.recover_stale_running_jobs())
        assert out["examined"] == 0
        assert done.status == JobStatus.COMPLETED

    def test_recovers_a_mixed_batch(self):
        m = _manager([
            _running_job(job_id="a"),
            _running_job(job_id="b"),
            _running_job(job_id="c", age_seconds=2),
            _running_job(job_id="d", retry_count=3, max_retries=3),
        ])
        out = asyncio.run(m.recover_stale_running_jobs())

        assert sorted(out["requeued"]) == ["a", "b"]
        assert out["dead"] == ["d"]
        assert out["skipped_fresh"] == ["c"]

    def test_is_a_noop_on_an_empty_queue(self):
        m = _manager([])
        out = asyncio.run(m.recover_stale_running_jobs())
        assert out == {
            "requeued": [],
            "dead": [],
            "unrecoverable": [],
            "skipped_fresh": [],
            "skipped_active": [],
            "examined": 0,
        }

    def test_age_threshold_is_configurable(self):
        m = _manager([_running_job(age_seconds=60)])
        # 10-minute default: too fresh, untouched.
        assert asyncio.run(m.recover_stale_running_jobs())["skipped_fresh"] == ["j1"]
        # A 30-second threshold evaluates it (no longer fresh-skipped), but the
        # progress lease still shelters it: 60 s of silence is inside the
        # default 900 s window, so age alone cannot reap it anymore (Q6).
        out = asyncio.run(m.recover_stale_running_jobs(30))
        assert out["skipped_fresh"] == []
        assert out["skipped_active"] == ["j1"]
        assert out["requeued"] == []


class TestStaleCount:
    def test_counts_only_ownerless_running_jobs(self):
        m = _manager([_running_job(age_seconds=7200), _running_job(job_id="b", age_seconds=2)])
        assert asyncio.run(m.count_stale_running_jobs()) == 1

    def test_counts_zero_when_nothing_is_stuck(self):
        m = _manager([_running_job(age_seconds=1)])
        assert asyncio.run(m.count_stale_running_jobs()) == 0

    def test_ignores_terminal_jobs(self):
        m = _manager([_running_job(status=JobStatus.COMPLETED)])
        assert asyncio.run(m.count_stale_running_jobs()) == 0


def test_recovery_does_not_deadlock_on_the_manager_lock():
    """The dead-letter path re-enters the queue lock.

    `_move_to_dead_letter` acquires `self._lock` itself, and an asyncio.Lock is
    not reentrant, so calling it while already holding the lock would hang the
    whole queue rather than raise. `asyncio.wait_for` turns that into a failure.
    """
    async def run():
        m = _manager([_running_job(retry_count=3, max_retries=3)])
        return await m.recover_stale_running_jobs()

    try:
        out = asyncio.run(asyncio.wait_for(run(), timeout=5))
    except asyncio.TimeoutError:
        pytest.fail("recover_stale_running_jobs deadlocked on _move_to_dead_letter")
    assert out["dead"] == ["j1"]


class TestUnrunnableJobs:
    """A job with no params cannot succeed, so it must not be retried.

    Every registered handler reads its input from `job.params` and hands it
    straight to an adapter, so `params == {}` means no prompt, no model and no
    input file. The live symptom was 21 queued `image_generation` jobs with
    empty params, several days old, cycling through the queue and spending their
    retry budget on failures that no retry could fix.
    """

    def test_is_runnable_rejects_empty_params(self):
        assert QueueManager.is_runnable(_running_job(params={})) is False

    def test_is_runnable_accepts_populated_params(self):
        assert QueueManager.is_runnable(_running_job()) is True

    def test_reaper_dead_letters_unrunnable_instead_of_requeueing(self):
        """Requeueing an unrunnable job just guarantees another failure.

        It has retries left, so the retry budget alone would requeue it forever.
        """
        m = _manager([_running_job(params={}, retry_count=0, max_retries=3)])
        out = asyncio.run(m.recover_stale_running_jobs())

        assert out["requeued"] == []
        assert out["dead"] == ["j1"]
        assert out["unrecoverable"] == ["j1"]
        # The retry counter must NOT advance on a job we know cannot run.
        assert m._jobs["j1"].retry_count == 0

    def test_quarantine_sweeps_queued_unrunnable_jobs(self):
        """The reaper only inspects RUNNING, so QUEUED needs its own sweep."""
        m = _manager(
            [
                _running_job("q1", status=JobStatus.QUEUED, params={}),
                _running_job("q2", status=JobStatus.QUEUED),  # runnable
            ]
        )
        out = asyncio.run(m.quarantine_unrunnable_jobs())

        assert out["quarantined"] == ["q1"]
        assert m._jobs["q1"].status == JobStatus.DEAD
        assert m._jobs["q2"].status == JobStatus.QUEUED

    def test_quarantine_leaves_runnable_jobs_untouched(self):
        m = _manager([_running_job("q2", status=JobStatus.QUEUED)])
        out = asyncio.run(m.quarantine_unrunnable_jobs())

        assert out["quarantined"] == []
        assert m._jobs["q2"].status == JobStatus.QUEUED

    def test_quarantine_does_not_deadlock(self):
        """Same re-entrancy hazard as the reaper's dead-letter path."""
        async def run():
            m = _manager([_running_job(status=JobStatus.QUEUED, params={})])
            return await m.quarantine_unrunnable_jobs()

        try:
            out = asyncio.run(asyncio.wait_for(run(), timeout=5))
        except asyncio.TimeoutError:
            pytest.fail("quarantine_unrunnable_jobs deadlocked on _move_to_dead_letter")
        assert out["quarantined"] == ["j1"]

    def test_unrunnable_job_dead_letters_with_a_reason(self):
        """The reason must say why, so this is not mistaken for a crash."""
        m = _manager([_running_job(params={})])
        asyncio.run(m.quarantine_unrunnable_jobs())
        err = m._jobs["j1"].error or ""
        assert "no params" in err
