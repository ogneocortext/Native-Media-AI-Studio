"""
VRAM management routes.

Offload/reload/switch-backend-model endpoints that coordinate resident models
on the 8 GB card. Mounted under /api/integrations by main.py.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from ..core.config import config
from ..services.vram_manager import (
    _reload_ollama_models,
    _unload_ollama_models,
    vram_manager,
)

router = APIRouter(tags=["Integrations-VRAM"])


@router.get("/vram/status")
async def get_vram_status() -> dict:
    """Get current VRAM status and GPU workload information"""
    vram = await vram_manager.get_vram_status()
    status = vram_manager.get_status()
    return {
        "vram": vram,
        "manager": status,
    }


@router.post("/vram/offload-ollama")
async def offload_ollama() -> Any:
    """Manually offload Ollama models from GPU to free VRAM"""
    result = await _unload_ollama_models()
    # Sync the resident flag with reality so subsequent load/unload decisions
    # are based on /api/ps truth, not a stale boolean.
    vram_manager._ollama_loaded = False
    return result


@router.post("/vram/reload-ollama")
async def reload_ollama() -> dict:
    """Manually reload Ollama models to GPU"""
    result = await _reload_ollama_models(config.default_model)
    return {"success": result, "model": config.default_model}


@router.post("/vram/switch-backend-model")
async def switch_backend_model(body: dict) -> dict:
    """Coordinated model switch across Ollama and Atomic Chat backends.

    On an 8 GB card, only one model can be resident at a time. Unloads the
    currently resident model (from either backend) before loading the target,
    preventing OOM from both models being resident simultaneously.

    Body: { "backend": "ollama"|"atomic_chat", "model": "model_name" }
    """
    backend = body.get("backend")
    model = body.get("model")
    if not backend or not model:
        return {
            "success": False,
            "error": "Request body must include 'backend' and 'model'",
        }
    return await vram_manager.switch_backend_model(backend, model)
