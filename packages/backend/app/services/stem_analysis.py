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

from . import source_separation
from .source_separation import source_separator
from .stem_curves import downsample_curve

logger = logging.getLogger(__name__)

# Target number of energy-curve samples for visualization (matches
# the master `energy_curve` resolution in audio analysis).
_STEM_CURVE_POINTS = 80


def _stem_features_cached(stem_path: str, name: str) -> dict[str, Any]:
    """analyze_stem_features with a per-stem disk cache.

    Feature extraction is librosa work over the whole stem file and used to
    re-run on EVERY stems-analysis request — every page load, every mixer
    open. The cache lives beside the stems (`.viz-feature-cache/<name>.json`)
    and is fingerprinted by mtime+size so a re-separated stem invalidates
    automatically. Error results are never cached (they may be transient).
    """
    wav = Path(stem_path)
    cache_file = wav.parent / ".viz-feature-cache" / f"{name}.json"
    fingerprint: dict[str, Any] | None = None
    try:
        st = wav.stat()
        fingerprint = {"mtime_ns": st.st_mtime_ns, "size": st.st_size}
        if cache_file.exists():
            doc = json.loads(cache_file.read_text(encoding="utf-8"))
            if doc.get("fingerprint") == fingerprint:
                return doc["features"]
    except (OSError, ValueError):
        pass

    features = source_separator.analyze_stem_features(stem_path)
    if fingerprint is not None and "error" not in features:
        try:
            cache_file.parent.mkdir(parents=True, exist_ok=True)
            cache_file.write_text(
                json.dumps({"fingerprint": fingerprint, "features": features}),
                encoding="utf-8",
            )
        except OSError:
            pass  # cache is best-effort
    return features


async def analyze_stems_for_visualization(filename: str) -> dict[str, Any]:
    """Return per-stem visualization data for an audio file.

    If stems have not been separated yet, returns ``{"stems": {}}``.
    Callers should trigger separation first via ``POST /api/audio/separate-file``.
    """
    stem_dir = _find_stem_dir(filename)
    if stem_dir is None or not stem_dir.exists():
        return {"stems": {}, "separated": False}

    stem_names = source_separation.STEM_NAMES
    # Feature extraction per stem is independent — run them concurrently
    # instead of four sequential librosa passes blocking each other.
    tasks = {
        name: asyncio.to_thread(_stem_features_cached, str(stem_dir / f"{name}.wav"), name)
        for name in stem_names
        if (stem_dir / f"{name}.wav").exists()
    }
    results = (
        await asyncio.gather(*tasks.values(), return_exceptions=True) if tasks else []
    )
    stems_data: dict[str, Any] = {}
    for name, features in zip(tasks, results, strict=True):
        if isinstance(features, BaseException):
            logger.debug("Stem feature analysis failed for %s: %s", name, features)
            continue
        try:
            energy_envelope = features.get("energy_envelope", [])
            stems_data[name] = {
                "file": str(stem_dir / f"{name}.wav"),
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
    """Backwards-compatible alias for :func:`source_separation.find_stem_dir`.

    This service used to define the lookup itself and then import the API
    module's copy - backwards layering, and an ImportError -> HTTP 500 when the
    stem routes moved to their own module. The implementation now lives with
    SEPARATION_DIR in source_separation; this alias keeps the local name so
    existing call sites in this file stay readable.
    """
    return source_separation.find_stem_dir(filename)


# Re-exported: this used to be defined here, duplicated from stem_analysis.
# One implementation now lives in stem_curves, so a fix reaches both callers.
_downsample_curve = downsample_curve
