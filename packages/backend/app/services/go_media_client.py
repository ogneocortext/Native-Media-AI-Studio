"""HTTP client for go-media sidecar.

Replaces direct FFmpeg shell-outs with HTTP calls to `go-media:3848/process`.
All methods return a job dict accepted by go-media, or raise on transport errors.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from ..core.config import config

logger = logging.getLogger(__name__)

_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient | None:
    global _client
    if _client is None:
        base = getattr(config, "go_media_url", "")
        if not base:
            return None
        _client = httpx.AsyncClient(
            base_url=base,
            timeout=httpx.Timeout(300.0, connect=3.0),
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
        resp = await client.get("/api/health")
        resp.raise_for_status()
        return resp.json()
    except Exception as exc:
        logger.debug("go-media health check failed: %s", exc)
        return None


async def process(
    *,
    input: str,
    output: str,
    operation: str = "thumbnail",
    start: str = "00:00:01.000",
    duration: str = "00:00:05.000",
) -> dict[str, Any]:
    """Submit a media job to go-media.

    Args:
        input: Absolute input path.
        output: Absolute output path.
        operation: One of `thumbnail`, `concat`, `normalize`, `extract_audio`.
        start: Start timestamp for thumbnail/concat.
        duration: Duration for concat/normalize.

    Returns:
        JSON response with `status` and `job_id`.
    """
    client = _get_client()
    if client is None:
        raise RuntimeError("go-media URL not configured")
    payload = {
        "input": input,
        "output": output,
        "operation": operation,
        "start": start,
        "duration": duration,
    }
    resp = await client.post("/process", json=payload)
    resp.raise_for_status()
    return resp.json()


async def extract_audio(input: str, output: str) -> dict[str, Any]:
    """Extract WAV audio from a media file."""
    return await process(
        input=input,
        output=output,
        operation="extract_audio",
    )


async def generate_thumbnail(input: str, output: str, start: str = "00:00:01.000") -> dict[str, Any]:
    """Extract a JPEG thumbnail from a video file."""
    return await process(
        input=input,
        output=output,
        operation="thumbnail",
        start=start,
    )


async def concat_clip(input: str, output: str, start: str = "00:00:01.000", duration: str = "00:00:05.000") -> dict[str, Any]:
    """Cut a segment from a video file."""
    return await process(
        input=input,
        output=output,
        operation="concat",
        start=start,
        duration=duration,
    )


async def normalize_audio(input: str, output: str, duration: str = "00:00:05.000") -> dict[str, Any]:
    """Normalize loudness of a media file."""
    return await process(
        input=input,
        output=output,
        operation="normalize",
        duration=duration,
    )
