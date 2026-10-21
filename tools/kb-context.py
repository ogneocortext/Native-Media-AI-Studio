# ruff: noqa: N999
"""Export a focused subset of the knowledge library as agent context.

Reads library documents from ``docs/knowledge-library/`` and emits them as a
single concatenated context block, filtered by primary category, page type,
or cross-cutting tag. Useful for giving an AI agent exactly the knowledge
it needs for a task without dumping the whole vault.

Each exported document is preceded by a header with its path, frontmatter
tags, and type, so the agent can see provenance at a glance.

Usage:

    python tools/kb-context.py --category technical --type entity
    python tools/kb-context.py --tag audio --tag visualization
    python tools/kb-context.py --category research --type source
    python tools/kb-context.py --file tempo-estimation-octave-errors-2026.md
    python tools/kb-context.py --category ai --format json

Modes:

* ``text`` (default) — concatenated markdown with per-doc headers.
* ``json`` — JSON array of {path, title, tags, type, content} objects.
* ``paths`` — just the matching file paths, one per line.

Standard library only.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

# Ensure UTF-8 output so emoji / non-ASCII in document content doesn't break
# on Windows consoles (cp1252). Best-effort; no-op where unsupported.
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

try:
    from _toolutil import REPO
except ImportError:  # pragma: no cover
    REPO = Path(__file__).resolve().parent.parent

BASE = REPO / "docs" / "knowledge-library"
SKIP = ("index.md", "README.md", "_schema.md", "log.md")


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8-sig")


def collect() -> list[Path]:
    return sorted(p for p in BASE.glob("*.md") if p.name not in SKIP)


def parse_doc(path: Path) -> dict:
    """Return {path, name, frontmatter, body, tags, type, category}."""
    text = read_text(path)
    front = {}
    body = text
    m = re.match(r"\A---\r?\n(.*?)\r?\n---\r?\n(.*)", text, re.S)
    if m:
        block, body = m.group(1), m.group(2)
        in_tags = False
        ptype = None
        for line in block.split("\n"):
            if line.startswith("tags:"):
                in_tags = True
                continue
            if in_tags:
                t = re.match(r"^\s*-\s*(\S+)\s*$", line)
                if t:
                    front.setdefault("tags", []).append(t.group(1))
                    continue
                if line.strip() and not line.startswith(" "):
                    in_tags = False
            mt = re.match(r"^type:\s*(\S+)", line)
            if mt:
                ptype = mt.group(1)
        front["type"] = ptype
    tags = front.get("tags", [])
    category = tags[0] if tags else None
    return {
        "path": str(path.relative_to(REPO)),
        "name": path.name,
        "frontmatter": front,
        "body": body.strip(),
        "tags": tags,
        "type": ptype,
        "category": category,
    }


def matches(doc: dict, categories, types, tags, files) -> bool:
    if files and doc["name"] not in files:
        return False
    if categories and doc["category"] not in categories:
        return False
    if types and doc["type"] not in types:
        return False
    if tags and not any(t in doc["tags"] for t in tags):
        return False
    return True


def emit_text(docs: list[dict]) -> str:
    parts = []
    for doc in docs:
        header = (
            f"# {doc['name']}\n"
            f"Source: {doc['path']}\n"
            f"Tags: {', '.join(doc['tags'])}\n"
            f"Type: {doc['type'] or '—'}\n"
            f"Category: {doc['category'] or '—'}\n"
            "\n---\n"
        )
        parts.append(header + doc["body"] + "\n")
    return "\n".join(parts)


def emit_json(docs: list[dict]) -> str:
    out = []
    for doc in docs:
        out.append({
            "path": doc["path"],
            "title": doc["aliases"][0] if doc["frontmatter"].get("aliases") else doc["name"],
            "tags": doc["tags"],
            "type": doc["type"],
            "category": doc["category"],
            "content": doc["body"],
        })
    return json.dumps(out, indent=2, ensure_ascii=False)


def emit_paths(docs: list[dict]) -> str:
    return "\n".join(d["path"] for d in docs) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Export a focused subset of the knowledge library as agent context.",
    )
    parser.add_argument("--category", action="append", default=[],
                        help="Filter by primary category (can repeat)")
    parser.add_argument("--type", action="append", default=[],
                        help="Filter by page type (can repeat)")
    parser.add_argument("--tag", action="append", default=[],
                        help="Filter by cross-cutting tag (can repeat, OR logic)")
    parser.add_argument("--file", action="append", default=[],
                        help="Include a specific filename (can repeat)")
    parser.add_argument("--format", choices=["text", "json", "paths"],
                        default="text", help="Output format (default: text)")
    args = parser.parse_args(argv)

    docs = [parse_doc(p) for p in collect()]
    matched = [d for d in docs
               if matches(d, args.category, args.type, args.tag, args.file)]

    if not matched:
        print("No documents matched the given filters.", file=sys.stderr)
        return 1

    if args.format == "text":
        print(emit_text(matched))
    elif args.format == "json":
        print(emit_json(matched))
    elif args.format == "paths":
        print(emit_paths(matched))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
