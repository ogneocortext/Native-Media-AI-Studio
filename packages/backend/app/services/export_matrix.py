"""Export Matrix service — multi-format publishing exports from one master video.

Implements the documented-but-missing "Export Matrix" step from:
  - ai-video-trends-2026.md Trend 5 (Multi-Modal Integrated Workflows):
      "Add `Export Matrix` step: single Remotion composition → `StillIRise` (16:9)
       + `StillIRiseVertical` (9:16) + 3s loop + thumbnail still"
  - ai-video-trends-2026.md §5 P1: "Integrated export matrix: MV + thumbnails
    (3 variants A/B) + timestamps + SEO"
  - 2d-visualization-2026.md §7 ImgTool specs: TikTok/Reels 1080x1920,
    Spotify Canvas 3-8s seamless loop (beat-boundary start).

All derivation is FFmpeg-based (FFmpeg 8.1 on PATH; mirrors the thumbnail
extraction pattern in app/api/outputs.py).
"""

from __future__ import annotations

import asyncio
import json
import logging
import shutil
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path

from ..core.config import PROJECT_ROOT, config
from ..services.go_worker_client import write_sidecar as go_write_sidecar

logger = logging.getLogger(__name__)

OUTPUT_BASE = Path(config.output_dir)
VIDEO_DIR = OUTPUT_BASE / "video"
IMAGE_DIR = OUTPUT_BASE / "images"


@dataclass
class MatrixArtifact:
    """One derived artifact of the export matrix."""

    kind: str  # "vertical" | "loop" | "thumbnail"
    path: str  # absolute path
    relative_path: str  # relative to output base (for /output URLs + Media Library)
    width: int
    height: int
    duration: float
    notes: str = ""


@dataclass
class MatrixResult:
    """Aggregated result of one export-matrix run."""

    source: str
    artifacts: list[MatrixArtifact] = field(default_factory=list)
    errors: list[dict] = field(default_factory=list)
    render_s: float = 0.0
    manifest_path: str | None = None


def _run_ffmpeg(args: list[str], timeout: int = 600) -> tuple[bool, str]:
    """Run FFmpeg in a worker thread, returning (ok, error_detail)."""
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return False, "ffmpeg not found on PATH"
    cmd = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error", *args]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        ok = proc.returncode == 0
        return ok, "" if ok else (proc.stderr or "").strip()[-800:]
    except subprocess.TimeoutExpired:
        return False, f"FFmpeg timed out after {timeout}s"
    except Exception as exc:
        return False, str(exc)


async def probe_duration(video_path: Path) -> float | None:
    """Media duration in seconds via ffprobe; None when unavailable."""
    ffprobe = shutil.which("ffprobe")
    if not ffprobe or not video_path.exists():
        return None

    def _probe() -> float | None:
        try:
            proc = subprocess.run(
                [
                    ffprobe, "-v", "error",
                    "-show_entries", "format=duration",
                    "-of", "default=noprint_wrappers=1:nokey=1",
                    str(video_path),
                ],
                capture_output=True, text=True, timeout=30,
            )
            return float(proc.stdout.strip())
        except Exception:
            return None

    return await asyncio.to_thread(_probe)


def _beat_aligned_start(
    total: float,
    loop_seconds: float,
    beat_times: list[float] | None,
    sections: list[dict] | None,
) -> tuple[float, str]:
    """Pick a loop start on a strong boundary.

    Preference order (youtube-optimization "First 3 Seconds Rule" — front-load
    energy, never the slow intro):
      1. Highest-energy section start
      2. Beat nearest 25% of the track
      3. Fallback 0.0
    """
    latest_start = max(0.0, total - loop_seconds)
    if sections:
        try:
            best = max(sections, key=lambda s: float(s.get("energy", 0) or 0))
            start = float(best.get("start", 0) or 0)
            if 0 <= start <= latest_start:
                return start, f"highest-energy section '{best.get('type', '?')}'"
        except (TypeError, ValueError):
            pass
    if beat_times:
        target = total * 0.25
        candidates = [b for b in beat_times if 0 <= b <= latest_start]
        if candidates:
            start = min(candidates, key=lambda b: abs(b - target))
            return start, "beat nearest 25% mark"
    return 0.0, "start at 0 (no beat data)"


