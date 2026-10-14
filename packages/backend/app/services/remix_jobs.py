"""Background job tracking for remix build and enhance.

`/build` and `/enhance` are the two slow operations on the remix
surface: a render measured 7-23 s and a master ~60 s. Running them
inline held the request open for that long, which put a 300-600 s
fetch timeout on the caller and gave the client nothing to poll - no
job id, no progress, no way to tell a wedged render from a slow one.

Only `/tempo/refresh` had the job pattern (see `essentia_tempo_store`
for the original). This module gives build and enhance the same
treatment, deliberately mirroring that store's shape:

- **The registry is in-memory.** Jobs are ephemeral by design: their
  results are also on disk (the remix directory, the enhanced/
  directory), so a server restart losing a job record costs a re-poll,
  not data.
- **A wedged job cannot report "running" forever.** `JOB_TIMEOUT_SEC`
  is generous next to the measured runtimes but bounded, and a job
  past it is *reported* as failed even though its thread may still be
  blocked - the caller needs a terminal answer.
- **The work itself is a plain callable.** The endpoint decides what
  runs; this module only decides how it is tracked. That keeps the
  DSP in `stem_remixer` / `suno_enhancer` where it belongs (D15).
- **Cancellation is cooperative and race-free.** `start_job` hands the
  work a cancel token - a zero-argument callable the work polls where
  it can safely stop - and `request_cancel` flips it under the lock.
  A job is only cancellable while queued or running, so a cancel that
  arrives after completion is refused rather than silently ignored,
  and the token belongs to the job rather than to a closure the
  caller assembles, so no job id has to be guessed before the thread
  starts.
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from collections.abc import Callable
from typing import Any

from .stem_remixer import RemixCancelledError

logger = logging.getLogger(__name__)

# A build measured 7-23 s and an enhance ~60 s. The cap is generous
# enough for a cold cache but bounded so a wedged thread cannot leave
# the status endpoint reporting "running" forever.
JOB_TIMEOUT_SEC = 900

# How many finished jobs to remember. A client that polls after
# completion still finds its result; older records age out.
_KEEP_JOBS = 16


class _Job:
    """State of one background job. Mutated only under `_lock`."""

    def __init__(self, job_id: str, kind: str, label: str, cancellable: bool = True) -> None:
        self.id = job_id
        self.kind = kind  # "build" | "enhance"
        self.label = label  # human-readable subject, e.g. the remix name
        self.cancellable = cancellable
        self.started_at = time.time()
        self.finished_at: float | None = None
        self.state = "queued"  # queued | running | cancelling | done | failed | cancelled
        self.progress: str | None = None
        self.result: dict[str, Any] | None = None
        self.error: str | None = None
        # Set by `request_cancel`; the work polls it through the token
        # `start_job` hands it. Never mutated by the worker itself.
        self.cancel_requested = False

    def as_dict(self, now: float | None = None) -> dict[str, Any]:
        now = time.time() if now is None else now
        elapsed = (self.finished_at or now) - self.started_at
        # A job past the timeout is reported as failed even though its
        # thread may still be blocked: the caller needs a terminal
        # answer, and leaving "running" here would wedge a poller.
        # "cancelling" counts too - a cancel the work never observed is
        # exactly as wedged as a render that never finishes.
        timed_out = (
            self.state in ("queued", "running", "cancelling") and elapsed > JOB_TIMEOUT_SEC
        )
        return {
            "job_id": self.id,
            "kind": self.kind,
            "label": self.label,
            "cancellable": self.cancellable,
            "state": "failed" if timed_out else self.state,
            "timed_out": timed_out,
            "progress": self.progress,
            "result": self.result,
            "error": self.error,
            "elapsed_sec": round(elapsed, 2),
            "started_at": self.started_at,
            "finished_at": self.finished_at,
        }


_lock = threading.Lock()
_jobs: dict[str, _Job] = {}


def _register(job: _Job) -> None:
    with _lock:
        _jobs[job.id] = job
        if len(_jobs) > _KEEP_JOBS:
            for old in sorted(_jobs.values(), key=lambda j: j.started_at)[:-_KEEP_JOBS]:
                _jobs.pop(old.id, None)


def get_job(job_id: str) -> dict[str, Any] | None:
    """One job's status, or None when the id is unknown (or forgotten)."""
    with _lock:
        job = _jobs.get(job_id)
        return job.as_dict() if job else None


