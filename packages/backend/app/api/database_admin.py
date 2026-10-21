"""
Database administration API - inventory, health and maintenance for the studio
SQLite database.

Kept separate from ``data.py`` (saved prompts / visuals / sessions / tracks CRUD)
because that is a different responsibility: ``data.py`` reads and writes
*records*, this module inspects and maintains the *database itself*. Per the
project's module rule a new endpoint belongs in the module matching its
responsibility, not in ``data.py`` by default.

Every endpoint is a synchronous ``def`` rather than ``async def`` on purpose.
VACUUM, WAL checkpoint and integrity_check block for seconds on this file, and
running them on the event loop would stall every other request. FastAPI runs
``def`` endpoints in its threadpool, so the blocking work stays off-loop.
"""

from __future__ import annotations

import re
import sqlite3
import threading
import time
from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..core import database as db

router = APIRouter(prefix="/api/database", tags=["Database"])

#: One destructive maintenance op at a time. Two overlapping VACUUMs on the same
#: file contend for the writer lock and one raises after ``busy_timeout``.
_MAINTENANCE_LOCK = threading.Lock()

#: Identifiers accepted for the ``/tables/{name}`` path. Names are additionally
#: checked against sqlite_master, so this only has to reject quoting tricks.
_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


# ---------------------------------------------------------------------------
# Response / request models
# ---------------------------------------------------------------------------


class TableSummary(BaseModel):
    """One table or view in the inventory."""

    name: str
    type: str
    rows: int
    """Exact ``COUNT(*)``. ``-1`` means the table could not be read."""


class OverviewResponse(BaseModel):
    """Whole-database snapshot: size, schema version and the table inventory."""

    path: str
    exists: bool
    schema_version: int
    target_schema_version: int
    journal_mode: str
    page_size: int
    page_count: int
    freelist_count: int
    reclaimable_bytes: int
    file_bytes: int
    wal_bytes: int
    shm_bytes: int
    table_count: int
    view_count: int
    index_count: int
    tables: list[TableSummary]
    last_activity: dict[str, str | None]


class ColumnInfo(BaseModel):
    """One column of a table."""

    name: str
    type: str
    notnull: bool
    default: str | None
    primary_key: bool


class IndexInfo(BaseModel):
    """One index on a table."""

    name: str
    unique: bool
    columns: list[str]


class TableDetailResponse(BaseModel):
    """Schema detail for a single table: columns, indexes and size."""

    name: str
    type: str
    rows: int
    columns: list[ColumnInfo]
    indexes: list[IndexInfo]
    indexes_bytes: int | None
    """``dbstat`` page bytes for the table + its indexes, or ``None`` when the
    ``dbstat`` virtual table is unavailable on this SQLite build."""


class MigrationInfo(BaseModel):
    """One ``_migrate_vN`` function discovered in ``core.database``."""

    version: int
    applied: bool


class SchemaResponse(BaseModel):
    """Current schema version, the target, and the migration ladder."""

    schema_version: int
    target_schema_version: int
    up_to_date: bool
    migrations: list[MigrationInfo]


class IntegrityResponse(BaseModel):
    """Result of a SQLite integrity self-check."""

    ok: bool
    mode: str
    duration_ms: int
    messages: list[str]


class MaintenanceRequest(BaseModel):
    """Body for a maintenance action. Both fields are optional and action-scoped.

    ``keep_days`` applies to the ``prune-*`` actions; ``full`` selects the
    thorough (slower) integrity check and only applies to ``integrity-check``.
    """

    keep_days: int | None = Field(default=None, ge=1, le=3650)
    full: bool = False


class MaintenanceResponse(BaseModel):
    """Outcome of a maintenance action, with the on-disk size delta."""

    action: str
    ok: bool
    duration_ms: int
    before_bytes: int
    after_bytes: int
    freed_bytes: int
    detail: dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _db_sizes() -> dict[str, int]:
    """On-disk sizes of the database file and its WAL sidecars.

    A missing sidecar reports 0 rather than raising: WAL/SHM are absent whenever
    the database was last closed cleanly.
    """
    path = db.DB_PATH

    def _size(p: Any) -> int:
        try:
            return p.stat().st_size
        except OSError:
            return 0

    return {
        "file_bytes": _size(path),
        "wal_bytes": _size(path.with_name(path.name + "-wal")),
        "shm_bytes": _size(path.with_name(path.name + "-shm")),
    }


def _inventory(conn: sqlite3.Connection) -> list[tuple[str, str]]:
    """Return ``(name, type)`` for every user table and view, name-sorted."""
    rows = conn.execute(
        "SELECT name, type FROM sqlite_master "
        "WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' "
        "ORDER BY name"
    ).fetchall()
    return [(row["name"], row["type"]) for row in rows]


def _count_rows(conn: sqlite3.Connection, name: str) -> int:
    """Exact row count, or ``-1`` if the table cannot be read.

    ``-1`` is reported instead of raising so one unreadable table (locked or
    damaged) cannot blank the whole inventory.
    """
    try:
        return int(conn.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0])
    except sqlite3.Error:
        return -1


