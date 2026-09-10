"""FFmpeg render engine — always-available fallback.

Mirrors the filter-graph patterns proven in `tools/demos/compose_mv.py` and the
music video handler: color sources, image sequences (image2 demuxer), stills,
and optional audio muxing. Color is rendered at 24 fps using the `color`
source so the output duration is exact.
"""

from __future__ import annotations

import asyncio
import shutil
import time
from pathlib import Path

from .base import RenderResult, RenderSpec, VideoRenderer


class FFmpegRenderer(VideoRenderer):
    engine_id = "ffmpeg"
    label = "FFmpeg 8.1"

    def is_available(self) -> bool:
        return shutil.which("ffmpeg") is not None

    def availability_detail(self) -> str:
        p = shutil.which("ffmpeg")
        return f"ffmpeg on PATH: {p}" if p else "ffmpeg not found on PATH"

    async def render(self, spec: RenderSpec) -> RenderResult:
        spec.validate()
        out = self._output(spec)
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            return RenderResult(
                engine=self.engine_id,
                output_path=str(out),
                render_s=0.0,
                size_bytes=0,
                success=False,
                error="ffmpeg not found on PATH",
            )

        cmd = self._build_cmd(spec, ffmpeg, out)
        t0 = time.perf_counter()
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await asyncio.wait_for(proc.communicate(), timeout=600)
        except asyncio.TimeoutError:
            proc.kill()  # type: ignore[union-attr]
            return RenderResult(
                engine=self.engine_id,
                output_path=str(out),
                render_s=time.perf_counter() - t0,
                size_bytes=0,
                success=False,
                error="FFmpeg render timed out (600s)",
            )
        except Exception as exc:
            return RenderResult(
                engine=self.engine_id,
                output_path=str(out),
                render_s=time.perf_counter() - t0,
                size_bytes=0,
                success=False,
                error=str(exc),
            )

        ok = proc.returncode == 0 and out.exists() and out.stat().st_size > 0
        return RenderResult(
            engine=self.engine_id,
            output_path=str(out),
            render_s=round(time.perf_counter() - t0, 3),
            size_bytes=out.stat().st_size if out.exists() else 0,
            success=ok,
            error=None if ok else (stderr or b"").decode(errors="replace")[-800:] or f"ffmpeg exited {proc.returncode}",
            notes="filter-graph",
        )

    def _build_cmd(self, spec: RenderSpec, ffmpeg: str, out: Path) -> list[str]:
        has_audio = bool(spec.audio_path) and Path(spec.audio_path).exists()
        # Base video source per kind
        if spec.kind == "color":
            r, g, b = self._hex_to_rgb(spec.color)
            video = ["-f", "lavfi", "-i", f"color=c=0x{r:02x}{g:02x}{b:02x}:s={spec.width}x{spec.height}:r={spec.fps}:d={spec.duration}"]
        elif spec.kind == "frames":
            pattern = str(Path(spec.frames_dir) / spec.frame_pattern)
            video = ["-f", "image2", "-framerate", str(spec.fps), "-i", pattern]
        elif spec.kind == "image":
            video = ["-loop", "1", "-t", str(spec.duration), "-i", str(Path(spec.image_path))]
        else:
            raise ValueError(f"Unsupported render kind for FFmpeg: {spec.kind}")

        cmd = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error", *video]
        if has_audio:
            cmd += ["-i", str(Path(spec.audio_path))]  # type: ignore[arg-type]

        venc = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", str(spec.fps)]
        if has_audio:
            cmd += ["-map", "0:v:0", "-map", "1:a:0", "-c:a", "aac", "-shortest", *venc]
        else:
            cmd += [*venc]
        cmd += [str(out)]
        return cmd


# Class-style wrapper for the registry (mirrors other engines' interface)
class FFmpegRendererCompat(FFmpegRenderer):
    """Alias kept for registry symmetry — FFmpegRenderer implements the protocol directly."""