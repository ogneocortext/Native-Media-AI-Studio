"""Tests for the retrieval evaluation harness.

`tools/kb-eval.py` is the thing that decides whether the chunking is worth
its shape, so its own correctness matters: a metric that is stuck at a
constant regardless of the configuration measures an artifact, not
retrieval. These tests pin the pieces that could go wrong silently.

Run:  python -m pytest tools/tests/unit -v
"""

import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools"))


def _load():
    spec = importlib.util.spec_from_file_location(
        "kb_eval", ROOT / "tools" / "kb-eval.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ev = _load()


class TestTokenize:
    def test_lowercases_and_splits(self):
        assert ev.tokenize("Hello, World!") == ["hello", "world"]

    def test_drops_stopwords(self):
        assert "the" not in ev.tokenize("the model and the world")

    def test_keeps_hyphenated_and_underscored_tokens(self):
        assert "physically-based" in ev.tokenize("a physically-based model")
        assert "beat_timing" in ev.tokenize("beat_timing rules")

    def test_drops_single_characters(self):
        assert "a" not in ev.tokenize("a b c model")

    def test_empty_input(self):
        assert ev.tokenize("") == []


class TestBM25:
    def test_ranks_the_document_containing_the_query_first(self):
        docs = [ev.tokenize("pascal gpu optimization tuning"),
                ev.tokenize("unrelated text about music"),
                ev.tokenize("gpu pascal kernels")]
        index = ev.BM25(docs)
        top = index.top(ev.tokenize("pascal gpu"), 2)
        assert top[0] in (0, 2)

    def test_a_term_matching_nothing_scores_zero(self):
        docs = [ev.tokenize("alpha beta"), ev.tokenize("gamma delta")]
        index = ev.BM25(docs)
        scores = index.scores(ev.tokenize("omega"))
        assert scores == [0.0, 0.0]

    def test_rare_terms_count_for_more(self):
        rare = ev.tokenize("zzzuniqueterm")
        docs = [ev.tokenize("a b c d e f g " + "zzzuniqueterm"),
                ev.tokenize("a b c d e f g h i j")]
        index = ev.BM25(docs)
        scores = index.scores(rare)
        assert scores[0] > scores[1]

    def test_top_respects_k(self):
        docs = [ev.tokenize(f"doc{i} common") for i in range(10)]
        index = ev.BM25(docs)
        assert len(index.top(ev.tokenize("common"), 3)) == 3


class TestSquash:
    def test_collapses_whitespace_runs(self):
        assert ev._squash("a\n  b\tc") == "a b c"

    def test_lowercases(self):
        assert ev._squash("ABC") == "abc"


class TestNgram:
    def test_takes_the_leading_words(self):
        assert ev._ngram("one two three four five six seven") == \
            "one two three four five six"

    def test_shorter_sentences_are_returned_whole(self):
        assert ev._ngram("one two") == "one two"


class TestProbes:
    """A probe whose answer term is common measures nothing."""

    def _docs(self):
        # "model" and "guide" are in both documents (common); everything
        # else is in one document only (rare). The two query styles pick
        # from opposite ends of that spread, so they must differ.
        rare_a = "pascal gpu optimization tuning photorealistic subsurface"
        rare_b = "quick brown fox lazy dog jumps over renders"
        return [
            {"name": "a.md", "title": "A", "body":
             f"The model guide for {rare_a}. " * 12},
            {"name": "b.md", "title": "B", "body":
             f"The model guide for {rare_b}. " * 12},
        ]

    def test_probes_are_built(self):
        probes = ev.build_probes(self._docs(), limit=10)
        assert probes
        for p in probes:
            assert p["answer"]
            assert p["query"]
            assert p["doc"].endswith(".md")

    def test_the_answer_is_withheld_from_the_query(self):
        probes = ev.build_probes(self._docs(), limit=10)
        for p in probes:
            assert p["answer"] not in p["query"].split()

    def test_the_answer_is_a_real_word_not_a_fragment(self):
        """'js' out of 'Anime.js' is not an answer worth measuring."""
        probes = ev.build_probes(self._docs(), limit=10)
        for p in probes:
            assert len(p["answer"]) >= 4
            assert not p["answer"].isdigit()

    def test_the_answer_is_rare_enough_to_be_informative(self):
        probes = ev.build_probes(self._docs(), limit=10)
        for p in probes:
            assert p["answer_df"] <= 5, "answer term is too common to measure"

    def test_generic_and_specific_queries_differ(self):
        specific = ev.build_probes(self._docs(), limit=10, mode="specific")
        generic = ev.build_probes(self._docs(), limit=10, mode="generic")
        assert [p["query"] for p in specific] != [p["query"] for p in generic]


class TestScoring:
    def test_answer_hit_requires_the_term(self):
        rows = ev._score(
            {"doc": "d"}, [0], "the quick brown fox", __import__("re")
            .compile(r"\bfox\b"), "quick brown", [{"doc": "d"}], "d")
        assert rows["answer_hit"] is True
        assert rows["passage_hit"] is True
        assert rows["doc_rank"] == 1

    def test_passage_hit_survives_line_wrapping(self):
        """The library is hard-wrapped; a phrase split across lines still
        counts as present."""
        rows = ev._score(
            {"doc": "d"}, [0], "the quick brown\nfox jumps over",
            __import__("re").compile(r"\bfox\b"), "quick brown fox jumps",
            [{"doc": "d"}], "d")
        assert rows["passage_hit"] is True

    def test_a_missing_answer_scores_zero(self):
        rows = ev._score(
            {"doc": "d"}, [0], "completely other text",
            __import__("re").compile(r"\bfox\b"), "quick brown",
            [{"doc": "d"}], "d")
        assert rows["answer_hit"] is False
        assert rows["passage_hit"] is False

    def test_gold_document_rank_is_reported(self):
        rows = ev._score(
            {"doc": "d"}, [0, 1], "text",
            __import__("re").compile(r"\bfox\b"), "",
            [{"doc": "other"}, {"doc": "d"}], "d")
        assert rows["doc_rank"] == 2
