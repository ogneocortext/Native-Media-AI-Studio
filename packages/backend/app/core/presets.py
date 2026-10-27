"""
Visualization Preset Repository.

Extracted from packages/backend/app/core/database.py (was 4121 lines).
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime
from typing import Any

from .connection import get_db


def save_visualization_preset(preset: dict) -> str:
    """Save a visualization preset to the database."""
    preset_id = preset.get("id", str(uuid.uuid4()))
    now = datetime.now().isoformat()

    with get_db() as conn:
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
            return _row_to_viz_preset(row)
    return None


def increment_visualization_preset_usage(preset_id: str) -> None:
    """Increment usage count for a visualization preset."""
    with get_db() as conn:
        conn.execute(
            "UPDATE visualization_presets SET usage_count = usage_count + 1, last_used = ? WHERE id = ?",
            (datetime.now().isoformat(), preset_id),
        )


def delete_visualization_preset(preset_id: str) -> bool:
    """Delete a visualization preset. Returns True if deleted."""
    with get_db() as conn:
        cursor = conn.execute(
            "DELETE FROM visualization_presets WHERE id = ?", (preset_id,)
        )
        return cursor.rowcount > 0


def get_all_visualization_presets() -> list[dict]:
    """Get all visualization presets."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM visualization_presets ORDER BY usage_count DESC, created_at DESC LIMIT 500"
        ).fetchall()
        return [_row_to_viz_preset(row) for row in rows]


def find_similar_preset(
    track_name: str, mood_tags: list, genre_tags: list
) -> dict | None:
    """Find a similar preset based on track characteristics."""
    if not mood_tags and not genre_tags:
        return None

    with get_db() as conn:
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


def _safe_json_loads(val: str | None, default: Any = None) -> Any:
    """Safely parse JSON string, returning default on error."""
    if not val:
        return default if default is not None else {}
    try:
        return json.loads(val)
    except (json.JSONDecodeError, TypeError):
        return default if default is not None else {}
