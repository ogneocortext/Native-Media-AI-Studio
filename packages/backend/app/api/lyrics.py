"""
Lyrics Management API.

Provides CRUD operations for timed lyrics stored in the database.
Lyrics are attached to tracks and support word-level timestamps
for karaoke-style synchronization.
"""

import json
import logging
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..core.database import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/lyrics", tags=["Lyrics"])


# =============================================================================
# Data Models
# =============================================================================

class LyricWordInput(BaseModel):
    word: str
    start_time: float
    end_time: float


class LyricAnimationInput(BaseModel):
    enter: dict = {}
    exit: dict = {}
    loop: dict = {}
    beatReact: dict = {}
    style: dict = {}


class LyricTransitionInput(BaseModel):
    type: str = "dissolve"
    duration: float = 0.3
    easing: str = "easeInOut"


class LyricLineInput(BaseModel):
    start_time: float
    end_time: float
    text: str
    section: str = ""
    words: list[LyricWordInput] = []
    animation: LyricAnimationInput | None = None
    transition: LyricTransitionInput | None = None


class LyricsInput(BaseModel):
    """Full lyrics data for a track."""
    lines: list[LyricLineInput]
    source: str = "manual"  # manual, lrc_import, transcription


class LRCImportRequest(BaseModel):
    """Import from LRC format text."""
    track_id: str
    lrc_content: str


# =============================================================================
# API Endpoints
# =============================================================================

@router.get("/track/{track_id}")
async def get_lyrics(track_id: str):
    """Get all lyric lines for a track, ordered by start time."""
    with get_db() as conn:
        # Verify track exists
        track = conn.execute("SELECT id, title, artist FROM tracks WHERE id = ?", (track_id,)).fetchone()
        if not track:
            raise HTTPException(404, "Track not found")

        lines = conn.execute(
            """
            SELECT id, start_time, end_time, text, section, sort_order, data
            FROM lyrics_lines
            WHERE track_id = ?
            ORDER BY sort_order, start_time
            """,
            (track_id,),
        ).fetchall()

        result = []
        for line in lines:
            words = conn.execute(
                """
                SELECT word, start_time, end_time
                FROM lyrics_words
                WHERE line_id = ?
                ORDER BY sort_order
                """,
                (line["id"],),
            ).fetchall()

            # Parse animation data from JSON
            animation_data = {}
            if line["data"]:
                try:
                    import json
                    animation_data = json.loads(line["data"])
                except (json.JSONDecodeError, TypeError):
                    pass

            result.append({
                "id": line["id"],
                "start_time": line["start_time"],
                "end_time": line["end_time"],
                "text": line["text"],
                "section": line["section"],
                "sort_order": line["sort_order"],
                "animation": animation_data.get("animation", {}),
                "transition": animation_data.get("transition", {}),
                "words": [
                    {"word": w["word"], "start_time": w["start_time"], "end_time": w["end_time"]}
                    for w in words
                ],
            })

        return {
            "track_id": track_id,
            "title": track["title"],
            "artist": track["artist"],
            "lines": result,
            "total_lines": len(result),
        }


@router.post("/track/{track_id}")
async def save_lyrics(track_id: str, lyrics: LyricsInput):
    """Save lyrics for a track. Replaces all existing lyrics."""
    import json

    with get_db() as conn:
        # Verify track exists
        track = conn.execute("SELECT id FROM tracks WHERE id = ?", (track_id,)).fetchone()
        if not track:
            raise HTTPException(404, "Track not found")

        # Delete existing lyrics for this track
        conn.execute("DELETE FROM lyrics_lines WHERE track_id = ?", (track_id,))

        # Insert new lyrics
        now = datetime.now().isoformat()
        for i, line in enumerate(lyrics.lines):
            line_id = str(uuid.uuid4())
            # Store animation and transition in the data column
            data = json.dumps({
                "animation": line.animation,
                "transition": line.transition,
            })
            conn.execute(
                """
                INSERT INTO lyrics_lines (id, track_id, start_time, end_time, text, section, sort_order, data, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (line_id, track_id, line.start_time, line.end_time, line.text, line.section, i, data, now, now),
            )

            # Insert words if provided
            for j, word in enumerate(line.words):
                word_id = str(uuid.uuid4())
                conn.execute(
                    """
                    INSERT INTO lyrics_words (id, line_id, word, start_time, end_time, sort_order)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (word_id, line_id, word.word, word.start_time, word.end_time, j),
                )

        return {"status": "saved", "track_id": track_id, "lines_count": len(lyrics.lines)}


@router.delete("/track/{track_id}")
async def delete_lyrics(track_id: str):
    """Delete all lyrics for a track."""
    with get_db() as conn:
        conn.execute("DELETE FROM lyrics_lines WHERE track_id = ?", (track_id,))
        return {"status": "deleted", "track_id": track_id}


