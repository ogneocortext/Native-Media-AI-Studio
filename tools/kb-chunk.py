"""Structure-aware chunking for the knowledge library.

Why chunk
---------
The whole library is ~330K tokens. It fits in a 1M-window cloud model and
in nothing this studio runs locally. But a window is a ceiling, not a
working size: quality falls off a "context cliff" past roughly 2.5K tokens
of retrieved context even on a 1M-window model (arXiv:2601.14123, 2026).
So the answer is not "load it all" — it is "route to it, then fetch a
small, well-formed piece".

How it chunks
-------------
Structure first, then sentences, then size:

* **Markdown structure is the boundary.** A document is split at its
  headings, and the heading path (`## Related > ### Links`) travels with
  each chunk. Splitting fixed-size instead would separate a heading from
  its content — the single most common RAG failure mode.
* **Code fences and tables are atomic.** A chunk never cuts a fenced
  block or a table in half.
* **Sentences are not split.** Sentence-aware splitting measured as the
  most cost-effective method (arXiv:2601.14123, 2026).
* **No overlap by default.** The same study found overlap provides no
  measurable benefit and increases indexing cost. `--overlap` is there for
  the cases that need it.
* **Parent-child.** `--parents` emits small chunks for indexing alongside
  their larger parent section, so retrieval is precise and the context
  handed to the model is complete (arXiv:2603.23533, 2026).

Usage:

    python tools/kb-chunk.py --format stats         # the plan, no output
    python tools/kb-chunk.py --format jsonl --out chunks.jsonl
    python tools/kb-chunk.py --format markdown --out chunks.md
    python tools/kb-chunk.py --target 400 --overlap 0
    python tools/kb-chunk.py --parents --format jsonl
"""
# ruff: noqa: N999
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

try:
    from _kb_links import SPECIAL_FILES
    from _kb_markdown import (
        FENCE_RE,
        HEADING_RE,
        TABLE_ROW_RE,
        TABLE_SEP_CELLS_RE,
        TABLE_SEP_RE,
        fence_markers,
        has_table,
        is_separator_row,
        is_table_line,
    )
    from _kb_tokens import (
        PRACTICAL_CHUNK_CEILING,
        humanize_tokens,
        resolve_counter,
        split_sentences,
    )
    from _toolutil import REPO
except ImportError:  # pragma: no cover
    REPO = Path(__file__).resolve().parent.parent
    SPECIAL_FILES = ("index.md", "README.md", "_schema.md", "log.md")
    PRACTICAL_CHUNK_CEILING = 8_000
    humanize_tokens = str
    resolve_counter = None
    split_sentences = None
    import re as _re
    HEADING_RE = _re.compile(r"^(#{1,6})\s+(.*)$")
    FENCE_RE = _re.compile(r"^\s*(```|~~~)")
    TABLE_ROW_RE = _re.compile(r"^\s*\|.*\|\s*$")
    TABLE_SEP_RE = _re.compile(r"^\s*\|?[\s:|-]*-[\s:|-]*\|[\s:|-]*$")
    TABLE_SEP_CELLS_RE = _re.compile(r"^\s*\|(?:\s*:?-{2,}:?\s*\|)+\s*$")
    fence_markers = lambda t: sum(  # noqa: E731
        1 for ln in t.split("\n") if FENCE_RE.match(ln))
    has_table = lambda t: any(  # noqa: E731
        is_separator_row(ln) for ln in t.split("\n"))
    is_separator_row = lambda ln: bool(  # noqa: E731
        TABLE_SEP_CELLS_RE.match(ln)
        or (TABLE_SEP_RE.match(ln) and "|" in ln))
    is_table_line = lambda ln: bool(  # noqa: E731
        TABLE_ROW_RE.match(ln)
        or (TABLE_SEP_RE.match(ln) and "|" in ln))

BASE = REPO / "docs" / "knowledge-library"

# Default chunk size. The 2026 guidance is 300-500 tokens for prose with
# structure-aware splitting; 400 is the middle of that band.
DEFAULT_TARGET = 400

FRONTMATTER_RE = re.compile(r"\A---\r?\n(.*?)\r?\n---\r?\n(.*)", re.S)

# Chunks below this are merged into their neighbour: a heading with no body
# becomes a content-free fragment, and "tiny-chunk merging" is the standard
# remedy (arXiv:2603.25333, 2026).
MIN_CHUNK_TOKENS = 40


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8-sig")


