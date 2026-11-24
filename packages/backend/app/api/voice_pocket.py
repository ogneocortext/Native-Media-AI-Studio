"""Pocket TTS proxy -- ``/api/voice/pocket/*``.

Server-side proxy to the rig-local Pocket TTS server (see ``config/tts.json``).
The Pocket endpoint is tailnet-only and requires a per-launch Bearer token;
neither the URL nor the token ever reaches the browser -- the frontend only
ever sees these ``/api/voice/pocket/*`` routes.

Speak path confirmed in ``D:\\Tools\\streaming-tts\\pocket\\server\\server.py``:
``POST /speech`` with JSON ``{"text": ..., "voice": ...}`` returns audio
bytes; ``GET /health`` returns model / sample_rate / voices_cached /
preset_voices / busy and also requires the Bearer token.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..core import tts_settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/voice/pocket", tags=["Voice Pocket"])

# Fallback voice lists used only when Pocket /health is unreachable, so the
# Voice Live page can still render its selector in degraded mode.
FALLBACK_CUSTOM_VOICES = ["alba", "maya", "maya-blend65"]
FALLBACK_PRESET_VOICES = [
    "alba", "anna", "azelma", "bill_boerst", "caro_davy", "charles",
    "cosette", "eponine", "eve", "fantine", "george", "jane", "jean",
    "javert", "marius", "mary", "michael", "paul", "peter_yearsley",
    "stuart_bell", "vera",
]

_NOT_CONFIGURED = (
    "Pocket TTS is not configured: {env} is not set -- see config/tts.json"
)
_UNREACHABLE = "Pocket TTS is unreachable -- is the server running?"

# Token file (pocket.token_file) is mtime-cached like tts_settings. The file
# lives outside the repo on the rig; the backend re-reads it on mtime change
# or on force_refresh (401 retry). Never log the token value.
_token_file_cache: str | None = None
_token_file_cache_mtime: float | None = None


def _cfg() -> dict[str, Any]:
    return tts_settings.pocket()


def _base_url() -> str:
    return str(_cfg().get("base_url") or "").rstrip("/")


def _timeout() -> float:
    try:
        return float(_cfg().get("timeout_s") or 30)
    except (TypeError, ValueError):
        return 30.0


def _token_env_name() -> str:
    return str(_cfg().get("token_env") or "POCKET_TTS_TOKEN")


def _token_file_path() -> str | None:
    """Return the configured token file path, or None if not configured."""
    path = _cfg().get("token_file") or ""
    return path.strip() or None


def _read_token_file(path: str, *, force_refresh: bool = False) -> str | None:
    """Read and trim the token file, mtime-cached.

    Returns None on any OSError or empty contents. Re-reads only when mtime
    changes (or force_refresh=True). Never logs the token value.
    """
    global _token_file_cache, _token_file_cache_mtime
    try:
        st = os.stat(path)
    except OSError:
        _token_file_cache = None
        _token_file_cache_mtime = None
        return None
    mtime = st.st_mtime
    if not force_refresh and _token_file_cache is not None and mtime == _token_file_cache_mtime:
        return _token_file_cache
    try:
        value = Path(path).read_text(encoding="utf-8").strip()
    except OSError:
        _token_file_cache = None
        _token_file_cache_mtime = None
        return None
    if not value:
        _token_file_cache = None
        _token_file_cache_mtime = None
        return None
    _token_file_cache = value
    _token_file_cache_mtime = mtime
    logger.info("token loaded from file")
    return value


def _token(*, force_refresh: bool = False) -> str | None:
    """Read the Bearer token: token file first (if configured), then env var.

    File wins because it is the live, per-launch source. With no token file
    configured and no env var, returns None (caller raises the 503).
    Never logs or returns the token value.
    """
    path = _token_file_path()
    if path is not None:
        file_value = _read_token_file(path, force_refresh=force_refresh)
        if file_value is not None:
            return file_value
    env = _token_env_name()
    value = os.environ.get(env)
    if not value or not value.strip():
        return None
    return value.strip()


def _require_token() -> str:
    token = _token()
    if token is None:
        raise HTTPException(
            status_code=503,
            detail=_NOT_CONFIGURED.format(env=_token_env_name()),
        )
    return token


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _fetch_health(token: str) -> dict[str, Any]:
    """GET Pocket /health. 503 when unreachable, 502 on upstream errors.

    On upstream 401, refreshes the token once (force_refresh) and retries
    exactly once if the token changed. A second 401 (or any other non-200)
    surfaces as 502.
    """
    base = _base_url()

    async def _get(tok: str):
        async with httpx.AsyncClient(timeout=_timeout()) as client:
            return await client.get(f"{base}/health", headers=_auth_headers(tok))

    try:
        resp = await _get(token)
    except httpx.HTTPError as exc:
        logger.warning("Pocket TTS health unreachable: %s", exc)
        raise HTTPException(status_code=503, detail=_UNREACHABLE) from exc

    if resp.status_code == 401:
        refreshed = _token(force_refresh=True)
        if refreshed is not None and refreshed != token:
            try:
                resp = await _get(refreshed)
            except httpx.HTTPError as exc:
                logger.warning("Pocket TTS health unreachable on retry: %s", exc)
                raise HTTPException(status_code=503, detail=_UNREACHABLE) from exc

    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Pocket TTS health check failed (upstream {resp.status_code})",
        )
    try:
        data = resp.json()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail="Pocket TTS returned invalid health JSON") from exc
    return data if isinstance(data, dict) else {}


def _bare_voice_name(name: Any) -> str | None:
    """Keep only bare voice names -- absolute .safetensors paths cached by
    Pocket must never reach the frontend."""
    if not isinstance(name, str):
        return None
    n = name.strip()
    if not n or any(c in n for c in "/\\:"):
        return None
    return n


@router.get("/health")
async def pocket_health() -> dict[str, Any]:
    """Proxy Pocket GET /health with only the fields the UI needs."""
    token = _require_token()
    data = await _fetch_health(token)
    return {
        "model": data.get("model"),
        "sample_rate": data.get("sample_rate"),
        "voices_cached": data.get("voices_cached") or [],
        "preset_voices": data.get("preset_voices") or [],
        "busy": bool(data.get("busy")),
    }


@router.get("/voices")
async def pocket_voices() -> dict[str, Any]:
    """One deduped voice list: custom (voices_cached) first, then presets.

    ``alba`` appears in both upstream lists -- custom wins. If /health is
    unreachable the response falls back to the built-in lists with
    ``degraded: true`` so the selector still renders.
    """
    default_voice = str(_cfg().get("default_voice") or "maya-blend65")
    health: dict[str, Any] | None = None
    token = _token()
    if token is not None:
        try:
            health = await _fetch_health(token)
        except HTTPException:
            health = None

    voices: list[dict[str, str]] = []
    seen: set[str] = set()

    if health is None:
        degraded = True
        custom, presets = FALLBACK_CUSTOM_VOICES, FALLBACK_PRESET_VOICES
    else:
        degraded = False
        custom = [
            n for n in (_bare_voice_name(v) for v in (health.get("voices_cached") or []))
            if n is not None
        ]
        presets = [
            n for n in (_bare_voice_name(v) for v in (health.get("preset_voices") or []))
            if n is not None
        ]

    for name in custom:
        if name not in seen:
            seen.add(name)
            voices.append({"name": name, "kind": "custom"})
    for name in presets:
        if name not in seen:
            seen.add(name)
            voices.append({"name": name, "kind": "preset"})

    bare_default = _bare_voice_name(default_voice)
    if bare_default and bare_default not in seen:
        voices.insert(0, {"name": bare_default, "kind": "custom"})
        seen.add(bare_default)

    return {
        "voices": voices,
        "default_voice": bare_default or default_voice,
        "degraded": degraded,
    }


class SpeakRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)
    voice: str = Field(..., min_length=1)


@router.post("/speak")
async def pocket_speak(req: SpeakRequest) -> StreamingResponse:
    """Forward one speak chunk to Pocket POST /speech and stream the audio.

    The upstream body is streamed through untouched so time-to-first-byte
    stays at the Pocket server's native latency instead of paying a full
    buffer-and-forward penalty.

    On upstream 401, refreshes the token once (force_refresh) and retries
    exactly once before streaming begins if the token changed. A second 401
    (or any other non-200) surfaces as 502.
    """
    token = _require_token()
    base = _base_url()

    async def _send(tok: str):
        client = httpx.AsyncClient(timeout=_timeout())
        try:
            upstream_req = client.build_request(
                "POST",
                f"{base}/speech",
                json={"text": req.text, "voice": req.voice},
                headers=_auth_headers(tok),
            )
            resp = await client.send(upstream_req, stream=True)
        except httpx.HTTPError as exc:
            await client.aclose()
            logger.warning("Pocket TTS speak unreachable: %s", exc)
            raise HTTPException(status_code=503, detail=_UNREACHABLE) from exc
        return client, resp

    client, resp = await _send(token)

    if resp.status_code == 401:
        refreshed = _token(force_refresh=True)
        if refreshed is not None and refreshed != token:
            await client.aclose()
            client, resp = await _send(refreshed)

    if resp.status_code != 200:
        await resp.aclose()
        await client.aclose()
        # Plain 502 carrying the upstream status -- no plumbing details.
        raise HTTPException(
            status_code=502,
            detail=f"Pocket TTS speak failed (upstream {resp.status_code})",
        )

    content_type = (resp.headers.get("content-type") or "application/octet-stream").split(";")[0].strip()

    async def stream_audio():
        try:
            async for chunk in resp.aiter_bytes():
                yield chunk
        finally:
            await resp.aclose()
            await client.aclose()

    return StreamingResponse(stream_audio(), media_type=content_type)
