"""HTTP client for go-gateway sidecar.

Routes backend MCP bridge calls (Unity, Blender, ComfyUI, Ollama)
through the local go-gateway proxy for unified CORS, logging, and
health aggregation. Falls back to direct calls when the gateway is
unavailable so local development without sidecars still works.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from ..core.config import config

logger = logging.getLogger(__name__)

_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient | None:
    global _client
    if _client is None:
        base = getattr(config, "go_gateway_url", "")
        if not base:
            return None
        _client = httpx.AsyncClient(
            base_url=base,
            timeout=httpx.Timeout(15.0, connect=2.0),
        )
    return _client


async def close() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


async def health() -> dict[str, Any] | None:
    client = _get_client()
    if client is None:
        return None
    try:
        resp = await client.get("/health")
        resp.raise_for_status()
        return resp.json()
    except Exception as exc:
        logger.debug("go-gateway health check failed: %s", exc)
        return None


async def proxy_request(
    bridge: str,
    path: str,
    method: str = "GET",
    *,
    params: dict[str, Any] | None = None,
    json_body: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> httpx.Response | None:
    """Send an arbitrary request through go-gateway to a named bridge.

    Args:
        bridge: One of ``unity``, ``blender``, ``comfyui``, ``ollama``.
        path: Path fragment to forward, e.g. ``/api/health``.
        method: HTTP method (default ``GET``).
        params: Optional query-string parameters.
        json_body: Optional JSON payload for POST/PUT requests.
        headers: Optional extra headers to forward.

    Returns:
        The ``httpx.Response`` on success, or ``None`` if the gateway
        is unreachable.
    """
    client = _get_client()
    if client is None:
        return None
    try:
        req = client.build_request(
            method,
            f"/proxy/{bridge}{path}",
            params=params,
            json=json_body,
            headers=headers,
        )
        resp = await client.send(req)
        return resp
    except Exception as exc:
        logger.debug("go-gateway proxy %s %s failed: %s", method, path, exc)
        return None
