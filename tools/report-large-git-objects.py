"""List the largest objects in git history, to diagnose repository size."""
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


# `rev-list --objects` prints "<sha> [<path>]" but no sizes, so get the sizes
# from `cat-file --batch-check`, which reads "<sha>" per line on stdin.
lines = git("rev-list", "--objects", "--all").splitlines()
shas = []
names = {}
for line in lines:
    sha, _, path = line.partition(" ")
    shas.append(sha)
    if path:
        names[sha] = path

sizes = {}
batch = git("cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)",
            stdin="\n".join(shas) + "\n")
for line in batch.splitlines():
    parts = line.split()
    if len(parts) == 3 and parts[1] == "blob" and parts[2].isdigit():
        sizes[parts[0]] = int(parts[2])

print(f"{'SIZE':>12}  PATH")
for sha, size in sorted(sizes.items(), key=lambda kv: -kv[1])[:20]:
    print(f"{size/1048576:9.1f} MB  {names.get(sha, '?')[:100]}")

total = sum(sizes.values())
print(f"\nblobs: {len(sizes)}   total blob bytes: {total/1073741824:.2f} GiB")
sys.exit(0)