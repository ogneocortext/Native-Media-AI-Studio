"""core-flux render engine — MoviePy-compatible fast path (3–6× target).

APIs verified against scripts/benchmark_video_tools.py::render_coreflux
(core_flux.ColorLayer / Composition) which produced docs/knowledge-library/
benchmarks/video-bench-20260906_194948.json.
"""

from __future__ import annotations

import asyncio
import time
from pathlib import Path

from .base import RenderResult, RenderSpec, VideoRenderer


class CoreFluxRenderer(VideoRenderer):
    engine_id = "coreflux"
    label = "core-flux"

    def __init__(self) -> None:
        self._mod = None

    def _load(self):
        if self._mod is None:
            import core_flux  # type: ignore

            self._mod = core_flux
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
            return "core_flux importable in studio env"
        except Exception as exc:
            return f"core_flux import failed: {exc}"

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
            error=None if ok else "core-flux produced no output",
            notes="MoviePy-compatible composite path",
        )

    def _render_sync(self, spec: RenderSpec, out: Path):
        import core_flux  # type: ignore

        layers: list = []
        if spec.kind == "color":
            layers.append(
                core_flux.ColorLayer(
                    width=spec.width,
                    height=spec.height,
                    duration=spec.duration,
                    color=spec.color,
                    fps=spec.fps,
                )
            )
        elif spec.kind == "image":
            layers.append(
                core_flux.ImageLayer(  # type: ignore[attr-defined]
                    image_path=spec.image_path,
                    duration=spec.duration,
                    fps=spec.fps,
                )
            )
        elif spec.kind == "frames":
            layers.append(
                core_flux.ImageSequenceLayer(  # type: ignore[attr-defined]
                    directory=spec.frames_dir,
                    pattern=spec.frame_pattern,
                    duration=spec.duration,
                    fps=spec.fps,
                )
            )
        else:
            raise ValueError(f"Unsupported render kind for core-flux: {spec.kind}")

        composition = core_flux.Composition()
        for layer in layers:
            composition.add_layer(layer)
        composition.render(str(out), quiet=True, verbose=False)