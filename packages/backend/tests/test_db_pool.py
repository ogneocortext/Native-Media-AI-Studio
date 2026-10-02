"""Tests for the per-thread SQLite connection pool.

Pooling is only safe if a connection handed to one caller carries nothing into
the next. The property that matters is isolation, not speed:

* an uncommitted write from a failed caller must not be visible to the next one;
* a connection must be genuinely reused, or the pool is pointless;
* the pool must be bounded, and closable so the process does not exit holding
  Windows file handles that would block the database file from being replaced.
"""
import os
import sqlite3
import sys
import threading

import pytest

sys.path.insert(0, os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..")))


def _database_module():
    from app.core import database

    return database


def _fresh_db(tmp_path, monkeypatch):
    database = _database_module()
    db_file = tmp_path / "pool.db"
    monkeypatch.setattr(database, "DB_PATH", db_file, raising=False)
    # Start from an empty pool so cross-test state cannot leak in.
    database.close_pooled_connections()
    database.init_db()
    return database, db_file


def _pool_size(database):
    return len(getattr(database._local, "pool", []) or [])


def test_connection_is_actually_reused(tmp_path, monkeypatch):
    """A second get_db() must hand back the same connection object."""
    database, _ = _fresh_db(tmp_path, monkeypatch)

    with database.get_db() as first:
        pass
    with database.get_db() as second:
        pass

    assert first is second, "connection was not reused - pooling is pointless"
    assert _pool_size(database) == 1


def test_failed_write_does_not_leak_to_next_caller(tmp_path, monkeypatch):
    """The isolation property: a rolled-back write must not be visible later."""
    database, _ = _fresh_db(tmp_path, monkeypatch)

    with database.get_db() as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS leak (id INTEGER PRIMARY KEY)")

    # A caller that raises mid-write must not leave its row behind.
    with pytest.raises(RuntimeError):
        with database.get_db() as conn:
            conn.execute("INSERT INTO leak (id) VALUES (1)")
            raise RuntimeError("boom")

    with database.get_db() as conn:
        count = conn.execute("SELECT COUNT(*) FROM leak").fetchone()[0]
    assert count == 0, "an aborted write leaked into the next caller"


def test_successful_write_is_persisted(tmp_path, monkeypatch):
    """A committed write must be visible to a fresh connection outside the pool."""
    database, _ = _fresh_db(tmp_path, monkeypatch)

    with database.get_db() as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS keep (id INTEGER PRIMARY KEY)")
        conn.execute("INSERT INTO keep (id) VALUES (7)")

    raw = sqlite3.connect(str(database.DB_PATH))
    try:
        assert raw.execute("SELECT COUNT(*) FROM keep").fetchone()[0] == 1
    finally:
        raw.close()


def test_release_rolls_back_a_dangling_transaction(tmp_path, monkeypatch):
    """`release_connection` must not hand back a mid-transaction connection.

    `get_db()` rolls back on exception, so this path is only reachable when a
    caller uses `get_connection()` directly and returns early without
    committing. The next caller would otherwise inherit that uncommitted write.
    Removal of the rollback in `release_connection` must fail this test — the
    `get_db()`-based test above does not, because its own `except` already
    covers that case.
    """
    database, db_file = _fresh_db(tmp_path, monkeypatch)

    with database.get_db() as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS dangling (id INTEGER PRIMARY KEY)")

    # Caller forgets to commit, then releases.
    conn = database.get_connection()
    conn.execute("INSERT INTO dangling (id) VALUES (99)")
    assert conn.in_transaction, "expected an open transaction to test the guard"
    database.release_connection(conn)

    # The next borrower must not see the uncommitted row.
    with database.get_db() as next_conn:
        assert not next_conn.in_transaction, "a transaction leaked into the next caller"
        count = next_conn.execute("SELECT COUNT(*) FROM dangling").fetchone()[0]
    assert count == 0, "an uncommitted write survived into the next caller"


def test_pool_is_bounded(tmp_path, monkeypatch):
    """A runaway pattern must not grow the pool without limit."""
    database, _ = _fresh_db(tmp_path, monkeypatch)

    for _ in range(database.MAX_POOLED_CONNECTIONS + 5):
        conn = database.get_connection()
        database.release_connection(conn)

    assert _pool_size(database) <= database.MAX_POOLED_CONNECTIONS


def test_close_pooled_connections_empties_the_pool(tmp_path, monkeypatch):
    """Shutdown must release handles so Windows can replace the file."""
    database, _ = _fresh_db(tmp_path, monkeypatch)

    for _ in range(3):
        with database.get_db():
            pass
    assert _pool_size(database) >= 1

    closed = database.close_pooled_connections()
    assert closed >= 1
    assert _pool_size(database) == 0

    # With the pool empty the file is free for a fresh connection.
    probe = database.get_connection_unpooled()
    try:
        assert probe.execute("SELECT 1").fetchone()[0] == 1
    finally:
        probe.close()


def test_pool_is_per_thread(tmp_path, monkeypatch):
    """Each thread gets its own connection; one shared connection would serialise."""
    database, _ = _fresh_db(tmp_path, monkeypatch)

    seen: list[object] = []
    errors: list[Exception] = []

    def worker():
        try:
            with database.get_db() as conn:
                seen.append(conn)
        except Exception as exc:
            errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)

    assert not errors, errors
    assert len(seen) == 4
    # The main thread's pooled connection is distinct from the workers'.
    assert len({id(c) for c in seen}) > 1


def test_unpooled_connection_is_independent(tmp_path, monkeypatch):
    """Closing an unpooled connection must not corrupt the pool."""
    database, _ = _fresh_db(tmp_path, monkeypatch)

    conn = database.get_connection_unpooled()
    conn.execute("SELECT 1").fetchone()
    conn.close()

    with database.get_db() as pooled:
        assert pooled.execute("SELECT 1").fetchone()[0] == 1
