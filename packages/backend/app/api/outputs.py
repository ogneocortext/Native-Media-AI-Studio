"""
Output files API routes.
Returns list of generated media and their JSON sidecar metadata.
"""

import json
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from ..core.config import config

router = APIRouter(prefix="/api/outputs", tags=["Outputs"])


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

    if ext in image_exts:
        return "image"
    elif ext in video_exts:
        return "video"
    elif ext in audio_exts:
        return "audio"
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


def find_cover_image(video_path: Path, relative_base: Path) -> str | None:
    """Find cover/thumbnail image for a video file"""
    possible_covers = [
        video_path.with_suffix(".jpg"),
        video_path.with_suffix(".jpeg"),
        video_path.with_suffix(".png"),
        video_path.with_suffix(".webp"),
        video_path.with_name(video_path.stem + ".jpg"),
        video_path.with_name(video_path.stem + ".jpeg"),
        video_path.with_name(video_path.stem + ".png"),
        video_path.with_name(video_path.stem + ".webp"),
    ]
    for cover_path in possible_covers:
        if cover_path.exists() and cover_path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}:
            try:
                rel_path = cover_path.relative_to(relative_base)
                return rel_path.as_posix() if hasattr(rel_path, 'as_posix') else str(rel_path).replace('\\', '/')
            except ValueError:
                continue
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

        # Skip cover sidecars in audio folder (they are thumbnails, not standalone images)
        if subdir == "audio" and file_path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}:
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

        # Find / extract cover image for videos and audio (embedded art)
        cover_image = None
        if file_type == "video":
            cover_image = find_cover_image(file_path, relative_base)
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
            metadata=metadata,
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

    Reads the output/ directory and returns generated media files
    along with their JSON sidecar metadata.
    """
    all_outputs: list[OutputFile] = []

    output_base = Path(config.output_dir)
    for subdir in ["images", "video", "audio"]:
        outputs = await scan_output_directory(subdir, output_base)
        all_outputs.extend(outputs)

    all_outputs.sort(key=lambda x: x.created_at, reverse=True)

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

    images_count = len([o for o in all_outputs if o.file_type == "image"])
    videos_count = len([o for o in all_outputs if o.file_type == "video"])
    audio_count = len([o for o in all_outputs if o.file_type == "audio"])

    total = len(all_outputs)
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


@router.get("/{file_type}", response_model=list[OutputFile])
async def list_outputs_by_type(
    file_type: str, limit: int = Query(50, ge=1, le=200)
) -> list[OutputFile]:
    """List outputs filtered by type (images, video, audio)."""
    valid_types = {"images": "image", "video": "video", "audio": "audio"}

    if file_type not in valid_types:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type. Must be one of: {list(valid_types.keys())}",
        )

    output_base = Path(config.output_dir)
    outputs = await scan_output_directory(file_type, output_base)

    # Sort by creation time (newest first) and limit
    outputs.sort(key=lambda x: x.created_at, reverse=True)
    return outputs[:limit]


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
