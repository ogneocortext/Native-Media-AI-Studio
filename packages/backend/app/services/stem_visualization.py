"""Stem-reactive visualization mapping (A5).

Extends per-stem analysis into shader-uniform-ready data for the frontend
WebGL pipeline. Maps per-stem RMS/energy curves to normalized uniform
values that drive visuals in the deterministic fallback mode.

Reference: Neural Frames' 8-stem → visual-parameter mapping.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

# Target number of energy-curve samples for visualization uniforms.
_UNIFORM_CURVE_POINTS = 128

# Stem → uniform prefix mapping (matches the frontend WebGL uniform names).
STEM_UNIFORM_MAP = {
    "vocals": "u_vocals",
    "drums": "u_drums",
    "bass": "u_bass",
    "other": "u_other",
}


def _downsample_curve(curve: list[float], target: int) -> list[float]:
    if not curve:
        return []
    if len(curve) <= target:
        return [float(v) for v in curve]
    segment = len(curve) / target
    out: list[float] = []
    for i in range(target):
        start = int(i * segment)
        end = int((i + 1) * segment)
        chunk = curve[start:end]
        out.append(max(chunk) if chunk else 0.0)
    return out


def _normalize_curve(curve: list[float]) -> list[float]:
    if not curve:
        return []
    mx = max(curve)
    if mx <= 1e-9:
        return [0.0 for _ in curve]
    return [min(1.0, max(0.0, v / mx)) for v in curve]


async def get_stem_visualization_uniforms(filename: str) -> dict[str, Any]:
    """Return shader-uniform-ready per-stem data for the frontend WebGL pipeline.

    If stems have not been separated yet, returns ``{"stems": {}, "separated": False}``.
    Callers should trigger separation first via ``POST /api/audio/separate-file``.
    """
    from ..services.stem_analysis import analyze_stems_for_visualization

    analysis = await analyze_stems_for_visualization(filename)
    stems_in = analysis.get("stems", {})

    if not stems_in:
        return {"stems": {}, "separated": False, "uniforms": {}}

    uniforms: dict[str, Any] = {}
    for stem_name, stem_data in stems_in.items():
        energy_curve = stem_data.get("energy_curve", [])
        normalized = _normalize_curve(energy_curve)
        downsampled = _downsample_curve(normalized, _UNIFORM_CURVE_POINTS)
        uniform_name = STEM_UNIFORM_MAP.get(stem_name, f"u_{stem_name}")
        uniforms[uniform_name] = {
            "stem": stem_name,
            "energy_curve": downsampled,
            "curve_points": len(downsampled),
            "rms_mean": stem_data.get("rms_mean", 0.0),
            "rms_std": stem_data.get("rms_std", 0.0),
            "centroid_mean": stem_data.get("centroid_mean", 0.0),
            "zcr_mean": stem_data.get("zcr_mean", 0.0),
            "duration": stem_data.get("duration", 0.0),
            "file": stem_data.get("file", ""),
            "url": stem_data.get("url", ""),
        }

    return {
        "stems": stems_in,
        "separated": True,
        "uniforms": uniforms,
        "curve_points": _UNIFORM_CURVE_POINTS,
    }
