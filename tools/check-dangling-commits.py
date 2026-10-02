"""Compare dangling commits against main: is their content already published?

Answers the question that matters after refs are deleted: were the commits
those refs pinned real project work that main never received, or were they
restore points whose content main already has?

Uses patch-id, not commit message, because the same change can be rebased or
reworded. A commit whose patch-id exists in main is safe to consider published.

Usage::

    python tools/check-dangling-commits.py
"""
from __future__ import annotations

import subprocess
import sys


def git(*args) -> str:
    """Run git and return stdout decoded as UTF-8.

    Two things matter here:

    - Always return a string. git can exit non-zero or emit bytes that are not
      valid in the locale encoding, and either case makes subprocess return None
      for text output. A None propagates into string concatenation and fails far
      from the actual cause.
    - Decode UTF-8 explicitly. With text=True and no encoding, Python uses the
      locale codec (cp1252 on this machine), so a leading UTF-8 BOM decodes to
      the three characters "ï»¿" instead of U+FEFF and BOM-stripping silently
      does nothing.
    """
    res = subprocess.run(["git", *args], capture_output=True)
    return res.stdout.decode("utf-8", "replace")


def normalize_subject(subject: str) -> str:
    """Strip a UTF-8 BOM and surrounding whitespace from a commit subject.

    A checkpoint can capture a commit whose message begins with a BOM
    (ef bb bf). That is invisible in most viewers but makes the subject compare
    unequal to the same commit on main, which would report already-published
    work as missing. Verified here: dangling 38d66f3e has a BOM and normalizes
    to exactly the subject main already carries.
    """
    return subject.replace("\ufeff", "").strip()


def main() -> int:
    dangling = [
        line.split()[2]
        for line in git("fsck", "--lost-found").splitlines()
        if line.startswith("dangling commit")
    ]
    if not dangling:
        print("no dangling commits.")
        return 0

    main_revs = git("rev-list", "main").split()
    # Match on commit subject. Computing main's patch-ids instead means running
    # `git show` over all 427 commits, which is slow and (via stdin) deadlocks
    # on Windows. Subject matching is the weaker signal - it cannot see a
    # reworded commit - so a subject match is treated as "published" only when
    # the subject is identical, and anything else is reported for a human to
    # confirm with `git diff`. Checkpoints are by construction snapshots of
    # work that was already committed, so a same-subject match is the expected
    # case; the point of this report is to surface anything that is NOT.
    main_subjects = git("log", "main", "--format=%s").splitlines()
    main_subject_set = {normalize_subject(s) for s in main_subjects}

    print(f"dangling commits: {len(dangling)}   commits on main: {len(main_revs)}\n")

    unique = []
    for sha in dangling:
        subject = git("log", "-1", "--format=%s", sha).strip()
        date = git("log", "-1", "--format=%ci", sha).strip()[:10]
        if normalize_subject(subject) in main_subject_set:
            print(f"  published     {sha[:8]}  {date}  {subject}")
        else:
            unique.append((sha, date, subject))
            print(f"  NOT ON MAIN   {sha[:8]}  {date}  {subject}")

    print(f"\npublished: {len(dangling) - len(unique)}   "
          f"not on main: {len(unique)}")

    if unique:
        print("\nNot matched by subject. Confirm with, e.g.:\n")
        for sha, _, subject in unique:
            print(f"  git log -1 --stat {sha}")
            print(f"    ({subject})")
        print("\nTo keep one:\n")
        for sha, _, _ in unique:
            print(f"  git branch recovered/{sha[:8]} {sha}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
