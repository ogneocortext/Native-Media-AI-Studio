"""
Data persistence API routes — prompts, audio, visuals, sessions, tracks, preferences.
"""

import csv
import os
import re
from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

from ..core import database

router = APIRouter(prefix="/api/data", tags=["Data"])


class CreatePromptRequest(BaseModel):
    """Request body for creating a prompt."""
    name: str = ""
    prompt_type: str = "visual_generation"
    text: str = ""
    tags: list[str] | None = None
    category: str = ""
    description: str = ""


class SaveVisualRequest(BaseModel):
    """Request body for saving AI visual metadata."""
    style_id: str = ""
    filename: str = ""
    stored_path: str = ""
    prompt_id: str | None = None
    width: int = 512
    height: int = 512
    steps: int = 20
    cfg: float = 7.0
    seed: int = 0
    checkpoint: str = ""
    comfyui_prompt_id: str = ""
    generation_time: float = 0.0
    tags: list[str] | None = None


class CreateSessionRequest(BaseModel):
    """Request body for creating a generation session."""
    audio_id: str | None = None
    music_prompt_id: str | None = None
    config: dict | None = None


class UpdateSessionRequest(BaseModel):
    """Request body for updating a generation session (allows extra fields)."""
    model_config = ConfigDict(extra="allow")


class SetPreferenceRequest(BaseModel):
    """Request body for setting a user preference."""
    value: str | None = None
    category: str = "general"


class CreateTrackRequest(BaseModel):
    """Request body for creating a track record."""
    filename: str = ""
    title: str = ""
    artist: str = ""
    duration_seconds: float = 0
    size_mb: float = 0
    source_path: str = ""
    music_prompt: str = ""
    lyrics: str = ""
    visual_style: str = ""
    visual_prompt: str = ""
    tags: list[str] | None = None


class UpdateTrackRequest(BaseModel):
    """Request body for updating a track (allows extra fields)."""
    model_config = ConfigDict(extra="allow")


class ImportTracksRequest(BaseModel):
    """Request body for importing tracks from a directory."""
    directory: str


class ImportTracksFromCsvRequest(BaseModel):
    """Request body for importing tracks from CSV (no fields required)."""
    pass


class SaveGeneratedSceneRequest(BaseModel):
    """Request body for saving generated scene code."""
    code: str
    track: str = "unknown"
    model: str = "unknown"


class CleanupIncompleteScenesRequest(BaseModel):
    """Request body for cleaning up incomplete scene files."""
    track: str = ""
    keep: int = 3


class SaveOllamaAnalysisRequest(BaseModel):
    """Request body for saving an Ollama analysis response."""
    track_name: str = ""
    html_response: str = ""
    raw_response: str = ""
    track_filename: str = ""
    model_name: str = ""
    prompt: str = ""
    lyrics: str = ""
    bpm: int = 0
    status: str = "completed"


@router.get("/")
def list_prompts(
    prompt_type: str | None = None,
    category: str | None = None,
    favorite: bool = False,
    search: str | None = None,
    limit: int = 100,
):
    """List prompts with optional filtering."""
    return database.get_prompts_typed(
        prompt_type=prompt_type,
        category=category,
        favorite_only=favorite,
        search=search,
        limit=limit,
    )


@router.get("/{prompt_id}")
def get_prompt(prompt_id: str):
    """Get a prompt by ID."""
    prompt = database.get_prompt_typed(prompt_id)
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return prompt


