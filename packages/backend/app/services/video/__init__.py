"""
Video rendering engine abstraction.

Implements `stack-extensions-2026.md` § Phase 2 (Integration):
    "Video: Add `VideoRenderer` abstraction in `packages/backend/app/services/video/`
     with `MoviePyRenderer`, `CoreFluxRenderer`, `MovieLiteRenderer` implementations."

Engines are gated on import availability (Phase 1 benchmarks decided the winners:
core-flux and MovieLite are installed in the studio env; MoviePy is NOT).
The FFmpeg engine is always available as the safety fallback.

Usage:
    from ..services.video import get_renderer, RENDER_ENGINES

    renderer = get_renderer("coreflux")          # raises ValueError if unavailable
    result = await renderer.render(RenderSpec(kind="color", color="#00ff00",
                                             width=1280, height=720,
                                             duration=5.0, fps=24,
                                             output_path="output/video/x.mp4"))
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover
    from .base import VideoRenderer

logger = logging.getLogger(__name__)

from .base import RenderResult, RenderSpec  # noqa: E402

__all__ = [
    "RenderSpec",
    "RenderResult",
    "VideoRenderer",
    "RENDER_ENGINES",
    "available_engines",
    "get_renderer",
]


def _ffmpeg_renderer() -> "VideoRenderer":
    from .ffmpeg_renderer import FFmpegRenderer

    return FFmpegRenderer()


def _coreflux_renderer() -> "VideoRenderer":
    from .coreflux_renderer import CoreFluxRenderer

    return CoreFluxRenderer()


def _movielite_renderer() -> "VideoRenderer":
    from .movielite_renderer import MovieLiteRenderer

    return MovieLiteRenderer()


def _moviepy_renderer() -> "VideoRenderer":
    from .moviepy_renderer import MoviePyRenderer

    return MoviePyRenderer()


# id → (factory, label). Availability is checked lazily via factory().
RENDER_ENGINES: dict[str, dict] = {
    "ffmpeg": {
        "label": "FFmpeg 8.1",
        "factory": _ffmpeg_renderer,
        "notes": "Always available — filter-graph fallback, frame-accurate",
    },
    "coreflux": {
        "label": "core-flux",
        "factory": _coreflux_renderer,
        "notes": "MoviePy-compatible 3-6x target (Rust/Numba composite path)",
    },
    "movielite": {
        "label": "MovieLite",
        "factory": _movielite_renderer,
        "notes": "Numba-JIT MoviePy alternative",
    },
    "moviepy": {
        "label": "MoviePy",
        "factory": _moviepy_renderer,
        "notes": "Legacy baseline — not installed in the studio env",
    },
}


def available_engines() -> list[dict]:
    """List render engines with live availability (import probe per engine)."""
    out: list[dict] = []
    for engine_id, meta in RENDER_ENGINES.items():
        try:
            renderer = meta["factory"]()
            available = renderer.is_available()
            detail = renderer.availability_detail()
        except Exception as exc:  # pragma: no cover — defensive
            logger.debug("Engine probe failed for %s: %s", engine_id, exc)
            available, detail = False, f"probe error: {exc}"
        out.append(
            {
                "id": engine_id,
                "label": meta["label"],
                "notes": meta["notes"],
                "available": available,
                "detail": detail,
            }
        )
    return out


def get_renderer(engine: str = "auto") -> "VideoRenderer":
    """Resolve an engine id to a ready renderer.

    engine: "ffmpeg" | "coreflux" | "movielite" | "moviepy" | "auto"
        "auto" prefers core-flux, then MovieLite, then FFmpeg.
    Raises ValueError for unknown engines; unavailable engines raise RuntimeError
    with install guidance (callers map this to HTTP 400/503).
    """
    engine = (engine or "auto").strip().lower()

    if engine == "auto":
        for candidate in ("coreflux", "movielite", "ffmpeg"):
            renderer = RENDER_ENGINES[candidate]["factory"]()
            if renderer.is_available():
                return renderer
        raise RuntimeError("No video render engine available (tried coreflux, movielite, ffmpeg)")

    if engine not in RENDER_ENGINES:
        raise ValueError(
            f"Unknown render engine '{engine}'. Valid: {', '.join(RENDER_ENGINES)}, auto"
        )

    renderer = RENDER_ENGINES[engine]["factory"]()
    if not renderer.is_available():
        raise RuntimeError(
            f"Render engine '{engine}' is not available in this environment "
            f"({renderer.availability_detail()})"
        )
    return renderer


def validate_output_path(output_path: str | Path, project_root: Path) -> Path:
    """Ensure the render output lands inside the project (default output/video)."""
    p = Path(output_path)
    if not p.is_absolute():
        p = project_root / p
    resolved = p.resolve()
    if not str(resolved).startswith(str(project_root.resolve())):
        raise ValueError("output_path escapes project root")
    resolved.parent.mkdir(parents=True, exist_ok=True)
    return resolved