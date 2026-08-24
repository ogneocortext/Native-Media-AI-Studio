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
SCHEMA_VERSION = 4


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
    """Save audio file metadata and return its ID."""
    import uuid

    audio_id = str(uuid.uuid4())
    now = datetime.now().isoformat()

    with get_db() as conn:
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


def get_audio_files(limit: int = 100) -> list[dict[str, Any]]:
    """Get recent audio files."""
    with get_db() as conn:
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
        "analysis_result": json.loads(row["analysis_result"]) if row["analysis_result"] else {},
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
        "tags": json.loads(row["tags"]) if row["tags"] else [],
        "comfyui_visual_ids": json.loads(row["comfyui_visual_ids"]) if row["comfyui_visual_ids"] else [],
        "output_path": row["output_path"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }
