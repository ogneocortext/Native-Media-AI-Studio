"""
Generation Session Repository.

Extracted from packages/backend/app/core/database.py (was 4121 lines).
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime
from typing import Any

from .connection import get_db


def save_session(
    audio_id: str | None = None,
    music_prompt_id: str | None = None,
    config: dict[str, Any] | None = None,
) -> str:
    """Create a generation session and return its ID."""
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


def update_session(session_id: str, **kwargs: Any) -> None:
    """Update a generation session."""
    allowed_fields = {
        "status", "config", "selected_visuals", "output_path",
        "total_frames", "generated_frames", "estimated_time_seconds",
        "actual_time_seconds", "completed_at",
    }

    updates = {k: v for k, v in kwargs.items() if k in allowed_fields}
    if not updates:
        return

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
