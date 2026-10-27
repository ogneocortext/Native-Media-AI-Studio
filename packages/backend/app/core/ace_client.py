"""
ACE-Step HTTP client abstraction.

This client sits between the app and the ACE-Step subprocess service
(``tools/music-gen/server.py``). It is the isolation layer: if ACE-Step is
updated by the provider and its request/response shapes change, only this
client (and the bridge config) needs updating -- the rest of the app keeps
calling the same stable methods.

All methods raise :class:`ACEClientError` on failure; callers decide whether
to fall back to mock mode or surface the error to the user.
"""

from __future__ import annotations

import logging
from typing import Any

import aiohttp

logger = logging.getLogger(__name__)


class ACEClientError(Exception):
    """Raised when the ACE-Step client cannot complete a request."""


class ACEClient:
    """
    Normalized client for the ACE-Step subprocess service.

    The service exposes HTTP endpoints at ``base_url``. This client wraps them
    with typed methods and normalizes parameter/response shapes so the rest of
    the app never sees ACE-Step's raw wire format.

    Bridge config (``config/ace-step/bridge.json``) drives the parameter map,
    so a provider update that renames ``cfg_scale`` -> ``guidance`` only
    requires a config change, not a code change.
    """

    def __init__(
        self,
        base_url: str = "http://127.0.0.1:8201",
        param_map: dict[str, str] | None = None,
        response_map: dict[str, str] | None = None,
        session: aiohttp.ClientSession | None = None,
    ):
        self.base_url = base_url.rstrip("/")
        self._param_map = param_map or {}
        self._response_map = response_map or {}
        self._session = session  # injected; if None, a short-lived session is used

    # ------------------------------------------------------------------
    # Parameter normalization
    # ------------------------------------------------------------------

    def _map_params(self, params: dict[str, Any]) -> dict[str, Any]:
        """Rename keys according to the bridge compatibility map.

        App code always uses canonical names (``cfg_scale``). If a provider
        update renames the wire parameter (e.g. ``guidance``), add an entry to
        the map and this client translates automatically.
        """
        if not self._param_map:
            return params
        mapped: dict[str, Any] = {}
        for key, value in params.items():
            mapped[self._param_map.get(key, key)] = value
        return mapped

    def _map_response(self, data: dict[str, Any]) -> dict[str, Any]:
        """Rename response keys according to the bridge compatibility map."""
        if not self._response_map:
            return data
        mapped: dict[str, Any] = {}
        for key, value in data.items():
            mapped[self._response_map.get(key, key)] = value
        return mapped

    # ------------------------------------------------------------------
    # HTTP helpers
    # ------------------------------------------------------------------

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        timeout: float = 30.0,
    ) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        own_session = False
        session = self._session
        if session is None:
            session = aiohttp.ClientSession()
            own_session = True
        try:
            async with session.request(
                method,
                url,
                json=json,
                timeout=aiohttp.ClientTimeout(total=timeout),
            ) as resp:
                if resp.status >= 400:
                    text = await resp.text()
                    raise ACEClientError(
                        f"ACE-Step {method.upper()} {path} returned {resp.status}: {text}"
                    )
                return await resp.json()
        except aiohttp.ClientError as exc:
            raise ACEClientError(f"ACE-Step {method.upper()} {path} failed: {exc}") from exc
        finally:
            if own_session:
                await session.close()

    # ------------------------------------------------------------------
    # Endpoints
    # ------------------------------------------------------------------

    async def health(self, timeout: float = 5.0) -> dict[str, Any]:
        """Return service health: { status, engine, loaded, model }."""
        return await self._request("GET", "/health", timeout=timeout)

    async def generate(self, params: dict[str, Any], timeout: float = 600.0) -> dict[str, Any]:
        """
        Generate a song.

        Canonical params (app-facing): style, lyrics, seed, cfg_scale,
        inference_steps, output_name. These are mapped to ACE-Step wire names
        via ``_param_map`` before sending.

        Returns a normalized dict: { audio_path, seed, sample_rate, engine,
        output_name, relative_path }.
        """
        wire_params = self._map_params(params)
        raw = await self._request("POST", "/generate", json=wire_params, timeout=timeout)
        return self._map_response(raw)

    async def unload(self, timeout: float = 10.0) -> dict[str, Any]:
        """Unload the model to free VRAM."""
        return await self._request("POST", "/unload", timeout=timeout)

    async def reload(self, timeout: float = 60.0) -> dict[str, Any]:
        """Reload the model after VRAM has been freed."""
        return await self._request("POST", "/reload", timeout=timeout)

    async def vram(self, timeout: float = 5.0) -> dict[str, Any]:
        """Return current VRAM usage from the service."""
        return await self._request("GET", "/vram", timeout=timeout)

    async def plan_style(
        self,
        step: str,
        description: str,
        cot_prompt: str | None = None,
        timeout: float = 30.0,
    ) -> dict[str, Any]:
        """Chain-of-Thought style planning step (init/develop/finalize)."""
        payload: dict[str, Any] = {"step": step, "description": description}
        if cot_prompt is not None:
            payload["cot_prompt"] = cot_prompt
        return await self._request("POST", "/planning/style", json=payload, timeout=timeout)

    async def plan_lyrics(
        self,
        step: str,
        context: str = "",
        partial_lyrics: str = "",
        cot_prompt: str | None = None,
        timeout: float = 30.0,
    ) -> dict[str, Any]:
        """Chain-of-Thought lyrics planning step."""
        payload: dict[str, Any] = {
            "step": step,
            "context": context,
            "partial_lyrics": partial_lyrics,
        }
        if cot_prompt is not None:
            payload["cot_prompt"] = cot_prompt
        return await self._request("POST", "/planning/lyrics", json=payload, timeout=timeout)

    async def audio_url(self, output_name: str) -> str:
        """Return the full URL for a generated audio file."""
        return f"{self.base_url}/audio/{output_name}"