def _count_indexes(conn: sqlite3.Connection) -> int:
    return int(
        conn.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'"
        ).fetchone()[0]
    )


def _as_text(value: Any) -> str | None:
    """Render a timestamp column value as text for the ``str | None`` contract.

    Most tables store ISO strings, but some store epoch numbers instead
    (``gpu_telemetry.ts_ms`` is an INTEGER, and reading it raw raises a
    ``ValidationError`` that fails the whole overview with a 500). A numeric
    value is therefore converted to an ISO timestamp, with the unit guessed
    from magnitude; anything unparseable is stringified rather than dropped.
    """
    if value is None or isinstance(value, str):
        return value
    if isinstance(value, int | float):
        seconds = value / 1000.0 if abs(value) >= 1e11 else float(value)
        try:
            return datetime.fromtimestamp(seconds, tz=timezone.utc).isoformat()
        except (OverflowError, OSError, ValueError):
            return str(value)
    return str(value)


def _last_activity(conn: sqlite3.Connection) -> dict[str, str | None]:
    """Most recent write timestamp in the append-heavy tables.

    Best-effort: each table is probed independently so a database without one of
    them still reports the others.
    """

    def _max_ts(table: str, column: str) -> str | None:
        try:
            row = conn.execute(f'SELECT MAX("{column}") FROM "{table}"').fetchone()
            return _as_text(row[0]) if row else None
        except sqlite3.Error:
            return None

    return {
        "log_events": _max_ts("log_events", "ts_iso"),
        "native_opens": _max_ts("native_app_opens", "created_at"),
        "gpu_telemetry": _max_ts("gpu_telemetry", "ts_iso"),
    }


def _dbstat_bytes(conn: sqlite3.Connection, name: str) -> int | None:
    """Page bytes for a table and its indexes, or ``None`` without ``dbstat``.

    ``dbstat`` walks every page, so it is slow on large files; callers gate it
    behind an explicit request.
    """
    try:
        row = conn.execute(
            "SELECT SUM(pgsize) FROM dbstat WHERE name = ? OR name LIKE ?",
            (name, f"idx_%{name}"),
        ).fetchone()
        return int(row[0]) if row and row[0] is not None else None
    except sqlite3.Error:
        return None


def _discover_migrations() -> list[int]:
    """Return the sorted migration versions present in ``core.database``."""
    versions: list[int] = []
    for attr in dir(db):
        match = re.fullmatch(r"_migrate_v(\d+)", attr)
        if match:
            versions.append(int(match.group(1)))
    return sorted(versions)


# ---------------------------------------------------------------------------
# Inventory
# ---------------------------------------------------------------------------


@router.get("/overview", response_model=OverviewResponse)
def database_overview() -> OverviewResponse:
    """Size, schema version and the full table inventory in one call."""
    sizes = _db_sizes()
    exists = db.DB_PATH.exists()
    with db.get_db() as conn:
        page_size = int(conn.execute("PRAGMA page_size").fetchone()[0])
        page_count = int(conn.execute("PRAGMA page_count").fetchone()[0])
        freelist_count = int(conn.execute("PRAGMA freelist_count").fetchone()[0])
        journal_mode = str(conn.execute("PRAGMA journal_mode").fetchone()[0])
        schema_version = db.get_schema_version(conn)
        inventory = _inventory(conn)
        tables = [
            TableSummary(
                name=name, type=kind, rows=(_count_rows(conn, name) if kind == "table" else -1)
            )
            for name, kind in inventory
        ]
        index_count = _count_indexes(conn)
        last_activity = _last_activity(conn)

    return OverviewResponse(
        path=str(db.DB_PATH),
        exists=exists,
        schema_version=schema_version,
        target_schema_version=db.SCHEMA_VERSION,
        journal_mode=journal_mode,
        page_size=page_size,
        page_count=page_count,
        freelist_count=freelist_count,
        reclaimable_bytes=freelist_count * page_size,
        **sizes,
        table_count=sum(1 for _, kind in inventory if kind == "table"),
        view_count=sum(1 for _, kind in inventory if kind == "view"),
        index_count=index_count,
        tables=tables,
        last_activity=last_activity,
    )


