"""
Generation time estimation and VRAM preflight helpers.

These live in ``services/`` because they are business logic, not HTTP route
handlers. Callers import them from ``app.services.generation_estimator`` (the
integrations routers are thin wrappers over this module).
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

logger = logging.getLogger(__name__)


def estimate_generation_time(
    steps: int,
    width: int,
    height: int,
    num_frames: int,
    fps: int,
    model_name: str,
) -> dict[str, Any]:
    """Estimate video generation time based on parameters.

    Pure function — no I/O, safe to call from request handlers or tests.
    """
    # Base seconds per frame for a 512x512 image at 20 steps on GTX 1070 Ti
    base_sec_per_frame = 2.5
    # Scale by resolution
    resolution_factor = (width * height) / (512 * 512)
    # Scale by steps
    step_factor = steps / 20
    # Scale by model size (larger models are slower)
    model_factor = 1.0
    if "wan" in model_name.lower():
        model_factor = 3.0  # Wan 2.2 5B is ~3x slower
    elif "kandinsky" in model_name.lower():
        model_factor = 2.0
    elif "sd" in model_name.lower() or "v1-5" in model_name.lower():
        model_factor = 1.0
    elif "hunyuan" in model_name.lower():
        model_factor = 1.5

    sec_per_frame = base_sec_per_frame * resolution_factor * step_factor * model_factor
    total_frames = num_frames if num_frames > 0 else int(fps * 5)
    estimated_seconds = sec_per_frame * total_frames

    # Add overhead for loading model, saving, etc.
    overhead_seconds = 10
    estimated_seconds += overhead_seconds

    return {
        "estimated_seconds": round(estimated_seconds, 1),
        "estimated_minutes": round(estimated_seconds / 60, 1),
        "estimated_end_time": (datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(seconds=estimated_seconds)).isoformat() + "Z",
        "sec_per_frame": round(sec_per_frame, 1),
        "total_frames": total_frames,
        "factors": {
            "resolution_factor": round(resolution_factor, 2),
            "step_factor": round(step_factor, 2),
            "model_factor": model_factor,
        },
    }