def split_frontmatter(text: str) -> tuple[str, str]:
    m = FRONTMATTER_RE.match(text)
    if not m:
        return "", text
    return m.group(1), m.group(2)


def parse_frontmatter(block: str) -> dict:
    """Pull tags, type, aliases and title out of a frontmatter block."""
    tags: list[str] = []
    aliases: list[str] = []
    ptype = None
    in_tags = False
    in_aliases = False
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
                tags.append(t.group(1))
                continue
            if line.strip() and not line.startswith(" "):
                in_tags = False
        if in_aliases:
            a = re.match(r"^\s*-\s*(.+?)\s*$", line)
            if a:
                aliases.append(a.group(1))
                continue
            if line.strip() and not line.startswith(" "):
                in_aliases = False
        mt = re.match(r"^type:\s*(\S+)", line)
        if mt:
            ptype = mt.group(1)
    return {
        "tags": tags,
        "aliases": aliases,
        "type": ptype,
        "title": aliases[0] if aliases else None,
    }


def split_sections(body: str) -> list[dict]:
    """Split a markdown body into sections at heading boundaries.

    Each section carries the heading path so a chunk can say where it
    came from. Code fences are respected: a ``#`` inside a fence is not a
    heading.
    """
    sections: list[dict] = []
    stack: list[tuple[int, str]] = []
    current_lines: list[str] = []
    current_path: list[str] = []
    in_fence = False

    def flush() -> None:
        text = "\n".join(current_lines).strip()
        if text:
            sections.append({
                "text": text,
                "heading_path": " > ".join(current_path),
                "heading": current_path[-1] if current_path else "",
            })
        current_lines.clear()

    for line in body.split("\n"):
        if FENCE_RE.match(line):
            in_fence = not in_fence
            current_lines.append(line)
            continue
        m = HEADING_RE.match(line) if not in_fence else None
        if m:
            flush()
            level = len(m.group(1))
            title = m.group(2).strip()
            # Pop headings at or below this level, then push this one.
            while stack and stack[-1][0] >= level:
                stack.pop()
            stack.append((level, title))
            current_path = [t for _lvl, t in stack]
            current_lines.append(line)
            continue
        current_lines.append(line)
    flush()
    return sections


def split_atomic_units(text: str) -> list[tuple[str, bool]]:
    """Split text into units, marking the ones that must not be split.

    A fenced code block and a table are *atomic*: cutting either in half
    produces a chunk that is meaningless on its own and that a model will
    misread. Prose is not atomic and is split on sentences.

    A table is atomic only when it has a separator row — pipe-aligned
    prose without one is not a table. The separator row may or may not
    have leading and trailing pipes; it belongs to the table either way.

    Returns [(unit_text, is_atomic)].
    """
    units: list[tuple[str, bool]] = []
    current: list[str] = []
    table_rows: list[str] = []
    in_fence = False
    fence_marker = ""

    def flush_prose() -> None:
        nonlocal current
        if current:
            units.append(("\n".join(current), False))
            current = []

    def flush_table() -> None:
        nonlocal table_rows
        if table_rows:
            # Atomic only if the group contains a real separator row.
            has_sep = any(is_separator_row(r) for r in table_rows)
            if not has_sep:
                # A headerless table group directly after a table: the
                # source has a blank line inside one table, which markdown
                # renders as two. Rejoin it — a broken table reads better as
                # one unit than as two fragments. Look past the empty prose
                # units the blank line produced.
                k = len(units) - 1
                while k >= 0 and not units[k][0].strip():
                    k -= 1
                if k >= 0 and units[k][1]:
                    previous, was_atomic = units[k]
                    units[k] = (previous + "\n" + "\n".join(table_rows),
                                was_atomic)
                    del units[k + 1:]
                    table_rows = []
                    return
            units.append(("\n".join(table_rows), has_sep))
            table_rows = []

    for line in text.split("\n"):
        is_fence = bool(FENCE_RE.match(line))
        if is_fence:
            if not in_fence:
                flush_prose()
                flush_table()
                fence_marker = line.strip()[:3]
                in_fence = True
                current = [line]
            elif line.strip().startswith(fence_marker):
                current.append(line)
                in_fence = False
                units.append(("\n".join(current), True))
                current = []
            else:
                current.append(line)
            continue

        if in_fence:
            current.append(line)
            continue

        if TABLE_ROW_RE.match(line) or (
            TABLE_SEP_RE.match(line) and "|" in line
        ):
            if current:
                units.append(("\n".join(current), False))
                current = []
            table_rows.append(line)
            continue
        if table_rows:
            # A table ends at the first non-table line.
            flush_table()

        current.append(line)

    if in_fence and current:
        # Unterminated fence in the source: keep it whole rather than
        # inventing a closing delimiter.
        units.append(("\n".join(current), True))
        current = []
    flush_prose()
    flush_table()
    return units


