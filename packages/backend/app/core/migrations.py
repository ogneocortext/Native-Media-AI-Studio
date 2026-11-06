"""
SQLite database migrations.

Extracted from packages/backend/app/core/database.py (was 4121 lines).
Contains all _migrate_v* functions for schema versioning v1 through v22.

Migration best practices (Nov 2026):
- PRAGMA user_version tracks the schema version (built-in, integer, in DB header).
- Each migration is idempotent: running it twice is a no-op.
- A migration lock table prevents concurrent migration runners.
- PRAGMA integrity_check runs after every migration sequence.
- A hot backup is taken before any destructive migration.
"""

from __future__ import annotations

import logging
import os
import sqlite3
import time
from datetime import datetime
from typing import TYPE_CHECKING

from .connection import DB_PATH, SCHEMA_VERSION, close_pooled_connections, get_db
from .logs import cleanup_old_log_events

if TYPE_CHECKING:
    from pathlib import Path

logger = logging.getLogger(__name__)

# Retry configuration for "database is locked" errors during init.
# SQLite's busy_timeout covers most contention, but startup races between
# multiple backend processes or threads can still produce locked errors.
INIT_DB_MAX_RETRIES = 5
INIT_DB_BASE_DELAY = 0.5  # seconds, doubles each retry

# Migration lock: only one process should migrate at a time. We use a
# dedicated lock row in a migration_lock table, acquired within a transaction.
MIGRATION_LOCK_TTL_SECONDS = 300  # lock auto-expires after 5 minutes


def _acquire_migration_lock(conn: sqlite3.Connection) -> bool:
    """Try to acquire the migration lock.

    Returns True if the lock was acquired, False if another process holds it.
    The lock is stored as a row in ``migration_lock`` with an expiry timestamp.
    """
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS migration_lock (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                holder TEXT NOT NULL,
                acquired_at TEXT NOT NULL,
                expires_at TEXT NOT NULL
            )
        """)
        now = time.time()
        expires_at = now + MIGRATION_LOCK_TTL_SECONDS
        holder = f"{os.getpid()}:{time.time()}"
        try:
            conn.execute(
                """
                INSERT INTO migration_lock (id, holder, acquired_at, expires_at)
                VALUES (1, ?, ?, ?)
            """,
                (
                    holder,
                    datetime.fromtimestamp(now).isoformat(),
                    datetime.fromtimestamp(expires_at).isoformat(),
                ),
            )
            return True
        except sqlite3.IntegrityError:
            # Lock already exists: check if it's expired
            row = conn.execute("SELECT expires_at FROM migration_lock WHERE id = 1").fetchone()
            if row:
                expires = datetime.fromisoformat(row["expires_at"]).timestamp()
                if now > expires:
                    # Lock expired: steal it
                    conn.execute(
                        """
                        UPDATE migration_lock
                        SET holder = ?, acquired_at = ?, expires_at = ?
                        WHERE id = 1
                    """,
                        (
                            holder,
                            datetime.fromtimestamp(now).isoformat(),
                            datetime.fromtimestamp(expires_at).isoformat(),
                        ),
                    )
                    return True
            return False
    except sqlite3.Error:
        return False


def _release_migration_lock(conn: sqlite3.Connection) -> None:
    """Release the migration lock."""
    try:
        conn.execute("DELETE FROM migration_lock WHERE id = 1")
    except sqlite3.Error:
        pass


def _take_backup(db_path: Path) -> Path | None:
    """Take a hot backup of the database using SQLite's online backup API.

    Returns the backup path, or None if the backup could not be made.
    """
    try:
        backup_path = db_path.with_suffix(f".pre-migrate-{int(time.time())}.db")
        source = sqlite3.connect(str(db_path))
        dest = sqlite3.connect(str(backup_path))
        try:
            source.backup(dest)
        finally:
            dest.close()
            source.close()
        logger.info("Took pre-migration backup: %s", backup_path)
        return backup_path
    except sqlite3.Error as e:
        logger.warning("Pre-migration backup failed: %s", e)
        return None


def _run_integrity_check(conn: sqlite3.Connection) -> bool:
    """Run PRAGMA integrity_check and return True if the database is sane."""
    try:
        row = conn.execute("PRAGMA integrity_check").fetchone()
        if row and row[0] == "ok":
            return True
        logger.error("PRAGMA integrity_check returned: %s", row[0] if row else "unknown")
        return False
    except sqlite3.Error as e:
        logger.error("PRAGMA integrity_check failed: %s", e)
        return False


def _migrate_v1(conn: sqlite3.Connection):
    """Initial schema -- jobs table."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,
            job_type TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            priority INTEGER DEFAULT 0,
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
    try:
        conn.execute("SELECT data FROM lyrics_lines LIMIT 0")
    except sqlite3.OperationalError:
        conn.execute("ALTER TABLE lyrics_lines ADD COLUMN data TEXT DEFAULT '{}'")


