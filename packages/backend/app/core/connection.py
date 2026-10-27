"""
SQLite database connection management and session handling.

Extracted from packages/backend/app/core/database.py (was 4121 lines).
Manages the connection pool, thread-local storage, and the `get_db()` context
manager used by ~113 call sites across the codebase.

The database path is configurable via the ``NMA_DB_PATH`` environment variable,
which lets a home-server operator move studio.db onto a different drive
(e.g. a larger HDD) without editing code. When unset it defaults to
``<PROJECT_ROOT>/storage/studio.db``.
"""

from __future__ import annotations

import asyncio
import os
import sqlite3
import threading
from collections.abc import Generator
from contextlib import asynccontextmanager, contextmanager
from pathlib import Path

from .config import PROJECT_ROOT


# ---------------------------------------------------------------------------
# Database path — configurable for home-server deployments
# ---------------------------------------------------------------------------
def _resolve_db_path() -> Path:
    """Resolve the SQLite database file path.

    ``NMA_DB_PATH`` takes precedence; otherwise fall back to
    ``<PROJECT_ROOT>/storage/studio.db``. The parent directory is created
    lazily by :func:`_open_connection`, not here.
    """
    env = os.environ.get("NMA_DB_PATH")
    if env:
        return Path(env)
    return PROJECT_ROOT / "storage" / "studio.db"


DB_PATH = _resolve_db_path()

# Database schema version for migrations
SCHEMA_VERSION = 19

# ---------------------------------------------------------------------------
# Connection-level PRAGMAs
# ---------------------------------------------------------------------------

# `journal_mode=WAL` is *not* set here. It is persistent and database-wide, so
# re-issuing it per connection is redundant work and can itself fail with
# "database is locked" while readers are active. `init_db` establishes it once,
# before any other connection exists.

# `synchronous=NORMAL` is the standard companion to WAL: still crash-safe for
# the process, without an fsync on every commit. This process commits a
# telemetry row every 30 seconds, so FULL's fsync cost buys nothing.

# `wal_autocheckpoint` bounds the `-wal` file during runtime. On a home server
# that runs for days between restarts, 1000 pages (~4 MB) keeps the WAL file
# from growing without bound.

# `temp_store=MEMORY` keeps temporary tables and indices in memory instead of
# writing them to a separate -temp file, which is pure win on a local server.

# `cache_size` is negative, meaning KiB. -20000 = ~20 MB cache, well within
# the 8 GB VRAM/system RAM budget of this machine.

# `mmap_size` enables memory-mapped I/O for reads (256 MB). On Windows this
# helps sequential scans of large tables (log_events, gpu_telemetry).

# `journal_size_limit` bounds how large the WAL can grow before SQLite forces
# a checkpoint (64 MB). Prevents runaway growth if a long transaction stalls.

_PRAGMAS = (
    "PRAGMA foreign_keys=ON",
    "PRAGMA busy_timeout=5000",
    "PRAGMA synchronous=NORMAL",
    "PRAGMA wal_autocheckpoint=1000",
    "PRAGMA temp_store=MEMORY",
    "PRAGMA cache_size=-20000",
    "PRAGMA mmap_size=268435456",
    "PRAGMA journal_size_limit=67108864",
)

BUSY_TIMEOUT_MS = 5000


def _open_connection() -> sqlite3.Connection:
    """Open a fresh connection and apply every connection-level PRAGMA.

    This is the single place a connection is created, so the PRAGMAs are applied
    exactly once per connection rather than repeated (and possibly forgotten) at
    each of the ~113 `get_db()` call sites.
    """
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(
        DB_PATH,
        check_same_thread=False,
        detect_types=sqlite3.PARSE_DECLTYPES,
    )
    conn.row_factory = sqlite3.Row
    for pragma in _PRAGMAS:
        conn.execute(pragma)
    return conn


# Connections are pooled per thread. Two reasons this cannot be one shared
# connection:
#   * `asyncio.to_thread` appears at 61 call sites, so concurrent DB work really
#     does run on several threads at once. sqlite3 serialises a connection with
#     an internal lock, so sharing one would turn every query into a contention
#     point.
#   * `check_same_thread=False` permits cross-thread use but does not make
#     *concurrent* use safe.
# A per-thread pool keeps each connection single-threaded in practice while
# still removing the per-query open/close cost, measured at ~1.37 ms versus
# ~0.006 ms for reuse.
_local = threading.local()

# Safety valve. asyncio's default thread pool is bounded, but a runaway nested
# to_thread pattern should not be able to grow the pool without limit.
MAX_POOLED_CONNECTIONS = 16


