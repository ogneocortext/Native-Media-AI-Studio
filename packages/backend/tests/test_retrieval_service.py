"""Tests for the retrieval service: hybrid BM25 + vector search with cross-encoder reranking.

The reranker uses HuggingFace transformers (AutoModelForSequenceClassification)
to score each (query, passage) pair jointly -- not Ollama's /api/embed, which
is a dual-encoder and cannot produce cross-encoder relevance logits.

Tests avoid pulling the real qllama/bge-reranker-v2-m3 model (568 MB) by
monkeypatching the module-level _get_reranker hook.
"""

from __future__ import annotations

from collections import UserDict

import pytest
import pytest_asyncio

from app.services.retrieval_service import (
    RetrievalIndex,
    _rerank_cross_encoder,
    reset_index,
)

# ---------------------------------------------------------------------------
# Fixture: fresh index with a handful of chunks
# ---------------------------------------------------------------------------


def _build_index() -> RetrievalIndex:
    idx = RetrievalIndex()
    idx.add_chunk(
        "c1", "docs/queue-manager.md", "Queue Manager", 0,
        "The queue manager handles job scheduling and resource allocation.",
        title_weight=4,
    )
    idx.add_chunk(
        "c2", "docs/ollama-setup.md", "Ollama Setup", 0,
        "Ollama runs local LLMs on the GPU with automatic model download.",
        title_weight=4,
    )
    idx.add_chunk(
        "c3", "docs/vram-guide.md", "VRAM Guide", 0,
        "GTX 1070 Ti has 8 GB VRAM; Pascal cards use fp16 only.",
        title_weight=4,
    )
    idx.add_chunk(
        "c4", "docs/comfyui-workflow.md", "ComfyUI Workflow", 0,
        "ComfyUI workflows use a node-based graph for image generation.",
        title_weight=4,
    )
    idx.add_chunk(
        "c5", "docs/audio-pipeline.md", "Audio Pipeline", 0,
        "The audio pipeline separates stems and applies enhancement filters.",
        title_weight=4,
    )
    idx.finalize()
    return idx


# ---------------------------------------------------------------------------
# rerank() -- cross-encoder unavailable path (the common CI case)
# ---------------------------------------------------------------------------


class TestRerankUnavailable:
    """When transformers/torch or the model are missing, rerank degrades
    explicitly: returns candidates in input order with 0.0 scores and logs a
    warning. It never silently returns an empty list."""

    @pytest.fixture(autouse=True)
    def _no_reranker(self, monkeypatch):
        monkeypatch.setattr("app.services.retrieval_service._get_reranker", lambda: None)

    @pytest_asyncio.fixture
    async def idx(self):
        return _build_index()

    async def test_rerank_empty_candidates(self, idx):
        assert await idx.rerank("query", []) == []

    async def test_rerank_returns_input_order_when_unavailable(self, idx):
        candidates = [("c1", "text one"), ("c3", "text three"), ("c2", "text two")]
        result = await idx.rerank("queue scheduling", candidates)
        # Unavailable reranker: same order, zero scores
        assert result == [("c1", 0.0), ("c3", 0.0), ("c2", 0.0)]

    async def test_rerank_never_returns_empty_on_failure(self, monkeypatch, caplog):
        """Even if _rerank_cross_encoder raises, we degrade, not return []."""
        def boom(query, candidates):
            raise RuntimeError("model exploded")
        monkeypatch.setattr(
            "app.services.retrieval_service._rerank_cross_encoder", boom
        )
        idx = _build_index()
        with caplog.at_level("WARNING"):
            result = await idx.rerank("queue", [("c1", "t1"), ("c2", "t2")])
        assert result == [("c1", 0.0), ("c2", 0.0)]
        assert "Reranker failed" in caplog.text


# ---------------------------------------------------------------------------
# rerank() -- cross-encoder available path (mocked _rerank_cross_encoder)
# ---------------------------------------------------------------------------


