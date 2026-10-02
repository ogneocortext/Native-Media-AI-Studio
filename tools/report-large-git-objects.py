"""List the largest objects in git history, to diagnose repository size."""
import argparse
import subprocess
import sys


def git(*args, stdin=None):
    """Run git with stderr discarded.

    This repo has stray .git/objects/*/tmp_* files (from interrupted LFS
    operations), so git prints "warning: garbage found" on stderr. The command
    still succeeds, but the noise obscures real errors, so drop stderr.
    """
    return subprocess.run(
        ["git", *args], capture_output=True, text=True, input=stdin,
    ).stdout


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
    batch = git(
        "cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)",
        stdin="\n".join(shas) + "\n",
    )
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