"""Embedding generation with Ollama for local-rag."""

import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from functools import lru_cache
from typing import List, Optional, Callable

import ollama

from .config import get_config
from .chunking import Chunk


# ─── Embedding Cache ──────────────────────────────────────────────────────────

class EmbeddingCache:
    """Simple in-memory cache for embeddings."""

    def __init__(self, max_size: int = 10000):
        self._cache = {}
        self._max_size = max_size
        self._hits = 0
        self._misses = 0

    def _make_key(self, text: str, model: str, is_query: bool) -> str:
        prefix = "q:" if is_query else "d:"
        return f"{model}:{prefix}{hash(text)}"

    def get(self, text: str, model: str, is_query: bool) -> Optional[List[float]]:
        key = self._make_key(text, model, is_query)
        if key in self._cache:
            self._hits += 1
            return self._cache[key]
        self._misses += 1
        return None

    def set(self, text: str, model: str, is_query: bool, embedding: List[float]):
        if len(self._cache) >= self._max_size:
            # Simple eviction: clear half
            keys_to_remove = list(self._cache.keys())[:self._max_size // 2]
            for k in keys_to_remove:
                del self._cache[k]
        key = self._make_key(text, model, is_query)
        self._cache[key] = embedding

    def stats(self) -> dict:
        total = self._hits + self._misses
        return {
            "hits": self._hits,
            "misses": self._misses,
            "hit_rate": self._hits / total if total > 0 else 0,
            "size": len(self._cache)
        }

    def clear(self):
        self._cache.clear()
        self._hits = 0
        self._misses = 0


# Global cache
_embedding_cache = EmbeddingCache()


def get_embedding_cache() -> EmbeddingCache:
    return _embedding_cache


# ─── Embedding Functions ──────────────────────────────────────────────────────

def _get_embedding_config(config) -> "EmbeddingConfig":
    """Extract EmbeddingConfig from either Config or EmbeddingConfig."""
    from .config import Config, EmbeddingConfig
    if isinstance(config, Config):
        return config.embedding
    if isinstance(config, EmbeddingConfig):
        return config
    return get_config().embedding


def embed_batch(
    texts: List[str],
    model: Optional[str] = None,
    is_query: bool = False,
    config=None
) -> List[List[float]]:
    """Embed a batch of texts via Ollama with task prefix."""
    ec = _get_embedding_config(config)
    if model is None:
        model = ec.model

    prefix = "search_query: " if is_query else "search_document: "
    prefixed = [prefix + t for t in texts]

    try:
        client = ollama.Client(host=ec.ollama_host)
        resp = client.embed(model=model, input=prefixed)
        embeddings = resp["embeddings"]

        expected_dim = ec.dim
        for i, emb in enumerate(embeddings):
            if len(emb) != expected_dim:
                raise ValueError(f"Embedding {i} has wrong dimension: {len(emb)} != {expected_dim}")

        return embeddings
    except Exception as e:
        raise RuntimeError(f"Embedding failed for {model}: {e}") from e


def embed_with_cache(
    text: str,
    model: Optional[str] = None,
    is_query: bool = False,
    config=None
) -> List[float]:
    """Embed single text with caching."""
    ec = _get_embedding_config(config)
    if model is None:
        model = ec.model

    cache = get_embedding_cache()
    cached = cache.get(text, model, is_query)
    if cached is not None:
        return cached

    embedding = embed_batch([text], model, is_query, ec)[0]
    cache.set(text, model, is_query, embedding)
    return embedding


def embed_chunks(
    chunks: List[Chunk],
    model: Optional[str] = None,
    config=None,
    progress_callback: Optional[Callable[[int, int], None]] = None
) -> List[List[float]]:
    """Embed multiple chunks with batching and concurrency."""
    ec = _get_embedding_config(config)
    if model is None:
        model = ec.model

    texts = [chunk_to_text(c) for c in chunks]
    batch_size = ec.batch_size
    max_workers = ec.max_workers

    results = [None] * len(texts)
    total_batches = (len(texts) + batch_size - 1) // batch_size

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = []
        for batch_idx in range(0, len(texts), batch_size):
            batch = texts[batch_idx:batch_idx + batch_size]
            futures.append((
                batch_idx,
                executor.submit(embed_batch, batch, model, False, ec)
            ))

        for batch_idx, future in futures:
            try:
                batch_embeddings = future.result(timeout=ec.timeout)
                for j, emb in enumerate(batch_embeddings):
                    results[batch_idx + j] = emb
                if progress_callback:
                    progress_callback(batch_idx + len(batch_embeddings), len(texts))
            except Exception as e:
                raise RuntimeError(f"Batch embedding failed at offset {batch_idx}: {e}") from e

    return results


def chunk_to_text(chunk: Chunk, include_header: bool = True) -> str:
    """Convert chunk to text for embedding."""
    parts = []
    if include_header and chunk.header_path:
        parts.extend(chunk.header_path)
    parts.append(chunk.text)
    return '\n'.join(parts)


# ─── Model Management ─────────────────────────────────────────────────────────

def _get_embedding_config(config) -> "EmbeddingConfig":
    """Extract EmbeddingConfig from either Config or EmbeddingConfig."""
    from .config import Config, EmbeddingConfig
    if isinstance(config, Config):
        return config.embedding
    if isinstance(config, EmbeddingConfig):
        return config
    return get_config().embedding


def ensure_model(model: Optional[str] = None, config=None) -> bool:
    """Ensure embedding model is available in Ollama."""
    ec = _get_embedding_config(config)
    if model is None:
        model = ec.model

    try:
        client = ollama.Client(host=ec.ollama_host)
        models = client.list()
        model_names = [m["model"] for m in models.get("models", [])]
        return model in model_names
    except Exception:
        return False


def pull_model(model: Optional[str] = None, config=None) -> bool:
    """Pull embedding model from Ollama."""
    ec = _get_embedding_config(config)
    if model is None:
        model = ec.model

    try:
        client = ollama.Client(host=ec.ollama_host)
        client.pull(model)
        return True
    except Exception as e:
        print(f"[ERROR] Failed to pull model {model}: {e}", file=sys.stderr)
        return False


def warm_model(model: Optional[str] = None, config=None) -> bool:
    """Warm up embedding model with a dummy request."""
    ec = _get_embedding_config(config)
    if model is None:
        model = ec.model

    try:
        embed_batch(["warmup"], model, False, ec)
        return True
    except Exception:
        return False