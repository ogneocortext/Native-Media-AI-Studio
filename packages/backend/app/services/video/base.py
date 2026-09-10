"""Base contracts for the video render engine abstraction.

Every engine accepts the same `RenderSpec` and returns the same `RenderResult`,
so callers (queue handlers, API routes, benchmarks) stay engine-agnostic.

Spec kinds supported by all engines:
    kind="color"  — solid-color clip (matches scripts/benchmark_video_tools.py)
    kind="frames" — image sequence from a directory (frame_%04d.png style)
    kind="image"  — single still image held for `duration` seconds
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class RenderSpec:
    """Engine-agnostic description of a video render job."""

    kind: str = "color"  # "color" | "frames" | "image"
    width: int = 1280
    height: int = 720
    duration: float = 5.0
    fps: int = 24
    output_path: str = ""
    # kind="color": hex color like "#00ff00" or "#ff0044"
    color: str = "#000000"
    # kind="frames": directory containing numbered frames + optional pattern
    frames_dir: str = ""
    frame_pattern: str = "frame_%04d.png"
    # kind="image": path to a still image
    image_path: str = ""
    # Optional audio mux (path to audio file, added to the output container)
    audio_path: str | None = None
    # Free-form engine-specific extras (engines ignore unknown keys)
    extra: dict = field(default_factory=dict)

    def validate(self) -> None:
        if self.width <= 0 or self.height <= 0:
            raise ValueError("width/height must be positive")
        if self.duration <= 0:
            raise ValueError("duration must be positive")
        if not (1 <= self.fps <= 120):
            raise ValueError("fps must be 1-120")
        if not self.output_path:
            raise ValueError("output_path is required")
        if self.kind == "frames" and not self.frames_dir:
            raise ValueError("frames_dir is required for kind='frames'")
        if self.kind == "image" and not self.image_path:
            raise ValueError("image_path is required for kind='image'")


@dataclass
class RenderResult:
    """Normalized render result across engines."""

    engine: str
    output_path: str
    render_s: float
    size_bytes: int
    success: bool = True
    error: str | None = None
    notes: str = ""


class VideoRenderer(ABC):
    """Abstract base for all video render engines."""

    engine_id: str = "base"
    label: str = "Base"

    @abstractmethod
    def is_available(self) -> bool:
        """True when the engine can render in this environment."""

    @abstractmethod
    def availability_detail(self) -> str:
        """Human-readable availability detail (missing package, version, ...)."""

    @abstractmethod
    async def render(self, spec: RenderSpec) -> RenderResult:
        """Execute the render. Must not block the event loop."""

    def _output(self, spec: RenderSpec) -> Path:
        out = Path(spec.output_path)
        if not out.is_absolute():
            out = Path.cwd() / out
        out.parent.mkdir(parents=True, exist_ok=True)
        return out

    @staticmethod
    def _hex_to_rgb(color: str) -> tuple[int, int, int]:
        """'#00ff00' | '00ff00' | '#0f0' → (0, 255, 0)."""
        c = (color or "#000000").lstrip("#")
        if len(c) == 3:
            c = "".join(ch * 2 for ch in c)
        if len(c) != 6:
            raise ValueError(f"Invalid hex color: {color!r}")
        return int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)