def split_oversized(section: dict, counter, target: int,
                     overlap: int) -> list[dict]:
    """Split a section that exceeds the target, at sentence boundaries.

    Atomic units (code fences, tables) are never split; prose is split on
    sentences. A single atomic unit larger than the target becomes one
    oversized chunk rather than being broken — a half-code-block is worse
    than a long one.

    A section that contains a table is kept whole. A table interleaved with
    prose (rows, a paragraph, more rows) has no single contiguous block, so
    splitting the section would separate the table's header from its last
    rows — and a table with no header is not a table.
    """
    text = section["text"]
    if counter.count(text) <= target:
        return [dict(section)]
    if has_table(text):
        return [dict(section)]
    units: list[tuple[str, bool]] = []
    for unit, atomic in split_atomic_units(text):
        if atomic:
            units.append((unit, True))
            continue
        for sentence in split_sentences(unit):
            units.append((sentence, False))

    chunks: list[str] = []
    current: list[str] = []
    current_tokens = 0
    for unit, atomic in units:
        n = counter.count(unit)
        if current and current_tokens + n > target:
            # The unit does not fit. An atomic unit always starts a new
            # chunk rather than being cut.
            chunks.append("\n\n".join(current))
            if overlap > 0 and not atomic:
                carried: list[str] = []
                carried_tokens = 0
                for prev in reversed(current):
                    pn = counter.count(prev)
                    if carried_tokens + pn > overlap:
                        break
                    carried.insert(0, prev)
                    carried_tokens += pn
                current = carried
                current_tokens = carried_tokens
            else:
                current = []
                current_tokens = 0
        current.append(unit)
        current_tokens += n
    if current:
        chunks.append("\n\n".join(current))

    return [{**section, "text": c} for c in chunks]


def merge_tiny_chunks(chunks: list[dict], counter, minimum: int) -> list[dict]:
    """Merge content-free fragments into their neighbour.

    A heading with no body ("## Recommended Configurations" and nothing
    else) becomes a 3-token chunk: it is noise in a retrieval index and
    wastes a slot in the budget. Merging tiny chunks into the following
    one is the standard remedy (arXiv:2603.25333, 2026).

    Fragments accumulate forward until they reach `minimum`; a run that
    never reaches it (a trailing run of empty headings) is merged back
    into the last substantial chunk.
    """
    if not chunks:
        return chunks
    merged: list[dict] = []
    pending: list[dict] = []
    for chunk in chunks:
        pending.append(chunk)
        size = sum(c["tokens"] for c in pending)
        if size >= minimum:
            if len(pending) == 1:
                merged.append(pending[0])
            else:
                # Keep the first chunk's identity, absorb the rest.
                head = pending[0]
                text = "\n\n".join(c["text"] for c in pending)
                paths = [c["heading_path"] for c in pending if c["heading_path"]]
                merged.append({
                    **head,
                    "text": text,
                    "tokens": counter.count(text),
                    "heading_path": paths[0] if paths else head["heading_path"],
                    "merged": len(pending),
                })
            pending = []
    if pending:
        if merged:
            # A trailing run of fragments: fold them into the last chunk.
            head = merged[-1]
            text = head["text"] + "\n\n" + "\n\n".join(c["text"] for c in pending)
            merged[-1] = {**head, "text": text, "tokens": counter.count(text)}
        else:
            merged.extend(pending)
    return merged