def _relative(path: Path) -> str:
    """Relative path against output base (falls back to absolute string)."""
    try:
        return path.relative_to(OUTPUT_BASE).as_posix()
    except ValueError:
        return str(path)


async def _derive_vertical(src: Path, dst: Path, total: float) -> MatrixArtifact:
    """Center-crop 16:9 → 9:16 vertical master (TikTok/Reels/Shorts 1080x1920).

    Per ai-video-trends Trend 3: derive the vertical from the horizontal
    master's center safe zone rather than stretching.
    """
    dst.parent.mkdir(parents=True, exist_ok=True)
    # Keep full height, take a 9/16-of-height-wide center band, scale to 1080x1920.
    vf = "crop=ih*9/16:ih,scale=1080:1920:flags=lanczos"
    args = [
        "-i", str(src),
        "-vf", vf,
        "-c:v", "libx264", "-crf", "18", "-preset", "veryfast",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        "-c:a", "aac", "-b:a", "192k",
        str(dst),
    ]
    ok, err = await asyncio.to_thread(_run_ffmpeg, args)
    if not ok:
        raise RuntimeError(f"vertical derivation failed: {err}")
    dur = await probe_duration(dst) or total
    return MatrixArtifact("vertical", str(dst), _relative(dst), 1080, 1920, round(dur, 3),
                          notes="center 9:16 crop of master, lanczos")


async def _derive_loop(src: Path, dst: Path, loop_seconds: float, start: float, start_note: str) -> MatrixArtifact:
    """Spotify-Canvas-style 3-8s loop, video-only, H.264 yuv420p.

    Loop start lands on a beat/section boundary (see _beat_aligned_start);
    ComfyUI closed-loop generation remains the gold standard for perfect loops.
    """
    dst.parent.mkdir(parents=True, exist_ok=True)
    args = [
        "-ss", f"{start:.3f}",
        "-t", f"{loop_seconds:.3f}",
        "-i", str(src),
        "-an",  # Canvas loops are video-only per ImgTool 2026 spec
        "-c:v", "libx264", "-crf", "20", "-preset", "veryfast",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        "-r", "30",
        str(dst),
    ]
    ok, err = await asyncio.to_thread(_run_ffmpeg, args)
    if not ok:
        raise RuntimeError(f"loop derivation failed: {err}")
    dur = await probe_duration(dst) or loop_seconds
    return MatrixArtifact("loop", str(dst), _relative(dst), 0, 0, round(dur, 3),
                          notes=f"{loop_seconds:.1f}s loop, {start_note}")

