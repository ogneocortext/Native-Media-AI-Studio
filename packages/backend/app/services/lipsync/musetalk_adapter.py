"""MuseTalk lip-sync adapter — local-only inference, no API calls.

See D42 (docs/architecture/decision-log.md). MuseTalk v1.5 is MIT-licensed,
needs ~4 GB VRAM (declared as MIN_VRAM_FOR_LIPSYNC in vram_manager), and runs
on the GTX 1070 Ti.

Layout:
- Model weights live OUTSIDE the repo (default ``<project>/models/musetalk``,
  gitignored). They are never committed.
- The model is invoked through a configurable command template
  (``config/lipsync.json`` -> ``inference.command``). The template MUST be
  confirmed against the installed MuseTalk version on the Windows GPU box;
  until it is, :meth:`MuseTalkAdapter.lipsync` fails open with
  :class:`LipSyncNotConfiguredError` naming the exact missing step.
- Audio is normalized to 16 kHz mono WAV via ffmpeg before inference — the
  format lip-sync models expect. For songs, feed the isolated vocals stem
  (``POST /api/audio/separate``) and mux the full mix back afterwards;
  speech-trained models sync markedly worse on full mixes (research notes).
- VRAM is preflighted through vram_manager (D7): begin/end_lipsync_generation
  offload Ollama when needed and restore it afterwards.
"""

import asyncio
import json
import logging
import shutil
import subprocess
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


class LipSyncError(Exception):
    """Base error for lip-sync failures."""


class LipSyncNotConfiguredError(LipSyncError):
    """Raised when the local MuseTalk install is incomplete.

    Fail-open by design: the job fails with a message telling the operator
    exactly what to install, instead of crashing on a missing binary.
    """


def _read_mock_flag(raw: dict[str, Any]) -> bool:
    """Read the dev-only mock flag; accepts {"mock": {"enabled": bool}} or a bare bool."""
    mock_cfg = raw.get("mock", False)
    if isinstance(mock_cfg, dict):
        return bool(mock_cfg.get("enabled", False))
    return bool(mock_cfg)


@dataclass
class MuseTalkConfig:
    """Resolved configuration for the adapter."""

    weights_dir: Path
    vram_budget_mb: int = 4096
    inference_command: str = ""  # template with {video} {audio} {output} {weights_dir}
    inference_timeout_s: int = 3600
    audio_sample_rate: int = 16000
    # mock: dev-only pipeline test. Copies the input video to the output instead
    # of running the model, so the full batch workflow (chunk -> queue -> stitch)
    # can be exercised with no GPU and no weights. NEVER for real output.
    mock: bool = False

    @classmethod
    def load(cls, config_path: Path | None = None) -> "MuseTalkConfig":
        """Load from config/lipsync.json, falling back to defaults."""
        raw: dict[str, Any] = {}
        if config_path is None:
            # <repo>/packages/backend/app/services/lipsync/ -> <repo>/config
            here = Path(__file__).resolve()
            config_path = here.parents[5] / "config" / "lipsync.json"
        if config_path.is_file():
            try:
                raw = json.loads(config_path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError) as exc:
                logger.warning("Could not read %s: %s — using defaults", config_path, exc)
        weights = raw.get("weights_dir", "models/musetalk")
        weights_dir = Path(weights)
        if not weights_dir.is_absolute():
            here = Path(__file__).resolve()
            weights_dir = here.parents[5] / weights
        inference = raw.get("inference", {})
        return cls(
            weights_dir=weights_dir,
            vram_budget_mb=int(raw.get("vram_budget_mb", 4096)),
            inference_command=str(inference.get("command", "")),
            inference_timeout_s=int(inference.get("timeout_seconds", 3600)),
            audio_sample_rate=int(raw.get("audio", {}).get("sample_rate", 16000)),
            mock=_read_mock_flag(raw),
        )


