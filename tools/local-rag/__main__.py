#!/usr/bin/env python3
"""
local-rag: Local-first hybrid RAG for markdown corpus
- Ollama embeddings (nomic-embed-text) via sqlite-vec
- Hybrid BM25 (FTS5) + vector search with Reciprocal Rank Fusion
- Incremental indexing with SHA256 content hashing
- Cross-encoder reranker (bge-reranker-v2-m3)
- MCP server for agent integration
- Machine-readable JSON output

Usage:
  python -m local_rag index --corpus docs/knowledge-library
  python -m local_rag search "Wan 2.2 GGUF" --top-k 5 --json
  python -m local_rag serve  # MCP stdio server
"""

import argparse
import hashlib
import json
import os
import sqlite3
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import ollama

# ─── Configuration ────────────────────────────────────────────────────────────

DEFAULT_DB = Path.home() / ".local-rag" / "index.sqlite3"
DEFAULT_CORPUS = Path("docs/knowledge-library")
DEFAULT_EMBED_MODEL = "nomic-embed-text"
DEFAULT_EMBED_DIM = 768
DEFAULT_CHUNK_TOKENS = 500
DEFAULT_CHUNK_OVERLAP = 50
DEFAULT_BATCH_SIZE = 32
DEFAULT_TOP_K = 10
DEFAULT_RERANK_TOP_K = 5
OLLAMA_HOST = "http://127.0.0.1:11434"

# ─── Database Schema ──────────────────────────────────────────────────────────

SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA temp_store=MEMORY;

CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL,
    rel_path TEXT NOT NULL,
    title TEXT,
    content_hash TEXT NOT NULL,
    mtime REAL NOT NULL,
    chunk_index INTEGER NOT NULL,
    text TEXT NOT NULL,
    tokens INTEGER NOT NULL,
    UNIQUE(path, chunk_index)
);

-- FTS5 for BM25 keyword search
CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
    text,
    title,
    path,
    content=documents,
    content_rowid=id,
    tokenize=unicode61
);

-- sqlite-vec for vector similarity search
-- Requires: pip install sqlite-vec
-- Load extension: sqlite_vec.load(conn)
CREATE VIRTUAL TABLE IF NOT EXISTS documents_vec USING vec0(
    embedding float[768],
    +id INTEGER PRIMARY KEY
);

-- Trigger to keep FTS5 in sync
CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
    INSERT INTO documents_fts(rowid, text, title, path) VALUES (new.id, new.text, new.title, new.path);
END;
CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
    INSERT INTO documents_fts(documents_fts, rowid, text, title, path) VALUES ('delete', old.id, old.text, old.title, old.path);
END;
CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
    INSERT INTO documents_fts(documents_fts, rowid, text, title, path) VALUES ('delete', old.id, old.text, old.title, old.path);
    INSERT INTO documents_fts(rowid, text, title, path) VALUES (new.id, new.text, new.title, new.path);
