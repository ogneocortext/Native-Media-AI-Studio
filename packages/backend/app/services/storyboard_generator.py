"""Storyboard generation job handler.
Uses Ollama adapter to generate structured JSON storyboard prompts.
"""

import json
from datetime import datetime
from typing import Any

from ..adapters.ollama import OllamaAdapter
from ..core.config import PROJECT_ROOT
from ..models.job import Job

OUTPUT_DIR = PROJECT_ROOT / "output" / "storyboards"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


class StoryboardGeneratorHandler:
    """Handler for storyboard generation jobs using Ollama LLM."""

    def __init__(self, adapter: OllamaAdapter | None = None):
        self.adapter = adapter or OllamaAdapter(mock_mode=True)

    async def process_job(self, job: Job) -> dict[str, Any]:
        """Process a storyboard generation job."""
        params = job.params
        theme = params.get("theme", "A creative story")
        num_scenes = params.get("num_scenes", 5)
        model = params.get("model", self.adapter.get_default_model())

        result = await self.adapter.generate_with_fallback(
            {
                "prompt": theme,
                "num_scenes": num_scenes,
                "model": model,
            }
        )

        output_files = await self.save_storyboard(job, result)

        return {
            "storyboard_path": output_files["storyboard"],
            "num_scenes": result.get("total_scenes", num_scenes),
            "total_duration": result.get("estimated_duration_seconds", 0),
            "model_used": result.get("model_used", model),
            "style": result.get("style", "cinematic"),
            "transitions": result.get("transitions", []),
        }

    async def save_storyboard(self, job: Job, result: dict[str, Any]) -> dict[str, str]:
        """Save storyboard JSON to output folder."""
        timestamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
        filename = f"{timestamp}_{job.id[:8]}"
        storyboard_path = OUTPUT_DIR / f"{filename}.json"

        storyboard_data = {
            "job_id": job.id,
            "theme": result.get("theme", ""),
            "generated_at": datetime.now().isoformat(),
            "scenes": result.get("scenes", []),
            "total_scenes": result.get("total_scenes", 0),
            "estimated_duration_seconds": result.get("estimated_duration_seconds", 0),
            "style": result.get("style", "cinematic"),
            "transitions": result.get("transitions", []),
            "model_used": result.get("model_used", "unknown"),
            "mock": result.get("mock", False),
        }

        with open(storyboard_path, "w", encoding="utf-8") as f:
            json.dump(storyboard_data, f, indent=2)

        return {"storyboard": str(storyboard_path)}

    async def generate_storyboard_direct(
        self, theme: str, model: str = "qwen2.5:3b", num_scenes: int = 5
    ) -> dict[str, Any]:
        """Generate a storyboard directly (not via job queue)."""
        return await self.adapter.generate_storyboard(theme, model, num_scenes)


default_handler = StoryboardGeneratorHandler()
