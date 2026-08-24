"""
Ollama adapter.
Provides integration with local LLM via Ollama.
Implements BaseAdapter interface for storyboard prompt generation.
"""

import asyncio
import json
import logging
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
        self, messages: list[dict[str, str]], model: str = "qwen2.5:3b", **options
    ) -> dict[str, Any]:
        """
        Chat completion with Ollama.

        Args:
            messages: List of message dicts with 'role' and 'content'
            model: Model name
            **options: Additional options

        Returns:
            Dictionary containing:
                - message: The assistant's response
                - model: Model used
        """
        payload = {
            "model": model,
            "messages": messages,
            "stream": False,
        }
        payload.update(options)

        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.base_url}/api/chat",
                json=payload,
                timeout=aiohttp.ClientTimeout(total=120),
            ) as resp:
                if resp.status != 200:
                    error = await resp.text()
                    raise RuntimeError(f"Ollama error: {error}")

                return await resp.json()

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
