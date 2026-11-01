"""Summarize the status of every task block across the task files.

Reads docs/plans/tasks/*.md (except README.md and template.md), parses
each ``### T-<AREA>-<NN> — <title>`` block, and reports per-file status
counts plus open items. Default output is a compact summary sized for a
model's context; ``--json`` emits the full parse.

Usage:
    python tools/task-ledger-summary.py
    python tools/task-ledger-summary.py --json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

TASKS_DIR = Path("docs/plans/tasks")
SKIP_NAMES = {"README.md", "template.md"}

HEADING_RE = re.compile(r"^###\s+(T-[A-Z]+-\d+)\s*—\s*(.*)$")
STATUS_RE = re.compile(r"^-\s*\*\*Status:\*\*\s*(\S+)")

STATUSES = ("todo", "doing", "done", "blocked")
OPEN_STATUSES = ("todo", "doing", "blocked")


def parse_items(text: str) -> list[dict[str, str | None]]:
    """Parse one task file's text into a list of {id, title, status}."""
    items: list[dict[str, str | None]] = []
    current: dict[str, str | None] | None = None
    for line in text.splitlines():
        m = HEADING_RE.match(line)
        if m:
            if current is not None:
                items.append(current)
            current = {"id": m.group(1), "title": m.group(2).strip(), "status": None}
            continue
        if current is not None:
            sm = STATUS_RE.match(line)
            if sm:
                current["status"] = sm.group(1)
    if current is not None:
        items.append(current)
    return items


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Summarize task-ledger status across task files."
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="emit the full parse as JSON instead of the summary",
    )
    args = parser.parse_args()

    # Emit UTF-8 bytes to stdout even when the console/code page is not
    # UTF-8 (Windows default cp1252 would mangle em-dashes in titles).
    if sys.stdout.encoding is None or sys.stdout.encoding.lower().replace("-", "") != "utf-8":
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
        except Exception:
            pass

    if not TASKS_DIR.is_dir():
        print(f"task directory not found: {TASKS_DIR}", file=sys.stderr)
        return 1

    files = sorted(p for p in TASKS_DIR.glob("*.md") if p.name not in SKIP_NAMES)

    parsed: dict[str, list[dict[str, str | None]]] = {}
    for path in files:
        text = path.read_text(encoding="utf-8")
        parsed[path.name] = parse_items(text)

    if args.json:
        output = [
            {
                "file": name,
                "items": [
                    {"id": it["id"], "title": it["title"], "status": it["status"]}
                    for it in items
                ],
            }
            for name, items in parsed.items()
        ]
        print(json.dumps(output, indent=2, ensure_ascii=False))
        return 0

    grand = dict.fromkeys(STATUSES, 0)
    grand["total"] = 0

    lines: list[str] = []
    for name, items in parsed.items():
        counts = dict.fromkeys(STATUSES, 0)
        counts["total"] = len(items)
        for it in items:
            st = it["status"]
            if st in counts:
                counts[st] += 1  # type: ignore[operator]
                grand[st] += 1  # type: ignore[operator]
        grand["total"] += counts["total"]
        parts = ", ".join(f"{s}={counts[s]}" for s in STATUSES)
        lines.append(f"{name}: {parts} total={counts['total']}")

    lines.extend(("", "Open items (todo / doing / blocked):"))
    any_open = False
    for name, items in parsed.items():
        for it in items:
            if it["status"] in OPEN_STATUSES:
                lines.append(
                    f"  {it['id']} [{it['status']}] — {it['title']}  ({name})"
                )
                any_open = True
    if not any_open:
        lines.append("  none")

    lines.append("")
    parts = ", ".join(f"{s}={grand[s]}" for s in STATUSES)
    lines.append(f"Totals: {parts} total={grand['total']}")

    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
