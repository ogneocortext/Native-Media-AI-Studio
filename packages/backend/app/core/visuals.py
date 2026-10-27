"""
AI Visual Repository.

Extracted from packages/backend/app/core/database.py (was 4121 lines).
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime
from typing import Any

from .connection import get_db


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
