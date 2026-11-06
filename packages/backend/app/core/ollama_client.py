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
``core/comfyui_client.get_shared_session`` -- see
knowledge-library/backend-debugging-guide.md section Adapter Connection Reuse).

Ollama 0.40.14 compatibility note (2026-11-03):
   - OpenAI-compatible endpoints (/v1/chat/completions, /v1/completions,
     /v1/responses) no longer override model-packaged temperature/top_p
     when clients omit them — they now use the model's own defaults
     instead of 1.0. This module calls Ollama's **native** /api/chat and
     /api/generate endpoints, which were never affected by this change.
   - All callers pass ``temperature`` explicitly in ``extra``/``options``
     where it matters, so explicit values continue to override model
     defaults under 0.40.14. No code change required for 0.40.14.
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

#: Embedding model warm-up state. Ollama's /api/embed has no persistent
#: server-side "loaded" flag for embedding models the way chat models do, so we
#: track warm-up client-side: the first /api/embed call for a given model pays
#: cold-start latency; subsequent calls are warm.
_embed_warmed_up: set[str] = set()

#: Ordered list of embedding models to try. Primary first, then fallbacks.
#: All produce 768-dim vectors so they are interchangeable in the vector index.
_EMBED_MODEL_FALLBACKS: tuple[str, ...] = (
    "nomic-embed-text:v1.5",
    "embeddinggemma-2:270m",
)

#: Concurrency cap for batched embedding during indexing. Ollama /api/embed is
#: a lightweight local round trip; modest parallelism speeds up indexing without
#: overwhelming the GPU.
_EMBED_BATCH_CONCURRENCY = 4


async def get_shared_session() -> aiohttp.ClientSession:
    """Module-level shared session for stateless Ollama API routes.

    Backed by the ``core.http`` registry (per-service tuning lives there).
    """
    return await _http.get_shared_session(_SESSION_KEY, **_http.session_defaults(_SESSION_KEY))


async def close_shared_session() -> None:
    """Close the shared session (app shutdown)."""
    await _http.close_shared_session(_SESSION_KEY)


