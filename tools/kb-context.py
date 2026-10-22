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
* ``index`` — a routing table: title, category, type, tags and an estimated
  token cost per document. This is the progressive-disclosure entry point:
  an agent reads the index, decides what it needs, and fetches only those
  documents. One level is enough (He et al., arXiv:2607.17598, 2026).

Standard library only. Link parsing lives in tools/_kb_links.py, shared
with kb-graph.py and validate-knowledge-tags.py.
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
    from _kb_links import SPECIAL_FILES, extract_slugs
    from _kb_tokens import resolve_counter
    from _toolutil import REPO
except ImportError:  # pragma: no cover
    REPO = Path(__file__).resolve().parent.parent
    SPECIAL_FILES = ("index.md", "README.md", "_schema.md", "log.md")
    extract_slugs = None
    resolve_counter = None

BASE = REPO / "docs" / "knowledge-library"
SKIP = ("index.md", "README.md", "_schema.md", "log.md")

# Wiki-link pattern: [[slug|label]] or [[slug]]:relation.
WIKI_LINK_RE = re.compile(r"\[\[([^|\]\]]+)(?:\|[^\]]*)?\]\](?::\w+)?")


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8-sig")


def extract_links(text: str) -> set[str]:
    """Return the set of wiki-link slugs referenced in document text.

    Thin wrapper over the shared parser in tools/_kb_links.py, so this
    tool, kb-graph.py and validate-knowledge-tags.py all read the vault's
    links the same way.
    """
    return extract_slugs(text)


def collect() -> list[Path]:
    return sorted(p for p in BASE.glob("*.md") if p.name not in SKIP)


def parse_doc(path: Path, counter=None) -> dict:
    """Return {path, name, title, frontmatter, body, tags, type, category, tokens}."""
    text = read_text(path)
    front: dict = {}
    body = text
    m = re.match(r"\A---\r?\n(.*?)\r?\n---\r?\n(.*)", text, re.S)
    if m:
        block, body = m.group(1), m.group(2)
        in_tags = False
        in_aliases = False
        ptype = None
        for line in block.split("\n"):
            if line.startswith("tags:"):
                in_tags = True
                in_aliases = False
                continue
            if line.startswith("aliases:"):
                in_aliases = True
                in_tags = False
                continue
            if in_tags:
                t = re.match(r"^\s*-\s*(\S+)\s*$", line)
                if t:
                    front.setdefault("tags", []).append(t.group(1))
                    continue
                if line.strip() and not line.startswith(" "):
                    in_tags = False
            if in_aliases:
                a = re.match(r"^\s*-\s*(.+?)\s*$", line)
                if a:
                    front.setdefault("aliases", []).append(a.group(1))
                    continue
                if line.strip() and not line.startswith(" "):
                    in_aliases = False
            mt = re.match(r"^type:\s*(\S+)", line)
            if mt:
                ptype = mt.group(1)
        front["type"] = ptype
    tags = front.get("tags", [])
    aliases = front.get("aliases", [])
    category = tags[0] if tags else None
    stripped_body = body.strip()
    if counter is not None:
        tokens = counter.count(stripped_body)
    else:
        # Fallback when the shared counter is unavailable: ~4 chars/token.
        tokens = max(1, len(stripped_body) // 4)
    return {
        "path": str(path.relative_to(REPO)),
        "name": path.name,
        "title": aliases[0] if aliases else path.stem,
        "aliases": aliases,
        "frontmatter": front,
        "body": stripped_body,
        "tags": tags,
        "type": ptype,
        "category": category,
        # The token cost of fetching this document, for the routing index and
        # the --budget cap.
        "tokens": tokens,
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
            "title": doc["title"],
            "aliases": doc["aliases"],
            "tags": doc["tags"],
            "type": doc["type"],
            "category": doc["category"],
            "tokens": doc["tokens"],
            "content": doc["body"],
        })
    return json.dumps(out, indent=2, ensure_ascii=False)


def emit_index(docs: list[dict]) -> str:
    """The routing table — progressive disclosure's first level.

    Shows what exists and what each item would cost to fetch, so an agent
    can decide what to load instead of loading the whole vault. The
    research is unambiguous that one level is enough: a second routing
    level "never helps and sometimes breaks accuracy outright" (He et al.,
    arXiv:2607.17598, 2026).
    """
    total = sum(d["tokens"] for d in docs)
    lines = [
        "# Knowledge library — routing index",
        "",
        f"{len(docs)} document(s), ~{total} tokens if all were loaded.",
        "Pick by title, then fetch that document with --file.",
        "",
        f"| {'Title':<44} {'Type':<11} {'Category':<13} {'~Tokens':>8}  Tags",
        f"|{'-' * 44}|{'-' * 11}|{'-' * 13}|{'-' * 8:>8}  {'-' * 20}",
    ]
    for doc in sorted(docs, key=lambda d: (d["category"] or "", d["title"])):
        lines.append(
            f"| {doc['title'][:44]:<44} {doc['type'] or '—':<11} "
            f"{doc['category'] or '—':<13} {doc['tokens']:>8}  "
            f"{', '.join(doc['tags'])}"
        )
    lines.append("")
    lines.append(
        "Fetch one with:  python tools/kb-context.py --file <name>.md"
    )
    return "\n".join(lines)


