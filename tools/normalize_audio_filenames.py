"""Normalize audio library filenames to the content-addressed scheme.

Every file in ``output/audio/`` becomes ``<sha256[:8]>_<clean name>.<ext>``
inside its existing subdirectory (``mastered/``, ``Suno-V6-Mini/``, ...).
``<clean name>`` is the current basename with machine-generated prefixes
stripped -- the same rule ``app.api.audio._clean_incoming_name`` applies to
new uploads, so old and new files end up identical in form.

What gets rewritten, in order:

1. The file on disk (``output/audio/**``).
2. ``audio_files.filename`` / ``stored_path`` and the ``stored_path`` +
   ``relative_path`` fields inside the ``analysis_result`` JSON blob.
3. ``output/audio_analysis/index.json`` keys (filename -> analysis hash).
4. ``stored_path`` / ``relative_path`` inside each ``*_analysis.json`` file.
5. ``media_*`` tables' ``relative_path`` values for renamed audio files.

``jobs``/``prompts``/session tables are historical records and are NOT
rewritten -- they describe what happened, not where a file lives now.

Safety:

- ``--dry-run`` (default) prints the full plan and changes nothing.
- ``--apply`` copies ``storage/studio.db`` to ``studio.db.bak-<ts>`` first.
- A rename whose target already exists is reported and skipped, never
  overwritten.
- Run while no analysis job is in flight: ``analyze-all`` writes rows under
  the old filenames and would resurrect them.

Usage::

    python tools/normalize_audio_filenames.py            # dry run
    python tools/normalize_audio_filenames.py --apply    # execute
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
AUDIO_DIR = PROJECT_ROOT / "output" / "audio"
ANALYSIS_DIR = PROJECT_ROOT / "output" / "audio_analysis"
DB_PATH = PROJECT_ROOT / "storage" / "studio.db"

# Same patterns as app.api.audio._INCOMING_PREFIX_RES -- duplicated here so
# this script has no app imports and can run against any checkout.
_PREFIX_RES = (
    re.compile(
        r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[-_.]?",
        re.IGNORECASE,
    ),
    re.compile(r"^[0-9a-f]{8}[-_]", re.IGNORECASE),
)


def clean_name(filename: str) -> str:
    """Strip machine prefixes from the stem; mirror of _clean_incoming_name."""
    path = Path(filename)
    stem, suffix = path.stem, path.suffix
    changed = True
    while changed:
        changed = False
        for rx in _PREFIX_RES:
            new = rx.sub("", stem, count=1)
            if new != stem:
                stem, changed = new, True
    stem = stem.lstrip("-_. ")
    return (stem or "track") + suffix


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_audio_path(stored_path: str, filename: str) -> Path | None:
    candidates = []
    if stored_path:
        p = Path(stored_path)
        candidates.append(p if p.is_absolute() else AUDIO_DIR / p)
    candidates.extend([AUDIO_DIR / filename, AUDIO_DIR / stored_path])
    for cand in candidates:
        if cand.is_file():
            return cand
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--apply", action="store_true", help="execute (default: dry run)")
    args = ap.parse_args()

    if not DB_PATH.is_file():
        print(f"database not found: {DB_PATH}", file=sys.stderr)
        return 1

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT id, filename, stored_path, content_hash FROM audio_files"
    ).fetchall()

    plan: list[dict] = []
    skipped: list[str] = []
    for row in rows:
        filename = row["filename"]
        old_path = resolve_audio_path(row["stored_path"] or "", filename)
        if old_path is None:
            skipped.append(f"{filename} (file missing)")
            continue

        content_hash = row["content_hash"] or sha256_file(old_path)
        prefix = content_hash[:8]
        rel_parent = str(Path(filename).parent)
        if rel_parent == ".":
            rel_parent = ""
        new_basename = f"{prefix}_{clean_name(Path(filename).name)}"
        new_filename = (
            f"{rel_parent}/{new_basename}" if rel_parent else new_basename
        )
        new_path = AUDIO_DIR / new_filename

        plan.append(
            {
                "id": row["id"],
                "old_filename": filename,
                "new_filename": new_filename,
                "old_path": old_path,
                "new_path": new_path,
                "content_hash": content_hash,
                "changed": filename != new_filename,
            }
        )

    changed = [p for p in plan if p["changed"]]

    # Collisions: target already on disk, or two rows mapping to the same
    # new name (e.g. `x.mp3` and `abc123_x.mp3` where abc123 is x's hash).
    seen_targets: dict[str, str] = {}
    for p in changed:
        key = str(p["new_path"])
        if p["new_path"].exists() or key in seen_targets:
            p["changed"] = False
            reason = (
                "target exists"
                if p["new_path"].exists()
                else f"also produced by {seen_targets[key]}"
            )
            skipped.append(f"{p['old_filename']} -> {p['new_filename']} ({reason})")
        else:
            seen_targets[key] = p["old_filename"]
    changed = [p for p in changed if p["changed"]]

    print(f"rows: {len(rows)}  renames: {len(changed)}  unchanged: {len(plan) - len(changed)}")
    for p in changed:
        print(f"  {p['old_filename']}\n    -> {p['new_filename']}")
    for s in skipped:
        print(f"  SKIP {s}")

    if not args.apply:
        print("\ndry run -- pass --apply to execute")
        conn.close()
        return 0

    if not changed:
        print("nothing to do")
        conn.close()
        return 0

    # Backup before touching anything.
    backup = DB_PATH.with_name(f"studio.db.bak-{datetime.now():%Y%m%d-%H%M%S}")
    shutil.copy2(DB_PATH, backup)
    print(f"backup: {backup}")

    # 1. Rename files on disk first; a DB update without the file would be
    #    worse than the reverse, so disk failures abort before DB writes.
    renamed_on_disk: list[tuple[Path, Path]] = []
    try:
        for p in changed:
            p["new_path"].parent.mkdir(parents=True, exist_ok=True)
            p["old_path"].rename(p["new_path"])
            renamed_on_disk.append((p["old_path"], p["new_path"]))
    except OSError as exc:
        # Roll back whatever already moved.
        for old, new in reversed(renamed_on_disk):
            try:
                new.rename(old)
            except OSError:
                pass
        print(f"disk rename failed ({exc}); rolled back, DB untouched", file=sys.stderr)
        conn.close()
        return 1

    # 2. DB rows + analysis blobs.
    for p in changed:
        conn.execute(
            "UPDATE audio_files SET filename = ?, stored_path = ?, "
            "content_hash = COALESCE(content_hash, ?) WHERE id = ?",
            (p["new_filename"], str(p["new_path"]), p["content_hash"], p["id"]),
        )
        row = conn.execute(
            "SELECT analysis_result FROM audio_files WHERE id = ?", (p["id"],)
        ).fetchone()
        if row and row["analysis_result"]:
            try:
                blob = json.loads(row["analysis_result"])
            except json.JSONDecodeError:
                blob = None
            if isinstance(blob, dict):
                blob["stored_path"] = str(p["new_path"])
                blob["relative_path"] = p["new_filename"]
                conn.execute(
                    "UPDATE audio_files SET analysis_result = ? WHERE id = ?",
                    (json.dumps(blob), p["id"]),
                )
    conn.commit()

    # 3. index.json keys.
    index_path = ANALYSIS_DIR / "index.json"
    if index_path.is_file():
        index = json.loads(index_path.read_text(encoding="utf-8"))
        for p in changed:
            if p["old_filename"] in index:
                index[p["new_filename"]] = index.pop(p["old_filename"])
        index_path.write_text(
            json.dumps(index, indent=2, ensure_ascii=False), encoding="utf-8"
        )

    # 4. Path fields inside analysis JSON files -- one pass, lookup by map.
    path_map = {
        p["old_filename"]: p["new_filename"] for p in changed
    }
    abs_map = {str(p["old_path"]): str(p["new_path"]) for p in changed}
    for analysis_file in ANALYSIS_DIR.glob("*_analysis.json"):
        try:
            data = json.loads(analysis_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(data, dict):
            continue
        dirty = False
        if data.get("relative_path") in path_map:
            data["relative_path"] = path_map[data["relative_path"]]
            dirty = True
        if data.get("stored_path") in abs_map:
            data["stored_path"] = abs_map[data["stored_path"]]
            dirty = True
        if dirty:
            analysis_file.write_text(
                json.dumps(data, ensure_ascii=False), encoding="utf-8"
            )

    # 5. media_* tables keyed by relative_path. Audio paths there are stored
    #    relative to output/ ('audio/<name>') or bare -- update both forms.
    media_updates = 0
    for table, col in (
        ("media_favorites", "relative_path"),
        ("media_collection_items", "relative_path"),
        ("media_item_tags", "relative_path"),
        ("media_trash", "relative_path"),
    ):
        for p in changed:
            for old_form, new_form in (
                (p["old_filename"], p["new_filename"]),
                (f"audio/{p['old_filename']}", f"audio/{p['new_filename']}"),
            ):
                cur = conn.execute(
                    f"UPDATE {table} SET {col} = ? WHERE {col} = ?",
                    (new_form, old_form),
                )
                media_updates += cur.rowcount
    conn.commit()
    conn.close()

    print(f"\napplied: {len(changed)} renames, {media_updates} media rows updated")
    print("restart the backend to clear in-memory analysis caches")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