async def list_models(timeout: float = 10) -> list[dict] | None:
    """GET ``/api/tags``; returns the model list or None on failure.

    Distinguishes connection-refused (Ollama not running) from HTTP errors so
    callers can surface the right message to the user.

    Bounded by ``asyncio.timeout(timeout)``."""
    try:
        session = await get_shared_session()
        async with asyncio.timeout(timeout), session.get(
            ollama_url("/api/tags"),
            timeout=aiohttp.ClientTimeout(total=timeout),
        ) as resp:
            if resp.status != 200:
                logger.warning(
                    "Ollama /api/tags returned HTTP %s; is the server at %s reachable?",
                    resp.status,
                    ollama_url(),
                )
                return None
            data = await resp.json()
            return data.get("models", [])
    except aiohttp.ClientConnectorError as e:
        logger.warning(
            "Ollama /api/tags connection refused: Ollama server may not be running at %s (%s)",
            ollama_url(),
            e,
        )
        return None
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
#     (qwen3.5:9b, qwen3.5:4b, ornith-1.5:9b) -
#     every one a false negative, so working models were hidden from the user.
#   - `tools` and `thinking` were never reported for ANY model, because no name
#     heuristic emitted them. Both are real capabilities in `/api/show`.
#   - `audio` (gemma4) and `decision` (0.35 decision models) were unknown here.
#
# `/api/show` is authoritative and cheap locally, so the name heuristic is now only
# a fallback for when the call fails - which does happen: at least one remote model
# in `/api/tags` returns an error from `/api/show`, because the model lives on
# Ollama's servers, not on this machine.

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

    Bounded by ``asyncio.timeout(timeout)``."""
    if not (model or "").strip():
        return None
    now = time.monotonic()
    hit = _CAPABILITY_CACHE.get(model)
    if hit and now - hit[0] < CAPABILITY_TTL_SEC:
        return list(hit[1])
    try:
        session = await get_shared_session()
        async with asyncio.timeout(timeout), session.post(
            ollama_url("/api/show"),
            json={"model": model},
            timeout=aiohttp.ClientTimeout(total=timeout),
        ) as resp:
            if resp.status != 200:
                logger.debug("Ollama /api/show %s -> HTTP %s", model, resp.status)
                return None
            data = await resp.json(content_type=None)
    except (TimeoutError, aiohttp.ClientError, ValueError) as exc:
        logger.debug("Ollama /api/show failed for %s: %s", model, exc)
        return None
    caps = normalize_capabilities(data.get("capabilities"))
    _CAPABILITY_CACHE[model] = (time.monotonic(), caps)
    return list(caps)


async def get_capabilities_bulk(
    models: list[str], timeout: float = 8
) -> dict[str, list[str] | None]:
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


async def resolve_capabilities_for_entries(
    entries: list[dict], timeout: float = 8
) -> dict[str, list[str] | None]:
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
    return any(
        k in name
        for k in [
            "llama3",
            "mistral",
            "command-r",
            "gemma2",
            "gemma3",
            "gemma4",
            "qwen3",
            "qwen2.5",
            "minicpm-v",
        ]
    )


async def _embed_warmup(model: str) -> None:
    """Run a dummy /api/embed call to load `model` into Ollama memory.

    Ollama loads embedding models on first use; this avoids cold-start latency
    on the first real query. Safe to call repeatedly — second call is a no-op.
    """
    if model in _embed_warmed_up:
        return
    try:
        await embed_text_raw(model, "warm-up")
        _embed_warmed_up.add(model)
        logger.debug("Embedding model warmed up: %s", model)
    except Exception as exc:
        logger.debug("Embedding warm-up failed for %s (non-fatal): %s", model, exc)


async def _embed_model_available(model: str, timeout: float = 5) -> bool:
    """Return True if `model` is listed in Ollama /api/tags.

    Used to verify the embedding model is actually installed before we commit
    to it, so failures surface as configuration errors rather than silent
    vector-search degradation.
    """
    try:
        models = await list_models(timeout=timeout)
    except Exception:
        return False
    if not models:
        return False
    return any(m.get("name", "") == model for m in models)


async def embed_text_raw(
    model: str,
    text: str,
    timeout: float = 30,
) -> list[float] | None:
    """POST ``/api/embed`` for one text using the exact `model` requested.

    No warm-up, no fallback, no logging — the raw primitive. Used by
    :func:`embed_text` (which adds warm-up/fallback) and by :func:`_embed_warmup`.
    Returns the embedding vector or None on failure.

    Bounded by ``asyncio.timeout(timeout)``."""
    if not (text or "").strip():
        return None
    try:
        session = await get_shared_session()
        async with asyncio.timeout(timeout), session.post(
            ollama_url("/api/embed"),
            json={"model": model, "input": text},
            timeout=aiohttp.ClientTimeout(total=timeout),
        ) as resp:
            if resp.status != 200:
                return None
            data = await resp.json()
            embs = data.get("embeddings") or [data.get("embedding")]
            return embs[0] if embs and embs[0] is not None else None
    except Exception as e:
        logger.debug("Ollama /api/embed failed for %s: %s", model, e)
        return None


async def embed_text(
    text: str,
    model: str | None = None,
    timeout: float = 30,
    expected_dim: int | None = None,
) -> list[float] | None:
    """POST ``/api/embed`` for one text; returns the embedding or None.

    Resolves the model with this priority:
      1. explicit ``model`` argument
      2. ``config.embedding_model``
      3. first available fallback from ``_EMBED_MODEL_FALLBACKS``

    Warms up the chosen model on first use and falls back to the next model in
    the tuple if the primary is unavailable or the call fails.

    Args:
        text: Text to embed.
        model: Explicit model name to use.
        timeout: Request timeout in seconds.
        expected_dim: If set, reject embeddings whose dimension doesn't match.
            This prevents silently storing wrong-dimension vectors (e.g. a
            512-dim fallback model's output into a 768-dim index).

    Bounded by ``asyncio.timeout(timeout)`` per candidate model."""
    if not (text or "").strip():
        return None

    candidates = [m for m in (model or config.embedding_model, *_EMBED_MODEL_FALLBACKS) if m]
    # Dedup while preserving order.
    seen: set[str] = set()
    candidates = [m for m in candidates if not (m in seen or seen.add(m))]

    last_error: str | None = None
    for candidate in candidates:
        # Verify the model is installed before we pay for a call.
        if not await _embed_model_available(candidate):
            last_error = f"{candidate} not installed in Ollama"
            logger.warning("Embedding model %s not installed; trying next fallback", candidate)
            continue

        await _embed_warmup(candidate)
        emb = await embed_text_raw(candidate, text, timeout=timeout)
        if emb is not None:
            if expected_dim is not None and len(emb) != expected_dim:
                last_error = f"{candidate} returned {len(emb)}-dim vector, expected {expected_dim}"
                logger.warning(
                    "Embedding dimension mismatch for %s: got %d, expected %d; trying next fallback",
                    candidate,
                    len(emb),
                    expected_dim,
                )
                continue
            return emb
        last_error = f"{candidate} returned empty embedding"
        logger.warning("Embedding call for %s returned empty; trying next fallback", candidate)

    logger.warning("All embedding models failed (last error: %s); returning None", last_error)
    return None


async def embed_text_batch_concurrent(
    texts: list[str],
    model: str | None = None,
    timeout: float = 30,
    expected_dim: int | None = None,
) -> list[list[float] | None]:
    """Embed multiple texts concurrently via /api/embed.

    Unlike :func:`_embed_batch` (serial), this issues up to
    ``_EMBED_BATCH_CONCURRENCY`` requests at once, cutting indexing time for
    large corpora roughly in proportion to concurrency. Results are returned in
    input order; a failed embedding yields ``None`` at that position (callers
    decide how to handle it).

    Args:
        texts: Texts to embed.
        model: Explicit model name to use.
        timeout: Request timeout in seconds.
        expected_dim: If set, reject embeddings whose dimension doesn't match.
            Prevents silently storing wrong-dimension vectors.

    Each individual embed call is bounded by ``asyncio.timeout(timeout)``."""
    if not texts:
        return []

    # Resolve the model once for the whole batch.
    resolved = None
    for candidate in [model or config.embedding_model, *_EMBED_MODEL_FALLBACKS]:
        if not candidate:
            continue
        if await _embed_model_available(candidate):
            resolved = candidate
            break
    if resolved is None:
        return [None] * len(texts)

    await _embed_warmup(resolved)

    semaphore = asyncio.Semaphore(_EMBED_BATCH_CONCURRENCY)

    async def _one(text: str) -> list[float] | None:
        async with semaphore:
            emb = await embed_text_raw(resolved, text, timeout=timeout)
            if emb is not None and expected_dim is not None and len(emb) != expected_dim:
                logger.warning(
                    "Embedding dimension mismatch for %s: got %d, expected %d",
                    resolved,
                    len(emb),
                    expected_dim,
                )
                return None
            return emb

    return await asyncio.gather(*(_one(t) for t in texts))


async def chat_content(
    messages: list[dict],
    model: str | None = None,
    timeout: float = 30,
    extra: dict[str, Any] | None = None,
    *,
    think: bool | str | None = None,
) -> str | None:
    """POST ``/api/chat`` (non-streaming); returns message content or None.

    Args:
        messages: Chat messages with 'role' and 'content'.
        model: Model name; defaults to ``config.default_model``.
        timeout: Request timeout in seconds.
        extra: Additional payload keys merged into the request body.
        think: Thinking mode (bool or ``"high"``/``"medium"``/``"low"``/``"max"``).
            Passed as the top-level ``think`` key. Use ``False`` to disable
            thinking on thinking-capable models -- measured ~65x faster on
            section-labeling tasks (39.5s -> 0.6s on gemma4:e2b-it-qat).

    Bounded by ``asyncio.timeout(timeout)``."""
    payload: dict[str, Any] = {
        "model": model or config.default_model,
        "messages": messages,
        "stream": False,
    }
    if think is not None:
        payload["think"] = think
    payload.update(extra or {})
    try:
        session = await get_shared_session()
        async with asyncio.timeout(timeout), session.post(
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
    *,
    think: bool | str | None = None,
) -> str | None:
    """POST ``/api/generate`` (non-streaming); returns response text or None.

    Args:
        prompt: The input prompt.
        model: Model name (required -- no default, since generate is used for
            specific tasks rather than the default model).
        timeout: Request timeout in seconds.
        extra: Additional payload keys merged into the request body.
        think: Thinking mode (bool or ``"high"``/``"medium"``/``"low"``/``"max"``).
            Note: /api/generate does not honor ``think`` reliably for Qwen3.5/
            DeepSeek models -- prefer ``/api/chat`` with ``think=False`` for
            those. See docs/knowledge-library/ollama-thinking-structured-outputs.md.

    Bounded by ``asyncio.timeout(timeout)``."""
    payload: dict[str, Any] = {
        "model": model,
        "prompt": prompt,
        "stream": False,
    }
    if think is not None:
        payload["think"] = think
    payload.update(extra or {})
    try:
        session = await get_shared_session()
        async with asyncio.timeout(timeout), session.post(
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
