"""Give the cached analysis files names you can read.

The backend mints each analysis id as a truncated uuid (`uuid4().hex[:8]`), so
the cache fills up with `084564a8_analysis.json`. Nothing inside the file
records which track it describes, and the id cannot be reversed. The only
link is output/audio_analysis/index.json, which maps a track path to its id.

This renames each file to the track it belongs to and rewrites the index to
match, so the two never disagree. Files absent from the index are orphans: no
track can be recovered for them, so they are named from what the file itself
records (tempo and duration) rather than being given a fake track name.

    python tools/rename-analysis-cache.py --dry-run
    python tools/rename-analysis-cache.py

Backs the directory up first, and rolls the whole rename back if anything
fails partway.
"""
from __future__ import print_function

import io
import json
import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ADIR = os.path.join(ROOT, "output", "audio_analysis")
IDX = os.path.join(ADIR, "index.json")
BACKUP = os.path.join(ADIR, "_rename_backup")


def slugify(text):
    """Readable, filesystem-safe stem: 'Take the Crown', not '084564a8'."""
    text = text.rsplit("/", 1)[-1]          # drop any subdirectory
    text = re.sub(r"\.[A-Za-z0-9]{2,4}$", "", text)   # drop .mp3/.m4a
    text = re.sub(r"^[0-9a-f]{8}_", "", text)          # drop an id prefix
    text = re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-")
    return text[:70] or "unnamed"


def load(path):
    with io.open(path, encoding="utf-8") as fh:
        return json.load(fh)


def main():
    dry = "--dry-run" in sys.argv
    if not os.path.isdir(ADIR):
        print("no analysis cache at %s" % ADIR)
        return 0

    index = load(IDX)

    # id -> track path, from the index. The key may itself carry an id prefix,
    # so take the value when it is a plain id and the key otherwise.
    by_id = {}
    for key, val in index.items():
        if isinstance(val, str) and re.fullmatch(r"[0-9a-f]{8}", val):
            by_id[val] = key
        else:
            m = re.match(r"([0-9a-f]{8})_", key)
            if m:
                by_id.setdefault(m.group(1), key)

    plans = []
    for name in sorted(os.listdir(ADIR)):
        m = re.fullmatch(r"([0-9a-f]{8})_analysis\.json", name)
        if not m:
            continue
        aid = m.group(1)
        src = os.path.join(ADIR, name)
        track = by_id.get(aid)
        if track:
            stem = slugify(track)
            kind = "mapped"
        else:
            # No index entry: the track is genuinely unknown, so describe the
            # file by what it does contain rather than inventing a track name.
            try:
                data = load(src)
                stem = "orphan-%sbpm-%ss" % (
                    round(data.get("tempo_bpm") or 0),
                    round(data.get("duration_seconds") or 0))
            except Exception:
                stem = "orphan-" + aid
            kind = "ORPHAN"
        plans.append((aid, src, os.path.join(ADIR, stem + "_analysis.json"), kind))

    if not plans:
        print("nothing to rename")
        return 0

    taken = {os.path.basename(d) for _, _, d, _ in plans}
    print("%-10s %-8s %s" % ("old", "kind", "new"))
    print("-" * 78)
    for aid, src, dst, kind in plans:
        clash = "  (name already used - skipped)" if (
            os.path.exists(dst) and os.path.abspath(dst) != os.path.abspath(src)
        ) else ""
        print("%-10s %-8s %s%s" % (aid, kind, os.path.basename(dst), clash))
    print("-" * 78)
    print("%d file(s); index.json rewritten to match" % len(plans))

    if dry:
        print("\nre-run without --dry-run to apply")
        return 0

    if os.path.isdir(BACKUP):
        shutil.rmtree(BACKUP)
    shutil.copytree(ADIR, BACKUP)

    done = []
    try:
        for aid, src, dst, _ in plans:
            if os.path.abspath(src) == os.path.abspath(dst):
                continue
            if os.path.exists(dst):
                continue                      # keep both; never clobber
            os.rename(src, dst)
            done.append((aid, os.path.basename(dst)[:-len("_analysis.json")]))

        # Rewrite the index so its values name the files that now exist.
        for key, val in list(index.items()):
            if isinstance(val, str) and re.fullmatch(r"[0-9a-f]{8}", val):
                for aid, stem in done:
                    if val == aid:
                        index[key] = stem
                        break
        with io.open(IDX, "w", encoding="utf-8") as fh:
            json.dump(index, fh, indent=2, ensure_ascii=False)

    except Exception as exc:
        # Undo: put every renamed file back and restore the index verbatim.
        for aid, src, dst, _ in plans:
            if os.path.exists(dst) and not os.path.exists(src):
                os.rename(dst, src)
        shutil.copy2(os.path.join(BACKUP, "index.json"), IDX)
        shutil.rmtree(BACKUP)
        print("FAILED and rolled back: %s" % exc)
        return 1

    shutil.rmtree(BACKUP)
    print("done. backup removed; re-run to confirm the index still resolves.")
    return 0


if __name__ == "__main__":
    sys.exit(main())