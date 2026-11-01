"""
Ollama adapter core.
Provides integration with local LLM via Ollama.
Implements BaseAdapter interface for storyboard prompt generation.

Tool definitions/implementations live in ``ollama_tools.OllamaToolsMixin``.
Model lifecycle operations live in ``ollama_models.OllamaModelMixin``.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

import aiohttp

from .base import AdapterStatus, BaseAdapter
from .ollama_models import OllamaModelMixin
from .ollama_tools import OllamaToolsMixin

logger = logging.getLogger(__name__)


class OllamaAdapter(OllamaToolsMixin, OllamaModelMixin, BaseAdapter):
    """
    Adapter for Ollama API.

    Supports:
    - Local LLM inference (Qwen, Llama, etc.)
    - Storyboard prompt generation with structured JSON output
    - Chat completion with system prompts
    - Built-in LLM-callable tools (3D scene, media list, job queue, etc.)

    Tool and model mixins are composed via multiple inheritance:
    ``OllamaToolsMixin`` provides ``get_tool_definitions`` and all
    ``_tool_*`` implementations; ``OllamaModelMixin`` provides
    ``list_models``, ``pull_model``, ``delete_model`` and default-model
    accessors.
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
        Initialize the Ollama adapter.

        Args:
            base_url: Base URL for the Ollama API. Falls back to config.ollama_url.
            mock_mode: If True, skip service checks and use mock generation
        """
        from ..core.config import config as _cfg
        _base = base_url or _cfg.ollama_url
        super().__init__(_base, "Ollama", mock_mode=mock_mode)
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
        import time
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
        import time
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

    # ------------------------------------------------------------------
    # Health
    # ------------------------------------------------------------------

    async def health_check(self) -> bool:
        """Check if Ollama is available"""
        try:
            session = await self._get_session()
            async with session.get(
                f"{self.base_url}/api/tags", timeout=aiohttp.ClientTimeout(total=5)
            ) as resp:
                if resp.status == 200:
                    try:
                        payload = await resp.json()
                        self._available_models = [
                            str(item.get("name", "")).strip()
                            for item in payload.get("models", [])
                            if item.get("name")
                        ]
                    except Exception:
                        self._available_models = []
                    if self._status != AdapterStatus.CONNECTED:
                        logger.info("Ollama is now online (%d models available)", len(self._available_models))
                    self._last_health_log = None
                    self.set_status(AdapterStatus.CONNECTED)
                    return True
                if resp.status >= 500 and self._last_health_log != f"HTTP {resp.status}":
                    self._last_health_log = f"HTTP {resp.status}"
                    logger.warning("Ollama health check returned HTTP %s", resp.status)
        except Exception as e:
            error_msg = str(e)
            if self._last_health_log != error_msg:
                logger.warning(f"Ollama health check failed: {error_msg}")
                self._last_health_log = error_msg
            self.set_status(AdapterStatus.ERROR)
        return False

    # ------------------------------------------------------------------
    # Generation
    # ------------------------------------------------------------------

    async def generate(self, params: dict[str, Any]) -> dict[str, Any]:
        """
        Generate text using Ollama.

        Args:
            params: Dictionary containing:
                - prompt: The input prompt
                - model: Model name (optional, defaults to _default_model)
                - system: System prompt (optional)
                - options: Generation options (optional)

        Returns:
            Dictionary containing:
                - response: Generated text
                - model: Model used
                - done: Whether generation completed
        """
        prompt = params.get("prompt", "")
        model = params.get("model", self._default_model)
        system = params.get("system")
        options = params.get("options", {})

        # Track activity
        task_desc = (system or prompt)[:80]
        self.set_activity(model, "generate", task_desc)

        try:
            # Ollama 0.33+: structured output & VRAM-aware options
            payload: dict[str, Any] = {
                "model": model,
                "prompt": prompt,
                "stream": False,
            }
            if "format" in params:
                payload["format"] = params["format"]
            if "keep_alive" in params:
                payload["keep_alive"] = params["keep_alive"]
            if params.get("think") is not None:
                payload["think"] = params["think"]

            if system:
                payload["system"] = system
            if options:
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
                payload["options"] = options

            session = await self._get_session()
            async with session.post(
                f"{self.base_url}/api/generate",
                json=payload,
                timeout=aiohttp.ClientTimeout(total=300),
            ) as resp:
                if resp.status != 200:
                    error = await resp.text()
                    raise RuntimeError(f"Ollama error: {error}")

                result = await resp.json()
                return {
                    "response": result.get("response", ""),
                    "model": model,
                    "done": result.get("done", True),
                }
        finally:
            self.clear_activity(model)

    # ------------------------------------------------------------------
    # Chat
    # ------------------------------------------------------------------

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
        options: dict[str, Any] | None = None,
    ) -> dict[str, Any] | AsyncIterator[dict[str, Any]]:
        """
        Chat completion with Ollama, supporting tool calling and streaming.

        Args:
            messages: List of message dicts with 'role' and 'content'
            model: Model name
            tools: Optional list of tool definitions for function calling
            stream: Whether to stream the response
            think: Enable thinking mode (bool or "high"/"medium"/"low"/"max")
            format: Structured output format ("json" or JSON schema dict) -- Ollama 0.33+
            keep_alive: Keep model alive duration (e.g. "10m", 0, -1) -- Ollama 0.33 caching
            **options: Additional options (num_ctx, temperature, etc. -- VRAM-aware caps apply)

        Returns:
            Dictionary containing the response, or async iterator if streaming
        """
        if model is None:
            model = self._default_model
        if tools and not self._supports_tools(model):
            logger.warning("Model %s is not known to support tools; sending without tool definitions", model)
            tools = None
        if options is None:
            options = {}
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
        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "stream": stream,
        }
        if tools:
            payload["tools"] = tools
        # Bolt-era thinking policy: map `think` to chat_template_kwargs.
        if think is not None:
            payload["chat_template_kwargs"] = {"enable_thinking": think}
        if format is not None:
            payload["format"] = format
        if keep_alive is not None:
            payload["keep_alive"] = keep_alive
        if options:
            # Reasoning headroom: ~200 extra tokens so tight budgets don't
            # starve reasoning and return empty content (measured on Bolt E4B).
            opts = dict(options)
            max_tokens = opts.get("max_tokens")
            if max_tokens is not None and think is not False:
                try:
                    opts["max_tokens"] = int(max_tokens) + 200
                except (TypeError, ValueError):
                    pass
            payload["options"] = opts

        # Track last used model for VRAM manager
        self._last_model = model
        logger.info("Ollama chat request: model=%s, stream=%s, tools=%d, think=%s [route=ollama]",
                     model, stream, len(tools) if tools else 0, think)

        if stream:
            return self._stream_chat(payload)
        else:
            return await self._chat_request(payload, model)

    async def _chat_request(self, payload: dict[str, Any], model: str) -> dict[str, Any]:
        """Non-streaming chat request."""
        logger.info("Starting Ollama non-stream request: model=%s", payload.get("model"))
        session = await self._get_session()
        async with session.post(
            f"{self.base_url}/api/chat",
            json=payload,
            timeout=aiohttp.ClientTimeout(total=300),
        ) as resp:
            if resp.status != 200:
                error = await resp.text()
                logger.error("Ollama non-stream error: status=%d, error=%s", resp.status, error)
                raise RuntimeError(f"Ollama error: {error}")
            result = await resp.json()
            logger.info("Ollama non-stream complete: content_len=%d, tool_calls=%d",
                         len(result.get("message", {}).get("content", "")),
                         len(result.get("message", {}).get("tool_calls", [])))
            message = result.get("message", {}) or {}
            return {
                "model": result.get("model", model),
                "created_at": result.get("created_at"),
                "message": {
                    "role": message.get("role", "assistant"),
                    "content": message.get("content", ""),
                    "tool_calls": message.get("tool_calls"),
                },
                "reasoning_content": message.get("reasoning_content", ""),
                "done": result.get("done", True),
            }

    async def _stream_chat(self, payload: dict[str, Any]) -> AsyncIterator[dict[str, Any]]:
        """Streaming chat request with tool call support."""
        logger.info("Starting Ollama stream request: model=%s", payload.get("model"))
        chunk_count = 0
        session = await self._get_session()
        async with session.post(
            f"{self.base_url}/api/chat",
            json=payload,
            timeout=aiohttp.ClientTimeout(total=300),
        ) as resp:
            if resp.status != 200:
                error = await resp.text()
                logger.error("Ollama stream error: status=%d, error=%s", resp.status, error)
                raise RuntimeError(f"Ollama error: {error}")

            async for line in resp.content:
                if line.strip():
                    chunk = json.loads(line)
                    chunk_count += 1
                    yield chunk
        logger.info("Ollama stream complete: %d chunks received", chunk_count)

    # ------------------------------------------------------------------
    # Tool execution
    # ------------------------------------------------------------------

    async def execute_tool_call(
        self,
        tool_name: str,
        arguments: dict[str, Any],
        tools_config: dict[str, Any],
    ) -> str:
        """
        Execute a tool call and return the result.

        Args:
            tool_name: Name of the tool to call
            arguments: Tool arguments
            tools_config: Configuration for available tools

        Returns:
            String result of the tool execution
        """
        built_in = self._get_built_in_tools()
        if tool_name in built_in:
            return await built_in[tool_name](**arguments)

        custom_tools = tools_config.get("custom_tools", {})
        if tool_name in custom_tools:
            return f"Custom tool '{tool_name}' executed with: {arguments}"

        return f"Unknown tool: {tool_name}"

    # ------------------------------------------------------------------
    # Storyboard generation
    # ------------------------------------------------------------------

    async def generate_storyboard(
        self, theme: str, model: str = "gemma4:e2b-it-qat", num_scenes: int = 5,
        *,
        use_structured_output: bool = True,
        num_ctx: int | None = None,
    ) -> dict[str, Any]:
        """
        Generate a structured storyboard prompt using LLM.

        Uses Ollama 0.33+ structured output (format=json) when available,
        with backward-compatible fallback to markdown stripping.

        Args:
            theme: The theme or concept for the storyboard
            model: Model to use (qwen2.5:3b, llama3.2, etc.)
            num_scenes: Target number of scenes (3-8)
            use_structured_output: If True, request format=json (Ollama 0.33+)
            num_ctx: Optional context window. VRAM-aware caps apply (see chat()).

        Returns:
            Dictionary containing:
                - scenes: List of scene objects
                - total_scenes: Total number of scenes
                - estimated_duration: Total estimated duration in seconds
                - style: Visual style
                - transitions: List of transitions
        """
        prompt = f"""Create a storyboard for: {theme}

