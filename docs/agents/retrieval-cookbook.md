# Retrieval and embedding cookbook

Moved out of `AGENTS.md` on 2026-11-21. That file is loaded into every request
from every agent, so reference material needed only when touching the retrieval
subsystem belongs here instead. `AGENTS.md` keeps a pointer plus the two rules
that must never be violated: nothing leaves the machine, and Ollama must be
running.

Hybrid BM25 + vector search with local cross-encoder reranking. Nothing leaves
the machine — all models run in the local Ollama instance.

Endpoints:

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/retrieval/status` | Index status + model availability (`embedding_model_available` flag) |
| `POST` | `/api/retrieval/index` | (Re)index docs corpus: chunk → embed → store in SQLite + memory |
| `POST` | `/api/retrieval/search` | Hybrid search: BM25 + vector → RRF → rerank → top-k |

Python API (`packages/backend/app/core/ollama_client.py`):

| Function | Purpose |
|----------|---------|
| `embed_text(text, model=None, timeout=30)` | Embed one text via `/api/embed`; auto-warms, falls back to `embeddinggemma-2:270m` if primary fails |
| `embed_text_batch_concurrent(texts, model=None, timeout=30)` | Embed multiple texts concurrently (bounded concurrency = 4); results in input order, `None` per failed slot |
| `_embed_model_available(model, timeout=5)` | Check `/api/tags` to confirm a model is installed before calling |

Models (configured in `config/settings.json`, `config/ports.json`):

- Primary: `nomic-embed-text:v1.5` (768-dim, ~0.27 GB, always resident)
- Fallback: `embeddinggemma-2:270m` (768-dim MRL-truncatable, ~0.29 GB)
- Reranker: `BAAI/bge-reranker-v2-m3` (568 MB cross-encoder, loaded via HuggingFace transformers on first use; cached at `huggingface_cache/`)

Key behaviors:

- `embed_text()` resolves model priority: explicit arg → `config.embedding_model` → fallbacks. Warms up on first use (dummy call to load weights into GPU memory). Falls back through the model tuple if a call fails.
- `embed_text_batch_concurrent()` resolves the model once, warms it, then issues up to `_EMBED_BATCH_CONCURRENCY` (4) `/api/embed` requests at once.
- `vector_search()` in `services/retrieval_service.py` logs a warning if embedding returns no vector — search falls back to BM25-only, results are not silently degraded.
- `/api/retrieval/status` cross-checks that `EMBED_MODEL` is installed in Ollama via `/api/tags`; if missing, logs a warning and sets `embedding_model_available: false`.

Route registration: all three routers are registered in `main.py`. Register a new one there or its routes vanish silently. To check whether a route is registered, read `app.openapi()["paths"]`.

## Agent cookbook: using retrieval/embedding from agent code

### 1. Embed a single text (Python, in-process)

```python
from app.core.ollama_client import embed_text

emb = await embed_text("my query text", expected_dim=768)
if emb is None:
    # All models failed — handle gracefully
    emb = [0.0] * 768
```

`embed_text()` resolves the model (explicit arg → `config.embedding_model` → `embeddinggemma-2:270m` fallback), warms up on first use, and validates dimension. It never raises — returns `None` on total failure.

### 2. Embed many texts concurrently

```python
from app.core.ollama_client import embed_text_batch_concurrent

embs = await embed_text_batch_concurrent(["a", "b", "c"], expected_dim=768)
# embs[i] is None if text i failed; all successful embeddings are 768-dim
```

### 3. Search the docs corpus (HTTP, cross-process)

```python
import httpx

async def search_docs(query: str, limit: int = 5) -> list[dict]:
    async with httpx.AsyncClient() as client:
        r = await client.post(
            "http://127.0.0.1:8004/api/retrieval/search",
            json={"query": query, "limit": limit, "vault_only": False},
        )
        r.raise_for_status()
        return r.json()["results"]
```

Each result has `chunk_id`, `doc_path`, `doc_title`, `chunk_index`, `text`, `rerank_score` (0–1), and `matched_terms` (BM25 matches).

### 4. Check model availability before searching

```python
from app.core.ollama_client import _embed_model_available

if not await _embed_model_available("nomic-embed-text:v1.5"):
    # Vector search will degrade to BM25-only — warn the user
    ...
```

Or via HTTP: `GET /api/retrieval/status` returns `embedding_model_available: false` when the model is missing.

### 5. Reindex the docs corpus

```python
async with httpx.AsyncClient() as client:
    r = await client.post("http://127.0.0.1:8004/api/retrieval/index", json={"force_reindex": True})
    r.raise_for_status()
    info = r.json()  # {"chunks": 808, "docs": 211, ...}
```

### 6. Common pitfalls

- **Don't use `qllama/bge-reranker-v2-m3` with transformers** — that's an Ollama model ID. The reranker loads `BAAI/bge-reranker-v2-m3` from HuggingFace. If transformers isn't installed, reranking degrades gracefully (input order preserved, 0.0 scores).
- **Don't skip `expected_dim`** — `embeddinggemma-2:270m` produces 512-dim vectors, but the index stores 768-dim. Always pass `expected_dim=768` (or `EMBED_DIM` from `retrieval_service`) to catch mismatches early.
- **Embedding models are excluded from chat selectors** — `EXCLUDED_FROM_CHAT` in `integrations_config.py` filters out `embed`/`rerank` task models. Don't try to chat with `nomic-embed-text:v1.5`.
- **Ollama must be running** — the backend talks to `http://127.0.0.1:11434`. If it's down, embedding fails and search falls back to BM25-only.



Bridges in `tools/mcp/` (stdio/REST). Tool counts as-of 2026-10-10 and go stale; authoritative list is each server's `tools/list` (or `server.registerTool`/`TOOL_DEFS` in source). `unity-mcp-bridge` ships disabled (needs Unity running). `context-store.mjs` is a library, not a server. See `docs/knowledge-library/` for full setup.