def emit_summary(docs: list[dict]) -> str:
    """Compact one-line summary per document: path, category, type, tags."""
    lines = [
        f"{'Path':<60} {'Category':<14} {'Type':<12} Tags",
        f"{'-'*60} {'-'*14} {'-'*12} {'-'*20}",
    ]
    for doc in docs:
        tags = ", ".join(doc["tags"])
        lines.append(
            f"{doc['path']:<60} {doc['category'] or '—':<14} "
            f"{doc['type'] or '—':<12} {tags}"
        )
    lines.append(f"\nTotal: {len(docs)} document(s).")
    return "\n".join(lines)


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
    parser.add_argument("--format", choices=["text", "json", "paths", "summary",
                        "index"],
                        default="text", help="Output format (default: text)")
    parser.add_argument("--neighborhood", action="store_true",
                        help="Include documents that link to or from matched docs")
    parser.add_argument("--limit", type=int, default=0,
                        help="Maximum number of documents to export (0 = no limit)")
    parser.add_argument("--budget", type=int, default=0,
                        help="Cap the emitted content at roughly N tokens "
                             "(0 = no cap). The largest documents are dropped "
                             "first, and the drop is reported.")
    parser.add_argument("--model", default=None,
                        help="Tokenizer to count with: gemma-4-e2b-it, qwen3, "
                             "acestep, phi-4, or 'estimate'. Default: the "
                             "first local tokenizer found.")
    args = parser.parse_args(argv)

    counter = resolve_counter(REPO, args.model) if resolve_counter else None
    docs = [parse_doc(p, counter) for p in collect()]
    matched = [d for d in docs
               if matches(d, args.category, args.type, args.tag, args.file)]

    if not matched:
        print("No documents matched the given filters.", file=sys.stderr)
        return 1

    # Optional neighborhood expansion: add docs that link to/from matched docs.
    if args.neighborhood:
        name_to_doc = {d["name"]: d for d in docs}
        slug_to_name = {}
        for d in docs:
            slug_to_name[d["name"].removesuffix(".md")] = d["name"]
        # Also index special files as link targets.
        for special in SPECIAL_FILES:
            slug_to_name[special.removesuffix(".md")] = special

        matched_names = {d["name"] for d in matched}
        expanded = set(matched_names)
        # Forward links: docs that matched docs link to.
        for d in matched:
            for slug in extract_links(d["body"]):
                target = slug_to_name.get(slug)
                if target and target in name_to_doc:
                    expanded.add(target)
        # Reverse links: docs that link to matched docs.
        for d in docs:
            if d["name"] in expanded:
                continue
            for slug in extract_links(d["body"]):
                if slug in matched_names:
                    expanded.add(d["name"])
                    break
        matched = [name_to_doc[n] for n in sorted(expanded)]

    # Apply limit.
    if args.limit and args.limit > 0:
        matched = matched[: args.limit]

    # Apply the token budget. The index format is a routing table and is
    # never truncated — the point is to see what exists.
    dropped: list[dict] = []
    if args.budget > 0 and args.format != "index":
        kept: list[dict] = []
        used = 0
        # Cheapest first, so the budget buys the most documents it can.
        for doc in sorted(matched, key=lambda d: d["tokens"]):
            if used + doc["tokens"] > args.budget:
                dropped.append(doc)
                continue
            kept.append(doc)
            used += doc["tokens"]
        matched = kept

    if not matched:
        print("No documents matched the given filters.", file=sys.stderr)
        return 1

    if args.format == "text":
        print(emit_text(matched))
    elif args.format == "json":
        print(emit_json(matched))
    elif args.format == "paths":
        print(emit_paths(matched))
    elif args.format == "summary":
        print(emit_summary(matched))
    elif args.format == "index":
        print(emit_index(matched))

    if dropped:
        print(f"[BUDGET] dropped {len(dropped)} document(s) to stay under "
              f"~{args.budget} tokens:", file=sys.stderr)
        for doc in dropped:
            print(f"  - {doc['title']} (~{doc['tokens']} tokens)",
                  file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
