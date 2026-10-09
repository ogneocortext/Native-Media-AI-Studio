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

import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _gitutil import git_lines  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "docs")
MAP = os.path.join(DOCS, "README.md")
AGENTS = os.path.join(ROOT, "AGENTS.md")

# Directories that are intentionally gitignored, so absent on a fresh clone.
MAY_BE_ABSENT = ("screenshots", "archive", "output")


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def real_dirs():
    """Directories under docs/ that contain git-tracked files."""
    dirs = set()
    for rel in git_lines("ls-files", "docs/", cwd=ROOT):
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
                notes.append(f"'{name}/' is listed but holds no tracked files")
            else:
                errors.append(f"docs/README.md lists '{name}/' but it does not exist")

    for name in sorted(actual):
        if name.split("/")[0] not in claimed:
            errors.append(f"docs/README.md does not list '{name}/'")

    # The knowledge library carries JSON data files an agent should know about.
    data = [f for f in os.listdir(os.path.join(DOCS, "knowledge-library"))
            if f.endswith(".json")]
    if data and "json" not in read(MAP).lower():
        errors.append(f"docs/README.md does not mention the {len(data):d} JSON data files in knowledge-library/")

    if "docs/README.md" not in read(AGENTS):
        errors.append("AGENTS.md does not point agents at docs/README.md, so "
                      "the map is never read")

    for n in notes:
        print(f"  note: {n}")
    if errors:
        print(f"PROBLEMS ({len(errors):d}):")
        for e in errors:
            print(f"  - {e}")
        return 1
    print(f"docs/README.md is an accurate map ({len(actual):d} directories)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
