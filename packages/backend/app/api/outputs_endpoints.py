"""
Output files API route handlers.

Extracted from outputs.py. Contains all FastAPI route handlers for listing,
deleting, renaming, and thumbnailing output files.

Depends on outputs_scanner for directory scanning/caching and outputs_models
for Pydantic schemas.
"""

from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from ..core.config import config
from ..core.paths import comfyui_output_dir, is_within, resolve_within, sanitize_filename
from .outputs_models import (
    BulkDeleteRequest,
    OutputFile,
    OutputsResponse,
    RenameRequest,
)
from .outputs_scanner import (
    _invalidate_cache,
    _iter_media_files,
    _run_subprocess_thread,
    _scan_with_cache,
    _sidecar_candidates,
    _sidecar_rename_pairs,
    extract_video_thumbnail,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/outputs", tags=["Outputs"])


# ---------------------------------------------------------------------------
# Listing
# ---------------------------------------------------------------------------


@router.get("", response_model=OutputsResponse)
async def list_outputs(
    file_type: str | None = Query(None, description="Filter by file type (image, video, audio)"),
    search: str | None = Query(None, description="Search in filename and metadata"),
    date_from: str | None = Query(None, description="Filter by creation date from (ISO format)"),
    date_to: str | None = Query(None, description="Filter by creation date to (ISO format)"),
    limit: int = Query(200, ge=1, le=500, description="Maximum number of results"),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
    *,
    refresh: bool = Query(default=False, description="Bypass the in-memory list cache"),
) -> OutputsResponse:
    """List all output files with their metadata.

    Uses in-memory caching with 30s TTL. No FFmpeg calls on list --
    thumbnails are generated on-demand when opening a file.
    """
    # Fast cached scan (no FFmpeg)
    if refresh:
        _invalidate_cache()
    all_outputs = _scan_with_cache()

    if file_type and file_type != "all":
        # Accept both singular ("image") and plural ("images") spellings.
        plural_map = {
            "images": "image",
            "videos": "video",
            "audios": "audio",
            "3d": "3d",
        }
        normalized = plural_map.get(file_type, file_type)
        all_outputs = [o for o in all_outputs if o.file_type == normalized]

    # Search filter
    if search:
        search_lower = search.lower()
        all_outputs = [
            o
            for o in all_outputs
            if search_lower in o.filename.lower()
            or (o.metadata and search_lower in str(o.metadata).lower())
        ]

    # Date filters
    if date_from:
        try:
            df = datetime.fromisoformat(date_from)
            all_outputs = [
                o
                for o in all_outputs
                if o.created_at and datetime.fromisoformat(o.created_at) >= df
            ]
        except (ValueError, TypeError):
            pass
    if date_to:
        try:
            dt = datetime.fromisoformat(date_to)
            all_outputs = [
                o
                for o in all_outputs
                if o.created_at and datetime.fromisoformat(o.created_at) <= dt
            ]
        except (ValueError, TypeError):
            pass

    total = len(all_outputs)
    images_count = sum(1 for o in all_outputs if o.file_type == "image")
    videos_count = sum(1 for o in all_outputs if o.file_type == "video")
    audio_count = sum(1 for o in all_outputs if o.file_type == "audio")
    models_3d_count = sum(1 for o in all_outputs if o.file_type == "3d")

    page = all_outputs[offset : offset + limit]
    return OutputsResponse(
        outputs=page,
        total=total,
        images_count=images_count,
        videos_count=videos_count,
        audio_count=audio_count,
        models_3d_count=models_3d_count,
    )


@router.get("/recent", response_model=list[OutputFile])
async def list_recent_outputs(
    limit: int = Query(20, ge=1, le=200, description="Maximum number of results"),
) -> list[OutputFile]:
    """List the most recently created outputs.

    Must be declared before ``/{file_type}`` — otherwise ``recent`` is
    captured as a file_type and rejected with 400.
    """
    # _scan_with_cache() returns results sorted by created_at descending.
    return _scan_with_cache()[:limit]


@router.get("/{file_type}", response_model=list[OutputFile])
async def list_outputs_by_type(
    file_type: str, limit: int = Query(50, ge=1, le=200)
) -> list[OutputFile]:
    """List outputs filtered by type (images, video, audio, 3d)."""
    valid_types = {"images": "image", "video": "video", "audio": "audio", "3d": "3d"}

    if file_type not in valid_types:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type. Must be one of: {list(valid_types.keys())}",
        )

    # Use cached scan
    all_outputs = _scan_with_cache()
    filtered = [o for o in all_outputs if o.file_type == valid_types[file_type]]
    return filtered[:limit]


