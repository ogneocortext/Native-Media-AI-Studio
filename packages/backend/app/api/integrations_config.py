"""
Integrations API - for external service integration.
"""

import os
import time
import logging
from pathlib import Path
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..adapters.registry import adapter_registry
from ..core.config import PROJECT_ROOT
from ..models.job import JobCreateRequest, JobType
from ..queue.manager import queue_manager

logger = logging.getLogger(__name__)

# Router without prefix - included by main integrations.py with prefix "/api/integrations"
router = APIRouter(tags=["Integrations-Config"])


class ImageGenerationRequest(BaseModel):
    """Request for image generation via ComfyUI or other backends"""

    prompt: str
    negative_prompt: str = ""
    steps: int = 20
    cfg_scale: float = 7.0
    width: int = 512
    height: int = 512
    seed: int = -1
    sampler: str = "Euler a"
    backend: str = "comfyui"
    ckpt_name: str = ""


class VideoGenerationRequest(BaseModel):
    """Request for video generation using AnimateDiff"""

    prompt: str
    negative_prompt: str = ""
    steps: int = 20
    cfg_scale: float = 7.0
    width: int = 512
    height: int = 512
    seed: int = -1
    sampler: str = "Euler a"
    num_frames: int = 16  # Number of video frames
    fps: int = 8  # Frames per second
    motion_module: str = "mm_sd_v15_v2.safetensors"


@router.get("/")
async def list_integrations() -> dict:
    """List available integrations"""
    return {
        "integrations": [
            {"name": "comfyui", "type": "workflow", "display": "ComfyUI"},
            {"name": "ollama", "type": "llm", "display": "Ollama"},
        ]
    }


def estimate_generation_time(steps: int, width: int, height: int, num_frames: int, fps: int, model_name: str) -> dict:
    """Estimate video generation time based on parameters."""
    # Base seconds per frame for a 512x512 image at 20 steps on GTX 1070 Ti
    base_sec_per_frame = 2.5
    # Scale by resolution
    resolution_factor = (width * height) / (512 * 512)
    # Scale by steps
    step_factor = steps / 20
    # Scale by model size (larger models are slower)
    model_factor = 1.0
    if "wan" in model_name.lower():
        model_factor = 3.0  # Wan 2.2 5B is ~3x slower
    elif "kandinsky" in model_name.lower():
        model_factor = 2.0
    elif "sd" in model_name.lower() or "v1-5" in model_name.lower():
        model_factor = 1.0
    elif "hunyuan" in model_name.lower():
        model_factor = 1.5

    sec_per_frame = base_sec_per_frame * resolution_factor * step_factor * model_factor
    total_frames = num_frames if num_frames > 0 else int(fps * 5)
    estimated_seconds = sec_per_frame * total_frames

    # Add overhead for loading model, saving, etc.
    overhead_seconds = 10
    estimated_seconds += overhead_seconds

    return {
        "estimated_seconds": round(estimated_seconds, 1),
        "estimated_minutes": round(estimated_seconds / 60, 1),
        "estimated_end_time": (datetime.utcnow() + timedelta(seconds=estimated_seconds)).isoformat() + "Z",
        "sec_per_frame": round(sec_per_frame, 1),
        "total_frames": total_frames,
        "factors": {
            "resolution_factor": round(resolution_factor, 2),
            "step_factor": round(step_factor, 2),
            "model_factor": model_factor,
        }
    }


async def ensure_vram_available(required_mb: int = 4096) -> dict:
    """Check VRAM availability and offload models if needed."""
    try:
        from ..services.vram_manager import vram_manager
        status = await vram_manager.get_vram_status()
        if not status.get("available"):
            return {"available": True, "free_mb": 0, "total_mb": 0, "required_mb": required_mb, "offloaded": False, "message": "VRAM monitoring unavailable — proceeding"}

        free_mb = status.get("free_mb", status.get("memory_free_mb", 0))
        total_mb = status.get("total_mb", status.get("memory_total_mb", 0))

        result = {
            "available": True,
            "free_mb": free_mb,
            "total_mb": total_mb,
            "required_mb": required_mb,
            "offloaded": False,
            "message": f"VRAM OK: {free_mb}MB free of {total_mb}MB",
        }

        if free_mb < required_mb:
            # Try to offload Ollama models first
            from ..services.vram_manager import _unload_ollama_models
            offload_result = await _unload_ollama_models()
            if offload_result.get("success"):
                result["offloaded"] = True
                result["message"] = "Offloaded Ollama models to free VRAM"
                # Re-check after offload
                status = await vram_manager.get_vram_status()
                free_mb = status.get("free_mb", status.get("memory_free_mb", 0))
                result["free_mb"] = free_mb
                if free_mb < required_mb:
                    result["available"] = False
                    result["message"] = f"Insufficient VRAM: {free_mb}MB free, {required_mb}MB required"
            else:
                result["available"] = False
                result["message"] = f"Insufficient VRAM: {free_mb}MB free, {required_mb}MB required"

        return result
    except Exception as e:
        logger.warning(f"VRAM check failed: {e}")
        return {"available": True, "free_mb": 0, "total_mb": 0, "required_mb": required_mb, "offloaded": False, "message": "VRAM check unavailable — proceeding"}


