"""
Output files API routes.
Returns list of generated media and their JSON sidecar metadata.
"""

import json
import logging
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from functools import lru_cache
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from ..core.config import PROJECT_ROOT, config

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/outputs", tags=["Outputs"])

# =============================================================================
# In-memory cache for output directory listing
# =============================================================================
_output_cache: dict[str, Any] = {
    "files": [],
    "mtime": 0,
    "timestamp": 0,
}
CACHE_TTL_SECONDS = 30  # Refresh cache every 30 seconds max


def _get_dir_mtime() -> float:
    """Get the latest mtime across all output subdirectories."""
    output_base = Path(config.output_dir)
    latest = 0.0
    for subdir in ["images", "video", "audio", "generated_3d"]:
        dir_path = output_base / subdir
        if dir_path.exists():
            try:
                mtime = dir_path.stat().st_mtime
                latest = max(latest, mtime)
                # Also check files inside
                for f in dir_path.iterdir():
                    if f.is_file():
                        latest = max(latest, f.stat().st_mtime)
            except OSError:
                pass
    return latest


def _scan_with_cache() -> list[dict]:
    """Scan outputs with in-memory caching."""
    import time

    now = time.time()
    current_mtime = _get_dir_mtime()

    # Return cache if still valid
    cache = _output_cache
    if (
        cache["files"]
        and now - cache["timestamp"] < CACHE_TTL_SECONDS
        and cache["mtime"] >= current_mtime
    ):
        return cache["files"]

    # Cache miss - scan directory (without FFmpeg - fast metadata only)
    all_outputs: list[OutputFile] = []
    output_base = Path(config.output_dir)

    # Scan standard output directories
    for subdir in ["images", "video", "audio", "generated_3d"]:
        dir_path = output_base / subdir
        if not dir_path.exists():
            continue

        for file_path in dir_path.iterdir():
            if not file_path.is_file():
                continue
            if file_path.suffix.lower() == ".json":
                continue
            # Skip cover sidecars in audio/video folders
            if subdir in ("audio", "video") and file_path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}:
                continue

            try:
                stat = file_path.stat()
            except OSError:
                continue

            # Fast metadata load (no FFmpeg)
            metadata = load_sidecar_metadata(file_path)
            file_type = get_file_type(file_path.name)
            rel_path = file_path.relative_to(output_base).as_posix()

            all_outputs.append(OutputFile(
                filename=file_path.name,
                path=str(file_path),
                relative_path=rel_path,
                file_type=file_type,
                size_bytes=stat.st_size,
                created_at=datetime.fromtimestamp(stat.st_ctime).isoformat(),
                modified_at=datetime.fromtimestamp(stat.st_mtime).isoformat(),
                cover_image=None,  # No FFmpeg extraction on list
                has_cover=_has_cover_cached(file_path, subdir),
                metadata=metadata,
                job_id=metadata.get("job_id") if metadata else None,
            ))

    # Scan ComfyUI output directory for 3D assets
    comfyui_output = config.comfyui_output_dir if config.comfyui_output_dir else PROJECT_ROOT.parent / "ComfyUI" / "output"
    if comfyui_output.exists():
        for glb_file in comfyui_output.rglob("*.glb"):
            try:
                stat = glb_file.stat()
                rel_path = f"comfyui/{glb_file.relative_to(comfyui_output).as_posix()}"
                all_outputs.append(OutputFile(
                    filename=glb_file.name,
                    path=str(glb_file),
                    relative_path=rel_path,
                    file_type="3d",
                    size_bytes=stat.st_size,
                    created_at=datetime.fromtimestamp(stat.st_ctime).isoformat(),
                    modified_at=datetime.fromtimestamp(stat.st_mtime).isoformat(),
                    cover_image=None,
                    has_cover=False,
                    metadata={},
                    job_id=None,
                ))
            except OSError:
                continue

    all_outputs.sort(key=lambda x: x.created_at, reverse=True)

    # Update cache
    _output_cache["files"] = all_outputs
    _output_cache["mtime"] = current_mtime
    _output_cache["timestamp"] = now

    return all_outputs


