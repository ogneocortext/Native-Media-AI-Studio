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


@router.get("/progress/{prompt_id}")
async def get_progress(prompt_id: str) -> dict:
    """Get generation progress for a prompt."""
    import urllib.request
    import json

    base_url = "http://127.0.0.1:8188"

    try:
        # Check queue for running status
        req = urllib.request.Request(f"{base_url}/queue")
        with urllib.request.urlopen(req, timeout=5) as resp:
            queue_data = json.loads(resp.read().decode())

        # Check if prompt is in running queue
        for item in queue_data.get("queue_running", []):
            if len(item) > 2 and item[1] == prompt_id:
                # Extract progress from the prompt data
                prompt_data = item[2] if len(item) > 2 else {}
                return {
                    "status": "running",
                    "prompt_id": prompt_id,
                    "step": prompt_data.get("step", 0),
                    "total_steps": prompt_data.get("steps", 20),
                    "progress": prompt_data.get("progress", 0),
                }

        # Check if prompt is in pending queue
        for item in queue_data.get("queue_pending", []):
            if len(item) > 2 and item[1] == prompt_id:
                return {
                    "status": "pending",
                    "prompt_id": prompt_id,
                    "step": 0,
                    "total_steps": 20,
                    "progress": 0,
                }

        # Check history for completed
        req = urllib.request.Request(f"{base_url}/history/{prompt_id}")
        with urllib.request.urlopen(req, timeout=5) as resp:
            history = json.loads(resp.read().decode())

        if prompt_id in history:
            return {
                "status": "completed",
                "prompt_id": prompt_id,
                "step": 20,
                "total_steps": 20,
                "progress": 100,
            }

        return {
            "status": "unknown",
            "prompt_id": prompt_id,
            "step": 0,
            "total_steps": 20,
            "progress": 0,
        }

    except Exception as e:
        return {
            "status": "error",
            "prompt_id": prompt_id,
            "error": str(e),
            "step": 0,
            "total_steps": 20,
            "progress": 0,
        }


@router.get("/result/{prompt_id}")
async def get_result(prompt_id: str) -> dict:
    """Get the final result of a generation."""
    import urllib.request
    import json
    import base64

    base_url = "http://127.0.0.1:8188"

    try:
        # Check history for the result
        req = urllib.request.Request(f"{base_url}/history/{prompt_id}")
        with urllib.request.urlopen(req, timeout=10) as resp:
            history = json.loads(resp.read().decode())

        if prompt_id in history:
            entry = history[prompt_id]
            outputs = entry.get("outputs", {})
            
            # Find the image output
            for node_id, output in outputs.items():
                if "images" in output:
                    for img in output["images"]:
                        filename = img.get("filename")
                        subfolder = img.get("subfolder", "")
                        if filename:
                            # Download the image
                            import os
                            params = {"filename": filename}
                            if subfolder:
                                params["subfolder"] = subfolder
                            
                            query = "&".join(f"{k}={v}" for k, v in params.items())
                            img_req = urllib.request.Request(f"{base_url}/view?{query}")
                            with urllib.request.urlopen(img_req, timeout=30) as img_resp:
                                img_data = img_resp.read()
                                
                                # Save to output directory
                                from ..core.config import PROJECT_ROOT
                                import uuid
                                from datetime import datetime
                                
                                output_dir = PROJECT_ROOT / "output" / "images"
                                output_dir.mkdir(parents=True, exist_ok=True)
                                
                                filepath = output_dir / filename
                                with open(filepath, "wb") as f:
                                    f.write(img_data)
                                
                                return {
                                    "status": "completed",
                                    "success": True,
                                    "output_path": str(filepath),
                                    "prompt_id": prompt_id,
                                }

            return {"status": "error", "error": "No images found in output", "prompt_id": prompt_id}
        
        return {"status": "pending", "prompt_id": prompt_id}

    except Exception as e:
        return {"status": "error", "error": str(e), "prompt_id": prompt_id}