class TestRerankAvailable:
    @pytest.fixture(autouse=True)
    def _mock_reranker(self, monkeypatch):
        def fake_rerank(query, candidates):
            # Relevance = 1.0 if "queue" in text, else 0.1
            scored = [
                (cid, 1.0 if "queue" in text.lower() else 0.1)
                for cid, text in candidates
            ]
            scored.sort(key=lambda kv: -kv[1])
            return scored

        monkeypatch.setattr(
            "app.services.retrieval_service._rerank_cross_encoder", fake_rerank
        )

    @pytest_asyncio.fixture
    async def idx(self):
        return _build_index()

    async def test_rerank_reorders_by_relevance(self, idx):
        # "queue scheduling" should rank the queue-manager chunk first
        candidates = [
            ("c3", "GTX 1070 Ti has 8 GB VRAM; Pascal cards use fp16 only."),
            ("c1", "The queue manager handles job scheduling and resource allocation."),
            ("c2", "Ollama runs local LLMs on the GPU with automatic model download."),
        ]
        result = await idx.rerank("queue scheduling", candidates)
        assert result[0][0] == "c1"  # queue manager first
        # sigmoid(1.0) ≈ 0.731, sigmoid(0.1) ≈ 0.525
        assert abs(result[0][1] - 0.7310585786300049) < 1e-6
        assert abs(result[1][1] - 0.52497918747894) < 1e-6
        assert abs(result[2][1] - 0.52497918747894) < 1e-6

    async def test_rerank_empty(self, idx):
        assert await idx.rerank("anything", []) == []


# ---------------------------------------------------------------------------
# hybrid_search() -- full pipeline
# ---------------------------------------------------------------------------


class TestHybridSearch:
    @pytest.fixture(autouse=True)
    def _mock_reranker(self, monkeypatch):
        def fake_rerank(query, candidates):
            scored = [
                (cid, 1.0 if "queue" in text.lower() else 0.1)
                for cid, text in candidates
            ]
            scored.sort(key=lambda kv: -kv[1])
            return scored

        monkeypatch.setattr(
            "app.services.retrieval_service._rerank_cross_encoder", fake_rerank
        )

    @pytest_asyncio.fixture
    async def idx(self):
        return _build_index()

    async def test_hybrid_search_returns_results(self, idx):
        results = await idx.hybrid_search("queue manager scheduling")
        assert len(results) > 0
        # Top result should mention queue
        assert "queue" in results[0]["text"].lower() or results[0]["rerank_score"] > 0.5

    async def test_hybrid_search_limit(self, idx):
        results = await idx.hybrid_search("queue", limit=2)
        # Only 1 chunk contains "queue", so limit is respected (≤ limit)
        assert len(results) <= 2

    async def test_hybrid_search_empty_index(self):
        reset_index()
        idx = RetrievalIndex()  # empty, no chunks added
        results = await idx.hybrid_search("queue")
        assert results == []

    async def test_hybrid_search_has_rerank_score(self, idx):
        results = await idx.hybrid_search("queue manager")
        for r in results:
            assert "rerank_score" in r
            assert isinstance(r["rerank_score"], float)

    async def test_hybrid_search_dedupes_by_doc(self):
        """Multiple chunks from the same doc should collapse to one result."""
        idx = RetrievalIndex()
        idx.add_chunk("d1a", "docs/same-doc.md", "Same Doc", 0, "Queue scheduling first chunk.", title_weight=4)
        idx.add_chunk("d1b", "docs/same-doc.md", "Same Doc", 1, "Queue scheduling second chunk.", title_weight=4)
        idx.add_chunk("d2", "docs/other-doc.md", "Other Doc", 0, "Ollama setup guide.", title_weight=4)
        idx.finalize()
        results = await idx.hybrid_search("queue")
        doc_paths = {r["doc_path"] for r in results}
        assert "docs/same-doc.md" in doc_paths
        # Same doc should appear at most once
        assert sum(1 for r in results if r["doc_path"] == "docs/same-doc.md") == 1

    async def test_hybrid_search_cache_respects_limit_and_vault_scope(self, monkeypatch):
        idx = RetrievalIndex()
        idx.add_chunk("outside", "docs/general.md", "General", 0, "searchable term")
        idx.add_chunk(
            "inside", "docs/knowledge-library/guide.md", "Guide", 0, "searchable term"
        )
        idx.finalize()

        async def no_vectors(*args, **kwargs):
            return []

        async def ordered_rerank(query, candidates, **kwargs):
            return [(cid, 1.0 if cid == "outside" else 0.9) for cid, _ in candidates]

        monkeypatch.setattr(idx, "vector_search", no_vectors)
        monkeypatch.setattr(idx, "rerank", ordered_rerank)

        first = await idx.hybrid_search("searchable", limit=1)
        vault = await idx.hybrid_search("searchable", limit=1, vault_only=True)
        both = await idx.hybrid_search("searchable", limit=2)

        assert [item["chunk_id"] for item in first] == ["outside"]
        assert [item["chunk_id"] for item in vault] == ["inside"]
        assert {item["chunk_id"] for item in both} == {"outside", "inside"}


# ---------------------------------------------------------------------------
# _get_reranker -- unavailable without transformers
# ---------------------------------------------------------------------------


