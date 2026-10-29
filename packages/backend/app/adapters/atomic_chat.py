"""
Atomic Chat adapter.
Provides integration with the Atomic Chat desktop app's OpenAI-compatible API.
Implements BaseAdapter interface for chat and generate operations.
"""

import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator
from typing import Any

import aiohttp

from .base import AdapterStatus, BaseAdapter

logger = logging.getLogger(__name__)


class AtomicChatAdapter(BaseAdapter):
    """
    Adapter for Atomic Chat's OpenAI-compatible API.

    Atomic Chat runs as a desktop app on port 1337 and serves exactly one
    model at a time (loaded into its own VRAM slice). The model ID is
    discovered via /v1/models rather than passed by callers.

    Supports:
    - Local LLM inference via OpenAI-compatible /v1/chat/completions
    - Chat completion with system prompts
    - Streaming and non-streaming responses
    """

    # Default storyboard system prompt for structured JSON output
    STORYBOARD_SYSTEM_PROMPT = """You are a creative storyboard assistant. Generate detailed scene descriptions
for video production in structured JSON format.

Respond ONLY with valid JSON in this exact format:
{
    "scenes": [
        {
            "scene_number": 1,
            "title": "Scene title",
            "description": "Visual description of the scene",
            "duration_seconds": 5,
            "camera_angle": "wide shot",
            "lighting": "golden hour",
            "mood": "dramatic",
            "visual_elements": ["element1", "element2"],
            "narrative_purpose": "setup introduction"
        }
    ],
    "total_scenes": 4,
    "estimated_duration_seconds": 60,
    "style": "cinematic",
    "transitions": ["fade_in", "cut", "dissolve"]
}

Generate 3-8 scenes based on the input theme or concept."""

    def __init__(
        self, base_url: str | None = None, *, mock_mode: bool = False,
    ):
        """
        Initialize the Atomic Chat adapter.

        Args:
            base_url: Base URL for the Atomic Chat API. Falls back to
                config.atomic_chat_url (http://127.0.0.1:1337).
            mock_mode: If True, skip service checks and use mock generation.
        """
        from ..core.config import config as _cfg
        _base = base_url or _cfg.atomic_chat_url
        super().__init__(_base, "Atomic Chat", mock_mode=mock_mode)
        self._available_models: list[str] = []
        try:
            from ..core.config import config as _cfg
            _def = _cfg.default_model
        except Exception:
            _def = "gemma4:e2b-it-qat"
        self._default_model: str = _def
        self._last_model: str = self._default_model
        self._last_health_log: str | None = None
        self._active_tasks: dict[str, dict[str, Any]] = {}
        self._scene_state: dict[str, Any] = {
            "objects": [],
            "lights": [],
            "particles": {"count": 300, "color": "#8b5cf6", "speed": 0.5},
            "camera": "orbit",
            "bloom": 0.8,
            "duration": 30,
            "keyframes": [],
        }

    def set_activity(self, model: str, task: str = "generate", description: str = "", timeout: float = 180) -> None:
        """Register that a model is actively processing a task.

        Args:
            timeout: Max seconds before this task is considered stale (default 10 min).
        """
        self._active_tasks[model] = {
            "task": task,
            "description": description[:120],
            "started_at": time.time(),
            "timeout": timeout,
        }

    def clear_activity(self, model: str) -> None:
        """Mark a model's current task as complete."""
        self._active_tasks.pop(model, None)

    def get_activity(self) -> dict[str, dict[str, Any]]:
        """Get all currently active tasks, purging any that exceeded their timeout."""
        now = time.time()
        result = {}
        stale = []
        for model, info in self._active_tasks.items():
            elapsed = now - info["started_at"]
            if elapsed > info.get("timeout", 600):
                stale.append(model)
                continue
            result[model] = {
                **info,
                "elapsed_seconds": round(elapsed, 1),
            }
        for model in stale:
            self._active_tasks.pop(model, None)
        return result

    def get_tool_definitions(self) -> list[dict[str, Any]]:
        """Get JSON schema definitions for all built-in tools (OpenAI-compatible)."""
        return [
            {
                "type": "function",
                "function": {
                    "name": "scene_add_object",
                    "description": "Add a 3D object (sphere, box, cylinder, cone, torus, crown) to the scene.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "obj_type": {"type": "string", "enum": ["sphere", "box", "cylinder", "cone", "torus", "crown"]},
                            "position": {"type": "array", "items": {"type": "number"}, "description": "[x, y, z] position"},
                            "color": {"type": "string", "description": "Hex color like #ff0000"},
                            "scale": {"type": "array", "items": {"type": "number"}, "description": "[x, y, z] scale"},
                            "metalness": {"type": "number", "minimum": 0, "maximum": 1},
                            "roughness": {"type": "number", "minimum": 0, "maximum": 1},
                            "emissive": {"type": "number", "minimum": 0, "maximum": 2, "description": "Emissive glow intensity"},
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "scene_add_light",
                    "description": "Add a light (point, spot, directional) to the scene.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "light_type": {"type": "string", "enum": ["point", "spot", "directional"]},
                            "color": {"type": "string"},
                            "intensity": {"type": "number"},
                            "position": {"type": "array", "items": {"type": "number"}},
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "scene_set_camera",
                    "description": "Set camera movement mode.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "mode": {"type": "string", "enum": ["orbit", "dolly", "handheld", "static"]},
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "media_list",
                    "description": "List all available media files (video, images) in the studio output directory. Returns filenames and relative paths.",
                    "parameters": {
                        "type": "object",
                        "properties": {},
                        "required": [],
                    },
                },
            },
        ]

    async def health_check(self) -> bool:
        """Check if Atomic Chat is available and can serve inference.

        Probes /v1/models to confirm the service is up, then does a
        /v1/chat/completions ping to confirm it can actually serve.
        Returns True only when both succeed.
        """
        if not self.base_url or self.base_url == "mock://internal":
            self.set_status(AdapterStatus.CONNECTED)
            return True
        try:
            session = await self._get_session()
            target = f"{self.base_url.rstrip('/')}/v1/models"
            async with session.get(target, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                if resp.status != 200:
                    if self._last_health_log != f"HTTP {resp.status}":
                        self._last_health_log = f"HTTP {resp.status}"
                        logger.warning("Atomic Chat health check returned HTTP %s", resp.status)
                    self.set_status(AdapterStatus.ERROR)
                    return False
                data = await resp.json()
            models = data.get("data") or data.get("models") or []
            if not models:
                reason = "no models listed"
                if self._last_health_log != reason:
                    self._last_health_log = reason
                    logger.warning("Atomic Chat health check: %s", reason)
                self.set_status(AdapterStatus.ERROR)
                return False
            model_id = (models[0].get("id") or models[0].get("name") or "").strip()
            if not model_id:
                reason = "empty model id"
                if self._last_health_log != reason:
                    self._last_health_log = reason
                    logger.warning("Atomic Chat health check: %s", reason)
                self.set_status(AdapterStatus.ERROR)
                return False

            # Confirm inference actually works with a minimal chat completion.
            chat_target = f"{self.base_url.rstrip('/')}/v1/chat/completions"
            async with session.post(
                chat_target,
                json={
                    "model": model_id,
                    "messages": [{"role": "user", "content": "ping"}],
                    "max_tokens": 2,
                },
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                if resp.status == 200:
                    if self._status != AdapterStatus.CONNECTED:
                        logger.info("Atomic Chat is now online (%d models available)", len(models))
                    self._last_health_log = None
                    self.set_status(AdapterStatus.CONNECTED)
                    return True
                reason = f"/v1/chat/completions returned HTTP {resp.status}"
                if self._last_health_log != reason:
                    self._last_health_log = reason
                    logger.warning("Atomic Chat health check: %s", reason)
                self.set_status(AdapterStatus.ERROR)
                return False
        except Exception as e:
            error_msg = str(e)
            if self._last_health_log != error_msg:
                self._last_health_log = error_msg
                logger.warning(f"Atomic Chat health check failed: {error_msg}")
            self.set_status(AdapterStatus.ERROR)
            return False

    async def _discover_model(self) -> str | None:
        """Return the model ID Atomic Chat has resident, or None if unavailable.

        Atomic Chat serves exactly one model at a time (loaded into its own
        8 GB VRAM slice). When no explicit model is requested we must use the
        one Atomic Chat actually has loaded rather than the Ollama default,
        which Atomic Chat does not serve and would 404.
        """
        if not self.base_url or self.base_url == "mock://internal":
            return None
        try:
            session = await self._get_session()
            target = f"{self.base_url.rstrip('/')}/v1/models"
            async with session.get(target, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                if resp.status != 200:
                    return None
                data = await resp.json()
            models = data.get("data") or data.get("models") or []
            if models:
                return (models[0].get("id") or models[0].get("name") or "").strip() or None
        except Exception as e:
            logger.debug(f"Atomic Chat model discovery failed: {e}")
        return None

    @staticmethod
    def _to_atomic_chat_model(model: str) -> str:
        """Pass model name through to Atomic Chat unchanged.

        Atomic Chat is an OpenAI-compatible proxy that serves models under
        its own IDs. Rewriting Ollama IDs (e.g. ``qwen3.5:4b`` ->
        ``ollama/qwen3.5-4b``) sends a name Atomic almost certainly doesn't
        recognize. The correct model ID is discovered via /v1/models; this
        pass-through keeps the caller's intent intact.
        """
        if not model or not isinstance(model, str):
            return model
        return model

    async def chat(
        self,
        messages: list[dict[str, str]],
        model: str | None = None,
        tools: list[dict[str, Any]] | None = None,
        *,
        stream: bool = False,
        think: bool | str | None = None,
        format: Any | None = None,
        keep_alive: str | int | None = None,
        **options,
    ) -> dict[str, Any] | AsyncIterator[dict[str, Any]]:
        """
        Chat completion via Atomic Chat's OpenAI-compatible API.

        When no model is specified, the resident model discovered from
        /v1/models is used. Atomic Chat serves exactly one model at a time.
        """
        # Atomic Chat serves exactly one model at a time; use the resident
        # model rather than a caller-supplied name it would reject.
        if model is None:
            discovered = await self._discover_model()
            model = discovered or self._default_model

        if tools and not self._supports_tools(model):
            logger.warning("Model %s is not known to support tools; sending without tool definitions", model)
            tools = None

        # VRAM-aware num_ctx: default to 8192 on the 8GB workstation.
        if "num_ctx" not in options:
            options["num_ctx"] = 8192
        else:
            try:
                requested = int(options["num_ctx"])
                if requested > 8192:
                    logger.warning("num_ctx %d requested -- capping to 8192 for 8GB VRAM", requested)
                    options["num_ctx"] = 8192
            except Exception:
                pass

        self._last_model = model
        logger.info("Atomic Chat chat request: model=%s, stream=%s, tools=%d, think=%s",
                     model, stream, len(tools) if tools else 0, think)

        if stream:
            return self._stream_chat(messages, model, tools, think=think, format=format, keep_alive=keep_alive, options=options)
        return await self._chat_request(messages, model, tools, think=think, format=format, keep_alive=keep_alive, options=options)

    def _supports_tools(self, model: str) -> bool:
        """Whether the given model is known to support tool calling."""
        # Qwen models support tools; be permissive for unknown models.
        name = (model or "").lower()
        if any(k in name for k in ("qwen", "llama", "gemma", "mistral", "mixtral")):
            return True
        return True

    async def _chat_request(
        self,
        messages: list[dict[str, str]],
        model: str,
        tools: list[dict[str, Any]] | None,
        *,
        think: bool | str | None,
        format: Any | None,
        keep_alive: str | int | None,
        options: dict[str, Any] | None,
    ) -> dict[str, Any]:
        """Non-streaming chat request via Atomic Chat OpenAI-compatible API."""
        if not self.base_url or self.base_url == "mock://internal":
            raise RuntimeError("Atomic Chat URL is not configured")

        openai_messages: list[dict[str, Any]] = []
        for m in messages:
            entry: dict[str, Any] = {"role": m.get("role", "user"), "content": m.get("content", "")}
            if m.get("tool_calls"):
                entry["tool_calls"] = m["tool_calls"]
            if m.get("tool_call_id"):
                entry["tool_call_id"] = m["tool_call_id"]
            openai_messages.append(entry)

        payload: dict[str, Any] = {
            "model": self._to_atomic_chat_model(model),
            "messages": openai_messages,
            "stream": False,
        }
        if tools:
            payload["tools"] = tools
        if think is not None:
            payload["think"] = think
        if format is not None:
            payload["response_format"] = {"type": "json_object"} if format == "json" else format
        if keep_alive is not None:
            payload["keep_alive"] = keep_alive
        if options:
            payload["options"] = options

        session = await self._get_session()
        target = f"{self.base_url.rstrip('/')}/v1/chat/completions"
        async with session.post(target, json=payload, timeout=aiohttp.ClientTimeout(total=300)) as resp:
            if resp.status != 200:
                error = await resp.text()
                raise RuntimeError(f"Atomic Chat error: {error}")
            data = await resp.json()
            choice = (data.get("choices") or [{}])[0]
            message = choice.get("message", {}) or {}
            return {
                "model": data.get("model", model),
                "created_at": data.get("created"),
                "message": {
                    "role": message.get("role", "assistant"),
                    "content": message.get("content", ""),
                    "tool_calls": message.get("tool_calls"),
                },
                "done": True,
            }

    async def _stream_chat(
        self,
        messages: list[dict[str, str]],
        model: str,
        tools: list[dict[str, Any]] | None,
        *,
        think: bool | str | None,
        format: Any | None,
        keep_alive: str | int | None,
        options: dict[str, Any] | None,
    ) -> AsyncIterator[dict[str, Any]]:
        """Streaming chat request via Atomic Chat OpenAI-compatible API."""
        if not self.base_url or self.base_url == "mock://internal":
            raise RuntimeError("Atomic Chat URL is not configured")

        openai_messages: list[dict[str, Any]] = []
        for m in messages:
            entry: dict[str, Any] = {"role": m.get("role", "user"), "content": m.get("content", "")}
            if m.get("tool_calls"):
                entry["tool_calls"] = m["tool_calls"]
            if m.get("tool_call_id"):
                entry["tool_call_id"] = m["tool_call_id"]
            openai_messages.append(entry)

        payload: dict[str, Any] = {
            "model": self._to_atomic_chat_model(model),
            "messages": openai_messages,
            "stream": True,
        }
        if tools:
            payload["tools"] = tools
        if think is not None:
            payload["think"] = think
        if format is not None:
            payload["response_format"] = {"type": "json_object"} if format == "json" else format
        if keep_alive is not None:
            payload["keep_alive"] = keep_alive
        if options:
            payload["options"] = options

        session = await self._get_session()
        target = f"{self.base_url.rstrip('/')}/v1/chat/completions"
        async with session.post(target, json=payload, timeout=aiohttp.ClientTimeout(total=300)) as resp:
            if resp.status != 200:
                error = await resp.text()
                raise RuntimeError(f"Atomic Chat stream error: {error}")
            async for line in resp.content:
                if not line.strip():
                    continue
                text = line.decode("utf-8", errors="ignore") if isinstance(line, (bytes, bytearray)) else line
                text = text.removeprefix("data: ")
                if text == "[DONE]":
                    yield {"done": True}
                    continue
                try:
                    chunk = json.loads(text)
                    choice = (chunk.get("choices") or [{}])[0]
                    delta = choice.get("delta") or {}
                    yield {
                        "model": chunk.get("model"),
                        "created_at": chunk.get("created"),
                        "message": {"role": delta.get("role"), "content": delta.get("content", "")},
                        "done": choice.get("finish_reason") is not None,
                    }
                except Exception:
                    continue

    async def generate(self, params: dict[str, Any]) -> dict[str, Any]:
        """
        Generate text via Atomic Chat's OpenAI-compatible chat API.

        Args:
            params: Dictionary containing:
                - prompt: The input prompt
                - model: Model name (optional, defaults to discovered model)
                - system: System prompt (optional)
                - options: Generation options (optional)

        Returns:
            Dictionary containing:
                - response: Generated text
                - model: Model used
                - done: Whether generation completed
        """
        prompt = params.get("prompt", "")
        system = params.get("system")
        options = params.get("options", {})

        messages: list[dict[str, str]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        model = params.get("model")
        if model is None:
            discovered = await self._discover_model()
            model = discovered or self._default_model

        # VRAM-aware num_ctx: default to 8192 on the 8GB workstation.
        if "num_ctx" not in options:
            options["num_ctx"] = 8192
        else:
            try:
                requested = int(options["num_ctx"])
                if requested > 8192:
                    logger.warning("generate num_ctx %d capped to 8192 for 8GB VRAM", requested)
                    options["num_ctx"] = 8192
            except Exception:
                pass

        self._last_model = model
        self.set_activity(model, "generate", (system or prompt)[:80])

        try:
            result = await self._chat_request(
                messages, model, None, think=None, format=None, keep_alive=None, options=options,
            )
            return {
                "response": result.get("message", {}).get("content", ""),
                "model": result.get("model", model),
                "done": result.get("done", True),
            }
        finally:
            self.clear_activity(model)

    async def _mock_generate(self, params: dict[str, Any]) -> dict[str, Any]:
        """Mock generation for testing without Atomic Chat running."""
        prompt = params.get("prompt", "")
        model = params.get("model", self._default_model)
        await asyncio.sleep(0.1)
        return {
            "response": f"[mock Atomic Chat] {prompt[:80]}...",
            "model": model,
            "done": True,
        }

    def set_default_model(self, model: str) -> None:
        """Set the default model name used when none is specified."""
        self._default_model = model

    def get_default_model(self) -> str:
        """Get the default model name."""
        return self._default_model

    def get_available_models(self) -> list[str]:
        """Return the list of available model names (from last health check)."""
        return self._available_models
