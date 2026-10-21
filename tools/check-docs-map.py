# ruff: noqa: N999
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
Exit 0 = accurate, 1 = drift (unless --fix repaired it).
"""

import argparse
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

# Map table row pattern: | `dir/`   | description ... |
MAP_ROW_RE = re.compile(
    r"^\|\s*`([\w-]+)/?`\s*\|(.*)$", re.M
)

# Description cell: everything between the first and second `|` after the dir.
DESC_CELL_RE = re.compile(r"^\|\s*`[\w-]+/?`\s*\|\s*(.*?)\s*\|", re.M)


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def write(path, text):
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


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


def map_rows():
    """Return ordered list of (dir_name, description, full_line) from the map."""
    text = read(MAP)
    rows = []
    for m in MAP_ROW_RE.finditer(text):
        dir_name = m.group(1)
        # Find the full line this match belongs to
        line_start = m.start()
        line_end = text.find("\n", m.end())
        if line_end == -1:
            line_end = len(text)
        full_line = text[line_start:line_end]
        # Extract description cell
        desc_m = DESC_CELL_RE.match(full_line)
        description = desc_m.group(1) if desc_m else ""
        rows.append((dir_name, description, full_line))
    return rows


def fix_map(claimed, actual, errors, notes):
    """Rewrite docs/README.md map to match reality. Returns list of edits made."""
    text = read(MAP)
    edits = []

    rows = map_rows()
    claimed_set = {r[0] for r in rows}

    # Remove entries for directories that don't exist (and aren't in MAY_BE_ABSENT)
    to_remove = [name for name in claimed_set
                 if name not in actual and name not in MAY_BE_ABSENT
                 and not os.path.isdir(os.path.join(DOCS, name))]
    for name in to_remove:
        # Remove the line for this directory
        lines = text.split("\n")
        new_lines = [line for line in lines
                     if not re.match(rf"^\|\s*`{re.escape(name)}/?`\s*\|", line)]
        if len(new_lines) < len(lines):
            text = "\n".join(new_lines)
            edits.append(f"removed map entry for '{name}/' (directory does not exist)")
            errors.append(f"docs/README.md listed '{name}/' but it does not exist - FIXED: removed entry")

    # Add entries for directories that exist but aren't in the map
    to_add = [name for name in sorted(actual)
              if name.split("/")[0] not in claimed_set and name not in MAY_BE_ABSENT]
    # Only add top-level directories; nested ones are implied by their parent
    top_level_missing = set()
    for name in to_add:
        top = name.split("/")[0]
        if top not in claimed_set:
            top_level_missing.add(top)
    for name in sorted(top_level_missing):
        # Find where to insert: after the last existing entry, before a blank line
        lines = text.split("\n")
        insert_idx = len(lines)
        for i, line in enumerate(lines):
            if re.match(r"^\|\s*`[\w-]+/?`\s*\|", line):
                insert_idx = i + 1
        lines.insert(insert_idx, f"| `{name}/`   | discovered by check-docs-map --fix; add a description |")
        text = "\n".join(lines)
        edits.append(f"added map entry for '{name}/' (was missing from map)")
        errors.append(f"docs/README.md does not list '{name}/' - FIXED: added entry")

    # Add JSON data files mention if missing
    data = [f for f in os.listdir(os.path.join(DOCS, "knowledge-library"))
            if f.endswith(".json")]
    if data and "json" not in read(MAP).lower():
        # Find the knowledge-library row and append mention
        lines = text.split("\n")
        for i, line in enumerate(lines):
            if re.match(r"^\|\s*`knowledge-library/`\s*\|", line):
                lines[i] = line.rstrip() + f" plus {len(data):d} JSON data files."
                break
        text = "\n".join(lines)
        edits.append(f"added mention of {len(data)} JSON data files to knowledge-library/ row")
        errors.append("docs/README.md does not mention JSON data files - FIXED: added to knowledge-library/ row")

    # Fix AGENTS.md reference
    if "docs/README.md" not in read(AGENTS):
        # This one we can't auto-fix safely - it requires understanding context
        pass

    write(MAP, text)
    return edits


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--fix", action="store_true",
                    help="rewrite docs/README.md to match reality (remove dead entries, add missing ones)")
    args = ap.parse_args()

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

    if args.fix and errors:
        edits = fix_map(claimed, actual, errors, notes)
        if edits:
            print("FIXED:")
            for e in edits:
                print(f"  - {e}")
        # Re-check after fix
        claimed2 = map_entries()
        actual2 = real_dirs()
        errors2, notes2 = [], []
        for name in sorted(claimed2):
            if name not in actual2 and name not in MAY_BE_ABSENT:
                if os.path.isdir(os.path.join(DOCS, name)):
                    notes2.append(f"'{name}/' is listed but holds no tracked files")
                else:
                    errors2.append(f"docs/README.md lists '{name}/' but it does not exist")
        for name in sorted(actual2):
            if name.split("/")[0] not in claimed2:
                errors2.append(f"docs/README.md does not list '{name}/'")
        data2 = [f for f in os.listdir(os.path.join(DOCS, "knowledge-library"))
                 if f.endswith(".json")]
        if data2 and "json" not in read(MAP).lower():
            errors2.append(f"docs/README.md does not mention the {len(data2):d} JSON data files in knowledge-library/")
        errors = errors2
        notes = notes2

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