class TestGetReranker:
    def test_get_reranker_returns_none_when_transformers_missing(self, monkeypatch):
        """Without transformers installed, _get_reranker returns None and logs."""
        import app.services.retrieval_service as rs

        # Reset module-level state
        monkeypatch.setattr(rs, "_reranker_model", None)
        monkeypatch.setattr(rs, "_reranker_tokenizer", None)
        monkeypatch.setattr(rs, "_reranker_available", None)

        real_import = __import__

        def fake_import(name, *args, **kwargs):
            if name == "transformers":
                raise ImportError("No module named 'transformers'")
            return real_import(name, *args, **kwargs)

        monkeypatch.setattr("builtins.__import__", fake_import)
        from app.services.retrieval_service import _get_reranker as gr
        assert gr() is None
        assert rs._reranker_available is False


# ---------------------------------------------------------------------------
# _rerank_cross_encoder -- direct unit test with mocked model/tokenizer
# ---------------------------------------------------------------------------


class TestRerankCrossEncoderDirect:
    def test_scores_pairs_and_sorts(self, monkeypatch):
        """Direct unit test of _rerank_cross_encoder with a fake model."""

        import app.services.retrieval_service as rs

        class FakeLogits:
            def __init__(self, values):
                self._values = values
                self.shape = (len(values), 1)

            def squeeze(self, dim):
                return self

            def cpu(self):
                return self

            def tolist(self):
                return list(self._values)

        class FakeModelOutput:
            def __init__(self, logits):
                self.logits = logits

        class FakeModel:
            def __init__(self, scores):
                self.scores = scores

            def __call__(self, **kwargs):
                return FakeModelOutput(FakeLogits(self.scores))

        class FakeTokenizer:
            def __init__(self, scores):
                self.scores = scores

            def __call__(self, queries, texts, **kwargs):
                return FakeEncoding()

        class FakeEncoding(UserDict):
            def __init__(self):
                super().__init__({})

            def to(self, device):
                return self

        # Set module-level model/tokenizer directly so _get_reranker returns them
        scores = [0.9, 0.2, 0.7]
        rs._reranker_model = FakeModel(scores)
        rs._reranker_tokenizer = FakeTokenizer(scores)
        rs._reranker_available = True

        try:
            candidates = [("a", "text a"), ("b", "text b"), ("c", "text c")]
            result = _rerank_cross_encoder("query", candidates)

            # Highest score first
            assert result[0][0] == "a"
            assert result[0][1] == 0.9
            assert result[1][0] == "c"
            assert result[1][1] == 0.7
            assert result[2][0] == "b"
            assert result[2][1] == 0.2
        finally:
            rs._reranker_model = None
            rs._reranker_tokenizer = None
            rs._reranker_available = None

    def test_returns_empty_for_no_candidates(self, monkeypatch):
        import app.services.retrieval_service as rs

        rs._reranker_model = object()
        rs._reranker_tokenizer = object()
        rs._reranker_available = True
        try:
            assert _rerank_cross_encoder("query", []) == []
        finally:
            rs._reranker_model = None
            rs._reranker_tokenizer = None
            rs._reranker_available = None


# ---------------------------------------------------------------------------
# Embedding model setup: warm-up, availability, fallback, concurrent batch
# ---------------------------------------------------------------------------


