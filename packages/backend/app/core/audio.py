"""
Audio File Repository.

Extracted from packages/backend/app/core/database.py (was 4121 lines).
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from .connection import get_db


def save_audio_file(
    filename: str,
    original_name: str,
    stored_path: str,
    file_size: int = 0,
    duration: float = 0.0,
    display_name: str | None = None,
    **kwargs: Any,
) -> str:
    """Save audio file metadata and return its ID.

    If a file with the same filename already exists, returns the existing ID
    instead of creating a duplicate entry.
    """
    with get_db() as conn:
        existing = conn.execute(
            "SELECT id FROM audio_files WHERE filename = ?", (filename,)
        ).fetchone()
        if existing:
            return existing["id"]

        audio_id = str(uuid.uuid4())
        now = datetime.now().isoformat()

        try:
            conn.execute(
                """
                INSERT INTO audio_files
                (id, filename, original_name, stored_path, file_size, duration,
                 sample_rate, channels, format, bpm, key, genre, music_prompt_id,
                 analysis_result, display_name, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    audio_id,
                    filename,
                    original_name,
                    stored_path,
                    file_size,
                    duration,
                    kwargs.get("sample_rate", 44100),
                    kwargs.get("channels", 2),
                    kwargs.get("format", ""),
                    kwargs.get("bpm"),
                    kwargs.get("key"),
                    kwargs.get("genre"),
                    kwargs.get("music_prompt_id"),
                    json.dumps(kwargs.get("analysis_result", {})),
                    display_name,
                    now,
                ),
            )
        except sqlite3.IntegrityError:
            row = conn.execute(
                "SELECT id FROM audio_files WHERE filename = ?", (filename,)
            ).fetchone()
            if row:
                return row["id"]
            raise

    return audio_id


def get_audio_file(audio_id: str) -> dict[str, Any] | None:
    """Get audio file metadata by ID."""
    with get_db() as conn:
        row = conn.execute("SELECT * FROM audio_files WHERE id = ?", (audio_id,)).fetchone()
        if row:
            return _row_to_audio(row)
    return None


