"""ComfyUI workflow handler."""

import base64
import json
import logging
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from ..adapters.registry import adapter_registry
from ..core.config import PROJECT_ROOT
from ..models.job import Job
from ..services.go_worker_client import write_sidecar as go_write_sidecar

logger = logging.getLogger(__name__)


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

        # Structured debug capture for Wan / video attempts.
        # Persist workflow + resolved model names + adapter info so the
        # red-pattern issue can be triaged without manual copy-paste.
        debug_dir = PROJECT_ROOT / "output" / "logs" / "comfyui_debug"
        debug_dir.mkdir(parents=True, exist_ok=True)
        debug_stem = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{job.id[:8]}"
        debug_payload: dict[str, Any] = {
            "job_id": job.id,
            "prompt_id": prompt_id,
            "seed": seed,
            "is_video": is_video,
            "params": params,
            "result_info": result.get("info"),
            "adapter": getattr(adapter, "name", "comfyui"),
        }
        # Include workflow/t5/vae if the adapter exposed them (Wan path does).
        for key in ("workflow", "t5_name", "vae_name", "ckpt_name", "model_variant"):
            if key in result:
                debug_payload[key] = result[key]

        # Best-effort tail of comfyui.log for postmortem analysis.
        try:
            from ..core.comfyui_client import fetch_comfyui_log_tail
            log_tail = await fetch_comfyui_log_tail(str(adapter.base_url))
            if log_tail:
                debug_payload["comfyui_log_tail"] = log_tail
        except Exception as exc:  # pragma: no cover - debug best-effort
            logger.debug("Wan debug log tail fetch failed: %s", exc)

        try:
            debug_file = debug_dir / f"{debug_stem}.json"
            debug_file.write_text(json.dumps(debug_payload, indent=2, default=str))
            logger.info("Wan/video debug artifact written: %s", debug_file)
        except Exception as exc:  # pragma: no cover - debug best-effort
            logger.debug("Wan debug artifact write failed: %s", exc)

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

        # Write JSON sidecar via go-worker when available.
        sidecar_data = {
            "job_id": job.id,
            "prompt_id": prompt_id,
            "seed": seed,
            "output_path": str(filepath),
            "is_video": is_video,
            "info": result.get("info", f"Generation completed. seed: {seed}"),
        }
        sidecar_name = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{job.id[:8]}"
        await go_write_sidecar(job.id, sidecar_data, filename=sidecar_name)

        return {
            "output_path": str(filepath),
            "prompt_id": prompt_id,
            "seed": seed,
            "is_video": is_video,
            "info": result.get("info", f"Generation completed. seed: {seed}"),
        }
