"""Tests for the shared knowledge-library link parser.

`tools/_kb_links.py` exists because three tools each used to carry their own
copy of the wiki-link pattern, and the copies drifted. The graph tool's
pattern required a relation to sit immediately after `]]`, while the vault
writes `[[doc]] :relation` with a space — so 27 typed relations in the vault
were invisible to it, and it reported "0 typed relations" for a vault that
had them.

These tests pin the syntax so that drift cannot come back silently.

Run:  python -m pytest tools/tests/unit -v
"""

import sys
from pathlib import Path

import pytest

# tools/ is not on sys.path when pytest imports this file by path.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from _kb_links import (  # noqa: E402
    DEFAULT_RELATION,
    RELATION_WEIGHTS,
    extract_slugs,
    normalize_slug,
    parse_links,
    relation_weight,
)


class TestRelationSyntax:
    """A relation may be separated from the link by whitespace or not."""

    def test_relation_with_a_space(self):
        """The form the vault actually uses: [[doc]] :relation."""
        links = parse_links("- [[comfyui-workflows]] :implements")
        assert len(links) == 1
        assert links[0].slug == "comfyui-workflows"
        assert links[0].relation == "implements"
        assert links[0].is_typed

    def test_relation_without_a_space(self):
        links = parse_links("- [[comfyui-workflows]]:implements")
        assert links[0].relation == "implements"

    def test_untyped_link_has_no_relation(self):
        links = parse_links("- [[comfyui-workflows]]")
        assert links[0].relation is None
        assert not links[0].is_typed
        # But it still has a weight — the default relation's.
        assert links[0].weight == RELATION_WEIGHTS[DEFAULT_RELATION]

    def test_both_spellings_agree(self):
        """The regression: the two spellings must not diverge."""
        spaced = parse_links("[[a]] :cites")
        tight = parse_links("[[a]]:cites")
        assert spaced[0].relation == tight[0].relation == "cites"

    def test_relation_is_lowercased(self):
        assert parse_links("[[a]] :See-Also")[0].relation == "see-also"


class TestSlugNormalisation:
    def test_plain_slug(self):
        assert parse_links("[[doc]]")[0].slug == "doc"

    def test_md_extension_is_stripped(self):
        assert parse_links("[[doc.md]]")[0].slug == "doc"

    def test_anchor_is_stripped(self):
        assert parse_links("[[doc#section]]")[0].slug == "doc"

    def test_label_is_stripped(self):
        assert parse_links("[[doc|Some Label]]")[0].slug == "doc"

    def test_label_and_anchor_together(self):
        assert parse_links("[[doc#sec|Label]]")[0].slug == "doc"

    def test_normalize_slug_helper(self):
        assert normalize_slug("doc.md") == "doc"
        assert normalize_slug("doc#a") == "doc"
        assert normalize_slug("  doc  ") == "doc"


class TestFiltering:
    def test_inline_code_is_not_a_link(self):
        """A syntax example in backticks is not a live link."""
        assert parse_links("use `[[doc]]` to link") == []

    def test_inline_code_mixed_with_a_real_link(self):
        slugs = extract_slugs("`[[example]]` but really [[real]]")
        assert slugs == {"real"}

    def test_cross_directory_references_are_skipped(self):
        assert parse_links("[[../ux/audit-report]]") == []
        assert parse_links("[[other/doc]]") == []

    def test_document_order_is_preserved(self):
        links = parse_links("[[a]] then [[b]] then [[c]]")
        assert [link.slug for link in links] == ["a", "b", "c"]


class TestWeights:
    def test_known_relations_have_their_documented_weights(self):
        assert relation_weight("cites") == 4
        assert relation_weight("extends") == 3
        assert relation_weight("implements") == 3
        assert relation_weight("compares-to") == 2
        assert relation_weight("part-of") == 2
        assert relation_weight("see-also") == 1

    def test_untyped_links_score_as_the_default_relation(self):
        assert relation_weight(None) == relation_weight(DEFAULT_RELATION)

    def test_an_unknown_relation_scores_as_the_default(self):
        assert relation_weight("invented") == relation_weight(DEFAULT_RELATION)


class TestExtractSlugs:
    def test_returns_a_set(self):
        assert extract_slugs("[[a]] [[a]] [[b]]") == {"a", "b"}

    def test_discards_relations(self):
        assert extract_slugs("[[a]] :cites") == {"a"}


@pytest.mark.parametrize("text,expected", [
    ("[[a]] :cites", {"a"}),
    ("[[a]]:cites", {"a"}),
    ("[[a.md]] :cites", {"a"}),
])
def test_slugs_are_relations_independent(text, expected):
    assert extract_slugs(text) == expected
