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
import operator
import re
import sqlite3
import time
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from pathlib import Path

from ..core.config import PROJECT_ROOT, config
from ..core.connection import DB_PATH
from ..core.ollama_client import embed_text, embed_text_batch_concurrent
from .doc_search_index import tokenize as bm25_tokenize

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

EMBED_MODEL = config.embedding_model  # nomic-embed-text:v1.5
RERANK_MODEL = "BAAI/bge-reranker-v2-m3"  # cross-encoder reranker (HuggingFace ID)
VECTOR_MODEL_ALT = "embeddinggemma-2:270m"  # alternative embedder

CHUNK_SIZE = 512  # tokens per chunk (respects embedding context)
CHUNK_OVERLAP = 64  # token overlap between chunks
RRF_K = 60  # RRF constant (standard; within 4 MRR points of optimal)
TOP_K_CANDIDATES = 50  # per-retriever depth before fusion/rerank (sweet spot: 50-100)
TOP_K_FINAL = 5  # final results after rerank (research: 3-5 is optimal for LLM context)
EMBED_DIM = 768  # nomic-embed-text / bge-reranker output dim

# Docs corpus roots shared with the retrieval API. Kept in the service layer
# so services never import from app.api (layering rule: api -> services, never
# the reverse). _scan_docs_for_indexing lives here for the same reason.
DOCS_ROOT = PROJECT_ROOT / "docs"
VAULT_ROOT = DOCS_ROOT / "knowledge-library"

# -- Cross-encoder tuning ----------------------------------------------------

#: Max sequence length for the reranker. bge-reranker-v2-m3 supports 8192
#: architecturally but is fine-tuned at 1024; longer inputs waste compute
#: without quality gain (per BAAI model card).
RERANK_MAX_LENGTH = 1024

#: Batch size for cross-encoder forward passes. 16 on CPU, 32 on CUDA.
#: Larger batches amortize the fixed ~2s overhead per call.
RERANK_BATCH_SIZE_CPU = 16
RERANK_BATCH_SIZE_CUDA = 32

#: Relative score threshold. Keep results where score >= top1_score * RERANK_SCORE_ALPHA.
#: Research: α ≈ 0.2-0.3 self-adjusts to per-query baselines and trims the long tail.
#: Set to 0.0 to disable (return all candidates up to limit).
RERANK_SCORE_ALPHA = 0.25

#: Result cache TTL in seconds. Repeated identical queries are common in chat;
#: caching skips both embedding and reranking entirely.
RERANK_CACHE_TTL_SEC = 300

#: MMR diversity lambda. 0.0 = pure relevance (rerank order), 1.0 = pure diversity.
#: Applied after cross-encoder rerank (per ADR 0016/0017: rerank first, then MMR).
MMR_LAMBDA = 0.7

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

#: Result cache: key -> (results, expiry_timestamp). Key is a hash of the
#: normalized query plus a hash of the candidate document contents.
_rerank_cache: dict[str, tuple[list[tuple[str, float]], float]] = {}


def _reranker_batch_size() -> int:
    """Batch size for cross-encoder forward passes.

    16 on CPU, 32 on CUDA. Larger batches amortize the fixed ~2s overhead
    per call without significantly increasing latency for small candidate
    sets.
    """
    return RERANK_BATCH_SIZE_CUDA if _reranker_device == "cuda" else RERANK_BATCH_SIZE_CPU


