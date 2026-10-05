"""Tests for the cached Essentia tempo store and its background refresh.

The WSL bridge is monkeypatched throughout. That is the right seam here: these
tests are about *what the store does with the bridge's answer* - caching,
versioning, partial failure, concurrency - and not about Essentia itself, which
is a WSL concern tested in test_essentia_bridge.py.

What is NOT faked is the filesystem: each test points STORE_PATH at a tmp_path and
writes real JSON, because "the version guard discards a stale file" is a claim
about files, and asserting it against a mock would prove nothing.
"""

from __future__ import annotations

import json
import pathlib
import time

import pytest
from app.services import essentia_bridge
from app.services import essentia_tempo_store as store


@pytest.fixture
def tmp_store(tmp_path, monkeypatch):
    """Redirect the store to a temp file and reset in-memory job state."""
    path = tmp_path / "essentia-tempo.json"
    monkeypatch.setattr(store, "STORE_PATH", path)
    with store._lock:
        store._jobs.clear()
    return path


def _write(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


# ── storage and versioning ────────────────────────────────────────────────────


def test_missing_store_reads_as_empty(tmp_store):
    assert store.load_store() == {"cache_version": store.CACHE_VERSION, "tracks": {}}
    assert store.cached_bpm("anything") is None


def test_roundtrip(tmp_store):
    _write(tmp_store, {"cache_version": store.CACHE_VERSION,
                       "tracks": {"song": {"bpm": 120.5, "measured_at": 1000.0}}})
    assert store.cached_bpm("song") == 120.5
    assert store.cached_record("song")["measured_at"] == 1000.0


def test_stale_version_discards_the_file(tmp_store):
    """A schema change must not be served from records written under the old one."""
    _write(tmp_store, {"cache_version": store.CACHE_VERSION - 1,
                       "tracks": {"song": {"bpm": 120.5, "measured_at": 1.0}}})
    assert store.load_store()["tracks"] == {}
    assert store.cached_bpm("song") is None


def test_corrupt_file_reads_as_empty_not_an_exception(tmp_store):
    tmp_store.write_text("{not json", encoding="utf-8")
    assert store.load_store()["tracks"] == {}
    assert store.cached_bpm("song") is None


def test_save_writes_via_a_temp_file_then_replaces(tmp_store, monkeypatch):
    """The store must be published by rename, not written in place.

    A direct write truncates the live file first, so a crash or a full disk
    mid-write leaves a half-written JSON file - which the reader cannot tell from a
    corrupt one, and which would silently discard every cached tempo. Checking only
    that no `.tmp` is left behind does NOT test this: a plain write leaves no temp
    file either. So assert the rename actually happens.
    """
    replaced = []
    real_replace = pathlib.Path.replace

    def spy(self, target):
        replaced.append((self.name, pathlib.Path(target).name))
        return real_replace(self, target)

    monkeypatch.setattr(pathlib.Path, "replace", spy)
    store.save_store({"cache_version": store.CACHE_VERSION, "tracks": {}})
    assert replaced, "save_store must publish via Path.replace, not write in place"
    assert replaced[0][1] == tmp_store.name
    assert tmp_store.exists()
    assert not list(tmp_store.parent.glob("*.tmp"))


def test_a_failed_write_leaves_the_previous_store_intact(tmp_store, monkeypatch):
    """The reader must never observe a truncated store."""
    _write(tmp_store, {"cache_version": store.CACHE_VERSION,
                       "tracks": {"song": {"bpm": 120.5, "measured_at": 1.0}}})
    real_write_text = pathlib.Path.write_text

    def boom(self, *a, **k):
        if str(self).endswith(".tmp"):
            raise OSError("disk full")
        return real_write_text(self, *a, **k)

    monkeypatch.setattr(pathlib.Path, "write_text", boom)
    # save_store swallows OSError on purpose: a background refresh must not die
    # because the disk hiccuped, and the job should still report its measurement.
    store.save_store({"cache_version": store.CACHE_VERSION, "tracks": {}})
    assert store.cached_bpm("song") == 120.5, "a failed save must not destroy the old store"


def test_cached_bpm_ignores_a_non_numeric_value(tmp_store):
    _write(tmp_store, {"cache_version": store.CACHE_VERSION,
                       "tracks": {"song": {"bpm": "not-a-number"}}})
    assert store.cached_bpm("song") is None


def test_cached_bpm_never_touches_wsl(tmp_store, monkeypatch):
    """The request path calls this on every probe; it must not shell out to WSL."""
    def explode(*a, **k):
        raise AssertionError("cached_bpm must not call the bridge")

    monkeypatch.setattr(store.essentia_bridge, "is_available", explode)
    monkeypatch.setattr(store.essentia_bridge, "probe_batch", explode)
    assert store.cached_bpm("song") is None


# ── refresh: happy path ───────────────────────────────────────────────────────


def _patch_batch(monkeypatch, result, available=True):
    monkeypatch.setattr(store.essentia_bridge, "is_available", lambda: available)
    monkeypatch.setattr(store.stem_remixer, "essentia_bpm_batch", lambda tracks: result)


def _wait(job_id, timeout=10.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = store.get_job(job_id)
        if job and job["state"] != "running":
            return job
        time.sleep(0.02)
    raise AssertionError("job did not finish")


def test_refresh_persists_successes(tmp_store, monkeypatch):
    _patch_batch(monkeypatch, {"a": 120.0, "b": 140.0})
    started = store.start_refresh(["a", "b"])
    assert started["started"] is True
    job = _wait(started["job"]["job_id"])
    assert job["state"] == "done"
    assert sorted(job["succeeded"]) == ["a", "b"]
    assert store.cached_bpm("a") == 120.0
    assert store.cached_bpm("b") == 140.0


def test_partial_failure_keeps_the_successes(tmp_store, monkeypatch):
    """One track failing must not discard the tempos that did come back."""
    _patch_batch(monkeypatch, {"a": 120.0, "b": None, "c": 150.0})
    started = store.start_refresh(["a", "b", "c"])
    job = _wait(started["job"]["job_id"])
    assert job["state"] == "done"
    assert sorted(job["succeeded"]) == ["a", "c"]
    assert "b" in job["failed"]
    assert store.cached_bpm("a") == 120.0
    assert store.cached_bpm("b") is None, "a failed track must not be cached"


def test_track_never_submitted_is_skipped_not_failed(tmp_store, monkeypatch):
    """Absent from the batch result means no stem on disk, which is not an error."""
    _patch_batch(monkeypatch, {"a": 120.0})
    started = store.start_refresh(["a", "missing"])
    job = _wait(started["job"]["job_id"])
    assert job["skipped"] == ["missing"]
    assert job["failed"] == {}
    assert job["state"] == "done"


# ── refresh: bridge unavailable ───────────────────────────────────────────────


def test_unavailable_bridge_fails_fast_without_a_job_thread(tmp_store, monkeypatch):
    _patch_batch(monkeypatch, {}, available=False)
    started = store.start_refresh(["a"])
    assert started["started"] is False
    assert "unavailable" in started["reason"]
    assert started["job"]["state"] == "failed"


def test_empty_result_is_treated_as_bridge_unavailable(tmp_store, monkeypatch):
    """An empty batch result means WSL is down. Caching it would look like a
    measurement that found nothing, and would never be retried."""
    _patch_batch(monkeypatch, {})
    started = store.start_refresh(["a"])
    job = _wait(started["job"]["job_id"])
    assert job["state"] == "failed"
    assert "unavailable" in (job["error"] or "")
    assert not tmp_store.exists(), "nothing should be written when the bridge is down"


def test_cached_values_survive_a_failed_refresh(tmp_store, monkeypatch):
    _patch_batch(monkeypatch, {"a": 120.0})
    _wait(store.start_refresh(["a"])["job"]["job_id"])
    assert store.cached_bpm("a") == 120.0

    _patch_batch(monkeypatch, {})
    job = _wait(store.start_refresh(["a"])["job"]["job_id"])
    assert job["state"] == "failed"
    assert store.cached_bpm("a") == 120.0, "a failed refresh must not clear good data"


def test_batch_exception_is_reported_not_raised(tmp_store, monkeypatch):
    def boom(tracks):
        raise RuntimeError("wsl exploded")

    monkeypatch.setattr(store.essentia_bridge, "is_available", lambda: True)
    monkeypatch.setattr(store.stem_remixer, "essentia_bpm_batch", boom)
    job = _wait(store.start_refresh(["a"])["job"]["job_id"])
    assert job["state"] == "failed"
    assert "wsl exploded" in job["error"]


# ── concurrency and timeouts ──────────────────────────────────────────────────


def test_second_refresh_is_refused_while_one_runs(tmp_store, monkeypatch):
    release = {}

    def slow(tracks):
        while "go" not in release:
            time.sleep(0.01)
        return {"a": 120.0}

    monkeypatch.setattr(store.essentia_bridge, "is_available", lambda: True)
    monkeypatch.setattr(store.stem_remixer, "essentia_bpm_batch", slow)
    first = store.start_refresh(["a"])
    second = store.start_refresh(["a"])
    assert second["started"] is False
    assert "already running" in second["reason"]
    release["go"] = True
    _wait(first["job"]["job_id"])


def test_a_job_past_the_timeout_reports_failed(tmp_store, monkeypatch):
    """A wedged thread must still produce a terminal state for the UI."""
    monkeypatch.setattr(store, "REFRESH_TIMEOUT_SEC", 0.05)
    monkeypatch.setattr(store.essentia_bridge, "is_available", lambda: True)

    def never(tracks):
        time.sleep(30)
        return {}

    monkeypatch.setattr(store.stem_remixer, "essentia_bpm_batch", never)
    job = store.start_refresh(["a"])["job"]
    time.sleep(0.2)
    assert store.get_job(job["job_id"])["state"] == "failed"
    assert store.get_job(job["job_id"])["timed_out"] is True


def test_duplicate_tracks_are_measured_once(tmp_store, monkeypatch):
    seen = {}

    def capture(tracks):
        seen["tracks"] = tracks
        return {"a": 120.0}

    monkeypatch.setattr(store.essentia_bridge, "is_available", lambda: True)
    monkeypatch.setattr(store.stem_remixer, "essentia_bpm_batch", capture)
    _wait(store.start_refresh(["a", "a", "a"])["job"]["job_id"])
    assert seen["tracks"] == ["a"]


def test_bridge_is_actually_importable_for_monkeypatching():
    """Guards the monkeypatch seams above against a future import reshuffle."""
    assert hasattr(essentia_bridge, "is_available")
    assert hasattr(store, "essentia_bridge")