def _migrate_v8(conn: sqlite3.Connection):
    """Add gpu_telemetry table for persistent GPU trend history."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS gpu_telemetry (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts_ms INTEGER NOT NULL,
            ts_iso TEXT NOT NULL,
            gpu_name TEXT,
            memory_total INTEGER,
            memory_used INTEGER,
            memory_free INTEGER,
            memory_percent REAL,
            gpu_util INTEGER,
            mem_controller_util INTEGER,
            temperature_c INTEGER,
            processes_json TEXT DEFAULT '[]'
        );
        CREATE INDEX IF NOT EXISTS idx_gpu_telemetry_ts ON gpu_telemetry(ts_ms);
        CREATE INDEX IF NOT EXISTS idx_gpu_telemetry_iso ON gpu_telemetry(ts_iso);
    """)


def _migrate_v9(conn: sqlite3.Connection):
    """Add vision OCR, native open history, studio scenes, character bibles, and performance indexes."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS vision_ocr_results (
            id TEXT PRIMARY KEY,
            relative_path TEXT NOT NULL,
            filename TEXT NOT NULL,
            ocr_text TEXT NOT NULL,
            model TEXT NOT NULL,
            prompt TEXT NOT NULL,
            file_type TEXT,
            size_bytes INTEGER,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_vision_ocr_path ON vision_ocr_results(relative_path);
        CREATE INDEX IF NOT EXISTS idx_vision_ocr_created ON vision_ocr_results(created_at);
        CREATE TABLE IF NOT EXISTS native_app_opens (
            id TEXT PRIMARY KEY,
            relative_path TEXT NOT NULL,
            filename TEXT NOT NULL,
            app TEXT NOT NULL,
            method TEXT,
            success INTEGER DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_native_opens_app ON native_app_opens(app);
        CREATE INDEX IF NOT EXISTS idx_native_opens_created ON native_app_opens(created_at);
        CREATE TABLE IF NOT EXISTS studio_scenes (
            id TEXT PRIMARY KEY,
            filename TEXT NOT NULL,
            code TEXT NOT NULL,
            track TEXT,
            model TEXT,
            preview_image TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_studio_scenes_track ON studio_scenes(track);
        CREATE INDEX IF NOT EXISTS idx_studio_scenes_created ON studio_scenes(created_at);
        CREATE TABLE IF NOT EXISTS character_bibles (
            id TEXT PRIMARY KEY,
            filename TEXT NOT NULL UNIQUE,
            name TEXT,
            notes TEXT,
            seed INTEGER,
            prompt TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_bibles_name ON character_bibles(name);
        CREATE TABLE IF NOT EXISTS log_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts_iso TEXT NOT NULL,
            ts_ms INTEGER NOT NULL,
            level TEXT NOT NULL,
            logger TEXT NOT NULL,
            message TEXT NOT NULL,
            source TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_log_events_ts_ms ON log_events(ts_ms);
        CREATE INDEX IF NOT EXISTS idx_log_events_level ON log_events(level);
        CREATE INDEX IF NOT EXISTS idx_log_events_source ON log_events(source);
        CREATE TABLE IF NOT EXISTS hardware_benchmarks (
            run_id TEXT PRIMARY KEY,
            engine TEXT NOT NULL,
            model TEXT,
            status TEXT NOT NULL DEFAULT 'failed',
            started_at TEXT NOT NULL,
            completed_at TEXT,
            duration_ms REAL,
            iterations INTEGER DEFAULT 1,
            successful_iterations INTEGER DEFAULT 0,
            success INTEGER DEFAULT 0,
            request TEXT DEFAULT '{}',
            metrics TEXT DEFAULT '{}',
            result TEXT DEFAULT '{}',
            error TEXT,
            profile TEXT DEFAULT '{}',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_hardware_benchmarks_engine ON hardware_benchmarks(engine);
        CREATE INDEX IF NOT EXISTS idx_hardware_benchmarks_model ON hardware_benchmarks(model);
        CREATE INDEX IF NOT EXISTS idx_hardware_benchmarks_created ON hardware_benchmarks(created_at);
        CREATE INDEX IF NOT EXISTS idx_gpu_telemetry_composite ON gpu_telemetry(ts_ms, gpu_util);
        CREATE INDEX IF NOT EXISTS idx_prompts_text ON prompts(text);
        CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title);
        CREATE INDEX IF NOT EXISTS idx_jobs_type_status ON jobs(job_type, status);
    """)