@router.post("/import-lrc")
async def import_lrc(request: LRCImportRequest):
    """Import lyrics from LRC format text."""
    from ..services.lyricsParser import parse_lrc_to_lines

    lines = parse_lrc_to_lines(request.lrc_content)
    if not lines:
        raise HTTPException(400, "No valid LRC data found")

    with get_db() as conn:
        # Verify track exists
        track = conn.execute("SELECT id FROM tracks WHERE id = ?", (request.track_id,)).fetchone()
        if not track:
            raise HTTPException(404, "Track not found")

        # Delete existing lyrics
        conn.execute("DELETE FROM lyrics_lines WHERE track_id = ?", (request.track_id,))

        # Insert new lyrics
        now = datetime.now().isoformat()
        for i, line in enumerate(lines):
            line_id = str(uuid.uuid4())
            conn.execute(
                """
                INSERT INTO lyrics_lines (id, track_id, start_time, end_time, text, section, sort_order, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (line_id, request.track_id, line["start_time"], line["end_time"], line["text"], line.get("section", ""), i, now, now),
            )

        return {"status": "imported", "track_id": request.track_id, "lines_count": len(lines)}


@router.get("/track/{track_id}/lrc")
async def export_lrc(track_id: str):
    """Export lyrics in LRC format."""
    with get_db() as conn:
        track = conn.execute("SELECT title FROM tracks WHERE id = ?", (track_id,)).fetchone()
        if not track:
            raise HTTPException(404, "Track not found")

        lines = conn.execute(
            """
            SELECT start_time, end_time, text
            FROM lyrics_lines
            WHERE track_id = ?
            ORDER BY sort_order, start_time
            """,
            (track_id,),
        ).fetchall()

        # Generate LRC format
        lrc_lines = [f"[ti:{track['title']}]", ""]
        for line in lines:
            mins = int(line["start_time"] // 60)
            secs = line["start_time"] % 60
            lrc_lines.append(f"[{mins:02d}:{secs:05.2f}] {line['text']}")

        return {"lrc": "\n".join(lrc_lines), "format": "lrc"}


@router.get("/tracks-with-lyrics")
async def get_tracks_with_lyrics():
    """Get all tracks that have lyrics stored."""
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT t.id, t.title, t.artist, t.filename, t.duration_seconds,
                   COUNT(ll.id) as lyric_count
            FROM tracks t
            INNER JOIN lyrics_lines ll ON t.id = ll.track_id
            GROUP BY t.id
            ORDER BY t.artist, t.title
            """
        ).fetchall()

        return [
            {
                "id": row["id"],
                "title": row["title"],
                "artist": row["artist"],
                "filename": row["filename"],
                "duration_seconds": row["duration_seconds"],
                "lyric_count": row["lyric_count"],
            }
            for row in rows
        ]


# =============================================================================
# Visual Preset API
# =============================================================================

@router.get("/visual-preset/{track_id}")
async def get_visual_preset(track_id: str):
    """Get visual preset for a track."""
    import json

    with get_db() as conn:
        track = conn.execute(
            "SELECT visual_style FROM tracks WHERE id = ?", (track_id,)
        ).fetchone()
        if not track:
            raise HTTPException(404, "Track not found")

        if track["visual_style"]:
            try:
                return json.loads(track["visual_style"])
            except (json.JSONDecodeError, TypeError):
                pass
        return {}


@router.post("/visual-preset/{track_id}")
async def save_visual_preset(track_id: str, preset: dict):
    """Save visual preset for a track."""
    import json

    with get_db() as conn:
        track = conn.execute("SELECT id FROM tracks WHERE id = ?", (track_id,)).fetchone()
        if not track:
            raise HTTPException(404, "Track not found")

        conn.execute(
            "UPDATE tracks SET visual_style = ?, updated_at = ? WHERE id = ?",
            (json.dumps(preset), datetime.now().isoformat(), track_id),
        )
        return {"status": "saved"}


@router.get("/by-filename/{filename:path}")
async def get_lyrics_by_filename(filename: str):
    """Get lyrics for a track by its filename."""
    import re

    with get_db() as conn:
        # Try exact match first
        track = conn.execute(
            "SELECT id FROM tracks WHERE filename = ? ORDER BY created_at DESC LIMIT 1",
            (filename,),
        ).fetchone()

        if not track:
            # Try matching without hash prefix (e.g., "e02f6ccf_OriginalName.mp3" -> "OriginalName.mp3")
            clean_name = re.sub(r'^[0-9a-f]{8}_', '', filename)
            track = conn.execute(
                "SELECT id FROM tracks WHERE filename = ? ORDER BY created_at DESC LIMIT 1",
                (clean_name,),
            ).fetchone()

        if not track:
            # Try partial match (filename contains the track name)
            track = conn.execute(
                "SELECT id FROM tracks WHERE ? LIKE '%' || filename || '%' ORDER BY created_at DESC LIMIT 1",
                (filename,),
            ).fetchone()

        if not track:
            raise HTTPException(404, "Track not found")

        # Return lyrics for this track
        return await get_lyrics(track["id"])
