"""MoviePy render engine — legacy baseline.

MoviePy is NOT installed in the studio env (nma-studio-cuda); the engine exists
so the abstraction is complete per stack-extensions-2026.md and so the API
responds with a clear availability message instead of a crash if selected.
"""

from __future__ import annotations

import asyncio
import time
from pathlib import Path

from .base import RenderResult, RenderSpec, VideoRenderer


class MoviePyRenderer(VideoRenderer):
    engine_id = "moviepy"
    label = "MoviePy"

    def __init__(self) -> None:
        self._mod = None

    def _load(self):
        if self._mod is None:
            from moviepy.editor import ColorClip, CompositeVideoClip  # type: ignore

            self._mod = {"ColorClip": ColorClip, "CompositeVideoClip": CompositeVideoClip}
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
            return "moviepy importable"
        except Exception:
            return "moviepy not installed (pip install moviepy) — not part of the studio env"

    async def render(self, spec: RenderSpec) -> RenderResult:
        spec.validate()
        out = self._output(spec)
        t0 = time.perf_counter()
        try:
            await asyncio.to_thread(self._render_sync, spec, out)
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
            error=None if ok else "MoviePy produced no output",
            notes="legacy baseline",
        )

    def _render_sync(self, spec: RenderSpec, out: Path):
        mods = self._load()
        if spec.kind == "color":
            r, g, b = self._hex_to_rgb(spec.color)
            clip = mods["ColorClip"](size=(spec.width, spec.height), color=(r, g, b), duration=spec.duration)
            clip = mods["CompositeVideoClip"]([clip])
            clip.write_videofile(str(out), fps=spec.fps, verbose=False, logger=None)
        else:
            raise ValueError(f"Unsupported render kind for MoviePy: {spec.kind}")