def _migrate_v10(conn: sqlite3.Connection):
    """Add missing performance indexes for frequently queried columns."""
    conn.executescript("""
        CREATE INDEX IF NOT EXISTS idx_ollama_analysis_track_filename
            ON ollama_analysis_responses(track_filename);
        CREATE INDEX IF NOT EXISTS idx_native_opens_relative_path
            ON native_app_opens(relative_path);
        CREATE INDEX IF NOT EXISTS idx_lyrics_lines_track_sort
            ON lyrics_lines(track_id, sort_order);
        CREATE INDEX IF NOT EXISTS idx_system_resources_timestamp_desc
            ON system_resources(timestamp DESC);
    """)


def _migrate_v11(conn: sqlite3.Connection):
    """Placeholder migration v11."""


def _migrate_v12(conn: sqlite3.Connection):
    """Placeholder migration v12."""


def _migrate_v13(conn: sqlite3.Connection):
    """Placeholder migration v13."""


def _migrate_v14(conn: sqlite3.Connection):
    """Placeholder migration v14."""


def _migrate_v15(conn: sqlite3.Connection):
    """Placeholder migration v15."""


def _migrate_v16(conn: sqlite3.Connection):
    """Placeholder migration v16."""


def _migrate_v17(conn: sqlite3.Connection):
    """Placeholder migration v17."""


def _migrate_v18(conn: sqlite3.Connection):
    """Placeholder migration v18."""


