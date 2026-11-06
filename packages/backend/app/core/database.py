"""
Database layer -- re-export shim.

This module re-exports all public names from the split-out core database modules
so that existing imports like ``from .core.database import get_db`` continue to
work unchanged.

The original ``database.py`` was 4121 lines (far over the 3k line limit) and has
been split into focused modules:

- ``connection.py``   -- DB path, connection pool, ``get_db()`` context manager
- ``migrations.py``   -- All ``_migrate_v*`` schema migration functions
- ``models.py``       -- All ``@dataclass`` typed row models
- ``media.py``        -- Media favorites, collections, tags, trash CRUD
- ``audio.py``        -- Audio file CRUD
- ``prompts.py``      -- Prompt CRUD
- ``sessions.py``     -- Generation session CRUD
- ``tracks.py``       -- Track CRUD
- ``visuals.py``      -- AI visual CRUD
- ``presets.py``      -- Visualization preset CRUD
- ``logs.py``         -- Log ingestion and analytics
- ``gpu.py``          -- GPU telemetry CRUD
- ``ollama.py``       -- Ollama models and analysis CRUD
- ``studio.py``       -- Studio scene and character bible CRUD
- ``vision.py``       -- Vision OCR CRUD
- ``preferences.py``  -- Preference CRUD
- ``benchmark.py``    -- Benchmark CRUD
- ``native_opens.py`` -- Native app open logging
"""

# ruff: noqa: E402  # re-export shim: imports grouped by category, functions delegate

from __future__ import annotations

import app.core.connection as _connection_module

# Re-export audio CRUD
from .audio import (
    _row_to_audio,
    get_audio_analysis,
    get_audio_analysis_field,
    get_audio_file,
    get_audio_files,
    get_audio_files_for_dedup,
    save_audio_file,
    search_audio_by_analysis,
    set_audio_content_hash,
    set_audio_duplicate_of,
    update_audio_analysis,
)

# Re-export benchmark CRUD
from .benchmark import (
    delete_benchmark_results,
    get_benchmark_result,
    insert_benchmark_result,
    list_benchmark_results,
)

# Re-export connection management
from .connection import (
    BUSY_TIMEOUT_MS,
    MAX_POOLED_CONNECTIONS,
    SCHEMA_VERSION,
    _local,
    _resolve_db_path,
    async_get_db,
    checkpoint_wal,
    close_pooled_connections,
    get_connection,
    get_connection_unpooled,
    release_connection,
    run_db_sync,
    safe_vacuum,
)

#: Database file path. Defined independently here so that monkeypatching
#: ``database.DB_PATH`` in tests actually takes effect. ``get_db`` and
#: ``init_db`` below sync it into the connection module before delegating.
DB_PATH = _resolve_db_path()


def get_db():
    """Context manager yielding a pooled connection using ``database.DB_PATH``.

    Syncs ``connection.DB_PATH`` with ``database.DB_PATH`` before delegating,
    so that monkeypatching ``database.DB_PATH`` (as tests do) actually
    redirects the connection to the throwaway database.
    """
    _connection_module.DB_PATH = DB_PATH
    return _connection_module.get_db()


def init_db(db_path=None):
    """Initialize database tables and run migrations using ``database.DB_PATH``.

    Syncs ``connection.DB_PATH`` before delegating, so monkeypatching
    ``database.DB_PATH`` works correctly.
    """
    if db_path is None:
        db_path = DB_PATH
    _connection_module.DB_PATH = db_path
    return _migrations_init_db(db_path)


# Re-export GPU telemetry
from .gpu import (
    cleanup_old_gpu_telemetry,
    get_gpu_history,
    get_gpu_stats,
    log_gpu_telemetry,
)

# Re-export log CRUD
from .logs import (
    LOG_ANALYTICS_LAST_CLEANUP_KEY,
    cleanup_old_log_events,
    cleanup_old_system_resources,
    get_error_patterns,
    get_log_analytics_last_cleanup,
    get_log_analytics_sources,
    get_log_patterns,
    get_log_trends,
    ingest_log_file,
    set_log_analytics_last_cleanup,
)