@router.get("/tables/{name}", response_model=TableDetailResponse)
def database_table(name: str, sizes: bool = False) -> TableDetailResponse:
    """Columns, indexes and (optionally) page size for one table.

    ``sizes=true`` adds a ``dbstat`` measurement, which walks every page and is
    therefore opt-in rather than part of the default response.
    """
    if not _IDENT_RE.match(name):
        raise HTTPException(status_code=400, detail="Invalid table name")
    with db.get_db() as conn:
        row = conn.execute(
            "SELECT name, type FROM sqlite_master WHERE name = ? AND type IN ('table', 'view')",
            (name,),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail=f"Table '{name}' not found")

        columns = [
            ColumnInfo(
                name=c["name"],
                type=c["type"] or "",
                notnull=bool(c["notnull"]),
                default=c["dflt_value"],
                primary_key=bool(c["pk"]),
            )
            for c in conn.execute(f'PRAGMA table_info("{name}")').fetchall()
        ]

        indexes: list[IndexInfo] = []
        for idx in conn.execute(f'PRAGMA index_list("{name}")').fetchall():
            cols = [
                r["name"] for r in conn.execute(f'PRAGMA index_info("{idx["name"]}")').fetchall()
            ]
            indexes.append(IndexInfo(name=idx["name"], unique=bool(idx["unique"]), columns=cols))

        rows = _count_rows(conn, name) if row["type"] == "table" else -1
        index_bytes = _dbstat_bytes(conn, name) if sizes else None

    return TableDetailResponse(
        name=name,
        type=row["type"],
        rows=rows,
        columns=columns,
        indexes=indexes,
        indexes_bytes=index_bytes,
    )


@router.get("/schema", response_model=SchemaResponse)
def database_schema() -> SchemaResponse:
    """The schema version, the target, and which migrations have been applied."""
    with db.get_db() as conn:
        current = db.get_schema_version(conn)
    return SchemaResponse(
        schema_version=current,
        target_schema_version=db.SCHEMA_VERSION,
        up_to_date=current >= db.SCHEMA_VERSION,
        migrations=[MigrationInfo(version=v, applied=v <= current) for v in _discover_migrations()],
    )


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------


@router.post("/integrity-check", response_model=IntegrityResponse)
def database_integrity_check(request: MaintenanceRequest | None = None) -> IntegrityResponse:
    """Run a SQLite integrity self-check.

    POST rather than GET because the check is expensive and must not be prefetched
    or cached. ``quick_check`` is the default; ``{"full": true}`` runs the
    thorough ``integrity_check``.
    """
    full = bool(request.full) if request else False
    pragma = "integrity_check" if full else "quick_check"
    start = time.perf_counter()
    with db.get_db() as conn:
        messages = [str(r[0]) for r in conn.execute(f"PRAGMA {pragma}").fetchall()]
    return IntegrityResponse(
        ok=messages == ["ok"],
        mode=pragma,
        duration_ms=int((time.perf_counter() - start) * 1000),
        messages=messages,
    )


# ---------------------------------------------------------------------------
# Maintenance
# ---------------------------------------------------------------------------

#: ``prune-*`` actions: helper + the keep-days default the helper itself uses.
_PRUNE_ACTIONS: dict[str, tuple[Callable[..., int], int]] = {
    "prune-logs": (db.cleanup_old_log_events, 30),
    "prune-telemetry": (db.cleanup_old_gpu_telemetry, 14),
    "prune-resources": (db.cleanup_old_system_resources, 7),
}

#: Whole-file actions run on a held connection, under the lock.
_DIRECT_ACTIONS = frozenset({"vacuum", "wal-checkpoint", "analyze"})


@router.post("/maintenance/{action}", response_model=MaintenanceResponse)
def database_maintenance(
    action: str, request: MaintenanceRequest | None = None
) -> MaintenanceResponse:
    """Run one maintenance action and report the on-disk size delta.

    Actions: ``vacuum``, ``wal-checkpoint``, ``analyze``, ``prune-logs``,
    ``prune-telemetry``, ``prune-resources``.
    """
    if action not in _DIRECT_ACTIONS and action not in _PRUNE_ACTIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown action '{action}'. "
            f"Valid: {sorted(_DIRECT_ACTIONS | set(_PRUNE_ACTIONS))}",
        )

    body = request or MaintenanceRequest()
    before = _db_sizes()["file_bytes"]
    start = time.perf_counter()
    detail: dict[str, Any] = {}
    ok = True

    with _MAINTENANCE_LOCK:
        if action in _PRUNE_ACTIONS:
            helper, default_days = _PRUNE_ACTIONS[action]
            keep_days = body.keep_days or default_days
            # The helper opens and closes its own pooled connection, so it is
            # called without holding one - otherwise the two connections contend
            # for the single SQLite writer lock.
            detail["keep_days"] = keep_days
            detail["rows_deleted"] = int(helper(keep_days=keep_days))
        else:
            with db.get_db() as conn:
                if action == "vacuum":
                    ok = db.safe_vacuum(conn)
                elif action == "wal-checkpoint":
                    detail["result"] = [
                        int(v) for v in conn.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
                    ]
                elif action == "analyze":
                    conn.execute("ANALYZE")
                    conn.execute("PRAGMA optimize")

    after = _db_sizes()["file_bytes"]
    return MaintenanceResponse(
        action=action,
        ok=ok,
        duration_ms=int((time.perf_counter() - start) * 1000),
        before_bytes=before,
        after_bytes=after,
        freed_bytes=before - after,
        detail=detail,
    )
