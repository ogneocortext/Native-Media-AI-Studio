"""
Image upscale route.

4x post-process pass (ai-video-trends-2026 Trend 4, comfyui-workflows
section5). ComfyUI 4x-ClearRealityV1 when reachable, FFmpeg lanczos fallback
otherwise. Mounted under /api/integrations by main.py.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(tags=["Integrations-Upscale"])


class UpscaleRequest(BaseModel):
    """Request body for the image upscaler."""

    image: str  # absolute/project-relative path, bare filename, or comfyui/-prefixed ref
    model: str = (
        "4x-ClearRealityV1.safetensors"  # exact ComfyUI-registered name; fuzzy-matched as fallback
    )
    scale: int = 4  # 2 | 4
    prefer_comfyui: bool = True


@router.post("/upscale")
async def upscale_image_endpoint(request: UpscaleRequest) -> dict:
    """Upscale an image 2x/4x for YouTube 4K export without 4K render cost."""
    from ..services.upscale_service import upscale_image

    try:
        result = await upscale_image(
            request.image,
            model=request.model,
            scale=request.scale,
            prefer_comfyui=request.prefer_comfyui,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {
        "success": result.success,
        "engine": result.engine,
        "model": result.model,
        "scale": result.scale,
        "source": result.source,
        "output_path": result.output_path,
        "relative_path": result.relative_path,
        "elapsed_s": result.elapsed_s,
        "warnings": result.warnings,
        "error": result.error,
    }