# Re-export media CRUD
from .media import (
    _collection_row_to_dict,
    _tag_row_to_dict,
    _trash_row_to_dict,
    add_item_to_collection,
    add_tag_to_item,
    create_collection,
    create_tag,
    delete_collection,
    empty_trash,
    get_collection,
    get_collections_for_item,
    get_items_in_collection,
    get_items_with_tag,
    get_or_create_tag,
    get_tags_for_item,
    is_media_favorite,
    list_collections,
    list_media_favorites,
    list_tags,
    list_trash,
    move_to_trash,
    purge_expired_trash,
    purge_from_trash,
    remove_item_from_collection,
    remove_tag_from_item,
    restore_from_trash,
    set_item_tags,
    toggle_media_favorite,
    update_collection,
)

# Re-export migrations
from .migrations import (
    _migrate_v1,
    _migrate_v2,
    _migrate_v3,
    _migrate_v4,
    _migrate_v5,
    _migrate_v6,
    _migrate_v7,
    _migrate_v8,
    _migrate_v9,
    _migrate_v10,
    _migrate_v11,
    _migrate_v12,
    _migrate_v13,
    _migrate_v14,
    _migrate_v15,
    _migrate_v16,
    _migrate_v17,
    _migrate_v18,
    _migrate_v19,
    get_schema_version,
    set_schema_version,
)
from .migrations import (
    init_db as _migrations_init_db,
)

# Re-export models
from .models import (
    AIVisualRow,
    AudioFileRow,
    CharacterBibleRow,
    GpuTelemetryRow,
    LogEventRow,
    NativeOpenRow,
    OllamaAnalysisRow,
    OllamaModelRow,
    PromptRow,
    SessionRow,
    StudioSceneRow,
    SystemResourceRow,
    TrackRow,
    VisionOcrRow,
    VizPresetRow,
)

# Re-export native opens CRUD
from .native_opens import (
    list_native_opens,
    log_native_open,
)

# Re-export Ollama CRUD
from .ollama import (
    delete_ollama_analysis_response,
    get_available_ollama_models,
    get_ollama_analysis_response,
    get_ollama_analysis_response_typed,
    get_ollama_analysis_responses,
    list_ollama_analysis_typed,
    save_ollama_analysis_response,
    save_ollama_model,
)

# Re-export preference CRUD
from .preferences import (
    get_all_preferences,
    get_preference,
    set_preference,
)

# Re-export preset CRUD
from .presets import (
    _row_to_viz_preset,
    delete_visualization_preset,
    find_similar_preset,
    get_all_visualization_presets,
    get_visualization_preset,
    increment_visualization_preset_usage,
    save_visualization_preset,
)

# Re-export prompt CRUD
from .prompts import (
    _row_to_prompt,
    delete_prompt,
    get_prompt,
    get_prompts,
    increment_prompt_use,
    save_prompt,
    toggle_prompt_favorite,
)

# Re-export session CRUD
from .sessions import (
    _row_to_session,
    get_session,
    get_sessions,
    save_session,
    update_session,
)

# Re-export studio CRUD
from .studio import (
    list_character_bibles,
    list_studio_scenes,
    save_character_bible,
    save_studio_scene,
)

# Re-export track CRUD
from .tracks import (
    _row_to_track,
    delete_track,
    get_track,
    get_tracks,
    save_track,
    update_track,
)

# Re-export vision CRUD
from .vision import (
    list_vision_ocr,
    save_vision_ocr,
)

# Re-export visuals CRUD
from .visuals import (
    _row_to_visual,
    get_ai_visuals,
    save_ai_visual,
    set_visual_selected,
    toggle_visual_favorite,
)

# Re-export typed accessors for backwards compatibility