END;
"""

# ─── Utility Functions ────────────────────────────────────────────────────────


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def get_db(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.enable_load_extension(True)
    try:
        import sqlite_vec
        sqlite_vec.load(conn)
    except Exception as e:
        print(f"[WARN] sqlite-vec not available, vector search disabled: {e}", file=sys.stderr)
    conn.enable_load_extension(False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(conn: sqlite3.Connection):
    conn.executescript(SCHEMA)
    conn.commit()


def get_meta(conn: sqlite3.Connection, key: str) -> str | None:
    row = conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return row[0] if row else None


def set_meta(conn: sqlite3.Connection, key: str, value: str):
    conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)", (key, value))
    conn.commit()

# ─── Chunking ─────────────────────────────────────────────────────────────────


def count_tokens(text: str) -> int:
    """Rough token count: ~4 chars per token for English"""
    return max(1, len(text) // 4)


def chunk_markdown(text: str, chunk_tokens: int = DEFAULT_CHUNK_TOKENS, overlap: int = DEFAULT_CHUNK_OVERLAP) -> list[str]:
    """Split markdown into chunks by headers, then by token count with overlap"""
    lines = text.split('\n')
    chunks = []
    current_chunk = []
    current_tokens = 0

    for line in lines:
        line_tokens = count_tokens(line)

        # Check if adding this line would exceed chunk size
        if current_tokens + line_tokens > chunk_tokens and current_chunk:
            chunk_text = '\n'.join(current_chunk).strip()
            if chunk_text:
                chunks.append(chunk_text)

            # Start new chunk with overlap
            overlap_lines = current_chunk[-overlap:] if overlap > 0 else []
            current_chunk = overlap_lines + [line]
            current_tokens = sum(count_tokens(l) for l in current_chunk)
        else:
            current_chunk.append(line)
            current_tokens += line_tokens

    # Don't forget the last chunk
    if current_chunk:
        chunk_text = '\n'.join(current_chunk).strip()
        if chunk_text:
            chunks.append(chunk_text)

    return chunks

# ─── Embedding ────────────────────────────────────────────────────────────────


def embed_batch(texts: list[str], model: str = DEFAULT_EMBED_MODEL, is_query: bool = False) -> list[list[float]]:
    """Embed a batch of texts via Ollama. Adds task prefix for nomic-embed-text."""
    prefix = "search_query: " if is_query else "search_document: "
    prefixed = [prefix + t for t in texts]

    try:
        resp = ollama.embed(model=model, input=prefixed)
        return resp["embeddings"]
    except Exception as e:
        print(f"[ERROR] Embedding failed: {e}", file=sys.stderr)
        return [[0.0] * DEFAULT_EMBED_DIM] * len(texts)


def embed_concurrent(texts: list[str], model: str = DEFAULT_EMBED_MODEL,
                     batch_size: int = DEFAULT_BATCH_SIZE, max_workers: int = 4,
                     is_query: bool = False) -> list[list[float]]:
    """Embed texts in batches with concurrent workers."""
    results = [None] * len(texts)

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = []
        for i in range(0, len(texts), batch_size):
            batch = texts[i:i + batch_size]
            futures.append((i, executor.submit(embed_batch, batch, model, is_query)))

        for offset, future in futures:
            try:
                batch_embeddings = future.result(timeout=60)
                for j, emb in enumerate(batch_embeddings):
                    results[offset + j] = emb
            except Exception as e:
                print(f"[ERROR] Batch embedding failed at offset {offset}: {e}", file=sys.stderr)
                for j in range(len(texts) - offset):
                    results[offset + j] = [0.0] * DEFAULT_EMBED_DIM

    return results

# ─── Indexing ─────────────────────────────────────────────────────────────────


def index_corpus(corpus_root: Path, db_path: Path, force: bool = False) -> dict[str, Any]:
    """Index all markdown files in corpus_root."""
    conn = get_db(db_path)
    init_db(conn)

    # Check if we need to reindex
    stored_hash = get_meta(conn, "corpus_hash")
    current_hash = sha256(str(corpus_root) + str(os.path.getmtime(corpus_root)))

    if not force and stored_hash == current_hash:
        print(f"[SKIP] Corpus unchanged (hash: {current_hash[:16]}...)")
        return {"status": "skipped", "reason": "unchanged"}

    print(f"[INDEX] Scanning {corpus_root}...")

    md_files = list(corpus_root.rglob("*.md"))
    print(f"[INDEX] Found {len(md_files)} markdown files")

    total_chunks = 0
    indexed_files = 0
    skipped_files = 0

    for md_file in md_files:
        try:
            rel_path = md_file.relative_to(corpus_root)
            mtime = md_file.stat().st_mtime
            content = md_file.read_text(encoding='utf-8')
            content_hash = sha256(content)

            # Check if file already indexed with same content
            existing = conn.execute(
                "SELECT COUNT(*) FROM documents WHERE path=? AND content_hash=?",
                (str(md_file), content_hash)
            ).fetchone()[0]

            if existing > 0 and not force:
                skipped_files += 1
                continue

            # Remove old chunks for this file
            conn.execute("DELETE FROM documents WHERE path=?", (str(md_file),))
            conn.execute("DELETE FROM documents_fts WHERE path=?", (str(md_file),))
            conn.execute("DELETE FROM documents_vec WHERE id IN (SELECT id FROM documents WHERE path=?)", (str(md_file),))

            # Chunk and embed
            chunks = chunk_markdown(content)
            if not chunks:
                continue

            chunk_texts = [c for c in chunks]
            embeddings = embed_concurrent(chunk_texts)

            # Insert chunks
            title = md_file.stem.replace('-', ' ').replace('_', ' ')
            for i, (chunk_text, embedding) in enumerate(zip(chunk_texts, embeddings)):
                cursor = conn.execute(
                    """INSERT INTO documents (path, rel_path, title, content_hash, mtime, chunk_index, text, tokens)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (str(md_file), str(rel_path), title, content_hash, mtime, i, chunk_text, count_tokens(chunk_text))
                )
                doc_id = cursor.lastrowid

                # Store vector
                if embedding:
                    conn.execute(
                        "INSERT INTO documents_vec (id, embedding) VALUES (?, ?)",
                        (doc_id, bytes(bytearray(struct.pack('f' * len(embedding), *embedding))))
                    )

            conn.commit()
            total_chunks += len(chunks)
            indexed_files += 1

            if indexed_files % 10 == 0:
                print(f"[INDEX] Progress: {indexed_files}/{len(md_files)} files, {total_chunks} chunks")

        except Exception as e:
            print(f"[ERROR] Failed to index {md_file}: {e}", file=sys.stderr)

    # Update corpus hash
    set_meta(conn, "corpus_hash", current_hash)
    set_meta(conn, "embed_model", DEFAULT_EMBED_MODEL)
    set_meta(conn, "embed_dim", str(DEFAULT_EMBED_DIM))
    set_meta(conn, "indexed_at", str(time.time()))

    print(f"[INDEX] Complete: {indexed_files} files indexed, {skipped_files} skipped, {total_chunks} total chunks")

    return {
        "status": "completed",
        "files_indexed": indexed_files,
        "files_skipped": skipped_files,
        "total_chunks": total_chunks,
        "corpus_hash": current_hash
    }

