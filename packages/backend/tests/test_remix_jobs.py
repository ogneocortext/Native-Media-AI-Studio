"""Tests for the remix job registry.

The work callables are stubbed throughout: these tests are about
what the registry does with a job's lifecycle - state transitions,
result capture, failure capture, the timeout report, the retention
cap - and not about rendering or mastering, which are tested where
the DSP lives. The filesystem is not faked either, because there
is none: the registry is deliberately in-memory (a job's results
are also on disk, so losing the record costs a re-poll, not data).
"""

from __future__ import annotations

import threading
import time

import pytest
from app.services import remix_jobs


@pytest.fixture
def clean_registry():
    """Isolate the in-memory registry between tests."""
    with remix_jobs._lock:
        remix_jobs._jobs.clear()
    yield
    with remix_jobs._lock:
        remix_jobs._jobs.clear()


def _await_state(job_id: str, state: str, timeout: float = 5.0) -> dict:
    """Poll a job until it reaches `state` (the thread is a daemon)."""
    deadline = time.time() + timeout
    status: dict | None = None
    while time.time() < deadline:
        status = remix_jobs.get_job(job_id)
        if status is not None and status["state"] == state:
            return status
        time.sleep(0.01)
    assert status is not None, f"job {job_id} vanished"
    return status


# ── lifecycle ─────────────────────────────────────────────────────────


def test_job_runs_to_completion_and_stores_result(clean_registry):
    job = remix_jobs.start_job("build", "mashup-1", lambda: {"name": "mashup-1"})

    status = _await_state(job["job_id"], "done")
    assert status["result"] == {"name": "mashup-1"}
    assert status["error"] is None
    assert status["kind"] == "build"
    assert status["label"] == "mashup-1"
    assert status["timed_out"] is False
    assert status["finished_at"] is not None
    assert status["elapsed_sec"] >= 0.0


def test_job_failure_is_captured_not_raised(clean_registry):
    def boom() -> dict:
        raise RuntimeError("stem vanished")

    job = remix_jobs.start_job("enhance", "mashup-1", boom)

    status = _await_state(job["job_id"], "failed")
    assert "RuntimeError" in (status["error"] or "")
    assert "stem vanished" in (status["error"] or "")
    assert status["result"] is None


def test_unknown_job_reads_as_none(clean_registry):
    assert remix_jobs.get_job("build-does-not-exist") is None


def test_latest_jobs_is_newest_first(clean_registry):
    first = remix_jobs.start_job("build", "first", dict)
    time.sleep(0.02)  # started_at must differ for the ordering to be real
    second = remix_jobs.start_job("enhance", "second", dict)

    jobs = remix_jobs.latest_jobs()
    assert [j["job_id"] for j in jobs][:2] == [second["job_id"], first["job_id"]]


# ── bounds ────────────────────────────────────────────────────────────


def test_wedged_job_is_reported_failed_not_running_forever(
    clean_registry, monkeypatch
):
    """A job past the timeout must not leave a poller waiting.

    The thread is still blocked in `work` (it waits on an event the
    test holds), yet the *reported* state is failed with `timed_out`
    set - the caller needs a terminal answer, which is the whole
    reason the cap exists.
    """
    release = threading.Event()
    job = remix_jobs.start_job("build", "wedged", lambda: release.wait(10))
    _await_state(job["job_id"], "running")

    monkeypatch.setattr(remix_jobs, "JOB_TIMEOUT_SEC", -1)
    status = remix_jobs.get_job(job["job_id"])
    assert status["state"] == "failed"
    assert status["timed_out"] is True

    release.set()  # let the daemon thread finish so the fixture can clean up


def test_registry_keeps_only_the_last_n_jobs(clean_registry, monkeypatch):
    monkeypatch.setattr(remix_jobs, "_KEEP_JOBS", 3)
    for index in range(5):
        remix_jobs.start_job("build", f"m{index}", dict)

    with remix_jobs._lock:
        assert len(remix_jobs._jobs) <= 3


def test_started_job_is_visible_before_it_runs(clean_registry):
    """The acknowledgement must exist the moment the caller gets it.

    A client that polls immediately after the POST has to find the
    job (as `queued` or `running`), not a 404.
    """
    release = threading.Event()
    job = remix_jobs.start_job("build", "slow", lambda: release.wait(10))
    try:
        status = remix_jobs.get_job(job["job_id"])
        assert status is not None
        assert status["state"] in {"queued", "running"}
    finally:
        release.set()
