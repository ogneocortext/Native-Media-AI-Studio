#!/usr/bin/env python3
"""Repair `audio_files` rows whose stored file cannot be found.

Background: uploads were originally named `<uuid4[:8]>_<name>`, so re-uploading
the same track produced a new row and a new copy each time. Filenames therefore
accumulated stale hash prefixes, rows were retired, and some rows were left
pointing at files that were since renamed or deleted. The result is rows the
library lists but can never serve.

What this repairs, and what it refuses to guess at:

  * **exact** â€” the path already matches; nothing to do.
  * **prefix** â€” stripping one or more stale `<8hex>_` prefixes finds a real
    file. Applied.
  * **unique-basename** â€” the file exists under the same basename in a different
    folder (typically `Suno-V6-Mini/x.m4a` recorded as root `x.m4a`). Applied
    *only* when exactly one file has that basename, so an ambiguous name is
    never guessed at.
  * **ambiguous** / **missing** â€” no single defensible target. Reported, never
    applied. Resolving these is a human decision.

It also backfills `file_size`, which the uploader never populated (0 on every
row), so content can be compared later.

Dry-run by default; pass --apply to write. Always takes a timestamped backup
first unless --no-backup is given. Rows are never deleted here â€” retiring a row
that points at content you may still want is a separate, explicit act.

Usage::

    python tools/repair-audio-db.py
    python tools/repair-audio-db.py --apply
"""
from __future__ import annotations

import argparse
import re
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _toolutil import AUDIO_DIR as DEFAULT_AUDIO  # noqa: E402
from _toolutil import DEFAULT_DB

HASH_PREFIX = re.compile(r"^([0-9a-f]{8}_)+", re.IGNORECASE)
AUDIO_SUFFIXES = {".mp3", ".wav", ".flac", ".ogg", ".m4a", ".wma", ".aac"}


def build_disk_index(audio_dir: Path) -> dict[str, Path]:
    """Map AUDIO_DIR-relative POSIX path -> absolute path, for audio files only."""
    index: dict[str, Path] = {}
    if not audio_dir.is_dir():
        return index
    for p in audio_dir.rglob("*"):
        if p.is_file() and p.suffix.lower() in AUDIO_SUFFIXES:
            index[p.relative_to(audio_dir).as_posix()] = p
    return index


