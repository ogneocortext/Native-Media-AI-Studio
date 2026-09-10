"""Shared FFmpeg / FFprobe utilities used by new media API endpoints.

Covers:
- media probe (FFprobe JSON metadata)
- EBU R128 loudness (LUFS / integrated loudness)
- waveform extraction (astats -> downsampled peaks)
- timestamp-specific thumbnail extraction
"""

from __future__ import annotations

import asyncio
import json
import logging
import shutil
import struct
import subprocess
import math
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


async def _run(args: list[str], **kwargs: Any) -> subprocess.CompletedProcess:
    """Run a subprocess in a thread to avoid blocking the event loop."""
    return await asyncio.to_thread(subprocess.run, args, **kwargs)


def _find_binary(name: str) -> str | None:
    return shutil.which(name)


# =============================================================================
# Probe
# =============================================================================

async def probe_media(file_path: str | Path) -> dict[str, Any]:
    """Return FFprobe metadata for *file_path* as a JSON-serializable dict.

    Falls back to an empty dict when FFprobe is missing or the file cannot be
    read. Never raises.
    """
    ffprobe = _find_binary("ffprobe")
    if not ffprobe:
        return {}
    path = Path(file_path)
    if not path.exists() or not path.is_file():
        return {}

    try:
        proc = await _run(
            [
                ffprobe,
                "-hide_banner",
                "-loglevel",
                "error",
                "-print_format",
                "json",
                "-show_format",
                "-show_streams",
                str(path),
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if proc.returncode != 0:
            return {}
        data = json.loads(proc.stdout or "{}")
        # Keep payload small: prune ugly binary blobs from codec extradata.
        _sanitize_probe(data)
        return data
    except Exception as exc:
        logger.debug("probe_media failed for %s: %s", path, exc)
        return {}


def _sanitize_probe(data: dict[str, Any]) -> None:
    """Drop heavy binary fields from probe JSON in-place."""
    for stream in data.get("streams", []):
        for key in ("extradata", "extradata_url", "side_data_list"):
            if key in stream:
                stream[key] = None
    for fmt_key in ("tags",):
        fmt = data.get("format")
        if isinstance(fmt, dict) and fmt_key in fmt:
            tags = fmt[fmt_key]
            if isinstance(tags, dict):
                for drop in ("encoder", "encoding_time", "date", "creation_time"):
                    tags.pop(drop, None)


# =============================================================================
# Loudness (EBU R128)
# =============================================================================

async def compute_loudness(file_path: str | Path) -> dict[str, Any]:
    """Compute integrated loudness (LUFS) using FFmpeg's ebur128 filter.

    Returns a dict with:
      - integrated_lufs: float | None
      - loudness_range: float | None
      - true_peak: float | None
      - error: str | None

    Never raises.
    """
    ffmpeg = _find_binary("ffmpeg")
    if not ffmpeg:
        return {"error": "ffmpeg not found on PATH"}
    path = Path(file_path)
    if not path.exists() or not path.is_file():
        return {"error": "file not found"}

    try:
        proc = await _run(
            [
                ffmpeg,
                "-hide_banner",
                "-loglevel",
                "info",
                "-i",
                str(path),
                "-af",
                "ebur128=framelog=verbose",
                "-f",
                "null",
                "-",
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
        stderr = proc.stderr or ""
        return _parse_ebur128(stderr)
    except subprocess.TimeoutExpired:
        return {"error": "loudness analysis timed out (120s)"}
    except Exception as exc:
        logger.debug("compute_loudness failed for %s: %s", path, exc)
        return {"error": str(exc)}


_EBU_RE = {
    "integrated_lufs": r"Integrated loudness:\s*\n\s*I:\s*([+-]?\d+(?:\.\d+)?)\s*LUFS",
    "loudness_range": r"Loudness range:\s*\n\s*LRA:\s*([+-]?\d+(?:\.\d+)?)\s*LU",
    "true_peak": r"True peak:\s*([+-]?\d+(?:\.\d+)?)\s*dBFS",
}


def _parse_ebur128(text: str) -> dict[str, Any]:
    result: dict[str, Any] = {
        "integrated_lufs": None,
        "loudness_range": None,
        "true_peak": None,
        "error": None,
    }
    import re

    for key, pattern in _EBU_RE.items():
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            result[key] = float(m.group(1))
    if result["integrated_lufs"] is None and "Invalid argument" not in text:
        result["error"] = "could not parse ebur128 output"
    return result


# =============================================================================
# Waveform (raw PCM -> RMS bucketing)
# =============================================================================

async def extract_waveform(
    file_path: str | Path,
    max_points: int = 240,
) -> dict[str, Any]:
    """Return a downsampled amplitude envelope for visualization.

    Decodes audio to raw float32 PCM and computes RMS in Python, which is
    more reliable across formats than parsing ``astats`` log output.
    Never raises.
    """
    ffmpeg = _find_binary("ffmpeg")
    if not ffmpeg:
        return {"error": "ffmpeg not found on PATH", "peaks": []}
    path = Path(file_path)
    if not path.exists() or not path.is_file():
        return {"error": "file not found", "peaks": []}

    try:
        proc = await asyncio.to_thread(
            subprocess.run,
            [
                ffmpeg,
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(path),
                "-ac",
                "2",
                "-ar",
                "22050",
                "-f",
                "f32le",
                "-",
            ],
            capture_output=True,
            timeout=180,
        )
        if proc.returncode != 0:
            return {"error": "ffmpeg failed to decode audio", "peaks": []}

        raw = proc.stdout
        if not raw:
            return {"peaks": [], "count": 0}

        sample_size = 4  # float32 = 4 bytes
        channels = 2
        total_samples = len(raw) // (sample_size * channels)
        if total_samples == 0:
            return {"peaks": [], "count": 0}

        # Target chunk size so we get roughly max_points buckets.
        chunk = max(1, total_samples // max_points)
        peaks: list[float] = []

        # Process in chunks without unpacking the whole file at once.
        offset = 0
        while offset < len(raw) and len(peaks) < max_points:
            end = min(offset + chunk * sample_size * channels, len(raw))
            chunk_bytes = raw[offset:end]
            count = len(chunk_bytes) // (sample_size * channels)
            if count == 0:
                break
            samples = struct.unpack_from(f"{count * channels}f", chunk_bytes)
            # Use max amplitude per bucket for a more detailed envelope than RMS.
            peak = max(abs(s) for s in samples) if samples else 0.0
            peaks.append(peak)
            offset = end

        if not peaks:
            return {"peaks": [], "count": 0}

        # Normalize to -1..1 by the global peak.
        global_peak = max(peaks) or 1.0
        normalized = [max(-1.0, min(1.0, (p / global_peak) * 2 - 1)) for p in peaks]
        return {"peaks": normalized, "count": len(normalized)}
    except subprocess.TimeoutExpired:
        return {"error": "waveform analysis timed out (180s)", "peaks": []}
    except Exception as exc:
        logger.debug("extract_waveform failed for %s: %s", path, exc)
        return {"error": str(exc), "peaks": []}


def _parse_astats(text: str, max_points: int = 240) -> list[float]:
    """Best-effort RMS peak extraction from astats verbose log output."""
    import re

    vals: list[float] = []
    for m in re.finditer(r"RMS level dB:\s*([+-]?\d+(?:\.\d+)?)", text):
        vals.append(float(m.group(1)))
    if not vals:
        return []
    # Convert dB -> linear 0..1-ish normalized by max absolute value
    peak = max(abs(v) for v in vals) or 1.0
    linear = [max(0.0, min(1.0, (v + peak) / (2 * peak))) for v in vals]
    # Downsample to max_points with simple min/max bucketing to preserve shape.
    if len(linear) <= max_points:
        return linear
    bucket = max(1, math.floor(len(linear) / max_points))
    out: list[float] = []
    for i in range(0, len(linear), bucket):
        chunk = linear[i : i + bucket]
        out.append(max(chunk))
    return out[:max_points]


# =============================================================================
# Thumbnail at timestamp
# =============================================================================

async def extract_thumbnail_at_time(
    file_path: str | Path,
    time_sec: float = 1.0,
    width: int = 480,
    output_path: str | Path | None = None,
) -> str | None:
    """Extract a single frame at *time_sec* and write it to *output_path*.

    Returns the output path on success, or None when ffmpeg is missing / the
    extraction fails. The caller is responsible for cleaning up the file when
    it is a temporary artifact.
    """
    ffmpeg = _find_binary("ffmpeg")
    if not ffmpeg:
        return None
    path = Path(file_path)
    if not path.exists() or not path.is_file():
        return None

    if output_path is None:
        output_path = Path(config.output_dir) / "thumbnails" / f"{path.stem}_{time_sec:.2f}s.jpg"
    else:
        output_path = Path(output_path)

    output_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        proc = await _run(
            [
                ffmpeg,
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-ss",
                f"{max(0.0, float(time_sec)):.3f}",
                "-i",
                str(path),
                "-frames:v",
                "1",
                "-q:v",
                "3",
                "-vf",
                f"scale={width}:-2",
                str(output_path),
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if proc.returncode == 0 and output_path.exists() and output_path.stat().st_size > 1024:
            return str(output_path)
        if output_path.exists() and output_path.stat().st_size <= 1024:
            try:
                output_path.unlink(missing_ok=True)
            except Exception:
                pass
    except Exception as exc:
        logger.debug("extract_thumbnail_at_time failed for %s @ %ss: %s", path, time_sec, exc)
    return None


# =============================================================================
# Cover re-extraction (exposed as manual regeneration)
# =============================================================================

async def regenerate_cover(file_path: str | Path) -> str | None:
    """Force-re-extract embedded cover art, overwriting any existing sidecar.

    Returns the relative cover path, or None on failure.
    """
    from ..api.outputs import extract_audio_cover, PROJECT_ROOT

    path = Path(file_path)
    if not path.exists():
        return None
    # Remove existing sidecars so extract_audio_cover regenerates.
    for ext in (".jpg", ".jpeg", ".png", ".webp"):
        for cand in (path.with_suffix(ext), path.with_name(path.stem + ext)):
            if cand.exists():
                try:
                    cand.unlink(missing_ok=True)
                except Exception:
                    pass
    return await extract_audio_cover(path, Path(config.output_dir))


# Late import to avoid circulars at module load time.
from ..core.config import PROJECT_ROOT, config  # noqa: E402
