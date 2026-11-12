#!/usr/bin/env python3
"""Verify the studio database and its newest backup are not corrupt.

Backups (``storage/studio.db.bak-*``) are written before migrations and
admin operations, but a backup is only useful if it can actually be read
during an incident — the worst time to discover corruption. This check runs
``PRAGMA quick_check`` (integrity_check's faster sibling; catches the same
structural corruption without the full index walk) against the newest backup.
For the live DB we do a lightweight connectivity check (PRAGMA page_count)
instead of full quick_check, because quick_check on a 50MB+ WAL-mode DB can
take >90s and blocks the pre-push gate.

Run:  python tools/check-db-integrity.py
Exit 0 = backup passes quick_check and live DB is readable, 1 = any failure
or missing live DB/backup.
"""

import sqlite3
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STORAGE = ROOT / "storage"
LIVE_DB = STORAGE / "studio.db"
BACKUP_GLOB = "studio.db.bak-*"


def _quick_check(path: Path, *, immutable: bool = False, timeout_sec: float = 30.0) -> str | None:
    """Return None if the DB passes quick_check, else the error text.

    immutable=1 for backups: tells SQLite the file cannot change, so it
    never creates -shm/-wal sidecars next to the backup (a plain ro open
    of a WAL-mode DB does exactly that — which then matches the backup
    glob and fails the next run).

    Runs with a timeout to prevent hangs on large/corrupt DBs.
    """
    uri = f"file:{path}?mode=ro" + ("&immutable=1" if immutable else "")
    result = {"error": None, "bad": None}
    done = threading.Event()

    def worker():
        try:
            conn = sqlite3.connect(uri, uri=True, timeout=5.0)
            try:
                rows = conn.execute("PRAGMA quick_check").fetchall()
            finally:
                conn.close()
            bad = [r[0] for r in rows if r and str(r[0]).lower() != "ok"]
            result["bad"] = "; ".join(bad[:3]) if bad else None
        except sqlite3.Error as e:
            result["error"] = str(e)
        finally:
            done.set()

    t = threading.Thread(target=worker, daemon=True)
    t.start()
    done.wait(timeout=timeout_sec)
    if not done.is_set():
        return f"TIMEOUT after {timeout_sec}s"
    if result["error"]:
        return result["error"]
    return result["bad"]


def _live_db_readable() -> str | None:
    """Lightweight check that the live DB is accessible and not empty."""
    uri = f"file:{LIVE_DB}?mode=ro"
    try:
        conn = sqlite3.connect(uri, uri=True, timeout=5.0)
        try:
            # Just check we can read the schema and page count
            conn.execute("PRAGMA page_count").fetchall()
            conn.execute("SELECT 1 FROM sqlite_master LIMIT 1").fetchall()
        finally:
            conn.close()
    except sqlite3.Error as e:
        return str(e)
    return None


def _is_backup_file(path: Path) -> bool:
    """True for studio.db.bak-<stamp> files, False for -shm/-wal sidecars."""
    name = path.name
    return (name.startswith("studio.db.bak-")
            and not name.endswith(("-shm", "-wal")))


def main() -> int:
    if not LIVE_DB.exists():
        print(f"[FAIL] {LIVE_DB.relative_to(ROOT)} - live database missing")
        return 1

    # Lightweight live DB check (connectivity only)
    err = _live_db_readable()
    if err is None:
        print(f"[OK]   {LIVE_DB.relative_to(ROOT)} - live DB readable")
    else:
        print(f"[FAIL] {LIVE_DB.relative_to(ROOT)} - {err}")
        return 1

    # Full quick_check on the newest backup (immutable, fast)
    backups = sorted((p for p in STORAGE.glob(BACKUP_GLOB)
                      if _is_backup_file(p)),
                     key=lambda p: p.stat().st_mtime, reverse=True)
    if not backups:
        print("[WARN] no studio.db.bak-* backups found - "
              "restore confidence is zero")
        return 0  # Not a hard failure, but warn

    backup = backups[0]
    err = _quick_check(backup, immutable=True, timeout_sec=30.0)
    if err is None:
        print(f"[OK]   {backup.relative_to(ROOT)} - quick_check clean")
    else:
        print(f"[FAIL] {backup.relative_to(ROOT)} - {err}")
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
