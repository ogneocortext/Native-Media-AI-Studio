#!/usr/bin/env python3
"""Dry-run report for audio_files rows whose file is gone.

``dedupe-audio-uploads.py`` retires duplicate *rows* and ``prune-orphan-audio.py``
removes unreferenced *files*. Neither answers the remaining question: rows that
still exist but point at a file that does not. Those are not harmless -- they
surface in the library UI and every request for them 404s or 500s.

Read-only by design. This script never writes; it reports what each missing row
could become, so that retiring or restoring stays a deliberate decision.

For each missing row it checks whether the audio is recoverable without a
restore, in order of confidence:

1. The row's ``stored_path``/``filename`` resolves under the audio dir only after
   following a subdirectory move (matched on basename). These rows are repairable
   by relinking -- no bytes are lost.
2. Nothing matches anywhere under the audio dir. The row points at content this
   machine does not have, and needs either a restore from backup or a retire.

Note on ``file_size``: it is 0 for every row in this database because the uploader
never populated it, so content cannot be matched by size and this report matches
on path/basename only.

Usage::

    python tools/report-missing-audio.py
    python tools/report-missing-audio.py --json
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO / "storage" / "studio.db"
DEFAULT_AUDIO = REPO / "output" / "audio"


def build_index(audio_dir: Path) -> dict[str, Path]:
    return {
        p.relative_to(audio_dir).as_posix(): p
        for p in audio_dir.rglob("*")
        if p.is_file()
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--audio-dir", type=Path, default=DEFAULT_AUDIO)
    ap.add_argument("--json", action="store_true", help="emit JSON instead of a table")
    args = ap.parse_args()

    if not args.db.exists():
        print(f"database not found: {args.db}")
        return 1
    if not args.audio_dir.is_dir():
        print(f"audio dir not found: {args.audio_dir}")
        return 1

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT id, filename, original_name, stored_path, file_size, created_at "
        "FROM audio_files ORDER BY created_at"
    ).fetchall()

    on_disk = build_index(args.audio_dir)

    # Index on-disk paths by basename, so a row whose file moved into a
    # subdirectory can be matched by content-of-name rather than by full path.
    by_basename: dict[str, list[str]] = {}
    for name in on_disk:
        by_basename.setdefault(Path(name).name, []).append(name)

    missing: list[dict] = []
    for r in rows:
        stored = (r["stored_path"] or "").replace("\\", "/").lstrip("/")
        fname = (r["filename"] or "").replace("\\", "/")
        if stored in on_disk or fname in on_disk:
            continue

        # Try to find a same-basename file elsewhere (subdirectory moves).
        basename = Path(fname).name or Path(stored).name
        relocated = by_basename.get(basename, [])

        # file_size is 0 for every row in this database (the column was never
        # populated by the uploader), so it cannot be used to match content and
        # is deliberately not printed as a size.
        missing.append(
            {
                "id": r["id"],
                "filename": r["filename"],
                "original_name": r["original_name"],
                "stored_path": r["stored_path"],
                "file_size": r["file_size"],
                "created_at": r["created_at"],
                "relocated_to": relocated[0] if len(relocated) == 1 else None,
            }
        )

    relocatable = [m for m in missing if m["relocated_to"]]
    orphans = [m for m in missing if not m["relocated_to"]]

    if args.json:
        print(json.dumps(
            {
                "total_rows": len(rows),
                "on_disk": len(on_disk),
                "missing": len(missing),
                "relocatable": relocatable,
                "no_trace_on_disk": orphans,
            },
            indent=2,
            ensure_ascii=False,
        ))
        return 0

    print(f"audio_files rows:        {len(rows)}")
    print(f"files on disk:           {len(on_disk)}")
    print(f"rows with no file:       {len(missing)}")
    print()
    print(f"  [1] file exists under another name (relink): {len(relocatable)}")
    for m in relocatable:
        print(f"        {m['filename']}")
        print(f"          -> found on disk as: {m['relocated_to']}")
    print(f"  [2] no trace on this machine (restore or retire): {len(orphans)}")
    for m in orphans:
        print(f"        {m['filename']}  (id={m['id']})")
    print()
    print("Note: file_size is 0 for every row in this database, so content could "
          "not be\nmatched by size. Matching is by filename/basename only.")
    print("Read-only report. Nothing was modified.")
    if orphans:
        print(
            "Category [2] rows cannot be repaired by relinking: no file with that "
            "name\nexists anywhere under the audio dir. Restore them from backup, or "
            "retire the rows\nso the library stops advertising tracks it cannot serve."
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
