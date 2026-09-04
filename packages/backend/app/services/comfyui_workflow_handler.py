"""ComfyUI workflow handler."""

import base64
import uuid
from datetime import datetime
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

        prompt_id = result.get("prompt_id", "unknown")
        seed = result.get("seed", -1)

        # Video results are already saved to disk by the adapter
        # (_fetch_video writes them under PROJECT_ROOT/output/video).
        if is_video and result.get("video_path"):
            return {
                "output_path": result["video_path"],
                "prompt_id": prompt_id,
                "seed": seed,
                "is_video": is_video,
                "info": result.get("info", f"Generation completed. seed: {seed}"),
            }

        # Image results come back as base64 — persist them to disk. Without
        # this the job would report an output_path that doesn't exist.
        image_b64 = result.get("image")
        if not image_b64:
            raise RuntimeError(
                f"ComfyUI returned no image data for prompt {prompt_id}"
            )

        output_dir = PROJECT_ROOT / "output" / "images"
        output_dir.mkdir(parents=True, exist_ok=True)
        filename = (
            f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}.png"
        )
        filepath = output_dir / filename
        filepath.write_bytes(base64.b64decode(image_b64))

        return {
            "output_path": str(filepath),
            "prompt_id": prompt_id,
            "seed": seed,
            "is_video": is_video,
            "info": result.get("info", f"Generation completed. seed: {seed}"),
        }
