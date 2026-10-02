#!/usr/bin/env python3
"""Read-only health audit for storage/studio.db.

Answers the questions that decide whether the library is trustworthy: is the
file structurally sound, does every row point at a file that exists, and are the
metadata columns populated. Prints findings; changes nothing.
"""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DB = REPO / "storage" / "studio.db"
AUDIO = REPO / "output" / "audio"


def main() -> int:
    db = Path(sys.argv[1]) if len(sys.argv) > 1 else DB
    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row

    print(f"database: {db}")
    print(f"integrity_check: {conn.execute('PRAGMA integrity_check').fetchone()[0]}")
    fk = conn.execute("PRAGMA foreign_key_check").fetchall()
    print(f"foreign_key_check: {'clean' if not fk else fk[:5]}")

    rows = conn.execute(
        "SELECT id, filename, original_name, stored_path, file_size FROM audio_files"
    ).fetchall()

    on_disk = {}
    if AUDIO.is_dir():
        for p in AUDIO.rglob("*"):
            if p.is_file():
                on_disk[p.relative_to(AUDIO).as_posix()] = p

    resolvable: list = []
    orphan: list = []
    for r in rows:
        stored = (r["stored_path"] or "").replace("\\", "/")
        fname = (r["filename"] or "").replace("\\", "/")
        if stored in on_disk or fname in on_disk:
            continue
        base = fname.split("/")[-1]
        hits = [n for n in on_disk if n.split("/")[-1] == base]
        (resolvable if len(hits) == 1 else orphan).append((r, hits))

    print()
    print(f"audio_files rows: {len(rows)}   files on disk: {len(on_disk)}")
    print(f"  rows with a resolvable file elsewhere (relink): {len(resolvable)}")
    for r, hits in resolvable:
        print(f"      {r['filename']}  ->  {hits[0]}")
    print(f"  rows with no file anywhere: {len(orphan)}")
    for r, _ in orphan:
        print(f"      {r['filename']}  (id={r['id']})")

    # Unreferenced files: bytes occupying disk that no row claims.
    referenced = {(r["stored_path"] or "").replace("\\", "/") for r in rows}
    referenced |= {(r["filename"] or "").replace("\\", "/") for r in rows}
    unref = [n for n in on_disk if n not in referenced]
    print(f"  unreferenced files on disk: {len(unref)}")

    print()
    zero = sum(1 for r in rows if not r["file_size"])
    print(f"rows with file_size 0 or NULL: {zero} / {len(rows)}")

    # Analysis payload staleness, if a column exists.
    cols = {c[1] for c in conn.execute("PRAGMA table_info(audio_files)")}
    if "analysis_result" in cols:
        with_analysis = conn.execute(
            "SELECT COUNT(*) FROM audio_files WHERE analysis_result IS NOT NULL AND analysis_result != ''"
        ).fetchone()[0]
        print(f"rows carrying an analysis: {with_analysis} / {len(rows)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
