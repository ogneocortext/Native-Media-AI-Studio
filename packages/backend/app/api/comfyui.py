"""
ComfyUI management API routes.
Provides endpoints to start, stop, and update ComfyUI.
"""

from fastapi import APIRouter

from ..services.comfyui_manager import comfyui_manager

router = APIRouter(prefix="/api/services/comfyui", tags=["ComfyUI"])


@router.get("/status")
async def get_status() -> dict:
    """Get ComfyUI status (installed, running, version)."""
    return comfyui_manager.get_status()


@router.post("/start")
async def start_comfyui(port: int = 8188) -> dict:
    """Start ComfyUI headlessly in the background.

    Args:
        port: Port to run ComfyUI on (default 8188)

    Returns:
        Status dict with success/failure info
    """
    return await comfyui_manager.start(port=port)


@router.post("/stop")
async def stop_comfyui() -> dict:
    """Stop the running ComfyUI process.

    Returns:
        Status dict with success/failure info
    """
    return comfyui_manager.stop()


@router.post("/restart")
async def restart_comfyui(port: int = 8188) -> dict:
    """Restart ComfyUI.

    Args:
        port: Port to run ComfyUI on

    Returns:
        Status dict with success/failure info
    """
    comfyui_manager.stop()
    return await comfyui_manager.start(port=port)


@router.post("/update")
async def update_comfyui() -> dict:
    """Update ComfyUI via git pull.

    Stops ComfyUI if running, pulls latest changes, then restarts.

    Returns:
        Status dict with update details
    """
    return await comfyui_manager.update()


@router.get("/version")
async def get_version() -> dict:
    """Get ComfyUI version information."""
    return comfyui_manager.get_version()


@router.get("/video-models")
async def get_video_models() -> dict:
    """Get video generation models including motion modules and checkpoints."""
    import os
    from ..core.config import PROJECT_ROOT

    comfyui_models_dir = PROJECT_ROOT.parent / "ComfyUI" / "models"

    video_models = []

    # Scan animatediff directories
    animatediff_dirs = [
        "animatediff",
        "animatediff_models",
        "animatediff_motion_lora",
    ]

    for subdir in animatediff_dirs:
        dir_path = comfyui_models_dir / subdir
        if dir_path.exists():
            for f in dir_path.rglob("*"):
                if f.suffix in (".safetensors", ".ckpt") and f.stat().st_size > 1024:
                    video_models.append({
                        "name": f.name,
                        "path": str(f.relative_to(comfyui_models_dir)),
                        "type": "motion_lora" if "lora" in subdir else "motion_module",
                        "size_mb": round(f.stat().st_size / (1024 * 1024), 1),
                    })

    # Also include diffusion_models that might be video-related
    diffusion_dir = comfyui_models_dir / "diffusion_models"
    if diffusion_dir.exists():
        for f in diffusion_dir.rglob("*"):
            if f.suffix in (".safetensors", ".ckpt") and f.stat().st_size > 1024 * 1024:
                name_lower = f.name.lower()
                if any(kw in name_lower for kw in ["wan", "video", "animate", "motion"]):
                    video_models.append({
                        "name": f.name,
                        "path": str(f.relative_to(comfyui_models_dir)),
                        "type": "diffusion_model",
                        "size_mb": round(f.stat().st_size / (1024 * 1024), 1),
                    })

    return {"video_models": video_models}


# Progress and result endpoints moved to integrations_generation.py
# to be under /api/integrations/comfyui/ prefix
