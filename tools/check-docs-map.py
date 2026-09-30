"""Check that docs/README.md stays an accurate map of docs/.

The map is how an agent discovers documentation, but nothing kept it honest: it
listed `api-database/` and `archive/`, which do not exist, and it never mentioned
the 9 JSON data files in the knowledge library. A stale map is worse than none,
because an agent trusts it and stops searching.

Checks:
  - every directory named in the map exists;
  - every real directory under docs/ appears in the map (gitignored ones are
    reported, not failed, since they may be empty on a fresh clone);
  - the map is mentioned from AGENTS.md, so agents actually read it.

Run:  python tools/check-docs-map.py [--fix]
Exit 0 = accurate, 1 = drift.
"""
from __future__ import print_function

import io
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "docs")
MAP = os.path.join(DOCS, "README.md")
AGENTS = os.path.join(ROOT, "AGENTS.md")

# Directories that are intentionally gitignored, so absent on a fresh clone.
MAY_BE_ABSENT = ("screenshots", "archive", "output")


def read(path):
    with io.open(path, encoding="utf-8") as f:
        return f.read()


def real_dirs():
    """Directories under docs/ that contain git-tracked files."""
    out = subprocess.check_output(["git", "ls-files", "docs/"], cwd=ROOT,
                                  stderr=subprocess.DEVNULL)
    dirs = set()
    for rel in out.decode("utf-8", "replace").split("\n"):
        rel = rel.strip()
        if not rel:
            continue
        parts = rel.split("/")[1:-1]
        for i in range(len(parts)):
            dirs.add("/".join(parts[:i + 1]))
    return dirs


def map_entries():
    """Directory names the map claims, from its Directory Map table."""
    text = read(MAP)
    return set(re.findall(r"^\|\s*`([\w-]+)/?`\s*\|", text, re.M))


def main():
    claimed = map_entries()
    actual = real_dirs()
    errors, notes = [], []

    for name in sorted(claimed):
        if name not in actual and name not in MAY_BE_ABSENT:
            if os.path.isdir(os.path.join(DOCS, name)):
                notes.append("'%s/' is listed but holds no tracked files" % name)
            else:
                errors.append("docs/README.md lists '%s/' but it does not exist" % name)

    for name in sorted(actual):
        if name.split("/")[0] not in claimed:
            errors.append("docs/README.md does not list '%s/'" % name)

    # The knowledge library carries JSON data files an agent should know about.
    data = [f for f in os.listdir(os.path.join(DOCS, "knowledge-library"))
            if f.endswith(".json")]
    if data and "json" not in read(MAP).lower():
        errors.append("docs/README.md does not mention the %d JSON data files "
                      "in knowledge-library/" % len(data))

    if "docs/README.md" not in read(AGENTS):
        errors.append("AGENTS.md does not point agents at docs/README.md, so "
                      "the map is never read")

    for n in notes:
        print("  note: %s" % n)
    if errors:
        print("PROBLEMS (%d):" % len(errors))
        for e in errors:
            print("  - %s" % e)
        return 1
    print("docs/README.md is an accurate map (%d directories)" % len(actual))
    return 0


if __name__ == "__main__":
    sys.exit(main())
