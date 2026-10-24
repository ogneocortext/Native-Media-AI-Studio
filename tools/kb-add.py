# ruff: noqa: N999
"""Scaffold a new knowledge-library document following the KB schema.

Implements ``docs/knowledge-library/_schema.md`` §7 "Adding a New Document":

1. Create a kebab-case .md file with full frontmatter (tags, aliases,
   cssclasses, date, type).
2. Add at least two typed wiki-links from related existing documents
   (avoid orphans).
3. Add the document to knowledge-tracker.md under its primary category.
4. Add the document to index.md under its primary category.
5. Update tag counts in index.md's Tags Index.
6. Append an entry to log.md.
7. Run validate-knowledge-tags.py to verify.

Usage:

    python tools/kb-add.py --title "My New Doc" --category technical --type entity
    python tools/kb-add.py -t "Audio Reactive Pipeline" -c production -T audio,visualization --alias "Audio Reactive"

Runs interactively when invoked without flags. Standard library only.
"""
from __future__ import annotations

import argparse
import datetime
import re
import sys
from pathlib import Path

# Ensure UTF-8 output on Windows consoles (cp1252).
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

try:  # tools/ is on sys.path when run as ``python tools/kb-add.py``.
    from _toolutil import REPO
except ImportError:  # pragma: no cover - fallback for other invocation styles.
    REPO = Path(__file__).resolve().parent.parent

BASE = REPO / "docs" / "knowledge-library"
INDEX = BASE / "index.md"
TRACKER = BASE / "knowledge-tracker.md"
LOG = BASE / "log.md"
SKIP = ("index.md", "README.md", "_schema.md", "log.md")

CATEGORIES = {
    "1": ("production", "Production Pipeline"),
    "2": ("technical", "Technical Implementation"),
    "3": ("platform", "MCP & Platform Integrations"),
    "4": ("creative", "Creative & Visual"),
    "5": ("performance", "Performance & Hardware"),
    "6": ("ai", "AI & ML"),
    "7": ("research", "Research & Reference"),
}

# The category slugs, in menu order — what --category accepts.
CATEGORY_SLUGS = [cat for cat, _label in CATEGORIES.values()]

PAGE_TYPES = ("concept", "entity", "source", "comparison",
              "synthesis", "tracker", "index")

CSSCLASS_BY_CATEGORY = {
    "production": "production-guide",
    "technical": "technical-guide",
    "platform": "platform-guide",
    "creative": "creative-guide",
    "performance": "performance-guide",
    "ai": "ai-guide",
    "research": "research-guide",
}

SECTION_HEADING_BY_CATEGORY = {
    "production": "### 🎬 Production Pipeline",
    "technical": "### 🛠️ Technical Implementation",
    "platform": "### 🎮 MCP & Platform Integrations",
    "creative": "### 🎨 Creative & Visual",
    "performance": "### ⚙️ Performance & Hardware",
    "ai": "### 🤖 AI & ML",
    "research": "### 📊 Research & Reference",
}

DATE = datetime.date.today().isoformat()


def prompt(label: str, default: str | None = None) -> str:
    """Read one line from stdin, returning default on empty input."""
    if default is not None:
        val = input(f"{label} [{default}]: ").strip()
        return val or default
    while True:
        val = input(f"{label}: ").strip()
        if val:
            return val
        print("  (required — please enter a value)")


def slugify(title: str) -> str:
    """Convert a human title to a kebag-case filename stem."""
    slug = title.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = re.sub(r"-+", "-", slug).strip("-")
    slug = re.sub(r"-20\d\d$", "", slug)  # strip year suffix we'll re-add
    return slug


def choose_category() -> str:
    print("\nPrimary category (pick a number):")
    for key, (cat, label) in CATEGORIES.items():
        print(f"  {key}. {label}  ({cat})")
    while True:
        choice = prompt("Choice").strip()
        if choice in CATEGORIES:
            return CATEGORIES[choice][0]
        print(f"  Invalid — pick 1-{len(CATEGORIES)}")


