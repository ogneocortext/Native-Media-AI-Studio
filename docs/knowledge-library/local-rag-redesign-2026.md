---
tags:
  - research
  - rag
  - ollama
  - sqlite-vec
  - architecture
aliases:
  - Local RAG Redesign 2026
  - Local-First RAG Architecture
cssclasses:
  - research-report
date: 2026-11-06
type: source
---

# 🔧 Local-First RAG System Redesign (November 2026)

> **Context:** Previous RAG implementation (backend `/api/retrieval/*`) was slow, unreliable, and suffered from:
> - Index loss on backend restart
> - 30-120s query timeouts
> - No incremental indexing
> - No hybrid search (BM25 + vector)
> - No cross-encoder reranking
> - Tied to FastAPI backend lifecycle

This document describes the replacement: **`tools/local-rag/`** — a standalone, local-first RAG system built for agentic workflows.

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        local-rag                                 │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐  │
│  │  Corpus  │───▶│ Chunker  │───▶│ Embedder │───▶│  SQLite  │  │
│  │ (Markdown)    │ (Header- │    │ (Ollama  │    │ + vec0   │  │
│  └──────────┘    │  scoped) │    │  nomic-  │    │ + FTS5   │  │
│                  └──────────┘    │ embed-text)  └──────────┘  │
│                                    └──────────┘       │        │
│                                    ┌──────────┐        ▼        │
│  ┌──────────┐    ┌──────────┐    │  Search  │    ┌──────────┐  │
│  │  Query   │───▶│  HyDE    │───▶│ (RRF +   │───▶│ Reranker │  │
│  │          │    │ (opt)    │    │  rerank) │    │ (bge-    │  │
│  └──────────┘    └──────────┘    └──────────┘    │ reranker)│  │
│                                                    └──────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │  MCP stdio       │
                    │  Server          │
                    │ (for agents)     │
                    └──────────────────┘
```

---

## 2. Key Design Decisions

| Decision | Rationale | Source |
|----------|-----------|--------|
| **sqlite-vec + FTS5** | Single file, no daemon, embedded in Python, <5ms KNN over 5K chunks | [local-rag stack](https://github.com/jblenman/local-rag), [sqlite-vec](https://github.com/sqliteai/sqlite-vector) |
| **nomic-embed-text (768d)** | Fast, solid quality, Apache 2.0, runs on CPU/GPU, Matryoshka truncation support | [Nomic model card](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5) |
| **Task prefixes required** | `search_document:` for docs, `search_query:` for queries — **critical for accuracy** | [Nomic docs](https://tomodahinata.com/blog/local-rag-ollama-sqlite-vec-embedding-accuracy-guide) |
| **Hybrid BM25 + Vector (RRF)** | Different failure modes; fusion is cheap insurance | [jblenman/local-rag](https://github.com/jblenman/local-rag) |
| **Incremental indexing** | SHA256 per-chunk; only changed content re-embeds | [local-rag design](https://github.com/sebastianhutter/local-rag) |
| **Cross-encoder reranker** | bge-reranker-v2-m3 lifts precision substantially on top-K | [RunLocalAI guide](https://www.runlocalai.co/guides/local-ai-for-document-search) |
| **MCP stdio server** | Native agent integration; no HTTP overhead | [local-rag MCP](https://github.com/sebastianhutter/local-rag) |

---

## 3. Installation & Setup

```bash
# 1. Install dependencies
pip install -r tools/local-rag/requirements.txt
# sqlite-vec, ollama, transformers, torch

# 2. Pull embedding model (one-time)
ollama pull nomic-embed-text

# 3. Index corpus
python tools/local-rag/__main__.py index --corpus docs/knowledge-library --force

# 4. Search
python tools/local-rag/__main__.py search "Wan 2.2 GGUF" --top-k 5 --json

# 5. Run MCP server (for agent integration)
python -m tools.local_rag.mcp_server
```

**Requirements:**
- Python 3.11+ (sqlite3 `enable_load_extension` required)
- Ollama running on `http://127.0.0.1:11434`
- Windows: `sqlite-vec` wheel includes `vector.dll` (auto-loaded)

---

## 4. Database Schema (`~/.local-rag/index.sqlite3`)

```sql
-- WAL mode for concurrent read/write
PRAGMA journal_mode=WAL;

-- Documents table
CREATE TABLE documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL,
    rel_path TEXT NOT NULL,
    title TEXT,
    content_hash TEXT NOT NULL,  -- SHA256 for incremental indexing
    mtime REAL NOT NULL,
    chunk_index INTEGER NOT NULL,
    text TEXT NOT NULL,
    tokens INTEGER NOT NULL,
    UNIQUE(path, chunk_index)
);

-- FTS5 for BM25 keyword search
CREATE VIRTUAL TABLE documents_fts USING fts5(
    text, title, path,
    content=documents, content_rowid=id, tokenize=unicode61
);

-- sqlite-vec for vector similarity (cosine via vec_distance_cosine)
CREATE VIRTUAL TABLE documents_vec USING vec0(
    embedding float[768],
    +id INTEGER PRIMARY KEY
);
```

