"""Search operations: BM25, vector, RRF fusion, cross-encoder reranking."""

import sys
import threading
from typing import List, Dict, Any, Optional

from .config import get_config
from .database import get_database


# ─── Cross-Encoder Reranker (Lazy Singleton) ────────────────────────────────────

class CrossEncoderReranker:
    """Cross-encoder reranker with lazy model loading."""

    _instance = None
    _lock = threading.Lock()
    _model = None
    _tokenizer = None
    _config = None
    _load_attempted = False

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        pass  # Lazy loading - don't load model here

    def _ensure_loaded(self):
        """Load model on first use."""
        if self._load_attempted:
            return
        self._load_attempted = True

        config = get_config().rerank
        try:
            # Disable transformers logging and progress bars BEFORE importing
            import os
            os.environ.setdefault('TRANSFORMERS_VERBOSITY', 'error')
            os.environ.setdefault('TQDM_DISABLE', '1')
            os.environ.setdefault('HF_HUB_DISABLE_PROGRESS_BARS', '1')
            os.environ.setdefault('TOKENIZERS_PARALLELISM', 'false')

            from transformers import AutoTokenizer, AutoModelForSequenceClassification
            from transformers.utils import logging as hf_logging
            hf_logging.set_verbosity_error()
            hf_logging.disable_progress_bar()
            import torch

            print(f"[RERANK] Loading {config.model}...", file=sys.stderr)

            # Redirect stdout to suppress ALL output from transformers
            old_stdout = sys.stdout
            sys.stdout = __import__('io').StringIO()
            try:
                self._tokenizer = AutoTokenizer.from_pretrained(config.model)
                self._model = AutoModelForSequenceClassification.from_pretrained(config.model)
            finally:
                sys.stdout = old_stdout

            self._model.eval()
            self._config = config
            print(f"[RERANK] Loaded successfully", file=sys.stderr)
        except Exception as e:
            print(f"[WARN] Failed to load cross-encoder: {e}", file=sys.stderr)
            self._model = None
            self._tokenizer = None

    def rerank(self, query: str, docs: List[Dict], top_k: int) -> List[Dict]:
        """Rerank documents using cross-encoder."""
        self._ensure_loaded()
        if self._model is None or not docs:
            return docs[:top_k]

        try:
            import torch

            pairs = [[query, doc['text']] for doc in docs]
            inputs = self._tokenizer(
                pairs,
                padding=True,
                truncation=True,
                max_length=self._config.max_length,
                return_tensors='pt'
            )

            with torch.no_grad():
                scores = self._model(**inputs).logits.squeeze(-1).tolist()

            for doc, score in zip(docs, scores):
                doc['rerank_score'] = float(score)

            docs.sort(key=lambda x: x.get('rerank_score', 0), reverse=True)
            return docs[:top_k]

        except Exception as e:
            print(f"[WARN] Cross-encoder rerank failed: {e}", file=sys.stderr)
            return docs[:top_k]

    def is_available(self) -> bool:
        self._ensure_loaded()
        return self._model is not None


def get_reranker() -> CrossEncoderReranker:
    """Get global reranker instance."""
    return CrossEncoderReranker()


# ─── Search Functions ─────────────────────────────────────────────────────────

def reciprocal_rank_fusion(
    bm25_results: List[Dict],
    vector_results: List[Dict],
    k: int = 60
) -> List[Dict]:
    """Fuse BM25 and vector results using Reciprocal Rank Fusion."""
    scores = {}

    for rank, doc in enumerate(bm25_results):
        doc_id = doc['id']
        scores.setdefault(doc_id, {'doc': doc, 'score': 0.0})
        scores[doc_id]['score'] += 1.0 / (k + rank + 1)

    for rank, doc in enumerate(vector_results):
        doc_id = doc['id']
        scores.setdefault(doc_id, {'doc': doc, 'score': 0.0})
        scores[doc_id]['score'] += 1.0 / (k + rank + 1)

    # Sort by fused score
    fused = sorted(scores.values(), key=lambda x: x['score'], reverse=True)
    for item in fused:
        item['doc']['rrf_score'] = item['score']

    return [item['doc'] for item in fused]


def search(
    query: str,
    top_k: Optional[int] = None,
    mode: str = "hybrid",
    rerank: bool = False,
    config=None
) -> Dict[str, Any]:
    """
    Search the corpus.

    Args:
        query: Search query text
        top_k: Number of results (defaults to config)
        mode: "bm25", "vector", "hybrid", "hybrid+rerank"
        rerank: Enable cross-encoder reranking
        config: Optional config override
    """
    if config is None:
        config = get_config()

    if top_k is None:
        top_k = config.search.default_top_k

    db = get_database()

    # Embed query
    from .embedding import embed_with_cache
    query_embedding = embed_with_cache(query, is_query=True)

    # BM25 search
    bm25_k = top_k * 2 if mode in ("hybrid", "hybrid+rerank") else top_k
    bm25_results = db.bm25_search(query, bm25_k)

    # Vector search
    vector_k = top_k * 2 if mode in ("hybrid", "hybrid+rerank") else top_k
    vector_results = db.vector_search(query_embedding, vector_k)

    # Fuse results
    if mode in ("hybrid", "hybrid+rerank"):
        fused = reciprocal_rank_fusion(bm25_results, vector_results, config.search.rrf_k)
    elif mode == "bm25":
        fused = bm25_results
    elif mode == "vector":
        fused = vector_results
    else:
        fused = reciprocal_rank_fusion(bm25_results, vector_results, config.search.rrf_k)

    # Rerank if requested
    effective_rerank = rerank or mode == "hybrid+rerank"
    if effective_rerank:
        reranker = get_reranker()
        fused = reranker.rerank(query, fused, config.search.rerank_top_k)

    # Limit to top_k
    results = fused[:top_k]

    return {
        "ok": True,
        "query": query,
        "mode": mode,
        "hit_count": len(results),
        "results": [
            {
                "id": r['id'],
                "path": r['path'],
                "rel_path": r['rel_path'],
                "title": r['title'],
                "chunk_index": r['chunk_index'],
                "text": r['text'][:500] + ("..." if len(r['text']) > 500 else ""),
                "score": r.get('rrf_score', r.get('score', r.get('distance', 0.0))),
                "rerank_score": r.get('rerank_score')
            }
            for r in results
        ],
        "meta": {
            "backend": "sqlite-vec" if vector_results else "python",
            "bm25_hits": len(bm25_results),
            "vector_hits": len(vector_results),
            "reranked": effective_rerank
        }
    }


def get_status() -> Dict[str, Any]:
    """Get index status and statistics."""
    db = get_database()
    config = get_config()

    total = db.count_documents()
    fts_total = db.count_fts()
    embed_model = db.get_meta("embed_model")
    indexed_at = db.get_meta("indexed_at")

    return {
        "total_chunks": total,
        "fts_chunks": fts_total,
        "embed_model": embed_model or config.embedding.model,
        "embed_dim": config.embedding.dim,
        "indexed_at": indexed_at,
        "db_path": str(config.database.path),
        "reranker_available": get_reranker().is_available()
    }