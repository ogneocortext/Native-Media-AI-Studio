"""Tests for the dense and hybrid retrieval layer.

`tools/kb-retrieval.py` is what will serve retrieval, so its pieces are
pinned here: the fusion arithmetic, the chunk enrichment, the cosine
similarity, and the nomic task prefixes (which are easy to omit and
quietly degrade retrieval).

Run:  python -m pytest tools/tests/unit -v
"""

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools"))


def _load():
    spec = importlib.util.spec_from_file_location(
        "kb_retrieval", ROOT / "tools" / "kb-retrieval.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


kr = _load()


class TestCosine:
    def test_identical_vectors_score_one(self):
        assert kr.cosine([1.0, 0.0], [1.0, 0.0]) == pytest.approx(1.0)

    def test_orthogonal_vectors_score_zero(self):
        assert kr.cosine([1.0, 0.0], [0.0, 1.0]) == pytest.approx(0.0)

    def test_opposite_vectors_score_minus_one(self):
        assert kr.cosine([1.0, 0.0], [-1.0, 0.0]) == pytest.approx(-1.0)

    def test_mismatched_lengths_score_zero(self):
        assert kr.cosine([1.0, 0.0], [1.0, 0.0, 0.0]) == 0.0

    def test_empty_vectors_score_zero(self):
        assert kr.cosine([], [1.0]) == 0.0

    def test_zero_vector_scores_zero(self):
        assert kr.cosine([0.0, 0.0], [1.0, 1.0]) == 0.0


class TestRRFFusion:
    def test_agreement_rises_above_the_ranks(self):
        """A document both retrievers like must outrank one only they like."""
        # bm25 ranks 0 first; dense ranks 1 first.
        fused = kr.rrf_fuse([[0, 1, 2], [1, 2, 0]])
        assert fused[0] == 1

    def test_agreement_wins(self):
        """A document both retrievers like must outrank one only they like.

        Document 1 is second for the first retriever and first for the
        second, so both contribute to it; document 0 is first for the
        first retriever and absent from the second.
        """
        fused = kr.rrf_fuse([[0, 1], [1]])
        assert fused[0] == 1

    def test_a_symmetric_pair_ties(self):
        """Two documents with mirrored ranks get identical fused scores."""
        fused = kr.rrf_fuse([[0, 1], [1, 0]])
        assert sorted(fused) == [0, 1]

    def test_empty_input(self):
        assert kr.rrf_fuse([]) == []

    def test_a_single_ranking_passes_through_in_order(self):
        assert kr.rrf_fuse([[3, 1, 2]]) == [3, 1, 2]

    def test_every_input_document_appears(self):
        fused = kr.rrf_fuse([[0, 1], [2, 3]])
        assert sorted(fused) == [0, 1, 2, 3]


class TestEnrich:
    def test_heading_path_is_prepended(self):
        out = kr.enrich("body text", "A > B")
        assert out.startswith("A > B")
        assert "body text" in out

    def test_no_heading_path_leaves_the_text_alone(self):
        assert kr.enrich("body text", "") == "body text"

    def test_the_body_is_preserved(self):
        assert "the original body" in kr.enrich("the original body", "X")


class TestNomicPrefixes:
    """Nomic requires task prefixes; omitting them degrades retrieval."""

    def test_document_and_query_prefixes_differ(self):
        assert kr.DOCUMENT_PREFIX != kr.QUERY_PREFIX

    def test_the_prefixes_are_the_nomic_ones(self):
        assert kr.DOCUMENT_PREFIX == "search_document: "
        assert kr.QUERY_PREFIX == "search_query: "

    def test_the_embedder_selects_the_prefix_by_kind(self):
        embedder = kr.Embedder(cache=False)
        seen = {}

        class FakePost:
            def __init__(self, payload):
                seen["payload"] = payload

        def fake_post(payload):
            FakePost(payload)
            n = len(payload["input"])
            return [[0.1, 0.2, 0.3] for _ in range(n)]

        embedder._post = fake_post
        embedder.embed(["hello"], kind="query")
        assert seen["payload"]["input"][0].startswith(kr.QUERY_PREFIX)
        embedder.embed(["hello"], kind="document")
        assert seen["payload"]["input"][0].startswith(kr.DOCUMENT_PREFIX)


class TestTokenize:
    def test_stopwords_are_dropped(self):
        assert "the" not in kr.tokenize("the model")

    def test_content_survives(self):
        assert "pascal" in kr.tokenize("Pascal GPU tuning")


class TestCrossEncoderReranker:
    """The reranker must degrade explicitly, never silently."""

    def test_missing_libraries_report_unavailable(self, monkeypatch):
        import builtins

        real_import = builtins.__import__

        def fake_import(name, *args, **kwargs):
            if name == "transformers":
                raise ImportError("no transformers")
            return real_import(name, *args, **kwargs)

        monkeypatch.setattr(builtins, "__import__", fake_import)
        r = kr.CrossEncoderReranker()
        assert r._ensure() is False
        assert r.available is False
        # And scoring returns zeros rather than raising.
        assert r.score("q", ["a", "b"]) == [0.0, 0.0]

    def test_rerank_with_no_candidates(self):
        r = kr.CrossEncoderReranker()
        assert r.rerank("q", [], ["a"], 5) == []

    def test_rerank_preserves_the_candidate_set(self, monkeypatch):
        r = kr.CrossEncoderReranker()
        r.available = True
        r._model = object()
        # Score by a fixed ordering so the result is checkable.
        monkeypatch.setattr(
            r, "score",
            lambda q, ps: [3.0 if p.startswith("good") else 1.0 for p in ps],
        )
        passages = ["weak text", "good passage", "other text"]
        out = r.rerank("q", [0, 1, 2], passages, 2)
        assert out[0] == 1
        assert sorted(out) == [0, 1]


class TestBM25:
    def test_the_matching_document_ranks_first(self):
        index = kr.BM25([kr.tokenize("pascal gpu optimization"),
                          kr.tokenize("unrelated music notes")])
        assert index.top(kr.tokenize("pascal gpu"), 1)[0] == 0

    def test_an_unmatched_query_scores_zero(self):
        index = kr.BM25([kr.tokenize("alpha"), kr.tokenize("beta")])
        assert index.scores(kr.tokenize("omega")) == [0.0, 0.0]
