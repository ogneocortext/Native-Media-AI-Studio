"""
Integrations API - Music Video routes.
"""

import os
import time
import logging
from pathlib import Path
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..adapters.registry import adapter_registry
from ..core.config import PROJECT_ROOT, config
from ..models.job import JobCreateRequest, JobType
from ..queue.manager import queue_manager
from .integrations_config import ensure_vram_available, estimate_generation_time

logger = logging.getLogger(__name__)

# Router without prefix - included by main integrations.py with prefix "/api/integrations"
router = APIRouter(tags=["Integrations-MusicVideo"])


class BeatMarker(BaseModel):
    """Beat marker for music video synchronization"""
    time: float
    intensity: str = "medium"  # low, medium, high
    type: str = "beat"  # beat, drop, break, transition
    note: str = ""


class MusicVideoStyle(BaseModel):
    """Visual style configuration for music video"""
    template_id: str
    name: str
    prompt: str
    negative_prompt: str = ""
    color_scheme: dict = {}
    motion_strength: float = 0.5
    complexity: float = 0.5
    beat_reactivity: float = 0.8


class MusicVideoRequest(BaseModel):
    """Request for music video generation with beat-synced visuals"""
    audio_path: str
    style: MusicVideoStyle
    beat_markers: list[BeatMarker] = []
    duration: str = "60s"  # 30s, 60s, 90s, full
    resolution: str = "1080p"  # 720p, 1080p, 4k
    fps: int = 30
    quality: str = "standard"  # draft, standard, high
    num_frames: int = 16
    motion_module: str = "mm_sd_v15_v2.safetensors"


class PreviewGenerationRequest(BaseModel):
    """Request for generating a short preview (5s draft)"""
    audio_path: str
    style: MusicVideoStyle
    beat_markers: list[BeatMarker] = []
    resolution: str = "240p"
    duration_seconds: float = 5.0


@router.get("/music-video/styles")
async def list_music_video_styles() -> dict:
    """List available visual styles for music video generation"""
    return {
        "styles": [
            {
                "id": "cyberpunk_neon",
                "name": "Cyberpunk Neon",
                "category": "energetic",
                "prompt": "cyberpunk cityscape, neon lights, synthwave aesthetic, glowing skyscrapers, purple and cyan colors, futuristic, 4k, highly detailed, cinematic lighting",
                "negative_prompt": "blurry, low quality, daytime, natural lighting",
                "params": {"motion_strength": 0.8, "complexity": 0.9, "beat_reactivity": 0.9},
            },
            {
                "id": "organic_flow",
                "name": "Organic Flow",
                "category": "organic",
                "prompt": "flowing organic forms, nature inspired, water waves, smoke trails, earth tones, peaceful, flowing energy, gentle colors, 4k, ethereal",
                "negative_prompt": "sharp edges, mechanical, geometric, harsh colors",
                "params": {"motion_strength": 0.4, "complexity": 0.6, "beat_reactivity": 0.5},
            },
            {
                "id": "geometric_pulse",
                "name": "Geometric Pulse",
                "category": "geometric",
                "prompt": "geometric shapes, triangles, squares, hexagons, pulsing to beat, sharp edges, minimal, black background, neon outlines, 4k, precise",
                "negative_prompt": "organic, blurry, soft edges, nature",
                "params": {"motion_strength": 0.7, "complexity": 0.8, "beat_reactivity": 1.0},
            },
            {
                "id": "particle_dance",
                "name": "Particle Dance",
                "category": "abstract",
                "prompt": "swirling particles, particle system, bokeh effect, depth of field, thousands of particles, golden ratio spiral, magical, 4k, volumetric lighting",
                "negative_prompt": "blurry, low resolution, noise",
                "params": {"motion_strength": 0.6, "complexity": 0.9, "beat_reactivity": 0.8},
            },
            {
                "id": "vinyl_retro",
                "name": "Vinyl Retro",
                "category": "atmospheric",
                "prompt": "vinyl record spinning, retro aesthetic, vintage colors, warm tones, analog feel, grain texture, 1970s style, 4k, nostalgic",
                "negative_prompt": "modern, digital, cold colors, futuristic",
                "params": {"motion_strength": 0.3, "complexity": 0.5, "beat_reactivity": 0.6},
            },
            {
                "id": "waveform_classic",
                "name": "Waveform Classic",
                "category": "geometric",
                "prompt": "oscilloscope waveform, green phosphor, crt monitor effect, retro tech, audio waveform, electronic, 4k, clean, minimal",
                "negative_prompt": "modern ui, touch screen, colorful",
                "params": {"motion_strength": 0.5, "complexity": 0.4, "beat_reactivity": 1.0},
            },
            {
                "id": "fire_energy",
                "name": "Fire Energy",
                "category": "energetic",
                "prompt": "dynamic flames, fire particles, heat distortion, orange and red colors, energy, intense, powerful, 4k, dramatic lighting",
                "negative_prompt": "cold, blue, calm, peaceful",
                "params": {"motion_strength": 0.9, "complexity": 0.8, "beat_reactivity": 0.9},
            },
        ]
    }


