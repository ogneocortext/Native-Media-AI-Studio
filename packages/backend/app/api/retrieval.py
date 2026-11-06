"""
Retrieval API -- hybrid BM25 + vector search with local reranking.

Endpoints:
  POST   /api/retrieval/index   (Re)index docs corpus into BM25 + vector index
  POST   /api/retrieval/search  Hybrid search: BM25 + vector -> RRF -> rerank
  GET    /api/retrieval/status  Index status and model availability
"""

import logging

from fastapi import APIRouter
from pydantic import BaseModel

from ..core.ollama_client import embed_text_batch_concurrent, list_models
from ..services.retrieval_service import (
    EMBED_DIM,
    EMBED_MODEL,
    RERANK_MODEL,
    VECTOR_MODEL_ALT,
    _scan_docs_for_indexing,
    get_index,
    persist_chunk_embeddings,
    reset_index,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/retrieval", tags=["Retrieval"])


class IndexRequest(BaseModel):
    force_reindex: bool = False
    model: str | None = None  # override default embedding model for indexing


class IndexStatus(BaseModel):
    built: bool
    chunk_count: int
    doc_count: int
    avg_length: float
    embedding_model: str
    index_model: str | None = None
    content_hash: str | None = None
    embedding_model_available: bool = True
    embedding_models_available: list[str] = []
    rerank_model: str
    built_at: float | None = None
    models_available: list[str] = []


class SearchRequest(BaseModel):
    query: str
    limit: int = 5
    vault_only: bool = False
    model: str | None = None  # override default embedding model for query embedding


class SearchResult(BaseModel):
    chunk_id: str
    doc_path: str
    doc_title: str
    chunk_index: int
    text: str
    rerank_score: float
    matched_terms: list[str] = []


class SearchResponse(BaseModel):
    query: str
    results: list[SearchResult]
    total_returned: int


# ---------------------------------------------------------------------------
# Indexing
# ---------------------------------------------------------------------------


@router.post("/index", response_model=dict)
async def index_docs(req: IndexRequest) -> dict:
    """(Re)index the docs corpus: chunk, embed, and store in SQLite + memory."""
    global _indexing
    if _indexing:
        return {"status": "already_indexing", "message": "Indexing already in progress"}

    _indexing = True
    try:
        idx = get_index()
        if not req.force_reindex and idx._chunks:
            return {"status": "already_indexed", "chunks": len(idx._chunks)}

        # Reset and rebuild
        reset_index()
        idx = get_index()

        entries = _scan_docs_for_indexing()
        if not entries:
            return {"status": "empty", "chunks": 0, "message": "No docs found to index"}

        # Add all chunks to BM25 index
        for entry in entries:
            idx.add_chunk(
                entry["chunk_id"],
                entry["doc_path"],
                entry["doc_title"],
                entry["chunk_index"],
                entry["text"],
                is_superseded=entry.get("is_superseded", False),
            )
        idx.finalize()

        # Generate embeddings for all chunks (concurrent Ollama calls)
        chunk_objects = list(idx._chunks.values())
        texts = [c.text for c in chunk_objects]
        index_model = req.model or EMBED_MODEL
        embs = await _embed_batch(texts, index_model)
        # embs is a list (possibly with None slots for failed embeddings);
        # never None itself since embed_text_batch_concurrent always returns a list.
        if embs is None or all(e is None for e in embs):
            logger.warning("Embedding failed for all chunks; continuing with BM25-only index")

        # Assign embeddings back to chunks
        for i, chunk in enumerate(chunk_objects):
            if i < len(embs) and embs[i] is not None:
                chunk.embedding = embs[i]

        idx._embeddings = {c.id: c.embedding for c in chunk_objects if c.embedding is not None}
        # Record which model built the index for smart selection
        idx._index_model = index_model
        # Content hash is set by finalize() above

        # Persist to SQLite
        await persist_chunk_embeddings(chunk_objects)

        return {
            "status": "indexed",
            "chunks": len(chunk_objects),
            "docs": len({c.doc_path for c in chunk_objects}),
            "embedding_model": index_model,
            "index_model": index_model,
            "content_hash": idx._content_hash,
            "rerank_model": RERANK_MODEL,
        }
    finally:
        _indexing = False


_indexing = False


@router.get("/status", response_model=IndexStatus)
async def index_status() -> IndexStatus:
    """Current index status and model availability."""
    idx = get_index()
    models = await list_models() or []
    model_names = [m.get("name", "") for m in models]

    # Cross-check that the configured embedding model is actually installed.
    # If it's missing, vector search silently degrades to BM25-only, so we
    # surface the gap explicitly rather than letting the user wonder why
    # semantic results are poor.
    model_names = [m.get("name", "") for m in models]
    embedding_model_available = EMBED_MODEL in model_names
    # Also report which alternative embedding models are installed
    embedding_models_available = [m for m in (EMBED_MODEL, VECTOR_MODEL_ALT) if m in model_names]
    if not embedding_model_available:
        logger.warning(
            "Configured embedding model %s is not installed in Ollama; "
            "vector search will fall back to BM25-only until it is pulled "
            "(`ollama pull %s`) or a fallback model is available.",
            EMBED_MODEL,
            EMBED_MODEL,
        )

    return IndexStatus(
        built=bool(idx._chunks),
        chunk_count=len(idx._chunks),
        doc_count=len({c.doc_path for c in idx._chunks.values()}),
        avg_length=idx._avg_len,
        embedding_model=EMBED_MODEL,
        index_model=idx._index_model,
        content_hash=idx._content_hash,
        embedding_model_available=embedding_model_available,
        embedding_models_available=embedding_models_available,
        rerank_model=RERANK_MODEL,
        built_at=idx._built_at,
        models_available=model_names,
    )


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------


@router.post("/search", response_model=SearchResponse)
async def search(req: SearchRequest) -> SearchResponse:
    """
    Hybrid search: BM25 + vector -> RRF -> rerank -> top-k.

    Uses local Ollama models (nomic-embed-text for vectors,
    BAAI/bge-reranker-v2-m3 for reranking) -- nothing leaves the machine.
    """
    idx = get_index()
    if not idx._chunks:
        return SearchResponse(query=req.query, results=[], total_returned=0)

    results = await idx.hybrid_search(
        req.query,
        limit=req.limit,
        vault_only=req.vault_only,
        model=req.model or EMBED_MODEL,
    )

    search_results = [
        SearchResult(
            chunk_id=r["chunk_id"],
            doc_path=r["doc_path"],
            doc_title=r["doc_title"],
            chunk_index=r["chunk_index"],
            text=r["text"],
            rerank_score=r["rerank_score"],
            matched_terms=r.get("matched_terms", []),
        )
        for r in results
    ]

    return SearchResponse(
        query=req.query,
        results=search_results,
        total_returned=len(search_results),
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _embed_batch(texts: list[str], model: str) -> list[list[float] | None] | None:
    """Embed multiple texts via Ollama, concurrently (bounded round-trips).

    Replaced the serial loop with :func:`embed_text_batch_concurrent` so
    indexing a large corpus no longer waits on each /api/embed round trip
    one at a time. Results are returned in input order; a failed embedding
    yields ``None`` at that position.
    """
    return await embed_text_batch_concurrent(texts, model=model, expected_dim=EMBED_DIM)
