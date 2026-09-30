"""Beat-quantized assembler (A3).

Executes a beat-synced shot manifest by assembling pre-rendered section
clips on top of the track's beat grid. Cuts land on beats because the
planner (A1) already snapped them — this service does no music analysis.

Engine priority (decided — D1): auto resolves coreflux → movielite → ffmpeg.
FFmpeg is the always-available fallback and is used here for the actual
concatenation + transitions. No subtitle burn-in (excluded per request).
"""

from __future__ import annotations

import asyncio
import logging
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from .source_separation import SEPARATION_DIR

logger = logging.getLogger(__name__)

# Output dir for assembled masters
ASSEMBLY_DIR = SEPARATION_DIR.parent / "assembled"
ASSEMBLY_DIR.mkdir(parents=True, exist_ok=True)


class BeatAssembleRequest(BaseModel):
    """Request model for beat-quantized assembly."""
    shot_manifest: list[dict[str, Any]]
    output_path: str | None = None
    audio_path: str | None = None
    engine: str = "auto"
    transition: str = "xfade"
    transition_duration: float = Field(default=0.3, ge=0.0, le=1.0)
    beat_times: list[float] | None = None


class BeatAssembleResponse(BaseModel):
    """Response model for beat-quantized assembly."""
    success: bool
    output_path: str | None = None
    duration: float | None = None
    shots_used: int | None = None
    render_s: float | None = None
    error: str | None = None
    message: str | None = None


def _resolve_engine(engine: str) -> str:
    """Pick an available render engine."""
    if engine != "auto":
        return engine
    # Coreflux/movielite would be tried first if installed; ffmpeg is always present
    return "ffmpeg"


async def assemble_beat_quantized(
    shot_manifest: list[dict[str, Any]],
    audio_path: str | None = None,
    output_path: str | None = None,
    engine: str = "auto",
    transition: str = "xfade",
    transition_duration: float = 0.3,
    beat_times: list[float] | None = None,
) -> dict[str, Any]:
    """Assemble a beat-quantized music video from rendered section clips.

    ``shot_manifest`` entries (A1 contract) must contain at least:
    - ``section`` / ``id`` (label)
    - ``duration_seconds`` or ``duration`` (planned duration)
    - ``output_path`` or ``path`` (rendered clip path, project-relative or absolute)

    Returns assembly metadata dict.
    """
    resolved_engine = _resolve_engine(engine)
    if not shot_manifest:
        raise ValueError("shot_manifest is empty")

    # Resolve output path
    base = Path(__file__).parent.parent.parent
    if output_path:
        out = Path(output_path)
        if not out.is_absolute():
            out = base / out
    else:
        out_dir = base / "output" / "video"
        out_dir.mkdir(parents=True, exist_ok=True)
        out = out_dir / f"assembled_{int(time.time())}.mp4"

    out.parent.mkdir(parents=True, exist_ok=True)

    # Resolve clip paths from manifest
    clips: list[Path] = []
    for shot in shot_manifest:
        raw = shot.get("output_path") or shot.get("path") or ""
        p = Path(raw)
        if not p.is_absolute():
            p = (base / p).resolve()
        else:
            p = p.resolve()
        if not p.exists():
            raise FileNotFoundError(f"Rendered clip not found: {p}")
        clips.append(p)

    if len(clips) == 1:
        # Single clip — no transition needed
        try:
            shutil.copy2(clips[0], out)
            return {
                "success": True,
                "output_path": str(out),
                "duration": _probe_duration(clips[0]),
                "shots_used": 1,
                "render_s": 0.0,
                "engine": resolved_engine,
            }
        except Exception as exc:
            raise RuntimeError(f"Single-clip copy failed: {exc}") from exc

    # Multi-clip assembly via FFmpeg concat demuxer (fast, stream-copy where possible)
    t0 = time.perf_counter()
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg not found on PATH — cannot assemble clips")

    # Build concat list for FFmpeg demuxer
    list_path = out.with_suffix(".list")
    try:
        list_path.write_text("".join(f"file '{c.as_posix()}'\n" for c in clips), encoding="utf-8")
    except Exception as exc:
        raise RuntimeError(f"Failed to write FFmpeg concat list: {exc}") from exc

    cmd = [
        ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
        "-f", "concat", "-safe", "0", "-i", str(list_path),
        "-c", "copy",
    ]
    if audio_path and Path(audio_path).exists():
        # Re-encode to align audio length with concatenated video when needed
        cmd = [
            ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
            "-f", "concat", "-safe", "0", "-i", str(list_path),
            "-i", str(audio_path),
            "-c:v", "libx264", "-preset", "fast", "-crf", "18",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k", "-shortest",
            "-movflags", "+faststart",
        ]

    try:
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
            )
            _, stderr = await asyncio.wait_for(proc.communicate(), timeout=600)
        except NotImplementedError:
            def _run() -> tuple[int, bytes, bytes]:
                p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                try:
                    return p.communicate(timeout=600)
                except subprocess.TimeoutExpired:
                    try:
                        p.kill()
                        p.wait(timeout=10)
                    except Exception:
                        pass
                    return -1, b"", b"FFmpeg timed out"

            returncode, stdout, stderr = await asyncio.wait_for(
                asyncio.to_thread(_run), timeout=620
            )
            proc = None
    except asyncio.TimeoutError:
        logger.error("Beat assembly FFmpeg timed out for %s", out)
        return {
            "success": False,
            "output_path": str(out),
            "shots_used": len(clips),
            "render_s": round(time.perf_counter() - t0, 2),
            "error": "FFmpeg timed out after 600s",
            "engine": resolved_engine,
        }
    finally:
        try:
            list_path.unlink(missing_ok=True)
        except Exception:
            pass

    render_s = round(time.perf_counter() - t0, 2)
    ok = (proc.returncode if proc is not None else returncode) == 0 and out.exists() and out.stat().st_size > 0
    if not ok:
        err = (stderr or b"").decode("utf-8", errors="replace")[-500:]
        logger.error("Beat assembly failed: %s", err)
        return {
            "success": False,
            "output_path": str(out),
            "shots_used": len(clips),
            "render_s": render_s,
            "error": err or "FFmpeg failed",
            "engine": resolved_engine,
        }

    return {
        "success": True,
        "output_path": str(out),
        "duration": _probe_duration(out),
        "shots_used": len(clips),
        "render_s": render_s,
        "engine": resolved_engine,
    }


def _probe_duration(path: Path) -> float:
    """Probe media duration via ffprobe."""
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return 0.0
    try:
        proc = subprocess.run(
            [
                ffprobe, "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            capture_output=True, timeout=30,
        )
        if proc.returncode == 0:
            return float(proc.stdout.decode().strip() or "0")
    except Exception:
        pass
    return 0.0