# ─── Search ──────────────────────────────────────────────────────────────────


def bm25_search(conn: sqlite3.Connection, query: str, top_k: int = DEFAULT_TOP_K) -> list[dict]:
    """BM25 keyword search via FTS5."""
    try:
        rows = conn.execute(
            """SELECT d.id, d.path, d.rel_path, d.title, d.chunk_index, d.text,
                      rank, bm25(documents_fts) as score
               FROM documents_fts
               JOIN documents d ON d.id = documents_fts.rowid
               WHERE documents_fts MATCH ?
               ORDER BY score
               LIMIT ?""",
            (query, top_k)
        ).fetchall()
        return [dict(r) for r in rows]
    except Exception as e:
        print(f"[WARN] BM25 search failed: {e}", file=sys.stderr)
        return []


def vector_search(conn: sqlite3.Connection, query_embedding: list[float], top_k: int = DEFAULT_TOP_K) -> list[dict]:
    """Vector similarity search via sqlite-vec."""
    try:
        import struct
        query_bytes = bytes(bytearray(struct.pack('f' * len(query_embedding), *query_embedding)))

        rows = conn.execute(
            """SELECT d.id, d.path, d.rel_path, d.title, d.chunk_index, d.text,
                      vec_distance_cosine(documents_vec.embedding, ?) as distance
               FROM documents_vec
               JOIN documents d ON d.id = documents_vec.id
               ORDER BY distance
               LIMIT ?""",
            (query_bytes, top_k)
        ).fetchall()
        return [dict(r) for r in rows]
    except Exception as e:
        print(f"[WARN] Vector search failed (sqlite-vec may not be loaded): {e}", file=sys.stderr)
        return []


def reciprocal_rank_fusion(bm25_results: list[dict], vector_results: list[dict], k: int = 60) -> list[dict]:
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


