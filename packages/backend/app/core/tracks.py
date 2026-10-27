"""
Track Repository.

Extracted from packages/backend/app/core/database.py (was 4121 lines).
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime
from typing import Any

from .connection import get_db


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
    """Save a track and return its ID.

    If a track with the same filename already exists, returns the existing ID
    instead of creating a duplicate entry.
    """
    with get_db() as conn:
        existing = conn.execute(
            "SELECT id FROM tracks WHERE filename = ?", (filename,)
        ).fetchone()
        if existing:
            return existing["id"]

        track_id = str(uuid.uuid4())
        now = datetime.now().isoformat()

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


def update_track(track_id: str, **kwargs: Any) -> None:
    """Update a track."""
    allowed_fields = {
        "music_prompt", "lyrics", "visual_style", "visual_prompt",
        "status", "tags", "comfyui_visual_ids", "output_path",
    }

    updates = {k: v for k, v in kwargs.items() if k in allowed_fields}
    if not updates:
        return

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


def _safe_json_loads(val: str | None, default: Any = None) -> Any:
    """Safely parse JSON string, returning default on error."""
    if not val:
        return default if default is not None else {}
    try:
        return json.loads(val)
    except (json.JSONDecodeError, TypeError):
        return default if default is not None else {}
