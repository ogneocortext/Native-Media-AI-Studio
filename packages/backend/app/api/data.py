"""
Data persistence API routes — prompts, audio, visuals, sessions, tracks, preferences.
"""

import os

from fastapi import APIRouter, HTTPException, Query

from ..core import database

router = APIRouter(prefix="/api/data", tags=["Data"])


@router.get("/")
def list_prompts(
    prompt_type: str | None = None,
    category: str | None = None,
    favorite: bool = False,
    search: str | None = None,
    limit: int = 100,
):
    """List prompts with optional filtering."""
    return database.get_prompts(
        prompt_type=prompt_type,
        category=category,
        favorite_only=favorite,
        search=search,
        limit=limit,
    )


@router.get("/{prompt_id}")
def get_prompt(prompt_id: str):
    """Get a prompt by ID."""
    prompt = database.get_prompt(prompt_id)
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return prompt


@router.post("/")
def create_prompt(request: dict):
    """Save a new prompt."""
    prompt_id = database.save_prompt(
        name=request.get("name", ""),
        prompt_type=request.get("prompt_type", "visual_generation"),
        text=request.get("text", ""),
        tags=request.get("tags"),
        category=request.get("category", ""),
        description=request.get("description", ""),
    )
    return {"id": prompt_id, "success": True}


@router.post("/{prompt_id}/use")
def record_prompt_use(prompt_id: str):
    """Record that a prompt was used."""
    database.increment_prompt_use(prompt_id)
    return {"success": True}


@router.post("/{prompt_id}/favorite")
def toggle_favorite(prompt_id: str):
    """Toggle prompt favorite status."""
    is_fav = database.toggle_prompt_favorite(prompt_id)
    return {"is_favorite": is_fav}


