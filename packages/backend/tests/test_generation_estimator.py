"""
Tests for the generation cost/time estimator (services/generation_estimator.py).

Guards the per-model time/VRAM math used by ``POST /api/video/estimate-cost``
and the wizard estimate card (D9). Pure functions — no I/O, no network.
"""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services.generation_estimator import (  # noqa: E402
    estimate_generation_time,
    estimate_render_cost,
)


def test_ltx_is_faster_than_wan_q4():
    """LTX 2.3 distilled must estimate ~4x faster than Wan 2.2 Q4."""
    common = {"steps": 25, "width": 768, "height": 512, "num_frames": 25, "fps": 25}
    ltx = estimate_generation_time(model_name="ltxv-2b-0.9.8-distilled-fp8", **common)
    wan = estimate_generation_time(model_name="Wan2.2-TI2V-5B-Q4_K_M.gguf", **common)

    assert ltx["estimated_seconds"] < wan["estimated_seconds"]
    # LTX should be roughly 4x faster (model_factor 0.55 vs 2.2).
    ratio = wan["estimated_seconds"] / ltx["estimated_seconds"]
    assert 2.5 < ratio < 6.0, f"LTX/Wan time ratio {ratio:.1f}x not in expected range"


def test_ltx_vram_fits_8gb():
    """LTX VRAM estimate must fit under 8GB."""
    est = estimate_render_cost(
        steps=25, width=768, height=512, num_frames=25, fps=25,
        model_name="ltxv-2b-0.9.8-distilled-fp8",
    )
    assert est["vram_estimate_gb"] <= 8.0, f"LTX VRAM {est['vram_estimate_gb']}GB exceeds 8GB"


def test_estimate_returns_required_keys():
    """Every estimate returns the fields the wizard card consumes."""
    est = estimate_render_cost(
        steps=25, width=768, height=512, num_frames=25, fps=25,
        model_name="ltxv-2b-0.9.8-distilled-fp8",
    )
    for key in ("estimated_seconds", "estimated_minutes", "vram_estimate_mb",
                "vram_estimate_gb", "total_frames", "sec_per_frame"):
        assert key in est, f"Missing estimate key: {key}"


def test_unknown_model_falls_back_to_animatediff():
    """An unrecognized model falls back to AnimateDiff defaults."""
    est = estimate_generation_time(
        steps=20, width=512, height=512, num_frames=16, fps=12,
        model_name="totally-unknown-model.safetensors",
    )
    assert est["factors"]["model_factor"] == 1.0  # SD/AnimateDiff baseline
