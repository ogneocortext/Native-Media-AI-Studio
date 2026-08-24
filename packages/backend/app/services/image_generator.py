"""
Image generation job handler.
"""
import base64
import json
import logging
from datetime import datetime
from typing import Any

# SD WebUI removed - using ComfyUI only
from ..core.config import PROJECT_ROOT
from ..models.job import Job

logger = logging.getLogger(__name__)

# Output directory for generated images
OUTPUT_DIR = PROJECT_ROOT / "output" / "images"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


class ImageGenerationHandler:
    """
    Handler for image generation jobs.
    
    This handler processes image generation jobs by:
    1. Receiving job parameters from the queue
    2. Using the SD WebUI adapter to generate images
    3. Saving generated images and JSON sidecars to output folder
    
    Per Guidelines 3.3: Every generated media file gets a JSON sidecar:
    - output/images/2026-04-21_143022.png
    - output/images/2026-04-21_143022.json (Contains job_id, prompt, seed, model, generation_time)
    """

    def __init__(self, adapter=None):
        """
        Initialize the image generation handler.
        
        Args:
            adapter: ComfyUI adapter instance. If None, creates one in mock mode.
        """
        from ..adapters.comfyui import ComfyUIAdapter
        self.adapter = adapter or ComfyUIAdapter(mock_mode=True)

    async def process_job(self, job: Job) -> dict[str, Any]:
        """
        Process an image generation job.
        
        Args:
            job: The job to process
            
        Returns:
            Dictionary containing:
            - output_path: Path to the generated image
            - sidecar_path: Path to the JSON sidecar
            - seed: Seed used for generation
            - info: Generation info
        """
        params = job.params

        # Generate with adapter (auto-fallback to mock if service unavailable)
        result = await self.adapter.generate_with_fallback(params)

        # Save output image and JSON sidecar
        output_files = await self.save_output(job, result)

        return {
            "output_path": output_files["image"],
            "sidecar_path": output_files["sidecar"],
            "seed": result.get("seed"),
            "info": result.get("info")
        }

    async def save_output(self, job: Job, result: dict[str, Any]) -> dict[str, str]:
        """
        Save generated image and JSON sidecar.
        
        Per Guidelines 3.3, saves both the image and a corresponding JSON sidecar
        containing job metadata.
        
        Args:
            job: The completed job
            result: Generation result from adapter
            
        Returns:
            Dictionary with paths to saved files:
            - image: Path to the saved image
            - sidecar: Path to the JSON sidecar
        """
        timestamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
        filename = f"{timestamp}_{job.id[:8]}"

        image_path = OUTPUT_DIR / f"{filename}.png"

        # Save image from base64. Adapters may provide either a top-level
        # "image" (single base64 string) or an "images" list with "data" entries.
        image_b64 = result.get("image")
        if not image_b64:
            images = result.get("images") or []
            if images and isinstance(images[0], dict):
                image_b64 = images[0].get("data")

        if image_b64:
            image_data = base64.b64decode(image_b64)
            with open(image_path, "wb") as f:
                f.write(image_data)
        else:
            logger.warning("Generation result for job %s contained no image data", job.id)

        # Create JSON sidecar per Guidelines 3.3
        sidecar_data = {
            "job_id": job.id,
            "prompt": job.params.get("prompt", ""),
            "negative_prompt": job.params.get("negative_prompt", ""),
            "seed": result.get("seed"),
            "model": job.params.get("model", "default"),
            "generation_time": datetime.now().isoformat(),
            "steps": job.params.get("steps", 20),
            "cfg_scale": job.params.get("cfg_scale", 7.0),
            "width": job.params.get("width", 512),
            "height": job.params.get("height", 512),
            "sampler": job.params.get("sampler_name", "Euler a"),
            "info": result.get("info", ""),
        }

        sidecar_path = OUTPUT_DIR / f"{filename}.json"
        with open(sidecar_path, "w") as f:
            json.dump(sidecar_data, f, indent=2)

        return {
            "image": str(image_path),
            "sidecar": str(sidecar_path)
        }


# Default handler instance for easy import
default_handler = ImageGenerationHandler()
