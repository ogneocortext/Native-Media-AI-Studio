"""
Studio Scene and Character Bible Repository.

Extracted from packages/backend/app/core/database.py (was 4121 lines).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime

from .connection import get_db


@dataclass
class StudioSceneRow:
    id: str
    filename: str
    code: str
    track: str | None
    model: str | None
    preview_image: str | None
    created_at: str
    updated_at: str


def save_studio_scene(
    filename: str,
    code: str,
    track: str | None = None,
    model: str | None = None,
    preview_image: str | None = None,
) -> str:
    sid = str(uuid.uuid4())
    now = datetime.now().isoformat()
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO studio_scenes (id, filename, code, track, model, preview_image, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (sid, filename, code, track, model, preview_image, now, now),
        )
    return sid


def list_studio_scenes(track: str | None = None, limit: int = 50) -> list[dict]:
    with get_db() as conn:
        if track:
            rows = conn.execute(
                "SELECT * FROM studio_scenes WHERE track = ? ORDER BY updated_at DESC LIMIT ?",
                (track, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM studio_scenes ORDER BY updated_at DESC LIMIT ?", (limit,)
            ).fetchall()
        return [dict(r) for r in rows]


@dataclass
class CharacterBibleRow:
    id: str
    filename: str
    name: str | None
    notes: str | None
    seed: int | None
    prompt: str | None
    created_at: str
    updated_at: str


def save_character_bible(
    filename: str,
    name: str | None,
    notes: str | None,
    seed: int | None,
    prompt: str | None,
) -> str:
    now = datetime.now().isoformat()
    with get_db() as conn:
        existing = conn.execute(
            "SELECT id FROM character_bibles WHERE filename = ?", (filename,)
        ).fetchone()
        bid = existing["id"] if existing else str(uuid.uuid4())
        conn.execute(
            "INSERT OR REPLACE INTO character_bibles (id, filename, name, notes, seed, prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM character_bibles WHERE filename = ?), ?), ?)",
            (bid, filename, name, notes, seed, prompt, filename, now, now),
        )
        return bid


def list_character_bibles(limit: int = 100) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM character_bibles ORDER BY updated_at DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]
