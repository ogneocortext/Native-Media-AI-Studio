"""Markdown structure primitives for the knowledge-library tools.

Split out of `kb-chunk.py` so that the patterns have one definition. A
duplicated pattern is how the link parsers drifted apart in the first
place; the same discipline applies here.

The rules encoded here are the ones the 2026 chunking literature converges
on (arXiv:2601.14123, arXiv:2603.23533):

* headings are the primary boundary;
* code fences and tables are atomic — never cut in half;
* a table is only a table if it has a separator row.
"""
from __future__ import annotations

import re

# A markdown heading: one to six '#' followed by a space and the title.
HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")

# A code fence delimiter (``` or ~~~), optionally indented.
FENCE_RE = re.compile(r"^\s*(```|~~~)")

# A table row: pipes at both ends.
TABLE_ROW_RE = re.compile(r"^\s*\|.*\|\s*$")

# A table separator row, with or without leading and trailing pipes:
#     | --- | --- |
#     --- | ---
TABLE_SEP_RE = re.compile(r"^\s*\|?[\s:|-]*-[\s:|-]*\|[\s:|-]*$")

# A table separator row in canonical form: every cell is dashes and/or colons.
TABLE_SEP_CELLS_RE = re.compile(r"^\s*\|(?:\s*:?-{2,}:?\s*\|)+\s*$")


def is_table_line(line: str) -> bool:
    """True when a line is part of a markdown table.

    Includes separator rows, which do not always begin with a pipe.
    """
    if TABLE_ROW_RE.match(line):
        return True
    return bool(TABLE_SEP_RE.match(line)) and "|" in line


def is_separator_row(line: str) -> bool:
    """True when a line separates a table's header from its body."""
    if TABLE_SEP_CELLS_RE.match(line):
        return True
    return bool(TABLE_SEP_RE.match(line)) and "|" in line


def has_table(text: str) -> bool:
    """True when a block of text contains a markdown table."""
    return any(is_separator_row(line) for line in text.split("\n"))


def fence_markers(text: str) -> int:
    """The number of code-fence delimiters in a block of text.

    An odd count means the source has an unterminated fence.
    """
    return sum(1 for line in text.split("\n") if FENCE_RE.match(line))
