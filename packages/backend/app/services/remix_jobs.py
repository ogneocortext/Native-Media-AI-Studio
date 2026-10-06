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
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from collections.abc import Callable
from typing import Any

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

    def __init__(self, job_id: str, kind: str, label: str) -> None:
        self.id = job_id
        self.kind = kind  # "build" | "enhance"
        self.label = label  # human-readable subject, e.g. the remix name
        self.started_at = time.time()
        self.finished_at: float | None = None
        self.state = "queued"  # queued | running | done | failed
        self.progress: str | None = None
        self.result: dict[str, Any] | None = None
        self.error: str | None = None

    def as_dict(self, now: float | None = None) -> dict[str, Any]:
        now = time.time() if now is None else now
        elapsed = (self.finished_at or now) - self.started_at
        # A job past the timeout is reported as failed even though its
        # thread may still be blocked: the caller needs a terminal
        # answer, and leaving "running" here would wedge a poller.
        timed_out = self.state in ("queued", "running") and elapsed > JOB_TIMEOUT_SEC
        return {
            "job_id": self.id,
            "kind": self.kind,
            "label": self.label,
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


def _run(job: _Job, work: Callable[[], dict[str, Any]]) -> None:
    """Body of the background job. Runs in a daemon thread."""
    try:
        with _lock:
            job.state = "running"
            job.progress = "running"
        result = work()
        with _lock:
            job.state = "done"
            job.progress = None
            job.result = result
            job.finished_at = time.time()
    except Exception as exc:  # noqa: BLE001 - a background job must never die silently
        logger.exception("remix job %s (%s) failed", job.id, job.kind)
        with _lock:
            job.state = "failed"
            job.progress = None
            job.error = f"{type(exc).__name__}: {exc}"
            job.finished_at = time.time()


def start_job(kind: str, label: str, work: Callable[[], dict[str, Any]]) -> dict[str, Any]:
    """Start `work` in a background thread and return the job immediately.

    `work` returns the response payload as a plain dict, which the job
    stores as its result. It runs in a daemon thread, so a build or
    enhance outliving the server process is abandoned rather than
    blocking shutdown.
    """
    job = _Job(f"{kind}-{uuid.uuid4().hex[:12]}", kind, label)
    _register(job)
    thread = threading.Thread(
        target=_run, args=(job, work), daemon=True, name=f"remix-job-{job.id}"
    )
    thread.start()
    return job.as_dict()
