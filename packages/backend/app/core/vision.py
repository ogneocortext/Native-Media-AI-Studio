"""
Vision OCR Results Repository.

Extracted from packages/backend/app/core/database.py (was 4121 lines).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime

from .connection import get_db


@dataclass
class VisionOcrRow:
    id: str
    relative_path: str
    filename: str
    ocr_text: str
    model: str
    prompt: str
    file_type: str | None
    size_bytes: int | None
    created_at: str


def save_vision_ocr(
    relative_path: str,
    filename: str,
    ocr_text: str,
    model: str,
    prompt: str,
    file_type: str | None = None,
    size_bytes: int | None = None,
) -> str:
    vid = str(uuid.uuid4())
    now = datetime.now().isoformat()
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO vision_ocr_results (id, relative_path, filename, ocr_text, model, prompt, file_type, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (vid, relative_path, filename, ocr_text, model, prompt, file_type, size_bytes, now),
        )
    return vid


def get_vision_ocr(relative_path: str) -> dict | None:
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM vision_ocr_results WHERE relative_path = ? ORDER BY created_at DESC LIMIT 1",
            (relative_path,),
        ).fetchone()
        if row:
            return dict(row)
    return None


def list_vision_ocr(limit: int = 50) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM vision_ocr_results ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]