def get_connection() -> sqlite3.Connection:
    """Get a pooled connection. Prefer `get_db()`.

    The connection is *not* owned by the caller: it may carry state from previous
    use and is returned to the pool rather than closed. Callers that must own and
    close a connection should use `get_connection_unpooled()`.

    A pooled connection is only reused while `DB_PATH` is unchanged. `DB_PATH` is
    reassigned in tests (and by tooling that points at a different database), and
    a connection opened against the old file would otherwise keep serving it -
    producing "no such table" errors against a database that was never created.
    """
    pool: list[sqlite3.Connection] | None = getattr(_local, "pool", None)
    path_key: object = getattr(_local, "path_key", None)
    current = str(DB_PATH)

    if pool is not None and path_key is not None and path_key != current:
        # The target database changed underneath us: drop the old connections
        # rather than hand them to a caller expecting the new file.
        while pool:
            try:
                pool.pop().close()
            except sqlite3.Error:
                pass
        pool = None
        path_key = None

    if pool is None:
        pool = []
        _local.pool = pool
        _local.path_key = current

    while pool:
        conn = pool.pop()
        # A pooled connection can also be invalidated by the file being replaced
        # under it. Verify before handing it out.
        try:
            conn.execute("SELECT 1").fetchone()
        except sqlite3.Error:
            try:
                conn.close()
            except sqlite3.Error:
                pass
            continue
        return conn

    return _open_connection()


def get_connection_unpooled() -> sqlite3.Connection:
    """Open a dedicated connection the caller must close.

    Needed when a connection must outlive the `get_db()` block, or must be closed
    at a specific point (startup migrations, compaction).
    """
    return _open_connection()


def release_connection(conn: sqlite3.Connection) -> None:
    """Return a connection to this thread's pool, or close it if the pool is full."""
    pool: list[sqlite3.Connection] | None = getattr(_local, "pool", None)
    if pool is None:
        pool = []
        _local.pool = pool
        _local.path_key = str(DB_PATH)

    # Never hand back a connection mid-transaction: the next caller would inherit
    # an uncommitted write.
    try:
        if conn.in_transaction:
            conn.rollback()
    except sqlite3.Error:
        try:
            conn.close()
        except sqlite3.Error:
            pass
        return

    if len(pool) < MAX_POOLED_CONNECTIONS:
        pool.append(conn)
        return
    try:
        conn.close()
    except sqlite3.Error:
        pass


def close_pooled_connections() -> int:
    """Close every connection pooled by the current thread. Returns the count.

    Called on shutdown so the process does not exit holding file handles, which
    on Windows would block the file being replaced.
    """
    pool: list[sqlite3.Connection] | None = getattr(_local, "pool", None)
    if not pool:
        return 0
    closed = 0
    while pool:
        try:
            pool.pop().close()
            closed += 1
        except sqlite3.Error:
            pass
    # Reset the key too, so a stale path cannot suppress reuse of a fresh pool.
    _local.path_key = str(DB_PATH)
    return closed


def checkpoint_wal(mode: str = "TRUNCATE") -> int | None:
    """Checkpoint the WAL file and return [busy, log, checkpointed] pages.

    Calling this on a clean shutdown keeps the `-wal` file from growing between
    restarts on a long-running home server. `mode` is one of PASSIVE, FULL,
    RESTART, or TRUNCATE (default). Returns None if the checkpoint could not
    run (e.g. a reader holds the file).
    """
    try:
        with get_db() as conn:
            row = conn.execute(f"PRAGMA wal_checkpoint({mode})").fetchone()
            if row:
                return row[1]  # log frames checkpointed
    except sqlite3.Error:
        return None
    return None


@contextmanager
def get_db() -> Generator[sqlite3.Connection, None, None]:
    """Context manager yielding a pooled connection.

    Commit on success, roll back on error, then return the connection to the
    pool. Semantics match the previous open/close-per-call version; only the
    connection lifecycle changed. Because connections are reused, the rollback in
    `release_connection` is what keeps one caller's uncommitted work from leaking
    into the next. `VACUUM` still cannot run inside a transaction - use
    `safe_vacuum()`.
    """
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        release_connection(conn)


@asynccontextmanager
async def async_get_db():
    """Async context manager yielding a pooled SQLite connection.

    Wraps :func:`get_db` in :func:`asyncio.to_thread` so synchronous SQLite
    I/O does not block the FastAPI event loop when called from ``async def``
    endpoints. Usage::

        async with async_get_db() as conn:
            conn.execute("SELECT 1").fetchone()
    """
    conn = None
    try:
        conn = await asyncio.to_thread(get_connection)
        yield conn
        await asyncio.to_thread(conn.commit)
    except Exception:
        if conn is not None:
            await asyncio.to_thread(conn.rollback)
        raise
    finally:
        if conn is not None:
            await asyncio.to_thread(release_connection, conn)


def run_db_sync(func, *args, **kwargs):
    """Run a synchronous database function in a thread pool.

    Use this for one-off DB operations inside async endpoints when you don't
    need a context manager::

        row = await run_db_sync(conn.execute, "SELECT 1").fetchone()

    Prefer :func:`async_get_db` for multi-statement transactions.
    """
    return asyncio.to_thread(func, *args, **kwargs)


def safe_vacuum(conn: sqlite3.Connection) -> bool:
    """Run VACUUM on an already-open connection outside any transaction.

    SQLite refuses to VACUUM inside a transaction. Python's sqlite3 module
    opens a transaction implicitly on the first write, so we must commit
    first, then VACUUM, then commit again.

    Returns True if the vacuum completed, False if it could not run.
    """
    try:
        conn.commit()
        conn.execute("VACUUM")
        conn.commit()
        return True
    except sqlite3.Error:
        return False
