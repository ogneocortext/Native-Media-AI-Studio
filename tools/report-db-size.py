#!/usr/bin/env python3
"""Report which tables/indexes account for storage/studio.db's size.

Answers "why is the database so large?" without needing SQLITE_ENABLE_DBSTAT_VTAB,
which the bundled sqlite3 usually lacks. Instead of measuring pages directly it
probes each table with ``dbstat`` when available and otherwise estimates from the
sum of column lengths, then separates the tables that can grow without bound
(jobs, logs, telemetry) from the ones that should not.

Read-only. Takes an optional path so a backup can be compared to the live file.

Usage::

    python tools/report-db-size.py
    python tools/report-db-size.py storage/studio.db.dedupe.bak
"""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO / "storage" / "studio.db"

# Tables that accumulate over time and are therefore expected to dominate.
UNBOUNDED = {
    "jobs",
    "log_events",
    "gpu_telemetry",
    "system_resources",
    "ollama_analysis_responses",
    "native_app_opens",
    "hardware_benchmarks",
    "prompt_history",
    "vision_ocr_results",
}


def human(n: int) -> str:
    return f"{n / 1048576:9.1f} MB"


def table_rows(conn: sqlite3.Connection, name: str) -> int:
    try:
        return conn.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]
    except sqlite3.Error:
        return -1


def estimated_bytes(conn: sqlite3.Connection, name: str) -> int:
    """Sum of declared column lengths, a floor for the real footprint.

    Text/blob columns are charged their declared maximum where one is known,
    because a TEXT column costs what it holds, not what it could hold.
    """
    try:
        cols = list(conn.execute(f'PRAGMA table_info("{name}")'))
    except sqlite3.Error:
        return 0
    if not cols:
        return 0
    names = [c[1] for c in cols]
    if not names:
        return 0
    try:
        expr = ", ".join(f'COALESCE(LENGTH("{n}"),0)' for n in names)
        row = conn.execute(f'SELECT COALESCE(SUM({expr}),0) FROM "{name}"').fetchone()
        return int(row[0] or 0)
    except sqlite3.Error:
        return 0


def main() -> int:
    db = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_DB
    if not db.exists():
        print(f"not found: {db}")
        return 1

    conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    page_size = conn.execute("PRAGMA page_size").fetchone()[0]
    page_count = conn.execute("PRAGMA page_count").fetchone()[0]
    freelist = conn.execute("PRAGMA freelist_count").fetchone()[0]
    auto_vacuum = conn.execute("PRAGMA auto_vacuum").fetchone()[0]
    page_count -= freelist

    print(f"database: {db}")
    print(f"on disk:  {human(db.stat().st_size)}")
    print(f"live:     {human(page_count * page_size)}   (page_count - freelist)")
    print(f"freelist: {human(freelist * page_size)}  <- VACUUM would reclaim this")
    print(f"auto_vacuum: {auto_vacuum}  (0 = NONE: freed space is NOT returned to the OS)")
    print()

    have_dbstat = True
    try:
        conn.execute("CREATE VIRTUAL TABLE temp.st USING dbstat(main)")
    except sqlite3.Error:
        have_dbstat = False

    names = [
        r[0]
        for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        if not r[0].startswith("sqlite_")
    ]

    if have_dbstat:
        print(f"{'size':>10}  {'pages':>8}  rows      table")
        print("-" * 52)
        for name, sz, pages in conn.execute(
            "SELECT name, SUM(pgsize), COUNT(*) FROM temp.st GROUP BY name ORDER BY 2 DESC"
        ):
            rows = table_rows(conn, name) if not name.startswith("sqlite_") else -1
            print(f"{human(sz)}  {pages:>8}  {rows:>8}  {name}")
    else:
        print("dbstat vtab unavailable; estimating from stored column lengths.")
        print("These are FLOORS, not exact sizes - run VACUUM INTO for a real total.\n")
        print(f"{'floor':>10}  {'rows':>8}  table")
        print("-" * 44)
        data = [
            (estimated_bytes(conn, n), table_rows(conn, n), n)
            for n in names
            if not n.startswith("sqlite_")
        ]
        for sz, rows, name in sorted(data, reverse=True)[:15]:
            print(f"{human(sz)}  {rows:>8}  {name}")
        print()

    print("Unbounded tables (grow with usage; the usual reason a DB gets large):")
    for n in sorted(UNBOUNDED & set(names)):
        print(f"  {n:<28} rows={table_rows(conn, n)}")

    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