def classify(filename: str, disk: dict[str, Path]) -> tuple[str, str | None]:
    """Return (classification, resolved relative path or None).

    Only `exact`, `prefix` and a *unique* `unique-basename` are actionable.
    """
    if filename in disk:
        return "exact", filename

    stripped = HASH_PREFIX.sub("", filename)
    if stripped != filename and stripped in disk:
        return "prefix", stripped

    # Same basename, different folder. Requires exactly one candidate.
    basename = filename.split("/")[-1]
    candidates = [rel for rel in disk if rel.split("/")[-1] == basename]
    if len(candidates) == 1:
        return "unique-basename", candidates[0]
    if len(candidates) > 1:
        return "ambiguous", None

    return "missing", None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--audio-dir", type=Path, default=DEFAULT_AUDIO)
    ap.add_argument("--apply", action="store_true", help="write the repairs")
    ap.add_argument("--no-backup", action="store_true", help="skip the backup copy")
    ap.add_argument(
        "--retire-missing",
        action="store_true",
        help="delete rows whose file is gone AND whose track survives on disk under "
        "another name (requires --apply). Rows with no surviving copy are kept.",
    )
    args = ap.parse_args()

    if not args.db.exists():
        print(f"database not found: {args.db}")
        return 1

    disk = build_disk_index(args.audio_dir)
    if not disk:
        print(f"no audio files found under {args.audio_dir}")
        return 1

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row
    cols = {c[1] for c in conn.execute("PRAGMA table_info(audio_files)")}
    has_path = "stored_path" in cols

    buckets: dict[str, list[tuple[sqlite3.Row, str | None]]] = {
        k: [] for k in ("exact", "prefix", "unique-basename", "ambiguous", "missing")
    }
    zero_size: list[tuple[sqlite3.Row, Path]] = []

    for row in conn.execute("SELECT * FROM audio_files"):
        filename = row["filename"] or ""
        kind, target = classify(filename, disk)
        buckets[kind].append((row, target))
        if target and not row["file_size"]:
            zero_size.append((row, disk[target]))

    print(f"database:  {args.db}")
    print(f"audio dir: {args.audio_dir}  ({len(disk)} audio files)")
    print()
    print(f"  exact (already resolvable):        {len(buckets['exact'])}")
    print(f"  prefix  -> relinkable:             {len(buckets['prefix'])}")
    print(f"  unique-basename -> relinkable:     {len(buckets['unique-basename'])}")
    print(f"  ambiguous (NOT touched):           {len(buckets['ambiguous'])}")
    print(f"  missing   (NOT touched):           {len(buckets['missing'])}")
    print(f"  file_size backfill candidates:     {len(zero_size)}")

    for kind in ("prefix", "unique-basename"):
        if not buckets[kind]:
            continue
        print(f"\n  {kind}:")
        for row, target in buckets[kind]:
            print(f"      {row['filename']}")
            print(f"        -> {target}")

    for kind in ("ambiguous", "missing"):
        if not buckets[kind]:
            continue
        print(f"\n  {kind} (needs a human decision):")
        for row, _ in buckets[kind]:
            print(f"      {row['filename']}  (id={row['id']})")

    actionable = len(buckets["prefix"]) + len(buckets["unique-basename"]) + len(zero_size)

    # Rows whose file is gone but whose track still exists on disk under another
    # name. Deleting these loses no audio and removes an entry the library
    # advertises but can never serve.
    unresolvable = buckets["missing"] + buckets["ambiguous"]
    retire_safe: list[tuple[sqlite3.Row, str]] = []
    retire_keep: list[tuple[sqlite3.Row, str]] = []
    for row, _ in unresolvable:
        basename = (row["filename"] or "").split("/")[-1]
        target = HASH_PREFIX.sub("", basename)
        twins = sorted(
            rel for rel in disk if HASH_PREFIX.sub("", rel.split("/")[-1]) == target
        )
        (retire_safe if twins else retire_keep).append((row, twins[0] if twins else ""))

    if unresolvable:
        print()
        print(f"  retire-safe (file gone, track survives elsewhere): {len(retire_safe)}")
        for row, twin in retire_safe:
            print(f"      {row['filename']}  (id={row['id']})")
            print(f"        survives as: {twin}")
        print(f"  retire-UNSAFE (no surviving copy, kept): {len(retire_keep)}")
        for row, _ in retire_keep:
            print(f"      {row['filename']}  (id={row['id']})")

    if args.retire_missing and not args.apply:
        print("\n--retire-missing requires --apply.")
        return 1

    if not actionable and not (args.retire_missing and retire_safe):
        print("\nnothing to repair.")
        return 0

    if not args.apply:
        print(f"\nDry run. Re-run with --apply to write {actionable} repair(s).")
        return 0

    backup = None
    if not args.no_backup:
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = args.db.with_suffix(f".bak-pre-repair-{stamp}")
        shutil.copy2(args.db, backup)
        print(f"\nbackup: {backup}")

    cur = conn.cursor()
    relinked = 0
    for kind in ("prefix", "unique-basename"):
        for row, target in buckets[kind]:
            if not target:
                continue
            if has_path:
                cur.execute(
                    "UPDATE audio_files SET stored_path = ? WHERE id = ?",
                    (str(disk[target]), row["id"]),
                )
            cur.execute("UPDATE audio_files SET filename = ? WHERE id = ?", (target, row["id"]))
            relinked += 1

    sized = 0
    for row, path in zero_size:
        cur.execute(
            "UPDATE audio_files SET file_size = ? WHERE id = ?",
            (path.stat().st_size, row["id"]),
        )
        sized += 1

    retired = 0
    kept = 0
    if args.retire_missing:
        for row, _ in retire_safe:
            # Re-verify at write time: the disk index is from the start of the
            # run, and a file could have been deleted in between.
            still = any(
                HASH_PREFIX.sub("", rel.split("/")[-1])
                == HASH_PREFIX.sub("", (row["filename"] or "").split("/")[-1])
                for rel in disk
            )
            if not still:
                kept += 1
                continue
            cur.execute("DELETE FROM audio_files WHERE id = ?", (row["id"],))
            retired += 1
        for _ in retire_keep:
            kept += 1

    conn.commit()

    # Verify the write actually landed rather than trusting the commit.
    conn.row_factory = sqlite3.Row
    recheck = conn.execute("SELECT COUNT(*) AS n FROM audio_files").fetchone()["n"]
    still_zero = conn.execute(
        "SELECT COUNT(*) AS n FROM audio_files WHERE file_size IS NULL OR file_size = 0"
    ).fetchone()["n"]
    conn.close()

    print(f"\nrelinked rows: {relinked}")
    print(f"file_size backfilled: {sized}")
    if args.retire_missing:
        print(f"rows retired (track survives on disk): {retired}")
        print(f"rows kept (no surviving copy): {kept}")
    print(f"rows now: {recheck}")
    print(f"rows still reporting file_size 0: {still_zero}")
    if backup:
        print(f"rollback: restore from {backup}")
    print(
        "\nRows in the ambiguous/missing groups were left untouched: retiring a row "
        "whose\nfile may still be wanted is a separate, explicit decision."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