@router.post("/music-video/generate")
async def generate_music_video(request: MusicVideoRequest):
    """
    Generate a music video with beat-synced visuals using ComfyUI.
    Creates a video that reacts to audio beats and follows the specified visual style.
    """
    logger.info("Video generation requested: style=%s, duration=%s, quality=%s", request.style.template_id, request.duration, request.quality)

    adapter = adapter_registry.get("comfyui")
    if not adapter:
        logger.error("Video generation failed: ComfyUI adapter not available")
        raise HTTPException(status_code=503, detail="ComfyUI adapter not available")

    # Build prompt with beat reactivity hints
    style = request.style
    enhanced_prompt = style.prompt
    if style.beat_reactivity > 0.7:
        enhanced_prompt += ", highly reactive to music, beat synchronized, dynamic motion"

    # Calculate video parameters based on duration
    duration_map = {"30s": 30, "60s": 60, "90s": 90, "full": 180}
    target_duration = duration_map.get(request.duration, 60)

    # Resolution mapping
    res_map = {
        "720p": (1280, 720),
        "1080p": (1920, 1080),
        "4k": (3840, 2160),
    }
    width, height = res_map.get(request.resolution, (1920, 1080))

    # Adjust steps based on quality
    steps = {"draft": 10, "standard": 20, "high": 30}.get(request.quality, 20)

    # Estimate generation time
    num_frames = request.num_frames or int(target_duration * request.fps)
    time_estimate = estimate_generation_time(steps, width, height, num_frames, request.fps, request.motion_module)
    logger.info("Estimated generation time: %s seconds (%s min)", time_estimate["estimated_seconds"], time_estimate["estimated_minutes"])

    # Check VRAM availability
    vram_result = await ensure_vram_available(required_mb=4096)
    if not vram_result["available"]:
        logger.error("Video generation failed: insufficient VRAM - %s", vram_result["message"])
        raise HTTPException(status_code=503, detail=f"Insufficient VRAM: {vram_result['message']}")

    if vram_result.get("offloaded"):
        logger.info("Offloaded models to free VRAM before video generation")

    # Queue the job
    job = await queue_manager.enqueue(
        JobCreateRequest(
            job_type=JobType.MUSIC_VIDEO,
            params={
                "audio_path": request.audio_path,
                "prompt": enhanced_prompt,
                "negative_prompt": style.negative_prompt,
                "width": width,
                "height": height,
                "steps": steps,
                "fps": request.fps,
                "duration": target_duration,
                "beat_markers": [m.dict() for m in request.beat_markers],
                "style_template": style.template_id,
                "motion_strength": style.motion_strength,
                "beat_reactivity": style.beat_reactivity,
                "num_frames": num_frames,
                "motion_module": request.motion_module,
                "estimated_seconds": time_estimate["estimated_seconds"],
            },
            max_retries=3,
        )
    )

    logger.info("Video generation job queued: job_id=%s, estimated=%ss", job.id, time_estimate["estimated_seconds"])

    return {
        "job_id": job.id,
        "status": job.status.value,
        "message": f"Music video job queued with {len(request.beat_markers)} beat markers",
        "estimated_duration": target_duration,
        "estimated_seconds": time_estimate["estimated_seconds"],
        "estimated_end_time": time_estimate["estimated_end_time"],
        "vram_status": vram_result,
    }