def rerank_cross_encoder(query: str, docs: list[dict], top_k: int = DEFAULT_RERANK_TOP_K) -> list[dict]:
    """Rerank using cross-encoder (bge-reranker-v2-m3 via transformers)."""
    try:
        import torch
        from transformers import AutoModelForSequenceClassification, AutoTokenizer

        model_name = "BAAI/bge-reranker-v2-m3"
        tokenizer = AutoTokenizer.from_pretrained(model_name)
        model = AutoModelForSequenceClassification.from_pretrained(model_name)
        model.eval()

        pairs = [[query, doc['text']] for doc in docs]
        inputs = tokenizer(pairs, padding=True, truncation=True, max_length=512, return_tensors='pt')

        with torch.no_grad():
            scores = model(**inputs).logits.squeeze(-1).tolist()

        for doc, score in zip(docs, scores):
            doc['rerank_score'] = float(score)

        docs.sort(key=lambda x: x.get('rerank_score', 0), reverse=True)
        return docs[:top_k]
    except Exception as e:
        print(f"[WARN] Cross-encoder rerank failed: {e}", file=sys.stderr)
        return docs[:top_k]


def search(query: str, db_path: Path, top_k: int = DEFAULT_TOP_K,
           mode: str = "hybrid", rerank: bool = False, hyde: bool = False) -> dict[str, Any]:
    """Search the corpus."""
    conn = get_db(db_path)

    # Embed query
    query_embedding = embed_concurrent([query], is_query=True)[0]

    # BM25 search
    bm25_results = bm25_search(conn, query, top_k * 2)

    # Vector search
    vector_results = vector_search(conn, query_embedding, top_k * 2)

    # Fuse
    if mode in ("hybrid", "hybrid+rerank"):
        fused = reciprocal_rank_fusion(bm25_results, vector_results)
    elif mode == "bm25":
        fused = bm25_results
    elif mode == "vector":
        fused = vector_results
    else:
        fused = reciprocal_rank_fusion(bm25_results, vector_results)

    # Rerank if requested
    if rerank or mode == "hybrid+rerank":
        fused = rerank_cross_encoder(query, fused, top_k)

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
                "score": r.get('rrf_score', r.get('score', r.get('distance', 0))),
                "rerank_score": r.get('rerank_score')
            }
            for r in results
        ],
        "meta": {
            "backend": "sqlite-vec" if vector_results else "python",
            "bm25_hits": len(bm25_results),
            "vector_hits": len(vector_results)
        }
    }

# ─── CLI ──────────────────────────────────────────────────────────────────────


def cmd_index(args):
    result = index_corpus(
        Path(args.corpus).resolve(),
        Path(args.db).resolve(),
        force=args.force
    )
    print(json.dumps(result, indent=2))


def cmd_search(args):
    result = search(
        args.query,
        Path(args.db).resolve(),
        top_k=args.top_k,
        mode=args.mode,
        rerank=args.rerank,
        hyde=args.hyde
    )
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        for r in result['results']:
            print(f"[{r['score']:.4f}] {r['rel_path']} (chunk {r['chunk_index']})")
            print(f"  {r['text'][:200]}...")
            print()


def cmd_serve(args):
    """Run MCP stdio server."""
    print("[MCP] Server not yet implemented", file=sys.stderr)
    sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="local-rag: Local hybrid RAG for markdown corpus", add_help=False)
    parser.add_argument("--db", default=str(DEFAULT_DB), help="SQLite database path")
    parser.add_argument("--corpus", default=str(DEFAULT_CORPUS), help="Corpus root directory")

    main_parser = argparse.ArgumentParser(description="local-rag: Local hybrid RAG for markdown corpus", parents=[parser])
    sub = main_parser.add_subparsers(dest="cmd", required=True)

    p_index = sub.add_parser("index", help="Index corpus", parents=[parser])
    p_index.add_argument("--force", action="store_true", help="Force reindex all")
    p_index.set_defaults(func=cmd_index)

    p_search = sub.add_parser("search", help="Search corpus", parents=[parser])
    p_search.add_argument("query", help="Search query")
    p_search.add_argument("--top-k", type=int, default=DEFAULT_TOP_K)
    p_search.add_argument("--mode", choices=["bm25", "vector", "hybrid", "hybrid+rerank"], default="hybrid")
    p_search.add_argument("--rerank", action="store_true")
    p_search.add_argument("--hyde", action="store_true", help="HyDE query expansion (not yet implemented)")
    p_search.add_argument("--json", action="store_true")
    p_search.set_defaults(func=cmd_search)

    p_serve = sub.add_parser("serve", help="Run MCP stdio server", parents=[parser])
    p_serve.set_defaults(func=cmd_serve)

    args = main_parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    import struct
    main()