def _migrate_v19(conn: sqlite3.Connection):
    """Agent memory tables -- episodic + semantic memory for self-improvement loop.

    agent_episodes: one row per completed agent episode (task, approach, result,
    success/failure, duration, tools used). Used by System 2 reflection to
    assign credit and curate learnings.

    agent_memory_entries: curated learnings extracted from episodes -- successful
    patterns, failed patterns, API spec notes, environment constants. Used by
    System 1 retrieval to augment the agent's context before each tool-calling
    turn.
    """
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS agent_episodes (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            goal TEXT NOT NULL,
            approach TEXT NOT NULL,
            result TEXT NOT NULL,
            success INTEGER NOT NULL DEFAULT 0,
            duration_ms INTEGER NOT NULL,
            tools_used TEXT DEFAULT '[]',
            error_message TEXT,
            llm_driver TEXT DEFAULT 'atomic_chat',
            iterations INTEGER DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_agent_episodes_session ON agent_episodes(session_id);
        CREATE INDEX IF NOT EXISTS idx_agent_episodes_success ON agent_episodes(success);
        CREATE INDEX IF NOT EXISTS idx_agent_episodes_created ON agent_episodes(created_at);
        CREATE TABLE IF NOT EXISTS agent_memory_entries (
            id TEXT PRIMARY KEY,
            entry_type TEXT NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            tags TEXT DEFAULT '[]',
            credit_score REAL DEFAULT 0.0,
            usage_count INTEGER DEFAULT 0,
            last_used TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_agent_memory_type ON agent_memory_entries(entry_type);
        CREATE INDEX IF NOT EXISTS idx_agent_memory_credit ON agent_memory_entries(credit_score DESC);
        CREATE INDEX IF NOT EXISTS idx_agent_memory_usage ON agent_memory_entries(usage_count DESC);
        CREATE INDEX IF NOT EXISTS idx_agent_memory_tags ON agent_memory_entries(tags);
    """)


def _migrate_v20(conn: sqlite3.Connection):
    """Add display_name column to audio_files for user-friendly track names.

    Existing rows get display_name populated from filename by stripping
    hash prefixes and extensions, then replacing underscores with spaces
    and title-casing. Idempotent: if the column already exists, this is a no-op.
    """
    try:
        conn.execute("ALTER TABLE audio_files ADD COLUMN display_name TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        # Column already exists - idempotent no-op
        pass
    conn.execute("""
        UPDATE audio_files
        SET display_name = filename
        WHERE display_name IS NULL OR display_name = ''
    """)


def _migrate_v21(conn: sqlite3.Connection):
    """Add the media library organization tables.

    Favorites, collections, tags and soft-delete trash are keyed by
    ``relative_path`` and persisted in SQLite so organization survives
    rescans and never moves or copies files.

    These tables were previously created out-of-band (the running
    ``storage/studio.db`` has them at schema version 20) but no migration
    ever created them, so a fresh database failed every
    ``/api/media-library/*`` endpoint with ``no such table``. Idempotent
    ``CREATE TABLE IF NOT EXISTS`` makes the migration safe whether or not
    the tables already exist.
    """
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS media_favorites (
            relative_path TEXT PRIMARY KEY,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_media_favorites_created
            ON media_favorites(created_at DESC);

        CREATE TABLE IF NOT EXISTS media_collections (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            cover_path TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS media_collection_items (
            collection_id TEXT NOT NULL,
            relative_path TEXT NOT NULL,
            added_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (collection_id, relative_path),
            FOREIGN KEY (collection_id) REFERENCES media_collections(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_media_collection_items_path
            ON media_collection_items(relative_path);

        CREATE TABLE IF NOT EXISTS media_tags (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            color TEXT DEFAULT '#8b5cf6',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS media_item_tags (
            relative_path TEXT NOT NULL,
            tag_id TEXT NOT NULL,
            PRIMARY KEY (relative_path, tag_id),
            FOREIGN KEY (tag_id) REFERENCES media_tags(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_media_item_tags_path
            ON media_item_tags(relative_path);

        CREATE TABLE IF NOT EXISTS media_trash (
            relative_path TEXT PRIMARY KEY,
            file_type TEXT NOT NULL,
            deleted_at TEXT NOT NULL DEFAULT (datetime('now')),
            expires_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_media_trash_expires
            ON media_trash(expires_at);
    """)


def get_schema_version(conn: sqlite3.Connection) -> int:
    """Read the current schema version from the database."""
    row = conn.execute("PRAGMA user_version").fetchone()
    return row[0] if row else 0


def set_schema_version(conn: sqlite3.Connection, version: int) -> None:
    """Persist the schema version."""
    if not isinstance(version, int):
        raise TypeError(f"schema version must be int, got {type(version).__name__}")
    conn.execute(f"PRAGMA user_version = {version}")


def init_db(db_path: Path | None = None):
    """Initialize database tables and run migrations.

    WAL is enabled here, once, before any other connection exists:
    `journal_mode` is persistent and database-wide, so `get_connection` no longer
    re-issues it on every connection (which is redundant work and can fail with
    "database is locked" while readers are active). It is set defensively before
    the `with get_db()` block because `get_schema_version` reads the file, and
    `busy_timeout` covers the case where a running backend holds a write lock.

    Migration safety (Nov 2026 best practices):
    - Only one process migrates at a time (migration_lock table).
    - A hot backup is taken before migration via the online backup API.
    - PRAGMA integrity_check runs after all migrations complete.

    Args:
        db_path: Override the database path (mainly for tests). Defaults to
            the module-level ``DB_PATH`` from :mod:`app.core.connection`.
    """
    target = db_path or DB_PATH

    for attempt in range(INIT_DB_MAX_RETRIES):
        try:
            # A pooled connection may already be open against this path with the
            # pre-migration schema. Drop it so the first query after init_db sees the
            # new schema rather than whatever the pooled connection cached.
            try:
                close_pooled_connections()
            except Exception:  # pragma: no cover - defensive
                pass

            current_db_path = str(target)
            target.parent.mkdir(parents=True, exist_ok=True)
            try:
                with sqlite3.connect(current_db_path, timeout=10.0) as setup:
                    mode = setup.execute("PRAGMA journal_mode=WAL").fetchone()[0]
                    if str(mode).lower() != "wal":
                        # A reader can hold the file in its current mode momentarily.
                        logger.warning("journal_mode is %s, expected WAL", mode)
            except sqlite3.Error as exc:
                logger.warning("Could not set WAL mode: %s", exc)

            with get_db() as conn:
                # --- Migration lock: only one migrator at a time ---
                if not _acquire_migration_lock(conn):
                    logger.warning(
                        "Another process holds the migration lock; skipping migrations. "
                        "Lock TTL is %d seconds.",
                        MIGRATION_LOCK_TTL_SECONDS,
                    )
                    return

                try:
                    current_version = get_schema_version(conn)

                    # Take a hot backup before any schema changes (best practice).
                    # Only back up if there are actually migrations to run.
                    if current_version < SCHEMA_VERSION:
                        _take_backup(target)

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
                    if current_version < 8:
                        _migrate_v8(conn)
                    if current_version < 9:
                        _migrate_v9(conn)
                    if current_version < 10:
                        _migrate_v10(conn)
                    if current_version < 11:
                        _migrate_v11(conn)
                    if current_version < 12:
                        _migrate_v12(conn)
                    if current_version < 13:
                        _migrate_v13(conn)
                    if current_version < 14:
                        _migrate_v14(conn)
                    if current_version < 15:
                        _migrate_v15(conn)
                    if current_version < 16:
                        _migrate_v16(conn)
                    if current_version < 17:
                        _migrate_v17(conn)
                    if current_version < 18:
                        _migrate_v18(conn)
                    if current_version < 19:
                        _migrate_v19(conn)
                    if current_version < 20:
                        _migrate_v20(conn)
                    if current_version < 21:
                        _migrate_v21(conn)

                    set_schema_version(conn, SCHEMA_VERSION)
                    logger.info("Database initialized at version %d", SCHEMA_VERSION)

                    # --- Integrity check after migration (best practice) ---
                    if not _run_integrity_check(conn):
                        raise sqlite3.DatabaseError(
                            "PRAGMA integrity_check failed after migration; database may be corrupt"
                        )

                finally:
                    _release_migration_lock(conn)

                # Ensure performance indexes exist on hot telemetry tables (idempotent).
                conn.executescript("""
                    CREATE INDEX IF NOT EXISTS idx_gpu_telemetry_name
                        ON gpu_telemetry(gpu_name);
                    CREATE INDEX IF NOT EXISTS idx_gpu_telemetry_ts_name
                        ON gpu_telemetry(ts_ms, gpu_name);
                    CREATE INDEX IF NOT EXISTS idx_user_preferences_category
                        ON user_preferences(category);
                    CREATE INDEX IF NOT EXISTS idx_visualization_presets_track_name
                        ON visualization_presets(track_name);
                """)

                # Prune stale log analytics rows on startup so the store stays lean.
                # Reuse the same connection to avoid nested SQLite writer locks.
                cleanup_old_log_events(keep_days=30, conn=conn)

            # Success - exit retry loop
            return

        except sqlite3.OperationalError as exc:
            if "database is locked" not in str(exc).lower():
                raise
            if attempt < INIT_DB_MAX_RETRIES - 1:
                delay = INIT_DB_BASE_DELAY * (2**attempt)
                logger.warning(
                    "Database locked on init attempt %d/%d, retrying in %.1fs: %s",
                    attempt + 1,
                    INIT_DB_MAX_RETRIES,
                    delay,
                    exc,
                )
                time.sleep(delay)
            else:
                logger.error(
                    "Database initialization failed after %d attempts: %s",
                    INIT_DB_MAX_RETRIES,
                    exc,
                )
                raise