@router.delete("/{prompt_id}")
def delete_prompt(prompt_id: str):
    """Delete a prompt."""
    deleted = database.delete_prompt(prompt_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return {"success": True}


@router.get("/audio/")
def list_audio_files(limit: int = 100):
    """List stored audio file metadata."""
    return database.get_audio_files(limit=limit)


@router.get("/audio/{audio_id}")
def get_audio_file(audio_id: str):
    """Get audio file metadata."""
    audio = database.get_audio_file(audio_id)
    if not audio:
        raise HTTPException(status_code=404, detail="Audio file not found")
    return audio


@router.get("/visuals/")
def list_visuals(
    style_id: str | None = None,
    favorite: bool = False,
    selected: bool = False,
    limit: int = 100,
):
    """List AI-generated visuals."""
    return database.get_ai_visuals(
        style_id=style_id,
        favorite_only=favorite,
        selected_only=selected,
        limit=limit,
    )


@router.post("/visuals/save")
def save_visual(request: dict):
    """Save AI visual metadata."""
    visual_id = database.save_ai_visual(
        style_id=request.get("style_id", ""),
        filename=request.get("filename", ""),
        stored_path=request.get("stored_path", ""),
        prompt_id=request.get("prompt_id"),
        width=request.get("width", 512),
        height=request.get("height", 512),
        steps=request.get("steps", 20),
        cfg=request.get("cfg", 7.0),
        seed=request.get("seed", 0),
        checkpoint=request.get("checkpoint", ""),
        comfyui_prompt_id=request.get("comfyui_prompt_id", ""),
        generation_time=request.get("generation_time", 0.0),
        tags=request.get("tags"),
    )
    return {"id": visual_id, "success": True}


@router.post("/visuals/{visual_id}/favorite")
def toggle_visual_favorite(visual_id: str):
    """Toggle visual favorite status."""
    is_fav = database.toggle_visual_favorite(visual_id)
    return {"is_favorite": is_fav}


@router.post("/visuals/{visual_id}/select")
def select_visual(visual_id: str, selected: bool = True):
    """Set whether a visual is selected for the music video."""
    database.set_visual_selected(visual_id, selected)
    return {"success": True}


@router.get("/sessions/")
def list_sessions(
    status: str | None = None,
    audio_id: str | None = None,
    limit: int = 50,
):
    """List generation sessions."""
    return database.get_sessions(status=status, audio_id=audio_id, limit=limit)


@router.post("/sessions/")
def create_session(request: dict):
    """Create a generation session."""
    session_id = database.save_session(
        audio_id=request.get("audio_id"),
        music_prompt_id=request.get("music_prompt_id"),
        config=request.get("config"),
    )
    return {"id": session_id, "success": True}


@router.get("/sessions/{session_id}")
def get_session(session_id: str):
    """Get a generation session."""
    session = database.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.patch("/sessions/{session_id}")
def update_session(session_id: str, request: dict):
    """Update a generation session."""
    database.update_session(session_id, **request)
    return {"success": True}


@router.get("/preferences/")
def get_preferences(category: str | None = None):
    """Get user preferences."""
    return database.get_all_preferences(category=category)


@router.put("/preferences/{key}")
def set_preference(key: str, request: dict):
    """Set a user preference."""
    database.set_preference(
        key=key,
        value=request.get("value"),
        category=request.get("category", "general"),
    )
    return {"success": True}


# =============================================================================
# Tracks API
# =============================================================================


@router.get("/tracks/")
def list_tracks(
    status: str | None = None,
    artist: str | None = None,
    search: str | None = None,
    limit: int = 100,
):
    """List tracks with optional filtering."""
    return database.get_tracks(status=status, artist=artist, search=search, limit=limit)


@router.get("/tracks/{track_id}")
def get_track(track_id: str):
    """Get a track by ID."""
    track = database.get_track(track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")
    return track


@router.post("/tracks/")
def create_track(request: dict):
    """Create a new track record."""
    track_id = database.save_track(
        filename=request.get("filename", ""),
        title=request.get("title", ""),
        artist=request.get("artist", ""),
        duration_seconds=request.get("duration_seconds", 0),
        size_mb=request.get("size_mb", 0),
        source_path=request.get("source_path", ""),
        music_prompt=request.get("music_prompt", ""),
        lyrics=request.get("lyrics", ""),
        visual_style=request.get("visual_style", ""),
        visual_prompt=request.get("visual_prompt", ""),
        tags=request.get("tags"),
    )
    return {"id": track_id, "success": True}


@router.patch("/tracks/{track_id}")
def update_track(track_id: str, request: dict):
    """Update a track."""
    database.update_track(track_id, **request)
    return {"success": True}


@router.delete("/tracks/{track_id}")
def delete_track(track_id: str):
    """Delete a track."""
    deleted = database.delete_track(track_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Track not found")
    return {"success": True}


@router.post("/tracks/import")
def import_tracks(request: dict):
    """Import tracks from a directory."""
    directory = request.get("directory", "")
    if not directory or not os.path.isdir(directory):
        raise HTTPException(status_code=400, detail="Invalid directory")

    imported = []
    for filename in sorted(os.listdir(directory)):
        if filename.lower().endswith(".mp3"):
            filepath = os.path.join(directory, filename)
            size = os.path.getsize(filepath)

            # Try to get duration
            duration = 0
            try:
                from mutagen.mp3 import MP3
                audio = MP3(filepath)
                duration = audio.info.length
            except Exception:
                pass

            # Parse artist - title
            name = filename.replace(".mp3", "")
            if " - " in name:
                artist, title = name.split(" - ", 1)
            else:
                artist, title = "Unknown", name

            track_id = database.save_track(
                filename=filename,
                title=title,
                artist=artist,
                duration_seconds=round(duration, 1),
                size_mb=round(size / (1024 * 1024), 1),
                source_path=filepath,
            )
            imported.append({"id": track_id, "filename": filename})

    return {"imported": imported, "count": len(imported)}


@router.post("/tracks/import-csv")
def import_tracks_from_csv(request: dict):
    """Import tracks from the CSV file."""
    import csv
    import re

    csv_path = os.path.join(
        os.path.dirname(__file__), "..", "..", "..", "..",
        "docs", "track-prompts-lyrics.csv"
    )

    if not os.path.exists(csv_path):
        raise HTTPException(status_code=404, detail="CSV file not found")

    # Clear existing tracks
    existing = database.get_tracks(limit=1000)
    for t in existing:
        database.delete_track(t["id"])

    imported = 0

    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)

        for row in reader:
            track_name = row.get("Track Name", "").strip()
            prompt = row.get("Prompt", "").strip()
            lyrics = row.get("Lyrics (key excerpt/theme)", "").strip()

            if not track_name:
                continue

            # Clean happyshrimp suffix
            prompt = re.sub(r"happyshrimp\s*$", "", prompt, flags=re.IGNORECASE).strip()
            lyrics = re.sub(r"happyshrimp\s*$", "", lyrics, flags=re.IGNORECASE).strip()

            # Determine artist
            artist = ""
            if any(kw in track_name for kw in ["Signal", "Before the Fade", "Still I Rise",
                                                  "Borrowed Flame", "Won't Ride", "Take the Crown",
                                                  "Built by Fire", "System Override"]):
                artist = "NeoCortext"
            elif "Learning How to Stay" in track_name:
                artist = "NeoCortext"

            filename = f"{artist} - {track_name}.mp3" if artist else f"{track_name}.mp3"

            database.save_track(
                filename=filename,
                title=track_name,
                artist=artist,
                music_prompt=prompt,
                lyrics=lyrics,
            )
            imported += 1

import json  # noqa: F401
from datetime import datetime


@router.post("/saved-scenes")
def save_generated_scene(request: dict):
    """Save generated scene code to a file for later retrieval."""
    code = request.get("code", "")
    track_name = request.get("track", "unknown")
    model = request.get("model", "unknown")
    if not code:
        raise HTTPException(status_code=400, detail="No code provided")

    # Create output directory
    output_dir = os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "output", "generated-scenes")
    os.makedirs(output_dir, exist_ok=True)

    # Generate filename with timestamp
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_track = "".join(c if c.isalnum() or c in "-_" else "_" for c in track_name)[:50]
    filename = f"{safe_track}_{timestamp}.js"
    filepath = os.path.join(output_dir, filename)

    # Save with metadata header
    header = f"// Generated Scene — {track_name}\n"
    header += f"// Model: {model}\n"
    header += f"// Date: {datetime.now().isoformat()}\n"
    header += f"// Track: {track_name}\n\n"

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(header + code)

    return {"success": True, "filename": filename, "path": filepath}


@router.get("/saved-scenes")
def list_saved_scenes():
    """List all saved generated scenes."""
    output_dir = os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "output", "generated-scenes")
    if not os.path.exists(output_dir):
        return {"scenes": []}

    scenes = []
    for filename in sorted(os.listdir(output_dir), reverse=True):
        if filename.endswith(".js"):
            filepath = os.path.join(output_dir, filename)
            stat = os.stat(filepath)
            scenes.append({
                "filename": filename,
                "path": filepath,
                "size": stat.st_size,
                "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            })
    return {"scenes": scenes}
