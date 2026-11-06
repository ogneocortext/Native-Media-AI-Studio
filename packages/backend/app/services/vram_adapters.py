"""
VRAM model load/unload adapters.

Extracted from vram_manager.py. Contains the synchronous and async wrappers
for calling Ollama's /api/generate (load/unload via keep_alive) and ComfyUI's
/free and /queue endpoints.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any

from ..core.urls import comfyui_url, ollama_url
from .vram_providers import _resolve_atomic_chat_model, _resolve_last_model

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Ollama load/unload (sync -> async wrappers)
# ---------------------------------------------------------------------------


def _unload_ollama_models_sync() -> list[str]:
    """Synchronous helper to unload Ollama models. Returns list of unloaded model names."""
    import urllib.request

    # Get the list of loaded models
    loaded_models: list[str] = []
    try:
        req = urllib.request.Request(ollama_url("/api/ps"))
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
            loaded_models = [m.get("name", "") for m in data.get("models", []) if m.get("name")]
    except Exception as exc:
        logger.debug("VRAM Manager: /api/ps query failed before unload: %s", exc)

    if not loaded_models:
        # Fallback: try the last known model
        last_model = _resolve_last_model(None)
        if last_model:
            loaded_models = [last_model]

    # Unload each loaded model. keep_alive=0 tells Ollama to evict the model
    # immediately; the HTTP response may not arrive before the connection is
    # torn down, so a read timeout is expected and not an error.
    for model_name in loaded_models:
        try:
            data = json.dumps(
                {
                    "model": model_name,
                    "prompt": " ",
                    "keep_alive": 0,
                }
            ).encode()
            req = urllib.request.Request(
                ollama_url("/api/generate"),
                data=data,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            # 2s is enough for the keep_alive=0 handshake; Ollama closes the
            # connection as it evicts, so a read timeout is the normal path.
            with urllib.request.urlopen(req, timeout=2):
                pass
            logger.info("VRAM Manager: Unloaded Ollama model: %s", model_name)
        except (TimeoutError, OSError) as exc:
            # Expected: Ollama closes the connection while evicting.
            logger.debug(
                "VRAM Manager: Unload of %s completed (connection closed): %s", model_name, exc
            )
        except Exception as exc:
            logger.warning("VRAM Manager: Failed to unload Ollama model %s: %s", model_name, exc)

    return loaded_models


async def _unload_ollama_models() -> list[str]:
    """Async wrapper to unload Ollama models without blocking the event loop."""
    return await asyncio.to_thread(_unload_ollama_models_sync)


def _reload_ollama_models_sync(model_name: str) -> bool:
    """Synchronous helper to reload an Ollama model. Returns True on success.
    Uses OLLAMA_KEEP_ALIVE env var if set, defaulting to 5m so model expires
    naturally; also skips reload if model_name is a legacy llama not in config.default_model.
    """
    import urllib.request

    from ..core.config import config as _cfg

    # Don't infinite-pin models; respect OLLAMA_KEEP_ALIVE
    if "llama" in model_name.lower() and model_name != _cfg.default_model:
        logger.info(
            "VRAM Manager: Skipping reload of non-default llama model %s (default is %s)",
            model_name,
            _cfg.default_model,
        )
        return False
    keep_alive = os.environ.get("OLLAMA_KEEP_ALIVE", "5m")
    data = json.dumps(
        {
            "model": model_name,
            "prompt": " ",
            "keep_alive": keep_alive,
        }
    ).encode()

    req = urllib.request.Request(
        ollama_url("/api/generate"),
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    with urllib.request.urlopen(req, timeout=120) as resp:
        resp.read()

    return True


async def _reload_ollama_models(model_name: str) -> bool:
    """Async wrapper to reload an Ollama model without blocking the event loop."""
    return await asyncio.to_thread(_reload_ollama_models_sync, model_name)


# ---------------------------------------------------------------------------
# Atomic Chat load/unload
# ---------------------------------------------------------------------------


def _unload_atomic_chat_models_sync() -> list[str]:
    """Unload Atomic Chat's resident model via Ollama's API.

    Atomic Chat is a wrapper around Ollama -- it loads its model through
    Ollama's `/api/generate`. So unloading means calling Ollama's generate
    with `keep_alive: 0` for Atomic Chat's model name. Returns list of
    unloaded model names.
    """
    import urllib.request

    unloaded: list[str] = []
    model_name = _resolve_atomic_chat_model(None)
    if model_name:
        unloaded.append(model_name)
    else:
        # No provider registered or provider returned None. Do NOT fall back
        # to scanning Ollama's process list -- that could unload Ollama's own
        # model (e.g. gemma4) thinking it belongs to Atomic Chat. Only the
        # provider knows which model Atomic Chat loaded.
        logger.debug(
            "VRAM Manager: No Atomic Chat model name available; skipping "
            "atomic-chat unload to avoid unloading Ollama's model"
        )

    for name in unloaded:
        try:
            data = json.dumps({"model": name, "prompt": " ", "keep_alive": 0}).encode()
            req = urllib.request.Request(
                ollama_url("/api/generate"),
                data=data,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            # 2s is enough; Ollama closes the connection while evicting.
            with urllib.request.urlopen(req, timeout=2):
                pass
            logger.info("VRAM Manager: Unloaded Atomic Chat model: %s", name)
        except (TimeoutError, OSError) as exc:
            logger.debug(
                "VRAM Manager: Atomic Chat unload of %s completed (connection closed): %s",
                name,
                exc,
            )
        except Exception as exc:
            logger.warning("VRAM Manager: Failed to unload Atomic Chat model %s: %s", name, exc)

    return unloaded


async def _unload_atomic_chat_models() -> list[str]:
    """Async wrapper to unload Atomic Chat models without blocking."""
    return await asyncio.to_thread(_unload_atomic_chat_models_sync)


def _load_model_for_backend_sync(backend: str, model: str) -> bool:
    """Load a model for a given backend via Ollama's API.

    Both Ollama and Atomic Chat load models through Ollama's `/api/generate`
    with `keep_alive` set. The difference is only which model name and which
    backend flag gets updated.
    """
    import os
    import urllib.request

    from ..core.config import config as _cfg

    # Don't infinite-pin models; respect OLLAMA_KEEP_ALIVE
    keep_alive = os.environ.get("OLLAMA_KEEP_ALIVE", "5m")

    # Sanitize: never load a non-default llama as the resident model
    if "llama" in model.lower() and model != _cfg.default_model:
        logger.info(
            "VRAM Manager: Skipping load of non-default llama model %s (default is %s)",
            model,
            _cfg.default_model,
        )
        return False

    data = json.dumps({"model": model, "prompt": " ", "keep_alive": keep_alive}).encode()

    req = urllib.request.Request(
        ollama_url("/api/generate"),
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            resp.read()
        logger.info("VRAM Manager: Loaded model %s for backend %s", model, backend)
        return True
    except Exception as exc:
        logger.warning(
            "VRAM Manager: Failed to load model %s for backend %s: %s",
            model,
            backend,
            exc,
        )
        return False


async def _load_model_for_backend(backend: str, model: str) -> bool:
    """Async wrapper to load a model without blocking the event loop."""
    return await asyncio.to_thread(_load_model_for_backend_sync, backend, model)


# ---------------------------------------------------------------------------
# ComfyUI model management
# ---------------------------------------------------------------------------


def _comfyui_queue_depth_sync() -> tuple[int, int]:
    """Return (running, pending) prompt counts. Zeros if ComfyUI is unreachable.

    Used as the safety gate before freeing its models: unloading mid-render
    would strand the running prompt and lose the job, which is not a trade this
    manager is allowed to make on the user's behalf.
    """
    import urllib.request

    try:
        req = urllib.request.Request(comfyui_url("/queue"))
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
        return (
            len(data.get("queue_running") or []),
            len(data.get("queue_pending") or []),
        )
    except Exception:
        # Unreachable ComfyUI holds no models we can evict, and guessing "0"
        # here would let us POST /free at an unknown server.
        return (0, 0)


def _unload_comfyui_models_sync() -> dict[str, Any]:
    """Ask ComfyUI to drop its loaded models and free cached allocator memory.

    Measured on this machine: 1796 MB free -> 7145 MB free, i.e. ~5.3 GB
    reclaimed. That is roughly triple what offloading Ollama returns (~1.7 GB),
    so ComfyUI is the dominant VRAM consumer by a wide margin and has to be part
    of the audio-analysis budget, not just Ollama.

    ComfyUI reloads models lazily on the next prompt, so there is no matching
    "reload" call to make -- unlike Ollama, which keeps a resident model.
    """
    import urllib.request

    running, pending = _comfyui_queue_depth_sync()
    if running or pending:
        return {
            "success": False,
            "skipped": "busy",
            "running": running,
            "pending": pending,
        }

    try:
        payload = json.dumps({"unload_models": True, "free_memory": True}).encode()
        req = urllib.request.Request(
            comfyui_url("/free"),
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10):
            pass
        logger.info("VRAM Manager: Unloaded ComfyUI models and freed VRAM")
        return {"success": True, "skipped": None, "running": 0, "pending": 0}
    except Exception as exc:
        logger.warning("VRAM Manager: ComfyUI /free failed: %s", exc)
        return {"success": False, "skipped": "error", "error": str(exc)}


async def _unload_comfyui_models() -> dict[str, Any]:
    return await asyncio.to_thread(_unload_comfyui_models_sync)


def _comfyui_is_idle_sync() -> bool:
    """True only when ComfyUI has nothing running or queued."""
    running, pending = _comfyui_queue_depth_sync()
    return running == 0 and pending == 0


async def _comfyui_is_idle() -> bool:
    return await asyncio.to_thread(_comfyui_is_idle_sync)


# ---------------------------------------------------------------------------
# Combined offload
# ---------------------------------------------------------------------------


def _offload_backend_models_sync() -> dict[str, list[str]]:
    """Unload ALL models from both Ollama and Atomic Chat backends.

    Returns dict with keys ``ollama`` and ``atomic_chat``, each a list of
    unloaded model names. Used by begin_*_generation methods to ensure no
    model from either backend is resident before a GPU job starts.
    """
    ollama_unloaded = _unload_ollama_models_sync()
    atomic_chat_unloaded = _unload_atomic_chat_models_sync()
    return {
        "ollama": ollama_unloaded,
        "atomic_chat": atomic_chat_unloaded,
    }


async def _offload_backend_models() -> dict[str, list[str]]:
    """Async wrapper for _offload_backend_models_sync."""
    return await asyncio.to_thread(_offload_backend_models_sync)


__all__ = [
    "_unload_ollama_models_sync",
    "_unload_ollama_models",
    "_reload_ollama_models_sync",
    "_reload_ollama_models",
    "_unload_atomic_chat_models_sync",
    "_unload_atomic_chat_models",
    "_load_model_for_backend_sync",
    "_load_model_for_backend",
    "_comfyui_queue_depth_sync",
    "_unload_comfyui_models_sync",
    "_unload_comfyui_models",
    "_comfyui_is_idle_sync",
    "_comfyui_is_idle",
    "_offload_backend_models_sync",
    "_offload_backend_models",
]