@router.get("/system-resources")
async def get_system_resources() -> dict:
    """Get current system resources including GPU, CPU, RAM, and Ollama status."""
    import subprocess
    import psutil

    resources = {
        "gpu_name": "",
        "gpu_memory_total": 0,
        "gpu_memory_used": 0,
        "gpu_memory_free": 0,
        "gpu_utilization": 0,
        "cpu_percent": 0,
        "ram_total": 0,
        "ram_used": 0,
        "ram_free": 0,
        "ollama_available": False,
        "ollama_models": [],
    }

    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode == 0 and result.stdout.strip():
            parts = result.stdout.strip().split(", ")
            resources["gpu_name"] = parts[0] if len(parts) > 0 else ""
            resources["gpu_memory_total"] = int(parts[1]) if len(parts) > 1 else 0
            resources["gpu_memory_used"] = int(parts[2]) if len(parts) > 2 else 0
            resources["gpu_memory_free"] = int(parts[3]) if len(parts) > 3 else 0
            resources["gpu_utilization"] = int(parts[4]) if len(parts) > 4 else 0
    except Exception:
        pass

    try:
        resources["cpu_percent"] = int(psutil.cpu_percent(interval=0.1))
        ram = psutil.virtual_memory()
        resources["ram_total"] = ram.total // (1024 * 1024)
        resources["ram_used"] = ram.used // (1024 * 1024)
        resources["ram_free"] = ram.available // (1024 * 1024)
    except Exception:
        pass

    try:
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.get("http://127.0.0.1:11434/api/tags", timeout=aiohttp.ClientTimeout(total=5)) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    resources["ollama_available"] = True
                    resources["ollama_models"] = [
                        {"name": m.get("name", ""), "size": m.get("size", 0)}
                        for m in data.get("models", [])
                    ]
    except Exception:
        pass

    return resources


@router.get("/visualization-presets")
async def get_visualization_presets() -> dict:
    """Get all saved visualization presets."""
    from ..core.database import get_all_visualization_presets
    presets = get_all_visualization_presets()
    return {"presets": presets, "count": len(presets)}


@router.get("/ollama-models")
async def get_ollama_models() -> dict:
    """Get available Ollama models with capability info and VRAM requirements."""
    import aiohttp

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get("http://127.0.0.1:11434/api/tags", timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    models = []
                    for m in data.get("models", []):
                        model_name = m.get("name", "")
                        vram_estimate = 4000
                        if "70b" in model_name.lower():
                            vram_estimate = 40000
                        elif "34b" in model_name.lower():
                            vram_estimate = 20000
                        elif "13b" in model_name.lower():
                            vram_estimate = 8000
                        elif "7b" in model_name.lower():
                            vram_estimate = 5000
                        elif "3b" in model_name.lower():
                            vram_estimate = 3000
                        elif "1.5b" in model_name.lower() or "1b" in model_name.lower():
                            vram_estimate = 2000

                        is_tool_capable = any(k in model_name.lower() for k in ["llama3", "mistral", "command-r", "gemma2"])

                        models.append({
                            "id": model_name,
                            "model_name": model_name,
                            "model_size": m.get("size", 0),
                            "model_digest": m.get("digest", ""),
                            "is_tool_capable": is_tool_capable,
                            "vram_required": vram_estimate,
                            "is_available": True,
                            "capabilities": ["chat", "tools"] if is_tool_capable else ["chat"],
                        })

                    return {"models": models, "count": len(models)}
    except Exception as e:
        return {"models": [], "count": 0, "error": str(e)}


@router.get("/{service_name}")
async def get_integration(service_name: str) -> dict:
    """Get integration details"""
    adapter = adapter_registry.get(service_name)
    if not adapter:
        raise HTTPException(status_code=404, detail=f"Unknown service: {service_name}")

    return {
        "name": adapter.name,
        "status": adapter.get_status().value,
        "url": adapter.base_url,
        "mock_mode": adapter.is_mock_mode(),
    }


@router.get("/config/mock-mode")
async def get_mock_mode() -> dict:
    """Get current mock mode status"""
    return {
        "mock_mode": adapter_registry.is_mock_mode(),
        "env_override": os.getenv("MOCK_GENERATION", "false").lower() == "true",
    }


@router.post("/config/mock-mode")
async def set_mock_mode(enabled: bool) -> dict:
    """Enable or disable mock mode for all adapters"""
    adapter_registry.set_mock_mode(enabled)
    return {
        "mock_mode": enabled,
        "message": f"Mock mode {'enabled' if enabled else 'disabled'}. Changes take effect on next health check."
    }


class SettingsUpdateRequest(BaseModel):
    """Request to update application settings"""
    comfyui_url: str | None = None
    ollama_url: str | None = None
    log_level: str | None = None
    max_queue_workers: int | None = None
    default_workflow: str | None = None
    output_node_id: str | None = None
    default_model: str | None = None


@router.get("/config/settings")
async def get_settings() -> dict:
    """Get current application settings"""
    from ..core.config import config
    return {
        "comfyui_url": config.comfyui_url,
        "ollama_url": config.ollama_url,
        "log_level": config.log_level,
        "max_queue_workers": config.max_queue_workers,
        "backend_port": config.backend_port,
        "frontend_port": config.frontend_port,
    }


@router.post("/config/settings")
async def update_settings(req: SettingsUpdateRequest) -> dict:
    """Update application settings and persist to config/settings.json"""
    from ..core.config import config, save_config
    updates = {}
    if req.comfyui_url is not None:
        config.comfyui_url = req.comfyui_url
        updates["comfyui_url"] = req.comfyui_url
    if req.ollama_url is not None:
        config.ollama_url = req.ollama_url
        updates["ollama_url"] = req.ollama_url
    if req.log_level is not None:
        config.log_level = req.log_level
        updates["log_level"] = req.log_level
    if req.max_queue_workers is not None:
        config.max_queue_workers = req.max_queue_workers
        updates["max_queue_workers"] = req.max_queue_workers

    save_config(config)
    return {"updated": updates, "message": "Settings saved. Restart may be required for some changes."}