TYPE_KEYWORD_MAP = [
    (("index", "catalog"), "index"),
    (("progress", "status", "plan", "updates", "milestone"), "tracker"),
    (("research", "study", "survey", "landscape", "review"), "source"),
    (("comparison", "-vs-", "audit", "evaluation", "benchmark"), "comparison"),
    (("synthesis", "summary", "overview", "analysis"), "synthesis"),
    (("guide", "handbook", "manual", "tutorial", "runbook"), "entity"),
]


def suggest_type_from_title(title: str) -> str | None:
    """Guess a page type from filename/title keywords.

    Returns None when no keyword matches (caller falls back to interactive pick).
    """
    lower = title.lower()
    for keywords, ptype in TYPE_KEYWORD_MAP:
        if any(k in lower for k in keywords):
            return ptype
    return None


def find_related_docs(category: str, ptype: str, cross_tags: list[str],
                      limit: int = 5) -> list[tuple[str, str, str]]:
    """Find existing library docs related to a new document.

    Scores candidates by shared category (+2) and shared cross-cutting tags
    (+1 per tag). Returns up to `limit` tuples of
    (doc_name, display_alias, suggested_relation).
    """
    related: list[tuple[int, str, str, str]] = []
    for path in BASE.glob("*.md"):
        name = path.name
        if name in SKIP or name.endswith(f"-{DATE[:4]}.md"):
            continue
        text = read_file(path)
        # Read frontmatter tags.
        m = re.match(r"\A---\r?\n(.*?)\r?\n---\r?\n", text, re.S)
        if not m:
            continue
        doc_tags: list[str] = []
        doc_category = ""
        in_tags = False
        for line in m.group(1).split("\n"):
            if line.startswith("tags:"):
                in_tags = True
                continue
            if in_tags:
                t = re.match(r"^\s*-\s*(\S+)\s*$", line)
                if t:
                    doc_tags.append(t.group(1))
                    continue
                if line.strip() and not line.startswith(" "):
                    in_tags = False
            mc = re.match(r"^type:\s*(\S+)", line)
            if mc:
                # Not used for scoring yet, but kept for clarity.
                _doc_type = mc.group(1)
        doc_category = doc_tags[0] if doc_tags else ""
        # Score.
        score = 2 if doc_category == category else 0
        score += len(set(doc_tags) & set(cross_tags))
        if score <= 0:
            continue
        # Suggest relation based on page type.
        mtype = re.search(r"^type:\s*(\S+)", text, re.M)
        doc_type = mtype.group(1) if mtype else "concept"
        relation = _infer_relation(doc_type, ptype)
        display = name.removesuffix(".md")
        related.append((score, name, display, relation))
    related.sort(key=lambda x: (-x[0], x[1]))
    return [(name.removesuffix(".md"), display, relation) for _, name, display, relation
            in related[:limit]]


def _infer_relation(doc_type: str, ptype: str) -> str:
    """Infer the wiki-link relation type between a new doc (ptype) and an
    existing doc (doc_type), per _schema.md §3.

    Returns a typed relation (:cites, :extends, :implements, :compares-to,
    :part-of) when the combination is semantically clear, otherwise
    :see-also.
    """
    # New doc cites an existing source.
    if doc_type == "source" and ptype in ("concept", "synthesis", "comparison"):
        return ":cites"
    # New synthesis extends an existing concept.
    if doc_type == "concept" and ptype == "synthesis":
        return ":extends"
    # New concept is implemented by an existing entity.
    if doc_type == "entity" and ptype == "concept":
        return ":implements"
    # New comparison contrasts existing entities/comparisons.
    if ptype == "comparison" and doc_type in ("entity", "comparison", "source"):
        return ":compares-to"
    # New tracker/ index is part of a larger effort.
    if ptype in ("tracker", "index") and doc_type in ("tracker", "index", "synthesis"):
        return ":part-of"
    # Existing entity is part of a new synthesis.
    if doc_type == "entity" and ptype == "synthesis":
        return ":part-of"
    # Default fallback.
    return ":see-also"


