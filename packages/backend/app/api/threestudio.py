"""
Three.js Studio API routes.
Handles scene export and frame sequence rendering.
"""

from __future__ import annotations

import logging
import operator
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/threestudio", tags=["Three.js Studio"])


class ExportFramesRequest(BaseModel):
    frames: int = Field(default=360, ge=1, le=10000, description="Total frames (360 = 15s @ 24fps)")
    fps: int = Field(default=24, ge=1, le=60, description="Frames per second")
    output_dir: str = Field(..., description="Output directory path")
    scene_name: str | None = Field(default=None, description="Scene name to export")


class ExportFramesResponse(BaseModel):
    success: bool
    frames_rendered: int
    output_path: str | None = None
    message: str


# Rebuild models to ensure they're fully defined
ExportFramesRequest.model_rebuild()
ExportFramesResponse.model_rebuild()


@router.post("/export", response_model=ExportFramesResponse)
async def export_frames(request: ExportFramesRequest):
    """Export a frame sequence from Three.js Studio for video.

    Not implemented: there is no server-side Three.js renderer. The real
    frame-capture path is the Blender frame-package builder
    (tools/blender/frame_package.py, T-VID-17) and the Unity MV renderer.
    Returning 501 rather than a fabricated success keeps the API honest.
    """
    logger.info(f"Frame export requested ({request.frames} frames) but no renderer exists")
    raise HTTPException(
        status_code=501,
        detail=(
            "Three.js frame export is not implemented. Use the Blender "
            "frame-package capture (tools/blender/frame_package.py) or the "
            "Unity MV renderer for frame sequences."
        ),
    )


@router.get("/status", response_model=dict)
async def get_status():
    """Get Three.js Studio status."""
    return {
        "status": "ready",
        "message": "Three.js Studio API is ready"
    }


_MODEL_EXTS = {".glb", ".gltf"}


@router.get("/models")
async def list_models() -> dict:
    """Auto-detected GLB/GLTF assets the studio can load as ``modelUrl``.

    Two servable roots are scanned:

    - ``output/`` (recursive, minus the scanner's excluded state/cache dirs)
      -> ``/output/<relpath>`` via the StaticFiles mount.
    - ``packages/frontend/public/models/`` -> ``/models/<relpath>`` via Vite.

    ``*.original.glb`` decimate backups are skipped, and NSFW-flagged output
    items are excluded server-side like every other general list.
    """
    from ..core.config import PROJECT_ROOT, config
    from ..core.nsfw import hidden_paths
    from .outputs_scanner import _iter_scannable_dirs

    hidden = hidden_paths()
    models: list[dict] = []

    def _entry(path: Path, url: str, rel: str, source: str) -> dict | None:
        if path.name.endswith(".original.glb"):
            return None
        if source == "output" and rel in hidden:
            return None
        try:
            stat = path.stat()
        except OSError:
            return None
        return {
            "name": rel,
            "url": url,
            "size_bytes": stat.st_size,
            "modified": stat.st_mtime,
            "source": source,
        }

    output_base = Path(config.output_dir)
    if output_base.is_dir():
        candidates: list[Path] = []
        for dir_path, _top in _iter_scannable_dirs(output_base):
            try:
                candidates.extend(
                    p for p in dir_path.rglob("*")
                    if p.is_file() and p.suffix.lower() in _MODEL_EXTS
                )
            except OSError:
                continue
        try:
            candidates.extend(
                f for f in output_base.iterdir()
                if f.is_file() and f.suffix.lower() in _MODEL_EXTS
            )
        except OSError:
            pass
        for path in candidates:
            try:
                rel = path.relative_to(output_base).as_posix()
            except ValueError:
                continue
            entry = _entry(path, f"/output/{rel}", rel, "output")
            if entry:
                models.append(entry)

    models_dir = PROJECT_ROOT / "packages" / "frontend" / "public" / "models"
    if models_dir.is_dir():
        try:
            for path in models_dir.rglob("*"):
                if not (path.is_file() and path.suffix.lower() in _MODEL_EXTS):
                    continue
                rel = path.relative_to(models_dir).as_posix()
                entry = _entry(path, f"/models/{rel}", rel, "bundled")
                if entry:
                    models.append(entry)
        except OSError:
            pass

    models.sort(key=operator.itemgetter("modified"), reverse=True)
    return {"models": models, "count": len(models)}
