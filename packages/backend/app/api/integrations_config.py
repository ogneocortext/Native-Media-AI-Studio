"""
Integrations API - for external service integration.
"""

import json
import logging
import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..adapters.registry import adapter_registry
from ..core.config import PROJECT_ROOT
from ..core.urls import backend_events_url, backend_ws_url, go_dashboard_url

logger = logging.getLogger(__name__)

# Router without prefix - included by main integrations.py with prefix "/api/integrations"
router = APIRouter(tags=["Integrations-Config"])

CONFIG_PORTS_PATH = PROJECT_ROOT / "config" / "ports.json"


@router.get("/")
async def list_integrations() -> dict:
    """List available integrations"""
    return {
        "integrations": [
            {"name": "comfyui", "type": "workflow", "display": "ComfyUI"},
            {"name": "ollama", "type": "llm", "display": "Ollama"},
        ]
    }


async def ensure_vram_available(required_mb: int = 4096) -> dict:
    """Advisory VRAM preflight for request handlers.

    Delegates to ``vram_manager.preflight_check``, which is read-only with
    respect to workload state. Using ``begin_3d_generation`` here would mark
    ComfyUI busy / set workload=RENDER_3D with no matching
    ``end_3d_generation`` cleanup (these call sites only enqueue work), leaving
    the VRAM manager permanently reporting a 3D render in flight.
    """
    try:
        from ..services.vram_manager import vram_manager
        return await vram_manager.preflight_check(required_mb)
    except Exception as exc:
        logger.warning("VRAM check failed: %s", exc)
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
            encoding="utf-8", errors="replace",
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
        from ..core import ollama_client as _oc
        models = await _oc.list_models(timeout=5)
        if models is not None:
            resources["ollama_available"] = True
            resources["ollama_models"] = [
                {"name": m.get("name", ""), "size": m.get("size", 0)}
                for m in models
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


# ──────────────────────────────────────────────────────────────────────────────
# Model Verification — Known working models from empirical testing (2026-10-07)
# ──────────────────────────────────────────────────────────────────────────────

# Models verified to work correctly with all features (chat, tools, vision, blender)
VERIFIED_WORKING_MODELS = {
    # Text/Chat - fastest and most reliable
    "gemma4:e2b-it-qat": {
        "verified": True,
        "verified_features": ["chat", "tools", "vision", "blender", "visualizer"],
        "performance": {"tokens_per_sec": 104, "vision_latency_sec": 27},
        "notes": "Fastest overall; works for all features",
    },
    # Vision - optimized variants
    "qwen3-vl-optimized:latest": {
        "verified": True,
        "verified_features": ["chat", "vision"],
        "performance": {"tokens_per_sec": 0, "vision_latency_sec": 8},
        "notes": "Fastest vision model (~8s)",
    },
    "gemma4-vision-optimized:latest": {
        "verified": True,
        "verified_features": ["chat", "vision"],
        "performance": {"tokens_per_sec": 0, "vision_latency_sec": 95},
        "notes": "Good vision quality, slower",
    },
    "llamacpp:94c2d4e5": {  # partial match for llama.cpp vision models
        "verified": True,
        "verified_features": ["chat", "vision"],
        "performance": {"tokens_per_sec": 0, "vision_latency_sec": 11},
        "notes": "Good llama.cpp vision variant",
    },
}

# Models with known issues - should be hidden or warned
BROKEN_MODELS = {
    "qwen3-vl:2b": {"reason": "timeout, thinking-only output"},
    "qwen3-vl:4b": {"reason": "timeout >120s"},
    "minicpm-v:8b": {"reason": "timeout >180s"},
    "qwen3.5:9b": {"reason": "timeout 180s for blender script"},
    "openbmb/minicpm-v4.6:q4_K_M": {"reason": "invalid Blender API output"},
    "deepseek-v4-flash:cloud": {"reason": "cloud model, /api/show fails"},
}


def is_model_verified(name: str) -> tuple[bool, dict]:
    """Check if a model is verified working and return verification info."""
    # Exact match
    if name in VERIFIED_WORKING_MODELS:
        return True, VERIFIED_WORKING_MODELS[name]
    # Partial match for llama.cpp models with hash suffixes
    for key, info in VERIFIED_WORKING_MODELS.items():
        if name.startswith(key.split(":")[0]) and ":" in key:
            return True, info
    # Check if known broken
    if name in BROKEN_MODELS:
        return False, {"verified": False, "broken_reason": BROKEN_MODELS[name]["reason"]}
    # Unknown model - not verified
    return False, {"verified": False, "broken_reason": "not_tested"}


def _describe_model(m: dict, resolved: dict[str, list[str] | None], oc) -> dict:
    """One model row for /ollama/models.

    Reports what the model can actually do. This used to collapse to
    ["chat","tools"] or ["chat"], which threw away vision, thinking and audio - so a
    vision model was indistinguishable from a text one and callers could not filter
    a picker correctly. On Ollama 0.35.x both /api/tags and /api/show carry
    authoritative capabilities, with /api/show as the fallback for servers that omit
    the field.
    """
    name = m.get("name", "")
    caps = resolved.get(name) or oc.normalize_capabilities(m.get("capabilities")) or ["chat"]
    capability_set = set(caps)
    tool_capable = "tools" in capability_set

    # Get verification status
    verified, verify_info = is_model_verified(name)

    return {
        "id": name,
        "model_name": name,
        "model_size": m.get("size", 0),
        "model_digest": m.get("digest", ""),
        "is_tool_capable": tool_capable,
        "vram_required": oc.estimate_model_vram_mb(name, m.get("size", 0)),
        "is_available": True,
        "capabilities": caps,
        "supports_tools": tool_capable,
        "supports_vision": "vision" in capability_set,
        "supports_thinking": "thinking" in capability_set,
        # Verification fields
        "verified": verified,
        "verified_features": verify_info.get("verified_features", []),
        "performance": verify_info.get("performance", {}),
        "verification_notes": verify_info.get("notes", ""),
        "broken_reason": verify_info.get("broken_reason", ""),
    }


@router.get("/ollama/models", operation_id="get_ollama_models_alias")
@router.get("/ollama-models", operation_id="get_config_ollama_models")
async def get_ollama_models(verified_only: bool = False) -> dict:
    """Get available Ollama models with capability info and VRAM requirements.

    Args:
        verified_only: If true, only return models verified to work correctly
    """
    try:
        from ..core import ollama_client as _oc
        entries = await _oc.list_models(timeout=10)
        if entries is None:
            return {"models": [], "count": 0}

        # Deduplicate by model name (Ollama sometimes returns duplicates)
        seen = set()
        unique_entries = []
        for m in entries:
            name = m.get("name", "")
            if name and name not in seen:
                seen.add(name)
                unique_entries.append(m)

        resolved = await _oc.resolve_capabilities_for_entries(unique_entries, timeout=10)
        models = [_describe_model(m, resolved, _oc) for m in unique_entries]

        if verified_only:
            models = [m for m in models if m.get("verified", False)]

        return {
            "models": models,
            "count": len(models),
        }
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
    atomic_chat_url: str | None = None
    atomic_chat_enabled: bool | None = None
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
        "atomic_chat_url": config.atomic_chat_url,
        "atomic_chat_enabled": config.atomic_chat_enabled,
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
    if req.atomic_chat_url is not None:
        config.atomic_chat_url = req.atomic_chat_url
        updates["atomic_chat_url"] = req.atomic_chat_url
    if req.atomic_chat_enabled is not None:
        config.atomic_chat_enabled = req.atomic_chat_enabled
        updates["atomic_chat_enabled"] = req.atomic_chat_enabled
    if req.log_level is not None:
        try:
            from ..core.logging_config import apply_log_level
            config.log_level = apply_log_level(req.log_level)
        except ValueError as exc:
            raise HTTPException(
                status_code=422,
                detail=f"Invalid log_level '{req.log_level}'. Use one of DEBUG, INFO, WARNING, ERROR, CRITICAL.",
            ) from exc
        updates["log_level"] = config.log_level
    if req.max_queue_workers is not None:
        config.max_queue_workers = req.max_queue_workers
        updates["max_queue_workers"] = req.max_queue_workers

    save_config(config)
    return {"updated": updates, "message": "Settings saved. Restart may be required for some changes."}


@router.get("/config/ports")
async def get_ports_config() -> dict:
    """Serve the resolved port configuration written by the port manager.

    Frontend consumers should call this endpoint first; it always reflects
    the backend's actual bound ports.  Falls back to the static
    ``config/ports.json`` file when the port manager has not yet run.
    """
    if CONFIG_PORTS_PATH.exists():
        try:
            with open(CONFIG_PORTS_PATH) as f:
                return json.load(f)
        except Exception as exc:
            logger.warning("Failed to read ports config: %s", exc)

    # Minimal fallback derived from the central config so values never drift.
    from ..core.config import config
    return {
        "backend_port": config.backend_port,
        "frontend_port": config.frontend_port,
        "ws_port": config.ws_port,
        "ws_url": backend_ws_url(),
        "events_url": backend_events_url(),
        "sse_url": backend_events_url(),
        "dashboard_port": 3847,
        "dashboard_url": go_dashboard_url(),
    }


