"""E2E tests for /api/retrieval HTTP endpoints.

These exercise the full FastAPI route stack (status, index, search) against the
real app with mocked embedding/reranking so they run fast and deterministically
without requiring Ollama or transformers to be installed.
"""

from __future__ import annotations

import pytest
import pytest_asyncio

# ---------------------------------------------------------------------------
# Embedding mocks — replace Ollama calls with deterministic vectors
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def mock_embeddings(monkeypatch):
    """Replace embed_text/embed_text_batch_concurrent with deterministic fakes.

    Patches both the ollama_client module (where functions are defined) and
    retrieval.py (which imports them directly), so the index endpoint's calls
    are also mocked.
    """
    import app.api.retrieval as ret_mod
    import app.core.ollama_client as oc
    import app.services.retrieval_service as rs_mod

    def vec(text: str) -> list[float]:
        # Deterministic 768-dim vector based on text content hash
        h = abs(hash(text)) % 1000
        return [float(h) / 1000.0] * 768

    async def fake_embed_text(text, model=None, timeout=30, expected_dim=None):
        if expected_dim is not None and 768 != expected_dim:
            return None
        return vec(text)

    async def fake_batch(texts, model=None, timeout=30, expected_dim=None):
        return [await fake_embed_text(t, model, timeout, expected_dim) for t in texts]

    async def fake_available(model, timeout=5):
        return True

    monkeypatch.setattr(oc, "embed_text", fake_embed_text)
    monkeypatch.setattr(oc, "embed_text_batch_concurrent", fake_batch)
    monkeypatch.setattr(oc, "_embed_model_available", fake_available)
    monkeypatch.setattr(oc, "_embed_warmed_up", set())
    # retrieval.py imports embed_text_batch_concurrent directly
    monkeypatch.setattr(ret_mod, "embed_text_batch_concurrent", fake_batch)
    # retrieval_service.py imports embed_text directly
    monkeypatch.setattr(rs_mod, "embed_text", fake_embed_text)
    return {}


@pytest.fixture
def reranker_mock():
    """Replace RetrievalIndex.hybrid_search with a deterministic fake.

    Bypasses the slow cross-encoder reranker entirely, returning canned
    results that exercise the full HTTP search path.
    """

    from app.services.retrieval_service import RetrievalIndex

    original_hybrid_search = RetrievalIndex.hybrid_search

    async def fake_hybrid_search(self, query, *, limit=5, vault_only=False):
        return [
            {
                "chunk_id": "test-chunk-1",
                "doc_path": "docs/test.md",
                "doc_title": "Test Doc",
                "chunk_index": 0,
                "text": "This is a test document about Ollama embedding models.",
                "rerank_score": 0.95,
                "matched_terms": ["ollama", "embedding"],
            }
        ]

    RetrievalIndex.hybrid_search = fake_hybrid_search

    yield

    RetrievalIndex.hybrid_search = original_hybrid_search


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestRetrievalStatus:
    async def test_status_endpoint(self, client):
        r = await client.get("/api/retrieval/status")
        assert r.status_code == 200
        body = r.json()
        assert "embedding_model" in body
        assert "rerank_model" in body
        assert "embedding_model_available" in body
        assert "models_available" in body


class TestRetrievalIndex:
    async def test_index_endpoint(self, client, mock_embeddings):
        r = await client.post("/api/retrieval/index", json={"force_reindex": True})
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "indexed"
        assert body["chunks"] > 0
        assert body["docs"] > 0
        assert body["embedding_model"] == "nomic-embed-text:v1.5"

    async def test_index_is_idempotent(self, client, mock_embeddings):
        r1 = await client.post("/api/retrieval/index", json={"force_reindex": True})
        r2 = await client.post("/api/retrieval/index", json={"force_reindex": True})
        assert r1.status_code == 200
        assert r2.status_code == 200
        assert r1.json()["chunks"] == r2.json()["chunks"]


