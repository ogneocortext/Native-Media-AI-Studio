"""
ComfyUI management API routes.
Provides endpoints to start, stop, and update ComfyUI,
and to manage the ComfyUI bridge (custom nodes, workflows, config).
"""

import asyncio

from fastapi import APIRouter

from ..services.comfyui_bridge import comfyui_bridge
from ..services.comfyui_manager import comfyui_manager

router = APIRouter(prefix="/api/services/comfyui", tags=["ComfyUI"])


@router.get("/status")
async def get_status() -> dict:
    """Get ComfyUI status (installed, running, version, bridge)."""
    # Run in a thread: version checks spawn git subprocesses that would
    # otherwise block the event loop on every UI poll.
    return await asyncio.to_thread(comfyui_manager.get_status)


@router.post("/start")
async def start_comfyui(port: int = 8188) -> dict:
    """Start ComfyUI headlessly in the background.

    Args:
        port: Port to run ComfyUI on (default 8188)

    Returns:
        Status dict with success/failure info, including bridge link results.
    """
    return await comfyui_manager.start(port=port)


@router.post("/stop")
async def stop_comfyui() -> dict:
    """Stop the running ComfyUI process.

    Returns:
        Status dict with success/failure info
    """
    # stop() can block up to ~15s waiting for graceful shutdown
    return await asyncio.to_thread(comfyui_manager.stop)


@router.post("/restart")
async def restart_comfyui(port: int = 8188) -> dict:
    """Restart ComfyUI.

    Args:
        port: Port to run ComfyUI on

    Returns:
        Status dict with success/failure info
    """
    await asyncio.to_thread(comfyui_manager.stop)
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
    return await asyncio.to_thread(comfyui_manager.get_version)


# ---------------------------------------------------------------------------
# ComfyUI Bridge endpoints
# ---------------------------------------------------------------------------


@router.get("/bridge/status")
async def bridge_status() -> dict:
    """Get ComfyUI bridge status (custom nodes, workflows, integrity)."""
    return comfyui_bridge.get_bridge_status()


@router.post("/bridge/link")
async def bridge_link_nodes() -> dict:
    """Link all configured custom nodes into ComfyUI's custom_nodes/ directory.

    Returns:
        Status dict with linked/failed node lists
    """
    return comfyui_bridge.link_all_configured_nodes()


@router.post("/bridge/unlink")
async def bridge_unlink_nodes() -> dict:
    """Unlink all previously linked custom nodes from ComfyUI.

    Returns:
        Status dict with unlinked/failed node lists
    """
    return comfyui_bridge.unlink_all_nodes()


@router.get("/bridge/nodes")
async def bridge_nodes() -> dict:
    """Get list of configured custom nodes."""
    return {
        "nodes": comfyui_bridge.get_configured_nodes(),
        "available_files": [
            str(p.name) for p in comfyui_bridge.get_available_node_files()
        ],
    }


@router.get("/bridge/workflows")
async def bridge_workflows() -> dict:
    """Get list of available workflow templates."""
    return {
        "workflows": comfyui_bridge.get_workflows(),
        "available_files": [p.name for p in comfyui_bridge.list_available_workflow_files()],
    }


@router.post("/bridge/workflows/{workflow_id}")
async def bridge_load_workflow(workflow_id: str) -> dict:
    """Load a workflow template by ID.

    Args:
        workflow_id: The workflow ID (matches filename without .json)

    Returns:
        Workflow JSON content or error
    """
    workflow = comfyui_bridge.load_workflow(workflow_id)
    if workflow is None:
        return {"error": f"Workflow not found: {workflow_id}"}
    return workflow


@router.get("/bridge/integrity")
async def bridge_integrity() -> dict:
    """Verify bridge integrity (checks source files, workflow files, etc.)."""
    return comfyui_bridge.verify_bridge_integrity()


@router.get("/bridge/models")
async def bridge_models() -> dict:
    """Get list of configured models."""
    return {"models": comfyui_bridge.get_models()}


# Video models endpoint is provided by /api/integrations/comfyui/video-models


# Progress and result endpoints moved to integrations_generation.py
# to be under /api/integrations/comfyui/ prefix
