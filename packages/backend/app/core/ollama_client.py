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

import asyncio
import logging
import time
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


def estimate_model_vram_mb(model_name: str, model_size_bytes: int | None = None) -> int:
    """Estimate VRAM from Ollama's reported model size when available.

    Name heuristics remain as a fallback for older API responses, but actual
    GGUF sizes are much more accurate for quant variants (q4, e2b, 4b, 8b).
    """
    if model_size_bytes and model_size_bytes > 0:
        # Runtime needs more than the disk/weights size for KV cache and
        # buffers. Keep a conservative 1.5x multiplier for the 8GB workstation.
        return round(model_size_bytes / (1024 * 1024) * 1.5)
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


# ---------------------------------------------------------------------------
# Model capabilities (Ollama >= 0.5 exposes these; required to be correct here)
# ---------------------------------------------------------------------------
#
# These used to be guessed from the model *name*, and the guesses were wrong.
# Measured against `/api/show` on the 17 models installed on this workstation:
#   - 4 models were reported as NOT vision-capable when they are
#     (qwen3.5:9b, qwen3.5:4b, ornith-1.5:9b, deepseek-v4.1-flash:cloud) -
#     every one a false negative, so working models were hidden from the user.
#   - `tools` and `thinking` were never reported for ANY model, because no name
#     heuristic emitted them. Both are real capabilities in `/api/show`.
#   - `audio` (gemma4) and `decision` (0.35 decision models) were unknown here.
#
# `/api/show` is authoritative and cheap locally, so the name heuristic is now only
# a fallback for when the call fails - which does happen: at least one cloud model
# in `/api/tags` (`deepseek-v4-flash:cloud`) returns an error from `/api/show`,
# because the model lives on Ollama's servers, not on this machine.

#: How long a `/api/show` answer is trusted. Capabilities are a property of an
#: installed model and do not change under a running server, so this only needs to
#: be short enough to pick up a newly pulled or rebuilt model.
CAPABILITY_TTL_SEC = 300

_CAPABILITY_CACHE: dict[str, tuple[float, list[str]]] = {}

#: Ollama's vocabulary mapped onto what this app's UI expects. Ollama says
#: "completion" where the frontend says "chat", and "embedding" where it says
#: "embed". The rest are passed through, including `audio` and `decision`.
_CAPABILITY_ALIASES = {
    "completion": "chat",
    "embedding": "embed",
}

#: Capabilities a decision model does NOT have, even though it may be multimodal.
#: Ollama 0.35.1 reports `decision` *instead of* the others for these models, so
#: this is belt-and-braces against a server that also lists `completion`.
_DECISION_ONLY_BLOCKED = ("chat", "tools", "thinking")


def normalize_capabilities(raw: list[str] | None) -> list[str]:
    """Map Ollama's capability names onto this app's vocabulary."""
    out: list[str] = []
    for cap in raw or []:
        name = _CAPABILITY_ALIASES.get(cap, cap)
        if name not in out:
            out.append(name)
    if "decision" in out:
        out = [c for c in out if c not in _DECISION_ONLY_BLOCKED]
    return out


async def get_model_capabilities(model: str, timeout: float = 8) -> list[str] | None:
    """Authoritative capabilities for `model` via ``/api/show``, or None on failure.

    Returns None rather than an empty list when the call fails, so callers can tell
    "this model has no capabilities" from "we could not ask".
    """
    if not (model or "").strip():
        return None
    now = time.monotonic()
    hit = _CAPABILITY_CACHE.get(model)
    if hit and now - hit[0] < CAPABILITY_TTL_SEC:
        return list(hit[1])
    try:
        session = await get_shared_session()
        async with session.post(
            ollama_url("/api/show"),
            json={"model": model},
            timeout=aiohttp.ClientTimeout(total=timeout),
        ) as resp:
            if resp.status != 200:
                logger.debug("Ollama /api/show %s -> HTTP %s", model, resp.status)
                return None
            data = await resp.json(content_type=None)
    except (aiohttp.ClientError, asyncio.TimeoutError, ValueError) as exc:
        logger.debug("Ollama /api/show failed for %s: %s", model, exc)
        return None
    caps = normalize_capabilities(data.get("capabilities"))
    _CAPABILITY_CACHE[model] = (time.monotonic(), caps)
    return list(caps)


async def get_capabilities_bulk(models: list[str], timeout: float = 8) -> dict[str, list[str] | None]:
    """``/api/show`` for many models concurrently.

    Concurrent because this runs per model-list request and each call is a local
    round trip; serially, 17 models would add visible latency to a dropdown.
    """
    if not models:
        return {}
    results = await asyncio.gather(
        *(get_model_capabilities(m, timeout=timeout) for m in models),
        return_exceptions=True,
    )
    out: dict[str, list[str] | None] = {}
    for model, result in zip(models, results, strict=True):
        out[model] = None if isinstance(result, BaseException) else result
    return out


async def resolve_capabilities_for_entries(entries: list[dict], timeout: float = 8) -> dict[str, list[str] | None]:
    """Capabilities for every model in a ``/api/tags`` list.

    Measured on Ollama 0.35.1: ``/api/tags`` ALREADY carries authoritative
    ``capabilities`` for every model, identical to what ``/api/show`` returns.
    So the cheap path is to read them from the list we already have, and only
    pay for ``/api/show`` on the models where they are missing - which is the
    older-server case this fallback exists for, not the normal one.

    Doing it the other way round (one /api/show per model) means 17 extra round
    trips on this workstation to learn something /api/tags had already said.
    """
    resolved: dict[str, list[str] | None] = {}
    missing: list[str] = []
    for m in entries:
        name = m.get("name")
        if not name:
            continue
        raw = m.get("capabilities")
        if raw:
            resolved[name] = normalize_capabilities(raw)
        else:
            missing.append(name)
    if missing:
        resolved.update(await get_capabilities_bulk(missing, timeout=timeout))
    return resolved


def clear_capability_cache() -> None:
    """Drop cached capabilities (after a pull, or in tests)."""
    _CAPABILITY_CACHE.clear()


def is_tool_capable_model(model_name: str) -> bool:
    """Heuristic tool-calling support from the model family name."""
    name = model_name.lower()
    return any(k in name for k in [
        "llama3", "mistral", "command-r", "gemma2", "gemma3", "gemma4",
        "qwen3", "qwen2.5", "minicpm-v",
    ])


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
