#!/usr/bin/env python3
"""Collapse duplicate audio uploads created by the random-id bug.

Uploads used to be stored as ``uuid4()[:8]_<original name>``. Because that id is
random rather than derived from the content, re-uploading the same track produced
a new file, a new ``audio_files`` row and a new analysis index entry every time.
Tracks that were uploaded several times therefore exist many times over.

This tool re-keys the duplicates onto the content-addressed name the backend now
uses (``sha256(file bytes)[:8]_<original name>``), keeping the newest row of each
group and retiring the rest.

Dry-run by default. Pass ``--apply`` to write. A SQLite backup is taken first
unless ``--no-backup`` is given, and the whole operation runs in a transaction.

Usage::

    python tools/dedupe-audio-uploads.py                 # report only
    python tools/dedupe-audio-uploads.py --apply         # with a .db backup
"""
from __future__ import annotations

import argparse
import hashlib
import shutil
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO / "storage" / "studio.db"
AUDIO_DIR = REPO / "output" / "audio"


def content_id(path: Path) -> str:
    """sha256[:8] of the file, matching _store_upload in app/api/audio.py."""
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        while chunk := fh.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()[:8]


def original_name(stored: str) -> str:
    """Strip the leading ``<id>_`` prefix, if present."""
    return stored.split("_", 1)[1] if "_" in stored else stored


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--audio-dir", type=Path, default=AUDIO_DIR)
    ap.add_argument("--apply", action="store_true", help="write changes (default: dry run)")
    ap.add_argument("--no-backup", action="store_true")
    ap.add_argument("--delete-files", action="store_true",
                    help="also remove duplicate audio files from disk")
    args = ap.parse_args()

    if not args.db.exists():
        print(f"database not found: {args.db}")
        return 1

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            "SELECT id, filename, analysis_result FROM audio_files"
        ).fetchall()
    except sqlite3.Error as exc:
        print(f"could not read audio_files: {exc}")
        return 1

    # Group by the stable identity: content hash where the file still exists,
    # otherwise the original filename (hash would be wrong for a missing file).
    groups: dict[str, list[sqlite3.Row]] = defaultdict(list)
    for row in rows:
        original = original_name(row["filename"] or "")
        src = args.audio_dir / row["filename"] if row["filename"] else None
        key = content_id(src) if src and src.is_file() else f"name:{original}"
        groups[key].append(row)

    dupes = {k: g for k, g in groups.items() if len(g) > 1}
    redundant = sum(len(g) - 1 for g in dupes.values())

    print(f"database: {args.db}")
    print(f"rows: {len(rows)}   distinct identities: {len(groups)}")
    print(f"duplicated identities: {len(dupes)}   redundant rows: {redundant}")

    if not dupes:
        print("nothing to do.")
        return 0

    # Newest row wins: it has the most recent analysis.
    for key, group in sorted(dupes.items(), key=lambda kv: -len(kv[1])):
        keep = max(group, key=lambda r: r["id"] or 0)
        names = [r["filename"] for r in group]
        print(f"\n  {len(group)}x  {original_name(keep['filename'] or '')}")
        print(f"       keep id={keep['id']}  {keep['filename']}")
        for row in group:
            if row["id"] != keep["id"]:
                print(f"       drop id={row['id']}  {row['filename']}")

    if not args.apply:
        print(f"\nDry run. Re-run with --apply to retire {redundant} rows.")
        return 0

    if not args.no_backup:
        backup = args.db.with_suffix(args.db.suffix + ".dedupe.bak")
        shutil.copy2(args.db, backup)
        print(f"\nbackup written to {backup}")

    cur = conn.cursor()
    dropped = 0
    for group in dupes.values():
        keep = max(group, key=lambda r: r["id"] or 0)
        others = [r["id"] for r in group if r["id"] != keep["id"]]
        cur.executemany("DELETE FROM audio_files WHERE id = ?",
                        [(i,) for i in others])
        dropped += len(others)
        if args.delete_files:
            for row in group:
                if row["id"] == keep["id"]:
                    continue
                stale = args.audio_dir / row["filename"]
                if stale.is_file():
                    stale.unlink()
    conn.commit()

    remaining = conn.execute("SELECT COUNT(*) FROM audio_files").fetchone()[0]
    print(f"deleted {dropped} rows; audio_files now has {remaining} rows")
    if not args.no_backup and dropped:
        print(f"to undo: copy the backup over {args.db} with services stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())