"""Shared wiki-link parsing for the knowledge-library tools.

Why this module exists
----------------------
`validate-knowledge-tags.py`, `kb-graph.py` and `kb-context.py` all need to
read the vault's `[[wiki-links]]`. Each of them used to carry its own
copy of the pattern, and the copies drifted: the graph tool's regex
required a relation to sit *immediately* after `]]`, while the vault writes
`[[doc]] :relation` with a space. The result was 27 typed relations that
the graph tool could not see — it reported "0 typed relations" for a vault
that had them.

One parser, one behaviour. If the link syntax changes, it changes here.

Link syntax
-----------
    [[slug]]                 plain link
    [[slug|display text]]    link with a label
    [[slug]] :relation       typed link  (space before the colon)
    [[slug]]:relation        typed link  (no space — also accepted)
    [[slug#anchor]]          link to a section
    [[slug.md]]              a filename; the .md is stripped on resolution

Anything inside a code span (backticks) is an example, not a link, and is
skipped. Anything containing a path separator is a cross-directory
reference, which is intentional in this vault and is not resolved here.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

# A wiki-link, with an optional label and an optional typed relation.
# The relation may be preceded by whitespace: the vault writes `]] :see-also`.
WIKI_LINK_RE = re.compile(
    r"\[\[([^|\]\]]+)(?:\|[^\]]*)?\]\]\s*(?::([a-z][a-z-]*))?",
    re.IGNORECASE,
)

# Inline code spans — content here is an example, not a live link.
CODE_SPAN_RE = re.compile(r"`[^`]*`")

# The valid page types (see docs/knowledge-library/_schema.md §2).
PAGE_TYPES = ("concept", "entity", "source", "comparison",
              "synthesis", "tracker", "index")

# The typed relations and their traversal weights (_schema.md §3).
RELATION_WEIGHTS = {
    "cites": 4,
    "extends": 3,
    "implements": 3,
    "compares-to": 2,
    "part-of": 2,
    "see-also": 1,
}

# The relation used when a link carries no explicit type.
DEFAULT_RELATION = "see-also"

# The files that are part of the vault but are not library articles.
SPECIAL_FILES = ("index.md", "README.md", "_schema.md", "log.md")


@dataclass(frozen=True)
class Link:
    """One wiki-link found in a document."""

    slug: str
    """The target, normalised: no anchor, no .md extension."""

    relation: str | None
    """The typed relation, or None when the link is untyped."""

    @property
    def weight(self) -> int:
        """Traversal weight — 4 for :cites down to 1 for the default."""
        return RELATION_WEIGHTS.get(self.relation or DEFAULT_RELATION, 1)

    @property
    def is_typed(self) -> bool:
        return self.relation is not None


def normalize_slug(raw: str) -> str:
    """Normalise a link target to a comparable slug.

    Strips the anchor (`#section`) and the `.md` extension, and trims
    whitespace. `[[doc]]`, `[[doc.md]]` and `[[doc#part]]` all normalise
    to `doc`.
    """
    slug = raw.strip().split("#")[0]
    if slug.endswith(".md"):
        slug = slug[:-3]
    return slug


def is_cross_directory(slug: str) -> bool:
    """True for references that point outside this directory."""
    return "/" in slug or ".." in slug


def parse_links(text: str) -> list[Link]:
    """Return every wiki-link in `text`, in document order.

    Inline code spans are removed first, so `[[slug]]` used as a syntax
    example is not counted. Cross-directory references are skipped.
    """
    text = CODE_SPAN_RE.sub("", text)
    links: list[Link] = []
    for m in WIKI_LINK_RE.finditer(text):
        slug = normalize_slug(m.group(1))
        if not slug or is_cross_directory(slug):
            continue
        relation = m.group(2)
        links.append(Link(slug=slug, relation=relation.lower() if relation else None))
    return links


def extract_slugs(text: str) -> set[str]:
    """Return the set of link targets in `text` (relations discarded)."""
    return {link.slug for link in parse_links(text)}


def relation_weight(relation: str | None) -> int:
    """Traversal weight of a relation; the default relation scores 1."""
    return RELATION_WEIGHTS.get(relation or DEFAULT_RELATION, 1)