def _has_cover_cached(file_path: Path, subdir: str) -> bool:
    """Check if a cover image exists (without FFmpeg)."""
    for ext in (".jpg", ".jpeg", ".png", ".webp"):
        if file_path.with_suffix(ext).exists():
            return True
        if file_path.with_name(file_path.stem + ext).exists():
            return True
    return False


class OutputFile(BaseModel):
    """Model for an output file with its metadata"""

    filename: str
    path: str
    relative_path: str
    file_type: str  # image, video, audio
    size_bytes: int
    created_at: str
    modified_at: str | None = None
    cover_image: str | None = None
    has_cover: bool = False  # Whether a thumbnail/cover exists
    metadata: dict | None = None
    job_id: str | None = None


class OutputsResponse(BaseModel):
    """Response model for outputs listing"""

    outputs: list[OutputFile]
    total: int
    images_count: int
    videos_count: int
    audio_count: int


def get_file_type(filename: str) -> str:
    """Determine file type from extension"""
    ext = Path(filename).suffix.lower()
    image_exts = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}
    video_exts = {".mp4", ".webm", ".avi", ".mov", ".mkv"}
    audio_exts = {".mp3", ".wav", ".flac", ".ogg", ".m4a"}
    model_exts = {".glb", ".gltf", ".obj", ".fbx", ".ply", ".stl"}

    if ext in image_exts:
        return "image"
    elif ext in video_exts:
        return "video"
    elif ext in audio_exts:
        return "audio"
    elif ext in model_exts:
        return "3d"
    return "other"


def load_sidecar_metadata(file_path: Path) -> dict | None:
    """Load JSON sidecar metadata if it exists"""
    sidecar_path = file_path.with_suffix(file_path.suffix + ".json")
    if sidecar_path.exists():
        try:
            with open(sidecar_path, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, json.JSONDecodeError):
            return None
    return None


def _is_video_corrupted(video_path: Path) -> bool:
    """Check if a video file is corrupted/incomplete (missing moov atom, etc.)."""
    import shutil
    import subprocess

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return False

    try:
        probe = subprocess.run(
            [ffmpeg, "-hide_banner", "-i", str(video_path)],
            capture_output=True, text=True, timeout=10,
        )
        stderr = (probe.stderr or "") + (probe.stdout or "")
        error_indicators = [
            "moov atom not found",
            "invalid data found",
            "error reading header",
            "invalid argument",
            "end of file",
        ]
        return any(err in stderr.lower() for err in error_indicators)
    except Exception:
        return False


