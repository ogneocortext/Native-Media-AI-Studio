"""
Shared aiohttp session registry.

Collapses the three copy-pasted lock + lazy-create session blocks in
``core/comfyui_client.py``, ``core/ollama_client.py`` and
``adapters/music_gen.py`` into one keyed registry. Each key gets its own
session so per-service tuning (connector limits, default timeouts) stays
independent; all sessions share one creation lock since creation is rare
and contention is negligible.

Key configurations (first call wins per key — keys are module-owned, so
each module passes its own constants):
- ``"comfyui"``: limit 10, total 30s (stateless API routes).
- ``"ollama"``: limit 10, total 30s (stateless API routes).
- ``"music-gen"``: limit 10, no total timeout (subprocess generations run
  minutes; every call site passes an explicit per-request timeout, so the
  session default only guards callers that omit one — matching the
  previous bare-``ClientSession()`` behavior exactly).
"""

from __future__ import annotations

import asyncio

import aiohttp

_DEFAULTS: dict[str, dict] = {
    "comfyui": {"connector_limit": 10, "timeout_total": 30.0},
    "ollama": {"connector_limit": 10, "timeout_total": 30.0},
    "music-gen": {"connector_limit": 10, "timeout_total": None},
}

_sessions: dict[str, aiohttp.ClientSession | None] = {}
_lock = asyncio.Lock()


async def get_shared_session(
    key: str = "default",
    *,
    connector_limit: int = 10,
    timeout_total: float | None = 30.0,
) -> aiohttp.ClientSession:
    """Return the shared session for ``key``, creating it on first use."""
    async with _lock:
        session = _sessions.get(key)
        if session is None or session.closed:
            timeout = (
                aiohttp.ClientTimeout(total=timeout_total)
                if timeout_total is not None
                else aiohttp.ClientTimeout()
            )
            session = aiohttp.ClientSession(
                connector=aiohttp.TCPConnector(limit=connector_limit, ttl_dns_cache=300),
                timeout=timeout,
            )
            _sessions[key] = session
        return session


async def close_shared_session(key: str | None = None) -> None:
    """Close the session for ``key``; ``None`` closes all registered sessions."""
    async with _lock:
        keys = [key] if key is not None else list(_sessions.keys())
        for k in keys:
            session = _sessions.get(k)
            if session is not None and not session.closed:
                await session.close()
            _sessions[k] = None


def session_defaults(key: str) -> dict:
    """Documented per-service tuning for ``key`` (used by module wrappers)."""
    return dict(_DEFAULTS.get(key, {"connector_limit": 10, "timeout_total": 30.0}))
