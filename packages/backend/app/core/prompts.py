"""
Prompt Repository.

Extracted from packages/backend/app/core/database.py (was 4121 lines).
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime
from typing import Any

from .connection import get_db


def save_prompt(
    name: str,
    prompt_type: str,
    text: str,
    tags: list[str] | None = None,
    category: str = "",
    description: str = "",
) -> str:
    """Save a prompt and return its ID."""
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
