"""MovieLite render engine — Numba-JIT MoviePy alternative.

APIs verified against scripts/benchmark_video_tools.py::render_movielite
(movielite.ImageClip.from_color / VideoWriter) which produced
docs/knowledge-library/benchmarks/video-bench-20260906_194948.json.
"""

from __future__ import annotations

import asyncio
import time
from pathlib import Path

from .base import RenderResult, RenderSpec, VideoRenderer


class MovieLiteRenderer(VideoRenderer):
    engine_id = "movielite"
    label = "MovieLite"

    def __init__(self) -> None:
        self._mod = None

    def _load(self):
        if self._mod is None:
            import movielite  # type: ignore

            self._mod = movielite
        return self._mod

    def is_available(self) -> bool:
        try:
            self._load()
            return True
        except Exception:
            return False

    def availability_detail(self) -> str:
        try:
            self._load()
            return "movielite importable in studio env"
        except Exception as exc:
            return f"movielite import failed: {exc}"

    async def render(self, spec: RenderSpec) -> RenderResult:
        spec.validate()
        out = self._output(spec)
        t0 = time.perf_counter()
        try:
            result = await asyncio.to_thread(self._render_sync, spec, out)
        except Exception as exc:
            return RenderResult(
                engine=self.engine_id,
                output_path=str(out),
                render_s=round(time.perf_counter() - t0, 3),
                size_bytes=0,
                success=False,
                error=str(exc),
            )
        ok = out.exists() and out.stat().st_size > 0
        return RenderResult(
            engine=self.engine_id,
            output_path=str(out),
            render_s=round(time.perf_counter() - t0, 3),
            size_bytes=out.stat().st_size if out.exists() else 0,
            success=ok,
            error=None if ok else "MovieLite produced no output",
            notes="Numba JIT",
        )

    def _render_sync(self, spec: RenderSpec, out: Path):
        import movielite  # type: ignore
        from movielite import enums  # type: ignore

        writer = movielite.VideoWriter(
            str(out),
            fps=spec.fps,
            size=(spec.width, spec.height),
            duration=spec.duration,
        )
        try:
            if spec.kind == "color":
                r, g, b = self._hex_to_rgb(spec.color)
                clip = movielite.ImageClip.from_color(
                    color=(r, g, b),
                    size=(spec.width, spec.height),
                    duration=spec.duration,
                )
                writer.add_clip(clip)
            elif spec.kind == "image":
                clip = movielite.ImageClip(  # type: ignore[attr-defined]
                    spec.image_path,
                    duration=spec.duration,
                )
                writer.add_clip(clip)
            elif spec.kind == "frames":
                seq = movielite.ImageSequenceClip(  # type: ignore[attr-defined]
                    spec.frames_dir,
                    fps=spec.fps,
                )
                writer.add_clip(seq)
            else:
                raise ValueError(f"Unsupported render kind for MovieLite: {spec.kind}")
            writer.write(
                processes=1,
                video_quality=getattr(enums.VideoQuality, "MIDDLE", None) or enums.VideoQuality.MIDDLE,
            )
        finally:
            close = getattr(writer, "close", None)
            if callable(close):
                try:
                    close()
                except Exception:
                    pass