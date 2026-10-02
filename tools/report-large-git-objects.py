"""List the largest objects in git history, to diagnose repository size."""
import argparse
import os
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _gitutil import run_git  # noqa: E402


def git(*args: str) -> str:
    """Run git, discarding stderr.

    The repo has stray .git/objects/*/tmp_* files from interrupted LFS
    operations, so git prints "warning: garbage found" on stderr. The command
    still succeeds, but the noise obscures real errors.

    Returns an empty string rather than None so callers can call .splitlines()
    unconditionally; a failed git call must not raise AttributeError somewhere
    unrelated.
    """
    return run_git(*args)


def report(rev: str, limit: int) -> None:
    # `rev-list --objects` prints "<sha> [<path>]" but no sizes, so get the
    # sizes from `cat-file --batch-check`, which reads "<sha>" per line.
    shas, names = [], {}
    for line in git("rev-list", "--objects", rev).splitlines():
        sha, _, path = line.partition(" ")
        shas.append(sha)
        if path:
            names[sha] = path

    sizes = {}
    # Pass the sha list on stdin via a file, not a pipe. `git cat-file
    # --batch-check` wants one sha per line, and handing it a large stream
    # through a subprocess pipe deadlocks the reader thread on Windows
    # (observed as a _readerthread traceback and empty output). A temp file
    # avoids that; it is unlinked in a finally so a failure cannot leave it.
    with tempfile.NamedTemporaryFile("w", suffix=".shas", delete=False,
                                     encoding="utf-8") as tmp:
        tmp.write("\n".join(shas) + "\n")
        sha_file = tmp.name
    try:
        with open(sha_file, encoding="utf-8") as stream:
            batch = subprocess.run(
                ["git", "cat-file",
                 "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
                stdin=stream, capture_output=True,
            ).stdout.decode("utf-8", "replace")
    finally:
        os.unlink(sha_file)
    for line in batch.splitlines():
        parts = line.split()
        if len(parts) == 3 and parts[1] == "blob" and parts[2].isdigit():
            sizes[parts[0]] = int(parts[2])

    print(f"=== {rev} ===")
    print(f"{'SIZE':>12}  PATH")
    for sha, size in sorted(sizes.items(), key=lambda kv: -kv[1])[:limit]:
        print(f"{size/1048576:9.1f} MB  {names.get(sha, '?')[:100]}")
    total = sum(sizes.values())
    print(f"blobs: {len(sizes)}   total: {total/1073741824:.2f} GiB\n")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--rev", default="--all",
                    help="what to inspect; --all includes checkpoint refs, "
                         "main shows only what is actually published")
    ap.add_argument("--limit", type=int, default=20)
    args = ap.parse_args()

    report(args.rev, args.limit)

    if args.rev != "--all":
        print("Only --all is meaningful for finding bloat: refs/cline/checkpoints "
              "keeps\nits own history alive locally and can dwarf what is on "
              "the remote.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