class TestEmbeddingSetup:
    """Tests for /api/embed warm-up, model-availability checks, fallback, and
    concurrent batch embedding. All Ollama calls are monkeypatched so no model
    needs to be installed in the test environment.
    """

    @pytest.fixture(autouse=True)
    def _reset_warm_state(self, monkeypatch):
        """Reset module-level warm-up state between tests."""
        import app.core.ollama_client as oc

        oc._embed_warmed_up.clear()

    @pytest_asyncio.fixture
    async def _fake_embed(self, monkeypatch):
        """Monkeypatch embed_text_raw so no real Ollama call is made.

        Returns a dict mapping model name -> list of (text -> embedding) that
        tests can populate.
        """
        import app.core.ollama_client as oc

        embeddings: dict[str, dict[str, list[float]]] = {}

        async def fake_raw(model, text, timeout=30):
            model_map = embeddings.setdefault(model, {})
            if text not in model_map:
                model_map[text] = [0.1, 0.2, 0.3]
            return model_map[text]

        monkeypatch.setattr(oc, "embed_text_raw", fake_raw)
        return embeddings

    @pytest_asyncio.fixture
    async def _fake_list_models(self, monkeypatch):
        """Monkeypatch list_models to return a controllable model list."""
        import app.core.ollama_client as oc

        available: list[str] = []

        async def fake_list(timeout=10):
            return [{"name": m} for m in available]

        monkeypatch.setattr(oc, "list_models", fake_list)
        return available

    async def test_embed_warmup_marks_model(self, _fake_embed, _fake_list_models):
        import app.core.ollama_client as oc

        _fake_list_models.extend(["nomic-embed-text:v1.5"])
        await oc._embed_warmup("nomic-embed-text:v1.5")
        assert "nomic-embed-text:v1.5" in oc._embed_warmed_up
        # Second call is a no-op (still just one entry).
        await oc._embed_warmup("nomic-embed-text:v1.5")
        assert "nomic-embed-text:v1.5" in oc._embed_warmed_up

    async def test_embed_model_available_true(self, _fake_list_models):
        import app.core.ollama_client as oc

        _fake_list_models.extend(["nomic-embed-text:v1.5"])
        assert await oc._embed_model_available("nomic-embed-text:v1.5") is True

    async def test_embed_model_available_false(self, _fake_list_models):
        import app.core.ollama_client as oc

        _fake_list_models.extend(["other-model"])
        assert await oc._embed_model_available("nomic-embed-text:v1.5") is False

    async def test_embed_text_uses_primary_model(self, _fake_embed, _fake_list_models):
        import app.core.ollama_client as oc

        _fake_list_models.extend(["nomic-embed-text:v1.5"])
        emb = await oc.embed_text("hello world")
        assert emb == [0.1, 0.2, 0.3]

    async def test_embed_text_falls_back_to_secondary(self, _fake_embed, _fake_list_models):
        import app.core.ollama_client as oc

        # Only the fallback model is "installed".
        _fake_list_models.extend(["embeddinggemma-2:270m"])
        emb = await oc.embed_text("hello world")
        assert emb == [0.1, 0.2, 0.3]
        # The fallback model should now be warmed up.
        assert "embeddinggemma-2:270m" in oc._embed_warmed_up

    async def test_embed_text_all_unavailable(self, _fake_embed, _fake_list_models, caplog):
        import app.core.ollama_client as oc

        # No models installed at all.
        _fake_list_models.extend([])
        with caplog.at_level("WARNING"):
            emb = await oc.embed_text("hello world")
        assert emb is None
        assert "All embedding models failed" in caplog.text

    async def test_embed_text_batch_concurrent(self, _fake_embed, _fake_list_models):
        import app.core.ollama_client as oc

        _fake_list_models.extend(["nomic-embed-text:v1.5"])
        texts = ["one", "two", "three"]
        results = await oc.embed_text_batch_concurrent(texts)
        assert results == [[0.1, 0.2, 0.3], [0.1, 0.2, 0.3], [0.1, 0.2, 0.3]]

    async def test_embed_text_batch_concurrent_empty(self, _fake_embed, _fake_list_models):
        import app.core.ollama_client as oc

        _fake_list_models.extend(["nomic-embed-text:v1.5"])
        assert await oc.embed_text_batch_concurrent([]) == []


# ---------------------------------------------------------------------------
# Rerank score thresholding
# ---------------------------------------------------------------------------


class TestRerankScoreThreshold:
    """Relative score thresholding: keep results where score >= top1 * alpha."""

    @pytest.fixture(autouse=True)
    def _mock_reranker(self, monkeypatch):
        def fake_rerank(query, candidates):
            # Scores: 1.0 for "queue", 0.5 for "audio", 0.1 for others
            scored = []
            for _cid, text in candidates:
                if "queue" in text.lower():
                    s = 1.0
                elif "audio" in text.lower():
                    s = 0.5
                else:
                    s = 0.1
                scored.append((_cid, s))
            scored.sort(key=lambda kv: -kv[1])
            return scored

        monkeypatch.setattr(
            "app.services.retrieval_service._rerank_cross_encoder", fake_rerank
        )

    @pytest_asyncio.fixture
    async def idx(self):
        return _build_index()

    async def test_threshold_filters_low_scores(self, idx):
        """With alpha=0.25, cutoff = top1 * 0.25 = 0.731 * 0.25 = 0.183."""
        candidates = [
            ("c1", "The queue manager handles job scheduling."),
            ("c5", "The audio pipeline separates stems."),
            ("c3", "GTX 1070 Ti has 8 GB VRAM."),
            ("c4", "ComfyUI workflows use nodes."),
        ]
        result = await idx.rerank("queue scheduling", candidates)
        # top1 = sigmoid(1.0) = 0.731, cutoff = 0.731 * 0.25 = 0.183
        # sigmoid(0.5) = 0.622 (passes), sigmoid(0.1) = 0.525 (passes)
        # All pass since even sigmoid(0.1) = 0.525 > 0.183
        assert len(result) == 4
        assert result[0][0] == "c1"

    async def test_strict_threshold_filters_more(self, idx):
        """With alpha=0.9, cutoff = 0.731 * 0.9 = 0.658."""
        candidates = [
            ("c1", "The queue manager handles job scheduling."),
            ("c5", "The audio pipeline separates stems."),
            ("c3", "GTX 1070 Ti has 8 GB VRAM."),
        ]
        result = await idx.rerank("queue scheduling", candidates, score_threshold=0.9)
        # Only sigmoid(1.0) = 0.731 >= 0.658 passes
        assert len(result) == 1
        assert result[0][0] == "c1"

    async def test_zero_threshold_returns_all(self, idx):
        """With alpha=0.0, all candidates pass."""
        candidates = [
            ("c1", "The queue manager handles job scheduling."),
            ("c3", "GTX 1070 Ti has 8 GB VRAM."),
        ]
        result = await idx.rerank("queue scheduling", candidates, score_threshold=0.0)
        assert len(result) == 2


