"""
Native Media AI Studio - Agent API Client

Async wrapper around the backend REST API for agent use. All endpoints follow
the /api/ prefix convention. Implements:
- Async I/O with httpx (connection pooling)
- Retry with exponential backoff + full jitter (only retryable errors)
- Circuit breaker per dependency
- Idempotency keys for write operations
- Structured error classification (retryable vs non-retryable vs side-effect-unknown)
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx

from app.agents.resilience import (
    DEFAULT_BACKOFF_BASE,
    DEFAULT_BACKOFF_CAP,
    DEFAULT_MAX_ATTEMPTS,
    NMAApiError,
    get_circuit_breaker,
    make_idempotency_key,
    retry_with_backoff,
)


class NMAApiClient:
    """Async client for the Native Media AI Studio backend API.

    All methods raise NMAApiError on non-2xx responses. The agent layer
    decides how to handle errors (retry, skip, abort, or report).

    Uses httpx.AsyncClient for connection pooling and async I/O.
    """

    def __init__(self, base_url: str = "http://127.0.0.1:8000",
                 timeout: float = 30.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                timeout=self.timeout,
                headers={"Content-Type": "application/json"},
            )
        return self._client

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def __aenter__(self) -> NMAApiClient:
        await self._get_client()
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.aclose()

    async def _request(self, method: str, path: str,
                       data: dict[str, Any] | None = None,
                       idempotency_key: str | None = None,
                       circuit_name: str | None = None) -> dict[str, Any]:
        """Make an HTTP request with retry + circuit breaker + idempotency."""
        client = await self._get_client()
        url = f"{self.base_url}{path}"
        headers: dict[str, str] = {}
        content = None
        if data is not None:
            content = json.dumps(data).encode("utf-8")

        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key

        async def _do_request() -> dict[str, Any]:
            resp = await client.request(method, url, content=content,
                                        headers=headers)
            if resp.status_code >= 400:
                body_text = resp.text
                retryable = resp.status_code in (429, 502, 503, 504)
                retry_after = None
                if "retry-after" in resp.headers:
                    try:
                        retry_after = float(resp.headers["retry-after"])
                    except ValueError:
                        pass
                raise NMAApiError(
                    f"{method} {path} -> HTTP {resp.status_code}: {body_text}",
                    retryable=retryable,
                    retry_after=retry_after,
                    status_code=resp.status_code,
                )
            raw = resp.text
            if not raw:
                return {}
            return json.loads(raw)

        cb = await get_circuit_breaker(circuit_name) if circuit_name else None
        return await retry_with_backoff(
            _do_request,
            max_attempts=DEFAULT_MAX_ATTEMPTS,
            backoff_base=DEFAULT_BACKOFF_BASE,
            backoff_cap=DEFAULT_BACKOFF_CAP,
            circuit_breaker=cb,
            context=f"{method} {path}",
        )

    # ------------------------------------------------------------------
    # Health
    # ------------------------------------------------------------------
    async def health(self) -> dict[str, Any]:
        return await self._request("GET", "/api/health")

    # ------------------------------------------------------------------
    # Audio
    # ------------------------------------------------------------------
    async def audio_upload(self, file_path: str) -> dict[str, Any]:
        """Upload an audio file. Returns upload metadata including filename."""
        path = Path(file_path)
        if not path.exists():
            raise NMAApiError(f"Audio file not found: {file_path}")
        import mimetypes
        files = {"file": (path.name, path.read_bytes(),
                          mimetypes.guess_type(str(path))[0] or "audio/wav")}
        client = await self._get_client()
        resp = await client.post(f"{self.base_url}/api/audio/upload", files=files)
        if resp.status_code >= 400:
            raise NMAApiError(
                f"POST /api/audio/upload -> HTTP {resp.status_code}: {resp.text}",
                retryable=resp.status_code in (429, 502, 503, 504),
                status_code=resp.status_code,
            )
        return resp.json()

    async def audio_analyze(self, filename: str) -> dict[str, Any]:
        """Run audio analysis on a file. Returns tempo, beats, sections, energy."""
        return await self._request("POST",
                                   f"/api/audio/analysis?filename={filename}",
                                   idempotency_key=make_idempotency_key(
                                       tenant="agent",
                                       operation="audio_analyze",
                                       params={"filename": filename},
                                   ),
                                   circuit_name="audio_analysis",
                                   )

    async def audio_list(self) -> dict[str, Any]:
        """List all audio outputs."""
        return await self._request("GET", "/api/outputs")

    # ------------------------------------------------------------------
    # Music Generation
    # ------------------------------------------------------------------
    async def music_gen_status(self) -> dict[str, Any]:
        return await self._request("GET", "/api/music-gen/status")

    async def music_gen_start(self, engine: str = "ace") -> dict[str, Any]:
        return await self._request("POST", "/api/music-gen/start",
                                   {"engine": engine},
                                   idempotency_key=make_idempotency_key(
                                       tenant="agent",
                                       operation="music_gen_start",
                                       params={"engine": engine},
                                   ),
                                   circuit_name="music_gen",
                                   )

    async def music_gen_stop(self) -> dict[str, Any]:
        return await self._request("POST", "/api/music-gen/stop")

    async def music_gen_generate(
        self,
        style: str,
        lyrics: str = "",
        output_name: str | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        data: dict[str, Any] = {"engine": "ace", "style": style, "lyrics": lyrics}
        if output_name:
            data["output_name"] = output_name
        return await self._request(
            "POST", "/api/music-gen/generate", data,
            idempotency_key=idempotency_key,
            circuit_name="music_gen",
        )

    def music_gen_audio(self, name: str) -> str:
        """Return the playable URL for a generated audio file."""
        return f"{self.base_url}/api/music-gen/audio/{name}"

    # ------------------------------------------------------------------
    # Remix
    # ------------------------------------------------------------------
    async def remix_list(self) -> dict[str, Any]:
        return await self._request("GET", "/api/audio/remix/")

    async def remix_preview(self, recipe: dict[str, Any]) -> dict[str, Any]:
        return await self._request("POST", "/api/audio/remix/preview", recipe,
                                   idempotency_key=make_idempotency_key(
                                       tenant="agent",
                                       operation="remix_preview",
                                       params=recipe,
                                   ),
                                   circuit_name="audio_remix",
                                   )

    async def remix_build(self, recipe: dict[str, Any]) -> dict[str, Any]:
        return await self._request("POST", "/api/audio/remix/build", recipe,
                                   idempotency_key=make_idempotency_key(
                                       tenant="agent",
                                       operation="remix_build",
                                       params=recipe,
                                   ),
                                   circuit_name="audio_remix",
                                   )

    async def remix_enhance(self, name: str) -> dict[str, Any]:
        return await self._request("POST", f"/api/audio/remix/{name}/enhance",
                                   idempotency_key=make_idempotency_key(
                                       tenant="agent",
                                       operation="remix_enhance",
                                       params={"name": name},
                                   ),
                                   circuit_name="audio_remix",
                                   )

    # ------------------------------------------------------------------
    # Media Library
    # ------------------------------------------------------------------
    async def media_list(self) -> dict[str, Any]:
        return await self._request("GET", "/api/outputs")

    async def media_delete(self, relative_path: str) -> dict[str, Any]:
        return await self._request("DELETE", f"/api/outputs/{relative_path}",
                                   idempotency_key=make_idempotency_key(
                                       tenant="agent",
                                       operation="media_delete",
                                       params={"path": relative_path},
                                   ),
                                   circuit_name="audio_outputs",
                                   )

    async def media_rename(self, relative_path: str,
                           new_name: str) -> dict[str, Any]:
        return await self._request(
            "POST", f"/api/outputs/{relative_path}/rename",
            {"new_name": new_name},
            idempotency_key=make_idempotency_key(
                tenant="agent",
                operation="media_rename",
                params={"path": relative_path, "new_name": new_name},
            ),
            circuit_name="audio_outputs",
        )

    # ------------------------------------------------------------------
    # LLM chat with tools (agent loop)
    # ------------------------------------------------------------------
    async def chat_with_tools(
        self,
        message: str,
        tools: list[dict[str, Any]] | None = None,
        model: str | None = "qwen3.5:4b",
        system: str | None = None,
        history: list[dict[str, Any]] | None = None,
        max_tool_calls: int = 5,
        think: bool | None = None,
    ) -> dict[str, Any]:
        """Chat with the LLM backend with tool-calling support.

        Calls POST /api/ollama/chat. Returns the raw response dict which
        includes ``message`` (with optional ``tool_calls``) and any
        tool results already executed by the backend adapter.

        The backend adapter routes to Atomic Chat when
        ``atomic_chat_enabled`` is true, falling back to Ollama on error.
        Atomic Chat is served by a separate ``AtomicChatAdapter``
        (:class:`app.adapters.atomic_chat.AtomicChatAdapter`) distinct from
        ``OllamaAdapter``.
        """
        data: dict[str, Any] = {
            "message": message,
            "model": model,
            "stream": False,
            "max_tool_calls": max_tool_calls,
        }
        if tools is not None:
            data["tools"] = tools
        if system is not None:
            data["system"] = system
        if history is not None:
            data["history"] = history
        if think is not None:
            data["think"] = think
        return await self._request("POST", "/api/ollama/chat", data,
                                   circuit_name="ollama_chat")

