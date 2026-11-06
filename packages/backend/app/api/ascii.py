"""
ASCII Art API Routes
Provides endpoints for ASCII art generation and manipulation.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from ..services.ascii_art_service import (
    AsciiArtService,
    AsciiOptions,
    AsciiResult,
    get_ascii_service,
    image_to_ascii,
    text_to_banner,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ascii", tags=["ASCII Art"])


# ─── Request Models ──────────────────────────────────────────────────────────

class TextToBannerRequest(BaseModel):
    text: str = Field(..., description="Text to convert to banner", min_length=1, max_length=200)
    font: str = Field(default="slant", description="Font name (slant, standard, big, etc.)")
    width: int = Field(default=80, ge=20, le=200, description="Output width")
    color: bool = Field(default=True, description="Enable color output")
    font_list: bool = Field(default=False, description="List available fonts instead")


class ImageToAsciiRequest(BaseModel):
    width: int = Field(default=80, ge=10, le=300)
    height: int = Field(default=40, ge=10, le=200)
    colors: bool = Field(default=True)
    color_mode: str = Field(default="256", pattern="^(none|16|256|truecolor)$")
    format: str = Field(default="symbols", pattern="^(symbols|braille|blocks)$")
    charset: str = Field(default="standard", pattern="^(standard|extended|minimal|braille)$")
    invert: bool = False
    dither: str = Field(default="none", pattern="^(none|floyd-steinberg|ordered)$")


class BannerRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=200)
    font: str = Field(default="slant")
    width: int = Field(default=80, ge=20, le=200)
    color: bool = True


class FontListRequest(BaseModel):
    pass


# ─── Dependency ──────────────────────────────────────────────────────────────

def get_service() -> AsciiArtService:
    return get_ascii_service()


# ─── Endpoints ───────────────────────────────────────────────────────────────

@router.post("/image", response_model=dict)
async def image_to_ascii_endpoint(
    file: UploadFile = File(..., description="Image file to convert"),
    width: int = Form(default=80, ge=10, le=300),
    height: int = Form(default=40, ge=10, le=200),
    colors: bool = Form(default=True),
    color_mode: str = Form(default="256"),
    format: str = Form(default="symbols"),
    charset: str = Form(default="standard"),
    invert: bool = Form(default=False),
    dither: str = Form(default="none"),
    service: AsciiArtService = Depends(get_service),
):
    """
    Convert an uploaded image to ASCII art.
    
    Supports: PNG, JPG, JPEG, WebP, BMP, TIFF, GIF (first frame)
    """
    # Validate file type
    allowed_types = {"image/png", "image/jpeg", "image/jpg", "image/webp", "image/bmp", "image/tiff", "image/gif"}
    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {file.content_type}. Allowed: {', '.join(allowed_types)}"
        )
    
    # Save uploaded file temporarily
    import tempfile
    with tempfile.NamedTemporaryFile(delete=False, suffix=Path(file.filename).suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = Path(tmp.name)
    
    try:
        options = AsciiOptions(
            width=width,
            height=height,
            colors=colors,
            color_mode=color_mode,
            format=format,
            charset=charset,
            invert=invert,
            dither=dither,
        )
        
        result = await service.image_to_ascii(tmp_path, options)
        
        return {
            "success": True,
            "data": {
                "ascii_art": result.ascii_art,
                "width": result.width,
                "height": result.height,
                "format": result.format,
                "source": result.source,
            },
            "metadata": result.metadata,
        }
    finally:
        # Clean up temp file
        try:
            tmp_path.unlink()
        except Exception:
            pass


@router.post("/text", response_model=dict)
async def text_to_banner_endpoint(
    request: TextToBannerRequest,
    service: AsciiArtService = Depends(get_service),
):
    """
    Generate ASCII banner from text using figlet/toilet/PyFiglet.
    """
    try:
        result = await service.text_to_banner(
            text=request.text,
            font=request.font,
            width=request.width,
            color=request.color,
            font_list=request.font_list,
        )
        
        return {
            "success": True,
            "data": {
                "ascii_art": result.ascii_art,
                "width": result.width,
                "height": result.height,
                "format": result.format,
                "source": result.source,
            },
            "metadata": result.metadata,
        }
    except Exception as e:
        logger.error(f"Text to banner failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/banner", response_model=dict)
async def banner_endpoint(
    request: BannerRequest,
    service: AsciiArtService = Depends(get_service),
):
    """
    Simple banner generation endpoint.
    """
    try:
        result = await service.text_to_banner(
            text=request.text,
            font=request.font,
            width=request.width,
            color=request.color,
        )
        
        return {
            "success": True,
            "ascii_art": result.ascii_art,
            "metadata": result.metadata,
        }
    except Exception as e:
        logger.error(f"Banner generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/fonts", response_model=dict)
async def list_fonts(
    request: FontListRequest,
    service: AsciiArtService = Depends(get_service),
):
    """
    List available figlet/toilet fonts.
    """
    try:
        result = await service.text_to_banner("", font_list=True)
        
        return {
            "success": True,
            "fonts": result.metadata.get("fonts", []) if result.metadata else [],
            "count": len(result.metadata.get("fonts", [])) if result.metadata else 0,
        }
    except Exception as e:
        logger.error(f"Font listing failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/tools", response_model=dict)
async def get_tools(
    service: AsciiArtService = Depends(get_service),
):
    """
    Get available ASCII tools and their status.
    """
    tools = service.get_available_tools()
    
    return {
        "success": True,
        "tools": tools,
        "available_count": sum(1 for v in tools.values() if v),
        "total_count": len(tools),
    }


@router.get("/fonts", response_model=dict)
async def get_fonts(
    service: AsciiArtService = Depends(get_service),
):
    """
    Get available figlet/toilet fonts (simple list).
    """
    fonts = service.get_available_fonts()
    
    return {
        "success": True,
        "fonts": fonts,
        "count": len(fonts),
    }


@router.get("/health", response_model=dict)
async def health_check(
    service: AsciiArtService = Depends(get_service),
):
    """
    Health check for ASCII art service.
    """
    tools = service.get_available_tools()
    
    return {
        "status": "healthy",
        "service": "ascii-art",
        "tools": tools,
        "version": "1.0.0",
    }


# ─── Helpers ────────────────────────────────────────────────────────────────

import tempfile
from pathlib import Path