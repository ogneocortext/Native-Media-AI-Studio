"""
Tests for the event-driven queue processor fix:
- QueueManager uses asyncio.Event to signal new jobs
- JobProcessor waits on the event instead of busy-polling
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

import pytest

from app.models.job import JobCreateRequest, Job, JobStatus, JobType
from app.queue.manager import QueueManager
from app.queue.processor import JobProcessor


@pytest.mark.asyncio
async def test_queue_manager_signals_new_job():
    """enqueue() must set the event so the processor wakes up."""
    qm = QueueManager()
    qm._jobs.clear()

    event_set_before = qm._new_job_event.is_set()
    await qm.enqueue(
        JobCreateRequest(job_type=JobType.IMAGE_GENERATION, params={})
    )
    event_set_after = qm._new_job_event.is_set()

    assert not event_set_before, "Event should start cleared"
    assert event_set_after, "Event must be set after enqueue() so processor wakes"


@pytest.mark.asyncio
async def test_wait_for_jobs_times_out_when_no_signal():
    """wait_for_jobs() should return False on timeout, not hang."""
    qm = QueueManager()
    qm._jobs.clear()
    qm._new_job_event.clear()

    result = await qm.wait_for_jobs(timeout=0.1)

    assert result is False, "wait_for_jobs should return False on timeout"


@pytest.mark.asyncio
async def test_wait_for_jobs_returns_true_when_signaled():
    """wait_for_jobs() should return True when the event is set."""
    qm = QueueManager()
    qm._jobs.clear()

    async def signal_later():
        await asyncio.sleep(0.05)
        qm._signal_new_job()

    task = asyncio.create_task(signal_later())
    result = await qm.wait_for_jobs(timeout=1.0)
    await task

    assert result is True, "wait_for_jobs should return True when signaled"


@pytest.mark.asyncio
async def test_processor_loop_uses_event_wait():
    """Processor._process_loop must use wait_for_jobs, not busy-polling."""
    from app.queue import manager as manager_module
    from app.queue import processor as processor_module

    qm = QueueManager()
    qm._jobs.clear()

    wait_calls: list[float | None] = []

    async def fake_wait_for_jobs(timeout=None):
        wait_calls.append(timeout)
        await asyncio.sleep(0)  # yield control so stop_soon can run
        return False

    qm.wait_for_jobs = fake_wait_for_jobs  # type: ignore[method-assign]

    # Patch the module-level singleton so the processor uses our qm
    original_qm = processor_module.queue_manager
    processor_module.queue_manager = qm
    try:
        processor = JobProcessor()
        processor._running = True

        async def stop_soon():
            await asyncio.sleep(0.05)
            processor._running = False

        with patch.object(processor, "_process_job", new_callable=AsyncMock):
            await asyncio.gather(
                processor._process_loop(),
                stop_soon(),
            )

        # Must have called wait_for_jobs (event-driven), not just get_jobs_by_status in a tight loop
        assert len(wait_calls) >= 1, "Processor should wait for jobs via event"
    finally:
        processor_module.queue_manager = original_qm
