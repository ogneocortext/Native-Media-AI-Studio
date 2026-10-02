#!/usr/bin/env python3
"""Delete audio files on disk that no audio_files row still references.

``dedupe-audio-uploads.py`` retires duplicate rows; this removes the files those
rows pointed at. The two are separate steps on purpose: dropping the rows first
leaves the duplicates as orphans, and they still occupy disk.

Dry-run by default; pass --apply to delete. Only files that no database row
references are touched - a file that is merely named with a legacy uuid is left
in place, because renaming it would break the row that points at it.

Usage::

    python tools/prune-orphan-audio.py
    python tools/prune-orphan-audio.py --apply
"""
from __future__ import annotations

import argparse
import hashlib
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _toolutil import AUDIO_DIR as DEFAULT_AUDIO  # noqa: E402
from _toolutil import DEFAULT_DB


def content_id(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        while chunk := fh.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()[:8]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--audio-dir", type=Path, default=DEFAULT_AUDIO)
    ap.add_argument("--apply", action="store_true", help="delete the orphans")
    args = ap.parse_args()

    if not args.db.exists():
        print(f"database not found: {args.db}")
        return 1
    if not args.audio_dir.is_dir():
        print(f"audio dir not found: {args.audio_dir}")
        return 1

    conn = sqlite3.connect(args.db)
    referenced = {
        row[0] for row in conn.execute("SELECT filename FROM audio_files")
        if row[0]
    }

    on_disk = {
        p.relative_to(args.audio_dir).as_posix(): p
        for p in args.audio_dir.rglob("*")
        if p.is_file()
    }
    orphans = [p for name, p in sorted(on_disk.items()) if name not in referenced]
    missing = sorted(referenced - set(on_disk))

    # Safety: only delete an orphan when a file that IS still referenced has
    # byte-identical content. That proves the orphan is a redundant duplicate of
    # something being kept, rather than a unique file that merely has no row.
    #
    # This also excludes artwork (.jpg) and lyric (.lrc) sidecars, which share
    # the audio directory but are not analysis inputs and are not duplicated.
    kept_digests: dict[tuple[int, str], str] = {}
    for name in sorted(referenced):
        p = on_disk.get(name)
        if p is not None:
            st = p.stat()
            kept_digests[(st.st_size, hashlib.sha256(p.read_bytes()).hexdigest())] = name

    deletable, keep_orphan = [], []
    for p in orphans:
        st = p.stat()
        sig = (st.st_size, hashlib.sha256(p.read_bytes()).hexdigest())
        if sig in kept_digests:
            deletable.append((p, kept_digests[sig]))
        else:
            keep_orphan.append(p)

    orphans_mb = sum(p.stat().st_size for p, _ in deletable) / 1048576
    print(f"referenced by db: {len(referenced)}")
    print(f"on disk:          {len(on_disk)}")
    print(f"missing on disk:  {len(missing)}")
    for name in missing:
        print(f"    missing: {name}")
    print(f"unreferenced:     {len(orphans)}")
    print(f"  exact duplicates of a kept file (safe to delete): {len(deletable)} "
          f"({orphans_mb:.1f} MB)")
    print(f"  not duplicated (left alone): {len(keep_orphan)}")

    if deletable:
        print("\nsafe to delete:")
        for p, twin in deletable:
            print(f"    {p.stat().st_size/1048576:8.2f} MB  {p.name}")
            print(f"                    duplicate of kept: {twin}")
    if keep_orphan:
        print("\nleft alone (no identical file is referenced; artwork, lyrics, "
              "or unique audio):")
        for p in keep_orphan:
            print(f"    {p.stat().st_size/1048576:8.2f} MB  {p.name}")

    if not deletable:
        print("\nnothing safe to prune.")
        return 0

    if not args.apply:
        print(f"\nDry run. Re-run with --apply to delete {len(deletable)} duplicate "
              f"files ({orphans_mb:.1f} MB).")
        return 0

    freed = 0
    for p, _ in deletable:
        freed += p.stat().st_size
        p.unlink()
    print(f"\ndeleted {len(deletable)} files, freed {freed/1048576:.1f} MB")
    print(f"left in place: {len(keep_orphan)} unreferenced files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
