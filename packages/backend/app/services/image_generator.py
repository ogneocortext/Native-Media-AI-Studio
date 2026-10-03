"""
Image generation job handler.
"""
import base64
import json
import logging
import struct
from datetime import datetime
from typing import Any

# SD WebUI removed - using ComfyUI only
from ..core.config import PROJECT_ROOT
from ..models.job import Job
from ..services.go_worker_client import write_sidecar as go_write_sidecar

logger = logging.getLogger(__name__)

# Output directory for generated images
OUTPUT_DIR = PROJECT_ROOT / "output" / "images"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

#: Minimum edge length, in pixels, for an image to count as a real render. The
#: adapters' ``_mock_generate`` emits a 1x1 PNG, so reading the IHDR dimensions is
#: an exact test rather than a size heuristic. A byte-size threshold was tried
#: first and rejected: a legitimately small render (a 64x64 flat image compresses
#: to ~98 bytes) is indistinguishable from a placeholder by size alone, whereas
#: dimensions are unambiguous.
_MIN_IMAGE_EDGE_PX = 8


def _png_dimensions(data: bytes) -> tuple[int, int] | None:
    """(width, height) from a PNG's IHDR chunk, or None if not a readable PNG."""
    if len(data) < 24 or data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    if data[12:16] != b"IHDR":
        return None
    return struct.unpack(">II", data[16:24])


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
            adapter: ComfyUI adapter instance. If None, creates one with real service mode.
        """
        from ..adapters.comfyui import ComfyUIAdapter
        self.adapter = adapter or ComfyUIAdapter()

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
            # A 1x1 PNG is what the adapters' mock generators emit. Writing it and
            # reporting success makes the UI show a "completed" job whose output is
            # a single pixel, which reads as a real render. Refuse it instead.
            dims = _png_dimensions(image_data)
            if dims is None or min(dims) < _MIN_IMAGE_EDGE_PX:
                shown = "unreadable" if dims is None else f"{dims[0]}x{dims[1]}"
                raise ValueError(
                    f"Generation for job {job.id} returned a {shown} image, "
                    "which is a placeholder rather than a real render (mock "
                    "generation is disabled). Not reporting this as a successful job."
                )
            with open(image_path, "wb") as f:
                f.write(image_data)
        else:
            # Previously this only logged a warning and returned an output path
            # anyway, so the job was recorded `completed` with output_path=None and
            # a plausible-looking seed. Raise instead: a job with no image is not a
            # success, and the queue exists to report the truth about work done.
            logger.warning("Generation result for job %s contained no image data", job.id)
            raise ValueError(
                f"Generation for job {job.id} returned no image data; "
                "refusing to record the job as completed"
            )

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
        # Persist sidecar through go-worker when available; fall back to direct write.
        worker_result = await go_write_sidecar(job.id, sidecar_data, filename=filename)
        if worker_result is None or not worker_result.get("written"):
            with open(sidecar_path, "w") as f:
                json.dump(sidecar_data, f, indent=2)

        return {
            "image": str(image_path),
            "sidecar": str(sidecar_path)
        }


# Default handler instance for easy import
default_handler = ImageGenerationHandler()
