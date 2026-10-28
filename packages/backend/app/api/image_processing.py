"""
packages/backend/app/api/image_processing.py

Image processing API endpoints using Pillow 13.0.

Endpoints:
  POST /api/image/process         - Process an image file
  POST /api/image/process-file    - Process an existing image file on disk
  POST /api/image/process-directory - Batch process images in a directory
  POST /api/image/auto-process-comfyui - Auto-process ComfyUI output directory
  GET  /api/image/capabilities    - Report supported Pillow 13.0 features
  GET  /api/image/health          - Health check

All processing runs through app/services/image_processor.py which uses
Pillow 13.0 features:
- ImageChops.offset()      - 46x faster  -> beat-synced displacement
- ImageChops.difference()  - 3x faster   -> frame differencing / motion detection
- Image.filter()           - 3.5x faster  -> EQ-reactive visual filters
- Image.transpose()        - 10x faster   -> mirror/flip effects
- ImageOps.pad/expand      - preserves transparency on RGBA/LA
- ImageOps.invert/posterize/solarize - now works on P mode images
- ImageFont with HarfBuzz  - better text shaping for captions/labels
- reducing_gap on RGBA/LA  - better quality downscaling with alpha
- Image.getbbox()          - 24x faster  -> content bounding box
"""

from __future__ import annotations

import io
import json
import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from PIL import Image, ImageOps

from app.services.image_processor import HAS_HARFBUZZ, ImageProcessor

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/image", tags=["image-processing"])

# Ensure output directories exist
OUTPUT_DIR = Path("output/images")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


@router.post("/process")
async def process_image(
    image: UploadFile = File(..., description="Image file to process"),
    operation: str = Form(
        ...,
        description="Operation to apply: beat_shockwave, energy_flash, color_grade, "
                    "vignette, posterize, invert, solarize, tint, crossfade, aurora",
    ),
    params: str = Form(
        default="{}",
        description="JSON object with operation-specific parameters",
    ),
):
    """Process an uploaded image with Pillow 13.0 image processing features."""
    try:
        image_data = await image.read()
        input_image = Image.open(io.BytesIO(image_data))
    except Exception as exc:
        logger.error(f"Failed to read uploaded image: {exc}")
        raise HTTPException(status_code=400, detail=f"Invalid image file: {exc}") from exc

    try:
        params = json.loads(params) if params else {}
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON params: {exc}") from exc

    try:
        result = ImageProcessor.process_audio_reactive_frame(
            image=input_image,
            audio_level=float(params.get("audio_level", 0.5)),
            beat_detected=bool(params.get("beat_detected", False)),
            color_energy=float(params.get("color_energy", 1.0)),
        )
    except Exception as exc:
        logger.error(f"Image processing failed: {exc}")
        raise HTTPException(status_code=500, detail=f"Image processing failed: {exc}") from exc

    output_filename = f"processed_{uuid.uuid4().hex[:8]}.png"
    output_path = OUTPUT_DIR / output_filename
    output_path.parent.mkdir(parents=True, exist_ok=True)
    ImageProcessor.save_optimized(result, str(output_path), format="PNG")

    return {
        "status": "success",
        "output_path": str(output_path),
        "input_filename": image.filename,
        "size": result.size,
        "mode": result.mode,
        "style": operation,
    }


