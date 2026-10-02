"""Reclaim local disk by dropping refs/cline/checkpoints/*.

Those checkpoint refs keep their own history alive, so objects that were never
published to the remote stay in the local object store forever. On this checkout
they pin a 2.9 GB .openclaw-backup-*/archive.tar.gz.tmp plus the torch CUDA DLLs
under tools/music-gen/.venv, none of which is reachable from main - git reports
3.59 GiB locally against 131 MB on GitHub.

Deleting them is safe for published history: only refs under
refs/cline/checkpoints are removed, and main is verified unchanged before and
after. Remote branches are never touched.

These are Cline's restore points, so pruning discards the ability to rewind an
older session from the Git refs. Retention is therefore age-based by default:
checkpoints newer than --max-age-days (14) are kept, so recent sessions stay
restorable and only stale ones are dropped. Pass --all to delete every one.

Run with --apply to actually delete. Dry-run by default.

Usage::

    python tools/prune-checkpoint-refs.py
    python tools/prune-checkpoint-refs.py --apply
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _gitutil import delete_ref, run_git  # noqa: E402

CHECKPOINT_REF = "refs/cline/checkpoints"
PROTECTED = ("refs/heads/", "refs/remotes/", "refs/tags/")


def git(*args: str) -> str:
    """Run git, discarding stderr. See tools/_gitutil.py for why."""
    return run_git(*args).strip()


def age_days(ref: str) -> float:
    """Days since the ref's commit was authored; 0.0 when unknown.

    Age-based retention keeps recent sessions restorable, so this discards old
    checkpoints instead of all of them.
    """
    raw = git("log", "-1", "--format=%ct", ref)
    try:
        return max(0.0, time.time() - int(raw)) / 86400.0
    except (TypeError, ValueError):
        return 0.0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--max-age-days", type=float, default=14.0,
                    help="delete checkpoints older than this (default: 14). "
                         "Use 0 with --all to delete every checkpoint.")
    ap.add_argument("--all", action="store_true",
                    help="delete every checkpoint regardless of age")
    args = ap.parse_args()

    main_before = git("rev-parse", "main")
    refs = [
        r for r in git("for-each-ref", "--format=%(refname)",
                       CHECKPOINT_REF).splitlines()
        if r and not r.startswith(PROTECTED)
    ]

    cutoff = 0.0 if args.all else args.max_age_days
    doomed = [r for r in refs if age_days(r) >= cutoff]
    kept = [r for r in refs if r not in doomed]

    print(f"main:        {main_before}")
    print(f"checkpoints: {len(refs)}")
    print(f"delete (age >= {cutoff:g}d): {len(doomed)}")
    print(f"keep (recent):             {len(kept)}")

    if not doomed:
        print("\nnothing to prune.")
        return 0

    if not args.apply:
        print("\nDry run. Re-run with --apply to delete these refs, then run "
              "`git gc --prune=now` to reclaim the objects.")
        for r in doomed[:5]:
            print(f"    {r}")
        if len(doomed) > 5:
            print(f"    ... and {len(doomed) - 5} more")
        return 0

    # One `update-ref -d` per ref. Batching through stdin (either the line-oriented
    # or the -z form) proved fragile here - both report "expected SP but got: ?"
    # and "invalid <old-oid>" on this machine, which points at the record
    # terminator being mangled rather than at the refs. 220 subprocess calls
    # costs a second or two and is unambiguous.
    failed = []
    for ref in doomed:
        ok, err = delete_ref(ref)
        if not ok:
            failed.append((ref, err))

    if failed:
        print(f"failed to delete {len(failed)} refs; first error:")
        for ref, err in failed[:3]:
            print(f"    {ref}: {err}")
        return 1

    main_after = git("rev-parse", "main")
    remaining = len([
        r for r in git("for-each-ref", "--format=%(refname)",
                       CHECKPOINT_REF).splitlines() if r
    ])
    print(f"\ndeleted {len(doomed)} refs; {remaining} remain "
          f"({len(kept)} kept as recent)")
    print(f"main unchanged: {main_before == main_after} ({main_after})")
    print("\nNow run:  git gc --prune=now --aggressive")
    print("(that reclaims the disk; --aggressive is slow but this is a one-off)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
