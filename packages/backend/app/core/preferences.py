"""
User Preferences Repository.

Extracted from packages/backend/app/core/database.py (was 4121 lines).
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from .connection import get_db


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
            rows = conn.execute("SELECT key, value FROM user_preferences").fetchall()
        result: dict[str, Any] = {}
        for row in rows:
            try:
                result[row["key"]] = json.loads(row["value"])
            except (json.JSONDecodeError, TypeError):
                import logging as _logging

                _logging.warning("Skipping corrupted preference key=%s", row["key"])
                result[row["key"]] = None
        return result