def check_source_defects(path: Path, text: str) -> list[str]:
    """Report structural defects in a source document.

    An unbalanced code fence is a defect in the *document*, not in the
    chunker. The chunker preserves it faithfully, so the only useful
    thing to do is say so.
    """
    problems: list[str] = []
    markers = fence_markers(text)
    if markers % 2 != 0:
        problems.append(
            f"unbalanced code fence ({markers} fence markers) — "
            f"a chunk containing it will have an unclosed fence"
        )

    # A table broken by a blank line renders as two tables, the second
    # without a header. The chunker rejoins it; the document is still wrong.
    lines = text.split("\n")
    prev_was_table = False
    for i, line in enumerate(lines):
        is_row = bool(TABLE_ROW_RE.match(line))
        if not is_row and line.strip() == "":
            # A blank line: look ahead — if the next non-blank line is a
            # table row and we were in a table, the table is broken.
            nxt = next((x for x in lines[i + 1:] if x.strip()), "")
            if prev_was_table and TABLE_ROW_RE.match(nxt):
                problems.append(
                    "table broken by a blank line — markdown renders it as "
                    "two tables, the second without a header"
                )
                prev_was_table = False
            continue
        prev_was_table = is_row or (prev_was_table and bool(line.strip()))
        if line.strip() and not is_row:
            prev_was_table = False

    # Any run of table rows with no separator row is not a table markdown
    # will render — it is a fragment of one whose header is elsewhere.
    group: list[str] = []
    for line in lines + [""]:
        if TABLE_ROW_RE.match(line):
            group.append(line)
            continue
        if group:
            if not any(is_separator_row(r) for r in group):
                problems.append(
                    f"table fragment without a header ({len(group)} row(s)) — "
                    f"its header and separator are in another section"
                )
            group = []
    return problems


def chunk_document(path: Path, counter, target: int, overlap: int) -> tuple:
    """Return (chunks, parents, defects) for one document."""
    text = read(path)
    block, body = split_frontmatter(text)
    meta = parse_frontmatter(block) if block else {}
    title = meta.get("title") or path.stem
    tags = meta.get("tags", [])
    category = tags[0] if tags else "uncategorized"
    doc_type = meta.get("type")

    defects = check_source_defects(path, body)

    chunks: list[dict] = []
    parents: list[dict] = []
    for section in split_sections(body):
        section_tokens = counter.count(section["text"])
        parents.append({
            "id": f"{path.stem}#{len(parents)}",
            "doc": path.name,
            "title": title,
            "category": category,
            "type": doc_type,
            "tags": tags,
            "heading_path": section["heading_path"],
            "text": section["text"],
            "tokens": section_tokens,
        })
        for piece in split_oversized(section, counter, target, overlap):
            chunks.append({
                "doc": path.name,
                "title": title,
                "category": category,
                "type": doc_type,
                "tags": tags,
                "heading_path": piece["heading_path"],
                "text": piece["text"],
                "tokens": counter.count(piece["text"]),
            })

    chunks = merge_tiny_chunks(chunks, counter, MIN_CHUNK_TOKENS)
    return chunks, parents, defects


def _is_atomic(text: str) -> bool:
    """True when a chunk's content is a code fence or a table.

    Used to tell the report apart: an over-target chunk that is atomic was
    deliberately not split (splitting a code block is worse than a long
    one), while an over-target prose chunk is a defect.
    """
    lines = text.split("\n")
    if any(FENCE_RE.match(ln) for ln in lines):
        return True
    rows = [ln for ln in lines if TABLE_ROW_RE.match(ln)]
    if len(rows) >= 2 and any(is_separator_row(r) for r in rows):
        return True
    return False


