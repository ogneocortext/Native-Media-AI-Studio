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
    job = remix_jobs.start_job("build", "mashup-1", lambda _token: {"name": "mashup-1"})

    status = _await_state(job["job_id"], "done")
    assert status["result"] == {"name": "mashup-1"}
    assert status["error"] is None
    assert status["kind"] == "build"
    assert status["label"] == "mashup-1"
    assert status["timed_out"] is False
    assert status["finished_at"] is not None
    assert status["elapsed_sec"] >= 0.0


def test_job_failure_is_captured_not_raised(clean_registry):
    def boom(_token) -> dict:
        raise RuntimeError("stem vanished")

    job = remix_jobs.start_job("enhance", "mashup-1", boom)

    status = _await_state(job["job_id"], "failed")
    assert "RuntimeError" in (status["error"] or "")
    assert "stem vanished" in (status["error"] or "")
    assert status["result"] is None


def test_unknown_job_reads_as_none(clean_registry):
    assert remix_jobs.get_job("build-does-not-exist") is None


def test_latest_jobs_is_newest_first(clean_registry):
    first = remix_jobs.start_job("build", "first", lambda _token: {})
    time.sleep(0.02)  # started_at must differ for the ordering to be real
    second = remix_jobs.start_job("enhance", "second", lambda _token: {})

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
    job = remix_jobs.start_job("build", "wedged", lambda _token: release.wait(10))
    _await_state(job["job_id"], "running")

    monkeypatch.setattr(remix_jobs, "JOB_TIMEOUT_SEC", -1)
    status = remix_jobs.get_job(job["job_id"])
    assert status["state"] == "failed"
    assert status["timed_out"] is True

    release.set()  # let the daemon thread finish so the fixture can clean up


def test_registry_keeps_only_the_last_n_jobs(clean_registry, monkeypatch):
    monkeypatch.setattr(remix_jobs, "_KEEP_JOBS", 3)
    for index in range(5):
        remix_jobs.start_job("build", f"m{index}", lambda _token: {})

    with remix_jobs._lock:
        assert len(remix_jobs._jobs) <= 3


def test_started_job_is_visible_before_it_runs(clean_registry):
    """The acknowledgement must exist the moment the caller gets it.

    A client that polls immediately after the POST has to find the
    job (as `queued` or `running`), not a 404.
    """
    release = threading.Event()
    job = remix_jobs.start_job("build", "slow", lambda _token: release.wait(10))
    try:
        status = remix_jobs.get_job(job["job_id"])
        assert status is not None
        assert status["state"] in {"queued", "running"}
    finally:
        release.set()


# ── cancellation ───────────────────────────────────────────────────────


def test_cancelled_work_reports_cancelled_not_failed(clean_registry):
    """A deliberate stop is its own terminal state, not an error.

    The work polls the token exactly the way `render_remix` does and
    raises `RemixCancelledError`; the registry must land on `cancelled`
    with no error text, so a client can tell "the user stopped this"
    from "this broke".
    """
    from app.services.stem_remixer import RemixCancelledError

    started = threading.Event()

    def work(token) -> dict:
        started.set()
        while not token():
            time.sleep(0.005)
        raise RemixCancelledError("cancelled after 1 of 3 slots")

    job = remix_jobs.start_job("build", "slow", work)
    assert started.wait(2)

    status = remix_jobs.request_cancel(job["job_id"])
    assert status is not None and status["cancel_accepted"] is True
    assert status["state"] == "cancelling"

    final = _await_state(job["job_id"], "cancelled")
    assert final["state"] == "cancelled"
    assert final["error"] is None
    assert final["result"] is None
    assert final["finished_at"] is not None


def test_cancel_is_refused_for_work_with_no_safe_point(clean_registry):
    """An enhance cannot stop, so its cancel is refused, not accepted.

    A cancel the work never observes would sit in "cancelling" until
    the timeout reported it failed - a wedge dressed up as a feature.
    """
    release = threading.Event()
    job = remix_jobs.start_job(
        "enhance", "mastering", lambda _token: release.wait(10), cancellable=False
    )
    try:
        _await_state(job["job_id"], "running")
        status = remix_jobs.request_cancel(job["job_id"])
        assert status is not None
        assert status["cancel_accepted"] is False
        assert status["state"] == "running"  # unchanged, not "cancelling"
    finally:
        release.set()


def test_cancel_is_refused_once_the_job_is_terminal(clean_registry):
    """A finished job cannot be un-finished, and saying so beats silence."""
    job = remix_jobs.start_job("build", "quick", lambda _token: {"ok": True})
    _await_state(job["job_id"], "done")

    status = remix_jobs.request_cancel(job["job_id"])
    assert status is not None
    assert status["cancel_accepted"] is False
    assert status["state"] == "done"


def test_request_cancel_for_an_unknown_job_is_none(clean_registry):
    assert remix_jobs.request_cancel("build-nope") is None


def test_job_status_carries_whether_it_can_be_cancelled(clean_registry):
    """The client hides Cancel for work that would only earn a 409."""
    release = threading.Event()
    job = remix_jobs.start_job(
        "enhance", "mastering", lambda _token: release.wait(10), cancellable=False
    )
    try:
        status = remix_jobs.get_job(job["job_id"])
        assert status is not None
        assert status["cancellable"] is False
    finally:
        release.set()
