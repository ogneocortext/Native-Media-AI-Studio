"""
Ollama adapter.
Provides integration with local LLM via Ollama.
Implements BaseAdapter interface for storyboard prompt generation.
"""

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from typing import Any

import aiohttp

from .base import AdapterStatus, BaseAdapter

logger = logging.getLogger(__name__)


class OllamaAdapter(BaseAdapter):
    """
    Adapter for Ollama API.

    Supports:
    - Local LLM inference (Qwen, Llama, etc.)
    - Storyboard prompt generation with structured JSON output
    - Chat completion with system prompts
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
        self, base_url: str = "http://127.0.0.1:11434", mock_mode: bool = False
    ):
        """
        Initialize the Ollama adapter.

        Args:
            base_url: Base URL for the Ollama API
            mock_mode: If True, skip service checks and use mock generation
        """
        super().__init__(base_url, "Ollama", mock_mode=mock_mode)
        self._available_models: list[str] = []
        # Use models that actually exist in this install (qwen3.5:4b is always available)
        # Import here to avoid circular init — fallback to qwen3.5:4b
        try:
            from ..core.config import config as _cfg
            _def = _cfg.default_model
        except Exception:
            _def = "qwen3.5:4b"
        self._default_model: str = _def
        self._last_model: str = self._default_model  # Track last used model for VRAM manager
        self._last_health_log: str | None = None
        self._session: aiohttp.ClientSession | None = None
        # Activity tracking: model name -> {task, description, started_at}
        self._active_tasks: dict[str, dict[str, Any]] = {}
        # Scene state for AI tool-driven generation
        self._scene_state: dict[str, Any] = {
            "objects": [],
            "lights": [],
            "particles": {"count": 300, "color": "#8b5cf6", "speed": 0.5},
            "camera": "orbit",
            "bloom": 0.8,
            "duration": 30,
            "keyframes": [],
        }

    async def _get_session(self) -> aiohttp.ClientSession:
        """Get or create a shared aiohttp session for this adapter."""
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                connector=aiohttp.TCPConnector(limit=5, ttl_dns_cache=300),
                timeout=aiohttp.ClientTimeout(total=30),
            )
        return self._session

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

    async def close(self):
        """Close the shared session."""
        if self._session and not self._session.closed:
            await self._session.close()
            self._session = None

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
                    "name": "scene_set_particles",
                    "description": "Configure particle effects (count, color, speed).",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "count": {"type": "integer", "minimum": 0, "maximum": 5000},
                            "color": {"type": "string"},
                            "speed": {"type": "number", "minimum": 0, "maximum": 5},
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "scene_add_keyframe",
                    "description": "Add an animation keyframe for an object at a specific time.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "object_index": {"type": "integer", "description": "Index of the object to animate"},
                            "time": {"type": "number", "description": "Time in seconds"},
                            "position": {"type": "array", "items": {"type": "number"}},
                            "rotation": {"type": "array", "items": {"type": "number"}},
                            "scale": {"type": "array", "items": {"type": "number"}},
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "scene_clear",
                    "description": "Clear all objects and keyframes from the scene.",
                    "parameters": {"type": "object", "properties": {}},
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "scene_get_state",
                    "description": "Get the current scene state as JSON.",
                    "parameters": {"type": "object", "properties": {}},
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "scene_set_bloom",
                    "description": "Set bloom post-processing strength (0-1.5).",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "strength": {"type": "number", "minimum": 0, "maximum": 1.5},
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "scene_set_duration",
                    "description": "Set the animation duration in seconds.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "seconds": {"type": "number", "minimum": 1, "maximum": 120},
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "scene_add_storyboard_element",
                    "description": "Add a storyboard visual element (crown, skyline, orb, ring, spiral, mountain, city, tree, lightning, rain, snow, fire, wave, galaxy, neuron, fractal, text, particle_field, light_rays, lens_flare).",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "element_type": {"type": "string", "enum": ["crown", "skyline", "orb", "ring", "spiral", "mountain", "city", "tree", "lightning", "rain", "snow", "fire", "wave", "galaxy", "neuron", "fractal", "text", "particle_field", "light_rays", "lens_flare", "stage", "equalizer", "vinyl", "pillar", "bar"]},
                            "position": {"type": "array", "items": {"type": "number"}},
                            "color": {"type": "string"},
                            "scale": {"type": "array", "items": {"type": "number"}},
                            "rotation": {"type": "array", "items": {"type": "number"}},
                            "metalness": {"type": "number", "minimum": 0, "maximum": 1},
                            "roughness": {"type": "number", "minimum": 0, "maximum": 1},
                            "emissive": {"type": "number", "minimum": 0, "maximum": 2},
                            "storyboard_ref": {"type": "string", "description": "Reference to storyboard scene/section"},
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "scene_set_camera_for_shot",
                    "description": "Set camera based on storyboard shot type (wide, close_up, macro, overhead, dolly, tracking, handheld, low_angle, birds_eye).",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "shot_type": {"type": "string", "enum": ["wide", "close_up", "macro", "overhead", "dolly", "tracking", "handheld", "low_angle", "birds_eye"]},
                            "target": {"type": "array", "items": {"type": "number"}},
                            "fov": {"type": "number", "minimum": 10, "maximum": 120},
                            "movement": {"type": "string", "enum": ["static", "orbit", "dolly", "tracking", "handheld"]},
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "scene_add_text",
                    "description": "Add 3D text element for lyrics, titles, or labels.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "text": {"type": "string"},
                            "position": {"type": "array", "items": {"type": "number"}},
                            "color": {"type": "string"},
                            "size": {"type": "number", "minimum": 0.1, "maximum": 5},
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "scene_add_environment",
                    "description": "Set the environment/background mood (studio, city, void, sunset, neon, forest, space).",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "env_type": {"type": "string", "enum": ["studio", "city", "void", "sunset", "neon", "forest", "space"]},
                            "color": {"type": "string"},
                            "fog": {"type": "number", "minimum": 0, "maximum": 0.1},
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "scene_link_to_storyboard",
                    "description": "Link this scene to a storyboard document for reference.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "storyboard_path": {"type": "string"},
                            "track_name": {"type": "string"},
                        },
                    },
                },
            },
        ]

    async def health_check(self) -> bool:
        """Check if Ollama is available"""
        try:
            session = await self._get_session()
            async with session.get(
                f"{self.base_url}/api/tags", timeout=aiohttp.ClientTimeout(total=5)
            ) as resp:
                if resp.status == 200:
                    if self._status != AdapterStatus.CONNECTED:
                        logger.info("Ollama is now online")
                    self.set_status(AdapterStatus.CONNECTED)
                    return True
        except Exception as e:
            error_msg = str(e)
            if self._last_health_log != error_msg:
                logger.warning(f"Ollama health check failed: {error_msg}")
                self._last_health_log = error_msg
            self.set_status(AdapterStatus.ERROR)
        return False

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
            # Top-level format/keep_alive passthrough for structured output & caching
            if "format" in params:
                payload["format"] = params["format"]
            if "keep_alive" in params:
                payload["keep_alive"] = params["keep_alive"]
            # Disable thinking mode for structured output tasks (visualizer, storyboard)
            if params.get("think") is False:
                payload["think"] = False

            if system:
                payload["system"] = system
            if options:
                # VRAM-aware clamp for generate too
                if "num_ctx" in options:
                    try:
                        requested = int(options["num_ctx"])
                        if requested > 32768:
                            options["num_ctx"] = 32768
                        elif requested > 16384:
                            logger.warning("generate num_ctx %d capped to 16384 for 8GB VRAM", requested)
                            options["num_ctx"] = 16384
                    except Exception:
                        pass
                payload["options"] = options

            session = await self._get_session()
            async with session.post(
                f"{self.base_url}/api/generate",
                json=payload,
                timeout=aiohttp.ClientTimeout(total=120),
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

    async def chat(
        self,
        messages: list[dict[str, str]],
        model: str = "qwen3.5:4b",
        tools: list[dict[str, Any]] | None = None,
        stream: bool = False,
        think: bool | str | None = None,
        format: Any | None = None,
        keep_alive: str | int | None = None,
        **options,
    ) -> dict[str, Any] | AsyncIterator[dict[str, Any]]:
        """
        Chat completion with Ollama, supporting tool calling and streaming.

        Args:
            messages: List of message dicts with 'role' and 'content'
            model: Model name
            tools: Optional list of tool definitions for function calling
            stream: Whether to stream the response
            think: Enable thinking mode (bool or "high"/"medium"/"low"/"max")
            format: Structured output format ("json" or JSON schema dict) — Ollama 0.33+
            keep_alive: Keep model alive duration (e.g. "10m", 0, -1) — Ollama 0.33 caching
            **options: Additional options (num_ctx, temperature, etc. — VRAM-aware caps apply)

        Returns:
            Dictionary containing the response, or async iterator if streaming
        """
        # VRAM-aware num_ctx cap: don't exceed free VRAM. Caller should keep
        # num_ctx modest; we clamp here to prevent OOM on 8GB cards (e.g. 5740MB free).
        # Rough KV cache: ~ (num_ctx * hidden_dim * layers) — we use a safe heuristic:
        # 9B @ 8k ctx ~ 1.5GB KV, @ 32k ~ 6GB. Clamp to 16384 if free < 6GB.
        if "num_ctx" in options:
            try:
                import psutil  # noqa: F401 — ensure available
                # Lightweight clamp without nvidia-smi dependency
                requested = int(options["num_ctx"])
                # Query free VRAM via Ollama ps size_vram if available? fallback to heuristic
                # Caps: 8k safe everywhere, 16k needs ~4GB free, 32k needs ~6GB+ free
                if requested > 32768:
                    options["num_ctx"] = 32768
                elif requested > 16384:
                    # Only allow 32k if we have headroom — otherwise cap at 16k
                    # We don't block, just log. Caller (frontend/health) should query /api/ps.
                    logger.warning("num_ctx %d requested — capping to 16384 to stay within 8GB VRAM", requested)
                    options["num_ctx"] = 16384
            except Exception:
                pass
        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "stream": stream,
        }
        if tools:
            payload["tools"] = tools
        if think is not None:
            payload["think"] = think
        if format is not None:
            payload["format"] = format
        if keep_alive is not None:
            payload["keep_alive"] = keep_alive
        if options:
            payload["options"] = options

        # Track last used model for VRAM manager
        self._last_model = model
        logger.info("Ollama chat request: model=%s, stream=%s, tools=%d, think=%s",
                     model, stream, len(tools) if tools else 0, think)

        if stream:
            return self._stream_chat(payload)
        else:
            return await self._chat_request(payload)

    async def _chat_request(self, payload: dict[str, Any]) -> dict[str, Any]:
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
            return result

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

            # Stream JSON lines
            async for line in resp.content:
                if line.strip():
                    import json
                    chunk = json.loads(line)
                    chunk_count += 1
                    yield chunk
        logger.info("Ollama stream complete: %d chunks received", chunk_count)

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
        # Built-in tools
        built_in = self._get_built_in_tools()
        if tool_name in built_in:
            return await built_in[tool_name](**arguments)

        # Custom tools from config
        custom_tools = tools_config.get("custom_tools", {})
        if tool_name in custom_tools:
            # Custom tools are handled by the caller
            return f"Custom tool '{tool_name}' executed with: {arguments}"

        return f"Unknown tool: {tool_name}"

    def _get_built_in_tools(self) -> dict[str, Any]:
        """Get built-in tool implementations."""
        return {
            "get_project_structure": self._tool_get_project_structure,
            "search_docs": self._tool_search_docs,
            "get_system_health": self._tool_get_system_health,
            "list_jobs": self._tool_list_jobs,
            "get_job_status": self._tool_get_job_status,
            "generate_visualization": self._tool_generate_visualization,
            # Three.js scene tools
            "scene_add_object": self._tool_scene_add_object,
            "scene_add_light": self._tool_scene_add_light,
            "scene_set_camera": self._tool_scene_set_camera,
            "scene_set_particles": self._tool_scene_set_particles,
            "scene_add_keyframe": self._tool_scene_add_keyframe,
            "scene_clear": self._tool_scene_clear,
            "scene_get_state": self._tool_scene_get_state,
            "scene_set_bloom": self._tool_scene_set_bloom,
            "scene_set_duration": self._tool_scene_set_duration,
            # Storyboard-driven tools
            "scene_add_storyboard_element": self._tool_scene_add_storyboard_element,
            "scene_set_camera_for_shot": self._tool_scene_set_camera_for_shot,
            "scene_add_text": self._tool_scene_add_text,
            "scene_add_environment": self._tool_scene_add_environment,
            "scene_link_to_storyboard": self._tool_scene_link_to_storyboard,
        }

    # ---- Three.js Scene Tools ----

    async def _tool_scene_add_object(
        self,
        obj_type: str = "sphere",
        position: list[float] | None = None,
        color: str = "#ffffff",
        scale: list[float] | None = None,
        metalness: float = 0.6,
        roughness: float = 0.3,
        emissive: float = 0.1,
    ) -> str:
        """Add a 3D object to the scene."""
        obj = {
            "type": obj_type,
            "position": position or [0, 0.5, 0],
            "color": color,
            "scale": scale or [1, 1, 1],
            "metalness": metalness,
            "roughness": roughness,
            "emissive": emissive,
        }
        self._scene_state["objects"].append(obj)
        return f"Added {obj_type} object. Scene now has {len(self._scene_state['objects'])} objects."

    async def _tool_scene_add_light(
        self,
        light_type: str = "point",
        color: str = "#ffffff",
        intensity: float = 10.0,
        position: list[float] | None = None,
    ) -> str:
        """Add a light to the scene."""
        light = {
            "type": light_type,
            "color": color,
            "intensity": intensity,
            "position": position or [0, 5, 0],
        }
        self._scene_state["lights"].append(light)
        return f"Added {light_type} light. Scene now has {len(self._scene_state['lights'])} lights."

    async def _tool_scene_set_camera(self, mode: str = "orbit") -> str:
        """Set the camera movement mode (orbit, dolly, handheld, static)."""
        self._scene_state["camera"] = mode
        return f"Camera mode set to '{mode}'."

    async def _tool_scene_set_particles(
        self,
        count: int | None = None,
        color: str | None = None,
        speed: float | None = None,
    ) -> str:
        """Configure particle effects."""
        if count is not None:
            self._scene_state["particles"]["count"] = count
        if color is not None:
            self._scene_state["particles"]["color"] = color
        if speed is not None:
            self._scene_state["particles"]["speed"] = speed
        return f"Particles: {self._scene_state['particles']}"

    async def _tool_scene_add_keyframe(
        self,
        object_index: int = 0,
        time: float = 0.0,
        position: list[float] | None = None,
        rotation: list[float] | None = None,
        scale: list[float] | None = None,
    ) -> str:
        """Add an animation keyframe for an object."""
        # Find or create track for this object
        track = None
        for t in self._scene_state["keyframes"]:
            if t.get("target") == object_index:
                track = t
                break
        if track is None:
            track = {"target": object_index, "keyframes": []}
            self._scene_state["keyframes"].append(track)
        kf = {"time": time}
        if position:
            kf["position"] = position
        if rotation:
            kf["rotation"] = rotation
        if scale:
            kf["scale"] = scale
        track["keyframes"].append(kf)
        track["keyframes"].sort(key=lambda k: k["time"])
        return f"Added keyframe at t={time}s for object {object_index}. Track has {len(track['keyframes'])} keyframes."

    async def _tool_scene_clear(self) -> str:
        """Clear all objects and keyframes from the scene."""
        self._scene_state["objects"] = []
        self._scene_state["lights"] = []
        self._scene_state["keyframes"] = []
        return "Scene cleared."

    async def _tool_scene_get_state(self) -> str:
        """Get the current scene state as JSON."""
        import json
        return json.dumps(self._scene_state, indent=2)

    async def _tool_scene_set_bloom(self, strength: float = 0.8) -> str:
        """Set bloom post-processing strength (0-1.5)."""
        self._scene_state["bloom"] = max(0, min(1.5, strength))
        return f"Bloom strength set to {self._scene_state['bloom']}."

    async def _tool_scene_set_duration(self, seconds: float = 30.0) -> str:
        """Set the animation duration in seconds."""
        self._scene_state["duration"] = max(1, seconds)
        return f"Animation duration set to {self._scene_state['duration']}s."

    # ---- Storyboard-Driven Scene Tools ----

    async def _tool_scene_add_storyboard_element(
        self,
        element_type: str = "crown",
        position: list[float] | None = None,
        color: str = "#ffd700",
        scale: list[float] | None = None,
        rotation: list[float] | None = None,
        metalness: float = 0.9,
        roughness: float = 0.1,
        emissive: float = 0.2,
        storyboard_ref: str = "",
    ) -> str:
        """Add a storyboard visual element (crown, skyline, orb, ring, text, particle_field, light_rays)."""
        element = {
            "type": element_type,
            "position": position or [0, 0.5, 0],
            "color": color,
            "scale": scale or [1, 1, 1],
            "rotation": rotation or [0, 0, 0],
            "metalness": metalness,
            "roughness": roughness,
            "emissive": emissive,
            "storyboard_ref": storyboard_ref,
        }
        self._scene_state["objects"].append(element)
        idx = len(self._scene_state["objects"]) - 1
        return f"Added storyboard element '{element_type}' at index {idx}" + (f" (ref: {storyboard_ref})" if storyboard_ref else "")

    async def _tool_scene_set_camera_for_shot(
        self,
        shot_type: str = "wide",
        target: list[float] | None = None,
        fov: float = 50,
        movement: str = "static",
    ) -> str:
        """Set camera based on storyboard shot type (wide, close_up, macro, overhead, dolly, tracking, handheld)."""
        shot_configs = {
            "wide": {"position": [0, 3, 10], "fov": 60, "movement": "orbit"},
            "close_up": {"position": [0, 1, 4], "fov": 35, "movement": "static"},
            "macro": {"position": [0, 0.5, 2], "fov": 25, "movement": "static"},
            "overhead": {"position": [0, 10, 0.1], "fov": 50, "movement": "static"},
            "dolly": {"position": [0, 3, 10], "fov": 50, "movement": "dolly"},
            "tracking": {"position": [5, 2, 5], "fov": 45, "movement": "orbit"},
            "handheld": {"position": [0, 3, 8], "fov": 50, "movement": "handheld"},
            "low_angle": {"position": [0, -1, 6], "fov": 55, "movement": "static"},
            "birds_eye": {"position": [0, 15, 0.1], "fov": 45, "movement": "orbit"},
        }
        config = shot_configs.get(shot_type, shot_configs["wide"])
        if target:
            config["target"] = target
        config["fov"] = fov
        if movement != "static":
            config["movement"] = movement
        self._scene_state["camera"] = config
        return f"Camera set to '{shot_type}' shot: {config}"

    async def _tool_scene_add_text(
        self,
        text: str = "Title",
        position: list[float] | None = None,
        color: str = "#ffffff",
        size: float = 1.0,
        font: str = "bold",
    ) -> str:
        """Add 3D text element (rendered as a plane with text texture)."""
        element = {
            "type": "text",
            "text": text,
            "position": position or [0, 2, 0],
            "color": color,
            "scale": [size * len(text) * 0.6, size, 0.1],
            "rotation": [0, 0, 0],
            "metalness": 0.1,
            "roughness": 0.8,
            "emissive": 0.0,
            "storyboard_ref": "text",
        }
        self._scene_state["objects"].append(element)
        return f"Added text '{text}' at position {element['position']}."

    async def _tool_scene_add_environment(
        self,
        env_type: str = "studio",
        color: str = "#0a0a0f",
        fog: float = 0.015,
    ) -> str:
        """Set the environment/background (studio, city, void, sunset, neon, forest, space)."""
        env_configs = {
            "studio": {"color": "#0a0a0f", "fog": 0.015, "ambient": 0.4},
            "city": {"color": "#1a1a2e", "fog": 0.02, "ambient": 0.3},
            "void": {"color": "#000000", "fog": 0.005, "ambient": 0.1},
            "sunset": {"color": "#ff6b35", "fog": 0.025, "ambient": 0.5},
            "neon": {"color": "#0a0a1a", "fog": 0.02, "ambient": 0.2},
            "forest": {"color": "#0a1a0a", "fog": 0.03, "ambient": 0.3},
            "space": {"color": "#000005", "fog": 0.001, "ambient": 0.05},
        }
        config = env_configs.get(env_type, env_configs["studio"])
        if color != "#0a0a0f":
            config["color"] = color
        if fog != 0.015:
            config["fog"] = fog
        self._scene_state["environment"] = config
        return f"Environment set to '{env_type}': {config}"

    async def _tool_scene_link_to_storyboard(
        self,
        storyboard_path: str = "",
        track_name: str = "",
    ) -> str:
        """Link the scene to a storyboard document for reference."""
        self._scene_state["storyboard"] = {
            "path": storyboard_path,
            "track": track_name,
        }
        return f"Linked to storyboard: {storyboard_path or track_name}"

    async def _tool_get_project_structure(self, depth: int = 3) -> str:
        """Get project directory structure."""
        import os
        root = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
        lines = []

        def walk(path: str, prefix: str = "", current_depth: int = 0):
            if current_depth >= depth:
                return
            try:
                entries = sorted(os.listdir(path))
            except PermissionError:
                return
            for i, entry in enumerate(entries):
                if entry.startswith(".") or entry in ["node_modules", "__pycache__", "venv"]:
                    continue
                full_path = os.path.join(path, entry)
                is_last = i == len(entries) - 1
                connector = "└── " if is_last else "├── "
                lines.append(f"{prefix}{connector}{entry}")
                if os.path.isdir(full_path):
                    extension = "    " if is_last else "│   "
                    walk(full_path, prefix + extension, current_depth + 1)

        walk(root)
        return "\n".join(lines[:100])  # Limit output

    async def _tool_search_docs(self, query: str, limit: int = 5) -> str:
        """Search project documentation - scans real docs/ and markdown files."""
        import os
        import glob

        root = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
        results: list[str] = []
        query_lower = query.lower()

        # Search through markdown files in the project
        for pattern in ["**/*.md", "docs/**/*.md", "packages/**/README.md"]:
            for filepath in glob.glob(os.path.join(root, pattern), recursive=True):
                try:
                    with open(filepath, "r", encoding="utf-8") as f:
                        content = f.read()
                    # Check if query appears in content
                    if query_lower in content.lower():
                        # Extract relevant section
                        lines = content.split("\n")
                        for i, line in enumerate(lines):
                            if query_lower in line.lower():
                                # Get surrounding context
                                start = max(0, i - 1)
                                end = min(len(lines), i + 3)
                                snippet = "\n".join(lines[start:end])
                                rel_path = os.path.relpath(filepath, root)
                                results.append(f"[{rel_path}]:\n{snippet}")
                                if len(results) >= limit:
                                    return "\n\n".join(results)
                                break
                except (OSError, UnicodeDecodeError):
                    continue

        return "\n\n".join(results) if results else f"No docs found for '{query}'"

    async def _tool_get_system_health(self) -> str:
        """Get real system health status using psutil."""
        try:
            import psutil

            cpu = psutil.cpu_percent(interval=0.5)
            mem = psutil.virtual_memory()
            disk = psutil.disk_usage("/")

            health_parts = [
                f"CPU: {cpu}%",
                f"Memory: {mem.percent}% ({mem.used / (1024 ** 3):.1f}GB / {mem.total / (1024 ** 3):.1f}GB)",
                f"Disk: {disk.percent}% ({disk.used / (1024 ** 3):.1f}GB / {disk.total / (1024 ** 3):.1f}GB)",
            ]

            # Add GPU info if available
            try:
                import subprocess
                result = subprocess.run(
                    ["nvidia-smi", "--query-gpu=utilization.memory,memory.used,memory.total", "--format=csv,noheader,nounits"],
                    capture_output=True, text=True, timeout=5
                )
                if result.returncode == 0:
                    parts = result.stdout.strip().split(",")
                    if len(parts) >= 3:
                        mem_pct = float(parts[0])
                        mem_used = float(parts[1])
                        mem_total = float(parts[2])
                        health_parts.append(f"GPU VRAM: {mem_pct:.0f}% ({mem_used:.0f}MB / {mem_total:.0f}MB)")
            except (FileNotFoundError, subprocess.TimeoutExpired, Exception):
                pass

            return "System health: " + ", ".join(health_parts)
        except ImportError:
            # psutil not available, return basic info
            return "System health: psutil not installed. Run: pip install psutil"

    async def _tool_list_jobs(self, status: str | None = None) -> str:
        """List real jobs from the queue manager."""
        try:
            from ..queue.manager import queue_manager
            jobs = queue_manager.get_all_jobs()
            if status:
                jobs = [j for j in jobs if j.get("status") == status]

            status_counts: dict[str, int] = {}
            for job in jobs:
                s = job.get("status", "unknown")
                status_counts[s] = status_counts.get(s, 0) + 1

            parts = [f"{count} {st}" for st, count in sorted(status_counts.items())]
            return f"Jobs: {', '.join(parts)}" if parts else "Jobs: none in queue"
        except Exception as e:
            logger.warning(f"Failed to list jobs: {e}")
            return f"Jobs: queue unavailable ({e})"

    async def _tool_get_job_status(self, job_id: str) -> str:
        """Get real status of a specific job."""
        try:
            from ..queue.manager import queue_manager
            job = queue_manager.get_job(job_id)
            if not job:
                return f"Job {job_id}: not found"
            status = job.get("status", "unknown")
            progress = job.get("progress")
            if progress is not None:
                return f"Job {job_id}: {status}, {progress:.0%} complete"
            return f"Job {job_id}: {status}"
        except Exception as e:
            logger.warning(f"Failed to get job status: {e}")
            return f"Job {job_id}: error retrieving status ({e})"

    async def _tool_generate_visualization(
        self,
        style: str = "particles",
        color_scheme: str = "neon",
        intensity: float = 0.7,
        bpm: int = 120,
    ) -> str:
        """Generate a visualization configuration for the canvas."""
        import json
        config = {
            "type": "visualization",
            "style": style,
            "colorScheme": color_scheme,
            "intensity": intensity,
            "bpm": bpm,
            "colors": self._get_color_palette(color_scheme),
            "params": {
                "particleCount": int(200 * intensity),
                "speed": 0.5 + (bpm / 240),
                "scale": 1.0 + (intensity * 0.5),
                "glow": intensity > 0.6,
                "rotation": True,
            },
        }
        return json.dumps(config)

    def _get_color_palette(self, scheme: str) -> dict[str, str]:
        """Get color palette for visualization."""
        palettes = {
            "neon": {"primary": "#ff00ff", "secondary": "#00ffff", "accent": "#ffff00"},
            "fire": {"primary": "#ff4500", "secondary": "#ff8c00", "accent": "#ffd700"},
            "ocean": {"primary": "#006994", "secondary": "#40e0d0", "accent": "#7fffd4"},
            "forest": {"primary": "#228b22", "secondary": "#32cd32", "accent": "#90ee90"},
            "sunset": {"primary": "#ff6b6b", "secondary": "#feca57", "accent": "#ff9ff3"},
            "monochrome": {"primary": "#ffffff", "secondary": "#888888", "accent": "#cccccc"},
        }
        return palettes.get(scheme, palettes["neon"])

    async def list_models(self) -> list[dict[str, Any]]:
        """List available models in Ollama"""
        try:
            session = await self._get_session()
            async with session.get(f"{self.base_url}/api/tags") as resp:
                if resp.status == 200:
                    data = await resp.json()
                    self._available_models = [
                        m["name"] for m in data.get("models", [])
                    ]
                    return data.get("models", [])
        except Exception as e:
            logger.warning(f"Failed to list models: {e}")
        return []

    async def pull_model(self, name: str) -> bool:
        """Pull a model from Ollama registry"""
        try:
            session = await self._get_session()
            async with session.post(
                f"{self.base_url}/api/pull",
                json={"model": name},
                timeout=aiohttp.ClientTimeout(total=600),
            ) as resp:
                return resp.status == 200
        except Exception:
            return False

    async def delete_model(self, name: str) -> bool:
        """Delete a model from Ollama"""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.delete(
                    f"{self.base_url}/api/delete", json={"model": name}
                ) as resp:
                    return resp.status == 200
        except Exception:
            return False

    async def generate_storyboard(
        self, theme: str, model: str = "qwen2.5:3b", num_scenes: int = 5,
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

        # Ollama 0.33+: request structured JSON output natively (MLX + llama.cpp)
        # keep_alive leverages 0.33 trustworthy prefill restore points for reuse.
        chat_kwargs: dict[str, Any] = {}
        if use_structured_output:
            chat_kwargs["format"] = "json"
            chat_kwargs["think"] = False  # Disable thinking for structured JSON output
        if num_ctx is not None:
            chat_kwargs["num_ctx"] = num_ctx
        # Default to 16k ctx capped by chat() VRAM guard; caller can pass smaller for 8GB safety
        result = await self.chat(messages, model=model, keep_alive="10m", **chat_kwargs)

        # Parse the JSON response
        response_text = result.get("message", {}).get("content", "")

        # Try to extract JSON from the response (fallback for models not honoring format=json)
        try:
            # Handle case where model wraps JSON in markdown code blocks
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

    async def _mock_generate(self, params: dict[str, Any]) -> dict[str, Any]:
        """
        Mock generation for testing without Ollama service.

        Returns a realistic mock storyboard response.
        """
        # Simulate generation delay
        await asyncio.sleep(2)

        num_scenes = params.get("num_scenes", 5)
        theme = params.get("prompt", "A mysterious adventure")

        # Generate mock scenes based on theme
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

    def set_default_model(self, model: str):
        """Set the default model for generation"""
        self._default_model = model

    def get_default_model(self) -> str:
        """Get the default model"""
        return self._default_model

    def get_available_models(self) -> list[str]:
        """Get list of available models from last refresh"""
        return self._available_models.copy()
