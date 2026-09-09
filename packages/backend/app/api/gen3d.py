"""
3D generation API routes.
"""
from __future__ import annotations

import logging
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, UploadFile
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/3d", tags=["3D Generation"])


class Gen3DGenerateRequest(BaseModel):
    """Request for generating a 3D model from text."""

    prompt: str
    output_name: str | None = None
    steps: int = 15
    seed: int = 42
    cfg: float = 7.0


@router.get("/status")
async def gen3d_status() -> dict:
    """3D generation service status."""
    from ..services.gen3d.gen3d_service import gen3d_service
    return gen3d_service.get_status()


@router.get("/models")
async def gen3d_models() -> list[dict]:
    """List generated 3D models (newest first) for the sidebar 'Recent Models' panel."""
    from ..services.gen3d.gen3d_service import gen3d_service
    return gen3d_service.list_models()


@router.post("/generate")
async def gen3d_generate(body: Gen3DGenerateRequest) -> dict:
    """Generate a 3D model from text prompt."""
    from ..services.gen3d.gen3d_service import gen3d_service
    return await gen3d_service.generate_from_text(
        prompt=body.prompt,
        output_name=body.output_name,
        steps=body.steps,
        seed=body.seed,
        cfg=body.cfg,
    )


ALLOWED_REF_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp"}
MAX_REF_IMAGE_BYTES = 15 * 1024 * 1024


@router.post("/generate-image")
async def gen3d_generate_image(
    file: UploadFile = File(...),
    steps: int = 15,
    output_name: str | None = None,
) -> dict:
    """Generate a 3D model from a reference image (face/body lock source).

    Uploads the image to a temp file, runs the Hunyuan3D image-to-3D chain,
    then removes the temp file. Use this with a single anchor reference to
    keep AI-generated characters consistent (see knowledge library:
    character consistency method).
    """
    if file.content_type not in ALLOWED_REF_IMAGE_TYPES:
        from fastapi import HTTPException
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported image type {file.content_type}; use PNG, JPEG, or WebP",
        )
    suffix = Path(file.filename or "reference.png").suffix.lower() or ".png"
    if suffix not in {".png", ".jpg", ".jpeg", ".webp"}:
        suffix = ".png"
    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp_path = Path(tmp.name)
        with tmp_path.open("wb") as out:
            size = 0
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_REF_IMAGE_BYTES:
                    raise ValueError("Reference image exceeds 15 MB")
                out.write(chunk)
        from ..services.gen3d.gen3d_service import gen3d_service
        return await gen3d_service.generate_from_image(
            image_path=str(tmp_path),
            output_name=output_name,
            steps=steps,
        )
    except ValueError as e:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        if tmp_path is not None:
            try:
                tmp_path.unlink(missing_ok=True)
            except OSError:
                pass
