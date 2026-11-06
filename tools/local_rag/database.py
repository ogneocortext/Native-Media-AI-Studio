"""Database layer for local-rag with connection pooling and schema management."""

import sqlite3
import struct
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from .config import get_config

# ─── Schema ───────────────────────────────────────────────────────────────────

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
CREATE VIRTUAL TABLE IF NOT EXISTS documents_vec USING vec0(
    embedding float[{dim}],
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

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_documents_path ON documents(path);
CREATE INDEX IF NOT EXISTS idx_documents_hash ON documents(content_hash);
"""


# ─── Connection Pool ──────────────────────────────────────────────────────────

class ConnectionPool:
    """Thread-local connection pool for SQLite."""

    def __init__(self, db_path: Path, max_connections: int = 4):
        self.db_path = db_path
        self.max_connections = max_connections
        self._local = threading.local()
        self._lock = threading.Lock()

    def _create_connection(self) -> sqlite3.Connection:
        """Create a new database connection with extensions loaded."""
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.db_path)
        conn.enable_load_extension(True)
        try:
            import sqlite_vec
            sqlite_vec.load(conn)
        except Exception as e:
            print(f"[WARN] sqlite-vec not available, vector search disabled: {e}")
        conn.enable_load_extension(False)
        conn.row_factory = sqlite3.Row
        return conn

    @contextmanager
    def get(self) -> Iterator[sqlite3.Connection]:
        """Get a connection from the pool."""
        if not hasattr(self._local, "conn") or self._local.conn is None:
            self._local.conn = self._create_connection()
        try:
            yield self._local.conn
        except Exception:
            # On error, reset connection for next use
            if hasattr(self._local, "conn"):
                try:
                    self._local.conn.rollback()
                except Exception:
                    pass
                self._local.conn = None
            raise

    def close_all(self):
        """Close all connections in this thread."""
        if hasattr(self._local, "conn") and self._local.conn:
            try:
                self._local.conn.close()
            except Exception:
                pass
            self._local.conn = None


# ─── Database Manager ─────────────────────────────────────────────────────────

class Database:
    """High-level database operations."""

    def __init__(self, pool: ConnectionPool):
        self.pool = pool
        self.config = get_config()

    def init_schema(self):
        """Initialize database schema."""
        with self.pool.get() as conn:
            schema = SCHEMA.format(dim=self.config.embedding.dim)
            conn.executescript(schema)
            conn.commit()

    # ─── Meta Operations ──────────────────────────────────────────────────────

    def get_meta(self, key: str) -> str | None:
        with self.pool.get() as conn:
            row = conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
            return row[0] if row else None

    def set_meta(self, key: str, value: str):
        with self.pool.get() as conn:
            conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)", (key, value))
            conn.commit()

    # ─── Document Operations ──────────────────────────────────────────────────

    def delete_file_chunks(self, file_path: str):
        """Delete all chunks for a file."""
        with self.pool.get() as conn:
            conn.execute("DELETE FROM documents WHERE path=?", (file_path,))
            conn.execute("DELETE FROM documents_fts WHERE path=?", (file_path,))
            conn.execute(
                "DELETE FROM documents_vec WHERE id IN (SELECT id FROM documents WHERE path=?)",
                (file_path,)
            )
            conn.commit()

    def insert_chunk(
        self,
        path: str,
        rel_path: str,
        title: str,
        content_hash: str,
        mtime: float,
        chunk_index: int,
        text: str,
        tokens: int,
        embedding: list[float] | None = None
    ) -> int:
        """Insert a document chunk and optionally its embedding."""
        with self.pool.get() as conn:
            cursor = conn.execute(
                """INSERT INTO documents (path, rel_path, title, content_hash, mtime, chunk_index, text, tokens)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (path, rel_path, title, content_hash, mtime, chunk_index, text, tokens)
            )
            doc_id = cursor.lastrowid

            if embedding:
                # Validate embedding dimension
                if len(embedding) != self.config.embedding.dim:
                    raise ValueError(f"Embedding dimension mismatch: expected {self.config.embedding.dim}, got {len(embedding)}")
                embedding_bytes = bytes(bytearray(struct.pack('f' * len(embedding), *embedding)))
                conn.execute(
                    "INSERT INTO documents_vec (id, embedding) VALUES (?, ?)",
                    (doc_id, embedding_bytes)
                )

            conn.commit()
            return doc_id

    def get_file_chunks(self, file_path: str) -> list[dict]:
        """Get all chunks for a file."""
        with self.pool.get() as conn:
            rows = conn.execute(
                "SELECT * FROM documents WHERE path=? ORDER BY chunk_index",
                (file_path,)
            ).fetchall()
            return [dict(r) for r in rows]

    def count_documents(self) -> int:
        """Get total document count."""
        with self.pool.get() as conn:
            return conn.execute("SELECT COUNT(*) FROM documents").fetchone()[0]

    def count_fts(self) -> int:
        """Get FTS document count."""
        with self.pool.get() as conn:
            return conn.execute("SELECT COUNT(*) FROM documents_fts").fetchone()[0]

    # ─── Search Operations ────────────────────────────────────────────────────

    def bm25_search(self, query: str, top_k: int) -> list[dict]:
        """BM25 keyword search via FTS5."""
        with self.pool.get() as conn:
            try:
                # Escape FTS5 special characters
                escaped_query = self._escape_fts5(query)
                rows = conn.execute(
                    """SELECT d.id, d.path, d.rel_path, d.title, d.chunk_index, d.text,
                              rank, bm25(documents_fts) as score
                       FROM documents_fts
                       JOIN documents d ON d.id = documents_fts.rowid
                       WHERE documents_fts MATCH ?
                       ORDER BY score
                       LIMIT ?""",
                    (escaped_query, top_k)
                ).fetchall()
                return [dict(r) for r in rows]
            except Exception as e:
                print(f"[WARN] BM25 search failed: {e}")
                return []

    def vector_search(self, query_embedding: list[float], top_k: int) -> list[dict]:
        """Vector similarity search via sqlite-vec."""
        with self.pool.get() as conn:
            try:
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
                print(f"[WARN] Vector search failed: {e}")
                return []

    def _escape_fts5(self, query: str) -> str:
        """Escape FTS5 special characters and quote as phrase for exact matching."""
        # FTS5 special chars that need escaping: " * ( ) { } [ ] ^ $ \ | ? : ! &
        # The dot (.) is not special but can cause tokenization issues
        # Best practice: wrap in quotes to treat as phrase
        special = '"-*(){}[]^$\\|?:!&'
        for char in special:
            query = query.replace(char, f'\\{char}')
        # Quote the entire query to treat as exact phrase
        return f'"{query}"'


# ─── Global Pool ──────────────────────────────────────────────────────────────

_pool: ConnectionPool | None = None
_pool_lock = threading.Lock()


def get_pool() -> ConnectionPool:
    """Get global connection pool."""
    global _pool
    with _pool_lock:
        if _pool is None:
            config = get_config()
            _pool = ConnectionPool(config.database.path)
        return _pool


def get_database() -> Database:
    """Get database instance."""
    return Database(get_pool())


def init_database():
    """Initialize database schema."""
    get_database().init_schema()


def close_pool():
    """Close global connection pool."""
    global _pool
    with _pool_lock:
        if _pool:
            _pool.close_all()
            _pool = None