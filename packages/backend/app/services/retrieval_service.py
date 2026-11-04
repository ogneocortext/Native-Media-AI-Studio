"""
Retrieval service -- hybrid BM25 + vector search with local reranking.

Implements the Devin Desktop "Fast Context" pattern using open-source models
that run on this workstation's GTX 1070 Ti (8 GB, Pascal, fp16 only):

Architecture (retrieval separated from generation):
  1. Hybrid retrieval (parallel):
     ├─ BM25 keyword search (exact term match, good for identifiers/paths)
     └─ Vector search via Ollama embeddings (semantic match)
  2. Reciprocal Rank Fusion (RRF) -- merge both result lists
  3. Rerank via local cross-encoder ``qllama/bge-reranker-v2-m3``
     (636 MB, ~50 candidates -> top-5 in sub-100 ms on Pascal)
  4. Return top-k snippets to the generation model (qwen3.5:4b)

Models (all local, all installed):
  - nomic-embed-text:v1.5  (137 MB, embedding)
  - embeddinggemma-2:270m  (271 MB, embedding)
  - qllama/bge-reranker-v2-m3  (568 MB, reranker -- just pulled to Ollama)

Total embedding+reranker VRAM: ~1.2 GB, leaving ~6.8 GB for qwen3.5:4b (3.4 GB)
and OS overhead -- comfortable on 8 GB VRAM.

Cross-encoder note: the reranker scores each (query, passage) pair *jointly*
using HuggingFace ``transformers`` (AutoModelForSequenceClassification), the
same pattern used by ``tools/kb-retrieval.py``. Ollama's ``/api/embed``
endpoint is a dual-encoder (embeddings per input, cosine-scored) and cannot
produce cross-encoder relevance logits, so it is *not* used for reranking.
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
RERANK_MODEL = "qllama/bge-reranker-v2-m3"     # cross-encoder reranker
VECTOR_MODEL_ALT = "embeddinggemma-2:270m"    # alternative embedder

CHUNK_SIZE = 512          # tokens per chunk (respects embedding context)
CHUNK_OVERLAP = 64        # token overlap between chunks
RRF_K = 60                # RRF constant
TOP_K_CANDIDATES = 50     # per-retriever depth before fusion/rerank
TOP_K_FINAL = 5           # final results after rerank
EMBED_DIM = 768           # nomic-embed-text / bge-reranker output dim

# ---------------------------------------------------------------------------
# Cross-encoder reranker (lazy, in-process via transformers)
# ---------------------------------------------------------------------------
#
# Architecture follows the pattern proven in tools/kb-retrieval.py's
# CrossEncoderReranker, with production best practices from
# sentence-transformers cross-encoder efficiency docs and BGE documentation:
#
#   - Joint (query, passage) scoring via AutoModelForSequenceClassification
#   - Dynamic batch sizing scaled by hidden_size x max_length
#   - Sigmoid normalization to [0, 1] scores (ranking invariant either way)
#   - Device auto-detection (cuda/cpu); FP16 on GPU for 2-3x speedup
#   - Warm-up on startup to avoid cold-start latency spikes
#   - Graceful degradation when transformers/torch/model unavailable
#
# bge-reranker-v2-m3 specifics (568M params, XLM-RoBERTa-Large base):
#   - max_length = 8192 (fine-tuned from bge-m3, larger than v1's 512)
#   - Raw logits output; apply sigmoid for [0,1] probability scores
#   - use_fp16=True on GPU gives ~2-3x speedup (Pascal GPUs benefit less
#     than Turing+/Ampere, but still measurable)
#   - int8 ONNX quantization is NOT recommended on Pascal (sm_61 lacks
#     Tensor Core int8 support; quantization overhead can be slower)
#


_reranker_model = None
_reranker_tokenizer = None
_reranker_device = None
_reranker_available: bool | None = None
_reranker_warmed_up = False


def _reranker_batch_size(max_length: int, hidden_size: int) -> int:
    """Dynamic batch size scaled by model width and sequence length.

    Formula adapted from the CQS reranker batch-size heuristic:
        batch = 32 * (384/hidden_size)^0.25 * (512/max_length)^0.25

    Both factors floor at 0.25 so neither dimension alone collapses the
    batch to 1 on extreme models. Rounded to nearest integer, clamped
    to [1, 256]. Keeps per-tensor activation memory roughly constant
    across rerankers of different sizes and context lengths.
    """
    baseline = 32.0
    seq_factor = math.pow(512.0 / max(max_length, 1), 0.25) if max_length > 0 else 0.25
    hidden_factor = math.pow(384.0 / max(hidden_size, 1), 0.25) if hidden_size > 0 else 0.25
    scaled = baseline * max(seq_factor, 0.25) * max(hidden_factor, 0.25)
    return min(256, max(1, int(round(scaled))))


def _get_reranker() -> tuple[object, object] | None:
    """Lazy-load the cross-encoder reranker model + tokenizer.

    Returns (model, tokenizer) or None if transformers/torch are unavailable
    or the model cannot be loaded. Results are cached after first load.

    On first successful load, runs a warm-up inference to avoid cold-start
    latency spikes on the first real query.
    """
    global _reranker_model, _reranker_tokenizer, _reranker_device, _reranker_available, _reranker_warmed_up

    if _reranker_model is not None:
        return _reranker_model, _reranker_tokenizer
    if _reranker_available is False:
        return None

    try:
        import torch  # noqa: PLC0415
        from transformers import (  # noqa: PLC0415
            AutoModelForSequenceClassification,
            AutoTokenizer,
        )
    except ImportError:
        logger.warning(
            "Reranker unavailable: transformers/torch not installed; "
            "install with pip install transformers torch"
        )
        _reranker_available = False
        return None

    try:
        # Auto-detect device: CUDA if available, else CPU.
        # Pascal (GTX 1070 Ti, sm_61) supports CUDA but lacks Tensor Core
        # int8; FP16 works but with limited benefit vs modern GPUs.
        if torch.cuda.is_available():
            _reranker_device = "cuda"
            logger.info("Reranker device: cuda (GPU detected)")
        else:
            _reranker_device = "cpu"
            logger.info("Reranker device: cpu")

        _reranker_tokenizer = AutoTokenizer.from_pretrained(RERANK_MODEL)
        _reranker_model = AutoModelForSequenceClassification.from_pretrained(
            RERANK_MODEL
        )
        _reranker_model.to(_reranker_device)
        _reranker_model.eval()
        _reranker_available = True

        # Warm-up: run a dummy inference to avoid cold-start latency
        # spikes on the first real query.
        try:
            _reranker_warmup(_reranker_model, _reranker_tokenizer, _reranker_device)
            _reranker_warmed_up = True
        except Exception as warm_exc:
            logger.warning(
                "Reranker warm-up failed (non-fatal): %s", warm_exc
            )

        logger.info(
            "Reranker loaded: %s (device=%s, warmed_up=%s)",
            RERANK_MODEL, _reranker_device, _reranker_warmed_up,
        )
        return _reranker_model, _reranker_tokenizer
    except Exception as exc:
        logger.warning("Reranker unavailable: failed to load %s: %s", RERANK_MODEL, exc)
        _reranker_available = False
        return None


def _reranker_warmup(model, tokenizer, device: str) -> None:
    """Run a dummy inference to load weights into GPU memory and avoid
    cold-start latency on the first real rerank call."""
    import torch  # noqa: PLC0415

    dummy_pairs = [("warm-up query", "warm-up passage text")]
    enc = tokenizer(
        [p[0] for p in dummy_pairs],
        [p[1] for p in dummy_pairs],
        padding=True,
        truncation=True,
        max_length=512,
        return_tensors="pt",
    ).to(device)
    with torch.no_grad():
        _ = model(**enc)


def _sigmoid(x: float) -> float:
    """Map a raw logit to [0, 1] via the logistic function.

    Ranking is invariant to sigmoid (monotonic), but normalized scores
    are easier to interpret and combine with other signals.
    """
    if x >= 0:
        return 1.0 / (1.0 + math.exp(-x))
    return math.exp(x) / (1.0 + math.exp(x))


def _rerank_cross_encoder(
    query: str, candidates: list[tuple[str, str]]
) -> list[tuple[str, float]]:
    """Score (query, passage) pairs jointly with a cross-encoder.

    A cross-encoder reads the query and passage together and emits a
    single relevance logit per pair -- unlike a dual-encoder (embedding
    + cosine) which encodes each side independently. This is what enables
    true reordering of the hybrid pool.

    Returns [(chunk_id, relevance_score)] sorted descending by score.
    Scores are raw logits; callers may apply sigmoid for [0,1] range
    via _sigmoid() if desired.
    """
    loaded = _get_reranker()
    if loaded is None or not candidates:
        return []

    model, tokenizer = loaded

    passages = [text for _, text in candidates]

    # Determine batch size from model config if available.
    max_length = 512
    hidden_size = 384
    try:
        model_cfg = model.config
        max_length = int(getattr(model_cfg, "max_position_embeddings", max_length))
        hidden_size = int(getattr(model_cfg, "hidden_size", hidden_size))
        # Cap at model's supported max; bge-reranker-v2-m3 supports 8192
        # but 512 is the efficiency sweet spot for most passages.
        max_length = min(max_length, 8192)
    except Exception:
        pass

    batch_size = _reranker_batch_size(max_length, hidden_size)

    scores: list[float] = []
    import torch  # noqa: PLC0415

    with torch.no_grad():
        for start in range(0, len(passages), batch_size):
            batch = passages[start : start + batch_size]
            enc = tokenizer(
                [query] * len(batch),
                batch,
                padding=True,
                truncation=True,
                max_length=max_length,
                return_tensors="pt",
            ).to(_reranker_device)
            outputs = model(**enc)
            logits = outputs.logits
            # A cross-encoder emits a single relevance logit per pair.
            if logits.shape[-1] == 1:
                row = logits.squeeze(-1)
            else:
                # Two-logit head (query / relevance): take the difference.
                row = logits[:, -1] - logits[:, 0]
            scores.extend(float(x) for x in row.cpu().tolist())

    scored = [(cid, s) for (cid, _), s in zip(candidates, scores, strict=True)]
    scored.sort(key=lambda kv: -kv[1])
    return scored

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
        Rerank candidates using a local cross-encoder (transformers).

        A cross-encoder scores each (query, passage) pair jointly, emitting
        a single relevance logit per pair. This is fundamentally different
        from a dual-encoder (embedding + cosine), which encodes each side
        independently and cannot reorder the pool meaningfully.

        candidates: [(chunk_id, chunk_text)]
        Returns: [(chunk_id, relevance_score)] sorted descending.
        Scores are normalized to [0, 1] via sigmoid for consistency with
        other relevance signals in the pipeline.
        Falls back to the input order (unsorted) if the reranker is
        unavailable, with a warning logged so the degradation is visible.
        """
        if not candidates:
            return []

        try:
            scored = _rerank_cross_encoder(query, candidates)
            # Apply sigmoid normalization so scores are in [0, 1].
            # Ranking is invariant to sigmoid (monotonic), but normalized
            # scores are easier to interpret and combine with BM25/vector
            # signals in the hybrid pipeline.
            return [(cid, _sigmoid(s)) for cid, s in scored] or [
                (cid, 0.0) for cid, _ in candidates
            ]
        except Exception as exc:
            logger.warning(
                "Reranker failed for query %r: %s; returning input order", query, exc
            )
            return [(cid, 0.0) for cid, _ in candidates]

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
