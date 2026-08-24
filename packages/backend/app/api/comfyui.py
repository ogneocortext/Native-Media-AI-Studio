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