# ---------------------------------------------------------------------------
# Bulk delete
# ---------------------------------------------------------------------------


@router.post("/bulk-delete")
async def bulk_delete(body: BulkDeleteRequest) -> dict:
    """Delete multiple files at once (for duplicates cleanup)."""
    output_base = Path(config.output_dir).resolve()
    deleted: list[str] = []
    failed: list[dict] = []
    for file_path in body.paths:
        fp = file_path.strip("/").strip()
        if not fp:
            continue
        try:
            full_path = resolve_within(output_base, fp)
        except ValueError:
            failed.append({"path": fp, "error": "not found or escapes"})
            continue
        if not full_path.exists() or not full_path.is_file():
            failed.append({"path": fp, "error": "not found or escapes"})
            continue
        try:
            full_path.unlink()
            for cand in _sidecar_candidates(full_path):
                if cand.exists() and is_within(output_base, cand):
                    try:
                        cand.unlink()
                    except Exception:
                        pass
            deleted.append(fp)
        except Exception as e:
            failed.append({"path": fp, "error": str(e)})
    _invalidate_cache()
    return {"success": True, "deleted": deleted, "failed": failed, "deleted_count": len(deleted)}


# ---------------------------------------------------------------------------
# Delete single file
# ---------------------------------------------------------------------------


