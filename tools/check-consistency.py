#!/usr/bin/env python3
"""Organizational consistency checker.

Implements the mechanical rules of
docs/knowledge-library/organizational-consistency-2026.md:
  R1  one task-block format (em-dash heading, five fields, status vocab,
      no placeholder or duplicate IDs)
  R2  one primary category per knowledge doc in index.md
  R4  unindexed files are either named meta files or violations
  +   every content doc carries frontmatter

Prints a census and exits 1 on any violation. Report-only usage is fine:
read the census, the exit code is for gates (see T-LIB-06).
"""
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TASKS = ROOT / "docs" / "plans" / "tasks"
LIB = ROOT / "docs" / "knowledge-library"
META = {"README.md", "_schema.md", "knowledge-tracker.md", "log.md",
        "tagging-guide.md", "lyria-3.5-brief-library-README.md",
        "suno-v6-style-tags-README.md"}
FIELDS = ["Status", "Goal", "Files", "Acceptance", "Last session"]
STATUS_VOCAB = {"todo", "doing", "blocked", "done"}

violations = []


def check_tasks():
    sep = Counter()
    ids = Counter()
    missing = Counter()
    bad_status = []
    total = 0
    for path in sorted(TASKS.glob("*.md")):
        if path.name in ("README.md", "template.md"):
            continue
        text = path.read_text(encoding="utf-8")
        for block in re.split(r"(?=^### T-)", text, flags=re.M):
            h = re.match(r"^### (T-[A-Z]+-(\d+|XX))\s*(.)", block)
            if not h:
                continue
            total += 1
            ids[h.group(1)] += 1
            if h.group(2) == "XX":
                violations.append(f"R1 placeholder ID {h.group(1)} in {path.name}")
            sep["em-dash" if h.group(3) == "—" else "other"] += 1
            if h.group(3) != "—":
                violations.append(
                    f"R1 heading separator not an em dash: {h.group(1)} in {path.name}")
            for f in FIELDS:
                if f"- **{f}:**" not in block:
                    missing[f] += 1
                    violations.append(
                        f"R1 missing field {f}: {h.group(1)} in {path.name}")
            m = re.search(r"^-\s+\*\*Status:\*\*\s*(\S+)", block, re.M)
            if m and m.group(1).lower() not in STATUS_VOCAB:
                bad_status.append(f"{h.group(1)}: {m.group(1)}")
                violations.append(
                    f"R1 status outside vocabulary: {h.group(1)} in {path.name}")
    for tid, n in ids.items():
        if n > 1 and not tid.endswith("-XX"):
            violations.append(f"R1 duplicate ID {tid} ({n} blocks)")
    print(f"tasks: {total} blocks | separators {dict(sep)} | "
          f"missing fields {dict(missing)} | bad status {bad_status or 'none'}")


def check_library():
    idx = (LIB / "index.md").read_text(encoding="utf-8")
    region = idx.split("## 🗂️ Library Structure", 1)[1].split("## 🏷️", 1)[0]
    listed = Counter()
    for line in region.splitlines():
        m = re.search(r"\[\[([a-z0-9\-]+)", line)
        if m:
            listed[m.group(1)] += 1
    for stem, n in listed.items():
        if n > 1:
            violations.append(f"R2 doc listed in {n} categories: {stem}")
    files = {p.name for p in LIB.glob("*.md")} - {"index.md"}
    orphans, nofm = [], []
    for name in sorted(files):
        stem = name[:-3]
        if name not in META and stem not in listed:
            orphans.append(name)
            violations.append(f"R4 content doc in no category: {name}")
        text = (LIB / name).read_text(encoding="utf-8")
        if name not in META and not text.startswith("---\n"):
            nofm.append(name)
            violations.append(f"frontmatter missing: {name}")
    meta_present = sorted(files & META)
    print(f"library: {len(files)} files | meta present {len(meta_present)} | "
          f"content orphans {orphans or 'none'} | no frontmatter {nofm or 'none'}")


def main():
    check_tasks()
    check_library()
    if violations:
        print(f"\nVIOLATIONS ({len(violations)}):")
        for v in violations:
            print(f"  - {v}")
        return 1
    print("\nOK: no consistency violations")
    return 0


if __name__ == "__main__":
    sys.exit(main())
