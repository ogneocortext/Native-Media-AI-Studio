"""
Prompt Repository.

Extracted from packages/backend/app/core/database.py (was 4121 lines).
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from .connection import get_db

if TYPE_CHECKING:
    import sqlite3


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
        row = conn.execute("SELECT * FROM prompts WHERE id = ?", (prompt_id,)).fetchone()
        if row:
            return _row_to_prompt(row)
    return None


def get_prompts(
    prompt_type: str | None = None,
    category: str | None = None,
    *,
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
        row = conn.execute("SELECT is_favorite FROM prompts WHERE id = ?", (prompt_id,)).fetchone()
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
# Prompt History Repository (version history + repair log)
#
# Restored after the database.py split dropped these along with the v14
# migration; /api/data/prompt-history* 500'd on the missing attributes.
# =============================================================================


def _safe_json_loads(val: str | None, default: Any = None) -> Any:
    """Safely parse JSON string, returning default on error."""
    if not val:
        return default if default is not None else {}
    try:
        return json.loads(val)
    except (json.JSONDecodeError, TypeError):
        return default if default is not None else {}


def save_prompt_version(entry: dict) -> dict:
    """Insert one prompt-history row and return the stored record.

    `version` auto-increments within the (track_filename, section) scope
    unless the caller pins it explicitly.
    """
    pid = entry.get("id") or str(uuid.uuid4())
    track = entry.get("track_filename", "")
    section = entry.get("section", "full")
    now = datetime.now().isoformat()

    with get_db() as conn:
        if entry.get("version"):
            version = int(entry["version"])
        else:
            row = conn.execute(
                "SELECT COALESCE(MAX(version), 0) AS v FROM prompt_history "
                "WHERE track_filename = ? AND section = ?",
                (track, section),
            ).fetchone()
            version = int(row["v"]) + 1
        conn.execute(
            """
            INSERT INTO prompt_history (
                id, track_filename, section, section_index, prompt, negative_prompt,
                parent_id, version, action, repair_reason, failure_notes,
                generation_params, outcome, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                pid,
                track,
                section,
                int(entry.get("section_index", -1) or -1),
                entry.get("prompt", ""),
                entry.get("negative_prompt", ""),
                entry.get("parent_id"),
                version,
                entry.get("action", "create"),
                entry.get("repair_reason", ""),
                entry.get("failure_notes", ""),
                json.dumps(entry.get("generation_params") or {}, ensure_ascii=False),
                entry.get("outcome", "draft"),
                now,
            ),
        )
    return {
        "id": pid, "track_filename": track, "section": section,
        "section_index": int(entry.get("section_index", -1) or -1),
        "prompt": entry.get("prompt", ""),
        "negative_prompt": entry.get("negative_prompt", ""),
        "parent_id": entry.get("parent_id"),
        "version": version,
        "action": entry.get("action", "create"),
        "repair_reason": entry.get("repair_reason", ""),
        "failure_notes": entry.get("failure_notes", ""),
        "generation_params": entry.get("generation_params") or {},
        "outcome": entry.get("outcome", "draft"),
        "created_at": now,
    }


def _history_row_to_dict(r: sqlite3.Row) -> dict:
    return {
        "id": r["id"], "track_filename": r["track_filename"],
        "section": r["section"], "section_index": r["section_index"],
        "prompt": r["prompt"], "negative_prompt": r["negative_prompt"],
        "parent_id": r["parent_id"], "version": r["version"],
        "action": r["action"], "repair_reason": r["repair_reason"],
        "failure_notes": r["failure_notes"],
        "generation_params": _safe_json_loads(r["generation_params"], {}),
        "outcome": r["outcome"], "created_at": r["created_at"],
    }


def get_prompt_history(
    track_filename: str | None = None,
    section: str | None = None,
    limit: int = 100,
) -> list[dict]:
    """List prompt-history entries, newest first, optionally filtered."""
    q = "SELECT * FROM prompt_history WHERE 1=1"
    args: list = []
    if track_filename:
        q += " AND track_filename = ?"
        args.append(track_filename)
    if section:
        q += " AND section = ?"
        args.append(section)
    q += " ORDER BY created_at DESC, version DESC LIMIT ?"
    args.append(max(1, min(int(limit), 500)))
    with get_db() as conn:
        rows = conn.execute(q, args).fetchall()
    return [_history_row_to_dict(r) for r in rows]


def get_prompt_chain(entry_id: str) -> list[dict]:
    """Return an entry's ancestry chain (oldest ancestor → this entry).

    Guards against corrupted parent loops with a depth cap.
    """
    chain: list[dict] = []
    with get_db() as conn:
        current_id: str | None = entry_id
        guard = 0
        while current_id and guard < 200:
            guard += 1
            row = conn.execute(
                "SELECT * FROM prompt_history WHERE id = ?", (current_id,)
            ).fetchone()
            if not row:
                break
            chain.append(_history_row_to_dict(row))
            current_id = row["parent_id"]
    chain.reverse()
    return chain


def delete_prompt_history(entry_id: str) -> bool:
    """Delete one history entry (children keep parent_id as a dangling ref)."""
    with get_db() as conn:
        cur = conn.execute("DELETE FROM prompt_history WHERE id = ?", (entry_id,))
        return cur.rowcount > 0
