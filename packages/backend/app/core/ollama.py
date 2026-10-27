"""
Ollama Models and Analysis Repository.

Extracted from packages/backend/app/core/database.py (was 4121 lines).
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime
from typing import Any

from .connection import get_db
from .models import OllamaAnalysisRow


def save_ollama_model(model: dict) -> None:
    """Save or update Ollama model info."""
    with get_db() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO ollama_models
            (id, model_name, model_size, model_digest, is_tool_capable,
             vram_required, last_checked, is_available, capabilities)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                model.get("id", model.get("model_name")),
                model.get("model_name"),
                model.get("model_size"),
                model.get("model_digest"),
                model.get("is_tool_capable", False),
                model.get("vram_required"),
                datetime.now().isoformat(),
                model.get("is_available", True),
                json.dumps(model.get("capabilities", [])),
            ),
        )


def get_available_ollama_models(min_vram_free: int = 0) -> list[dict]:
    """Get available Ollama models filtered by VRAM requirements."""
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT * FROM ollama_models
            WHERE is_available = 1 AND vram_required <= ?
            ORDER BY is_tool_capable DESC, vram_required ASC
            """,
            (min_vram_free,),
        ).fetchall()

        return [
            {
                "id": row["id"],
                "model_name": row["model_name"],
                "model_size": row["model_size"],
                "model_digest": row["model_digest"],
                "is_tool_capable": row["is_tool_capable"],
                "vram_required": row["vram_required"],
                "last_checked": row["last_checked"],
                "is_available": row["is_available"],
                "capabilities": json.loads(row["capabilities"]) if row["capabilities"] else [],
            }
            for row in rows
        ]


def save_ollama_analysis_response(
    track_name: str,
    html_response: str,
    raw_response: str = "",
    track_filename: str = "",
    model_name: str = "",
    prompt: str = "",
    lyrics: str = "",
    bpm: int = 0,
    status: str = "completed",
) -> str:
    """Save an Ollama analysis response and return its ID."""
    response_id = str(uuid.uuid4())
    now = datetime.now().isoformat()

    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO ollama_analysis_responses
            (id, track_name, track_filename, model_name, prompt, lyrics, bpm,
             html_response, raw_response, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                response_id,
                track_name,
                track_filename,
                model_name,
                prompt,
                lyrics,
                bpm,
                html_response,
                raw_response,
                status,
                now,
            ),
        )

    return response_id


def get_ollama_analysis_responses(
    track_name: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Get Ollama analysis responses, optionally filtered by track name."""
    with get_db() as conn:
        if track_name:
            rows = conn.execute(
                """
                SELECT * FROM ollama_analysis_responses
                WHERE track_name = ?
                ORDER BY created_at DESC LIMIT ?
                """,
                (track_name, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT * FROM ollama_analysis_responses
                ORDER BY created_at DESC LIMIT ?
                """,
                (limit,),
            ).fetchall()

        return [
            {
                "id": row["id"],
                "track_name": row["track_name"],
                "track_filename": row["track_filename"],
                "model_name": row["model_name"],
                "prompt": row["prompt"],
                "lyrics": row["lyrics"],
                "bpm": row["bpm"],
                "html_response": row["html_response"],
                "raw_response": row["raw_response"],
                "status": row["status"],
                "created_at": row["created_at"],
            }
            for row in rows
        ]


def get_ollama_analysis_response(response_id: str) -> dict[str, Any] | None:
    """Get a single Ollama analysis response by ID."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM ollama_analysis_responses WHERE id = ?",
            (response_id,),
        ).fetchone()
        if row:
            return {
                "id": row["id"],
                "track_name": row["track_name"],
                "track_filename": row["track_filename"],
                "model_name": row["model_name"],
                "prompt": row["prompt"],
                "lyrics": row["lyrics"],
                "bpm": row["bpm"],
                "html_response": row["html_response"],
                "raw_response": row["raw_response"],
                "status": row["status"],
                "created_at": row["created_at"],
            }
    return None


def delete_ollama_analysis_response(response_id: str) -> bool:
    """Delete an Ollama analysis response. Returns True if deleted."""
    with get_db() as conn:
        cursor = conn.execute(
            "DELETE FROM ollama_analysis_responses WHERE id = ?",
            (response_id,),
        )
        return cursor.rowcount > 0


def get_ollama_analysis_response_typed(response_id: str) -> OllamaAnalysisRow | None:
    """Get a single Ollama analysis response by ID as a typed row."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM ollama_analysis_responses WHERE id = ?",
            (response_id,),
        ).fetchone()
        if row:
            return _row_to_ollama_analysis_typed(row)
    return None


def list_ollama_analysis_typed(
    track_name: str | None = None, limit: int = 50
) -> list[OllamaAnalysisRow]:
    """List Ollama analysis responses as typed rows."""
    with get_db() as conn:
        if track_name:
            rows = conn.execute(
                "SELECT * FROM ollama_analysis_responses WHERE track_name = ? ORDER BY created_at DESC LIMIT ?",
                (track_name, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM ollama_analysis_responses ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [_row_to_ollama_analysis_typed(row) for row in rows]


def _row_to_ollama_analysis_typed(row: sqlite3.Row) -> OllamaAnalysisRow:
    """Convert an ollama_analysis_responses row to a typed OllamaAnalysisRow."""
    return OllamaAnalysisRow(
        id=row["id"],
        track_name=row["track_name"],
        track_filename=row["track_filename"],
        model_name=row["model_name"],
        prompt=row["prompt"],
        lyrics=row["lyrics"],
        bpm=row["bpm"],
        html_response=row["html_response"],
        raw_response=row["raw_response"],
        status=row["status"],
        created_at=row["created_at"],
    )
