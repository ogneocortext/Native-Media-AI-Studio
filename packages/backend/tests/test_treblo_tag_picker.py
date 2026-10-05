"""Tests for the Treblo tag picker service and API.

The data file is real, so these assert against the actual 4,160 tags rather than a
fixture. That matters here: the spec's acceptance criteria name specific tags
(`phonk`, `drift phonk`, `memphis rap`, `trap`), and a mock would pass even if the
shipped data had drifted.
"""

from __future__ import annotations

import pytest
from app.services import treblo_tag_picker as svc

# ─── loading ──────────────────────────────────────────────────────────────────


def test_loads_the_real_tag_count():
    assert svc.tag_count() == 4160


def test_all_tags_are_unique():
    tags = svc.all_tags()
    assert len(tags) == len(set(tags))


def test_no_tag_contains_a_comma():
    """The copy output is comma-joined; a comma inside a tag would corrupt it."""
    assert [t for t in svc.all_tags() if "," in t] == []


# ─── search ───────────────────────────────────────────────────────────────────


def test_exact_match_ranks_first():
    assert svc.search_tags("phonk")[0] == "phonk"


def test_search_is_case_insensitive():
    assert svc.search_tags("PHONK")[0] == "phonk"
    assert svc.search_tags("Drift Phonk")[0] == "drift phonk"


def test_spec_acceptance_tags_all_appear():
    results = svc.search_tags("phonk", limit=50)
    for tag in ("phonk", "drift phonk", "rare phonk", "phonk house"):
        assert tag in results, tag


def test_prefix_outranks_substring():
    # "phonk house" starts with the query; "dark drift" merely contains "drif".
    results = svc.search_tags("phonk", limit=100)
    assert results.index("phonk house") < results.index("brazilian phonk")


def test_empty_query_returns_nothing():
    assert svc.search_tags("") == []
    assert svc.search_tags("   ") == []


def test_fuzzy_match_finds_typos():
    # subsequence match: "phnk" appears in order inside "phonk".
    assert "phonk" in svc.search_tags("phnk")


def test_limit_is_respected():
    assert len(svc.search_tags("a", limit=5)) <= 5


def test_non_ascii_tags_are_searchable():
    """Non-ASCII tags exist and must be searchable.

    Measured on the shipped data: 145 tags carry non-ASCII characters and they are
    *accented Latin* (coree, forro, laiko with diacritics) - not Hangul or CJK.
    SPEC.md claims non-Latin scripts (Arabic, Korean, Chinese, Cyrillic, Greek) are
    present, but the data has zero Hangul and one CJK tag, so that claim is wrong.
    This asserts against what is actually there, so it keeps meaning if the data is
    re-extracted.
    """
    non_ascii = [t for t in svc.all_tags() if any(ord(c) > 127 for c in t)]
    assert non_ascii, "expected some non-ASCII tags in the shipped data"
    assert svc.search_tags("cor\u00e9e"), "accented-Latin tags must be searchable"
    assert svc.search_tags("COR\u00c9E"), "search must stay case-insensitive for them"


# ─── related ──────────────────────────────────────────────────────────────────


def test_related_resolves_indices_to_names():
    related = svc.related_tags("drift phonk", limit=100)
    assert "memphis rap" in related
    assert "trap" in related


def test_related_excludes_the_tag_itself():
    assert "drift phonk" not in svc.related_tags("drift phonk", limit=100)


def test_related_is_case_insensitive():
    assert svc.related_tags("DRIFT PHONK") == svc.related_tags("drift phonk")


def test_unknown_tag_returns_empty_not_error():
    assert svc.related_tags("zzzz-definitely-not-a-tag") == []


# ─── build ────────────────────────────────────────────────────────────────────


def test_build_joins_in_order():
    assert svc.build_tag_string(["a", "b", "c"]) == "a, b, c"


def test_build_dedupes_case_insensitively_keeping_first_spelling():
    # `R&B` and `r b` are genuinely distinct tags on the site, so they must NOT be
    # folded together; only repeated identical tags collapse.
    assert svc.build_tag_string(["Phonk", "phonk", "Phonk"]) == "Phonk"
    assert svc.build_tag_string(["R&B", "r b"]) == "R&B, r b"


def test_build_strips_and_drops_blanks():
    assert svc.build_tag_string(["  phonk ", "", "   ", "trap"]) == "phonk, trap"


def test_build_of_nothing_is_empty_string():
    assert svc.build_tag_string([]) == ""


# ─── API ──────────────────────────────────────────────────────────────────────


@pytest.fixture
def client():
    from app.main import app
    from fastapi.testclient import TestClient

    return TestClient(app)


def test_api_search(client):
    body = client.get("/api/treblo-tags/search", params={"q": "phonk"}).json()
    assert body["results"][0] == "phonk"


def test_api_related(client):
    body = client.get("/api/treblo-tags/related", params={"tag": "drift phonk"}).json()
    assert "memphis rap" in body["related"]


def test_api_build(client):
    body = client.post(
        "/api/treblo-tags/build", json={"tags": ["drift phonk", "phonk", "dark", "aggressive"]}
    ).json()
    assert body["tag_string"] == "drift phonk, phonk, dark, aggressive"


def test_api_count(client):
    assert client.get("/api/treblo-tags/count").json()["count"] == 4160


def test_routes_are_registered():
    """A router that is not included in main.py answers 404 with no other symptom."""
    from app.main import app

    paths = app.openapi()["paths"]
    for p in ("/api/treblo-tags/search", "/api/treblo-tags/related",
              "/api/treblo-tags/build", "/api/treblo-tags/count"):
        assert p in paths, p
