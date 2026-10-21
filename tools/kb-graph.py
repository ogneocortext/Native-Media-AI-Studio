# ruff: noqa: N999
"""Render the knowledge-library wiki-link graph as a navigable outline.

Scans every document in ``docs/knowledge-library/`` for ``[[slug]]`` and
``[[slug]]:relation`` wiki-links, builds a directed graph of relationships,
and prints an outline that AI agents can use to navigate the vault and spot
structural problems (orphans, dangling links, unused typed relations).

Output modes:

* ``outline`` (default) — per-document list of outgoing links with relation
  type and weight, grouped by primary category.
* ``graph`` — Graphviz DOT source (pipe to ``dot`` for an image).
* ``orphans`` — documents with no inbound wiki-links.
* ``dangling`` — links that point to non-existent documents.
* ``typed`` — all typed relations (``[[slug]]:relation``) with weights.

Usage:

    python tools/kb-graph.py                    # outline
    python tools/kb-graph.py --mode orphans     # just orphan pages
    python tools/kb-graph.py --mode graph > kb.dot
    python tools/kb-graph.py --mode typed       # all typed relations

Standard library only. Mirrors the link-extraction rules in
tools/validate-knowledge-tags.py so the two tools stay consistent.
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict
from pathlib import Path

# Ensure UTF-8 output on Windows consoles (cp1252).
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

PAGE_TYPES = ("concept", "entity", "source", "comparison",
              "synthesis", "tracker", "index")

# Relation -> traversal weight (per _schema.md §3).
RELATION_WEIGHTS = {
    "cites": 4,
    "extends": 3,
    "implements": 3,
    "compares-to": 2,
    "part-of": 2,
    "see-also": 1,
}

# Wiki-link pattern: [[slug|label]] or [[slug]]:relation.
WIKI_LINK_RE = re.compile(r"\[\[([^|\]\]]+)(?:\|[^\]]*)?\]\](?::(\w+))?")


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8-sig")


def extract_links(text: str) -> list[tuple[str, str | None]]:
    """Return [(slug, relation_or_None)] from document text.

    Strips inline code spans so inline-code wiki-link examples are not treated
    as real links. Strips anchors ([[slug#section]]) and skips
    cross-directory references (contain / or ..).
    """
    text = re.sub(r"`[^`]*`", "", text)
    links = []
    for m in WIKI_LINK_RE.finditer(text):
        slug = m.group(1).strip().split("#")[0]
        relation = m.group(2)
        if "/" in slug or ".." in slug:
            continue
        links.append((slug, relation))
    return links


def collect() -> dict[str, Path]:
    """Return {name: path} for library docs (excludes special meta-files)."""
    docs = {}
    for path in sorted(BASE.glob("*.md")):
        name = path.name
        if name not in SKIP:
            docs[name] = path
    return docs


def frontmatter_category(text: str) -> str | None:
    """Return the first frontmatter tag, or None."""
    m = re.match(r"\A---\r?\n(.*?)\r?\n---\r?\n", text, re.S)
    if not m:
        return None
    in_tags = False
    for line in m.group(1).split("\n"):
        if line.startswith("tags:"):
            in_tags = True
            continue
        if in_tags:
            t = re.match(r"^\s*-\s*(\S+)\s*$", line)
            if t:
                return t.group(1)
            if line.strip() and not line.startswith(" "):
                break
    return None


def build_graph(docs: dict[str, Path]) -> tuple[dict, dict, dict, dict]:
    """Return (outgoing, inbound, dangling, orphans).

    outgoing: doc -> [(target_doc, slug, relation)]
    inbound:  doc -> [(source_doc, slug, relation)]
    dangling: source_doc -> [(slug, relation)]
    orphans:  set of docs with no inbound links.
    """
    basename_to_doc = {Path(p).stem: n for n, p in docs.items()}
    # Special files are valid targets too.
    for name in ("index.md", "README.md", "_schema.md", "log.md"):
        basename_to_doc[Path(name).stem] = name

    outgoing: dict[str, list[tuple[str, str, str | None]]] = defaultdict(list)
    inbound: dict[str, list[tuple[str, str, str | None]]] = defaultdict(list)
    dangling: dict[str, list[tuple[str, str | None]]] = defaultdict(list)

    for name, path in docs.items():
        text = read_text(path)
        for slug, relation in extract_links(text):
            target = basename_to_doc.get(slug)
            if target is None:
                dangling[name].append((slug, relation))
            else:
                outgoing[name].append((target, slug, relation))
                inbound[target].append((name, slug, relation))

    orphans = {n for n in docs if n not in inbound and n != "index.md"}
    return outgoing, inbound, dangling, orphans


def weight_of(relation: str | None) -> int:
    return RELATION_WEIGHTS.get(relation or "see-also", 1)


def relation_label(relation: str | None) -> str:
    return relation or "see-also"


def print_outline(docs, outgoing, inbound, dangling, orphans):
    """Print per-document outline grouped by primary category."""
    by_cat: dict[str, list[str]] = defaultdict(list)
    for name in docs:
        cat = frontmatter_category(read_text(docs[name])) or "uncategorized"
        by_cat[cat].append(name)

    print("[STATS] Knowledge Library Link Graph (outline)\n")
    print(f"Documents: {len(docs)}  |  Orphans: {len(orphans)}  |  "
          f"Dangling links: {sum(len(v) for v in dangling.values())}\n")

    typed_count = sum(1 for outs in outgoing.values()
                      for _, _, r in outs if r)
    if typed_count == 0:
        print("[WARN] No typed wiki-link relations found — all links are "
              "untyped :see-also. Consider adding :cites/:extends/:implements/"
              ":compares-to/:part-of relations per _schema.md §3.\n")

    for cat in ("production", "technical", "platform", "creative",
                "performance", "ai", "research", "uncategorized"):
        names = sorted(by_cat.get(cat, []))
        if not names:
            continue
        print(f"## {cat.title()} ({len(names)})")
        for name in names:
            path = docs[name]
            text = read_text(path)
            ptype = None
            m = re.search(r"^type:\s*(\S+)", text, re.M)
            if m:
                ptype = m.group(1)
            ptype_tag = f" [{ptype}]" if ptype else ""
            orphan_tag = "  [ORPHAN]" if name in orphans else ""
            dang_tag = f"  [WARN] {len(dangling[name])} dangling" if dangling.get(name) else ""
            print(f"  - [[{name}]]{ptype_tag}{orphan_tag}{dang_tag}")
            outs = sorted(outgoing.get(name, []), key=lambda x: (-weight_of(x[2]), x[0]))
            for target, _slug, relation in outs:
                w = weight_of(relation)
                print(f"      -> [[{target}]] :{relation_label(relation)} (w={w})")
            ins = sorted(inbound.get(name, []), key=lambda x: x[0])
            if ins:
                srcs = ", ".join(f"[[{s}]]" for s, _, _ in ins)
                print(f"      <- from {srcs}")
        print()


def print_graph_dot(docs, outgoing, inbound, dangling, orphans):
    """Print Graphviz DOT source for the link graph."""
    print("digraph kb {")
    print('  rankdir=LR;')
    print('  node [shape=box, style=rounded, fontname="Helvetica"];')
    print('  edge [fontname="Helvetica", fontsize=10];')
    for name in docs:
        text = read_text(docs[name])
        ptype = None
        m = re.search(r"^type:\s*(\S+)", text, re.M)
        if m:
            ptype = m.group(1)
        color = {
            "concept": "#e1f5e1", "entity": "#e1e1f5", "source": "#f5f1e1",
            "comparison": "#f1e1e1", "synthesis": "#e1f1f5", "tracker": "#f5e1f1",
            "index": "#e1e1e1",
        }.get(ptype or "", "#ffffff")
        orphan_style = ' style=filled,fillcolor="#ffcccc"' if name in orphans else ''
        print(f'  "{name}" [label="{name}\\n({ptype or "?"})" fillcolor="{color}"{orphan_style}];')
    for name, outs in outgoing.items():
        for target, _slug, relation in outs:
            w = weight_of(relation)
            print(f'  "{name}" -> "{target}" [label=":{relation_label(relation)}" penwidth={w}];')
    print("}")


def print_orphans(orphans, docs):
    print("[ORPHAN] Orphan pages (no inbound wiki-links):\n")
    for name in sorted(orphans):
        text = read_text(docs[name])
        ptype = None
        m = re.search(r"^type:\s*(\S+)", text, re.M)
        if m:
            ptype = m.group(1)
        print(f"  - [[{name}]] [{ptype or '?'}]")
    print(f"\nTotal: {len(orphans)}")


def print_dangling(dangling):
    print("[WARN] Dangling wiki-links (point to non-existent documents):\n")
    for src in sorted(dangling):
        for slug, relation in dangling[src]:
            rel = relation_label(relation)
            print(f"  [[{src}]] -> [[{slug}]] :{rel}")
    print(f"\nTotal: {sum(len(v) for v in dangling.values())}")


def print_typed(outgoing):
    print("[LINK] Typed wiki-link relations (with traversal weight):\n")
    rows = []
    for src, outs in outgoing.items():
        for target, _slug, relation in outs:
            if relation:
                rows.append((weight_of(relation), src, target, relation))
    rows.sort(reverse=True)
    if not rows:
        print("  (none — all links are untyped :see-also)")
    for w, src, target, relation in rows:
        print(f"  [[{src}]] :{relation} -> [[{target}]]  (w={w})")
    print(f"\nTotal typed relations: {len(rows)}")


def print_suggest(docs, outgoing, inbound, dangling, orphans):
    """Suggest link targets for orphan pages based on shared tags/category.

    For each orphan, score every other document by:
      +2 if same primary category
      +1 per shared cross-cutting tag
    Prints the top 3 candidates per orphan.
    """
    # Pre-compute category and tag sets per doc.
    meta: dict[str, tuple[str, set[str]]] = {}
    for name, path in docs.items():
        text = read_text(path)
        category = frontmatter_category(text) or ""
        tags: set[str] = set()
        in_tags = False
        m = re.match(r"\A---\r?\n(.*?)\r?\n---\r?\n", text, re.S)
        if m:
            for line in m.group(1).split("\n"):
                if line.startswith("tags:"):
                    in_tags = True
                    continue
                if in_tags:
                    t = re.match(r"^\s*-\s*(\S+)\s*$", line)
                    if t:
                        tags.add(t.group(1))
                        continue
                    if line.strip() and not line.startswith(" "):
                        break
        meta[name] = (category, tags)

    print("[SUGGEST] Link targets for orphan pages (top 3 per orphan, by shared "
          "category/tags):\n")
    total_suggestions = 0
    for orphan in sorted(orphans):
        o_cat, o_tags = meta[orphan]
        scores = []
        for candidate in docs:
            if candidate == orphan or candidate in inbound.get(orphan, []):
                continue
            c_cat, c_tags = meta[candidate]
            score = (2 if o_cat == c_cat else 0) + len(o_tags & c_tags)
            if score > 0:
                scores.append((score, candidate))
        scores.sort(reverse=True)
        top = scores[:3]
        if top:
            total_suggestions += len(top)
            cand_str = "; ".join(
                f"[[{c}]] (score={s}, same-cat={o_cat == meta[c][0]})"
                for s, c in top
            )
            print(f"  [[{orphan}]] -> {cand_str}")
        else:
            print(f"  [[{orphan}]] -> (no scored candidates)")
    print(f"\nTotal suggestions: {total_suggestions} for {len(orphans)} orphan(s).")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Render the knowledge-library wiki-link graph.",
    )
    parser.add_argument("--mode", choices=["outline", "graph", "orphans",
                        "dangling", "typed", "suggest"], default="outline",
                        help="Output mode (default: outline)")
    args = parser.parse_args(argv)

    docs = collect()
    outgoing, inbound, dangling, orphans = build_graph(docs)

    if args.mode == "outline":
        print_outline(docs, outgoing, inbound, dangling, orphans)
    elif args.mode == "graph":
        print_graph_dot(docs, outgoing, inbound, dangling, orphans)
    elif args.mode == "orphans":
        print_orphans(orphans, docs)
    elif args.mode == "dangling":
        print_dangling(dangling)
    elif args.mode == "typed":
        print_typed(outgoing)
    elif args.mode == "suggest":
        print_suggest(docs, outgoing, inbound, dangling, orphans)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
