"""Regression tests for the job queue manager and processor fixes."""
from datetime import datetime

import pytest
import pytest_asyncio

from app.core import database as database_module
from app.models.job import Job, JobStatus, JobType
from app.queue.db_manager import JobDatabaseManager
from app.queue.manager import QueueManager
from app.queue.processor import JobProcessor


@pytest.fixture(autouse=True)
def temp_db(tmp_path, monkeypatch):
    """Point the database at a throwaway file for every test."""
    db_path = tmp_path / "test_studio.db"
    monkeypatch.setattr(database_module, "DB_PATH", db_path)
    database_module.init_db()
    return db_path


@pytest_asyncio.fixture
async def queue() -> QueueManager:
    return QueueManager()


def _make_job(job_type: JobType = JobType.IMAGE_GENERATION,
              created_at: datetime | None = None,
              **overrides) -> Job:
    job = Job(job_type=job_type, status=JobStatus.QUEUED)
    if created_at is not None:
        job.created_at = created_at
    for key, value in overrides.items():
        setattr(job, key, value)
    JobDatabaseManager.create_job(job)
    return job


@pytest.mark.asyncio
async def test_get_jobs_by_status_is_fifo(queue: QueueManager):
    """Queued jobs must be returned oldest-first regardless of insertion order."""
    newer = _make_job(created_at=datetime(2026, 1, 2))
    older = _make_job(created_at=datetime(2026, 1, 1))
    # Insert newest first to prove sorting is not insertion-ordered
    queue._jobs[newer.id] = newer
    queue._jobs[older.id] = older

    queued = await queue.get_jobs_by_status(JobStatus.QUEUED)

    assert [j.id for j in queued] == [older.id, newer.id]


@pytest.mark.asyncio
async def test_processor_retries_are_bounded(queue: QueueManager, monkeypatch):
    """A permanently-failing job must stop retrying at max_retries (no infinite loop)."""
    # The processor talks to the module-level singleton; route it to the test queue
    monkeypatch.setattr("app.queue.processor.queue_manager", queue)

    job = _make_job()
    queue._jobs[job.id] = job

    async def always_fails(_job: Job):
        raise RuntimeError("boom")

    processor = JobProcessor()
    processor.register_handler(JobType.IMAGE_GENERATION, always_fails)

    max_retries = job.max_retries
    # Run far more attempts than max_retries; a runaway loop would hang/fail here
    for _ in range(max_retries + 3):
        await processor._process_job(job)
        if job.status == JobStatus.FAILED:
            break

    assert job.status == JobStatus.FAILED
    assert job.retry_count == max_retries
    assert "boom" in (job.error or "")


@pytest.mark.asyncio
async def test_completed_overwrite_respects_cancellation(queue: QueueManager, monkeypatch):
    """A job cancelled while its handler runs must stay CANCELLED, not become COMPLETED."""
    monkeypatch.setattr("app.queue.processor.queue_manager", queue)

    job = _make_job()
    queue._jobs[job.id] = job

    async def cancel_during_run(running: Job):
        await queue.cancel_job(running.id)
        return {"ok": True}

    processor = JobProcessor()
    processor.register_handler(JobType.IMAGE_GENERATION, cancel_during_run)

    await processor._process_job(job)

    assert job.status == JobStatus.CANCELLED


@pytest.mark.asyncio
async def test_stats_counts_queued_and_retrying(queue: QueueManager):
    """QueueStats should report queued/retrying buckets in addition to the basics."""
    queued = _make_job(status=JobStatus.QUEUED)
    retrying = _make_job(status=JobStatus.RETRYING, retry_count=1)
    queue._jobs[queued.id] = queued
    queue._jobs[retrying.id] = retrying

    stats = await queue.get_stats()

    assert stats.queued == 1
    assert stats.retrying == 1
    assert stats.active_jobs == 2