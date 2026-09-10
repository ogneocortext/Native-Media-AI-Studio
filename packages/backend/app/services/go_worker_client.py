"""HTTP client for go-worker sidecar.

Offloads async job metadata / sidecar persistence from the Python
event loop to the Go worker.  The worker writes JSON sidecars into
``<PROJECT_ROOT>/output/`` and returns the written path.
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
        base = getattr(config, "go_worker_url", "")
        if not base:
            return None
        _client = httpx.AsyncClient(
            base_url=base,
            timeout=httpx.Timeout(10.0, connect=2.0),
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
        logger.debug("go-worker health check failed: %s", exc)
        return None


async def create_job(job_type: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    client = _get_client()
    if client is None:
        return None
    try:
        resp = await client.post("/jobs", json={"type": job_type, "payload": payload})
        resp.raise_for_status()
        return resp.json()
    except Exception as exc:
        logger.debug("go-worker create_job failed: %s", exc)
        return None


async def get_job(job_id: str) -> dict[str, Any] | None:
    client = _get_client()
    if client is None:
        return None
    try:
        resp = await client.get(f"/jobs/{job_id}")
        resp.raise_for_status()
        return resp.json()
    except Exception as exc:
        logger.debug("go-worker get_job %s failed: %s", job_id, exc)
        return None


async def write_sidecar(
    job_id: str,
    data: dict[str, Any],
    filename: str | None = None,
) -> dict[str, Any] | None:
    """Write a JSON sidecar via go-worker.

    Args:
        job_id: The job identifier.
        data: Arbitrary JSON-serializable sidecar payload.
        filename: Optional filename stem.  When provided the worker
            writes ``<filename>.json`` instead of ``<job_id>.json``.

    Returns:
        The worker JSON response (contains ``written`` path) or ``None``.
    """
    client = _get_client()
    if client is None:
        return None
    try:
        params: dict[str, str] = {}
        if filename:
            params["filename"] = filename
        resp = await client.post(
            f"/jobs/{job_id}/sidecar",
            json={"data": data},
            params=params,
        )
        resp.raise_for_status()
        return resp.json()
    except Exception as exc:
        logger.debug("go-worker write_sidecar %s failed: %s", job_id, exc)
        return None