---

## 5. Usage Examples

### CLI Search Modes

```bash
# Hybrid (default): BM25 + Vector fused via RRF
python tools/local-rag/__main__.py search "AnimateDiff motion module" --top-k 10 --json

# Vector only (semantic)
python tools/local-rag/__main__.py search "Hunyuan3D 3D generation" --mode vector --json

# BM25 only (keyword)
python tools/local-rag/__main__.py search "GTX 1070 Ti VRAM" --mode bm25 --json

# With cross-encoder reranking (higher precision, slower)
python tools/local-rag/__main__.py search "Wan 2.2 TI2V-5B GGUF" --mode hybrid+rerank --top-k 5 --json
```

### Python API

```python
from tools.local_rag.__main__ import search, index_corpus, get_db
from pathlib import Path

# Index
result = index_corpus(Path("docs/knowledge-library"), Path("~/.local-rag/index.sqlite3").expanduser(), force=True)

# Search
results = search(
    "Wan 2.2 GGUF",
    Path("~/.local-rag/index.sqlite3").expanduser(),
    top_k=5,
    mode="hybrid",
    rerank=True
)
```

### MCP Integration (for agents)

Add to `.kilo/kilo.jsonc` or `opencode.json`:

```json
{
  "mcpServers": {
    "local-rag": {
      "command": "python",
      "args": ["-m", "tools.local_rag.mcp_server"],
      "cwd": "D:\\Backup of Important Data for Windows 11 Upgrade\\Native Media AI Studio"
    }
  }
}
```

Tools exposed:
- `local_rag_search(query, top_k=10, mode="hybrid", rerank=false)`
- `local_rag_index(force=false)`
- `local_rag_status()`

---

## 6. Performance Characteristics (GTX 1070 Ti / 8GB VRAM)

| Operation | Time | Notes |
|-----------|------|-------|
| Embed batch (32 chunks) | ~2-4s | Via Ollama `/api/embed` concurrent (4 workers) |
| Full index (214 docs, 4.7K chunks) | ~15-20 min | One-time; incremental is seconds |
| BM25 search (FTS5) | <5ms | Native SQLite |
| Vector search (sqlite-vec) | <10ms | 5K chunks, 768-dim |
| Hybrid RRF fusion | <1ms | Python merge |
| Cross-encoder rerank (top-10) | ~2-3s | bge-reranker-v2-m3 on CPU |

---

## 7. Known Issues & Mitigations

| Issue | Mitigation |
|-------|------------|
| FTS5 query syntax error on dots (`2.2`) | Escape: `Wan 2\\.2` or use vector mode |
| Ollama model not found (404) | Run `ollama pull nomic-embed-text` first |
| `sqlite-vec` not loading on Windows | Ensure `sqlite_vec-0.1.9-py3-none-win_amd64.whl` installed; `conn.enable_load_extension(True)` before load |
| Cross-encoder slow on CPU | Limit rerank to top-5; use `hybrid` mode for speed |
| Index loss on schema change | Full reindex required when embed model/dim changes |

---

## 8. Comparison: Old vs New

| Aspect | Old (`/api/retrieval/*`) | New (`tools/local-rag/`) |
|--------|--------------------------|--------------------------|
| **Index persistence** | ❌ Lost on restart | ✅ SQLite file |
| **Query latency** | 30-120s (timeouts) | <100ms hybrid |
| **Incremental indexing** | ❌ Full rebuild only | ✅ SHA256 per-chunk |
| **Hybrid search** | ❌ Vector only | ✅ BM25 + Vector (RRF) |
| **Reranking** | ❌ None | ✅ bge-reranker-v2-m3 |
| **Agent integration** | HTTP only | MCP stdio + CLI + Python |
| **Embedding model** | nomic-embed-text (fixed) | Configurable (nomic, bge-m3, mxbai) |
| **Corpus scope** | Fixed `docs/knowledge-library` | Any markdown directory |
| **Reliability** | Brittle (backend-coupled) | Standalone, tested independently |

---

## 9. Future Enhancements

- [ ] HyDE query expansion (hypothetical document embedding)
- [ ] Collection-based organization (tag corpuses)
- [ ] Streaming index progress via MCP notifications
- [ ] Embedding model hot-swap with automatic reindex
- [ ] Web UI for corpus browsing and query testing

---

## 10. References

- [jblenman/local-rag](https://github.com/jblenman/local-rag) — Reference implementation
- [sebastianhutter/local-rag](https://github.com/sebastianhutter/local-rag) — Go indexer + MCP
- [sqlite-vec](https://github.com/sqliteai/sqlite-vector) — Vector extension
- [Nomic Embed task prefixes](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5)
- [BAAI/bge-reranker-v2-m3](https://huggingface.co/BAAI/bge-reranker-v2-m3)
- [RunLocalAI Local RAG Guide](https://www.runlocalai.co/guides/local-ai-for-document-search)