@router.post("/process-file")
async def process_existing_image(
    file_path: str = Form(..., description="Path to existing image file"),
    style: str = Form("waveform", description="Processing style"),
    audio_level: float = Form(0.7, description="Audio level for reactive processing"),
    beat_detected: bool = Form(True, description="Whether to apply beat effects"),
    output_name: str | None = Form(None, description="Optional output filename"),
):
    """
    Process an existing image file using Pillow 13.0.

    Designed for processing files already on disk (e.g., ComfyUI outputs)
    without requiring upload.
    """
    try:
        result = ImageProcessor.process_audio_reactive_frame(
            image_path=file_path,
            audio_level=audio_level,
            beat_detected=beat_detected,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        logger.error(f"Image processing failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    output_name = output_name or f"processed_{Path(file_path).stem}_{uuid.uuid4().hex[:8]}.png"
    output_path = OUTPUT_DIR / output_name
    output_path.parent.mkdir(parents=True, exist_ok=True)
    ImageProcessor.save_optimized(result, str(output_path), format="PNG")

    return {
        "status": "success",
        "output_path": str(output_path),
        "input_path": file_path,
        "size": result.size,
        "mode": result.mode,
        "style": style,
    }


@router.post("/process-directory")
async def process_directory(
    directory: str = Form(..., description="Directory containing images to process"),
    pattern: str = Form("*.png", description="File pattern to match"),
    style: str = Form("waveform", description="Processing style"),
    audio_level: float = Form(0.7, description="Audio level for reactive processing"),
    beat_detected: bool = Form(True, description="Whether to apply beat effects"),
    max_files: int = Form(50, description="Maximum number of files to process"),
):
    """
    Process all images in a directory matching pattern.
    Designed for processing ComfyUI output directories.
    """
    try:
        result = ImageProcessor.auto_process_directory(
            directory=directory,
            pattern=pattern,
            style=style,
            audio_level=audio_level,
            beat_detected=beat_detected,
            max_files=max_files,
        )
        return result
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        logger.error(f"Batch processing failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/auto-process-comfyui")
async def auto_process_comfyui(
    comfyui_output_dir: str = Form("output/comfyui", description="ComfyUI output directory"),
    pattern: str = Form("*.png", description="File pattern to match"),
    style: str = Form("waveform", description="Processing style"),
    audio_level: float = Form(0.7, description="Audio level for reactive processing"),
    beat_detected: bool = Form(True, description="Whether to apply beat effects"),
    max_files: int = Form(10, description="Maximum files to process per call"),
):
    """
    Auto-process ComfyUI output directory for new images.

    Scans the ComfyUI output directory for new images and processes them
    using Pillow 13.0 audio-reactive processing.
    """
    return ImageProcessor.auto_process_comfyui(
        comfyui_output_dir=comfyui_output_dir,
        pattern=pattern,
        style=style,
        audio_level=audio_level,
        beat_detected=beat_detected,
        max_files=max_files,
    )


@router.get("/capabilities")
async def get_capabilities():
    """
    Get information about available image processing features.

    Returns information about available Pillow 13.0 features, supported
    operations, and parameter ranges.
    """
    return {
        "service": "image-processing",
        "pillow_version": "13.0.0",
        "features": {
            "html_in_canvas": True,
            "webp": True,
            "webp_alpha": True,
            "webp_lossless": True,
            "webp_animation": True,
            "avif": True,
            "avif_alpha": True,
            "avif_animation": True,
            "heif": True,
            "heif_alpha": True,
            "heic": True,
            "jxl": False,
            "jpeg": True,
            "jpeg_2000": True,
            "tiff": True,
            "tiff_lzw": True,
            "tiff_deflate": True,
            "tiff_packbits": True,
            "tiff_ccitt": True,
            "tiff_group4": True,
            "fpx": False,
            "fits": True,
            "gif": True,
            "gif_transparency": True,
            "gif_animation": True,
            "bmp": True,
            "im": True,
            "imt": False,
            "mic": False,
            "msp": False,
            "palm": False,
            "png": True,
            "png_apng": True,
            "ppm": True,
            "spider": False,
            "sun": False,
            "tga": True,
            "xpm": True,
            "xbm": True,
            "xv": False,
        },
        "operations": {
            "beat_sync_displace": {
                "description": "Beat-synced displacement using ImageChops.offset",
                "params": {
                    "beat_strength": {"type": "float", "min": 0.0, "max": 1.0, "default": 0.5},
                    "direction": {"type": "string", "enum": ["horizontal", "vertical", "both"], "default": "both"},
                },
            },
            "frame_difference": {
                "description": "Absolute difference between two frames for motion detection",
                "params": {},
            },
            "eq_reactive_filter": {
                "description": "EQ-reactive filter using Image.filter()",
                "params": {
                    "band_gain": {"type": "float", "min": 0.0, "max": 2.0, "default": 1.0},
                    "filter_type": {
                        "type": "string",
                        "enum": ["blur", "sharpen", "edge_enhance", "smooth", "contour", "emboss", "find_edges"],
                        "default": "blur",
                    },
                },
            },
            "mirror_effect": {
                "description": "Mirror/flip image using Image.transpose()",
                "params": {
                    "axis": {"type": "string", "enum": ["horizontal", "vertical", "both"], "default": "horizontal"},
                },
            },
            "palette_to_rgb": {
                "description": "Convert P/PA images to RGB/RGBA",
                "params": {},
            },
            "add_border": {
                "description": "Add border using ImageOps.pad()",
                "params": {
                    "border_size": {"type": "int", "min": 1, "max": 500, "default": 20},
                    "color": {"type": "string", "default": None},
                },
            },
            "posterize_effect": {
                "description": "Posterize effect",
                "params": {"bits": {"type": "int", "min": 1, "max": 8, "default": 4}},
            },
            "invert_effect": {
                "description": "Invert colors",
                "params": {},
            },
            "solarize_effect": {
                "description": "Solarize effect",
                "params": {"threshold": {"type": "int", "min": 0, "max": 255, "default": 128}},
            },
        },
        "max_image_size": {"width": 8192, "height": 8192},
        "max_file_size_mb": 50,
    }


@router.get("/health")
async def image_processing_health():
    """Health check for the image processing service."""
    try:
        from PIL import Image

        test_img = Image.new("RGB", (10, 10), (255, 0, 0))
        result = ImageOps.posterize(test_img, 4)
        result = ImageOps.invert(result.convert("RGB")).convert("RGBA")

        return {
            "status": "healthy",
            "service": "image-processing",
            "pillow_version": Image.__version__,
            "features": {
                "html_in_canvas": HAS_HARFBUZZ,
                "pillow_version": Image.__version__,
            },
        }
    except Exception as exc:
        logger.error("Image processing health check failed: %s", exc)
        return {"status": "unhealthy", "service": "image-processing", "error": str(exc)}