Generate exactly {num_scenes} scenes. Make them creative and visually descriptive.
Each scene should have unique camera work and lighting suggestions."""

        messages = [
            {"role": "system", "content": self.STORYBOARD_SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ]

        chat_kwargs: dict[str, Any] = {}
        if use_structured_output:
            chat_kwargs["format"] = "json"
            chat_kwargs["think"] = False
        if num_ctx is not None:
            chat_kwargs["num_ctx"] = num_ctx

        result = await self.chat(messages, model=model, keep_alive="10m", **chat_kwargs)

        response_text = result.get("message", {}).get("content", "")

        try:
            if "```json" in response_text:
                json_start = response_text.find("```json") + 7
                json_end = response_text.find("```", json_start)
                response_text = response_text[json_start:json_end].strip()
            elif "```" in response_text:
                json_start = response_text.find("```") + 3
                json_end = response_text.find("```", json_start)
                response_text = response_text[json_start:json_end].strip()

            storyboard = json.loads(response_text)
            return storyboard

        except json.JSONDecodeError as e:
            raise RuntimeError(
                f"Failed to parse LLM response as JSON: {e}\nResponse: {response_text}"
            ) from e

    # ------------------------------------------------------------------
    # Mock generation
    # ------------------------------------------------------------------

    async def _mock_generate(self, params: dict[str, Any]) -> dict[str, Any]:
        """
        Mock generation for testing without Ollama service.

        Returns a realistic mock storyboard response.
        """
        await asyncio.sleep(2)

        num_scenes = params.get("num_scenes", 5)
        theme = params.get("prompt", "A mysterious adventure")

        scene_templates = [
            {
                "title": "Opening Shot",
                "duration": 5,
                "camera": "wide shot",
                "lighting": "golden hour",
                "mood": "mysterious",
            },
            {
                "title": "Character Introduction",
                "duration": 8,
                "camera": "medium shot",
                "lighting": "soft fill",
                "mood": "dramatic",
            },
            {
                "title": "Action Sequence",
                "duration": 12,
                "camera": "tracking shot",
                "lighting": "high contrast",
                "mood": "intense",
            },
            {
                "title": "Climax",
                "duration": 15,
                "camera": "close-up",
                "lighting": "dramatic rim",
                "mood": "powerful",
            },
            {
                "title": "Resolution",
                "duration": 10,
                "camera": "wide shot",
                "lighting": "warm",
                "mood": "peaceful",
            },
            {
                "title": "Finale",
                "duration": 8,
                "camera": "aerial shot",
                "lighting": "sunset",
                "mood": "triumphant",
            },
            {
                "title": "Transition",
                "duration": 3,
                "camera": "panning",
                "lighting": "neutral",
                "mood": "neutral",
            },
            {
                "title": "Flashback",
                "duration": 6,
                "camera": "tilt up",
                "lighting": "desaturated",
                "mood": "nostalgic",
            },
        ]

        scenes = []
        for i in range(min(num_scenes, len(scene_templates))):
            template = scene_templates[i]
            scenes.append(
                {
                    "scene_number": i + 1,
                    "title": f"{template['title']}: {theme[:30]}",
                    "description": f"Visual depiction of {theme} with {template['mood']} atmosphere. "
                    f"Features dynamic composition with {template['camera']} framing.",
                    "duration_seconds": template["duration"],
                    "camera_angle": template["camera"],
                    "lighting": template["lighting"],
                    "mood": template["mood"],
                    "visual_elements": [
                        f"{theme.split()[0].lower()}-inspired backdrop",
                        f"{template['mood']}-colored atmosphere",
                        "dynamic shadow play",
                        "focal point composition",
                    ],
                    "narrative_purpose": f"Scene {i + 1} of {min(num_scenes, len(scene_templates))}",
                }
            )

        estimated_duration = sum(s["duration_seconds"] for s in scenes)

        return {
            "scenes": scenes,
            "total_scenes": len(scenes),
            "estimated_duration_seconds": estimated_duration,
            "style": "cinematic",
            "transitions": ["fade_in", "cut", "dissolve", "wipe"],
            "theme": theme,
            "model_used": "mock-model",
            "mock": True,
        }


# OllamaAdapter is instantiated lazily via AdapterRegistry.get_adapter("ollama")
# or directly by code that needs it. No module-level singleton is created so
# that Ollama remains an optional dependency — the app works fine without it.
