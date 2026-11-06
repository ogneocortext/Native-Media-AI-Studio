"""
VRAM status monitoring.

Extracted from vram_manager.py. Fetches GPU memory statistics via gpustat,
pynvml, or torch.cuda fallback, and provides resident model detection.
"""

from __future__ import annotations

import asyncio
import json
import logging
import urllib.request
from typing import Any

from ..core.urls import ollama_url
from .vram_config import VRAM_CRITICAL, VRAM_WARNING
from .vram_types import GPUState

logger = logging.getLogger(__name__)

# Probe pynvml once at module import so the torch.cuda fallback path doesn't
# re-import it on every call.
try:
    import pynvml as _pynvml

    _PYNVML_AVAILABLE = True
except Exception:
    _pynvml = None
    _PYNVML_AVAILABLE = False

#: Cache of what Ollama's /api/ps actually reports as resident, refreshed on
#: every verification.  The boolean flags (_ollama_loaded, _atomic_chat_loaded)
#: can drift from reality (e.g. startup unloads Ollama but never flips the flag,
#: or an external process unloads a model).  Always verify against /api/ps
#: before making load/unload decisions on an 8 GB card where a wrong assumption
#: means a 10.8 GB OOM.
_resident_cache: list[str] = []
_resident_cache_ts: float = 0.0
_RESIDENT_CACHE_TTL_S = 2.0


async def _fetch_resident_models() -> list[str]:
    """Return model names Ollama actually has resident on the GPU right now.

    Never raises: network/parse errors return an empty list and leave the
    cache untouched.  Results are cached for _RESIDENT_CACHE_TTL_S to avoid
    hammering /api/ps on every call.
    """
    import time

    global _resident_cache, _resident_cache_ts
    now = time.monotonic()
    if now - _resident_cache_ts < _RESIDENT_CACHE_TTL_S and _resident_cache:
        return list(_resident_cache)
    try:
        req = urllib.request.Request(ollama_url("/api/ps"))
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
        models = [m.get("name", "") for m in (data.get("models") or []) if m.get("name")]
        _resident_cache = models
        _resident_cache_ts = now
        return models
    except Exception:
        return []


def _base_name(name: str) -> str:
    """Strip quant suffix and lowercase for model-name comparison."""
    return str(name or "").split(":")[0].lower()


def classify_resident_models(resident_models: list[str]) -> tuple[bool, bool]:
    """Classify resident models into Ollama-loaded and Atomic Chat-loaded flags.

    Ollama loads gemma4/llama family; Atomic Chat loads qwen3/qwen3_5 family.
    Returns (ollama_loaded, atomic_chat_loaded).
    """
    names = {_base_name(m) for m in resident_models}
    ollama_loaded = any(n.startswith(("gemma4", "llama")) for n in names)
    atomic_chat_loaded = any(n.startswith("qwen3") or "qwen3_5" in n for n in names)
    return ollama_loaded, atomic_chat_loaded