@router.post("/")
def create_prompt(body: CreatePromptRequest):
    """Save a new prompt."""
    prompt_id = database.save_prompt(
        name=body.name,
        prompt_type=body.prompt_type,
        text=body.text,
        tags=body.tags,
        category=body.category,
        description=body.description,
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
def list_audio_files(limit: int = 100, distinct: bool = True):
    """List stored audio file metadata.

    Args:
        limit: Maximum number of files to return.
        distinct: If True (default), deduplicate by filename (most recent only).
    """
    return database.get_audio_files_typed(limit=limit, distinct=distinct)


@router.get("/audio/{audio_id}")
def get_audio_file(audio_id: str):
    """Get audio file metadata."""
    audio = database.get_audio_file_typed(audio_id)
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
def save_visual(body: SaveVisualRequest):
    """Save AI visual metadata."""
    visual_id = database.save_ai_visual(
        style_id=body.style_id,
        filename=body.filename,
        stored_path=body.stored_path,
        prompt_id=body.prompt_id,
        width=body.width,
        height=body.height,
        steps=body.steps,
        cfg=body.cfg,
        seed=body.seed,
        checkpoint=body.checkpoint,
        comfyui_prompt_id=body.comfyui_prompt_id,
        generation_time=body.generation_time,
        tags=body.tags,
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
    return database.get_sessions_typed(status=status, audio_id=audio_id, limit=limit)


@router.post("/sessions/")
def create_session(body: CreateSessionRequest):
    """Create a generation session."""
    session_id = database.save_session(
        audio_id=body.audio_id,
        music_prompt_id=body.music_prompt_id,
        config=body.config,
    )
    return {"id": session_id, "success": True}


@router.get("/sessions/{session_id}")
def get_session(session_id: str):
    """Get a generation session."""
    session = database.get_session_typed(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.patch("/sessions/{session_id}")
def update_session(session_id: str, body: UpdateSessionRequest):
    """Update a generation session."""
    database.update_session(session_id, **body.model_dump())
    return {"success": True}


@router.get("/preferences/")
def get_preferences(category: str | None = None):
    """Get user preferences."""
    return database.get_all_preferences(category=category)


@router.put("/preferences/{key}")
def set_preference(key: str, body: SetPreferenceRequest):
    """Set a user preference."""
    database.set_preference(
        key=key,
        value=body.value,
        category=body.category,
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
    return database.get_tracks_typed(status=status, artist=artist, search=search, limit=limit)


@router.get("/tracks/{track_id}")
def get_track(track_id: str):
    """Get a track by ID."""
    track = database.get_track_typed(track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")
    return track


@router.post("/tracks/")
def create_track(body: CreateTrackRequest):
    """Create a new track record."""
    track_id = database.save_track(
        filename=body.filename,
        title=body.title,
        artist=body.artist,
        duration_seconds=body.duration_seconds,
        size_mb=body.size_mb,
        source_path=body.source_path,
        music_prompt=body.music_prompt,
        lyrics=body.lyrics,
        visual_style=body.visual_style,
        visual_prompt=body.visual_prompt,
        tags=body.tags,
    )
    return {"id": track_id, "success": True}


@router.patch("/tracks/{track_id}")
def update_track(track_id: str, body: UpdateTrackRequest):
    """Update a track."""
    database.update_track(track_id, **body.model_dump())
    return {"success": True}


@router.delete("/tracks/{track_id}")
def delete_track(track_id: str):
    """Delete a track."""
    deleted = database.delete_track(track_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Track not found")
    return {"success": True}


@router.post("/tracks/import")
def import_tracks(body: ImportTracksRequest):
    """Import tracks from a directory."""
    directory = body.directory
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
def import_tracks_from_csv(body: ImportTracksFromCsvRequest):
    """Import tracks from the CSV file."""
    csv_path = os.path.join(
        os.path.dirname(__file__), "..", "..", "..", "..",
        "docs", "track-prompts-lyrics.csv"
    )

    if not os.path.exists(csv_path):
        raise HTTPException(status_code=404, detail="CSV file not found")

    # Clear existing tracks in a single transaction
    with database.get_db() as conn:
        conn.execute("DELETE FROM tracks")
        conn.execute("DELETE FROM sqlite_sequence WHERE name = 'tracks'")

    imported = 0

    with open(csv_path, encoding="utf-8") as f:
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

    return {"imported": imported, "count": imported}


@router.post("/saved-scenes")
def save_generated_scene(body: SaveGeneratedSceneRequest):
    """Save generated scene code to a file for later retrieval."""
    code = body.code
    track_name = body.track
    model = body.model
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


@router.post("/saved-scenes/cleanup")
def cleanup_incomplete_scenes(body: CleanupIncompleteScenesRequest):
    """Remove incomplete scene files for a track, keeping only the largest (most complete) ones."""
    track = body.track
    keep = body.keep
    output_dir = os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "output", "generated-scenes")
    if not os.path.exists(output_dir):
        return {"removed": 0}

    # Find all files matching this track
    safe_track = "".join(c if c.isalnum() or c in "-_" else "_" for c in track)[:50]
    matching = []
    for filename in os.listdir(output_dir):
        if filename.endswith(".js") and filename.startswith(safe_track):
            filepath = os.path.join(output_dir, filename)
            stat = os.stat(filepath)
            matching.append({"filename": filename, "path": filepath, "size": stat.st_size})

    # Sort by size (largest first), keep top N, delete the rest
    matching.sort(key=lambda x: x["size"], reverse=True)
    removed = 0
    for item in matching[keep:]:
        try:
            os.remove(item["path"])
            removed += 1
        except OSError:
            pass

    return {"removed": removed, "kept": min(keep, len(matching))}


# Ollama Analysis Response Endpoints

@router.post("/ollama-analysis")
def save_ollama_analysis(body: SaveOllamaAnalysisRequest):
    """Save an Ollama analysis response."""
    response_id = database.save_ollama_analysis_response(
        track_name=body.track_name,
        html_response=body.html_response,
        raw_response=body.raw_response,
        track_filename=body.track_filename,
        model_name=body.model_name,
        prompt=body.prompt,
        lyrics=body.lyrics,
        bpm=body.bpm,
        status=body.status,
    )
    return {"success": True, "id": response_id}


@router.get("/ollama-analysis")
def list_ollama_analysis(track_name: str | None = None, limit: int = 50):
    """List Ollama analysis responses, optionally filtered by track."""
    responses = database.list_ollama_analysis_typed(track_name=track_name, limit=limit)
    return {"responses": [r.__dict__ for r in responses]}


@router.get("/ollama-analysis/{response_id}")
def get_ollama_analysis(response_id: str):
    """Get a single Ollama analysis response."""
    response = database.get_ollama_analysis_response_typed(response_id)
    if not response:
        raise HTTPException(status_code=404, detail="Response not found")
    return response.__dict__


@router.delete("/ollama-analysis/{response_id}")
def delete_ollama_analysis(response_id: str):
    """Delete an Ollama analysis response."""
    deleted = database.delete_ollama_analysis_response(response_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Response not found")
    return {"success": True}