def _get_reranker() -> tuple[object, object] | None:
    """Lazy-load the cross-encoder reranker model + tokenizer.

    Returns (model, tokenizer) or None if transformers/torch are unavailable
    or the model cannot be loaded. Results are cached after first load.

    On first successful load, runs a warm-up inference to avoid cold-start
    latency spikes on the first real query.
    """
    global \
        _reranker_model, \
        _reranker_tokenizer, \
        _reranker_device, \
        _reranker_available, \
        _reranker_warmed_up

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
        model_kwargs: dict = {}
        if _reranker_device == "cuda":
            model_kwargs["dtype"] = torch.float16
        _reranker_model = AutoModelForSequenceClassification.from_pretrained(
            RERANK_MODEL,
            **model_kwargs,
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
            logger.warning("Reranker warm-up failed (non-fatal): %s", warm_exc)

        logger.info(
            "Reranker loaded: %s (device=%s, warmed_up=%s)",
            RERANK_MODEL,
            _reranker_device,
            _reranker_warmed_up,
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
        max_length=RERANK_MAX_LENGTH,
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


def _rerank_cross_encoder(query: str, candidates: list[tuple[str, str]]) -> list[tuple[str, float]]:
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

    # bge-reranker-v2-m3 fine-tuned at max_length=1024 (per BAAI model card).
    # Architectural max is 8192 but longer inputs waste compute without
    # quality gain. Use RERANK_MAX_LENGTH (1024) as the target.
    max_length = RERANK_MAX_LENGTH
    try:
        model_cfg = model.config
        configured = int(getattr(model_cfg, "max_position_embeddings", max_length))
        max_length = min(configured, RERANK_MAX_LENGTH)
    except Exception:
        pass

    batch_size = _reranker_batch_size()

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


def _parse_frontmatter_tags(text: str) -> list[str]:
    """Extract the ``tags:`` list from YAML frontmatter, if present."""
    if not text.startswith("---"):
        return []
    end = text.find("\n---", 3)
    if end == -1:
        return []
    for line in text[3:end].splitlines():
        if not line.strip().startswith("tags:"):
            continue
        v = line.split(":", 1)[1].strip()
        if v.startswith("["):
            v = v.strip("[]")
            return [x.strip().strip('"').strip("'") for x in v.split(",") if x.strip()]
        return [v.strip().strip('"').strip("'")]
    return []


def _doc_metadata(text: str, p: Path) -> tuple[str, str, list[str], bool]:
    """Return (body, title, tags, is_superseded) for one markdown file."""
    body = text
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            body = text[end + 4 :].lstrip("\n")
    m = re.search(r"^#\s+(.+)", body, re.MULTILINE)
    title = m.group(1).strip()[:80] if m else p.stem.replace("-", " ").replace("_", " ").title()
    is_superseded = "superseded" in text.lower() or "superseded" in body.lower()
    return body, title, _parse_frontmatter_tags(text), is_superseded


def _index_one_doc(p: Path) -> tuple[str, list[dict[str, Any]]] | None:
    """Read, parse, and chunk one markdown file. None on any failure."""
    try:
        rel = p.relative_to(DOCS_ROOT).as_posix()
        in_vault = (
            p.is_relative_to(VAULT_ROOT)
            if hasattr(p, "is_relative_to")
            else str(p).startswith(str(VAULT_ROOT))
        )
        text = p.read_text(encoding="utf-8", errors="ignore")
        body, title, tags, is_superseded = _doc_metadata(text, p)
    except Exception:
        return None

    entries: list[dict[str, Any]] = []
    for i, chunk_text in enumerate(_split_text_into_chunks(body)):
        entries.append(
            {
                "chunk_id": _chunk_id(rel, i),
                "doc_path": rel,
                "doc_title": title,
                "chunk_index": i,
                "text": chunk_text,
                "in_vault": in_vault,
                "tags": tags,
                "is_superseded": is_superseded,
            }
        )
    return rel, entries


def _scan_docs_for_indexing() -> list[dict[str, Any]]:
    """Scan docs corpus and return chunk-ready entries.

    Lives in the service layer (not ``app.api.retrieval``) so that
    :meth:`RetrievalIndex.compute_content_hash` can call it without importing
    from ``app.api``, which would invert the api -> services layering and
    create an import cycle.
    """
    entries: list[dict[str, Any]] = []
    if not DOCS_ROOT.exists():
        return entries

    seen: set[str] = set()
    for p in list(DOCS_ROOT.rglob("*.md")) + list(VAULT_ROOT.glob("*.md")):
        if ".obsidian" in p.parts or "node_modules" in p.parts:
            continue
        key = p.resolve().as_posix()
        if key in seen:
            continue
        seen.add(key)
        result = _index_one_doc(p)
        if result is not None:
            entries.extend(result[1])

    return entries


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
    #: Whether this chunk comes from a superseded document (downweighted in search)
    is_superseded: bool = False


class RetrievalIndex:
    """Hybrid BM25 + vector index over the docs corpus."""

    def __init__(self) -> None:
        self._chunks: dict[str, IndexedChunk] = {}
        self._postings: dict[str, list[tuple[str, int]]] = defaultdict(list)
        self._avg_len: float = 0.0
        self._embeddings: dict[str, list[float]] = {}  # id -> vector
        self._built_at: float = 0.0
        self._doc_count: int = 0
        #: Model used to generate the current embeddings (for smart selection)
        self._index_model: str | None = None
        #: Content hash of all chunk texts at index time (for change detection)
        self._content_hash: str | None = None
        #: Search result cache: (query_hash, model) -> results
        self._search_cache: dict[tuple[str, str], list[dict]] = {}
        #: Cache TTL in seconds
        self._cache_ttl: float = 300.0
        #: Last access time per cache key
        self._cache_access: dict[tuple[str, str], float] = {}

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
        is_superseded: bool = False,
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
            is_superseded=is_superseded,
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
        # Compute content hash for change detection
        self._content_hash = self.compute_content_hash()

    @staticmethod
    def compute_content_hash() -> str:
        """Compute a hash of all doc chunk contents for change detection.

        Re-scans the docs corpus and hashes all chunk texts. Returns a stable
        hex digest that changes when any doc is added, removed, or modified.
        """
        entries = _scan_docs_for_indexing()
        # Sort by chunk_id for deterministic ordering
        entries.sort(key=operator.itemgetter("chunk_id"))
        hasher = hashlib.sha256()
        for e in entries:
            hasher.update(e["chunk_id"].encode("utf-8"))
            hasher.update(b"\x00")
            hasher.update(e["text"].encode("utf-8"))
            hasher.update(b"\x00")
        return hasher.hexdigest()[:16]

    def needs_reindex(self, model: str) -> tuple[bool, str | None]:
        """Check if the index needs rebuilding for the given model.

        Returns (needs_reindex, reason) where reason is None if no reindex
        is needed, or a human-readable explanation otherwise.
        """
        if not self._chunks:
            return True, "index is empty"
        if self._index_model != model:
            return True, f"index built with {self._index_model}, requested {model}"
        if self._content_hash is None:
            return True, "no content hash recorded"
        # Recompute to detect changes
        current_hash = self.compute_content_hash()
        if current_hash != self._content_hash:
            return True, "docs have changed since last index"
        return False, None

    # -- BM25 search --------------------------------------------------------

    def bm25_search(
        self, query: str, limit: int = TOP_K_CANDIDATES
    ) -> list[tuple[str, float, set[str]]]:
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

    async def vector_search(
        self, query: str, limit: int = TOP_K_CANDIDATES, model: str = EMBED_MODEL
    ) -> list[tuple[str, float]]:
        """Return [(chunk_id, cosine_similarity)] ranked by vector similarity."""
        q_emb = await embed_text(query, model=model, expected_dim=EMBED_DIM)
        if not q_emb:
            logger.warning(
                "Vector search unavailable: embedding model %s returned no vector "
                "(or wrong dimension); falling back to BM25-only results",
                model,
            )
            return []

        # Cosine similarity against all indexed chunk embeddings
        q_norm = math.sqrt(sum(x * x for x in q_emb)) or 1.0
        scored: list[tuple[str, float]] = []
        for cid, emb in self._embeddings.items():
            if not emb:
                continue
            if len(emb) != EMBED_DIM:
                logger.warning(
                    "Stored embedding for %s has %d dims, expected %d; skipping",
                    cid,
                    len(emb),
                    EMBED_DIM,
                )
                continue
            d_norm = math.sqrt(sum(x * x for x in emb)) or 1.0
            dot = sum(a * b for a, b in zip(q_emb, emb, strict=True))
            sim = dot / (q_norm * d_norm)
            scored.append((cid, sim))

        scored.sort(key=lambda kv: -kv[1])
        return scored[:limit]

    # -- rerank -------------------------------------------------------------

    async def rerank(
        self,
        query: str,
        candidates: list[tuple[str, str]],
        *,
        score_threshold: float | None = None,
        use_cache: bool = True,
    ) -> list[tuple[str, float]]:
        """
        Rerank candidates using a local cross-encoder (transformers).

        A cross-encoder scores each (query, passage) pair jointly, emitting
        a single relevance logit per pair. This is fundamentally different
        from a dual-encoder (embedding + cosine), which encodes each side
        independently and cannot reorder the pool meaningfully.

        candidates: [(chunk_id, chunk_text)]
        score_threshold: relative threshold as fraction of top-1 score.
            Keep results where score >= top1_score * score_threshold.
            Defaults to RERANK_SCORE_ALPHA (0.25). Set to 0.0 to disable.
        use_cache: cache results by (query, candidate hash) for repeat queries.

        Returns: [(chunk_id, relevance_score)] sorted descending.
        Scores are normalized to [0, 1] via sigmoid.
        Falls back to input order (0.0 scores) if the reranker is
        unavailable, with a warning logged.
        """
        if not candidates:
            return []

        # Check cache first
        if use_cache:
            norm_query = " ".join(query.lower().split())
            doc_hash = hashlib.sha1(
                "||".join(f"{cid}|{text}" for cid, text in candidates).encode()
            ).hexdigest()[:16]
            cache_key = f"{hashlib.sha1(norm_query.encode()).hexdigest()[:16]}:{doc_hash}"
            entry = _rerank_cache.get(cache_key)
            if entry is not None:
                cached_results, expiry = entry
                if time.monotonic() <= expiry:
                    return cached_results
                del _rerank_cache[cache_key]

        try:
            scored = _rerank_cross_encoder(query, candidates)
            # Apply sigmoid normalization so scores are in [0, 1].
            # Ranking is invariant to sigmoid (monotonic), but normalized
            # scores are easier to interpret and combine with BM25/vector
            # signals in the hybrid pipeline.
            scored = [(cid, _sigmoid(s)) for cid, s in scored]

            # Apply relative score threshold: keep results where
            # score >= top1_score * RERANK_SCORE_ALPHA.
            # Research: α ≈ 0.2-0.3 self-adjusts to per-query baselines
            # and trims the long tail without absolute thresholds (which
            # don't compare across queries).
            threshold = RERANK_SCORE_ALPHA if score_threshold is None else score_threshold
            if threshold > 0.0 and scored:
                top1 = scored[0][1]
                cutoff = top1 * threshold
                scored = [(cid, s) for cid, s in scored if s >= cutoff]

            # Cache the results
            if use_cache:
                norm_query = " ".join(query.lower().split())
                doc_hash = hashlib.sha1(
                    "||".join(f"{cid}|{text}" for cid, text in candidates).encode()
                ).hexdigest()[:16]
                cache_key = f"{hashlib.sha1(norm_query.encode()).hexdigest()[:16]}:{doc_hash}"
                _rerank_cache[cache_key] = (
                    scored,
                    time.monotonic() + RERANK_CACHE_TTL_SEC,
                )

            return scored or [(cid, 0.0) for cid, _ in candidates]
        except Exception as exc:
            logger.warning("Reranker failed for query %r: %s; returning input order", query, exc)
            return [(cid, 0.0) for cid, _ in candidates]

    async def _mmr_rerank(
        self,
        query: str,
        ranked: list[tuple[str, float]],
        top_k: int = TOP_K_FINAL,
    ) -> list[tuple[str, float]]:
        """
        Maximal Marginal Relevance after cross-encoder rerank.

        Per ADR 0016/0017: rerank first (relevance), then MMR (diversity).
        MMR score = lambda * relevance - (1-lambda) * max_similarity_to_selected.
        Uses embedding cosine similarity for the diversity term.

        Returns the reranked list with diversity applied, truncated to top_k.
        """
        if not ranked or top_k <= 0 or MMR_LAMBDA >= 1.0:
            return ranked[:top_k]

        # Get embeddings for all candidate texts (look up from chunk IDs)
        candidate_texts = []
        for cid, _ in ranked:
            if cid in self._chunks:
                candidate_texts.append(self._chunks[cid].text)
            else:
                candidate_texts.append("")

        embeddings = await embed_text_batch_concurrent(
            candidate_texts, model=self._index_model or EMBED_MODEL
        )
        emb_map: dict[str, list[float] | None] = dict(zip(candidate_texts, embeddings, strict=True))

        def _cosine_sim(a: list[float] | None, b: list[float] | None) -> float:
            if not a or not b:
                return 0.0
            dot = sum(x * y for x, y in zip(a, b, strict=True))
            na = math.sqrt(sum(x * x for x in a)) or 1.0
            nb = math.sqrt(sum(x * x for x in b)) or 1.0
            return dot / (na * nb)

        selected: list[tuple[str, float]] = []
        remaining = list(ranked)

        # Always pick the top-ranked result first
        if remaining:
            selected.append(remaining.pop(0))

        while remaining and len(selected) < top_k:
            best_idx = -1
            best_score = -float("inf")

            for i, (cid, rel_score) in enumerate(remaining):
                cand_text = self._chunks[cid].text if cid in self._chunks else ""
                cand_emb = emb_map.get(cand_text)

                # Diversity: max similarity to already-selected items
                max_sim = 0.0
                for sel_cid, _ in selected:
                    sel_text = self._chunks[sel_cid].text if sel_cid in self._chunks else ""
                    sel_emb = emb_map.get(sel_text)
                    max_sim = max(max_sim, _cosine_sim(cand_emb, sel_emb))

                mmr_score = MMR_LAMBDA * rel_score - (1 - MMR_LAMBDA) * max_sim
                if mmr_score > best_score:
                    best_score = mmr_score
                    best_idx = i

            if best_idx >= 0:
                selected.append(remaining.pop(best_idx))

        return selected

    # -- hybrid search ------------------------------------------------------

    async def hybrid_search(
        self,
        query: str,
        *,
        limit: int = TOP_K_FINAL,
        vault_only: bool = False,
        model: str = EMBED_MODEL,
    ) -> list[dict]:
        """
        Full retrieval pipeline: BM25 + vector -> RRF -> rerank -> top-k.

        Returns list of dicts with chunk text, doc metadata, and scores.

        Results are cached per (query, model) pair with a 300s TTL to avoid
        re-running the full pipeline on repeated queries.
        """
        if not self._chunks:
            return []

        # Check cache first
        now = time.monotonic()
        cache_key = hashlib.sha256((query + "|" + model).encode("utf-8")).hexdigest()[:16]
        cached = self._search_cache.get(cache_key)
        if cached and now - cached[0] < self._cache_ttl:
            self._cache_access[cache_key] = now
            return cached[1]

        # Clean up expired cache entries
        expired = [k for k, v in self._cache_access.items() if now - v > self._cache_ttl]
        for k in expired:
            self._search_cache.pop(k, None)
            self._cache_access.pop(k, None)

        # 1. Parallel retrieval
        bm25_results = self.bm25_search(query, limit=TOP_K_CANDIDATES)
        vector_results = await self.vector_search(query, limit=TOP_K_CANDIDATES, model=model)

        # 2. RRF fusion
        fused: dict[str, float] = defaultdict(float)
        for rank, (cid, _score, _terms) in enumerate(bm25_results):
            fused[cid] += 1.0 / (RRF_K + rank + 1)
        for rank, (cid, _score) in enumerate(vector_results):
            fused[cid] += 1.0 / (RRF_K + rank + 1)

        # Apply superseded penalty: downweight chunks from superseded docs by 80%
        # (more aggressive than 50% because reranker tends to re-boost them)
        for cid in list(fused.keys()):
            if cid in self._chunks and self._chunks[cid].is_superseded:
                fused[cid] *= 0.2

        # Sort by fused score, take top candidates for rerank
        ranked_cids = sorted(fused, key=fused.get, reverse=True)[:TOP_K_CANDIDATES]

        # 3. Rerank
        candidate_texts = [
            (cid, self._chunks[cid].text) for cid in ranked_cids if cid in self._chunks
        ]
        reranked = await self.rerank(query, candidate_texts)

        # 4. MMR diversification after rerank (per ADR 0016/0017: rerank first,
        #    then MMR -- MMR diversifies the rerank-ordered pool rather than
        #    the importance-boosted RRF pool)
        if MMR_LAMBDA < 1.0 and len(reranked) > 1:
            reranked = await self._mmr_rerank(query, reranked, top_k=TOP_K_CANDIDATES)

        # 5. Build final results
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
            results.append(
                {
                    "chunk_id": cid,
                    "doc_path": chunk.doc_path,
                    "doc_title": chunk.doc_title,
                    "chunk_index": chunk.chunk_index,
                    "text": chunk.text,
                    "rerank_score": round(rerank_score, 4),
                    "matched_terms": [],  # populated below if BM25 hit
                }
            )

        # Add matched terms from BM25 for explainability
        bm25_term_map: dict[str, set[str]] = {cid: terms for cid, _s, terms in bm25_results}
        for r in results:
            r["matched_terms"] = sorted(bm25_term_map.get(r["chunk_id"], set()))

        # Cache results for future identical queries
        self._search_cache[cache_key] = (now, results)
        self._cache_access[cache_key] = now

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


def _split_text_into_chunks(
    text: str, max_tokens: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP
) -> list[str]:
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
                (
                    chunk.id,
                    chunk.doc_path,
                    chunk.doc_title,
                    chunk.chunk_index,
                    chunk.text,
                    emb_bytes,
                    now,
                ),
            )
        conn.commit()
    finally:
        conn.close()


async def load_persisted_embeddings() -> dict[str, list[float]]:
    """Load persisted embeddings from SQLite."""
    conn = sqlite3.connect(str(DB_PATH))
    try:
        rows = conn.execute("SELECT chunk_id, embedding FROM retrieval_chunks").fetchall()
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