__all__ = [
    # connection
    "BUSY_TIMEOUT_MS",
    "DB_PATH",
    "MAX_POOLED_CONNECTIONS",
    "SCHEMA_VERSION",
    "_local",
    "async_get_db",
    "checkpoint_wal",
    "close_pooled_connections",
    "get_connection",
    "get_connection_unpooled",
    "get_db",
    "release_connection",
    "run_db_sync",
    "safe_vacuum",
    # migrations
    "_migrate_v1",
    "_migrate_v10",
    "_migrate_v11",
    "_migrate_v12",
    "_migrate_v13",
    "_migrate_v14",
    "_migrate_v15",
    "_migrate_v16",
    "_migrate_v17",
    "_migrate_v18",
    "_migrate_v19",
    "get_schema_version",
    "init_db",
    "set_schema_version",
    "_migrate_v2",
    "_migrate_v3",
    "_migrate_v4",
    "_migrate_v5",
    "_migrate_v6",
    "_migrate_v7",
    "_migrate_v8",
    "_migrate_v9",
    # models
    "AIVisualRow",
    "AudioFileRow",
    "CharacterBibleRow",
    "GpuTelemetryRow",
    "LogEventRow",
    "NativeOpenRow",
    "OllamaAnalysisRow",
    "OllamaModelRow",
    "PromptRow",
    "SessionRow",
    "StudioSceneRow",
    "SystemResourceRow",
    "TrackRow",
    "VisionOcrRow",
    "VizPresetRow",
    # media
    "_collection_row_to_dict",
    "_tag_row_to_dict",
    "_trash_row_to_dict",
    "add_item_to_collection",
    "add_tag_to_item",
    "create_collection",
    "create_tag",
    "delete_collection",
    "empty_trash",
    "get_collection",
    "get_collections_for_item",
    "get_items_in_collection",
    "get_items_with_tag",
    "get_or_create_tag",
    "get_tags_for_item",
    "is_media_favorite",
    "list_collections",
    "list_media_favorites",
    "list_tags",
    "list_trash",
    "move_to_trash",
    "purge_expired_trash",
    "purge_from_trash",
    "remove_item_from_collection",
    "remove_tag_from_item",
    "restore_from_trash",
    "set_item_tags",
    "toggle_media_favorite",
    "update_collection",
    # audio
    "_row_to_audio",
    "get_audio_analysis",
    "get_audio_analysis_field",
    "get_audio_file",
    "get_audio_files",
    "get_audio_files_for_dedup",
    "save_audio_file",
    "search_audio_by_analysis",
    "set_audio_content_hash",
    "set_audio_duplicate_of",
    "update_audio_analysis",
    # prompts
    "_row_to_prompt",
    "delete_prompt",
    "get_prompt",
    "get_prompts",
    "increment_prompt_use",
    "save_prompt",
    "toggle_prompt_favorite",
    # sessions
    "_row_to_session",
    "get_session",
    "get_sessions",
    "save_session",
    "update_session",
    # tracks
    "_row_to_track",
    "delete_track",
    "get_track",
    "get_tracks",
    "save_track",
    "update_track",
    # visuals
    "_row_to_visual",
    "get_ai_visuals",
    "save_ai_visual",
    "set_visual_selected",
    "toggle_visual_favorite",
    # presets
    "_row_to_viz_preset",
    "delete_visualization_preset",
    "find_similar_preset",
    "get_all_visualization_presets",
    "get_visualization_preset",
    "increment_visualization_preset_usage",
    "save_visualization_preset",
    # logs
    "LOG_ANALYTICS_LAST_CLEANUP_KEY",
    "cleanup_old_log_events",
    "cleanup_old_system_resources",
    "get_error_patterns",
    "get_log_analytics_last_cleanup",
    "get_log_analytics_sources",
    "get_log_patterns",
    "get_log_trends",
    "ingest_log_file",
    "set_log_analytics_last_cleanup",
    # gpu
    "cleanup_old_gpu_telemetry",
    "get_gpu_history",
    "get_gpu_stats",
    "log_gpu_telemetry",
    # ollama
    "delete_ollama_analysis_response",
    "get_available_ollama_models",
    "get_ollama_analysis_response",
    "get_ollama_analysis_response_typed",
    "get_ollama_analysis_responses",
    "list_ollama_analysis_typed",
    "save_ollama_analysis_response",
    "save_ollama_model",
    # studio
    "list_character_bibles",
    "list_studio_scenes",
    "save_character_bible",
    "save_studio_scene",
    # vision
    "list_vision_ocr",
    "save_vision_ocr",
    # preferences
    "get_all_preferences",
    "get_preference",
    "set_preference",
    # benchmark
    "delete_benchmark_results",
    "get_benchmark_result",
    "insert_benchmark_result",
    "list_benchmark_results",
    # native_opens
    "list_native_opens",
    "log_native_open",
]
