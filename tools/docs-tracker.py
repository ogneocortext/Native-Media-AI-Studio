#!/usr/bin/env python3
"""Generate the docs tracker: per-document date, author, and tags.

The repo has no single place that says who wrote a doc, when, or how many
docs were written on any given day. This builds that from two existing
sources so it stays honest without manual bookkeeping:

1. frontmatter `date:` (written date) and `tags:` in each doc
2. git history — the date and author of the last commit that touched the
   file, read from the commit's `Co-authored-by:` trailer (the repo's
   attribution rule). Used as a fallback for docs whose frontmatter has
   no `date:`/`author`, so the tracker is complete rather than partial.

Usage:
    python tools/docs-tracker.py            # prints summary + writes output/docs-tracker.json
    python tools/docs-tracker.py --json      # prints the JSON to stdout instead

The tracker is generated, not curated. A doc whose frontmatter carries no
`date:` falls back to its last commit date and is flagged `source: "git"`
so the two are never confused.
"""

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "output" / "docs-tracker.json"
TRAILER = re.compile(r"Co-authored-by:\s*(.+?)\s*<", re.MULTILINE)

# Work areas, keyed by the doc's directory prefix. A doc maps to the first
# matching rule, so the lane a doc lands in is decided by where it lives --
# not by a tag someone has to remember to add. Used to answer "which areas
# need the most work" rather than just "when were docs written".
# Specific rules come before the `docs` catch-all, so docs/scratch and
# docs/notes classify as scratch/notes rather than as hygiene.
LANES = [
    ("visualizer", "Visualizer (2.x)"),
    ("motion", "Motion lane (F1-F5)"),
    ("remix", "Remix / mashup"),
    ("audio", "Audio mastering & stems"),
    ("video", "Video generation"),
    ("creative", "Creative onboarding & UX"),
    ("knowledge-library", "Knowledge library"),
    ("knowledge", "Knowledge library"),
    ("architecture", "Architecture & decisions"),
    ("plans", "Plans & roadmaps"),
    ("ux", "UX audit"),
    ("setup", "Setup & requirements"),
    ("scratch", "Scratch (not authoritative)"),
    ("notes", "Notes (not authoritative)"),
    ("guides", "Guides"),
    ("api", "API reference"),
    ("visual-storytelling", "Storyboards & visual storytelling"),
    ("docs", "Docs & hygiene"),
]


def lane_of(rel: str) -> str:
    """Work area for a doc path, from its directory prefix.

    Evaluated relative to `docs/` -- every tracked doc lives under docs/, so
    checking the full path against a subdirectory prefix would match nothing.
    """
    sub = rel[len("docs/"):] if rel.startswith("docs/") else rel
    # Root-level docs/ files (README.md, TESTING_WORKFLOWS.md, ...) have no
    # subdirectory to key off, so classify them by basename instead.
    if "/" not in sub:
        stem = sub[:-len(".md")] if sub.endswith(".md") else sub
        return {
            "README": "Docs & hygiene",
            "SYSTEM_REQUIREMENTS": "Setup & requirements",
            "TESTING_WORKFLOWS": "Docs & hygiene",
            "ENHANCEMENT_RECOMMENDATIONS": "Docs & hygiene",
            "agent-shell-cheatsheet": "Docs & hygiene",
        }.get(stem, "Docs & hygiene")
    for prefix, name in LANES:
        if sub.startswith(prefix + "/") or sub == prefix:
            return name
    return "Other"


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


def git_authors(paths):
    """Authors of the last commit touching each path, from Co-authored-by trailer.

    Batch git log over all paths in one subprocess call instead of one call
    per file -- the per-file version spawned N subprocesses for N docs.
    """
    if not paths:
        return {}
    rels = [p.relative_to(ROOT).as_posix() for p in paths]
    try:
        out = subprocess.run(
            ["git", "log", "--all", "--format=%H%x00%an", "--name-only", "--"] + rels,
            cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
        ).stdout
    except OSError:
        return {}
    authors = {}
    current_author = None
    for line in out.splitlines():
        if chr(0) in line:
            current_author = line.split(chr(0), 1)[1]
        elif line.strip():
            rel = line.strip()
            if rel not in authors:
                authors[rel] = current_author
    return authors


def git_dates(paths):
    """Last-commit date per path, as YYYY-MM-DD.

    Batched into one git call. Used as a fallback for docs whose frontmatter
    carries no `date:` — every tracked file has a commit, so this makes the
    tracker complete instead of leaving 74 docs as `date: null`.
    """
    if not paths:
        return {}
    rels = [p.relative_to(ROOT).as_posix() for p in paths]
    try:
        out = subprocess.run(
            ["git", "log", "--all", "--format=%H%x00%cd", "--date=short",
             "--name-only", "--"] + rels,
            cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
        ).stdout
    except OSError:
        return {}
    dates = {}
    current = None
    for line in out.splitlines():
        if chr(0) in line:
            current = line.split(chr(0), 1)[1]
        elif line.strip():
            rel = line.strip()
            if rel not in dates:
                dates[rel] = current
    return dates


def main():
    docs = []
    no_author_paths = []
    no_date_paths = []
    for path in sorted(Path(ROOT / "docs").rglob("*.md")):
        date, tags, author = frontmatter(path)
        if author is None:
            no_author_paths.append(path)
        if date is None:
            no_date_paths.append(path)
        docs.append({
            "path": path.relative_to(ROOT).as_posix(),
            "lane": lane_of(path.relative_to(ROOT).as_posix()),
            "date": date,
            "source": "frontmatter" if date else None,
            "author": author,
            "tags": tags,
        })

    # Batch git log for docs missing frontmatter author or date, before the
    # summary is computed -- otherwise the fallback dates never reach by_date.
    batch_authors = git_authors(no_author_paths)
    batch_dates = git_dates(no_date_paths)
    for d in docs:
        if d["author"] is None:
            d["author"] = batch_authors.get(d["path"])
        if d["date"] is None:
            d["date"] = batch_dates.get(d["path"])
            d["source"] = "git"

    by_date = {}
    by_lane = {}
    for d in docs:
        by_date.setdefault(d["date"] or "unknown", []).append(d["path"])
        by_lane.setdefault(d["lane"], []).append(d["path"])

    summary = {
        "total_docs": len(docs),
        "with_date": sum(1 for d in docs if d["date"]),
        "with_author": sum(1 for d in docs if d["author"]),
        "by_date": {k: len(v) for k, v in sorted(by_date.items(), key=lambda x: str(x[0]))},
        "by_lane": {k: len(v) for k, v in sorted(by_lane.items())},
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
    print("docs per lane:")
    for lane, count in summary["by_lane"].items():
        print(f"  {lane}: {count}")
    print(f"\nwrote {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
