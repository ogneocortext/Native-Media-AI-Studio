"""
Retrieval service -- hybrid BM25 + vector search with local reranking.

Implements the Devin Desktop "Fast Context" pattern using open-source models
that run on this workstation's GTX 1070 Ti (8 GB, Pascal, fp16 only):

Architecture (retrieval separated from generation):
  1. Hybrid retrieval (parallel):
     ├─ BM25 keyword search (exact term match, good for identifiers/paths)
     └─ Vector search via Ollama embeddings (semantic match)
  2. Reciprocal Rank Fusion (RRF) -- merge both result lists
  3. Rerank via Ollama ``qllama/bge-reranker-v2-m3`` cross-encoder
     (636 MB, ~50 candidates -> top-5 in sub-100 ms on Pascal)
  4. Return top-k snippets to the generation model (qwen3.5:4b)

Models (all local, all installed):
  - nomic-embed-text:v1.5  (137 MB, embedding)
  - embeddinggemma-2:270m  (271 MB, embedding)
  - qllama/bge-reranker-v2-m3  (568 MB, reranker -- just pulled to Ollama)

Total embedding+reranker VRAM: ~1.2 GB, leaving ~6.8 GB for qwen3.5:4b (3.4 GB)
and OS overhead -- comfortable on 8 GB VRAM.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import sqlite3
import time
from collections import Counter, defaultdict
from dataclasses import dataclass, field

from ..core.config import config
from ..core.connection import DB_PATH
from ..core.ollama_client import embed_text
from .doc_search_index import tokenize as bm25_tokenize

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

EMBED_MODEL = config.embedding_model          # nomic-embed-text:v1.5
RERANK_MODEL = "qllama/bge-reranker-v2-m3"     # just pulled to Ollama
VECTOR_MODEL_ALT = "embeddinggemma-2:270m"    # alternative embedder

CHUNK_SIZE = 512          # tokens per chunk (respects embedding context)
CHUNK_OVERLAP = 64        # token overlap between chunks
RRF_K = 60                # RRF constant
TOP_K_CANDIDATES = 50     # per-retriever depth before fusion/rerank
TOP_K_FINAL = 5           # final results after rerank
EMBED_DIM = 768           # nomic-embed-text / bge-reranker output dim

# ---------------------------------------------------------------------------
# In-memory index (rebuilt on startup / reindex)
# ---------------------------------------------------------------------------


@dataclass
class IndexedChunk:
    """One indexed document chunk."""
    id: str
    doc_path: str
    doc_title: str
    chunk_index: int
    text: str
    tokens: list[str]
    embedding: list[float] | None = None
    #: Boosted fields (title/path/tags) for BM25 head-weighting
    head_terms: Counter = field(default_factory=Counter)
    all_terms: Counter = field(default_factory=Counter)
    length: int = 0


class RetrievalIndex:
    """Hybrid BM25 + vector index over the docs corpus."""

    def __init__(self) -> None:
        self._chunks: dict[str, IndexedChunk] = {}
        self._postings: dict[str, list[tuple[str, int]]] = defaultdict(list)
        self._avg_len: float = 0.0
        self._embeddings: dict[str, list[float]] = {}  # id -> vector
        self._built_at: float = 0.0
        self._doc_count: int = 0

    # -- indexing -----------------------------------------------------------

    def add_chunk(
        self,
        chunk_id: str,
        doc_path: str,
        doc_title: str,
        chunk_index: int,
        text: str,
        *,
        title_weight: int = 4,
        tag_weight: int = 3,
        path_weight: int = 2,
    ) -> None:
        """Add one chunk to the in-memory index."""
        text_terms = bm25_tokenize(text)
        head: Counter = Counter()
        for field_text, weight in (
            (doc_title, title_weight),
            (doc_path.replace("/", " ").replace("_", " ").replace("-", " "), path_weight),
        ):
            for t in bm25_tokenize(field_text):
                head[t] += weight

        all_terms = Counter(text_terms)
        all_terms.update(head)
        chunk = IndexedChunk(
            id=chunk_id,
            doc_path=doc_path,
            doc_title=doc_title,
            chunk_index=chunk_index,
            text=text,
            tokens=text_terms,
            head_terms=head,
            all_terms=all_terms,
            length=len(text_terms) + sum(head.values()),
        )
        self._chunks[chunk_id] = chunk
        for term, count in chunk.all_terms.items():
            self._postings[term].append((chunk_id, count))

    def finalize(self) -> None:
        """Compute average length after all chunks added."""
        if self._chunks:
            self._avg_len = sum(c.length for c in self._chunks.values()) / len(self._chunks)
        else:
            self._avg_len = 0.0
        self._doc_count = len(self._chunks)

    # -- BM25 search --------------------------------------------------------

    def bm25_search(self, query: str, limit: int = TOP_K_CANDIDATES) -> list[tuple[str, float, set[str]]]:
        """Return [(chunk_id, score, matched_terms)] ranked by BM25."""
        q_terms = bm25_tokenize(query)
        if not q_terms:
            return []
        n = max(1, self._doc_count)
        scores: dict[str, float] = defaultdict(float)
        matched: dict[str, set[str]] = defaultdict(set)

        for term in set(q_terms):
            postings = self._postings.get(term)
            if not postings:
                continue
            df = len(postings)
            idf = math.log(1.0 + (n - df + 0.5) / (df + 0.5))
            if idf <= 0:
                continue
            for cid, tf in postings:
                chunk = self._chunks[cid]
                denom = tf + _K1 * (1 - _B + _B * (chunk.length / (self._avg_len or 1.0)))
                scores[cid] += idf * (tf * (_K1 + 1)) / denom
                matched[cid].add(term)

        # Head-term boost
        for cid in scores:
            chunk = self._chunks[cid]
            if cid in matched:
                head_hits = sum(1 for t in matched[cid] if t in chunk.head_terms)
                scores[cid] *= 1.0 + 0.5 * head_hits

        ranked = sorted(scores.items(), key=lambda kv: -kv[1])
        return [(cid, score, matched[cid]) for cid, score in ranked[:limit]]

    # -- vector search ------------------------------------------------------

    async def vector_search(self, query: str, limit: int = TOP_K_CANDIDATES) -> list[tuple[str, float]]:
        """Return [(chunk_id, cosine_similarity)] ranked by vector similarity."""
        q_emb = await embed_text(query, model=EMBED_MODEL)
        if not q_emb:
            return []

        # Cosine similarity against all indexed chunk embeddings
        q_norm = math.sqrt(sum(x * x for x in q_emb)) or 1.0
        scored: list[tuple[str, float]] = []
        for cid, emb in self._embeddings.items():
            if not emb:
                continue
            d_norm = math.sqrt(sum(x * x for x in emb)) or 1.0
            dot = sum(a * b for a, b in zip(q_emb, emb, strict=True))
            sim = dot / (q_norm * d_norm)
            scored.append((cid, sim))

        scored.sort(key=lambda kv: -kv[1])
        return scored[:limit]

    # -- rerank -------------------------------------------------------------

    async def rerank(self, query: str, candidates: list[tuple[str, str]]) -> list[tuple[str, float]]:
        """
        Rerank candidates using Ollama's qllama/bge-reranker-v2-m3 cross-encoder.

        candidates: [(chunk_id, chunk_text)]
        Returns: [(chunk_id, relevance_score)] sorted descending.
        """
        if not candidates:
            return []

        # Ollama /api/embed returns one embedding per input. The reranker is a
        # cross-encoder: we embed (query, doc) pairs and score by cosine.
        inputs = [query] + [text for _, text in candidates]
        embs = await embed_text_batch(inputs, model=RERANK_MODEL)
        if not embs or len(embs) < len(inputs) + 1:
            return []

        q_emb = embs[0]
        q_norm = math.sqrt(sum(x * x for x in q_emb)) or 1.0

        scored: list[tuple[str, float]] = []
        for i, (cid, _text) in enumerate(candidates):
            d_emb = embs[i + 1]
            d_norm = math.sqrt(sum(x * x for x in d_emb)) or 1.0
            dot = sum(a * b for a, b in zip(q_emb, d_emb, strict=True))
            sim = dot / (q_norm * d_norm)
            scored.append((cid, sim))

        scored.sort(key=lambda kv: -kv[1])
        return scored

    # -- hybrid search ------------------------------------------------------

    async def hybrid_search(
        self,
        query: str,
        *,
        limit: int = TOP_K_FINAL,
        vault_only: bool = False,
    ) -> list[dict]:
        """
        Full retrieval pipeline: BM25 + vector -> RRF -> rerank -> top-k.

        Returns list of dicts with chunk text, doc metadata, and scores.
        """
        if not self._chunks:
            return []

        # 1. Parallel retrieval
        bm25_results = self.bm25_search(query, limit=TOP_K_CANDIDATES)
        vector_results = await self.vector_search(query, limit=TOP_K_CANDIDATES)

        # 2. RRF fusion
        fused: dict[str, float] = defaultdict(float)
        for rank, (cid, _score, _terms) in enumerate(bm25_results):
            fused[cid] += 1.0 / (RRF_K + rank + 1)
        for rank, (cid, _score) in enumerate(vector_results):
            fused[cid] += 1.0 / (RRF_K + rank + 1)

        # Sort by fused score, take top candidates for rerank
        ranked_cids = sorted(fused, key=fused.get, reverse=True)[:TOP_K_CANDIDATES]

        # 3. Rerank
        candidate_texts = [(cid, self._chunks[cid].text) for cid in ranked_cids if cid in self._chunks]
        reranked = await self.rerank(query, candidate_texts)

        # 4. Build final results
        results: list[dict] = []
        seen_docs: set[str] = set()
        for cid, rerank_score in reranked[:limit]:
            if cid not in self._chunks:
                continue
            chunk = self._chunks[cid]
            if vault_only and not _is_vault_path(chunk.doc_path):
                continue
            # Deduplicate by doc_path (one chunk per doc in final results)
            if chunk.doc_path in seen_docs:
                continue
            seen_docs.add(chunk.doc_path)
            results.append({
                "chunk_id": cid,
                "doc_path": chunk.doc_path,
                "doc_title": chunk.doc_title,
                "chunk_index": chunk.chunk_index,
                "text": chunk.text,
                "rerank_score": round(rerank_score, 4),
                "matched_terms": [],  # populated below if BM25 hit
            })

        # Add matched terms from BM25 for explainability
        bm25_term_map: dict[str, set[str]] = {cid: terms for cid, _s, terms in bm25_results}
        for r in results:
            r["matched_terms"] = sorted(bm25_term_map.get(r["chunk_id"], set()))

        return results


# ---------------------------------------------------------------------------
# BM25 constants (same as doc_search_index for consistency)
# ---------------------------------------------------------------------------

_K1 = 1.5
_B = 0.75


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _chunk_id(doc_path: str, chunk_index: int) -> str:
    """Stable chunk id from doc path + index."""
    return hashlib.sha1(f"{doc_path}#{chunk_index}".encode()).hexdigest()[:16]


def _is_vault_path(doc_path: str) -> bool:
    """Check if a doc path is inside the knowledge-library vault."""
    return "knowledge-library" in doc_path or "knowledge library" in doc_path.lower()


def _split_text_into_chunks(text: str, max_tokens: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """
    Split text into chunks of approximately max_tokens, with overlap.

    Simple whitespace-based tokenization (good enough for chunking;
    actual embedding tokenization happens in Ollama).
    """
    words = text.split()
    if len(words) <= max_tokens:
        return [text]

    chunks: list[str] = []
    start = 0
    while start < len(words):
        end = min(start + max_tokens, len(words))
        chunks.append(" ".join(words[start:end]))
        if end >= len(words):
            break
        start = end - overlap
        if start < 0:
            start = 0
    return chunks


async def embed_text_batch(texts: list[str], model: str) -> list[list[float]] | None:
    """Embed multiple texts via Ollama /api/embed, one at a time.

    Ollama's /api/embed accepts a single input string. Batch by calling
    sequentially (each is a fast local round-trip on this workstation).
    """
    results: list[list[float]] = []
    for text in texts:
        emb = await embed_text(text, model=model)
        if emb is None:
            return None
        results.append(emb)
    return results


# ---------------------------------------------------------------------------
# Persistence (SQLite)  # noqa: ERA001
# ---------------------------------------------------------------------------

async def persist_chunk_embeddings(chunks: list[IndexedChunk]) -> None:
    """Write chunk embeddings to SQLite for persistence across restarts."""
    conn = sqlite3.connect(str(DB_PATH))
    try:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS retrieval_chunks (
                chunk_id TEXT PRIMARY KEY,
                doc_path TEXT NOT NULL,
                doc_title TEXT NOT NULL,
                chunk_index INTEGER NOT NULL,
                text TEXT NOT NULL,
                embedding BLOB NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_retrieval_chunks_doc_path ON retrieval_chunks(doc_path);
        """)
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        for chunk in chunks:
            if chunk.embedding is None:
                continue
            emb_bytes = json.dumps(chunk.embedding).encode("utf-8")
            conn.execute(
                """
                INSERT OR REPLACE INTO retrieval_chunks
                (chunk_id, doc_path, doc_title, chunk_index, text, embedding, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (chunk.id, chunk.doc_path, chunk.doc_title, chunk.chunk_index,
                 chunk.text, emb_bytes, now),
            )
        conn.commit()
    finally:
        conn.close()


async def load_persisted_embeddings() -> dict[str, list[float]]:
    """Load persisted embeddings from SQLite."""
    conn = sqlite3.connect(str(DB_PATH))
    try:
        rows = conn.execute(
            "SELECT chunk_id, embedding FROM retrieval_chunks"
        ).fetchall()
        return {cid: json.loads(emb.decode("utf-8")) for cid, emb in rows}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Singleton index instance
# ---------------------------------------------------------------------------

_index: RetrievalIndex | None = None


def get_index() -> RetrievalIndex:
    """Get the singleton retrieval index (builds on first access)."""
    global _index
    if _index is None:
        _index = RetrievalIndex()
    return _index


def reset_index() -> None:
    """Reset the singleton (for reindex or tests)."""
    global _index
    _index = None
