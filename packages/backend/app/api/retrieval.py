"""
Retrieval API -- hybrid BM25 + vector search with local reranking.

Endpoints:
  POST   /api/retrieval/index   (Re)index docs corpus into BM25 + vector index
  POST   /api/retrieval/search  Hybrid search: BM25 + vector -> RRF -> rerank
  GET    /api/retrieval/status  Index status and model availability
"""

import logging
import re
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from ..core.config import PROJECT_ROOT
from ..core.ollama_client import embed_text, list_models
from ..services.retrieval_service import (
    EMBED_MODEL,
    _split_text_into_chunks,
    get_index,
    persist_chunk_embeddings,
    reset_index,
)
from ..services.retrieval_service import (
    _chunk_id as hashlib_chunk_id,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/retrieval", tags=["Retrieval"])

DOCS_ROOT = PROJECT_ROOT / "docs"
VAULT_ROOT = DOCS_ROOT / "knowledge-library"


class IndexRequest(BaseModel):
    force_reindex: bool = False


class IndexStatus(BaseModel):
    built: bool
    chunk_count: int
    doc_count: int
    avg_length: float
    embedding_model: str
    rerank_model: str
    built_at: float | None = None
    models_available: list[str] = []


class SearchRequest(BaseModel):
    query: str
    limit: int = 5
    vault_only: bool = False


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

async def _scan_docs_for_indexing() -> list[dict[str, Any]]:
    """Scan docs corpus and return chunk-ready entries."""
    entries: list[dict[str, Any]] = []
    if not DOCS_ROOT.exists():
        return entries

    seen: set[str] = set()
    for p in list(DOCS_ROOT.rglob("*.md")) + list(VAULT_ROOT.glob("*.md")):
        if ".obsidian" in p.parts:
            continue
        if "node_modules" in p.parts:
            continue
        key = p.resolve().as_posix()
        if key in seen:
            continue
        seen.add(key)

        try:
            rel = p.relative_to(DOCS_ROOT).as_posix()
            in_vault = p.is_relative_to(VAULT_ROOT) if hasattr(p, "is_relative_to") else str(p).startswith(str(VAULT_ROOT))
            try:
                text = p.read_text(encoding="utf-8", errors="ignore")
                # Strip frontmatter for cleaner indexing
                body = text
                if text.startswith("---"):
                    end = text.find("\n---", 3)
                    if end != -1:
                        body = text[end + 4:].lstrip("\n")
                # Title from first H1 or filename
                m = re.search(r"^#\s+(.+)", body, re.MULTILINE)
                title = m.group(1).strip()[:80] if m else p.stem.replace("-", " ").replace("_", " ").title()
                tags = []
                # Extract tags from frontmatter
                if text.startswith("---"):
                    end = text.find("\n---", 3)
                    if end != -1:
                        fm = text[3:end]
                        for line in fm.splitlines():
                            if line.strip().startswith("tags:"):
                                v = line.split(":", 1)[1].strip()
                                if v.startswith("["):
                                    v = v.strip("[]")
                                    tags = [x.strip().strip('"').strip("'") for x in v.split(",") if x.strip()]
                                else:
                                    tags = [v.strip().strip('"').strip("'")]
                                break
            except Exception:
                continue

            chunks = _split_text_into_chunks(body)
            for i, chunk_text in enumerate(chunks):
                entries.append({
                    "chunk_id": hashlib_chunk_id(rel, i),
                    "doc_path": rel,
                    "doc_title": title,
                    "chunk_index": i,
                    "text": chunk_text,
                    "in_vault": in_vault,
                    "tags": tags,
                })
        except Exception:
            continue

    return entries


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

        entries = await _scan_docs_for_indexing()
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
            )
        idx.finalize()

        # Generate embeddings for all chunks (one Ollama call per chunk)
        chunk_objects = list(idx._chunks.values())
        texts = [c.text for c in chunk_objects]
        embs = await _embed_batch(texts, EMBED_MODEL)
        if embs is None:
            logger.warning("Embedding failed for some chunks; continuing with partial embeddings")

        # Assign embeddings back to chunks
        for i, chunk in enumerate(chunk_objects):
            if i < len(embs) and embs[i] is not None:
                chunk.embedding = embs[i]

        idx._embeddings = {c.id: c.embedding for c in chunk_objects if c.embedding is not None}

        # Persist to SQLite
        await persist_chunk_embeddings(chunk_objects)

        return {
            "status": "indexed",
            "chunks": len(chunk_objects),
            "docs": len({c.doc_path for c in chunk_objects}),
            "embedding_model": EMBED_MODEL,
            "rerank_model": "qllama/bge-reranker-v2-m3",
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

    return IndexStatus(
        built=bool(idx._chunks),
        chunk_count=len(idx._chunks),
        doc_count=len({c.doc_path for c in idx._chunks.values()}),
        avg_length=idx._avg_len,
        embedding_model=EMBED_MODEL,
        rerank_model="qllama/bge-reranker-v2-m3",
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
    qllama/bge-reranker-v2-m3 for reranking) -- nothing leaves the machine.
    """
    idx = get_index()
    if not idx._chunks:
        return SearchResponse(query=req.query, results=[], total_returned=0)

    results = await idx.hybrid_search(
        req.query,
        limit=req.limit,
        vault_only=req.vault_only,
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
    """Embed multiple texts via Ollama, sequentially (fast local round-trips)."""
    results: list[list[float]] = []
    for text in texts:
        emb = await embed_text(text, model=model)
        if emb is None:
            return None
        results.append(emb)
    return results
