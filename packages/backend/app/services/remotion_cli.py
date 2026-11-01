"""
services/remotion_cli.py

Thin wrapper around the Remotion CLI (`npx remotion render`) so the backend can
programmatically trigger video renders from AI agents, without forcing Remotion
Studio into the adapter pattern.

Remotion Studio is a browser destination app, not a headless service the backend
drives over HTTP. The correct integration direction is the Remotion CLI: the
backend shells out to `npx remotion render` inside the video-editor project,
which compiles a Remotion composition to MP4/WebM.

The composition exposed by the local video editor is ``SignalBreakingThroughNoise``
(see ``packages/video-editor/src/Composition.tsx``). It accepts an optional
``analysis`` prop (AudioAnalysisData from ``GET /api/audio/timing-metadata/...``)
which drives section palettes, BPM, lyrics, and beat-synced animation.

All render work is CPU-bound (Node/esbuild + Chrome headless for frame capture),
so it runs off the event loop via ``asyncio.to_thread`` and is meant to be
dispatched as a ``REMOTION_RENDER`` queue job.

Dependency direction: api -> services only. This module imports nothing from
app.api; the router imports it.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

from ..core.config import PROJECT_ROOT

logger = logging.getLogger(__name__)

#: The composition ID exported from packages/video-editor/src/Composition.tsx
DEFAULT_COMPOSITION_ID = "SignalBreakingThroughNoise"

#: Default output directory for Remotion renders
RENDER_OUTPUT_DIR = PROJECT_ROOT / "output" / "remotion"


class RemotionCLIError(RuntimeError):
    """Raised when the Remotion CLI fails or is unavailable."""


class RemotionCLI:
    """
    Wraps the Remotion CLI render command.

    Usage::

        cli = RemotionCLI(video_editor_dir=Path("packages/video-editor"))
        result = await cli.render(
            composition_id="SignalBreakingThroughNoise",
            output_path=Path("output/remotion/my-video.mp4"),
            props={"analysis": {...}},
        )
    """

    def __init__(
        self,
        video_editor_dir: Path | str | None = None,
        node_bin: str | None = None,
        npx_bin: str | None = None,
    ) -> None:
        self.video_editor_dir = Path(video_editor_dir or PROJECT_ROOT / "packages" / "video-editor")
        self.node_bin = node_bin or os.environ.get("NODE_BIN", "node")
        self.npx_bin = npx_bin or os.environ.get("NPX_BIN", "npx")

    # ------------------------------------------------------------------
    # Discovery
    # ------------------------------------------------------------------

    def _remotion_bin(self) -> str | None:
        """Resolve the remotion CLI binary.

        On Windows the local ``node_modules/.bin/remotion`` is a Unix shell
        script (``#!/bin/sh``) that cannot be executed directly, so prefer
        ``npx remotion`` there. On Unix-like systems the local binary is fine.
        """
        import sys

        if sys.platform == "win32":
            # npx on Windows resolves to npx.cmd, which is directly executable.
            if shutil.which("npx"):
                return None  # signal the render() path to use npx remotion
            return shutil.which("remotion")
        local = self.video_editor_dir / "node_modules" / ".bin" / "remotion"
        if local.is_file():
            return str(local)
        return shutil.which("remotion")

    def _npx_available(self) -> bool:
        return shutil.which(self.npx_bin) is not None

    def is_available(self) -> bool:
        """True if the remotion CLI can be invoked (local install or npx)."""
        return self._remotion_bin() is not None or self._npx_available()

    # ------------------------------------------------------------------
    # Render
    # ------------------------------------------------------------------

    async def render(
        self,
        composition_id: str,
        output_path: Path | str,
        props: dict[str, Any] | None = None,
        codec: str = "h264",
        concurrency: str | int = "auto",
        ffmpeg_log_level: str = "warning",
        should_cancel: object | None = None,  # placeholder for future coop cancellation
    ) -> dict[str, Any]:
        """
        Render a Remotion composition to a video file.

        Runs ``npx remotion render <id> <out> --codec <codec>
        [--concurrency <n>] [--props <json>]`` inside the video-editor
        directory. Runs off the event loop because esbuild + Chrome headless
        are CPU-bound.

        Returns a dict with ``output_path``, ``duration_sec`` (if measurable),
        ``command`` and ``exit_code``. Raises ``RemotionCLIError`` on failure.
        """
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        remotion_bin = self._remotion_bin()
        if remotion_bin:
            cmd = [remotion_bin, "render", composition_id, str(output_path)]
        elif self._npx_available():
            cmd = [self.npx_bin, "remotion", "render", composition_id, str(output_path)]
        else:
            raise RemotionCLIError(
                "remotion CLI not found: install @remotion/cli in the video-editor "
                "project or make `remotion` available on PATH"
            )

        cmd += ["--codec", codec]

        # "auto" is not a valid CLI value; omit the flag to let Remotion pick
        if concurrency is not None and str(concurrency).lower() != "auto":
            cmd += ["--concurrency", str(concurrency)]

        cmd += ["--log-level", ffmpeg_log_level]

        if props is not None:
            cmd += ["--props", json.dumps(props)]

        logger.info(
            "Remotion render start: composition=%s output=%s cwd=%s",
            composition_id,
            output_path,
            self.video_editor_dir,
        )

        # CPU-bound Node work; run off the event loop.
        def _run() -> subprocess.CompletedProcess:
            # On Windows, npx resolves to npx.CMD (a batch file) which
            # subprocess cannot exec directly; use shell=True so cmd.exe
            # dispatches it. On Unix the local binary is a real executable.
            use_shell = sys.platform == "win32" and not remotion_bin
            if use_shell:
                cmd_str = " ".join(f'"{c}"' if " " in c else c for c in cmd)
                return subprocess.run(
                    cmd_str,
                    cwd=str(self.video_editor_dir),
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    shell=True,
                    env={**os.environ, "CI": "1"},  # CI=1 avoids interactive prompts
                )
            return subprocess.run(
                cmd,
                cwd=str(self.video_editor_dir),
                capture_output=True,
                text=True,
                encoding="utf-8",
                env={**os.environ, "CI": "1"},  # CI=1 avoids interactive prompts
            )

        try:
            proc = await asyncio.to_thread(_run)
        except Exception as exc:
            raise RemotionCLIError(f"remotion render failed to start: {exc}") from exc

        if proc.returncode != 0:
            tail = proc.stderr[-2000:] if proc.stderr else ""
            raise RemotionCLIError(f"remotion render exited {proc.returncode}: {tail}")

        # Probe output duration with ffprobe if available, else report 0.
        duration_sec = 0.0
        if output_path.is_file():
            try:
                import soundfile as sf  # type: ignore

                info = sf.info(str(output_path))
                duration_sec = float(info.frames) / float(info.samplerate)
            except Exception:
                try:
                    ffprobe = shutil.which("ffprobe")
                    if ffprobe:
                        p = await asyncio.to_thread(
                            subprocess.run,
                            [
                                ffprobe,
                                "-v",
                                "error",
                                "-show_entries",
                                "format=duration",
                                "-of",
                                "default=noprint_wrappers=1:nokey=1",
                                str(output_path),
                            ],
                            capture_output=True,
                            text=True,
                        )
                        if p.returncode == 0 and p.stdout.strip():
                            duration_sec = float(p.stdout.strip())
                except Exception:
                    logger.debug("could not measure render duration: %s", output_path)

        logger.info(
            "Remotion render complete: composition=%s output=%s duration=%.2fs",
            composition_id,
            output_path,
            duration_sec,
        )

        return {
            "composition_id": composition_id,
            "output_path": str(output_path),
            "duration_sec": duration_sec,
            "command": " ".join(cmd),
            "exit_code": proc.returncode,
        }

    async def render_remix_audio(
        self,
        remix_name: str,
        output_path: Path | str | None = None,
        audio_file: str | None = None,
    ) -> dict[str, Any]:
        """
        Convenience render that binds the default composition to a remix's audio.

        Passes ``audio_file`` as a prop so the composition can pick up the
        remix's master WAV from ``output/remixes/<name>/enhanced/``.
        """
        output_path = Path(output_path or RENDER_OUTPUT_DIR / f"{remix_name}.mp4")
        props: dict[str, Any] = {}
        if audio_file:
            props["audio_file"] = audio_file
        return await self.render(
            composition_id=DEFAULT_COMPOSITION_ID,
            output_path=output_path,
            props=props or None,
        )


# Module-level singleton, wired to the video-editor project by default.
remotion_cli = RemotionCLI()

__all__ = [
    "RemotionCLI",
    "RemotionCLIError",
    "remotion_cli",
    "DEFAULT_COMPOSITION_ID",
    "RENDER_OUTPUT_DIR",
]