def get_audio_files(limit: int = 100, distinct: bool = False) -> list[dict[str, Any]]:
    """Get recent audio files."""
    with get_db() as conn:
        if distinct:
            rows = conn.execute(
                """
                SELECT a.* FROM audio_files a
                INNER JOIN (
                    SELECT filename, MAX(created_at) AS max_created
                    FROM audio_files
                    GROUP BY filename
                ) b ON a.filename = b.filename AND a.created_at = b.max_created
                ORDER BY a.created_at DESC LIMIT ?
                """,
                (limit,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM audio_files ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [_row_to_audio(row) for row in rows]


def _row_to_audio(row: sqlite3.Row) -> dict[str, Any]:
    """Convert a database row to an audio file dict."""
    return {
        "id": row["id"],
        "filename": row["filename"],
        "original_name": row["original_name"],
        "stored_path": row["stored_path"],
        "file_size": row["file_size"],
        "duration": row["duration"],
        "sample_rate": row["sample_rate"],
        "channels": row["channels"],
        "format": row["format"],
        "bpm": row["bpm"],
        "key": row["key"],
        "genre": row["genre"],
        "music_prompt_id": row["music_prompt_id"],
        "analysis_result": _safe_json_loads(row["analysis_result"], {}),
        "display_name": row["display_name"] if "display_name" in row.keys() else None,
        "created_at": row["created_at"],
    }


def update_audio_analysis(filename: str, analysis_result: dict) -> bool:
    """Update the analysis result for an audio file."""
    with get_db() as conn:
        cursor = conn.execute(
            """
            UPDATE audio_files
            SET analysis_result = ?,
                bpm = ?,
                duration = ?,
                stored_path = ?
            WHERE filename = ?
            """,
            (
                json.dumps(analysis_result),
                analysis_result.get("tempo_bpm"),
                analysis_result.get("duration_seconds"),
                analysis_result.get("stored_path", ""),
                filename,
            ),
        )
        if cursor.rowcount == 0:
            stored = analysis_result.get("stored_path", "") or ""
            size = 0
            if stored and Path(stored).is_file():
                try:
                    size = Path(stored).stat().st_size
                except OSError:
                    size = 0
            conn.execute(
                """
                INSERT INTO audio_files
                (id, filename, original_name, stored_path, file_size, analysis_result, bpm, duration, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(uuid.uuid4()),
                    filename,
                    filename,
                    stored,
                    size,
                    json.dumps(analysis_result),
                    analysis_result.get("tempo_bpm"),
                    analysis_result.get("duration_seconds"),
                    datetime.now().isoformat(),
                ),
            )
        return True


def get_audio_analysis(filename: str) -> dict | None:
    """Get analysis result for an audio file from database."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT analysis_result FROM audio_files WHERE filename = ?",
            (filename,),
        ).fetchone()
        if row and row["analysis_result"]:
            data = _safe_json_loads(row["analysis_result"], {})
            if data:
                return data
    return None


def _safe_json_loads(val: str | None, default: Any = None) -> Any:
    """Safely parse JSON string, returning default on error."""
    if not val:
        return default if default is not None else {}
    try:
        return json.loads(val)
    except (json.JSONDecodeError, TypeError):
        return default if default is not None else {}


# ---------------------------------------------------------------------------
# JSON1-powered analysis queries
# ---------------------------------------------------------------------------
#
# SQLite's JSON1 extension lets us query inside the JSON `analysis_result`
# column directly in SQL, without loading every row and parsing in Python.
# This matters on a home server with a growing library: filtering 10,000
# tracks by energy or tempo in SQL is orders of magnitude faster than
# deserializing 10,000 JSON blobs in Python.
#
# All functions below use `json_extract(analysis_result, '$.path')` so the
# database engine does the filtering. `analysis_result` is stored as TEXT,
# which JSON1 handles natively -- no schema change required.


def search_audio_by_analysis(
    *,
    min_tempo: float | None = None,
    max_tempo: float | None = None,
    min_energy: float | None = None,
    max_energy: float | None = None,
    min_sections: int | None = None,
    max_sections: int | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    """
    Search audio files by analysis-result fields using SQLite JSON1.

    Args:
        min_tempo / max_tempo: Filter by `analysis_result.tempo_bpm`.
        min_energy / max_energy: Filter by average energy curve value
            (`json_extract` on the energy curve is approximate; this uses
            the `avg_energy` key if present in the JSON).
        min_sections / max_sections: Filter by number of detected sections.
        limit: Max rows to return.

    Returns:
        List of audio file dicts (same shape as `get_audio_files`).
    """
    clauses: list[str] = []
    args: list[Any] = []

    if min_tempo is not None:
        clauses.append("json_extract(analysis_result, '$.tempo_bpm') >= ?")
        args.append(min_tempo)
    if max_tempo is not None:
        clauses.append("json_extract(analysis_result, '$.tempo_bpm') <= ?")
        args.append(max_tempo)
    if min_energy is not None:
        clauses.append("json_extract(analysis_result, '$.avg_energy') >= ?")
        args.append(min_energy)
    if max_energy is not None:
        clauses.append("json_extract(analysis_result, '$.avg_energy') <= ?")
        args.append(max_energy)
    if min_sections is not None:
        clauses.append("json_array_length(analysis_result, '$.sections') >= ?")
        args.append(min_sections)
    if max_sections is not None:
        clauses.append("json_array_length(analysis_result, '$.sections') <= ?")
        args.append(max_sections)

    where = " WHERE " + " AND ".join(clauses) if clauses else ""
    args.append(max(1, min(int(limit), 500)))

    query = "SELECT * FROM audio_files" + where + " ORDER BY created_at DESC LIMIT ?"
    with get_db() as conn:
        rows = conn.execute(query, args).fetchall()
    return [_row_to_audio(row) for row in rows]


def get_audio_analysis_field(filename: str, json_path: str, default: Any = None) -> Any:
    """
    Extract a single field from an audio file's analysis_result JSON without
    parsing the whole blob in Python.

    Args:
        filename: Audio filename.
        json_path: JSONPath expression (e.g. '$.tempo_bpm', '$.sections[0].type').
        default: Value returned if the field is absent or unparseable.

    Returns:
        The extracted JSON value, or `default`.
    """
    with get_db() as conn:
        row = conn.execute(
            """
            SELECT json_extract(analysis_result, ?) AS val
            FROM audio_files WHERE filename = ?
            """,
            (json_path, filename),
        ).fetchone()
    if row is None or row["val"] is None:
        return default
    # json_extract returns TEXT for scalars; SQLite may return int/real/TEXT
    # depending on the JSON type. Parse TEXT as JSON when it looks like a
    # nested structure.
    val = row["val"]
    if isinstance(val, str):
        try:
            return json.loads(val)
        except json.JSONDecodeError:
            return val
    return val
