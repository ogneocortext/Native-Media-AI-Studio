#!/usr/bin/env python3
"""Shrink storage/studio.db by applying its own retention policy, then VACUUM.

gpu_telemetry accumulates a full JSON process list per snapshot (~3.5 KB) every
30 s. Its retention guard was effectively inert (see
`app/diagnostics/resources.py`), so the table reached ~417 MB of a 549 MB
database. Everything in it is regenerable telemetry: history pages read a
window of it, and older rows are beyond every supported range.

Safety, in order:

  * **Dry-run by default.** ``--apply`` is required to write.
  * Backs up the database first unless ``--no-backup``.
  * ``VACUUM INTO`` writes a *new* file and only replaces the original after it
      verifies as intact, so an interrupted run cannot leave a truncated
      database behind. A plain in-place ``VACUUM`` cannot make that promise.
  * ``--older-than`` defaults to the same 7 days the service itself uses. Pass
      ``0`` to prune all telemetry history.

Usage::

    python tools/compact-studio-db.py
    python tools/compact-studio-db.py --apply
    python tools/compact-studio-db.py --apply --older-than 0
"""
from __future__ import annotations

import argparse
import shutil
import sqlite3
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _toolutil import DEFAULT_DB  # noqa: E402


def human(n: float) -> str:
    return f"{n / 1048576:.1f} MB"


def db_stats(conn: sqlite3.Connection) -> tuple[int, int, int]:
    page_size = conn.execute("PRAGMA page_size").fetchone()[0]
    page_count = conn.execute("PRAGMA page_count").fetchone()[0]
    freelist = conn.execute("PRAGMA freelist_count").fetchone()[0]
    return page_size, page_count, freelist


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--apply", action="store_true", help="actually write")
    ap.add_argument("--no-backup", action="store_true")
    ap.add_argument(
        "--older-than",
        type=int,
        default=7,
        help="prune telemetry older than this many days (0 = all)",
    )
    args = ap.parse_args()

    if not args.db.exists():
        print(f"not found: {args.db}")
        return 1

    before_bytes = args.db.stat().st_size
    conn = sqlite3.connect(args.db)
    page_size, page_count, freelist = db_stats(conn)

    total = conn.execute("SELECT COUNT(*) FROM gpu_telemetry").fetchone()[0]
    cutoff_ms = int((time.time() - args.older_than * 86400) * 1000)
    doomed = conn.execute(
        "SELECT COUNT(*) FROM gpu_telemetry WHERE ts_ms < ?", (cutoff_ms,)
    ).fetchone()[0]
    payload = conn.execute(
        "SELECT COALESCE(SUM(LENGTH(processes_json)), 0) FROM gpu_telemetry WHERE ts_ms < ?",
        (cutoff_ms,),
    ).fetchone()[0]
    oldest, newest = conn.execute(
        "SELECT MIN(ts_iso), MAX(ts_iso) FROM gpu_telemetry"
    ).fetchone()

    print(f"database:      {args.db}")
    print(f"on disk:       {human(before_bytes)}")
    print(f"freelist:      {human(freelist * page_size)}")
    print()
    print(f"gpu_telemetry rows: {total:,}")
    print(f"  range: {oldest}  ->  {newest}")
    print(f"  older than {args.older_than} day(s): {doomed:,} rows, {human(payload)} of JSON")
    print(f"  would keep: {total - doomed:,} rows")
    print()

    if not doomed:
        print("nothing to prune; run VACUUM only if the freelist is large.")
        conn.close()
        return 0

    if not args.apply:
        est = max(0.0, before_bytes - payload * 1.15)
        print("Dry run. Re-run with --apply.")
        print(f"  expect roughly {human(est)} after prune + VACUUM "
              f"(~{human(before_bytes - est)} saved).")
        conn.close()
        return 0

    stamp = time.strftime("%Y%m%d-%H%M%S")
    backup = None
    if not args.no_backup:
        backup = args.db.with_suffix(f".bak-pre-compact-{stamp}")
        shutil.copy2(args.db, backup)
        print(f"backup: {backup}")

    deleted = conn.execute(
        "DELETE FROM gpu_telemetry WHERE ts_ms < ?", (cutoff_ms,)
    ).rowcount
    conn.commit()
    print(f"deleted {deleted:,} telemetry rows")

    remaining = conn.execute("SELECT COUNT(*) FROM gpu_telemetry").fetchone()[0]
    conn.close()

    # VACUUM INTO a fresh file, verify it, then swap. An in-place VACUUM on a
    # 549 MB file can leave a truncated database if it is interrupted.
    compacted = args.db.with_suffix(".compacting")
    if compacted.exists():
        compacted.unlink()

    vconn = sqlite3.connect(args.db)
    try:
        vconn.execute("VACUUM INTO ?", (str(compacted),))
    finally:
        vconn.close()

    check = sqlite3.connect(compacted)
    try:
        integrity = check.execute("PRAGMA integrity_check").fetchone()[0]
        kept = check.execute("SELECT COUNT(*) FROM gpu_telemetry").fetchone()[0]
    finally:
        check.close()

    if integrity != "ok" or kept != remaining:
        compacted.unlink(missing_ok=True)
        print(f"compacted copy failed verification ({integrity}, {kept} rows); "
              f"original untouched")
        return 1

    shutil.move(str(compacted), str(args.db))
    after_bytes = args.db.stat().st_size
    print(f"compacted OK: {human(before_bytes)} -> {human(after_bytes)} "
          f"(saved {human(before_bytes - after_bytes)})")
    if backup:
        print(f"rollback: {backup}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
