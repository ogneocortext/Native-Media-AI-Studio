"""
SQLite database setup, migrations, and session management.
Supports persistent storage for jobs, prompts, audio files, AI visuals,
generation sessions, and user preferences.
"""

import json
import logging
import sqlite3
from collections.abc import Generator
from contextlib import contextmanager
from datetime import datetime
from typing import Any

from .config import PROJECT_ROOT

logger = logging.getLogger(__name__)

DB_PATH = PROJECT_ROOT / "storage" / "studio.db"

# Database schema version for migrations
SCHEMA_VERSION = 7


def _safe_json_loads(val: str | None, default: Any = None) -> Any:
    """Safely parse JSON string, returning default on error."""
    if not val:
        return default if default is not None else {}
    try:
        return json.loads(val)
    except (json.JSONDecodeError, TypeError) as e:
        logger.warning("JSON parse error: %s", e)
        return default if default is not None else {}


def get_connection() -> sqlite3.Connection:
    """Get a database connection with row factory."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


@contextmanager
def get_db() -> Generator[sqlite3.Connection, None, None]:
    """Context manager for database connections."""
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def get_schema_version(conn: sqlite3.Connection) -> int:
    """Get current schema version."""
    try:
        row = conn.execute(
            "SELECT value FROM schema_version WHERE id = 1"
        ).fetchone()
        return int(row["value"]) if row else 0
    except sqlite3.OperationalError:
        return 0


def set_schema_version(conn: sqlite3.Connection, version: int) -> None:
    """Set schema version."""
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_version (
            id INTEGER PRIMARY KEY DEFAULT 1,
            value INTEGER NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )
    conn.execute(
        """
        INSERT OR REPLACE INTO schema_version (id, value, updated_at)
        VALUES (1, ?, datetime('now'))
        """,
        (version,),
    )


def init_db():
    """Initialize database tables and run migrations."""
    with get_db() as conn:
        current_version = get_schema_version(conn)

        if current_version < 1:
            _migrate_v1(conn)
        if current_version < 2:
            _migrate_v2(conn)
        if current_version < 3:
            _migrate_v3(conn)
        if current_version < 4:
            _migrate_v4(conn)
        if current_version < 5:
            _migrate_v5(conn)
        if current_version < 6:
            _migrate_v6(conn)
        if current_version < 7:
            _migrate_v7(conn)

        set_schema_version(conn, SCHEMA_VERSION)
        logger.info("Database initialized at version %d", SCHEMA_VERSION)


def _migrate_v1(conn: sqlite3.Connection):
    """Initial schema — jobs table."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,
            job_type TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL,
            started_at TEXT,
            completed_at TEXT,
            progress REAL DEFAULT 0.0,
            message TEXT DEFAULT '',
            error TEXT,
            result TEXT,
            params TEXT NOT NULL DEFAULT '{}',
            output_path TEXT,
            retry_count INTEGER DEFAULT 0,
            max_retries INTEGER DEFAULT 3
        );

        CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
        CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
        CREATE INDEX IF NOT EXISTS idx_jobs_job_type ON jobs(job_type);
    """)


def _migrate_v2(conn: sqlite3.Connection):
    """Add audio files and prompts tables."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS audio_files (
            id TEXT PRIMARY KEY,
            filename TEXT NOT NULL,
            original_name TEXT NOT NULL,
            stored_path TEXT NOT NULL,
            file_size INTEGER DEFAULT 0,
            duration REAL DEFAULT 0.0,
            sample_rate INTEGER DEFAULT 44100,
            channels INTEGER DEFAULT 2,
            format TEXT DEFAULT '',
            bpm REAL,
            key TEXT,
            genre TEXT,
            music_prompt_id TEXT,
            analysis_result TEXT DEFAULT '{}',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_audio_files_filename ON audio_files(filename);
        CREATE INDEX IF NOT EXISTS idx_audio_files_created_at ON audio_files(created_at);

        CREATE TABLE IF NOT EXISTS prompts (
            id TEXT PRIMARY KEY,
            name TEXT DEFAULT '',
            prompt_type TEXT NOT NULL,
            text TEXT NOT NULL,
            tags TEXT DEFAULT '[]',
            category TEXT DEFAULT '',
            description TEXT DEFAULT '',
            is_favorite INTEGER DEFAULT 0,
            use_count INTEGER DEFAULT 0,
            last_used_at TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_prompts_type ON prompts(prompt_type);
        CREATE INDEX IF NOT EXISTS idx_prompts_category ON prompts(category);
        CREATE INDEX IF NOT EXISTS idx_prompts_favorite ON prompts(is_favorite);
    """)


def _migrate_v3(conn: sqlite3.Connection):
    """Add AI visuals, generation sessions, user preferences, and tracks tables."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS ai_visuals (
            id TEXT PRIMARY KEY,
            prompt_id TEXT,
            style_id TEXT DEFAULT '',
            checkpoint TEXT DEFAULT '',
            width INTEGER DEFAULT 512,
            height INTEGER DEFAULT 512,
            steps INTEGER DEFAULT 20,
            cfg REAL DEFAULT 7.0,
            seed INTEGER DEFAULT 0,
            sampler TEXT DEFAULT 'euler',
            scheduler TEXT DEFAULT 'normal',
            filename TEXT DEFAULT '',
            stored_path TEXT DEFAULT '',
            comfyui_prompt_id TEXT DEFAULT '',
            is_selected INTEGER DEFAULT 0,
            is_favorite INTEGER DEFAULT 0,
            rating INTEGER DEFAULT 0,
            tags TEXT DEFAULT '[]',
            generation_time_seconds REAL DEFAULT 0.0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_ai_visuals_style ON ai_visuals(style_id);
        CREATE INDEX IF NOT EXISTS idx_ai_visuals_favorite ON ai_visuals(is_favorite);
        CREATE INDEX IF NOT EXISTS idx_ai_visuals_created ON ai_visuals(created_at);

        CREATE TABLE IF NOT EXISTS generation_sessions (
            id TEXT PRIMARY KEY,
            audio_id TEXT,
            music_prompt_id TEXT,
            status TEXT DEFAULT 'draft',
            config TEXT DEFAULT '{}',
            selected_visuals TEXT DEFAULT '[]',
            output_path TEXT,
            total_frames INTEGER DEFAULT 0,
            generated_frames INTEGER DEFAULT 0,
            estimated_time_seconds REAL DEFAULT 0.0,
            actual_time_seconds REAL DEFAULT 0.0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            completed_at TEXT,
            FOREIGN KEY (audio_id) REFERENCES audio_files(id) ON DELETE SET NULL,
            FOREIGN KEY (music_prompt_id) REFERENCES prompts(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_status ON generation_sessions(status);
        CREATE INDEX IF NOT EXISTS idx_sessions_audio ON generation_sessions(audio_id);

        CREATE TABLE IF NOT EXISTS user_preferences (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            category TEXT DEFAULT 'general',
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
    """)


def _migrate_v4(conn: sqlite3.Connection):
    """Add tracks table for music library management."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS tracks (
            id TEXT PRIMARY KEY,
            filename TEXT NOT NULL,
            artist TEXT DEFAULT '',
            title TEXT NOT NULL,
            duration_seconds REAL DEFAULT 0,
            size_mb REAL DEFAULT 0,
            source_path TEXT DEFAULT '',
            music_prompt TEXT DEFAULT '',
            lyrics TEXT DEFAULT '',
            visual_style TEXT DEFAULT '',
            visual_prompt TEXT DEFAULT '',
            status TEXT DEFAULT 'pending',
            tags TEXT DEFAULT '[]',
            comfyui_visual_ids TEXT DEFAULT '[]',
            output_path TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
        CREATE INDEX IF NOT EXISTS idx_tracks_status ON tracks(status);
    """)


# =============================================================================
# Prompt Repository
# =============================================================================


def save_prompt(
    name: str,
    prompt_type: str,
    text: str,
    tags: list[str] | None = None,
    category: str = "",
    description: str = "",
) -> str:
    """Save a prompt and return its ID."""
    import uuid

    prompt_id = str(uuid.uuid4())
    now = datetime.now().isoformat()

    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO prompts (id, name, prompt_type, text, tags, category, description, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                prompt_id,
                name,
                prompt_type,
                text,
                json.dumps(tags or []),
                category,
                description,
                now,
                now,
            ),
        )

    return prompt_id


def get_prompt(prompt_id: str) -> dict[str, Any] | None:
    """Get a prompt by ID."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM prompts WHERE id = ?", (prompt_id,)
        ).fetchone()
        if row:
            return _row_to_prompt(row)
    return None


def get_prompts(
    prompt_type: str | None = None,
    category: str | None = None,
    favorite_only: bool = False,
    search: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    """Get prompts with optional filtering."""
    query = "SELECT * FROM prompts WHERE 1=1"
    params: list[Any] = []

    if prompt_type:
        query += " AND prompt_type = ?"
        params.append(prompt_type)
    if category:
        query += " AND category = ?"
        params.append(category)
    if favorite_only:
        query += " AND is_favorite = 1"
    if search:
        query += " AND (text LIKE ? OR name LIKE ? OR tags LIKE ?)"
        search_term = f"%{search}%"
        params.extend([search_term, search_term, search_term])

    query += " ORDER BY is_favorite DESC, use_count DESC, updated_at DESC LIMIT ?"
    params.append(limit)

    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()
        return [_row_to_prompt(row) for row in rows]


def increment_prompt_use(prompt_id: str) -> None:
    """Increment use count and update last_used_at."""
    with get_db() as conn:
        conn.execute(
            """
            UPDATE prompts
            SET use_count = use_count + 1, last_used_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (datetime.now().isoformat(), datetime.now().isoformat(), prompt_id),
        )


def toggle_prompt_favorite(prompt_id: str) -> bool:
    """Toggle favorite status. Returns new status."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT is_favorite FROM prompts WHERE id = ?", (prompt_id,)
        ).fetchone()
        if not row:
            return False
        new_status = not row["is_favorite"]
        conn.execute(
            "UPDATE prompts SET is_favorite = ?, updated_at = ? WHERE id = ?",
            (int(new_status), datetime.now().isoformat(), prompt_id),
        )
        return new_status


def delete_prompt(prompt_id: str) -> bool:
    """Delete a prompt. Returns True if deleted."""
    with get_db() as conn:
        cursor = conn.execute("DELETE FROM prompts WHERE id = ?", (prompt_id,))
        return cursor.rowcount > 0


def _row_to_prompt(row: sqlite3.Row) -> dict[str, Any]:
    """Convert a database row to a prompt dict."""
    return {
        "id": row["id"],
        "name": row["name"],
        "prompt_type": row["prompt_type"],
        "text": row["text"],
        "tags": json.loads(row["tags"]) if row["tags"] else [],
        "category": row["category"],
        "description": row["description"],
        "is_favorite": bool(row["is_favorite"]),
        "use_count": row["use_count"],
        "last_used_at": row["last_used_at"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


# =============================================================================
# Audio File Repository
# =============================================================================


def save_audio_file(
    filename: str,
    original_name: str,
    stored_path: str,
    file_size: int = 0,
    duration: float = 0.0,
    **kwargs,
) -> str:
    """Save audio file metadata and return its ID.

    If a file with the same filename already exists, returns the existing ID
    instead of creating a duplicate entry.
    """
    import uuid

    with get_db() as conn:
        # Check for existing file with same filename to avoid duplicates
        existing = conn.execute(
            "SELECT id FROM audio_files WHERE filename = ?", (filename,)
        ).fetchone()
        if existing:
            return existing["id"]

        audio_id = str(uuid.uuid4())
        now = datetime.now().isoformat()

        conn.execute(
            """
            INSERT INTO audio_files
            (id, filename, original_name, stored_path, file_size, duration,
             sample_rate, channels, format, bpm, key, genre, music_prompt_id,
             analysis_result, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                audio_id,
                filename,
                original_name,
                stored_path,
                file_size,
                duration,
                kwargs.get("sample_rate", 44100),
                kwargs.get("channels", 2),
                kwargs.get("format", ""),
                kwargs.get("bpm"),
                kwargs.get("key"),
                kwargs.get("genre"),
                kwargs.get("music_prompt_id"),
                json.dumps(kwargs.get("analysis_result", {})),
                now,
            ),
        )

    return audio_id


def get_audio_file(audio_id: str) -> dict[str, Any] | None:
    """Get audio file metadata by ID."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM audio_files WHERE id = ?", (audio_id,)
        ).fetchone()
        if row:
            return _row_to_audio(row)
    return None


def get_audio_files(limit: int = 100, distinct: bool = False) -> list[dict[str, Any]]:
    """Get recent audio files.

    Args:
        limit: Maximum number of files to return.
        distinct: If True, return only the most recent entry per filename
                  (useful for deduplicating re-uploads).
    """
    with get_db() as conn:
        if distinct:
            # Return the most recent entry for each unique filename
            rows = conn.execute(
                """
                SELECT a.* FROM audio_files a
                INNER JOIN (
                    SELECT filename, MAX(created_at) AS max_created
                    FROM audio_files
                    GROUP BY filename
                ) b ON a.filename = b.filename AND a.created_at = b.max_created
                ORDER BY a.created_at DESC LIMIT ?
                """,
                (limit,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM audio_files ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [_row_to_audio(row) for row in rows]


def _row_to_audio(row: sqlite3.Row) -> dict[str, Any]:
    """Convert a database row to an audio file dict."""
    return {
        "id": row["id"],
        "filename": row["filename"],
        "original_name": row["original_name"],
        "stored_path": row["stored_path"],
        "file_size": row["file_size"],
        "duration": row["duration"],
        "sample_rate": row["sample_rate"],
        "channels": row["channels"],
        "format": row["format"],
        "bpm": row["bpm"],
        "key": row["key"],
        "genre": row["genre"],
        "music_prompt_id": row["music_prompt_id"],
        "analysis_result": _safe_json_loads(row["analysis_result"], {}),
        "created_at": row["created_at"],
    }


# =============================================================================
# AI Visual Repository
# =============================================================================


def save_ai_visual(
    style_id: str,
    filename: str = "",
    stored_path: str = "",
    prompt_id: str | None = None,
    width: int = 512,
    height: int = 512,
    steps: int = 20,
    cfg: float = 7.0,
    seed: int = 0,
    checkpoint: str = "",
    comfyui_prompt_id: str = "",
    generation_time: float = 0.0,
    tags: list[str] | None = None,
) -> str:
    """Save AI visual metadata and return its ID."""
    import uuid

    visual_id = str(uuid.uuid4())
    now = datetime.now().isoformat()

    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO ai_visuals
            (id, prompt_id, style_id, checkpoint, width, height, steps, cfg,
             seed, sampler, scheduler, filename, stored_path, comfyui_prompt_id,
             generation_time_seconds, tags, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                visual_id,
                prompt_id,
                style_id,
                checkpoint,
                width,
                height,
                steps,
                cfg,
                seed,
                "euler",
                "normal",
                filename,
                stored_path,
                comfyui_prompt_id,
                generation_time,
                json.dumps(tags or []),
                now,
            ),
        )

    return visual_id


def get_ai_visuals(
    style_id: str | None = None,
    favorite_only: bool = False,
    selected_only: bool = False,
    limit: int = 100,
) -> list[dict[str, Any]]:
    """Get AI visuals with optional filtering."""
    query = "SELECT * FROM ai_visuals WHERE 1=1"
    params: list[Any] = []

    if style_id:
        query += " AND style_id = ?"
        params.append(style_id)
    if favorite_only:
        query += " AND is_favorite = 1"
    if selected_only:
        query += " AND is_selected = 1"

    query += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)

    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()
        return [_row_to_visual(row) for row in rows]


def toggle_visual_favorite(visual_id: str) -> bool:
    """Toggle favorite status. Returns new status."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT is_favorite FROM ai_visuals WHERE id = ?", (visual_id,)
        ).fetchone()
        if not row:
            return False
        new_status = not row["is_favorite"]
        conn.execute(
            "UPDATE ai_visuals SET is_favorite = ? WHERE id = ?",
            (int(new_status), visual_id),
        )
        return new_status


def set_visual_selected(visual_id: str, selected: bool) -> None:
    """Set whether a visual is selected for the music video."""
    with get_db() as conn:
        conn.execute(
            "UPDATE ai_visuals SET is_selected = ? WHERE id = ?",
            (int(selected), visual_id),
        )


def _row_to_visual(row: sqlite3.Row) -> dict[str, Any]:
    """Convert a database row to an AI visual dict."""
    return {
        "id": row["id"],
        "prompt_id": row["prompt_id"],
        "style_id": row["style_id"],
        "checkpoint": row["checkpoint"],
        "width": row["width"],
        "height": row["height"],
        "steps": row["steps"],
        "cfg": row["cfg"],
        "seed": row["seed"],
        "sampler": row["sampler"],
        "scheduler": row["scheduler"],
        "filename": row["filename"],
        "stored_path": row["stored_path"],
        "comfyui_prompt_id": row["comfyui_prompt_id"],
        "is_selected": bool(row["is_selected"]),
        "is_favorite": bool(row["is_favorite"]),
        "rating": row["rating"],
        "tags": json.loads(row["tags"]) if row["tags"] else [],
        "generation_time_seconds": row["generation_time_seconds"],
        "created_at": row["created_at"],
    }


# =============================================================================
# User Preferences Repository
# =============================================================================


def get_preference(key: str, default: Any = None) -> Any:
    """Get a user preference by key."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT value FROM user_preferences WHERE key = ?", (key,)
        ).fetchone()
        if row:
            return json.loads(row["value"])
    return default


def set_preference(key: str, value: Any, category: str = "general") -> None:
    """Set a user preference."""
    now = datetime.now().isoformat()
    with get_db() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO user_preferences (key, value, category, updated_at)
            VALUES (?, ?, ?, ?)
            """,
            (key, json.dumps(value), category, now),
        )


def get_all_preferences(category: str | None = None) -> dict[str, Any]:
    """Get all preferences, optionally filtered by category."""
    with get_db() as conn:
        if category:
            rows = conn.execute(
                "SELECT key, value FROM user_preferences WHERE category = ?",
                (category,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT key, value FROM user_preferences"
            ).fetchall()
        return {row["key"]: json.loads(row["value"]) for row in rows}


# =============================================================================
# Generation Session Repository
# =============================================================================


def save_session(
    audio_id: str | None = None,
    music_prompt_id: str | None = None,
    config: dict[str, Any] | None = None,
) -> str:
    """Create a generation session and return its ID."""
    import uuid

    session_id = str(uuid.uuid4())
    now = datetime.now().isoformat()

    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO generation_sessions
            (id, audio_id, music_prompt_id, status, config, created_at)
            VALUES (?, ?, ?, 'draft', ?, ?)
            """,
            (session_id, audio_id, music_prompt_id, json.dumps(config or {}), now),
        )

    return session_id


def get_session(session_id: str) -> dict[str, Any] | None:
    """Get a generation session by ID."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM generation_sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if row:
            return _row_to_session(row)
    return None


def update_session(session_id: str, **kwargs) -> None:
    """Update a generation session."""
    allowed_fields = {
        "status", "config", "selected_visuals", "output_path",
        "total_frames", "generated_frames", "estimated_time_seconds",
        "actual_time_seconds", "completed_at",
    }

    updates = {k: v for k, v in kwargs.items() if k in allowed_fields}
    if not updates:
        return

    # Serialize JSON fields
    if "config" in updates:
        updates["config"] = json.dumps(updates["config"])
    if "selected_visuals" in updates:
        updates["selected_visuals"] = json.dumps(updates["selected_visuals"])

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [session_id]

    with get_db() as conn:
        conn.execute(
            f"UPDATE generation_sessions SET {set_clause} WHERE id = ?",
            values,
        )


def get_sessions(
    status: str | None = None,
    audio_id: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Get generation sessions with optional filtering."""
    query = "SELECT * FROM generation_sessions WHERE 1=1"
    params: list[Any] = []

    if status:
        query += " AND status = ?"
        params.append(status)
    if audio_id:
        query += " AND audio_id = ?"
        params.append(audio_id)

    query += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)

    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()
        return [_row_to_session(row) for row in rows]


def _row_to_session(row: sqlite3.Row) -> dict[str, Any]:
    """Convert a database row to a session dict."""
    return {
        "id": row["id"],
        "audio_id": row["audio_id"],
        "music_prompt_id": row["music_prompt_id"],
        "status": row["status"],
        "config": json.loads(row["config"]) if row["config"] else {},
        "selected_visuals": json.loads(row["selected_visuals"]) if row["selected_visuals"] else [],
        "output_path": row["output_path"],
        "total_frames": row["total_frames"],
        "generated_frames": row["generated_frames"],
        "estimated_time_seconds": row["estimated_time_seconds"],
        "actual_time_seconds": row["actual_time_seconds"],
        "created_at": row["created_at"],
        "completed_at": row["completed_at"],
    }


# =============================================================================
# Track Repository
# =============================================================================


def save_track(
    filename: str,
    title: str,
    artist: str = "",
    duration_seconds: float = 0,
    size_mb: float = 0,
    source_path: str = "",
    music_prompt: str = "",
    lyrics: str = "",
    visual_style: str = "",
    visual_prompt: str = "",
    tags: list[str] | None = None,
) -> str:
    """Save a track and return its ID."""
    import uuid

    track_id = str(uuid.uuid4())
    now = datetime.now().isoformat()

    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO tracks
            (id, filename, artist, title, duration_seconds, size_mb, source_path,
             music_prompt, lyrics, visual_style, visual_prompt, tags, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                track_id,
                filename,
                artist,
                title,
                duration_seconds,
                size_mb,
                source_path,
                music_prompt,
                lyrics,
                visual_style,
                visual_prompt,
                json.dumps(tags or []),
                now,
                now,
            ),
        )

    return track_id


def get_track(track_id: str) -> dict[str, Any] | None:
    """Get a track by ID."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM tracks WHERE id = ?", (track_id,)
        ).fetchone()
        if row:
            return _row_to_track(row)
    return None


def get_tracks(
    status: str | None = None,
    artist: str | None = None,
    search: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    """Get tracks with optional filtering."""
    query = "SELECT * FROM tracks WHERE 1=1"
    params: list[Any] = []

    if status:
        query += " AND status = ?"
        params.append(status)
    if artist:
        query += " AND artist = ?"
        params.append(artist)
    if search:
        query += " AND (title LIKE ? OR artist LIKE ? OR music_prompt LIKE ? OR lyrics LIKE ?)"
        search_term = f"%{search}%"
        params.extend([search_term, search_term, search_term, search_term])

    query += " ORDER BY artist, title LIMIT ?"
    params.append(limit)

    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()
        return [_row_to_track(row) for row in rows]


def update_track(track_id: str, **kwargs) -> None:
    """Update a track."""
    allowed_fields = {
        "music_prompt", "lyrics", "visual_style", "visual_prompt",
        "status", "tags", "comfyui_visual_ids", "output_path",
    }

    updates = {k: v for k, v in kwargs.items() if k in allowed_fields}
    if not updates:
        return

    # Serialize JSON fields
    if "tags" in updates:
        updates["tags"] = json.dumps(updates["tags"])
    if "comfyui_visual_ids" in updates:
        updates["comfyui_visual_ids"] = json.dumps(updates["comfyui_visual_ids"])

    updates["updated_at"] = datetime.now().isoformat()

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [track_id]

    with get_db() as conn:
        conn.execute(
            f"UPDATE tracks SET {set_clause} WHERE id = ?",
            values,
        )


def delete_track(track_id: str) -> bool:
    """Delete a track. Returns True if deleted."""
    with get_db() as conn:
        cursor = conn.execute("DELETE FROM tracks WHERE id = ?", (track_id,))
        return cursor.rowcount > 0


def _row_to_track(row: sqlite3.Row) -> dict[str, Any]:
    """Convert a database row to a track dict."""
    return {
        "id": row["id"],
        "filename": row["filename"],
        "artist": row["artist"],
        "title": row["title"],
        "duration_seconds": row["duration_seconds"],
        "size_mb": row["size_mb"],
        "source_path": row["source_path"],
        "music_prompt": row["music_prompt"],
        "lyrics": row["lyrics"],
        "visual_style": row["visual_style"],
        "visual_prompt": row["visual_prompt"],
        "status": row["status"],
        "tags": _safe_json_loads(row["tags"], []),
        "comfyui_visual_ids": _safe_json_loads(row["comfyui_visual_ids"], []),
        "output_path": row["output_path"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _migrate_v5(conn: sqlite3.Connection):
    """Add visualization presets and system resource tracking tables."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS visualization_presets (
            id TEXT PRIMARY KEY,
            track_name TEXT NOT NULL,
            track_hash TEXT NOT NULL,
            preset_name TEXT NOT NULL,
            visualization_style TEXT NOT NULL,
            params TEXT NOT NULL DEFAULT '{}',
            ollama_model TEXT,
            prompt TEXT,
            lyrics TEXT,
            mood_tags TEXT DEFAULT '[]',
            genre_tags TEXT DEFAULT '[]',
            bpm INTEGER DEFAULT 120,
            energy_level TEXT DEFAULT 'medium',
            is_unique BOOLEAN DEFAULT 1,
            usage_count INTEGER DEFAULT 0,
            last_used TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_viz_presets_track_hash ON visualization_presets(track_hash);
        CREATE INDEX IF NOT EXISTS idx_viz_presets_style ON visualization_presets(visualization_style);
        CREATE INDEX IF NOT EXISTS idx_viz_presets_unique ON visualization_presets(is_unique);

        CREATE TABLE IF NOT EXISTS system_resources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL DEFAULT (datetime('now')),
            gpu_name TEXT,
            gpu_memory_total INTEGER,
            gpu_memory_used INTEGER,
            gpu_memory_free INTEGER,
            gpu_utilization INTEGER,
            cpu_percent INTEGER,
            ram_total INTEGER,
            ram_used INTEGER,
            ram_free INTEGER,
            ollama_available BOOLEAN DEFAULT 0,
            ollama_models TEXT DEFAULT '[]'
        );

        CREATE INDEX IF NOT EXISTS idx_sys_resources_timestamp ON system_resources(timestamp);

        CREATE TABLE IF NOT EXISTS ollama_models (
            id TEXT PRIMARY KEY,
            model_name TEXT NOT NULL,
            model_size INTEGER,
            model_digest TEXT,
            is_tool_capable BOOLEAN DEFAULT 0,
            vram_required INTEGER,
            last_checked TEXT,
            is_available BOOLEAN DEFAULT 1,
            capabilities TEXT DEFAULT '[]',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_ollama_models_available ON ollama_models(is_available);
    """)
    conn.execute("PRAGMA user_version = 5")


def _migrate_v6(conn: sqlite3.Connection):
    """Add ollama_analysis_responses table for saving AI analysis results."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS ollama_analysis_responses (
            id TEXT PRIMARY KEY,
            track_name TEXT NOT NULL,
            track_filename TEXT DEFAULT '',
            model_name TEXT DEFAULT '',
            prompt TEXT DEFAULT '',
            lyrics TEXT DEFAULT '',
            bpm INTEGER DEFAULT 0,
            html_response TEXT DEFAULT '',
            raw_response TEXT DEFAULT '',
            status TEXT DEFAULT 'completed',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_ollama_analysis_track ON ollama_analysis_responses(track_name);
        CREATE INDEX IF NOT EXISTS idx_ollama_analysis_created ON ollama_analysis_responses(created_at);
    """)


def _migrate_v7(conn: sqlite3.Connection):
    """Add lyrics_lines table for timed lyric storage, word-level sync, and animation data."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS lyrics_lines (
            id TEXT PRIMARY KEY,
            track_id TEXT NOT NULL,
            start_time REAL NOT NULL,
            end_time REAL NOT NULL,
            text TEXT NOT NULL DEFAULT '',
            section TEXT DEFAULT '',
            sort_order INTEGER DEFAULT 0,
            data TEXT DEFAULT '{}',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_lyrics_lines_track_id ON lyrics_lines(track_id);
        CREATE INDEX IF NOT EXISTS idx_lyrics_lines_start_time ON lyrics_lines(start_time);
        CREATE INDEX IF NOT EXISTS idx_lyrics_lines_sort_order ON lyrics_lines(sort_order);

        -- Table for individual word timestamps within a lyric line
        CREATE TABLE IF NOT EXISTS lyrics_words (
            id TEXT PRIMARY KEY,
            line_id TEXT NOT NULL,
            word TEXT NOT NULL DEFAULT '',
            start_time REAL NOT NULL,
            end_time REAL NOT NULL,
            sort_order INTEGER DEFAULT 0,
            FOREIGN KEY (line_id) REFERENCES lyrics_lines(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_lyrics_words_line_id ON lyrics_words(line_id);
    """)
    # Add data column if it doesn't exist (for existing tables created before v7)
    try:
        conn.execute("SELECT data FROM lyrics_lines LIMIT 0")
    except sqlite3.OperationalError:
        conn.execute("ALTER TABLE lyrics_lines ADD COLUMN data TEXT DEFAULT '{}'")


# =============================================================================
# Ollama Analysis Response Repository


# Visualization Preset Functions

def save_visualization_preset(preset: dict) -> str:
    """Save a visualization preset to the database."""
    import uuid
    preset_id = preset.get("id", str(uuid.uuid4()))
    now = datetime.now().isoformat()

    with get_db() as conn:
        # Check if preset already exists to preserve created_at
        existing = conn.execute(
            "SELECT created_at FROM visualization_presets WHERE id = ?",
            (preset_id,),
        ).fetchone()
        created_at = existing["created_at"] if existing else now

        conn.execute(
            """
            INSERT OR REPLACE INTO visualization_presets 
            (id, track_name, track_hash, preset_name, visualization_style, params,
             ollama_model, prompt, lyrics, mood_tags, genre_tags, bpm, energy_level,
             is_unique, usage_count, last_used, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                preset_id,
                preset.get("track_name", ""),
                preset.get("track_hash", ""),
                preset.get("preset_name", ""),
                preset.get("visualization_style", "geometric"),
                json.dumps(preset.get("params", {})),
                preset.get("ollama_model"),
                preset.get("prompt", ""),
                preset.get("lyrics", ""),
                json.dumps(preset.get("mood_tags", [])),
                json.dumps(preset.get("genre_tags", [])),
                preset.get("bpm", 120),
                preset.get("energy_level", "medium"),
                preset.get("is_unique", True),
                preset.get("usage_count", 0),
                preset.get("last_used"),
                created_at,
                now,
            ),
        )
    return preset_id


def get_visualization_preset(track_hash: str) -> dict | None:
    """Get a visualization preset by track hash."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM visualization_presets WHERE track_hash = ? AND is_unique = 1 ORDER BY usage_count DESC LIMIT 1",
            (track_hash,),
        ).fetchone()
        
        if row:
            # Update usage count
            conn.execute(
                "UPDATE visualization_presets SET usage_count = usage_count + 1, last_used = ? WHERE id = ?",
                (datetime.now().isoformat(), row["id"]),
            )
            return _row_to_viz_preset(row)
    return None


def get_all_visualization_presets() -> list[dict]:
    """Get all visualization presets."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM visualization_presets ORDER BY usage_count DESC, created_at DESC LIMIT 500"
        ).fetchall()
        return [_row_to_viz_preset(row) for row in rows]


def find_similar_preset(track_name: str, mood_tags: list, genre_tags: list) -> dict | None:
    """Find a similar preset based on track characteristics."""
    if not mood_tags and not genre_tags:
        return None

    with get_db() as conn:
        # Use SQL LIKE for simple matching instead of loading all rows
        conditions = []
        params = []

        for tag in mood_tags:
            conditions.append("mood_tags LIKE ?")
            params.append(f"%{tag}%")
        for tag in genre_tags:
            conditions.append("genre_tags LIKE ?")
            params.append(f"%{tag}%")

        if not conditions:
            return None

        query = f"""
            SELECT * FROM visualization_presets
            WHERE is_unique = 1 AND ({" OR ".join(conditions)})
            ORDER BY usage_count DESC
            LIMIT 1
        """
        row = conn.execute(query, params).fetchone()

        if row:
            return _row_to_viz_preset(row)
    return None


def _row_to_viz_preset(row: sqlite3.Row) -> dict:
    """Convert a database row to a visualization preset dict."""
    return {
        "id": row["id"],
        "track_name": row["track_name"],
        "track_hash": row["track_hash"],
        "preset_name": row["preset_name"],
        "visualization_style": row["visualization_style"],
        "params": _safe_json_loads(row["params"], {}),
        "ollama_model": row["ollama_model"],
        "prompt": row["prompt"],
        "lyrics": row["lyrics"],
        "mood_tags": _safe_json_loads(row["mood_tags"], []),
        "genre_tags": _safe_json_loads(row["genre_tags"], []),
        "bpm": row["bpm"],
        "energy_level": row["energy_level"],
        "is_unique": row["is_unique"],
        "usage_count": row["usage_count"],
        "last_used": row["last_used"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


# System Resource Functions

def log_system_resources(resources: dict) -> None:
    """Log system resource snapshot."""
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO system_resources 
            (gpu_name, gpu_memory_total, gpu_memory_used, gpu_memory_free,
             gpu_utilization, cpu_percent, ram_total, ram_used, ram_free,
             ollama_available, ollama_models)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                resources.get("gpu_name"),
                resources.get("gpu_memory_total"),
                resources.get("gpu_memory_used"),
                resources.get("gpu_memory_free"),
                resources.get("gpu_utilization"),
                resources.get("cpu_percent"),
                resources.get("ram_total"),
                resources.get("ram_used"),
                resources.get("ram_free"),
                resources.get("ollama_available", False),
                json.dumps(resources.get("ollama_models", [])),
            ),
        )


def get_latest_system_resources() -> dict | None:
    """Get the latest system resource snapshot."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM system_resources ORDER BY timestamp DESC LIMIT 1"
        ).fetchone()

        if row:
            return {
                "timestamp": row["timestamp"],
                "gpu_name": row["gpu_name"],
                "gpu_memory_total": row["gpu_memory_total"],
                "gpu_memory_used": row["gpu_memory_used"],
                "gpu_memory_free": row["gpu_memory_free"],
                "gpu_utilization": row["gpu_utilization"],
                "cpu_percent": row["cpu_percent"],
                "ram_total": row["ram_total"],
                "ram_used": row["ram_used"],
                "ram_free": row["ram_free"],
                "ollama_available": row["ollama_available"],
                "ollama_models": _safe_json_loads(row["ollama_models"], []),
            }
    return None


def cleanup_old_system_resources(keep_days: int = 7) -> int:
    """Remove system resource snapshots older than keep_days. Returns count deleted."""
    with get_db() as conn:
        cursor = conn.execute(
            "DELETE FROM system_resources WHERE timestamp < datetime('now', ?)",
            (f"-{keep_days} days",),
        )
        return cursor.rowcount


# Ollama Model Functions

def save_ollama_model(model: dict) -> None:
    """Save or update Ollama model info."""
    with get_db() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO ollama_models 
            (id, model_name, model_size, model_digest, is_tool_capable,
             vram_required, last_checked, is_available, capabilities)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                model.get("id", model.get("model_name")),
                model.get("model_name"),
                model.get("model_size"),
                model.get("model_digest"),
                model.get("is_tool_capable", False),
                model.get("vram_required"),
                datetime.now().isoformat(),
                model.get("is_available", True),
                json.dumps(model.get("capabilities", [])),
            ),
        )


def get_available_ollama_models(min_vram_free: int = 0) -> list[dict]:
    """Get available Ollama models filtered by VRAM requirements."""
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT * FROM ollama_models 
            WHERE is_available = 1 AND vram_required <= ?
            ORDER BY is_tool_capable DESC, vram_required ASC
            """,
            (min_vram_free,),
        ).fetchall()
        
        return [
            {
                "id": row["id"],
                "model_name": row["model_name"],
                "model_size": row["model_size"],
                "model_digest": row["model_digest"],
                "is_tool_capable": row["is_tool_capable"],
                "vram_required": row["vram_required"],
                "last_checked": row["last_checked"],
                "is_available": row["is_available"],
                "capabilities": json.loads(row["capabilities"]) if row["capabilities"] else [],
            }
            for row in rows
        ]


# Ollama Analysis Response Repository

def save_ollama_analysis_response(
    track_name: str,
    html_response: str,
    raw_response: str = "",
    track_filename: str = "",
    model_name: str = "",
    prompt: str = "",
    lyrics: str = "",
    bpm: int = 0,
    status: str = "completed",
) -> str:
    """Save an Ollama analysis response and return its ID."""
    import uuid

    response_id = str(uuid.uuid4())
    now = datetime.now().isoformat()

    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO ollama_analysis_responses
            (id, track_name, track_filename, model_name, prompt, lyrics, bpm,
             html_response, raw_response, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                response_id,
                track_name,
                track_filename,
                model_name,
                prompt,
                lyrics,
                bpm,
                html_response,
                raw_response,
                status,
                now,
            ),
        )

    return response_id


