"""ComfyUI workflow handler."""

from typing import Any

from ..adapters.registry import adapter_registry
from ..core.config import PROJECT_ROOT
from ..models.job import Job


class ComfyUIWorkflowHandler:
    """Handler for ComfyUI workflow execution."""

    async def process_job(self, job: Job) -> dict[str, Any]:
        """Process a ComfyUI workflow job."""
        adapter = adapter_registry.get("comfyui")

        if not adapter:
            raise RuntimeError("ComfyUI adapter not available")

        params = job.params or {}

        is_video = params.get("video", False) or params.get("num_frames", 1) > 1

        result = await adapter.generate(params)

        output_dir = PROJECT_ROOT / "output" / ("video" if is_video else "images")
        output_dir.mkdir(parents=True, exist_ok=True)

        import uuid
        from datetime import datetime

        ext = "mp4" if is_video else "png"
        filename = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}.{ext}"
        filepath = output_dir / filename

        prompt_id = result.get("prompt_id", "unknown")
        seed = result.get("seed", -1)

        return {
            "output_path": str(filepath),
            "prompt_id": prompt_id,
            "seed": seed,
            "is_video": is_video,
            "info": f"Generation completed. seed: {seed}",
        }
