"""Reclaim local disk by dropping refs/cline/checkpoints/*.

Those checkpoint refs keep their own history alive, so objects that were never
published to the remote stay in the local object store forever. On this checkout
they pin a 2.9 GB .openclaw-backup-*/archive.tar.gz.tmp plus the torch CUDA DLLs
under tools/music-gen/.venv, none of which is reachable from main - git reports
3.59 GiB locally against 131 MB on GitHub.

Deleting them is safe with respect to published history: only refs outside
refs/heads and refs/remotes are removed, and main is verified unchanged
before and after. Remote branches are never touched.

Run with --apply to actually delete. Dry-run by default.

Usage::

    python tools/prune-checkpoint-refs.py
    python tools/prune-checkpoint-refs.py --apply
"""
from __future__ import annotations

import argparse
import subprocess
import sys

PROTECTED = ("refs/heads/", "refs/remotes/", "refs/tags/")


def git(*args):
    return subprocess.run(
        ["git", *args], capture_output=True, text=True,
    ).stdout.strip()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    main_before = git("rev-parse", "main")
    refs = [
        r for r in git("for-each-ref", "--format=%(refname)",
                       "refs/cline/checkpoints").splitlines()
        if r and not r.startswith(PROTECTED)
    ]

    print(f"main:        {main_before}")
    print(f"checkpoints: {len(refs)}")

    if not refs:
        print("\nnothing to prune.")
        return 0

    if not args.apply:
        print("\nDry run. Re-run with --apply to delete these refs, then run "
              "`git gc --prune=now` to reclaim the objects.")
        for r in refs[:5]:
            print(f"    {r}")
        if len(refs) > 5:
            print(f"    ... and {len(refs) - 5} more")
        return 0

    # One `update-ref -d` per ref. Batching through stdin (either the line-oriented
    # or the -z form) proved fragile here - both report "expected SP but got: ?"
    # and "invalid <old-oid>" on this machine, which points at the record
    # terminator being mangled rather than at the refs. 220 subprocess calls
    # costs a second or two and is unambiguous.
    failed = []
    for ref in refs:
        res = subprocess.run(
            ["git", "update-ref", "-d", ref], capture_output=True, text=True,
        )
        if res.returncode != 0:
            failed.append((ref, res.stderr.strip()))

    if failed:
        print(f"failed to delete {len(failed)} refs; first error:")
        for ref, err in failed[:3]:
            print(f"    {ref}: {err}")
        return 1

    main_after = git("rev-parse", "main")
    remaining = len([
        r for r in git("for-each-ref", "--format=%(refname)",
                       "refs/cline/checkpoints").splitlines() if r
    ])
    print(f"\ndeleted {len(refs)} refs; {remaining} remain")
    print(f"main unchanged: {main_before == main_after} ({main_after})")
    print("\nNow run:  git gc --prune=now --aggressive")
    print("(that reclaims the disk; --aggressive is slow but this is a one-off)")
    return 0


if __name__ == "__main__":
    sys.exit(main())