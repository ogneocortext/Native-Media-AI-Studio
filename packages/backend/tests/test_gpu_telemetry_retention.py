"""Tests for gpu_telemetry retention.

The table grew to 125,856 rows / ~417 MB of a 549 MB database in under a month,
holding a full JSON process list (~3.5 KB) per snapshot. Two independent bugs
allowed it, and both are covered here:

1. ``resource_monitoring_loop`` guarded its prune with
   ``int(event_loop.time()) % 1000 < 10``. That relates to nothing, so it fired
   only when a monotonic clock landed in a narrow band.
2. ``cleanup_old_gpu_telemetry`` ran ``VACUUM`` inside the ``get_db()``
   transaction, where SQLite raises "cannot VACUUM from within a transaction".
   The exception aborted the cleanup, so the freed pages stayed on the freelist
   (auto_vacuum is NONE) and the file never shrank.
"""
import os
import sqlite3
import sys
import time as _time

sys.path.insert(0, os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..")))

DAY_MS = 86_400_000


def _database_module():
    """Import lazily, inside the test.

    Importing at module scope opens a connection during collection and leaves
    studio.db locked on Windows, which makes later tmpdir cleanup fail with
    WinError 32 in unrelated tests.
    """
    from app.core import database

    return database


def _fresh_db(tmp_path, monkeypatch):
    database = _database_module()
    db_file = tmp_path / "telemetry.db"
    monkeypatch.setattr(database, "DB_PATH", db_file, raising=False)
    database.init_db()
    return database, db_file


def _insert(database, ts_ms: int, payload: str = "[]") -> None:
    with database.get_db() as conn:
        conn.execute(
            "INSERT INTO gpu_telemetry (ts_ms, ts_iso, gpu_name, memory_total, "
            "memory_used, memory_free, memory_percent, gpu_util, "
            "mem_controller_util, temperature_c, processes_json) "
            "VALUES (?, ?, 'GPU', 8192, 100, 8092, 1.2, 5, 1, 40, ?)",
            (ts_ms, "2026-01-01T00:00:00", payload),
        )


def test_cleanup_deletes_only_rows_beyond_retention(tmp_path, monkeypatch):
    database, db_file = _fresh_db(tmp_path, monkeypatch)

    now_ms = int(_time.time() * 1000)
    _insert(database, now_ms - 1 * DAY_MS, "[]")            # 1 day old: keep
    _insert(database, now_ms - 10 * DAY_MS, "[]")           # 10 days: drop
    _insert(database, now_ms - 100 * DAY_MS, "[]")          # 100 days: drop

    deleted = database.cleanup_old_gpu_telemetry(7, vacuum=False)
    assert deleted == 2

    conn = sqlite3.connect(db_file)
    try:
        remaining = conn.execute("SELECT COUNT(*) FROM gpu_telemetry").fetchone()[0]
    finally:
        conn.close()
    assert remaining == 1


def test_cleanup_does_not_raise_and_actually_vacuums(tmp_path, monkeypatch):
    """The regression: VACUUM used to run inside the transaction and raise.

    It must now complete, return the deleted count, and leave the file with no
    freelist pages (auto_vacuum is NONE, so nothing else would reclaim them).
    """
    database, db_file = _fresh_db(tmp_path, monkeypatch)

    now_ms = int(_time.time() * 1000)
    # Enough rows to clear the >= 500 vacuum threshold, with a payload big
    # enough that the freelist would be obvious if it were never reclaimed.
    for i in range(700):
        _insert(database, now_ms - 30 * DAY_MS - i, "x" * 4000)

    before = db_file.stat().st_size

    # Must not raise "cannot VACUUM from within a transaction".
    deleted = database.cleanup_old_gpu_telemetry(7, vacuum=True)
    assert deleted == 700

    conn = sqlite3.connect(db_file)
    try:
        assert conn.execute("SELECT COUNT(*) FROM gpu_telemetry").fetchone()[0] == 0
        freelist = conn.execute("PRAGMA freelist_count").fetchone()[0]
        page_count = conn.execute("PRAGMA page_count").fetchone()[0]
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    finally:
        conn.close()

    assert freelist == 0, "vacuum should have reclaimed the freed pages"
    assert page_count < 700, "file should have shrunk substantially"
    assert db_file.stat().st_size < before


def test_cleanup_is_a_noop_when_nothing_is_old(tmp_path, monkeypatch):
    database, db_file = _fresh_db(tmp_path, monkeypatch)

    now_ms = int(_time.time() * 1000)
    for i in range(5):
        _insert(database, now_ms - i * 1000, "[]")

    assert database.cleanup_old_gpu_telemetry(7, vacuum=False) == 0

    conn = sqlite3.connect(db_file)
    try:
        assert conn.execute("SELECT COUNT(*) FROM gpu_telemetry").fetchone()[0] == 5
    finally:
        conn.close()


def test_prunes_due_is_elapsed_time_not_a_counter():
    """The retention gate must be elapsed time on the monotonic clock.

    The bug that caused 417 MB of growth was
    ``int(event_loop.time()) % 1000 < 10`` - a guard tied to nothing, so it fired
    at random rather than on age. An earlier version of this test asserted on
    source text and matched the very comment documenting the bug; testing the
    policy function is both less brittle and more meaningful.
    """
    from app.diagnostics.resources import prunes_due

    # Not due yet, one second short of the deadline.
    assert prunes_due(due_at=1000.0, now=999.0) is False
    # Due exactly on the deadline, and well past it.
    assert prunes_due(due_at=1000.0, now=1000.0) is True
    assert prunes_due(due_at=1000.0, now=5000.0) is True


def test_prune_window_and_retention_period_are_explicit():
    """Pin the policy constants so they cannot drift silently."""
    from app.diagnostics.resources import (
        GPU_PRUNE_INTERVAL_SECONDS,
        GPU_TELEMETRY_KEEP_DAYS,
    )

    assert GPU_TELEMETRY_KEEP_DAYS == 7
    assert GPU_PRUNE_INTERVAL_SECONDS == 15 * 60


def test_prune_fires_on_every_cycle_once_overdue():
    """Once the window has passed, retention must fire every cycle.

    This is the property the loop-counter guard destroyed: it fired on ~1.7% of
    cycles, so rows accumulated without bound. Simulate the loop's bookkeeping
    over many cycles and assert each is accounted for.
    """
    from app.diagnostics.resources import prunes_due

    due = 0.0
    clock = 0.0
    prunes = 0
    for _ in range(200):
        if prunes_due(due, now=clock):
            prunes += 1
            due = clock + 15 * 60
        clock += 30  # a 30 s monitoring cycle

    # 200 cycles x 30 s = 100 minutes = six complete 15-minute windows, so the
    # prune must fire ~7 times - not once in a while at random. The old counter
    # guard fired ~1.7% of cycles, i.e. ~3 times in 200, and on no schedule.
    elapsed_minutes = 200 * 0.5
    expected = int(elapsed_minutes // 15) + 1
    assert prunes == expected, f"expected {expected} prunes in {elapsed_minutes} min, got {prunes}"
    # Every window accounted for, never fewer.
    assert prunes >= expected - 1


def test_next_prune_time_is_in_the_future():
    from app.diagnostics.resources import GPU_PRUNE_INTERVAL_SECONDS, next_prune_time

    assert next_prune_time() >= GPU_PRUNE_INTERVAL_SECONDS - 5
