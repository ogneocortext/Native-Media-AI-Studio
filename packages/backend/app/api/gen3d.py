"""
3D generation API routes.
"""

from __future__ import annotations

import logging
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, field_validator

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/3d", tags=["3D Generation"])


class Gen3DGenerateRequest(BaseModel):
    """Request for generating a 3D model from text."""

    prompt: str
    output_name: str | None = None
    steps: int = 15
    seed: int = 42
    cfg: float = 7.0
    model: str | None = None
    role: str | None = None

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str | None) -> str | None:
        if v is not None and v not in ("hero", "mid", "background", "far"):
            raise ValueError("role must be one of: hero, mid, background, far")
        return v

    @field_validator("prompt")
    @classmethod
    def validate_prompt(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("prompt must not be empty")
        if len(v) > 2000:
            raise ValueError("prompt must be at most 2000 characters")
        return v

    @field_validator("output_name")
    @classmethod
    def validate_output_name(cls, v: str | None) -> str | None:
        if v is not None and len(v) > 200:
            raise ValueError("output_name must be at most 200 characters")
        return v

    @field_validator("steps")
    @classmethod
    def validate_steps(cls, v: int) -> int:
        # Matches the 5-50 slider on the 3D page; distilled variants want low values.
        if v < 1 or v > 50:
            raise ValueError("steps must be between 1 and 50")
        return v

    @field_validator("seed")
    @classmethod
    def validate_seed(cls, v: int) -> int:
        if v < 0:
            raise ValueError("seed must be >= 0")
        return v

    @field_validator("cfg")
    @classmethod
    def validate_cfg(cls, v: float) -> float:
        if v < 0.0 or v > 30.0:
            raise ValueError("cfg must be between 0.0 and 30.0")
        return v


def _resolve_backend(model: str | None) -> str:
    """Map a frontend model id (e.g. 'hunyuan3d-2mini-fast') to a backend key.

    Returns DEFAULT_BACKEND for empty input; raises HTTPException for names
    that are not real backends so a typo can't silently run the default.
    """
    from ..services.gen3d.gen3d_service import DEFAULT_BACKEND, MODEL_BACKENDS

    key = (model or "").strip().lower().replace("-", "_")
    if not key:
        return DEFAULT_BACKEND
    if key not in MODEL_BACKENDS:
        raise HTTPException(status_code=400, detail=f"Unknown 3D backend '{model}'")
    return key


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
    from ..services.vram_manager import vram_manager

    async with vram_manager.work_lane("endpoint:/api/3d/generate"):
        return await gen3d_service.generate_from_text(
            prompt=body.prompt,
            output_name=body.output_name,
            steps=body.steps,
            seed=body.seed,
            cfg=body.cfg,
            backend=_resolve_backend(body.model),
            role=body.role,
        )


ALLOWED_REF_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp"}
MAX_REF_IMAGE_BYTES = 15 * 1024 * 1024


def _sniff_image_type(head: bytes) -> str | None:
    """Return the real image MIME type from magic bytes, or None."""
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return None


@router.post("/generate-image")
async def gen3d_generate_image(
    file: UploadFile = File(...),
    steps: int = Query(15, ge=1, le=50),
    output_name: str | None = Query(None, max_length=200),
    model: str | None = Query(None, max_length=100),
    role: str | None = Query(None, max_length=16),
) -> dict:
    """Generate a 3D model from a reference image (face/body lock source).

    Uploads the image to a temp file, runs the Hunyuan3D image-to-3D chain,
    then removes the temp file. Use this with a single anchor reference to
    keep AI-generated characters consistent (see knowledge library:
    character consistency method).
    """
    if file.content_type not in ALLOWED_REF_IMAGE_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported image type {file.content_type}; use PNG, JPEG, or WebP",
        )
    # Early reject when the client declared a size (not authoritative, but free).
    if file.size is not None and file.size > MAX_REF_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Reference image exceeds 15 MB")
    suffix = Path(file.filename or "reference.png").suffix.lower() or ".png"
    if suffix not in {".png", ".jpg", ".jpeg", ".webp"}:
        suffix = ".png"
    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp_path = Path(tmp.name)
            head = b""
            size = 0
            while chunk := await file.read(1024 * 1024):
                if not head:
                    head = chunk[:16]
                size += len(chunk)
                if size > MAX_REF_IMAGE_BYTES:
                    raise HTTPException(status_code=413, detail="Reference image exceeds 15 MB")
                tmp.write(chunk)
        # content_type is client-supplied; the payload's magic bytes are authoritative.
        if _sniff_image_type(head) not in ALLOWED_REF_IMAGE_TYPES:
            raise HTTPException(
                status_code=415,
                detail="File content is not a valid PNG, JPEG, or WebP image",
            )
        from ..services.gen3d.gen3d_service import gen3d_service
        from ..services.vram_manager import vram_manager

        async with vram_manager.work_lane("endpoint:/api/3d/generate-image"):
            return await gen3d_service.generate_from_image(
                image_path=str(tmp_path),
                output_name=output_name,
                steps=steps,
                backend=_resolve_backend(model),
                role=role,
            )
    finally:
        if tmp_path is not None:
            try:
                tmp_path.unlink(missing_ok=True)
            except OSError:
                pass
