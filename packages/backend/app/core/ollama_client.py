"""
Shared Ollama HTTP helpers.

Consolidates the per-request ``aiohttp.ClientSession()`` blocks and
endpoint URLs previously duplicated across:
- ``api/integrations_generation.py`` (``/api/chat`` enrich, ``/api/embed`` x3)
- ``api/integrations_config.py`` (``/api/tags`` x2)
- ``api/integrations_misc.py`` (``/api/generate`` x2)
- ``api/audio.py`` (``/api/chat`` section labeling)
- ``adapters/ollama.py`` falls back to its own instance session, but the
  URL builders here keep endpoint paths consistent.

All calls share one module-level session (same rationale as
``core/comfyui_client.get_shared_session`` — see
knowledge-library/backend-debugging-guide.md § Adapter Connection Reuse).
"""

from __future__ import annotations

import logging
from typing import Any

import aiohttp

from . import http as _http
from .config import config
from .urls import ollama_url

logger = logging.getLogger(__name__)

_SESSION_KEY = "ollama"


async def get_shared_session() -> aiohttp.ClientSession:
    """Module-level shared session for stateless Ollama API routes.

    Backed by the ``core.http`` registry (per-service tuning lives there).
    """
    return await _http.get_shared_session(_SESSION_KEY, **_http.session_defaults(_SESSION_KEY))


async def close_shared_session() -> None:
    """Close the shared session (app shutdown)."""
    await _http.close_shared_session(_SESSION_KEY)


async def list_models(timeout: float = 10) -> list[dict] | None:
    """GET ``/api/tags``; returns the model list or None on failure."""
    try:
        session = await get_shared_session()
        async with session.get(
            ollama_url("/api/tags"),
            timeout=aiohttp.ClientTimeout(total=timeout),
        ) as resp:
            if resp.status != 200:
                return None
            data = await resp.json()
            return data.get("models", [])
    except Exception as e:
        logger.debug("Ollama /api/tags failed: %s", e)
        return None


def estimate_model_vram_mb(model_name: str) -> int:
    """Rough VRAM estimate from a model name's size tag (70b/13b/7b/...)."""
    name = model_name.lower()
    if "70b" in name:
        return 40000
    if "34b" in name:
        return 20000
    if "13b" in name:
        return 8000
    if "7b" in name:
        return 5000
    if "3b" in name:
        return 3000
    if "1.5b" in name or "1b" in name:
        return 2000
    return 4000


def is_tool_capable_model(model_name: str) -> bool:
    """Heuristic tool-calling support from the model family name."""
    name = model_name.lower()
    return any(k in name for k in ["llama3", "mistral", "command-r", "gemma2"])


async def embed_text(
    text: str,
    model: str | None = None,
    timeout: float = 30,
) -> list[float] | None:
    """POST ``/api/embed`` for one text; returns the embedding or None."""
    if not (text or "").strip():
        return None
    try:
        session = await get_shared_session()
        async with session.post(
            ollama_url("/api/embed"),
            json={"model": model or config.embedding_model, "input": text},
            timeout=aiohttp.ClientTimeout(total=timeout),
        ) as resp:
            if resp.status != 200:
                return None
            data = await resp.json()
            embs = data.get("embeddings") or [data.get("embedding")]
            return embs[0] if embs and embs[0] is not None else None
    except Exception as e:
        logger.debug("Ollama /api/embed failed: %s", e)
        return None


async def chat_content(
    messages: list[dict],
    model: str | None = None,
    timeout: float = 30,
    extra: dict[str, Any] | None = None,
) -> str | None:
    """POST ``/api/chat`` (non-streaming); returns message content or None."""
    payload: dict[str, Any] = {
        "model": model or config.default_model,
        "messages": messages,
        "stream": False,
        **(extra or {}),
    }
    try:
        session = await get_shared_session()
        async with session.post(
            ollama_url("/api/chat"),
            json=payload,
            timeout=aiohttp.ClientTimeout(total=timeout),
        ) as resp:
            if resp.status != 200:
                return None
            data = await resp.json()
            return (data.get("message", {}).get("content") or "").strip() or None
    except Exception as e:
        logger.debug("Ollama /api/chat failed: %s", e)
        return None


async def generate_content(
    prompt: str,
    model: str,
    timeout: float = 30,
    extra: dict[str, Any] | None = None,
) -> str | None:
    """POST ``/api/generate`` (non-streaming); returns response text or None."""
    payload: dict[str, Any] = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        **(extra or {}),
    }
    try:
        session = await get_shared_session()
        async with session.post(
            ollama_url("/api/generate"),
            json=payload,
            timeout=aiohttp.ClientTimeout(total=timeout),
        ) as resp:
            if resp.status != 200:
                return None
            data = await resp.json()
            return (data.get("response", "") or "").strip() or None
    except Exception as e:
        logger.debug("Ollama /api/generate failed: %s", e)
        return None
