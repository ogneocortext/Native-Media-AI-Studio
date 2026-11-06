"""Indexing pipeline for local-rag."""

import hashlib
import sys
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

from .chunking import chunk_markdown, chunk_to_text
from .config import get_config
from .database import get_database, init_database
from .embedding import embed_chunks, ensure_model, pull_model, warm_model


def _log(message: str, json_output: bool = False):
    """Log to stderr if json_output, else stdout."""
    if json_output:
        print(message, file=sys.stderr)
    else:
        print(message)


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def compute_corpus_hash(corpus_root: Path) -> str:
    """Compute hash of corpus based on file list and mtimes."""
    md_files = sorted(corpus_root.rglob("*.md"))
    parts = []
    for f in md_files:
        try:
            stat = f.stat()
            rel = f.relative_to(corpus_root)
            parts.append(f"{rel}:{stat.st_mtime}:{stat.st_size}")
        except OSError:
            pass
    return sha256("|".join(parts))


def index_corpus(
    corpus_root: Path | None = None,
    db_path: Path | None = None,
    force: bool = False,
    progress_callback: Callable[[str, int, int], None] | None = None,
    config=None,
    json_output: bool = False
) -> dict[str, Any]:
    """
    Index all markdown files in corpus_root.
    
    Args:
        corpus_root: Root directory of markdown files
        db_path: Database path (overrides config)
        force: Force full reindex
        progress_callback: Called with (stage, current, total) for progress
        config: Optional config override
    
    Returns:
        Dict with indexing results
    """
    if config is None:
        config = get_config()

    if corpus_root is None:
        corpus_root = config.corpus.root
    corpus_root = corpus_root.resolve()

    if db_path is None:
        db_path = config.database.path
    db_path = Path(db_path).expanduser().resolve()

    # Initialize database
    init_database()
    db = get_database()

    # Check if we need to reindex
    stored_hash = db.get_meta("corpus_hash")
    current_hash = compute_corpus_hash(corpus_root)

    if not force and stored_hash == current_hash:
        if progress_callback:
            progress_callback("skipped", 0, 0)
        return {"status": "skipped", "reason": "unchanged", "corpus_hash": current_hash}

    # Ensure embedding model is available
    if not ensure_model(config=config):
        _log("[INDEX] Model not found, pulling...", json_output)
        if not pull_model(config=config):
            return {"status": "error", "reason": "model not available"}
    
    # Warm up model
    warm_model(config=config)

    _log(f"[INDEX] Scanning {corpus_root}...", json_output)

    # Find markdown files
    md_files = list(corpus_root.rglob("*.md"))
    _log(f"[INDEX] Found {len(md_files)} markdown files", json_output)

    if progress_callback:
        progress_callback("scanning", len(md_files), len(md_files))

    total_chunks = 0
    indexed_files = 0
    skipped_files = 0
    errors = []

    for idx, md_file in enumerate(md_files):
        try:
            rel_path = md_file.relative_to(corpus_root)
            mtime = md_file.stat().st_mtime
            content = md_file.read_text(encoding='utf-8')
            content_hash = sha256(content)

            # Check if file already indexed with same content
            existing = db.get_file_chunks(str(md_file))
            if existing and not force and existing[0].get('content_hash') == content_hash:
                skipped_files += 1
                if progress_callback:
                    progress_callback("indexing", idx + 1, len(md_files))
                continue

            # Remove old chunks for this file
            db.delete_file_chunks(str(md_file))

            # Chunk the document
            chunks = chunk_markdown(content, config.chunking)
            if not chunks:
                continue

            # Embed chunks
            def embed_progress(current, total, rel_path=rel_path):
                if progress_callback:
                    progress_callback(f"embedding {rel_path}", current, total)

            embeddings = embed_chunks(chunks, config=config, progress_callback=embed_progress)

            # Insert chunks
            title = md_file.stem.replace('-', ' ').replace('_', ' ')
            for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
                db.insert_chunk(
                    path=str(md_file),
                    rel_path=str(rel_path),
                    title=title,
                    content_hash=content_hash,
                    mtime=mtime,
                    chunk_index=i,
                    text=chunk_to_text(chunk),
                    tokens=chunk.tokens,
                    embedding=embedding
                )

            total_chunks += len(chunks)
            indexed_files += 1

            if progress_callback:
                progress_callback("indexing", idx + 1, len(md_files))

            if indexed_files % 10 == 0:
                _log(f"[INDEX] Progress: {indexed_files}/{len(md_files)} files, {total_chunks} chunks", json_output)

        except Exception as e:
            error_msg = f"Failed to index {md_file}: {e}"
            _log(f"[ERROR] {error_msg}", json_output)
            errors.append({"file": str(md_file), "error": str(e)})

    # Update corpus metadata
    db.set_meta("corpus_hash", current_hash)
    db.set_meta("embed_model", config.embedding.model)
    db.set_meta("embed_dim", str(config.embedding.dim))
    db.set_meta("indexed_at", str(time.time()))

    result = {
        "status": "completed" if not errors else "completed_with_errors",
        "files_indexed": indexed_files,
        "files_skipped": skipped_files,
        "total_chunks": total_chunks,
        "corpus_hash": current_hash,
        "errors": errors
    }

    _log(f"[INDEX] Complete: {indexed_files} files indexed, {skipped_files} skipped, {total_chunks} total chunks", json_output)
    if errors:
        _log(f"[INDEX] Errors: {len(errors)}", json_output)

    return result