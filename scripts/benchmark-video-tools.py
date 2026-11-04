"""Benchmark video rendering backends on a representative composite.

Compares:
- MoviePy (current baseline)
- core-flux (3–6× faster MoviePy-compatible)
- MovieLite (Numba-optimized MoviePy alternative)

Outputs results to docs/knowledge-library/benchmarks/video-bench-<timestamp>.md
"""

from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path

OUTPUT_DIR = Path(__file__).parent.parent / "docs" / "knowledge-library" / "benchmarks"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


@dataclass
class VideoResult:
    name: str
    render_s: float
    output_size_mb: float
    notes: str = ""


def render_moviepy(output_path: str) -> VideoResult:
    try:
        from moviepy.editor import ColorClip, CompositeVideoClip  # type: ignore
    except ImportError:
        return VideoResult(name="MoviePy", render_s=0.0, output_size_mb=0.0, notes="NOT INSTALLED")

    t0 = time.perf_counter()
    clip = ColorClip(size=(1280, 720), color=(255, 0, 0), duration=5)
    clip = CompositeVideoClip([clip])
    clip.write_videofile(output_path, fps=24, verbose=False, logger=None)
    wall = time.perf_counter() - t0
    size = Path(output_path).stat().st_size / (1024 * 1024)
    return VideoResult(name="MoviePy", render_s=round(wall, 3), output_size_mb=round(size, 2), notes="baseline")


def render_coreflux(output_path: str) -> VideoResult:
    try:
        import core_flux  # type: ignore
    except ImportError:
        return VideoResult(name="core-flux", render_s=0.0, output_size_mb=0.0, notes="NOT INSTALLED")

    t0 = time.perf_counter()
    layer = core_flux.ColorLayer(width=1280, height=720, duration=5, color="#00ff00", fps=24)
    composition = core_flux.Composition()
    composition.add_layer(layer)
    composition.render(output_path, quiet=True, verbose=False)
    wall = time.perf_counter() - t0
    size = Path(output_path).stat().st_size / (1024 * 1024)
    return VideoResult(name="core-flux", render_s=round(wall, 3), output_size_mb=round(size, 2), notes="3–6× target")


def render_movielite(output_path: str) -> VideoResult:
    try:
        import movielite  # type: ignore
    except ImportError:
        return VideoResult(name="MovieLite", render_s=0.0, output_size_mb=0.0, notes="NOT INSTALLED")

    t0 = time.perf_counter()
    clip = movielite.ImageClip.from_color(color=(0, 0, 255), size=(1280, 720), duration=5)
    writer = movielite.VideoWriter(output_path, fps=24, size=(1280, 720), duration=5)
    writer.add_clip(clip)
    writer.write(processes=1, video_quality=movielite.enums.VideoQuality.MIDDLE)
    wall = time.perf_counter() - t0
    size = Path(output_path).stat().st_size / (1024 * 1024)
    return VideoResult(name="MovieLite", render_s=round(wall, 3), output_size_mb=round(size, 2), notes="Numba JIT")


def main() -> None:
    out_dir = Path("output/benchmarks")
    out_dir.mkdir(parents=True, exist_ok=True)

    results: list[dict] = []
    for engine in (render_moviepy, render_coreflux, render_movielite):
        out_path = str(out_dir / f"bench_{engine.__name__}.mp4")
        try:
            r = engine(out_path)
            print(f"  {r.name}: {r.render_s}s | {r.output_size_mb} MB | {r.notes}")
            results.append(asdict(r))
        except Exception as e:
            print(f"  {engine.__name__}: ERROR {e}")

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    out = OUTPUT_DIR / f"video-bench-{ts}.json"
    out.write_text(json.dumps(results, indent=2))
    print(f"\nWrote {out}")


if __name__ == "__main__":
    main()
