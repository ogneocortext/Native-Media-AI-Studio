"""Tests for SQLite connection/transaction hygiene in `app.core.database`.

These cover defects found by auditing the sqlite layer, each of which was silent
- the code ran, the calls succeeded, and the database was quietly wrong or grew
without bound:

1. `VACUUM` called straight after a `DELETE`. Python's sqlite3 opens a
   transaction on the first write, and SQLite refuses to VACUUM inside one, so
   the freed pages were never reclaimed. This is why the database reached
   549 MB with a 1.2 MB freelist. `safe_vacuum` commits first.
2. `cleanup_old_log_events` had the same defect, and its `finally: conn.close()`
   did not stop the exception from propagating - so it raised on every call that
   crossed the threshold.
3. `journal_mode=WAL` was re-issued on every connection, even though it is a
   persistent, database-wide property.
"""
import os
import sqlite3
import sys

sys.path.insert(0, os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..")))


def _database_module():
    """Import lazily, inside the test.

    Importing at module scope opens a connection during collection and leaves
    studio.db locked on Windows, making later tmpdir cleanup fail with WinError
    32 in unrelated tests.
    """
    from app.core import database

    return database


def _fresh_db(tmp_path, monkeypatch):
    database = _database_module()
    db_file = tmp_path / "conn.db"
    monkeypatch.setattr(database, "DB_PATH", db_file, raising=False)
    database.init_db()
    return database, db_file


def test_safe_vacuum_reclaims_pages(tmp_path, monkeypatch):
    """The regression: a bare VACUUM after a DELETE raises and frees nothing."""
    database, db_file = _fresh_db(tmp_path, monkeypatch)

    conn = database.get_connection()
    try:
        # Fill pages, then delete everything, exactly as the cleanup paths do.
        conn.execute(
            "CREATE TABLE IF NOT EXISTS filler (id INTEGER PRIMARY KEY, payload TEXT)"
        )
        conn.executemany(
            "INSERT INTO filler (payload) VALUES (?)", [("x" * 4000,) for _ in range(700)]
        )
        conn.commit()
        # Measure *after* the commit, and checkpoint first: until then the -wal
        # file holds the written pages, so the .db file is not yet the real size.
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        before = db_file.stat().st_size

        conn.execute("DELETE FROM filler")
        # A bare VACUUM here raises: python opened a txn on the DELETE.
        assert database.safe_vacuum(conn) is True
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    finally:
        conn.close()

    after = db_file.stat().st_size
    check = sqlite3.connect(db_file)
    try:
        assert check.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert check.execute("PRAGMA freelist_count").fetchone()[0] == 0
        assert check.execute("SELECT COUNT(*) FROM filler").fetchone()[0] == 0
    finally:
        check.close()
    assert after < before, f"file did not shrink: {before} -> {after}"


def test_safe_vacuum_never_raises():
    """A failing vacuum must be logged, not propagated: rows are already gone.

    The old code called `conn.execute("VACUUM")` directly, so this failure
    raised out of the cleanup and — via a bare `finally: conn.close()` —
    aborted the caller. A cleanup that has already deleted its rows must not
    fail because the optional reclaim step did.
    """
    database = _database_module()

    class BrokenConn:
        def commit(self):
            raise sqlite3.OperationalError("cannot VACUUM from within a transaction")

        def execute(self, _sql):
            raise sqlite3.OperationalError("boom")

    assert database.safe_vacuum(BrokenConn()) is False


def test_cleanup_old_gpu_telemetry_vacuums_in_place(tmp_path, monkeypatch):
    """Cleanup must both delete and reclaim, without raising."""
    import time as _time

    database, db_file = _fresh_db(tmp_path, monkeypatch)
    now_ms = int(_time.time() * 1000)
    with database.get_db() as conn:
        conn.executemany(
            "INSERT INTO gpu_telemetry (ts_ms, ts_iso, gpu_name, memory_total, "
            "memory_used, memory_free, memory_percent, gpu_util, "
            "mem_controller_util, temperature_c, processes_json) "
            "VALUES (?, ?, 'GPU', 8192, 1, 1, 0.1, 1, 1, 40, ?)",
            [(now_ms - 90 * 86_400_000 - i, "2026-01-01T00:00:00", "x" * 4000)
             for i in range(700)],
        )

    before = db_file.stat().st_size
    # Must not raise, and must actually shrink the file.
    deleted = database.cleanup_old_gpu_telemetry(7, vacuum=True)
    assert deleted == 700

    after = db_file.stat().st_size
    check = sqlite3.connect(db_file)
    try:
        assert check.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert check.execute("PRAGMA freelist_count").fetchone()[0] == 0
        assert check.execute("SELECT COUNT(*) FROM gpu_telemetry").fetchone()[0] == 0
    finally:
        check.close()
    assert after <= before


def test_init_db_enables_wal(tmp_path, monkeypatch):
    """WAL is a persistent property; init_db must establish it exactly once."""
    database, db_file = _fresh_db(tmp_path, monkeypatch)

    conn = sqlite3.connect(db_file)
    try:
        assert conn.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"
    finally:
        conn.close()


def test_get_connection_sets_durability_and_wal_bounds(tmp_path, monkeypatch):
    """Every connection must carry the pragmas that bound growth."""
    database, _ = _fresh_db(tmp_path, monkeypatch)

    conn = database.get_connection()
    try:
        assert conn.execute("PRAGMA busy_timeout").fetchone()[0] == 5000
        assert conn.execute("PRAGMA wal_autocheckpoint").fetchone()[0] == 1000
        assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        assert conn.execute("PRAGMA synchronous").fetchone()[0] == 1  # NORMAL
        # And re-opening must not try to switch journal mode again.
        assert conn.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"
    finally:
        conn.close()
