"""Job-scoped log correlation.

A job outlives the request that created it: enqueue happens under a request id,
but claiming, the handler, retries and dead-lettering all run in the processor's
own context. Before this, `rg <job-id>` matched the enqueue line and nothing
after it, so a failure could not be followed - which is how 233 empty-params
`image_generation` rows became untraceable.

These tests assert the mechanism, not the formatting: that a job's id reaches
records logged while it runs, that it is restored afterwards, and that enqueue
logs the params fingerprint that makes a dropped-input bug visible at origin.
"""

import asyncio
import io
import logging

import pytest
from app.core.logging_config import (
    _JobIdFilter,
    get_job_id,
    job_context,
    set_job_id,
)


@pytest.fixture(autouse=True)
def _reset_job_id():
    """Isolate tests: ``set_job_id`` mutates a ContextVar in the caller's
    context, so without this a test that sets it leaks into the next one - which
    is exactly the class of bug ``job_context`` exists to prevent, and which this
    suite should not itself exhibit.
    """
    set_job_id("-")
    yield
    set_job_id("-")


def test_job_id_is_injected_into_records():
    f = _JobIdFilter()
    set_job_id("job-abc")
    rec = logging.LogRecord("t", logging.INFO, "f", 1, "msg", None, None)
    assert f.filter(rec) is True
    assert rec.job_id == "job-abc"


def test_default_is_dash():
    """Stable format for non-job lines rather than a random-looking gap.

    Each asyncio.run() gets its own context copy of the ContextVar, so this must
    observe the default regardless of what other tests set.
    """

    async def run():
        f = _JobIdFilter()
        rec = logging.LogRecord("t", logging.INFO, "f", 1, "m", None, None)
        f.filter(rec)
        return rec

    assert asyncio.run(run()).job_id == "-"


def test_context_restores_previous_value():
    """The processor runs many jobs in one task, so an id must not leak."""
    set_job_id("-")
    with job_context("job-one"):
        assert get_job_id() == "job-one"
        with job_context("job-two"):
            assert get_job_id() == "job-two"
        assert get_job_id() == "job-one"
    assert get_job_id() == "-"


def test_context_restores_on_exception():
    """A raising handler must not leave its id bound for the next job."""
    set_job_id("-")
    try:
        with job_context("job-boom"):
            raise ValueError("boom")
    except ValueError:
        pass
    assert get_job_id() == "-"


class TestEnqueueLogging:
    def test_enqueue_logs_params_fingerprint_and_warns_when_empty(self):
        """The 233 empty-params rows existed with nothing explaining them.

        Two properties matter: every enqueue records *which keys* were passed
        (so dropped input is visible at origin), and an empty dict produces a
        warning rather than a routine info line.
        """
        from app.models.job import JobCreateRequest, JobType
        from app.queue import manager as mgr
        from app.queue.manager import QueueManager

        m = QueueManager.__new__(QueueManager)
        m._jobs = {}
        m._lock = asyncio.Lock()
        m._subscribers = []
        m._new_job_event = asyncio.Event()

        async def noop(*a, **k):
            return None

        mgr.JobDatabaseManager.create_job_async = noop
        m._notify_subscribers = noop
        m._broadcast_job_event = noop
        m._signal_new_job = lambda: None

        buf = io.StringIO()
        h = logging.StreamHandler(buf)
        h.setFormatter(logging.Formatter("%(levelname)s|%(message)s"))
        # Attach to the manager's own logger, not a child: the child propagates
        # up, so a handler on the parent captures it.
        mgr_logger = mgr.logger
        prev_level = mgr_logger.level
        prev_prop = mgr_logger.propagate
        mgr_logger.addHandler(h)
        mgr_logger.setLevel(logging.INFO)
        mgr_logger.propagate = False

        req = JobCreateRequest(job_type=JobType.IMAGE_GENERATION, params={})
        asyncio.run(m.enqueue(req))
        out = buf.getvalue()

        mgr_logger.removeHandler(h)
        mgr_logger.setLevel(prev_level)
        mgr_logger.propagate = prev_prop

        assert "Job queued id=" in out
        assert "keys=[]" in out
        assert "NO params" in out, "an unrunnable job must be loud at origin"