@router.post("/music-video/style-preview")
async def generate_style_preview(style_id: str) -> dict:
    """
    Generate a preview image for a video style using ComfyUI.
    Uses low resolution and steps for fast preview generation.
    """
    logger.info("Style preview requested for: %s", style_id)

    # Find the style definition
    styles = (await list_music_video_styles())["styles"]
    style_def = next((s for s in styles if s["id"] == style_id), None)
    if not style_def:
        raise HTTPException(status_code=404, detail=f"Style not found: {style_id}")

    adapter = adapter_registry.get("comfyui")
    if not adapter:
        raise HTTPException(status_code=503, detail="ComfyUI adapter not available")

    try:
        # Check VRAM
        vram_result = await ensure_vram_available(required_mb=2048)
        if not vram_result["available"]:
            logger.warning("Insufficient VRAM for style preview: %s", vram_result["message"])
            raise HTTPException(status_code=503, detail=f"Insufficient VRAM: {vram_result['message']}")

        # Generate preview image (low res, fast)
        preview_params = {
            "prompt": style_def["prompt"] + ", single frame, preview, thumbnail",
            "negative_prompt": style_def.get("negative_prompt", "blurry, low quality"),
            "steps": 10,
            "cfg_scale": 7.0,
            "width": 256,
            "height": 256,
            "seed": -1,
            "sampler_name": "Euler a",
        }

        result = await adapter.generate(preview_params)

        if result.get("success"):
            logger.info("Style preview generated successfully for: %s", style_id)
            return {
                "success": True,
                "style_id": style_id,
                "output_path": result.get("output_path", ""),
                "image": result.get("image", ""),
            }
        else:
            logger.error("Style preview generation failed for: %s", style_id)
            raise HTTPException(status_code=500, detail="Preview generation failed")

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Style preview error for %s: %s", style_id, str(e))
        raise HTTPException(status_code=500, detail=f"Preview generation error: {str(e)}")