def choose_type(category: str, title: str = "") -> str:
    suggested = suggest_type_from_title(title)
    default_idx = 1
    if suggested and suggested in PAGE_TYPES:
        default_idx = PAGE_TYPES.index(suggested) + 1
    print("\nPage type (pick a number):")
    for i, t in enumerate(PAGE_TYPES, 1):
        marker = " (suggested)" if t == suggested else ""
        print(f"  {i}. {t}{marker}")
    while True:
        prompt_text = f"Choice [{default_idx}]" if suggested else f"Choice [{default_idx}]"
        choice = prompt(prompt_text, default=str(default_idx)).strip()
        if choice.isdigit() and 1 <= int(choice) <= len(PAGE_TYPES):
            return PAGE_TYPES[int(choice) - 1]
        print(f"  Invalid — pick 1-{len(PAGE_TYPES)}")


def read_file(path: Path) -> str:
    return path.read_text(encoding="utf-8-sig")


def write_file(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8", newline="\n")


def build_frontmatter(category: str, ptype: str, title: str, aliases: list[str],
                        cross_tags: list[str]) -> str:
    alias_lines = "\n".join(f"  - {a}" for a in aliases)
    tag_lines = "\n".join(f"  - {t}" for t in [category, *cross_tags])
    cssclass = CSSCLASS_BY_CATEGORY[category]
    return (
        "---\n"
        f"tags:\n{tag_lines}\n"
        f"aliases:\n{alias_lines}\n"
        f"cssclasses:\n  - {cssclass}\n"
        f"date: {DATE}\n"
        f"type: {ptype}\n"
        "---\n"
    )


def body_template(title: str, related_docs: list[tuple[str, str, str]] | None = None
                   ) -> str:
    related_lines = ""
    if related_docs:
        related_lines = "\n".join(
            f"- [[{name}|{display}]] {relation}"
            for name, display, relation in related_docs
        ) + "\n"
    else:
        related_lines = (
            "Add typed wiki-links to related documents (see _schema.md §3):\n"
            "\n"
            "- [[related-doc]]:see-also\n"
        )
    return (
        "\n"
        "> [!info] Purpose\n"
        f"> {title} — purpose of this document.\n"
        "\n"
        "---\n"
        "\n"
        "## Overview\n"
        "\n"
        "Write the overview here.\n"
        "\n"
        "## Related\n"
        "\n"
        f"{related_lines}"
    )


def filename_for(slug: str) -> Path:
    """Return the target path, appending the year if not present."""
    stem = slug
    if not re.search(r"-20\d\d$", stem):
        stem = f"{stem}-{DATE[:4]}"
    return BASE / f"{stem}.md"


def _find_section(text: str, heading_prefix: str) -> re.Match:
    """Locate a `### ` section by heading *prefix*.

    The headings carry suffixes that change over time — index.md uses
    "### 🛠️ Technical Implementation (Code & Systems)" and the tracker uses
    "### 🛠️ Technical Implementation (14/14 completed) ✅" — so an exact
    match breaks as soon as a counter or a label is edited. Matching the
    prefix survives both.
    """
    pattern = re.compile(
        rf"(^### {re.escape(heading_prefix.removeprefix('### ').strip())}[^\n]*\n)"
        rf"(.*?)(?=\n### |\Z)",
        re.M | re.S,
    )
    m = pattern.search(text)
    if not m:
        raise SystemExit(
            f"Could not find a section starting with '{heading_prefix}'"
        )
    return m


def insert_in_index(name: str, category: str, title: str, display: str) -> None:
    """Insert a wiki-link entry into index.md under the right category."""
    text = read_file(INDEX)
    heading = SECTION_HEADING_BY_CATEGORY[category]
    m = _find_section(text, heading)
    entry = f"- [[{name}|{display}]] — {title}\n"
    new_section = m.group(1) + entry + m.group(2)
    text = text[: m.start()] + new_section + text[m.end() :]
    write_file(INDEX, text)


def insert_in_tracker(name: str, category: str) -> None:
    """Insert the document into knowledge-tracker.md under its category."""
    text = read_file(TRACKER)
    heading = SECTION_HEADING_BY_CATEGORY[category]
    m = _find_section(text, heading)

    # Update the (N/N) counter on the heading line. The tracker writes
    # "(14/14 completed)" — the closing paren is not adjacent to the digits,
    # so the pattern must not require it.
    head_line = m.group(1)
    counter = re.search(r"\((\d+)/(\d+)", head_line)
    if counter:
        n = int(counter.group(1)) + 1
        head_line = (
            head_line[: counter.start()]
            + f"({n}/{n}"
            + head_line[counter.end() :]
        )

    # The tracker identifies documents by their filename, extension included —
    # that is what validate-knowledge-tags.py matches on.
    entry = f"- ✅ `{name}.md`  → `#{category}`\n"
    new_section = head_line + entry + m.group(2)
    text = text[: m.start()] + new_section + text[m.end() :]
    write_file(TRACKER, text)


def bump_index_counts(category: str, cross_tags: list[str]) -> None:
    """Bump the document counts in index.md's Tags Index tables.

    The primary category appears as `#<category>/*` in the Hierarchical Tags
    table; cross-cutting tags appear as `#<tag>` in the Cross-Cutting Tags
    table. Each row ends with "| N documents |", which is what
    validate-knowledge-tags.py checks against the real tag counts.
    """
    text = read_file(INDEX)
    for tag in [category, *cross_tags]:
        pattern = re.compile(
            rf"(\| `#{re.escape(tag)}/?\*?` \|[^|]*\| )(\d+)( documents? \|)"
        )
        m = pattern.search(text)
        if not m:
            continue
        text = (
            text[: m.start()]
            + m.group(1)
            + str(int(m.group(2)) + 1)
            + m.group(3)
            + text[m.end() :]
        )
    write_file(INDEX, text)


def append_to_log(name: str, category: str) -> None:
    """Append an entry to log.md under today's date heading."""
    text = read_file(LOG)
    today = DATE
    heading = f"## {today} — Knowledge library additions"
    if heading in text:
        # Append under today's existing heading.
        idx = text.index(heading)
        # Find end of this section (next "## " heading or EOF).
        rest = text[idx + len(heading):]
        m = re.search(r"\n## ", rest)
        end = idx + len(heading) + (m.start() if m else len(rest))
        entry = f"- Added `docs/knowledge-library/{name}` → `#{category}`\n"
        text = text[:end] + entry + "\n" + text[end:]
    else:
        entry = (
            f"\n## {today} — Knowledge library additions\n"
            f"- Added `docs/knowledge-library/{name}` → `#{category}`\n"
        )
        # Insert before the "How to use this log" section or at end.
        marker = "\n---\n\n## How to use this log"
        if marker in text:
            text = text.replace(marker, entry + marker, 1)
        else:
            text = text.rstrip() + entry + "\n"
    write_file(LOG, text)


def _insert_backlink(doc_path: Path, new_name: str, new_title: str) -> None:
    """Insert a back-link from `doc_path` to `new_name` in its Related section.

    Finds the "## Related" section and appends a wiki-link to the new doc.
    If no Related section exists, appends one at the end of the body.
    """
    text = read_file(doc_path)
    link_line = f"- [[{new_name}]] :see-also — {new_title}\n"
    # Check if link already exists.
    if f"[[{new_name}]]" in text:
        return
    # Try to insert into an existing "## Related" section.
    m = re.search(r"(## Related\n)(.*?)(?=\n## |\Z)", text, re.S)
    if m:
        # Add link after the "## Related\n" heading (skip placeholder text).
        new_section = m.group(1) + link_line + m.group(2)
        text = text[:m.start()] + new_section + text[m.end():]
    else:
        # No Related section — append one before the closing --- if present, else at end.
        if text.rstrip().endswith("---"):
            text = text.rstrip() + "\n\n## Related\n\n" + link_line
        else:
            text = text.rstrip() + "\n\n## Related\n\n" + link_line
    write_file(doc_path, text)


def run_validator() -> int:
    """Run validate-knowledge-tags.py and return its exit code."""
    import subprocess
    result = subprocess.run(
        [sys.executable, str(REPO / "tools" / "validate-knowledge-tags.py")],
        cwd=REPO,
    )
    return result.returncode


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Scaffold a new knowledge-library document (KB schema §7).",
    )
    parser.add_argument("-t", "--title", help="Document title (human-readable)")
    parser.add_argument("-c", "--category", choices=CATEGORY_SLUGS,
                        help="Primary category (e.g. technical, production)")
    parser.add_argument("-T", "--type", choices=PAGE_TYPES,
                        help="Page type (concept/entity/source/comparison/synthesis/tracker/index)")
    parser.add_argument("-a", "--alias", action="append", default=[],
                        help="Alias (can repeat)")
    parser.add_argument("-x", "--cross-tag", action="append", default=[],
                        help="Cross-cutting tag (can repeat)")
    parser.add_argument("--no-auto-links", action="store_true",
                        help="Skip inserting auto-suggested related-doc links")
    parser.add_argument("--no-validate", action="store_true",
                        help="Skip running validate-knowledge-tags.py")
    args = parser.parse_args(argv)

    title = args.title or prompt("Document title")
    if not title:
        print("Title is required.", file=sys.stderr)
        return 1

    slug = slugify(title)
    target = filename_for(slug)
    if target.exists():
        print(f"File already exists: {target}", file=sys.stderr)
        return 1

    # Category.
    if args.category:
        category = args.category
    else:
        category = choose_category()
    # Normalize: allow full label or slug.
    for _key, (cat, label) in CATEGORIES.items():
        if category == label:
            category = cat
            break

    # Type.
    if args.type:
        ptype = args.type
    else:
        ptype = choose_type(category, title)

    # Aliases.
    aliases = list(args.alias) or [title]
    # Cross-cutting tags.
    cross_tags = list(args.cross_tag)

    # Find related docs for auto-links (prevents orphans at creation time).
    related_docs: list[tuple[str, str, str]] = []
    if not args.no_auto_links:
        related_docs = find_related_docs(category, ptype, cross_tags)
        if related_docs:
            print(f"\nAuto-linked {len(related_docs)} related document(s):")
            for name, display, relation in related_docs:
                print(f"  -> [[{name}|{display}]] {relation}")

    # Build file content.
    fm = build_frontmatter(category, ptype, title, aliases, cross_tags)
    body = body_template(title, related_docs)
    content = fm + body

    write_file(target, content)
    print(f"\nCreated {target}")

    # Register in index + tracker + log.
    display = aliases[0] if aliases else title
    insert_in_index(target.stem, category, title, display)
    insert_in_tracker(target.stem, category)
    bump_index_counts(category, cross_tags)
    append_to_log(target.name, category)
    print("Registered in index.md, knowledge-tracker.md, and log.md.")

    # Insert back-links from related docs into their Related sections so the
    # new doc is not an orphan (other docs link to it).
    # find_related_docs() returns stems (no .md) so the wiki-links it emits
    # match the vault's link convention — add the extension back here.
    if not args.no_auto_links and related_docs:
        for name, _display, _relation in related_docs:
            related_path = BASE / f"{name}.md"
            if related_path.exists():
                _insert_backlink(related_path, target.stem, title)

    # Validate.
    if args.no_validate:
        print("\nSkipped validation (--no-validate).")
        print("\nRemember: run `python tools/validate-knowledge-tags.py` before committing.")
        return 0

    print("\nRunning validate-knowledge-tags.py ...")
    rc = run_validator()
    if rc != 0:
        print("Validation reported problems — review before committing.", file=sys.stderr)
    else:
        print("Validation clean.")
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