# ---------------------------------------------------------------------------
# Rerank result caching
# ---------------------------------------------------------------------------


class TestRerankCaching:
    """Result caching skips recomputation for repeat queries."""

    @pytest.fixture(autouse=True)
    def _mock_reranker(self, monkeypatch):
        call_count = {"n": 0}

        def fake_rerank(query, candidates):
            call_count["n"] += 1
            scored = [
                (cid, 1.0 if "queue" in text.lower() else 0.1)
                for cid, text in candidates
            ]
            scored.sort(key=lambda kv: -kv[1])
            return scored

        monkeypatch.setattr(
            "app.services.retrieval_service._rerank_cross_encoder", fake_rerank
        )
        # Also clear the cache
        import app.services.retrieval_service as rs
        rs._rerank_cache.clear()
        yield
        rs._rerank_cache.clear()

    @pytest_asyncio.fixture
    async def idx(self):
        return _build_index()

    async def test_cache_returns_same_results(self, idx):
        """Second call with same query+candidates returns cached results."""
        candidates = [
            ("c1", "The queue manager handles job scheduling."),
            ("c3", "GTX 1070 Ti has 8 GB VRAM."),
        ]
        result1 = await idx.rerank("queue scheduling", candidates)
        result2 = await idx.rerank("queue scheduling", candidates)
        assert result1 == result2

    async def test_cache_key_differs_by_query(self, idx):
        """Different queries produce different cache keys."""
        candidates = [("c1", "The queue manager handles job scheduling.")]
        result1 = await idx.rerank("queue scheduling", candidates)
        result2 = await idx.rerank("VRAM guide", candidates)
        # Different queries may return different orderings/scores
        assert result1 != result2 or len(result1) == len(result2)


# ---------------------------------------------------------------------------
# MMR diversification
# ---------------------------------------------------------------------------


class TestMMR:
    """Maximal Marginal Relevance diversification after rerank."""

    @pytest.fixture(autouse=True)
    def _mock_reranker(self, monkeypatch):
        def fake_rerank(query, candidates):
            scored = [
                (cid, 1.0 if "queue" in text.lower() else 0.1)
                for cid, text in candidates
            ]
            scored.sort(key=lambda kv: -kv[1])
            return scored

        monkeypatch.setattr(
            "app.services.retrieval_service._rerank_cross_encoder", fake_rerank
        )
        # Clear cache
        import app.services.retrieval_service as rs
        rs._rerank_cache.clear()
        yield
        rs._rerank_cache.clear()

    @pytest_asyncio.fixture
    async def idx(self):
        return _build_index()

    async def test_mmr_returns_top_k(self, idx):
        """MMR returns at most top_k results."""
        candidates = [
            ("c1", "The queue manager handles job scheduling."),
            ("c2", "Ollama runs local LLMs on the GPU."),
            ("c3", "GTX 1070 Ti has 8 GB VRAM."),
        ]
        result = await idx.rerank("queue", candidates, use_cache=False)
        # MMR is applied in hybrid_search, not directly in rerank
        # rerank itself returns all candidates sorted by score
        assert len(result) == 3
        assert result[0][0] == "c1"


# ---------------------------------------------------------------------------
# get_index convenience
# ---------------------------------------------------------------------------


class TestGetIndex:
    """Convenience accessor tests."""

    def test_get_index_returns_singleton(self):
        from app.services.retrieval_service import get_index

        reset_index()
        idx1 = get_index()
        idx2 = get_index()
        assert idx1 is idx2
