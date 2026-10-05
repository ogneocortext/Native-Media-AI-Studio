"""Cached Essentia tempo results, refreshed in the background.

Essentia runs in WSL and is the most accurate tempo estimator available here
(`tempo_agreement` treats it as the primary authority), but one batch over the
seven-track library costs ~31 s. That rules out calling it from a dropdown, an
on-open probe, or any request path: a user waiting 31 s for a tempo number has
already learned the feature is broken.

So the split is:

- **Reads never touch WSL.** `cached_bpm()` is a dict lookup, which is why it is
  safe to call from `probe_track` on every request.
- **Writes happen in a background job** started by an explicit refresh action.
  `start_refresh()` returns immediately with a job id; the client polls `status()`.

Storage is its own file, separate from the librosa probe cache, and that is
deliberate. Essentia results cost ~31 s to produce and librosa results cost ~1 s,
so folding them into one cache would mean a schema bump throws away the cheap
measurements along with the expensive ones, or vice versa. Separate files also let
the two invalidate independently.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from pathlib import Path
from typing import Any

from ..core.config import OUTPUT_DIR
from . import essentia_bridge, stem_remixer

logger = logging.getLogger(__name__)

STORE_PATH = Path(OUTPUT_DIR) / "remixes" / ".probes" / "essentia-tempo.json"

# Bump when the stored record's shape changes. A mismatch discards the whole file
# rather than reading records whose fields may not mean what they used to.
CACHE_VERSION = 1

# How long a running job may take before it is abandoned. The measured batch is
# ~31 s; this is generous enough for a cold WSL start but bounded so a wedged job
# cannot leave the status endpoint reporting "running" forever.
REFRESH_TIMEOUT_SEC = 180


class _Job:
    """State of one background refresh. Mutated only under `_lock`."""

    def __init__(self, job_id: str, tracks: list[str]) -> None:
        self.id = job_id
        self.tracks = tracks
        self.started_at = time.time()
        self.finished_at: float | None = None
        self.state = "running"          # running | done | failed
        self.error: str | None = None
        self.succeeded: list[str] = []
        self.failed: dict[str, str] = {}
        self.skipped: list[str] = []    # never asked: no stem on disk

    def as_dict(self, now: float | None = None) -> dict[str, Any]:
        now = time.time() if now is None else now
        elapsed = (self.finished_at or now) - self.started_at
        # A job past the timeout is reported as failed even though its thread may
        # still be blocked in subprocess: the caller needs a terminal answer, and
        # leaving "running" here would wedge the UI's spinner indefinitely.
        timed_out = self.state == "running" and elapsed > REFRESH_TIMEOUT_SEC
        return {
            "job_id": self.id,
            "state": "failed" if timed_out else self.state,
            "timed_out": timed_out,
            "tracks": self.tracks,
            "succeeded": self.succeeded,
            "failed": self.failed,
            "skipped": self.skipped,
            "error": self.error,
            "elapsed_sec": round(elapsed, 2),
            "started_at": self.started_at,
            "finished_at": self.finished_at,
        }


_lock = threading.Lock()
_jobs: dict[str, _Job] = {}
_last_job_id = 0


# ── storage ───────────────────────────────────────────────────────────────────


def _empty() -> dict[str, Any]:
    return {"cache_version": CACHE_VERSION, "tracks": {}}


def load_store() -> dict[str, Any]:
    """Read the store. A missing, unreadable or stale-version file reads as empty.

    Returning empty rather than raising is what makes the WSL-unavailable case
    degrade quietly: callers see "no cached tempo" and fall back to the estimators
    that are always available.
    """
    if not STORE_PATH.exists():
        return _empty()
    try:
        data = json.loads(STORE_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("essentia tempo store unreadable at %s: %s", STORE_PATH, exc)
        return _empty()
    if not isinstance(data, dict):
        return _empty()
    if data.get("cache_version") != CACHE_VERSION:
        logger.info(
            "essentia tempo store version %s != %s; discarding",
            data.get("cache_version"),
            CACHE_VERSION,
        )
        return _empty()
    tracks = data.get("tracks")
    if not isinstance(tracks, dict):
        return _empty()
    return {"cache_version": CACHE_VERSION, "tracks": tracks}


def save_store(store: dict[str, Any]) -> None:
    """Persist the store atomically.

    Write-to-temp-then-replace, because a half-written JSON file is indistinguishable
    from a corrupt one to the reader and would silently discard every cached tempo.
    """
    try:
        STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = STORE_PATH.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(store, indent=2, sort_keys=True), encoding="utf-8")
        tmp.replace(STORE_PATH)
    except OSError as exc:
        logger.warning("could not persist essentia tempo store: %s", exc)


def cached_bpm(track: str) -> float | None:
    """Cached Essentia tempo for `track`, or None. Never touches WSL.

    This is the only function the request path is allowed to call.
    """
    record = load_store()["tracks"].get(track)
    if not isinstance(record, dict):
        return None
    value = record.get("bpm")
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def cached_record(track: str) -> dict[str, Any] | None:
    """Full stored record for `track`, including when it was measured."""
    record = load_store()["tracks"].get(track)
    return record if isinstance(record, dict) else None


def store_status() -> dict[str, Any]:
    """Summary for the UI: which tracks have an Essentia tempo and how old it is."""
    store = load_store()
    now = time.time()
    tracks = {}
    for name, record in store["tracks"].items():
        measured_at = record.get("measured_at") if isinstance(record, dict) else None
        age = None
        if isinstance(measured_at, (int, float)):
            age = round(now - float(measured_at), 1)
        tracks[name] = {
            "bpm": record.get("bpm") if isinstance(record, dict) else None,
            "measured_at": measured_at,
            "age_sec": age,
        }
    return {
        "cache_version": CACHE_VERSION,
        "bridge_available": essentia_bridge.is_available(),
        "count": len(tracks),
        "tracks": tracks,
        "job": latest_job(),
    }


# ── refresh ───────────────────────────────────────────────────────────────────


def _run_refresh(job: _Job) -> None:
    """Body of the background job. Runs in a daemon thread."""
    try:
        results = stem_remixer.essentia_bpm_batch(job.tracks)
        with _lock:
            if not results:
                # Empty means the bridge itself was unavailable (WSL stopped, venv
                # missing, timeout). Nothing is written: an empty cache entry would
                # be indistinguishable from "measured, found nothing".
                job.state = "failed"
                job.error = "essentia bridge unavailable (WSL, venv, or timeout)"
                return

            store = load_store()
            now = time.time()
            for track in job.tracks:
                if track not in results:
                    # Not submitted at all: no analysable stem on disk.
                    job.skipped.append(track)
                    continue
                bpm = results[track]
                if bpm is None:
                    job.failed[track] = "no tempo returned"
                    continue
                store["tracks"][track] = {
                    "bpm": round(float(bpm), 3),
                    "measured_at": now,
                }
                job.succeeded.append(track)
            save_store(store)
            job.state = "done"
            if job.failed and not job.succeeded:
                job.state = "failed"
                job.error = "every track failed"
    except Exception as exc:  # noqa: BLE001 - a background job must never die silently
        logger.exception("essentia refresh job failed")
        with _lock:
            job.state = "failed"
            job.error = f"{type(exc).__name__}: {exc}"


def start_refresh(tracks: list[str]) -> dict[str, Any]:
    """Kick off a background Essentia refresh and return immediately.

    Explicitly not synchronous: the measured batch is ~31 s, which is far too long
    to hold a request open, and blocking here would put that cost on whatever
    happened to call it. The caller polls `status()`.
    """
    global _last_job_id
    wanted = [t for t in dict.fromkeys(tracks) if t]
    with _lock:
        running = [j for j in _jobs.values() if j.state == "running"]
        if running:
            # One WSL call at a time. Two concurrent batches would contend for the
            # same venv and make both slower than running them in sequence.
            return {
                "started": False,
                "reason": "a refresh is already running",
                "job": running[-1].as_dict(),
            }
        _last_job_id += 1
        job = _Job(f"essentia-{_last_job_id}", wanted)
        _jobs[job.id] = job
        # Keep the last few so a client that polls after completion still finds it.
        if len(_jobs) > 8:
            for old in sorted(_jobs.values(), key=lambda j: j.started_at)[:-8]:
                _jobs.pop(old.id, None)

    if not essentia_bridge.is_available():
        # Fail fast with a clear reason rather than starting a thread that will
        # immediately discover the same thing.
        with _lock:
            job.state = "failed"
            job.finished_at = time.time()
            job.error = "essentia bridge unavailable (WSL or venv missing)"
        return {"started": False, "reason": job.error, "job": job.as_dict()}

    thread = threading.Thread(target=_run_refresh, args=(job,), daemon=True,
                              name=f"essentia-refresh-{job.id}")
    thread.start()
    return {"started": True, "reason": None, "job": job.as_dict()}


def latest_job() -> dict[str, Any] | None:
    with _lock:
        if not _jobs:
            return None
        return max(_jobs.values(), key=lambda j: j.started_at).as_dict()


def get_job(job_id: str) -> dict[str, Any] | None:
    with _lock:
        job = _jobs.get(job_id)
        return job.as_dict() if job else None
