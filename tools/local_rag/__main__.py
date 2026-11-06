#!/usr/bin/env python3
"""
local-rag: Local-first hybrid RAG for markdown corpus
- Ollama embeddings (nomic-embed-text) via sqlite-vec
- Hybrid BM25 (FTS5) + vector search with Reciprocal Rank Fusion
- Incremental indexing with SHA256 content hashing
- Cross-encoder reranker (bge-reranker-v2-m3)
- MCP server for agent integration (MCP SDK v2)
- Machine-readable JSON output

Usage:
  python -m local_rag index --corpus docs/knowledge-library
  python -m local_rag search "Wan 2.2 GGUF" --top-k 5 --json
  python -m local_rag serve  # MCP stdio server
"""

from .cli import main

if __name__ == "__main__":
    main()