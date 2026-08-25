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
        self._default_model: str = "qwen2.5:3b"  # Default to smaller model for speed
        self._last_model: str = self._default_model  # Track last used model for VRAM manager
        self._last_health_log: str | None = None

    async def health_check(self) -> bool:
        """Check if Ollama is available"""
        try:
            async with aiohttp.ClientSession() as session:
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

        payload = {
            "model": model,
            "prompt": prompt,
            "stream": False,
        }

        if system:
            payload["system"] = system
        if options:
            payload["options"] = options

        async with aiohttp.ClientSession() as session:
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

    async def chat(
        self,
        messages: list[dict[str, str]],
        model: str = "qwen2.5:3b",
        tools: list[dict[str, Any]] | None = None,
        stream: bool = False,
        think: bool | str | None = None,
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
            **options: Additional options

        Returns:
            Dictionary containing the response, or async iterator if streaming
        """
        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "stream": stream,
        }
        if tools:
            payload["tools"] = tools
        if think is not None:
            payload["think"] = think
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
        async with aiohttp.ClientSession() as session:
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
        async with aiohttp.ClientSession() as session:
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
        }

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
            async with aiohttp.ClientSession() as session:
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
            async with aiohttp.ClientSession() as session:
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
        self, theme: str, model: str = "qwen2.5:3b", num_scenes: int = 5
    ) -> dict[str, Any]:
        """
        Generate a structured storyboard prompt using LLM.

        This method queries the local LLM to create a JSON storyboard
        with scene descriptions, camera angles, and visual elements.

        Args:
            theme: The theme or concept for the storyboard
            model: Model to use (qwen2.5:3b, llama3.2, etc.)
            num_scenes: Target number of scenes (3-8)

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

        result = await self.chat(messages, model=model)

        # Parse the JSON response
        response_text = result.get("message", {}).get("content", "")

        # Try to extract JSON from the response
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