class MuseTalkAdapter:
    """Local MuseTalk inference with VRAM handshake and fail-open config.

    Heavy work runs in a worker thread (asyncio.to_thread) so the event loop
    stays responsive; the queue (D8) already serializes jobs.
    """

    #: Declared VRAM cost (D7). Mirrors MIN_VRAM_FOR_LIPSYNC in vram_manager.
    VRAM_BUDGET_MB = 4096

    def __init__(self, config: MuseTalkConfig | None = None) -> None:
        self.config = config or MuseTalkConfig.load()
        self._weights_verified = False

    # ------------------------------------------------------------------
    # Preflight
    # ------------------------------------------------------------------
    def check_installation(self) -> dict[str, Any]:
        """Report what is present and what is missing. Never raises."""
        if self.config.mock:
            return {
                "installed": True,
                "mock": True,
                "weights_found": False,
                "weights_dir": str(self.config.weights_dir),
                "ffmpeg_found": shutil.which("ffmpeg") is not None,
                "command_configured": False,
                "vram_budget_mb": self.config.vram_budget_mb,
                "missing": [],
                "message": "mock mode (dev-only: copies input video, no GPU, no weights)",
            }
        weights = self.config.weights_dir
        weights_found = weights.is_dir() and any(weights.iterdir())
        ffmpeg_found = shutil.which("ffmpeg") is not None
        command_configured = bool(self.config.inference_command.strip())
        installed = weights_found and ffmpeg_found and command_configured
        missing: list[str] = []
        if not weights_found:
            missing.append(f"weights dir empty/missing: {weights}")
        if not ffmpeg_found:
            missing.append("ffmpeg not on PATH")
        if not command_configured:
            missing.append(
                "inference.command not set in config/lipsync.json "
                "(confirm against the installed MuseTalk version)"
            )
        return {
            "installed": installed,
            "weights_found": weights_found,
            "weights_dir": str(weights),
            "ffmpeg_found": ffmpeg_found,
            "command_configured": command_configured,
            "vram_budget_mb": self.config.vram_budget_mb,
            "missing": missing,
            "message": "ready" if installed else "missing: " + "; ".join(missing),
        }

    def _require_ready(self) -> None:
        status = self.check_installation()
        if not status["installed"]:
            raise LipSyncNotConfiguredError("MuseTalk is not ready: " + status["message"])

    # ------------------------------------------------------------------
    # Main entry
    # ------------------------------------------------------------------
    async def lipsync(
        self,
        video_path: str | Path,
        audio_path: str | Path,
        output_path: str | Path,
        progress_cb: Callable[[float, str], Any] | None = None,
    ) -> dict[str, Any]:
        """Lip-sync a video clip to an audio track. Returns a result dict.

        Raises LipSyncNotConfiguredError when the local install is incomplete,
        FileNotFoundError for missing inputs, RuntimeError when the model
        process fails.
        """
        self._require_ready()
        video = Path(video_path)
        audio = Path(audio_path)
        out = Path(output_path)
        if not video.is_file():
            raise FileNotFoundError(f"Video not found: {video}")
        if not audio.is_file():
            raise FileNotFoundError(f"Audio not found: {audio}")
        out.parent.mkdir(parents=True, exist_ok=True)

        mock = self.config.mock

        def _note(p: float, m: str) -> None:
            if progress_cb:
                progress_cb(p, m)

        _note(0.05, "preparing audio")
        workdir = out.parent / f".lipsync_{out.stem}"
        workdir.mkdir(parents=True, exist_ok=True)
        try:
            wav = await asyncio.to_thread(self._prepare_audio, audio, workdir)
            # VRAM handshake (D7) — deferred import keeps the module graph clean.
            # Skipped in mock mode: there is no GPU to manage.
            vram_manager = None
            if not mock:
                from ..vram_manager import vram_manager

                _note(0.15, "VRAM preflight")
                begin = await vram_manager.begin_lipsync_generation(
                    vram_budget_mb=self.config.vram_budget_mb
                )
                if not begin.get("success"):
                    raise RuntimeError(
                        "Insufficient VRAM for lip-sync: " + str(begin.get("error", "unknown"))
                    )
            try:
                _note(0.25, "running MuseTalk" if not mock else "mock inference")
                await asyncio.to_thread(self._run_inference, video, wav, out)
            finally:
                if vram_manager is not None:
                    await vram_manager.end_lipsync_generation()
            _note(0.95, "verifying output")
            if not out.is_file() or out.stat().st_size == 0:
                raise RuntimeError(f"MuseTalk produced no output at {out}")
            _note(1.0, "done")
        finally:
            shutil.rmtree(workdir, ignore_errors=True)
        return {
            "success": True,
            "output_path": str(out),
            "video_path": str(video),
            "audio_path": str(audio),
            "backend": "musetalk-mock" if self.config.mock else "musetalk",
        }

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------
    def _prepare_audio(self, audio_path: Path, workdir: Path) -> Path:
        """Normalize audio to 16 kHz mono WAV via ffmpeg (blocking)."""
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            raise LipSyncNotConfiguredError("ffmpeg not on PATH")
        wav = workdir / "audio_16k_mono.wav"
        cmd = [
            ffmpeg,
            "-y",
            "-v",
            "error",
            "-i",
            str(audio_path),
            "-ac",
            "1",
            "-ar",
            str(self.config.audio_sample_rate),
            "-c:a",
            "pcm_s16le",
            str(wav),
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if proc.returncode != 0 or not wav.is_file():
            raise RuntimeError(f"Audio normalization failed: {proc.stderr[-500:]}")
        return wav

    def _run_inference(self, video: Path, audio_wav: Path, out: Path) -> None:
        """Invoke MuseTalk through the configured command template (blocking).

        The template lives in config/lipsync.json so the exact flags can be
        pinned to the installed MuseTalk version without code changes.
        Placeholders: {video} {audio} {output} {weights_dir}.
        """
        if self.config.mock:
            logger.warning("MuseTalk mock mode: copying input video to output (no model run)")
            shutil.copyfile(video, out)
            return
        template = self.config.inference_command.strip()
        if not template:
            raise LipSyncNotConfiguredError(
                "inference.command is empty in config/lipsync.json — "
                "confirm the invocation against the installed MuseTalk version "
                "on the Windows GPU box, then set it."
            )
        cmd_str = template.format(
            video=str(video),
            audio=str(audio_wav),
            output=str(out),
            weights_dir=str(self.config.weights_dir),
        )
        # shlex-free split that keeps quoted segments intact.
        import shlex

        cmd = shlex.split(cmd_str, posix=False)
        logger.info("MuseTalk inference: %s", cmd_str[:200])
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=self.config.inference_timeout_s,
                cwd=str(self.config.weights_dir.parent),
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError(
                f"MuseTalk timed out after {self.config.inference_timeout_s}s"
            ) from exc
        if proc.returncode != 0:
            raise RuntimeError(
                f"MuseTalk inference failed (rc={proc.returncode}): {(proc.stderr or '')[-800:]}"
            )