def collect_docs() -> list[Path]:
    return [p for p in sorted(BASE.glob("*.md")) if p.name not in SPECIAL_FILES]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Structure-aware chunking for the knowledge library.",
    )
    parser.add_argument("--target", type=int, default=DEFAULT_TARGET,
                        help=f"Target tokens per chunk (default {DEFAULT_TARGET})")
    parser.add_argument("--overlap", type=int, default=0,
                        help="Tokens of overlap between adjacent chunks "
                             "(default 0 — the 2026 chunking study found no "
                             "measurable benefit)")
    parser.add_argument("--format", choices=["jsonl", "markdown", "stats"],
                        default="stats", help="Output format")
    parser.add_argument("--out", default=None,
                        help="Write to this file instead of stdout")
    parser.add_argument("--parents", action="store_true",
                        help="Also emit parent sections, for parent-child "
                             "retrieval (index small chunks, fetch the parent)")
    parser.add_argument("--model", default=None,
                        help="Tokenizer to count with (default: the first "
                             "local tokenizer found)")
    parser.add_argument("--category", action="append", default=[],
                        help="Limit to a primary category (can repeat)")
    args = parser.parse_args(argv)

    counter = resolve_counter(REPO, args.model)
    paths = collect_docs()

    all_chunks: list[dict] = []
    all_parents: list[dict] = []
    defects: list[tuple[str, str]] = []
    for path in paths:
        chunks, parents, doc_defects = chunk_document(
            path, counter, args.target, args.overlap
        )
        if args.category and (chunks[0]["category"] if chunks else "") not in args.category:
            continue
        all_chunks.extend(chunks)
        all_parents.extend(parents)
        for d in doc_defects:
            defects.append((path.name, d))

    sizes = sorted(c["tokens"] for c in all_chunks)
    total = sum(sizes)

    if args.format == "stats":
        atomic_over = [c for c in all_chunks
                       if c["tokens"] > args.target and _is_atomic(c["text"])]
        prose_over = [c for c in all_chunks
                      if c["tokens"] > args.target and not _is_atomic(c["text"])]
        print("[CHUNK] Chunking plan\n")
        print(f"  Counter        : {counter.model}"
              f"{' (exact)' if counter.exact else ' (estimate)'}")
        print(f"  Target         : {args.target} tokens/chunk")
        print(f"  Overlap        : {args.overlap} tokens")
        print(f"  Documents      : {len({c['doc'] for c in all_chunks})}")
        print(f"  Sections       : {len(all_parents)}")
        print(f"  Chunks         : {len(all_chunks)}")
        print(f"  Total tokens   : {total:,}")
        if sizes:
            print(f"  Chunk size     : min {sizes[0]}, "
                  f"median {sizes[len(sizes) // 2]}, max {sizes[-1]}")
            print(f"  Over target    : {len(atomic_over)} atomic (code/table, "
                  f"not split)")
            print(f"                   {len(prose_over)} prose")
        if args.parents:
            ptot = sum(p["tokens"] for p in all_parents)
            print(f"  Parents        : {len(all_parents)} ({ptot:,} tokens)")
        if defects:
            print(f"\n  Source defects ({len(defects)}) — these are document "
                  f"problems, not chunker problems:")
            for name, d in defects:
                print(f"    {name}: {d}")
        print(f"\n  Effective ceiling for one chunk: {PRACTICAL_CHUNK_CEILING:,} "
              f"tokens")
        print(f"  Target {args.target} is "
              f"{'within' if args.target <= PRACTICAL_CHUNK_CEILING else 'ABOVE'} "
              f"that ceiling.")
        print(f"\n  Retrieval budget at the context cliff (~2,500 tokens): "
              f"{max(1, 2500 // max(1, args.target))} chunk(s) per query.")
        return 0

    out_path = Path(args.out) if args.out else None
    if args.format == "jsonl":
        lines = []
        for i, c in enumerate(all_chunks):
            chunk_id = f"{Path(c['doc']).stem}#{i:04d}"
            lines.append(json.dumps({
                "id": chunk_id,
                "doc": c["doc"],
                "title": c["title"],
                "category": c["category"],
                "type": c["type"],
                "tags": c["tags"],
                "heading_path": c["heading_path"],
                "tokens": c["tokens"],
                "text": c["text"],
            }, ensure_ascii=False))
        if args.parents:
            for p in all_parents:
                lines.append(json.dumps({
                    "id": p["id"],
                    "kind": "parent",
                    "doc": p["doc"],
                    "title": p["title"],
                    "category": p["category"],
                    "type": p["type"],
                    "tags": p["tags"],
                    "heading_path": p["heading_path"],
                    "tokens": p["tokens"],
                    "text": p["text"],
                }, ensure_ascii=False))
        payload = "\n".join(lines)
    else:  # markdown
        parts = ["# Knowledge library — chunked", ""]
        for c in all_chunks:
            parts.append(f"## {c['title']} · {c['heading_path'] or 'body'} "
                         f"({c['tokens']} tokens)")
            parts.append("")
            parts.append(c["text"])
            parts.append("")
        payload = "\n".join(parts)

    if out_path:
        out_path.write_text(payload + "\n", encoding="utf-8", newline="\n")
        print(f"wrote {out_path} ({len(all_chunks)} chunks, {total:,} tokens)")
    else:
        print(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