@router.get("/music-video/job/{job_id}/progress")
async def get_job_progress(job_id: str) -> dict:
    """Get real-time progress for a video generation job."""
    try:
        job = await queue_manager.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

        # Calculate progress percentage
        progress = job.progress or 0
        estimated_seconds = job.params.get("estimated_seconds", 0)
        elapsed = (datetime.utcnow() - job.created_at.replace(tzinfo=None)).total_seconds() if job.created_at else 0

        remaining_seconds = max(0, estimated_seconds - elapsed) if estimated_seconds > 0 else 0
        end_time = (datetime.utcnow() + timedelta(seconds=remaining_seconds)).isoformat() + "Z" if remaining_seconds > 0 else None

        return {
            "job_id": job_id,
            "status": job.status.value,
            "progress": progress,
            "current_step": job.params.get("current_step", 0),
            "total_steps": job.params.get("steps", 20),
            "current_frame": job.params.get("current_frame", 0),
            "total_frames": job.params.get("num_frames", 0),
            "elapsed_seconds": round(elapsed, 1),
            "estimated_seconds": estimated_seconds,
            "remaining_seconds": round(remaining_seconds, 1),
            "estimated_end_time": end_time,
            "error": job.error,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error getting job progress: %s", str(e))
        raise HTTPException(status_code=500, detail=str(e))


class QuickVideoPreviewRequest(BaseModel):
    """Quick preview request for testing video generation."""
    prompt: str = ""
    negative_prompt: str = "blurry, low quality"
    steps: int = 10
    cfg_scale: float = 7.0
    model: str = ""
    duration: int = 5
    style: str = ""


@router.post("/music-video/generate-preview")
async def generate_video_preview(request: QuickVideoPreviewRequest) -> dict:
    """Generate a quick video preview with real-time progress tracking."""
    logger.info("Video preview requested: model=%s, style=%s", request.model, request.style)

    # Find style info
    style_prompt = ""
    if request.style:
        styles = (await list_music_video_styles())["styles"]
        style_def = next((s for s in styles if s["id"] == request.style), None)
        if style_def:
            style_prompt = style_def.get("prompt", "")

    full_prompt = f"{request.prompt}, {style_prompt}".strip(", ") or request.prompt

    if not request.model:
        return {"success": False, "error": "No model selected"}

    # Check VRAM
    vram_result = await ensure_vram_available(required_mb=4096)
    if not vram_result["available"]:
        return {"success": False, "error": vram_result["message"]}

    # Calculate parameters
    num_frames = request.duration * 8  # 8 fps
    width, height = 426, 240  # 240p for speed

    # Estimate time
    time_estimate = estimate_generation_time(request.steps, width, height, num_frames, 8, request.model)

    # Queue job
    job = await queue_manager.enqueue(
        JobCreateRequest(
            job_type=JobType.MUSIC_VIDEO_PREVIEW,
            params={
                "prompt": full_prompt,
                "negative_prompt": request.negative_prompt,
                "width": width,
                "height": height,
                "steps": request.steps,
                "cfg_scale": request.cfg_scale,
                "fps": 8,
                "duration": request.duration,
                "num_frames": num_frames,
                "model": request.model,
                "ckpt_name": request.model,
                "audio_path": "",  # Preview doesn't require audio
                "is_preview": True,
                "estimated_seconds": time_estimate["estimated_seconds"],
            },
            max_retries=1,
        )
    )

    logger.info("Video preview job queued: %s, estimated %ss", job.id, time_estimate["estimated_seconds"])

    return {
        "success": True,
        "job_id": job.id,
        "status": job.status.value if hasattr(job.status, "value") else str(job.status),
        "estimated_seconds": time_estimate["estimated_seconds"],
        "estimated_end_time": time_estimate["estimated_end_time"],
        "message": f"Preview job queued (est. {time_estimate['estimated_seconds']}s)",
    }


@router.post("/music-video/preview")
async def generate_preview(request: PreviewGenerationRequest):
    """
    Generate a short 5-second preview of the music video.
    Uses lower resolution and fewer steps for faster generation.
    """
    adapter = adapter_registry.get("comfyui")
    if not adapter:
        raise HTTPException(status_code=503, detail="ComfyUI adapter not available")

    # Build preview-optimized prompt
    style = request.style
    preview_prompt = style.prompt + ", preview, draft quality"

    # Low resolution for speed
    res_map = {
        "240p": (426, 240),
        "360p": (640, 360),
        "480p": (854, 480),
    }
    width, height = res_map.get(request.resolution, (426, 240))

    # Calculate frames for preview duration
    fps = 8
    num_frames = int(request.duration_seconds * fps)

    job = await queue_manager.enqueue(
        JobCreateRequest(
            job_type=JobType.MUSIC_VIDEO_PREVIEW,
            params={
                "audio_path": request.audio_path,
                "prompt": preview_prompt,
                "negative_prompt": style.negative_prompt,
                "width": width,
                "height": height,
                "steps": 10,  # Fast preview
                "fps": fps,
                "duration": request.duration_seconds,
                "beat_markers": [m.model_dump() for m in request.beat_markers[:4]],  # Limit markers
                "style_template": style.template_id,
                "motion_strength": style.motion_strength,
                "beat_reactivity": style.beat_reactivity,
                "num_frames": num_frames,
                "is_preview": True,
            },
            max_retries=1,  # Previews are low priority
        )
    )

    return {
        "job_id": job.id,
        "status": job.status.value,
        "message": "Preview generation queued (5-second draft)",
        "preview_duration": request.duration_seconds,
    }


@router.get("/music-video/templates")
async def get_workflow_templates() -> dict:
    """Get available ComfyUI workflow templates for music video generation"""
    return {
        "templates": [
            {
                "id": "animatediff_simple",
                "name": "AnimateDiff Simple",
                "description": "Basic AnimateDiff workflow with motion module",
                "models_required": ["mm_sd_v15_v2.safetensors"],
            },
            {
                "id": "animatediff_advanced",
                "name": "AnimateDiff Advanced",
                "description": "Advanced AnimateDiff with controlnet and IP-adapter",
                "models_required": ["mm_sd_v15_v2.safetensors", "controlnet_openpose"],
            },
            {
                "id": "comfy_video_basic",
                "name": "ComfyUI Video Basic",
                "description": "Standard video generation with KSampler",
                "models_required": [],
            },
        ]
    }