async def get_vram_status(
    *,
    gpustat_available: bool,
    nvml_available: bool,
) -> dict[str, Any]:
    """Get current VRAM usage statistics.

    Tries gpustat / NVML first, falls back to torch.cuda.
    """
    # Try gpustat / NVML first
    if gpustat_available or nvml_available:
        try:
            if gpustat_available:
                return await _get_vram_gpustat()
            elif nvml_available:
                return await _get_vram_nvml()
        except Exception as e:
            logger.warning("Failed to get VRAM status via gpustat/nvml: %s", e)

    # Fallback: torch.cuda (works on WDDM/system python without NVSMI dll)
    try:
        import torch

        if torch.cuda.is_available():
            free, total = torch.cuda.mem_get_info(0)
            used = total - free
            percent = (used / total) * 100 if total else 0
            props = torch.cuda.get_device_properties(0)
            try:
                temp = 0
                util = 0
                if _PYNVML_AVAILABLE and _pynvml is not None:
                    try:
                        _pynvml.nvmlInit()
                        h = _pynvml.nvmlDeviceGetHandleByIndex(0)
                        temp = _pynvml.nvmlDeviceGetTemperature(h, _pynvml.NVML_TEMPERATURE_GPU)
                        util = _pynvml.nvmlDeviceGetUtilizationRates(h).gpu
                    except Exception:
                        pass
            except Exception:
                temp = 0
                util = 0
            return {
                "available": True,
                "total_mb": int(total // (1024 * 1024)),
                "used_mb": int(used // (1024 * 1024)),
                "free_mb": int(free // (1024 * 1024)),
                "percent": round(percent, 1),
                "gpu_utilization": util,
                "temperature": temp,
                "state": _determine_state(percent),
                "fallback": "torch.cuda",
                "name": props.name,
            }
    except Exception as e:
        logger.debug(f"torch.cuda fallback failed: {e}")

    return {"available": False}


def _get_vram_gpustat_sync() -> dict[str, Any]:
    """Get VRAM stats via gpustat (sync version for asyncio.to_thread)."""
    import gpustat

    stats = gpustat.new_query()
    if not stats.gpus:
        return {"available": False}

    gpu = stats.gpus[0]
    if hasattr(gpu, "memory_total"):
        total_mb = gpu.memory_total
        used_mb = gpu.memory_used
        free_mb = gpu.memory_free
    elif hasattr(gpu, "memory") and hasattr(gpu.memory, "total"):
        total_mb = gpu.memory.total
        used_mb = gpu.memory.used
        free_mb = gpu.memory.free
    elif isinstance(getattr(gpu, "entry", None), dict):
        total_mb = int(gpu.entry.get("memory.total", 0))
        used_mb = int(gpu.entry.get("memory.used", 0))
        free_mb = int(gpu.entry.get("memory.total", 0)) - used_mb
    else:
        return {"available": False}
    percent = (used_mb / total_mb) * 100 if total_mb > 0 else 0

    return {
        "available": True,
        "total_mb": int(total_mb),
        "used_mb": int(used_mb),
        "free_mb": int(free_mb),
        "percent": round(percent, 1),
        "gpu_utilization": getattr(gpu, "utilization", 0) or 0,
        "temperature": getattr(gpu, "temperature", 0) or 0,
        "state": _determine_state(percent),
    }


def _get_vram_nvml_sync() -> dict[str, Any]:
    """Get VRAM stats via pynvml (sync version for asyncio.to_thread)."""
    import pynvml

    handle = pynvml.nvmlDeviceGetHandleByIndex(0)
    info = pynvml.nvmlDeviceGetMemoryInfo(handle)
    util = pynvml.nvmlDeviceGetUtilizationRates(handle)
    temp = pynvml.nvmlDeviceGetTemperature(handle, pynvml.NVML_TEMPERATURE_GPU)

    total_mb = info.total / (1024 * 1024)
    used_mb = info.used / (1024 * 1024)
    free_mb = info.free / (1024 * 1024)
    percent = (used_mb / total_mb) * 100 if total_mb > 0 else 0

    return {
        "available": True,
        "total_mb": int(total_mb),
        "used_mb": int(used_mb),
        "free_mb": int(free_mb),
        "percent": round(percent, 1),
        "gpu_utilization": util.gpu,
        "temperature": int(temp),
        "state": _determine_state(percent),
    }


async def _get_vram_gpustat() -> dict[str, Any]:
    """Get VRAM stats via gpustat."""
    return await asyncio.to_thread(_get_vram_gpustat_sync)


async def _get_vram_nvml() -> dict[str, Any]:
    """Get VRAM stats via pynvml."""
    return await asyncio.to_thread(_get_vram_nvml_sync)


def _determine_state(percent: float) -> str:
    """Determine GPU state based on VRAM usage percentage."""
    if percent >= VRAM_CRITICAL:
        return GPUState.CRITICAL.value
    elif percent >= VRAM_WARNING:
        return GPUState.BUSY.value
    return GPUState.AVAILABLE.value


__all__ = [
    "_resident_cache",
    "_resident_cache_ts",
    "_RESIDENT_CACHE_TTL_S",
    "_fetch_resident_models",
    "_base_name",
    "classify_resident_models",
    "get_vram_status",
    "_get_vram_gpustat_sync",
    "_get_vram_nvml_sync",
    "_get_vram_gpustat",
    "_get_vram_nvml",
    "_determine_state",
]