async def _derive_thumbnail(src: Path, dst: Path, at_second: float, variant: str) -> MatrixArtifact:
    """1280x720 JPG thumbnail variant (A/B/C) for YouTube CTR testing."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    args = [
        "-ss", f"{max(0.0, at_second):.3f}",
        "-i", str(src),
        "-frames:v", "1",
        "-vf", "scale=1280:720:flags=lanczos",
        "-q:v", "2",
        str(dst),
    ]
    ok, err = await asyncio.to_thread(_run_ffmpeg, args)
    if not ok:
        raise RuntimeError(f"thumbnail '{variant}' failed: {err}")
    return MatrixArtifact("thumbnail", str(dst), _relative(dst), 1280, 720, 0.0,
                          notes=f"variant {variant} @ {at_second:.1f}s")




async def build_export_matrix(
    video_path: str | Path,
    beat_times: list[float] | None = None,
    sections: list[dict] | None = None,
    loop_seconds: float = 4.0,
) -> MatrixResult:
    """Build the full export matrix for one master video.

    Produces:
      output/video/{stem}_vertical.mp4      1080x1920 vertical master
      output/video/{stem}_loop.mp4          3-8s Canvas loop (beat-aligned start)
      output/images/{stem}_thumb_A/B/C.jpg  3 thumbnail variants @ 10/50/85%
    plus a manifest sidecar `{stem}_vertical.mp4.json` describing the matrix.
    """
    t0 = time.perf_counter()
    src = Path(video_path)
    if not src.is_absolute():
        # Media Library sends output-relative paths ("video/foo.mp4"), so try
        # both the output base and the project root.
        cands = [OUTPUT_BASE / src, PROJECT_ROOT / src]
        src = next((c for c in cands if c.exists()), PROJECT_ROOT / src)
    src = src.resolve()
    if not src.exists() or not src.is_file():
        raise FileNotFoundError(f"Source video not found: {src}")
    if src.suffix.lower() not in {".mp4", ".webm", ".mov", ".mkv"}:
        raise ValueError(f"Not a video file: {src.name}")
    if not (2.0 <= loop_seconds <= 8.0):
        raise ValueError("loop_seconds must be within Spotify Canvas 3-8s range")

    total = await probe_duration(src) or 0.0
    stem = src.stem
    result = MatrixResult(source=str(src))

    # 1) Vertical master (16:9 → 9:16 center crop)
    try:
        vertical = await _derive_vertical(src, VIDEO_DIR / f"{stem}_vertical.mp4", total)
        result.artifacts.append(vertical)
    except Exception as exc:
        logger.warning("Export matrix vertical failed for %s: %s", stem, exc)
        result.errors.append({"kind": "vertical", "error": str(exc)})

    # 2) Canvas loop (beat-aligned start)
    try:
        start, start_note = _beat_aligned_start(total, loop_seconds, beat_times, sections)
        loop = await _derive_loop(src, VIDEO_DIR / f"{stem}_loop.mp4", loop_seconds, start, start_note)
        result.artifacts.append(loop)
    except Exception as exc:
        logger.warning("Export matrix loop failed for %s: %s", stem, exc)
        result.errors.append({"kind": "loop", "error": str(exc)})

    # 3) Thumbnail variants A/B/C at 10% / 50% / 85%
    for variant, frac in (("A", 0.10), ("B", 0.50), ("C", 0.85)):
        try:
            at = min(total * frac, max(0.0, total - 0.2)) if total else 0.0
            thumb = await _derive_thumbnail(src, IMAGE_DIR / f"{stem}_thumb_{variant}.jpg", at, variant)
            result.artifacts.append(thumb)
        except Exception as exc:
            logger.warning("Export matrix thumbnail %s failed for %s: %s", variant, stem, exc)
            result.errors.append({"kind": f"thumbnail_{variant}", "error": str(exc)})

    # 4) Manifest sidecar on the vertical master
    manifest_target = next((a for a in result.artifacts if a.kind == "vertical"), None)
    if manifest_target:
        manifest_data = {
            "export_matrix": "1.0",
            "source": result.source,
            "source_duration_s": total,
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "loop_seconds": loop_seconds,
            "artifacts": [a.__dict__ | {} for a in result.artifacts],
            "errors": result.errors,
            "render_s": result.render_s,
        }
        mpath = Path(manifest_target.path).with_suffix(".mp4.json")
        try:
            worker_result = await go_write_sidecar(stem, manifest_data, filename=mpath.stem)
            if worker_result is None or not worker_result.get("written"):
                mpath.write_text(json.dumps(manifest_data, indent=2, ensure_ascii=False), encoding="utf-8")
            result.manifest_path = str(mpath)
        except OSError as exc:
            logger.warning("Manifest write failed: %s", exc)

    result.render_s = round(time.perf_counter() - t0, 3)
    return result