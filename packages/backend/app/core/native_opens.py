"""
Native App Opens Repository — audit trail for Blender/Unity handoffs.

Extracted from packages/backend/app/core/database.py (was 4121 lines).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime

from .connection import get_db


@dataclass
class NativeOpenRow:
    id: str
    relative_path: str
    filename: str
    app: str
    method: str | None
    success: bool
    created_at: str


def log_native_open(
    relative_path: str,
    filename: str,
    app: str,
    method: str | None = None,
    success: bool = True,
) -> str:
    nid = str(uuid.uuid4())
    now = datetime.now().isoformat()
    with get_db() as conn:
        conn.execute(
            "INSERT INTO native_app_opens (id, relative_path, filename, app, method, success, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (nid, relative_path, filename, app, method, int(success), now),
        )
    return nid


def list_native_opens(app: str | None = None, limit: int = 50) -> list[dict]:
    with get_db() as conn:
        if app:
            rows = conn.execute(
                "SELECT * FROM native_app_opens WHERE app = ? ORDER BY created_at DESC LIMIT ?",
                (app, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM native_app_opens ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
        return [dict(r) for r in rows]
