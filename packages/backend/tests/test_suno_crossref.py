"""Tests for the Suno cross-reference service.

Asserted against the real shipped data (116/960/3084 = 4,160 and 314 production
phrases), because the point of the tiers is that they partition the real tag list.
A fixture would pass even if the JSON were re-extracted wrong.
"""

from __future__ import annotations

from app.services import suno_crossref as cx

# ── the partition holds ───────────────────────────────────────────────────────


def test_every_trello_tag_has_exactly_one_tier():
    from app.services import treblo_tag_picker as picker

    tags = picker.all_tags()
    assert len(tags) == 4160
    assert all(cx.tier_for(t) in (1, 2, 3) for t in tags), "every tag must be tiered"


def test_tier_counts_match_the_shipped_data():
    counts = cx.tier_counts()
    assert counts["tier1_exact_match"] == 116
    assert counts["tier2_word_attested"] == 960
    assert counts["tier3_untested_in_corpus"] == 3084


def test_tiers_partition_exactly_one_way():
    """No tag may be counted twice, or the counts would not sum to 4,160."""
    from app.services import treblo_tag_picker as picker

    tags = picker.all_tags()
    assert sum(cx.tier_counts().values()) == len(tags)


def test_obvious_tags_are_not_mislabelled_as_unverified():
    """The corpus misses obvious Suno-safe terms; tier 3 must not imply invalid."""
    for tag in ("classical", "pop", "rock", "jazz"):
        assert cx.tier_for(tag) == 1, tag


# ── lookups ───────────────────────────────────────────────────────────────────


def test_tier_for_is_case_insensitive():
    assert cx.tier_for("Classical") == cx.tier_for("classical")


def test_unknown_tag_has_no_tier():
    assert cx.tier_for("definitely-not-a-tag") is None


def test_attestation_carries_a_label():
    rec = cx.attestation_for(["classical"])["classical"]
    assert rec["tier"] == 1
    assert rec["label"] == "verified"
    assert rec["key"] == "tier1_exact_match"


def test_tier3_is_labelled_unverified_not_invalid():
    """The wording must not overclaim. This is the label the UI shows."""
    assert cx.TIER_LABELS[3] == "unverified"
    assert "invalid" not in cx.TIER_LABELS.values()
    assert "unsupported" not in cx.TIER_LABELS.values()


def test_attestation_omits_unknown_tags():
    out = cx.attestation_for(["classical", "not-a-real-tag-xyz"])
    assert "classical" in out
    assert "not-a-real-tag-xyz" not in out


# ── production vocabulary ─────────────────────────────────────────────────────


def test_production_vocab_is_present():
    assert cx.production_count() == 314


def test_production_phrases_do_not_collide_with_trello_tags():
    """Disjointness is what lets them be offered as a separate row safely."""
    from app.services import treblo_tag_picker as picker

    tagset = {t.lower() for t in picker.all_tags()}
    clashes = [p for p in cx.production_vocab(limit=314) if p.lower() in tagset]
    assert clashes == []


def test_production_search_ranks_prefix_matches_first():
    results = cx.production_vocab("808", limit=5)
    assert results, "an attested phrase should match"
    assert all("808" in r.lower() for r in results)


def test_production_search_is_case_insensitive():
    assert cx.production_vocab("VINYL") == cx.production_vocab("vinyl")


def test_production_search_with_no_query_returns_the_head():
    assert len(cx.production_vocab(limit=10)) == 10


def test_production_search_respects_the_limit():
    assert len(cx.production_vocab("", limit=5)) == 5


def test_meta_exposes_its_sources():
    """The UI describes its own scope; it needs to know where the data came from."""
    m = cx.meta()
    assert "sources" in m
    assert "method" in m


# ── degradation ───────────────────────────────────────────────────────────────


def test_missing_file_degrades_to_empty_not_an_exception(monkeypatch, tmp_path):
    monkeypatch.setattr(cx, "_CROSSREF_PATH", tmp_path / "nope.json")
    monkeypatch.setattr(cx, "_loaded", False)
    assert cx.tier_for("classical") is None
    assert cx.production_count() == 0
    assert cx.production_vocab("808") == []