def extract_video_thumbnail(video_path: Path, relative_base: Path) -> str | None:
    """Extract a poster frame from a video file using FFmpeg.

    Checks for existing {stem}.jpg first (cached). If missing, probes video duration
    and extracts a frame at 10% of playback (or 1s, whichever is greater).
    Saves as sidecar .jpg. Returns relative cover path if successful, else None.
    """
    import shutil
    import subprocess

    # 1) Check existing sidecar image
    for ext in (".jpg", ".jpeg", ".png", ".webp"):
        cand = video_path.with_suffix(ext)
        if cand.exists():
            try:
                return cand.relative_to(relative_base).as_posix()
            except ValueError:
                continue
        cand2 = video_path.with_name(video_path.stem + ext)
        if cand2.exists():
            try:
                return cand2.relative_to(relative_base).as_posix()
            except ValueError:
                continue

    # 2) Try FFmpeg frame extraction
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return None

    cover_path = video_path.with_suffix(".jpg")

    try:
        # Probe duration first to pick a good frame time
        probe = subprocess.run(
            [ffmpeg, "-hide_banner", "-i", str(video_path)],
            capture_output=True, text=True, timeout=10,
        )
        stderr = (probe.stderr or "") + (probe.stdout or "")

        # Extract duration from FFmpeg output (e.g., "Duration: 00:05:23.45")
        duration_sec = 0.0
        if "Duration:" in stderr:
            try:
                dur_str = stderr.split("Duration:")[1].split(",")[0].strip()
                parts = dur_str.split(":")
                duration_sec = float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
            except (ValueError, IndexError):
                duration_sec = 0.0

        # Seek to 10% of duration or 1 second, whichever is greater
        seek_time = max(1.0, duration_sec * 0.1) if duration_sec > 0 else 1.0

        result = subprocess.run(
            [ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
             "-ss", f"{seek_time:.1f}",
             "-i", str(video_path),
             "-frames:v", "1",
             "-q:v", "3",
             "-vf", "scale=480:-2",
             str(cover_path)],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0 and cover_path.exists() and cover_path.stat().st_size > 1024:
            try:
                return cover_path.relative_to(relative_base).as_posix()
            except ValueError:
                return None
        # Cleanup failed/empty file
        if cover_path.exists() and cover_path.stat().st_size < 1024:
            try:
                cover_path.unlink()  # type: ignore
            except Exception:
                pass
    except Exception:
        pass
    return None


def extract_audio_cover(audio_path: Path, relative_base: Path) -> str | None:
    """Extract embedded cover art from audio file (ID3, FLAC, etc.) using FFmpeg.

    Checks for existing {stem}.jpg first (cached). If missing, tries FFmpeg:
    `ffmpeg -y -i audio.mp3 -an -vcodec copy -frames:v 1 -update 1 cover.jpg`
    Returns relative cover path if successful, else None. Never raises.
    """
    # 1) Check existing sidecar image
    for ext in (".jpg", ".jpeg", ".png", ".webp"):
        cand = audio_path.with_suffix(ext)
        if cand.exists():
            try:
                return cand.relative_to(relative_base).as_posix()
            except ValueError:
                continue
        cand2 = audio_path.with_name(audio_path.stem + ext)
        if cand2.exists():
            try:
                return cand2.relative_to(relative_base).as_posix()
            except ValueError:
                continue

    # 2) Try FFmpeg extract — skip if no attached picture stream
    import shutil
    import subprocess

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return None

    # Quick probe: does file have a video stream (cover)?
    try:
        probe = subprocess.run(
            [ffmpeg, "-hide_banner", "-i", str(audio_path)],
            capture_output=True, text=True, timeout=5,
        )
        # FFmpeg prints stream info to stderr; cover shows as `Video: png` or `Video: mjpeg (attached pic)`
        stderr = (probe.stderr or "") + (probe.stdout or "")
        if "attached pic" not in stderr.lower() and "video:" not in stderr.lower():
            # Also need to check for Video stream specifically, not just video codec
            if "Stream #0:0: Video" not in stderr and "Stream #0:1: Video" not in stderr:
                return None
    except Exception:
        return None

    cover_path = audio_path.with_suffix(".jpg")
    # Avoid overwriting if we just checked and it didn't exist, now create
    try:
        # -frames:v 1 and -update 1 ensures single image, not sequence
        result = subprocess.run(
            [ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
             "-i", str(audio_path), "-an", "-vcodec", "copy", "-frames:v", "1", "-update", "1", str(cover_path)],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0 and cover_path.exists() and cover_path.stat().st_size > 1024:
            try:
                return cover_path.relative_to(relative_base).as_posix()
            except ValueError:
                return None
        # Cleanup tiny failed file
        if cover_path.exists() and cover_path.stat().st_size < 1024:
            try: cover_path.unlink()  # type: ignore
            except: pass
    except Exception:
        pass
    return None


async def scan_output_directory(subdir: str, relative_base: Path) -> list[OutputFile]:
    """Scan a subdirectory for output files"""
    outputs = []
    dir_path = Path(config.output_dir) / subdir

    if not dir_path.exists():
        return outputs

    # Only process files (not directories)
    for file_path in dir_path.iterdir():
        if not file_path.is_file():
            continue

        # Skip JSON sidecars in listing (they're metadata only)
        if file_path.suffix.lower() == ".json":
            continue

        # Skip cover sidecars in audio/video folders (they are thumbnails, not standalone images)
        if subdir in ("audio", "video") and file_path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}:
            continue

        # Get file stats
        try:
            stat = file_path.stat()
        except OSError:
            continue

        # Load sidecar metadata
        metadata = load_sidecar_metadata(file_path)
        job_id = metadata.get("job_id") if metadata else None
        file_type = get_file_type(file_path.name)

        # Find / extract cover image for videos and audio
        cover_image = None
        is_corrupted = False
        if file_type == "video":
            cover_image = extract_video_thumbnail(file_path, relative_base)
            # Detect corrupted/invalid video files
            if cover_image is None:
                is_corrupted = _is_video_corrupted(file_path)
        elif file_type == "audio":
            cover_image = extract_audio_cover(file_path, relative_base)

        # Build relative path for frontend (normalize to forward slashes for web URLs)
        rel_path = file_path.relative_to(relative_base)
        normalized_rel_path = rel_path.as_posix() if hasattr(rel_path, 'as_posix') else str(rel_path).replace('\\', '/')

        output_file = OutputFile(
            filename=file_path.name,
            path=str(file_path),
            relative_path=normalized_rel_path,
            file_type=file_type,
            size_bytes=stat.st_size,
            created_at=datetime.fromtimestamp(stat.st_ctime).isoformat(),
            modified_at=datetime.fromtimestamp(stat.st_mtime).isoformat(),
            cover_image=cover_image,
            metadata={**(metadata or {}), "corrupted": is_corrupted} if is_corrupted else metadata,
            job_id=job_id,
        )
        outputs.append(output_file)

    return outputs


@router.get("", response_model=OutputsResponse)
async def list_outputs(
    file_type: str | None = Query(
        None, description="Filter by file type (image, video, audio)"
    ),
    search: str | None = Query(
        None, description="Search in filename and metadata"
    ),
    date_from: str | None = Query(
        None, description="Filter by creation date from (ISO format)"
    ),
    date_to: str | None = Query(
        None, description="Filter by creation date to (ISO format)"
    ),
    limit: int = Query(50, ge=1, le=200, description="Maximum number of results"),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
) -> OutputsResponse:
    """List all output files with their metadata.

    Uses in-memory caching with 30s TTL. No FFmpeg calls on list —
    thumbnails are generated on-demand when opening a file.
    """
    # Fast cached scan (no FFmpeg)
    all_outputs = await _scan_with_cache()

    if file_type:
        all_outputs = [o for o in all_outputs if o.file_type == file_type]

    if search:
        search_lower = search.lower()
        all_outputs = [
            o for o in all_outputs
            if search_lower in o.filename.lower()
            or (o.job_id and search_lower in o.job_id.lower())
            or (o.metadata and any(
                search_lower in str(v).lower()
                for v in o.metadata.values()
                if isinstance(v, (str, int, float))
            ))
        ]

    if date_from:
        try:
            from_date = datetime.fromisoformat(date_from)
            all_outputs = [
                o for o in all_outputs
                if datetime.fromisoformat(o.created_at) >= from_date
            ]
        except ValueError:
            pass

    if date_to:
        try:
            to_date = datetime.fromisoformat(date_to)
            all_outputs = [
                o for o in all_outputs
                if datetime.fromisoformat(o.created_at) <= to_date
            ]
        except ValueError:
            pass

    total = len(all_outputs)
    images_count = len([o for o in all_outputs if o.file_type == "image"])
    videos_count = len([o for o in all_outputs if o.file_type == "video"])
    audio_count = len([o for o in all_outputs if o.file_type == "audio"])

    # Apply pagination
    paginated = all_outputs[offset : offset + limit]

    return OutputsResponse(
        outputs=paginated,
        total=total,
        images_count=images_count,
        videos_count=videos_count,
        audio_count=audio_count,
    )


@router.get("/recent", response_model=list[OutputFile])
async def get_recent_outputs(
    limit: int = Query(
        10, ge=1, le=50, description="Number of recent outputs to return"
    ),
) -> list[OutputFile]:
    """Get the most recent output files."""
    all_outputs: list[OutputFile] = []

    output_base = Path(config.output_dir)
    for subdir in ["images", "video", "audio", "previews"]:
        outputs = await scan_output_directory(subdir, output_base)
        all_outputs.extend(outputs)

    # Sort by creation time (newest first) and limit
    all_outputs.sort(key=lambda x: x.created_at, reverse=True)
    return all_outputs[:limit]


@router.get("/duplicates/groups", response_model=list[dict])
async def find_duplicate_groups(
    quick: bool = Query(True, description="Quick hash (first 1MB + size) vs full SHA256"),
    limit: int = Query(50, ge=1, le=200, description="Max groups to return"),
) -> list[dict]:
    """Find duplicate files by content hash (size + hash of first 1MB, or full if quick=False).

    Groups files with identical content, useful for Happyshrimp re-uploads
    where same track appears as 85a406ef_..., f3a608e2_... etc.
    """
    import hashlib

    output_base = Path(config.output_dir)
    all_files: list[Path] = []
    for subdir in ["images", "video", "audio", "previews"]:
        d = output_base / subdir
        if d.exists():
            for p in d.iterdir():
                if p.is_file() and p.suffix.lower() not in {".json", ".jpg", ".jpeg", ".png", ".webp"}:
                    # Skip cover sidecars themselves; they are .jpg in audio — already filtered
                    all_files.append(p)

    # Also include .jpg in images/video as standalone? No, only media files
    # Compute hash groups
    def file_quick_hash(p: Path) -> str:
        h = hashlib.sha256()
        h.update(str(p.stat().st_size).encode())
        try:
            with open(p, "rb") as f:
                chunk = f.read(1024 * 1024)  # first 1MB
                h.update(chunk)
                # For small files (<1MB), also hash tail
                if p.stat().st_size < 1024 * 1024:
                    h.update(b"full")
                else:
                    f.seek(-min(8192, p.stat().st_size), 2)
                    h.update(f.read())
        except: 
            h.update(p.name.encode())
        return h.hexdigest()

    def file_full_hash(p: Path) -> str:
        h = hashlib.sha256()
        try:
            with open(p, "rb") as f:
                for chunk in iter(lambda: f.read(8192), b""):
                    h.update(chunk)
        except:
            return file_quick_hash(p)
        return h.hexdigest()

    hash_fn = file_quick_hash if quick else file_full_hash
    groups: dict[str, list[Path]] = {}
    for p in all_files:
        h = hash_fn(p)
        groups.setdefault(h, []).append(p)

    # Keep only groups with 2+ files, sort by wasted space
    dup_groups = []
    for h, paths in groups.items():
        if len(paths) < 2:
            continue
        size = paths[0].stat().st_size if paths[0].exists() else 0
        # Sort paths by created time (keep oldest)
        paths_sorted = sorted(paths, key=lambda p: p.stat().st_ctime)
        rels = []
        for p in paths_sorted:
            try:
                rel = p.relative_to(output_base).as_posix()
            except: rel = str(p)
            rels.append({"filename": p.name, "relative_path": rel, "size_bytes": p.stat().st_size, "created_at": datetime.fromtimestamp(p.stat().st_ctime).isoformat()})
        dup_groups.append({
            "hash": h[:16],
            "count": len(paths),
            "size_bytes": size,
            "wasted_bytes": size * (len(paths) - 1),
            "files": rels,
        })

    dup_groups.sort(key=lambda g: g["wasted_bytes"], reverse=True)
    return dup_groups[:limit]


@router.get("/comfyui/{file_path:path}")
async def serve_comfyui_file(file_path: str):
    """Serve a file from the ComfyUI output directory."""
    comfyui_output = config.comfyui_output_dir if config.comfyui_output_dir else PROJECT_ROOT.parent / "ComfyUI" / "output"
    full_path = (comfyui_output / file_path).resolve()
    
    # Security check: ensure the path is within the ComfyUI output directory
    if not full_path.is_relative_to(comfyui_output) or not full_path.exists() or not full_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    
    # Determine media type
    suffix = full_path.suffix.lower()
    media_type = "application/octet-stream"
    if suffix == ".glb":
        media_type = "model/gltf-binary"
    elif suffix == ".gltf":
        media_type = "model/gltf+json"
    elif suffix == ".obj":
        media_type = "text/plain"
    elif suffix == ".fbx":
        media_type = "application/octet-stream"
    elif suffix == ".png":
        media_type = "image/png"
    elif suffix in (".jpg", ".jpeg"):
        media_type = "image/jpeg"
    
    return FileResponse(str(full_path), media_type=media_type)


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
    all_outputs = await _scan_with_cache()
    filtered = [o for o in all_outputs if o.file_type == valid_types[file_type]]
    return filtered[:limit]


class BulkDeleteRequest(BaseModel):
    paths: list[str]

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
        full_path = (output_base / fp).resolve()
        if not full_path.is_relative_to(output_base) or not full_path.exists() or not full_path.is_file():
            failed.append({"path": fp, "error": "not found or escapes"})
            continue
        try:
            full_path.unlink()
            for ext in (".json", ".jpg", ".jpeg", ".png", ".webp"):
                for cand in (full_path.with_suffix(ext), full_path.with_name(full_path.stem + ext), Path(str(full_path) + ".json")):
                    if cand.exists() and cand.resolve().is_relative_to(output_base):
                        try: cand.unlink()
                        except: pass
            deleted.append(fp)
        except Exception as e:
            failed.append({"path": fp, "error": str(e)})
    return {"success": True, "deleted": deleted, "failed": failed, "deleted_count": len(deleted)}


@router.delete("/{file_path:path}")
async def delete_output(file_path: str) -> dict:
    """Delete an output file by its path (relative to the output directory)."""
    file_path = file_path.strip("/")
    output_base = Path(config.output_dir).resolve()
    full_path = (output_base / file_path).resolve()

    # Prevent path traversal: the resolved path must stay inside the output dir
    if not full_path.is_relative_to(output_base):
        raise HTTPException(status_code=400, detail="Path escapes the output directory")

    if not full_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    if not full_path.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    try:
        full_path.unlink()

        # Remove JSON sidecar
        json_path = full_path.with_suffix(full_path.suffix + ".json")
        alt_json = full_path.with_suffix(".json")
        for jp in {json_path, alt_json}:
            if jp.exists() and jp.resolve().is_relative_to(output_base):
                try: jp.unlink()
                except: pass

        # Remove cover sidecar (audio/video thumbnails)
        for ext in (".jpg", ".jpeg", ".png", ".webp"):
            for cand in (full_path.with_suffix(ext), full_path.with_name(full_path.stem + ext)):
                if cand.exists() and cand.resolve().is_relative_to(output_base):
                    try: cand.unlink()
                    except: pass

        return {"success": True, "message": f"Deleted {full_path.name} (+ sidecars)"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete file: {str(e)}")


class RenameRequest(BaseModel):
    new_name: str  # new filename only, no path

@router.post("/{file_path:path}/rename")
async def rename_output(file_path: str, body: RenameRequest) -> dict:
    """Rename an output file (and its sidecars: .json, cover .jpg)."""
    file_path = file_path.strip("/")
    new_name = body.new_name.strip().strip("/\\")
    if not new_name or "/" in new_name or "\\" in new_name or ".." in new_name:
        raise HTTPException(status_code=400, detail="new_name must be a plain filename, no path separators")
    if len(new_name) > 200:
        raise HTTPException(status_code=400, detail="Filename too long")
    # Basic extension check: keep same extension or allow common media exts
    output_base = Path(config.output_dir).resolve()
    full_path = (output_base / file_path).resolve()
    if not full_path.is_relative_to(output_base):
        raise HTTPException(status_code=400, detail="Path escapes output directory")
    if not full_path.exists() or not full_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    # Prevent overwriting
    new_path = full_path.with_name(new_name)
    if new_path.resolve().is_relative_to(output_base) is False:
        raise HTTPException(status_code=400, detail="New path escapes output directory")
    if new_path.exists():
        raise HTTPException(status_code=409, detail=f"Target already exists: {new_name}")
    # Validate extension stays same type (optional but helps avoid misclassification)
    if Path(new_name).suffix.lower() != full_path.suffix.lower():
        # Allow but warn — keep as is for flexibility (e.g., .png -> .jpg)
        pass

    try:
        full_path.rename(new_path)

        # Rename sidecars if they exist
        for ext in (".json", ".jpg", ".jpeg", ".png", ".webp"):
            old_cand = full_path.with_suffix(ext)
            alt_old = full_path.with_name(full_path.stem + ext)
            # JSON has double suffix case: file.mp3.json
            json_double = Path(str(full_path) + ".json")
            for cand in (old_cand, alt_old, json_double):
                if cand.exists() and cand.resolve().is_relative_to(output_base):
                    # Map to new name with same sidecar extension
                    if cand.suffix.lower() == ".json" and cand.name.endswith(".json"):
                        # Handle .mp3.json case: new json is new_path + ".json"
                        if cand == json_double:
                            new_cand = Path(str(new_path) + ".json")
                        else:
                            new_cand = new_path.with_suffix(cand.suffix)
                    else:
                        new_cand = new_path.with_suffix(cand.suffix)
                        # For stem case, ensure we use new stem
                        if cand.name.startswith(full_path.stem):
                            new_cand = new_path.with_name(new_path.stem + cand.suffix)
                    if not new_cand.exists():
                        try: cand.rename(new_cand)
                        except: pass

        new_rel = new_path.relative_to(output_base).as_posix()
        return {"success": True, "message": f"Renamed to {new_name}", "new_path": new_rel, "new_name": new_name}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Rename failed: {str(e)}")


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

    for video_path in video_dir.iterdir():
        if not video_path.is_file():
            continue
        if video_path.suffix.lower() not in {".mp4", ".webm", ".mov", ".mkv"}:
            continue

        total += 1
        cover = extract_video_thumbnail(video_path, output_base)
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
        comfyui_output = config.comfyui_output_dir if config.comfyui_output_dir else PROJECT_ROOT.parent / "ComfyUI" / "output"
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
    try:
        import subprocess
        script_path = Path(__file__).parent.parent / "services" / "generate_thumbnail.py"
        blender_exe = r"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
        result = subprocess.run(
            [blender_exe, "--background", "--python", str(script_path), "--", str(glb_path), str(thumb_path), "256"],
            capture_output=True,
            text=True,
            timeout=120
        )
        
        if result.returncode == 0 and thumb_path.exists():
            return FileResponse(str(thumb_path), media_type="image/png")
        else:
            logger.error(f"Thumbnail generation failed: {result.stderr}")
            raise HTTPException(status_code=500, detail="Failed to generate thumbnail")
            
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Thumbnail generation timed out")
    except Exception as e:
        logger.error(f"Thumbnail generation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
