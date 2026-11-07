#!/usr/bin/env python3
"""Verify the studio database and its newest backup are not corrupt.

Backups (``storage/studio.db.bak-*``) are written before migrations and
admin operations, but a backup is only useful if it can actually be read
during an incident — the worst time to discover corruption. This check runs
``PRAGMA quick_check`` (integrity_check's faster sibling; catches the same
structural corruption without the full index walk) against the live DB and
the newest backup.

Run:  python tools/check-db-integrity.py
Exit 0 = all checked databases pass quick_check, 1 = any failure or missing
live DB.
"""

import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STORAGE = ROOT / "storage"
LIVE_DB = STORAGE / "studio.db"
BACKUP_GLOB = "studio.db.bak-*"


def _quick_check(path: Path, *, immutable: bool = False) -> str | None:
    """Return None if the DB passes quick_check, else the error text.

    immutable=1 for backups: tells SQLite the file cannot change, so it
    never creates -shm/-wal sidecars next to the backup (a plain ro open
    of a WAL-mode DB does exactly that — which then matches the backup
    glob and fails the next run).
    """
    uri = f"file:{path}?mode=ro" + ("&immutable=1" if immutable else "")
    try:
        conn = sqlite3.connect(uri, uri=True)
        try:
            rows = conn.execute("PRAGMA quick_check").fetchall()
        finally:
            conn.close()
    except sqlite3.Error as e:
        return str(e)
    bad = [r[0] for r in rows if r and str(r[0]).lower() != "ok"]
    return "; ".join(bad[:3]) if bad else None


def _is_backup_file(path: Path) -> bool:
    """True for studio.db.bak-<stamp> files, False for -shm/-wal sidecars."""
    name = path.name
    return (name.startswith("studio.db.bak-")
            and not name.endswith(("-shm", "-wal")))


def main() -> int:
    targets: list[tuple[Path, bool]] = []
    if LIVE_DB.exists():
        targets.append((LIVE_DB, False))
    else:
        print(f"[FAIL] {LIVE_DB.relative_to(ROOT)} - live database missing")
        return 1

    backups = sorted((p for p in STORAGE.glob(BACKUP_GLOB)
                      if _is_backup_file(p)),
                     key=lambda p: p.stat().st_mtime, reverse=True)
    if backups:
        targets.append((backups[0], True))
    else:
        print("[WARN] no studio.db.bak-* backups found - "
              "restore confidence is zero")

    failures = 0
    for path, immutable in targets:
        rel = path.relative_to(ROOT)
        err = _quick_check(path, immutable=immutable)
        if err is None:
            print(f"[OK]   {rel} - quick_check clean")
        else:
            failures += 1
            print(f"[FAIL] {rel} - {err}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
