#!/usr/bin/env python3
"""Generate the docs tracker: per-document date, author, and tags.

The repo has no single place that says who wrote a doc, when, or how many
docs were written on any given day. This builds that from two existing
sources so it stays honest without manual bookkeeping:

  1. frontmatter `date:` (written date) and `tags:` in each doc
  2. git history — the author of the last commit that touched the file,
     read from the `Co-authored-by:` trailer (the repo's attribution rule)

Usage:
    python tools/docs-tracker.py            # prints summary + writes output/docs-tracker.json
    python tools/docs-tracker.py --json      # prints the JSON to stdout instead

The tracker is generated, not curated: a doc with no `date:` frontmatter
reports `date: null` rather than being silently skipped, so the gaps are
visible instead of hidden.
"""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "output" / "docs-tracker.json"
TRAILER = re.compile(r"Co-authored-by:\s*(.+?)\s*<", re.MULTILINE)


def frontmatter(path: Path):
    """Return (date, tags, author) from a markdown file's frontmatter."""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None, [], None
    if not text.startswith("---"):
        return None, [], None
    lines = text.splitlines()
    date, tags, author = None, [], None
    for line in lines[1:40]:
        if line.startswith("---"):
            break
        if line.startswith("date:"):
            date = line.split(":", 1)[1].strip()
        elif line.startswith("tags:"):
            continue
        elif line.strip().startswith("- "):
            tags.append(line.strip()[2:].strip())
        elif line.startswith("author:"):
            author = line.split(":", 1)[1].strip()
    return date, tags, author


def git_author(path: Path):
    """Author of the last commit touching `path`, from the Co-authored-by trailer."""
    rel = path.relative_to(ROOT).as_posix()
    try:
        out = subprocess.run(
            ["git", "log", "-1", "--format=%H%x00%B", "--", rel],
            cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
        ).stdout
    except OSError:
        return None
    if not out:
        return None
    body = out.split("\x00", 1)[1] if "\x00" in out else out
    m = TRAILER.search(body)
    return m.group(1).strip() if m else None


def main():
    docs = []
    for path in sorted(Path(ROOT / "docs").rglob("*.md")):
        date, tags, author = frontmatter(path)
        if author is None:
            author = git_author(path)
        docs.append({
            "path": path.relative_to(ROOT).as_posix(),
            "date": date,
            "author": author,
            "tags": tags,
        })

    by_date = {}
    for d in docs:
        by_date.setdefault(d["date"] or "unknown", []).append(d["path"])

    summary = {
        "total_docs": len(docs),
        "with_date": sum(1 for d in docs if d["date"]),
        "with_author": sum(1 for d in docs if d["author"]),
        "by_date": {k: len(v) for k, v in sorted(by_date.items(), key=lambda x: str(x[0]))},
        "docs": docs,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")

    if "--json" in sys.argv:
        print(json.dumps(summary, indent=2))
        return 0

    print(f"docs tracked: {summary['total_docs']} "
          f"({summary['with_date']} dated, {summary['with_author']} attributed)")
    print("written per day:")
    for day, count in summary["by_date"].items():
        print(f"  {day}: {count}")
    print(f"\nwrote {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())