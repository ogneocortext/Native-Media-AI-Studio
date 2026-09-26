"""Per-stem audio analysis for visualization mapping.

Computes downsampled energy curves and feature summaries for each
separated stem (vocals, drums, bass, other) so the frontend visualizer
can map stems to different visual layers.
"""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import Any

from .source_separation import SEPARATION_DIR, source_separator

logger = logging.getLogger(__name__)

# Target number of energy-curve samples for visualization (matches
# the master `energy_curve` resolution in audio analysis).
_STEM_CURVE_POINTS = 80


def _downsample_curve(curve: list[float], target: int) -> list[float]:
    if not curve:
        return []
    if len(curve) <= target:
        return [float(v) for v in curve]
    # Simple max-pooling per segment preserves peaks better than mean.
    segment = len(curve) / target
    out: list[float] = []
    for i in range(target):
        start = int(i * segment)
        end = int((i + 1) * segment)
        chunk = curve[start:end]
        out.append(max(chunk) if chunk else 0.0)
    return out


async def analyze_stems_for_visualization(filename: str) -> dict[str, Any]:
    """Return per-stem visualization data for an audio file.

    If stems have not been separated yet, returns ``{"stems": {}}``.
    Callers should trigger separation first via ``POST /api/audio/separate-file``.
    """
    stem_dir = _find_stem_dir(filename)
    if stem_dir is None or not stem_dir.exists():
        return {"stems": {}, "separated": False}

    stem_names = ["vocals", "drums", "bass", "other"]
    stems_data: dict[str, Any] = {}
    for name in stem_names:
        wav_path = stem_dir / f"{name}.wav"
        if not wav_path.exists():
            continue
        try:
            features = await asyncio.to_thread(
                source_separator.analyze_stem_features, str(wav_path)
            )
            energy_envelope = features.get("energy_envelope", [])
            stems_data[name] = {
                "file": str(wav_path),
                "url": f"/api/audio/stem-file/{stem_dir.name}/{name}",
                "duration": features.get("duration", 0.0),
                "sample_rate": features.get("sample_rate", 22050),
                "rms_mean": features.get("rms_mean", 0.0),
                "rms_std": features.get("rms_std", 0.0),
                "centroid_mean": features.get("centroid_mean", 0.0),
                "zcr_mean": features.get("zcr_mean", 0.0),
                "energy_curve": _downsample_curve(energy_envelope, _STEM_CURVE_POINTS),
                "energy_curve_points": min(len(energy_envelope), _STEM_CURVE_POINTS),
            }
        except Exception as exc:
            logger.debug("Stem feature analysis failed for %s: %s", name, exc)

    return {"stems": stems_data, "separated": bool(stems_data)}


def _find_stem_dir(filename: str) -> Path | None:
    """Locate the Demucs output dir for a library file.

    Mirrors the logic in ``api/audio.py::_find_stem_dir`` so the visualizer
    service can resolve stems without importing the API module.
    """
    from ..api.audio import _find_stem_dir as _api_find_stem_dir
    return _api_find_stem_dir(filename)
