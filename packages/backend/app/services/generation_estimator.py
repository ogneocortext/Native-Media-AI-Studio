"""
Generation time estimation and VRAM preflight helpers.

These live in ``services/`` because they are business logic, not HTTP route
handlers. Callers import them from ``app.services.generation_estimator`` (the
integrations routers are thin wrappers over this module).
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

# Tier table + classifier live in core/model_tiers.py (single source of truth
# shared with the ComfyUI adapter routing and the /video-models endpoint
# tagging). Re-exported here so existing callers keep working.
from ..core.config import PROJECT_ROOT
from ..core.model_tiers import (
    VRAM_REQUIREMENTS,
    classify_model_variant,
    estimate_vram_requirement,
)

logger = logging.getLogger(__name__)

__all__ = [
    "VRAM_REQUIREMENTS",
    "classify_model_variant",
    "estimate_vram_requirement",
    "estimate_generation_time",
    "estimate_render_cost",
    "estimate_cost_per_shot",
    "estimate_cost_from_manifest",
    "load_cloud_pricing",
]

# Cloud pricing cache
_CLOUD_PRICING: dict[str, Any] | None = None


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
    # Scale by resolution (log-space to dampen extreme resolutions)
    resolution_factor = ((width * height) / (512 * 512)) ** 0.5
    # Scale by steps (log-transform because doubling steps does not double time linearly)
    step_factor = max(0.5, (steps / 20) ** 0.85)
    # Scale by model size (larger models are slower)
    model_factor = 1.0
    tier = classify_model_variant(model_name)
    if tier in ("wan2_1_t2v_1_3b", "wan2_1_fun_inp_1_3b"):
        # 1.3B is ~2x smaller than 5B — faster per step, fits 8GB at 832×480
        model_factor = 1.6
    elif tier in ("wan_ti2v_5b_gguf_q4", "wan_ti2v_5b_gguf_q5"):
        # GGUF is quantized — ~2x slower than SD1.5 baseline but fits 8GB
        model_factor = 2.2
    elif tier == "wan_ti2v_5b_fp16":
        model_factor = 3.0  # FP16 needs 16-24GB VRAM
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
        "estimated_end_time": (datetime.now(timezone.utc) + timedelta(seconds=estimated_seconds)).isoformat().replace("+00:00", "Z"),
        "sec_per_frame": round(sec_per_frame, 1),
        "total_frames": total_frames,
        "factors": {
            "resolution_factor": round(resolution_factor, 2),
            "step_factor": round(step_factor, 2),
            "model_factor": model_factor,
        },
    }


def estimate_render_cost(
    steps: int,
    width: int,
    height: int,
    num_frames: int,
    fps: int,
    model_name: str,
    cloud_price_per_second: float | None = None,
) -> dict[str, Any]:
    """Estimate render cost in local compute terms and optional cloud-burst USD.

    Returns time estimate + VRAM estimate + optional cloud cost.
    """
    time_est = estimate_generation_time(steps, width, height, num_frames, fps, model_name)

    # VRAM estimate (rough, matches frontend estimateVRAMUsage logic)
    pixel_count = width * height
    vram_mb = int((pixel_count * 4 * 3) / (1024 * 1024) + 1500 + 500)

    result: dict[str, Any] = {
        **time_est,
        "vram_estimate_mb": vram_mb,
        "vram_estimate_gb": round(vram_mb / 1024, 1),
    }

    if cloud_price_per_second is not None:
        cloud_cost = time_est["estimated_seconds"] * cloud_price_per_second
        result["cloud_cost_usd"] = round(cloud_cost, 4)
        result["cloud_price_per_second"] = cloud_price_per_second

    return result


# ---------------------------------------------------------------------------
# A2: Per-shot cost breakdown + cloud pricing config
# ---------------------------------------------------------------------------


def load_cloud_pricing() -> dict[str, Any]:
    """Load cloud pricing config from ``config/cloud_pricing.json``.

    Result is cached for the process lifetime. Returns a dict with a
    ``models`` mapping (model_id → pricing info) and ``defaults``.
    """
    global _CLOUD_PRICING
    if _CLOUD_PRICING is not None:
        return _CLOUD_PRICING

    pricing_path = PROJECT_ROOT / "config" / "cloud_pricing.json"
    try:
        raw = pricing_path.read_text(encoding="utf-8")
        _CLOUD_PRICING = json.loads(raw)
    except FileNotFoundError:
        logger.warning("cloud_pricing.json not found at %s — cloud costs will be unavailable", pricing_path)
        _CLOUD_PRICING = {"models": {}, "defaults": {"currency": "USD", "unit": "per_second"}}
    except json.JSONDecodeError as exc:
        logger.error("Failed to parse cloud_pricing.json: %s", exc)
        _CLOUD_PRICING = {"models": {}, "defaults": {"currency": "USD", "unit": "per_second"}}
    return _CLOUD_PRICING


def _resolve_cloud_price(model_name: str, cloud_price_per_second: float | None) -> float | None:
    """Resolve cloud $/sec from explicit arg or pricing config."""
    if cloud_price_per_second is not None:
        return cloud_price_per_second
    pricing = load_cloud_pricing()
    # Normalise model key for lookup
    key = (model_name or "").lower().strip()
    # Direct match
    if key in pricing.get("models", {}):
        return pricing["models"][key].get("cloud_price_per_second")
    # Try classify_model_variant tier as fallback
    tier = classify_model_variant(model_name)
    for _mid, info in pricing.get("models", {}).items():
        if info.get("tier") == tier:
            return info.get("cloud_price_per_second")
    return None


def estimate_cost_per_shot(
    shot: dict[str, Any],
    default_model: str = "wan2.2-5b",
    fps: int = 24,
    steps: int = 20,
    width: int = 1920,
    height: int = 1080,
    cloud_price_per_second: float | None = None,
) -> dict[str, Any]:
    """Estimate cost for a single shot from a shot manifest entry.

    Shot dict keys: ``duration_seconds`` (required), ``model`` (optional),
    ``section`` / ``id`` (optional, for labelling).
    """
    duration = float(shot.get("duration_seconds") or shot.get("duration") or 5.0)
    model = shot.get("model") or default_model
    shot_fps = int(shot.get("fps") or fps)
    shot_steps = int(shot.get("steps") or steps)
    shot_width = int(shot.get("width") or width)
    shot_height = int(shot.get("height") or height)

    price = _resolve_cloud_price(model, cloud_price_per_second)
    estimate = estimate_render_cost(
        steps=shot_steps,
        width=shot_width,
        height=shot_height,
        num_frames=int(duration * shot_fps),
        fps=shot_fps,
        model_name=model,
        cloud_price_per_second=price,
    )
    estimate.setdefault("shot_id", shot.get("id") or shot.get("section") or "unknown")
    estimate.setdefault("model", model)
    estimate["duration_seconds"] = round(duration, 2)
    return estimate


def estimate_cost_from_manifest(
    manifest: dict[str, Any] | list[dict[str, Any]],
    default_model: str = "wan2.2-5b",
    fps: int = 24,
    steps: int = 20,
    width: int = 1920,
    height: int = 1080,
    cloud_price_per_second: float | None = None,
) -> dict[str, Any]:
    """Estimate total cost for a full shot manifest (A2 per-shot breakdown).

    ``manifest`` can be:
    - A list of shot dicts (each with ``duration_seconds``)
    - A dict with a ``shots`` or ``scenes`` list
    - The full ``shot-plan.json`` contract from A1

    Returns totals plus a per-shot breakdown.
    """
    if isinstance(manifest, dict):
        shots = manifest.get("shots") or manifest.get("scenes") or manifest.get("sections") or []
    elif isinstance(manifest, list):
        shots = manifest
    else:
        shots = []

    shot_estimates: list[dict[str, Any]] = []
    total_seconds = 0.0
    total_frames = 0
    total_cloud_cost = 0.0
    max_vram_mb = 0
    any_cloud = False

    for shot in shots:
        est = estimate_cost_per_shot(
            shot,
            default_model=default_model,
            fps=shot.get("fps", fps),
            steps=shot.get("steps", steps),
            width=shot.get("width", width),
            height=shot.get("height", height),
            cloud_price_per_second=cloud_price_per_second,
        )
        shot_estimates.append(est)
        total_seconds += est.get("duration_seconds", 0.0)
        total_frames += est.get("total_frames", 0)
        if "cloud_cost_usd" in est:
            total_cloud_cost += est["cloud_cost_usd"]
            any_cloud = True
        vram = est.get("vram_estimate_mb", 0)
        if vram > max_vram_mb:
            max_vram_mb = vram

    return {
        "total_shots": len(shot_estimates),
        "total_duration_seconds": round(total_seconds, 2),
        "total_frames": total_frames,
        "total_estimated_seconds": round(total_seconds, 2),
        "total_estimated_minutes": round(total_seconds / 60, 1),
        "vram_peak_mb": max_vram_mb,
        "vram_peak_gb": round(max_vram_mb / 1024, 1),
        "cloud_cost_usd": round(total_cloud_cost, 4) if any_cloud else None,
        "shots": shot_estimates,
    }