@router.delete("/{file_path:path}")
async def delete_output(file_path: str) -> dict:
    """Delete an output file by its path (relative to the output directory)."""
    file_path = file_path.strip("/")
    output_base = Path(config.output_dir).resolve()
    try:
        full_path = resolve_within(output_base, file_path)
    except ValueError:
        raise HTTPException(status_code=400, detail="Path escapes the output directory") from None

    if not full_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    if not full_path.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    try:
        full_path.unlink()

        # Remove JSON + cover sidecars (shared candidate list)
        for cand in _sidecar_candidates(full_path):
            if cand.exists() and is_within(output_base, cand):
                try:
                    cand.unlink()
                except Exception:
                    pass

        return {"success": True, "message": f"Deleted {full_path.name} (+ sidecars)"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete file: {str(e)}") from e
    finally:
        _invalidate_cache()


# ---------------------------------------------------------------------------
# Rename
# ---------------------------------------------------------------------------


@router.post("/{file_path:path}/rename")
async def rename_output(file_path: str, body: RenameRequest) -> dict:
    """Rename an output file (and its sidecars: .json, cover .jpg)."""
    file_path = file_path.strip("/")
    try:
        new_name = sanitize_filename(body.new_name.strip())
    except ValueError:
        raise HTTPException(
            status_code=400, detail="new_name must be a plain filename, no path separators"
        ) from None
    if len(new_name) > 200:
        raise HTTPException(status_code=400, detail="Filename too long")
    output_base = Path(config.output_dir).resolve()
    try:
        full_path = resolve_within(output_base, file_path)
    except ValueError:
        raise HTTPException(status_code=400, detail="Path escapes output directory") from None
    if not full_path.exists() or not full_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    # Prevent overwriting
    new_path = full_path.with_name(new_name)
    if not is_within(output_base, new_path):
        raise HTTPException(status_code=400, detail="New path escapes output directory")
    if new_path.exists():
        raise HTTPException(status_code=409, detail=f"Target already exists: {new_name}")

    try:
        full_path.rename(new_path)

        # Rename sidecars if they exist (same candidate list as delete).
        for old_cand, new_cand in _sidecar_rename_pairs(full_path, new_path):
            if old_cand.exists() and is_within(output_base, old_cand):
                if not new_cand.exists():
                    try:
                        old_cand.rename(new_cand)
                    except Exception:
                        pass

        new_rel = new_path.relative_to(output_base).as_posix()
        return {
            "success": True,
            "message": f"Renamed to {new_name}",
            "new_path": new_rel,
            "new_name": new_name,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Rename failed: {str(e)}") from e
    finally:
        _invalidate_cache()


# ---------------------------------------------------------------------------
# Thumbnails
# ---------------------------------------------------------------------------


@router.post("/regenerate-thumbnails")
async def regenerate_thumbnails() -> dict:
    """Regenerate video thumbnails for all video files missing covers.

    Scans output/video/ and runs FFmpeg frame extraction on any .mp4/.webm
    that lacks a .jpg sidecar. Returns count of successful extractions.
    """
    output_base = Path(config.output_dir)
    video_dir = output_base / "video"

    if not video_dir.exists():
        return {"success": True, "message": "No video directory", "generated": 0, "total": 0}

    generated = 0
    total = 0

    for video_path in _iter_media_files(video_dir):
        if video_path.suffix.lower() not in {".mp4", ".webm", ".mov", ".mkv", ".m4v", ".avi"}:
            continue

        total += 1
        cover = await extract_video_thumbnail(video_path, output_base)
        if cover:
            generated += 1

    return {
        "success": True,
        "message": f"Generated {generated} thumbnail(s) from {total} video(s)",
        "generated": generated,
        "total": total,
    }


@router.get("/3d/thumbnail/{filename:path}")
async def get_3d_thumbnail(filename: str):
    """Generate and return a thumbnail for a 3D model."""
    # Find the GLB file
    output_base = Path(config.output_dir)
    glb_path = None

    # Search in generated_3d directory
    candidate = output_base / "generated_3d" / filename
    if candidate.exists() and candidate.suffix.lower() == ".glb":
        glb_path = candidate

    # Search in ComfyUI output directory
    if not glb_path:
        comfyui_output = comfyui_output_dir()
        if comfyui_output.exists():
            for glb_file in comfyui_output.rglob("*.glb"):
                if glb_file.name == filename:
                    glb_path = glb_file
                    break

    if not glb_path or not glb_path.exists():
        raise HTTPException(status_code=404, detail="3D model not found")

    # Generate thumbnail path
    thumb_dir = output_base / "thumbnails" / "3d"
    thumb_dir.mkdir(parents=True, exist_ok=True)
    thumb_path = thumb_dir / f"{glb_path.stem}.png"

    # Return cached thumbnail if it exists and is newer than the GLB
    if thumb_path.exists():
        glb_mtime = glb_path.stat().st_mtime
        thumb_mtime = thumb_path.stat().st_mtime
        if thumb_mtime > glb_mtime:
            return FileResponse(str(thumb_path), media_type="image/png")

    # Generate thumbnail using Blender
    import subprocess

    blender_exe = config.blender_exe
    if not blender_exe:
        logger.error("Blender executable not found (set blender_exe in config/settings.json)")
        raise HTTPException(status_code=500, detail="Blender not configured")
    script_path = Path(__file__).parent.parent / "services" / "generate_thumbnail.py"
    try:
        result = await _run_subprocess_thread(
            [
                blender_exe,
                "--background",
                "--python",
                str(script_path),
                "--",
                str(glb_path),
                str(thumb_path),
                "256",
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode == 0 and thumb_path.exists():
            return FileResponse(str(thumb_path), media_type="image/png")
        else:
            logger.error(f"Thumbnail generation failed: {result.stderr}")
            raise HTTPException(status_code=500, detail="Failed to generate thumbnail")
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Thumbnail generation timed out") from None
    except Exception as e:
        logger.error(f"Thumbnail generation error: {e}")
        raise HTTPException(status_code=500, detail=str(e)) from e