def get_ollama_analysis_responses(
    track_name: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Get Ollama analysis responses, optionally filtered by track name."""
    with get_db() as conn:
        if track_name:
            rows = conn.execute(
                """
                SELECT * FROM ollama_analysis_responses
                WHERE track_name = ?
                ORDER BY created_at DESC LIMIT ?
                """,
                (track_name, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT * FROM ollama_analysis_responses
                ORDER BY created_at DESC LIMIT ?
                """,
                (limit,),
            ).fetchall()

        return [
            {
                "id": row["id"],
                "track_name": row["track_name"],
                "track_filename": row["track_filename"],
                "model_name": row["model_name"],
                "prompt": row["prompt"],
                "lyrics": row["lyrics"],
                "bpm": row["bpm"],
                "html_response": row["html_response"],
                "raw_response": row["raw_response"],
                "status": row["status"],
                "created_at": row["created_at"],
            }
            for row in rows
        ]


def get_ollama_analysis_response(response_id: str) -> dict[str, Any] | None:
    """Get a single Ollama analysis response by ID."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM ollama_analysis_responses WHERE id = ?",
            (response_id,),
        ).fetchone()
        if row:
            return {
                "id": row["id"],
                "track_name": row["track_name"],
                "track_filename": row["track_filename"],
                "model_name": row["model_name"],
                "prompt": row["prompt"],
                "lyrics": row["lyrics"],
                "bpm": row["bpm"],
                "html_response": row["html_response"],
                "raw_response": row["raw_response"],
                "status": row["status"],
                "created_at": row["created_at"],
            }
    return None


def delete_ollama_analysis_response(response_id: str) -> bool:
    """Delete an Ollama analysis response. Returns True if deleted."""
    with get_db() as conn:
        cursor = conn.execute(
            "DELETE FROM ollama_analysis_responses WHERE id = ?",
            (response_id,),
        )
        return cursor.rowcount > 0