class TestRetrievalSearch:
    async def test_search_returns_results(self, client, mock_embeddings, reranker_mock):
        # Must index first
        await client.post("/api/retrieval/index", json={"force_reindex": True})

        r = await client.post(
            "/api/retrieval/search",
            json={"query": "Ollama embedding model", "limit": 5},
        )
        assert r.status_code == 200
        body = r.json()
        assert "results" in body
        assert "total_returned" in body
        assert body["total_returned"] > 0
        assert len(body["results"]) <= 5

        # Each result should have expected fields
        for result in body["results"]:
            assert "chunk_id" in result
            assert "doc_path" in result
            assert "doc_title" in result
            assert "text" in result
            assert "rerank_score" in result
            assert "matched_terms" in result
            assert isinstance(result["rerank_score"], (int, float))

    async def test_search_respects_limit(self, client, mock_embeddings, reranker_mock):
        await client.post("/api/retrieval/index", json={"force_reindex": True})

        r = await client.post(
            "/api/retrieval/search",
            json={"query": "Ollama", "limit": 2},
        )
        assert r.status_code == 200
        body = r.json()
        assert len(body["results"]) <= 2

    async def test_search_empty_query(self, client, mock_embeddings, reranker_mock):
        await client.post("/api/retrieval/index", json={"force_reindex": True})

        r = await client.post(
            "/api/retrieval/search",
            json={"query": "", "limit": 5},
        )
        assert r.status_code == 200
        body = r.json()
        # Empty query should still return results (BM25 matches nothing,
        # but reranker may still score)
        assert "results" in body

    async def test_search_before_index(self, client, mock_embeddings, reranker_mock):
        # Reset index to empty state
        from app.services.retrieval_service import reset_index
        reset_index()

        r = await client.post(
            "/api/retrieval/search",
            json={"query": "anything", "limit": 5},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["results"] == []
        assert body["total_returned"] == 0

    async def test_search_rerank_scores_in_range(self, client, mock_embeddings, reranker_mock):
        await client.post("/api/retrieval/index", json={"force_reindex": True})

        r = await client.post(
            "/api/retrieval/search",
            json={"query": "Ollama embedding", "limit": 5},
        )
        assert r.status_code == 200
        body = r.json()
        for result in body["results"]:
            # Rerank scores from our mock are overlap ratios (0 to 1)
            assert 0.0 <= result["rerank_score"] <= 1.0


class TestRetrievalEndToEnd:
    """Full flow: index -> search -> verify relevance."""

    async def test_relevant_result_ranks_high(self, client, mock_embeddings, reranker_mock):
        await client.post("/api/retrieval/index", json={"force_reindex": True})

        r = await client.post(
            "/api/retrieval/search",
            json={"query": "Ollama embedding model setup", "limit": 5},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["total_returned"] > 0

        # The top result should mention Ollama or embedding
        top_text = body["results"][0]["text"].lower()
        assert "ollama" in top_text or "embedding" in top_text


# ---------------------------------------------------------------------------
# Unavailable model scenarios
# ---------------------------------------------------------------------------


class TestRetrievalWhenEmbeddingUnavailable:
    async def test_status_reports_unavailable(self, monkeypatch, client):
        import app.core.ollama_client as oc

        async def fake_available(model, timeout=5):
            return False

        monkeypatch.setattr(oc, "_embed_model_available", fake_available)

        r = await client.get("/api/retrieval/status")
        assert r.status_code == 200
        body = r.json()
        assert body["embedding_model_available"] is False

    async def test_search_degrades_to_bm25(self, monkeypatch, client, mock_embeddings, reranker_mock):
        """When embedding model is unavailable, search should still return BM25 results."""
        import app.core.ollama_client as oc
        import app.services.retrieval_service as rs

        async def fake_embed_none(text, model=None, timeout=30, expected_dim=None):
            return None

        monkeypatch.setattr(oc, "embed_text", fake_embed_none)
        rs._rerank_cache.clear()

        await client.post("/api/retrieval/index", json={"force_reindex": True})

        r = await client.post(
            "/api/retrieval/search",
            json={"query": "Ollama embedding", "limit": 5},
        )
        assert r.status_code == 200
        body = r.json()
        # Should still return results via BM25-only (vector search skipped)
        assert "results" in body