def latest_jobs(limit: int = 8) -> list[dict[str, Any]]:
    """Newest-first status of recent jobs, for a jobs overview."""
    with _lock:
        ordered = sorted(_jobs.values(), key=lambda j: j.started_at, reverse=True)
        return [j.as_dict() for j in ordered[:limit]]


def request_cancel(job_id: str) -> dict[str, Any] | None:
    """Ask a job to stop. None when the id is unknown.

    The returned dict is the job's status with one extra key:
    `cancel_accepted` says whether the request will actually stop
    anything. It is False for a job that already reached a terminal
    state, and for a job whose work polls no cancel token at all - a
    chain that runs inside one call has no safe point, and an accepted
    cancel it never observes would sit in "cancelling" until the
    timeout, which is a wedge dressed up as a feature.

    Accepted and observed are different things: this sets the token,
    and a cooperative worker stops the next time it polls it.
    """
    with _lock:
        job = _jobs.get(job_id)
        if job is None:
            return None
        accepted = job.cancellable and job.state in ("queued", "running")
        if accepted:
            job.cancel_requested = True
            job.state = "cancelling"
            job.progress = "cancelling"
        status = job.as_dict()
    status["cancel_accepted"] = accepted
    return status


def _run(job: _Job, work: Callable[[Callable[[], bool]], dict[str, Any]]) -> None:
    """Body of the background job. Runs in a daemon thread.

    The work receives a cancel token - a callable returning True once
    `request_cancel` has been called for this job - and is expected to
    stop at the next safe point, raising `RemixCancelledError` when it does.
    Work that cannot be interrupted simply never polls it.
    """
    def token() -> bool:
        return job.cancel_requested

    try:
        with _lock:
            job.state = "running"
            job.progress = "running"
        result = work(token)
        with _lock:
            job.state = "done"
            job.progress = None
            job.result = result
            job.finished_at = time.time()
    except RemixCancelledError:
        # A deliberate stop is not a failure, and it carries no error
        # message: the state is the answer.
        with _lock:
            job.state = "cancelled"
            job.progress = None
            job.error = None
            job.finished_at = time.time()
        logger.info("remix job %s (%s) cancelled", job.id, job.kind)
    except Exception as exc:  # noqa: BLE001 - a background job must never die silently
        logger.exception("remix job %s (%s) failed", job.id, job.kind)
        with _lock:
            job.state = "failed"
            job.progress = None
            job.error = f"{type(exc).__name__}: {exc}"
            job.finished_at = time.time()


def start_job(
    kind: str,
    label: str,
    work: Callable[[Callable[[], bool]], dict[str, Any]],
    cancellable: bool = True,
) -> dict[str, Any]:
    """Start `work` in a background thread and return the job immediately.

    `work` is called with this job's cancel token and returns the
    response payload as a plain dict, which the job stores as its
    result. It runs in a daemon thread, so a build or enhance
    outliving the server process is abandoned rather than blocking
    shutdown. To stop it, call `request_cancel` with the returned
    job's id; the work observes it the next time it polls, so pass
    `cancellable=False` for work that has no safe point to poll at.
    """
    job = _Job(f"{kind}-{uuid.uuid4().hex[:12]}", kind, label, cancellable=cancellable)
    _register(job)
    thread = threading.Thread(
        target=_run, args=(job, work), daemon=True, name=f"remix-job-{job.id}"
    )
    thread.start()
    return job.as_dict()
