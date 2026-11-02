"""MuseTalk lip-sync adapter -- local-only inference, no API calls.

See D42 (docs/architecture/decision-log.md). MuseTalk v1.5 is MIT-licensed,
needs ~4 GB VRAM in fp32 (~2 GB in fp16), and runs on the GTX 1070 Ti.

November 2026 best practices applied (see web research):
  * fp16 (`--use_float16`) roughly halves VRAM -- default on for the 8 GB card.
  * Model is trained at 25 fps; mismatched frame rate drifts the lip track.
    Probe the input and warn (auto-resample is out of scope: the caller owns
    the source video).
  * `preparation=True` generates face latents once per avatar; later clips on
    the same avatar skip it and respond in seconds. Exposed as
    `prepare_avatar()` + `use_prepared` flag.
  * Stream subprocess stderr/stdout for real per-frame progress instead of
    capturing everything at the end. `subprocess.Popen` (async) also lets us
    cancel mid-inference.
  * Batch-size / VRAM steering: dynamic batch size based on VRAM is handled by
    the queue layer; this adapter exposes `batch_size` for the command template.

Layout:
- Model weights live OUTSIDE the repo (default ``<project>/models/musetalk``,
  gitignored). They are never committed.
- The model is invoked through a configurable command template
  (``config/lipsync.json`` -> ``inference.command``). The template MUST be
  confirmed against the installed MuseTalk version on the Windows GPU box;
  until it is, :meth:`MuseTalkAdapter.lipsync` fails open with
  :class:`LipSyncNotConfiguredError` naming the exact missing step.
- Audio is normalized to 16 kHz mono WAV via ffmpeg before inference -- the
  format lip-sync models expect. For songs, feed the isolated vocals stem
  (``POST /api/audio/separate``) and mux the full mix back afterwards;
  speech-trained models sync markedly worse on full mixes (research notes).
- VRAM is preflighted through vram_manager (D7): begin/end_lipsync_generation
  offload Ollama when needed and restore it afterwards.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import shlex
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Callable

from ..vram_manager import vram_manager

logger = logging.getLogger(__name__)


#: MuseTalk was trained at 25 fps. A mismatched source fps drifts the lip track.
DEFAULT_FPS = 25


class LipSyncError(Exception):
    """Base error for lip-sync failures."""


class LipSyncNotConfiguredError(LipSyncError):
    """Raised when the local MuseTalk install is incomplete.

    Fail-open by design: the job fails with a message telling the operator
    exactly what to install, instead of crashing on a missing binary.
    """


class LipSyncCancelledError(LipSyncError):
    """Raised when lip-sync inference is cancelled mid-run."""


def _read_mock_flag(raw: dict[str, Any]) -> bool:
    """Read the dev-only mock flag; accepts {"mock": {"enabled": bool}} or a bare bool."""
    mock_cfg = raw.get("mock", False)
    if isinstance(mock_cfg, dict):
        return bool(mock_cfg.get("enabled", False))
    return bool(mock_cfg)


def _read_bool(raw: dict[str, Any], key: str, *, default: bool) -> bool:
    """Read a boolean config value, accepting bare bool or {"enabled": bool}."""
    val = raw.get(key, default)
    if isinstance(val, dict):
        return bool(val.get("enabled", default))
    return bool(val)


@dataclass
class MuseTalkConfig:
    """Resolved configuration for the adapter."""

    weights_dir: Path
    vram_budget_mb: int = 4096
    inference_command: str = ""  # template with {video} {audio} {output} {weights_dir}
    inference_timeout_s: int = 300
    audio_sample_rate: int = 16000
    audio_normalization_timeout_s: int = 600
    use_float16: bool = True
    target_fps: int = DEFAULT_FPS
    batch_size: int = 1
    #: Directory for prepared face latents (avatar cache). Defaults to
    #: weights_dir / "prepared".
    preparation_dir: Path | None = None
    # mock: dev-only pipeline test. Copies the input video to the output instead
    # of running the model, so the full batch workflow (chunk -> queue -> stitch)
    # can be exercised with no GPU and no weights. NEVER for real output.
    mock: bool = False

    @classmethod
    def load(cls, config_path: Path | None = None) -> MuseTalkConfig:
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
                logger.warning("Could not read %s: %s -- using defaults", config_path, exc)
        weights = raw.get("weights_dir", "models/musetalk")
        weights_dir = Path(weights)
        if not weights_dir.is_absolute():
            here = Path(__file__).resolve()
            weights_dir = here.parents[5] / weights
        inference = raw.get("inference", {})
        audio = raw.get("audio", {})
        prep_raw = raw.get("preparation", {})
        prep_dir = prep_raw.get("dir", None)
        preparation_dir: Path | None = None
        if prep_dir:
            preparation_dir = Path(prep_dir)
            if not preparation_dir.is_absolute():
                here = Path(__file__).resolve()
                preparation_dir = here.parents[5] / preparation_dir
        return cls(
            weights_dir=weights_dir,
            vram_budget_mb=int(raw.get("vram_budget_mb", 4096)),
            inference_command=str(inference.get("command", "")),
            inference_timeout_s=int(inference.get("timeout_seconds", 3600)),
            audio_sample_rate=int(audio.get("sample_rate", 16000)),
            audio_normalization_timeout_s=int(audio.get("normalization_timeout_seconds", 600)),
            use_float16=_read_bool(raw, "use_float16", default=True),
            target_fps=int(raw.get("target_fps", DEFAULT_FPS)),
            batch_size=int(inference.get("batch_size", 1)),
            preparation_dir=preparation_dir,
            mock=_read_mock_flag(raw),
        )


class MuseTalkAdapter:
    """Local MuseTalk inference with VRAM handshake, fail-open config, and
    real progress streaming.

    Heavy work runs in a worker thread (asyncio.to_thread) so the event loop
    stays responsive; the queue (D8) already serializes jobs.

    Inference is driven through ``asyncio.create_subprocess_exec`` so that
    (a) MuseTalk's per-frame progress lines on stderr are streamed to the
    progress callback in real time, and (b) a running job can be cancelled
    via :meth:`cancel` without waiting for the full timeout.
    """

    #: Declared VRAM cost (D7). Mirrors MIN_VRAM_FOR_LIPSYNC in vram_manager.
    VRAM_BUDGET_MB = 4096

    def __init__(self, config: MuseTalkConfig | None = None) -> None:
        self.config = config or MuseTalkConfig.load()
        self._weights_verified = False
        self._current_proc: asyncio.subprocess.Process | None = None
        self._cancelled = False

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
                "use_float16": self.config.use_float16,
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
            "use_float16": self.config.use_float16,
            "missing": missing,
            "message": "ready" if installed else "missing: " + "; ".join(missing),
        }

    def _require_ready(self) -> None:
        status = self.check_installation()
        if not status["installed"]:
            raise LipSyncNotConfiguredError("MuseTalk is not ready: " + status["message"])

    # ------------------------------------------------------------------
    # Cancellation
    # ------------------------------------------------------------------
    def cancel(self) -> None:
        """Request cancellation of the in-flight inference.

        Safe to call from any thread. The next progress checkpoint (or the
        subprocess wait) observes the flag and raises
        :class:`LipSyncCancelledError`. The subprocess itself is terminated.
        """
        self._cancelled = True
        if self._current_proc is not None and self._current_proc.returncode is None:
            try:
                self._current_proc.terminate()
            except Exception:
                logger.debug("Failed to terminate MuseTalk subprocess", exc_info=True)

    def _reset_cancel(self) -> None:
        self._cancelled = False
        self._current_proc = None

    def _check_cancelled(self) -> None:
        if self._cancelled:
            raise LipSyncCancelledError("lip-sync cancelled by caller")

    # ------------------------------------------------------------------
    # Avatar preparation (latent caching)
    # ------------------------------------------------------------------
    def preparation_dir_for(self, avatar_key: str) -> Path:
        """Return the directory where prepared latents for *avatar_key* live."""
        base = self.config.preparation_dir or (self.config.weights_dir / "prepared")
        return base / avatar_key

    def is_prepared(self, avatar_key: str) -> bool:
        """True if face latents have been prepared for *avatar_key*."""
        d = self.preparation_dir_for(avatar_key)
        return d.is_dir() and (d / "latents.pt").is_file()

    async def prepare_avatar(
        self,
        video_path: str | Path,
        avatar_key: str,
        progress_cb: Callable[[float, str], Any] | None = None,
    ) -> dict[str, Any]:
        """Run MuseTalk preparation for a source avatar, caching face latents.

        Per November 2026 best practices: set ``preparation=True`` once per
        avatar, then reuse the cached latents for every subsequent clip on
        that avatar -- later clips respond in seconds instead of minutes.

        The command template gains ``{prep_dir}`` and ``{avatar_key}``
        placeholders in addition to the standard ``{video}``/``{audio}``/
        ``{output}``/``{weights_dir}``.
        """
        self._require_ready()
        video = Path(video_path)
        if not video.is_file():
            raise FileNotFoundError(f"Video not found: {video}")
        prep_dir = self.preparation_dir_for(avatar_key)
        prep_dir.mkdir(parents=True, exist_ok=True)

        template = self.config.inference_command.strip()
        if not template:
            raise LipSyncNotConfiguredError(
                "inference.command is empty in config/lipsync.json -- "
                "confirm the invocation against the installed MuseTalk version "
                "on the Windows GPU box, then set it."
            )
        cmd_str = template.format(
            video=str(video),
            audio="",  # preparation needs no audio
            output=str(prep_dir / "latents.pt"),
            weights_dir=str(self.config.weights_dir),
            prep_dir=str(prep_dir),
            avatar_key=avatar_key,
        )
        cmd = shlex.split(cmd_str, posix=False)

        def _note(p: float, m: str) -> None:
            if progress_cb:
                progress_cb(p, m)

        _note(0.05, "starting avatar preparation")
        self._reset_cancel()
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=str(self.config.weights_dir.parent),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            self._current_proc = proc
            stdout, stderr = await proc.communicate()
            self._current_proc = None
            self._check_cancelled()
            if proc.returncode != 0:
                raise RuntimeError(
                    f"Avatar preparation failed (rc={proc.returncode}): "
                    f"{(stderr or b'').decode(errors='replace')[-800:]}"
                )
            _note(1.0, "preparation complete")
        except LipSyncCancelledError:
            try:
                proc.terminate()
            except Exception:
                pass
            raise
        finally:
            self._current_proc = None
        return {
            "success": True,
            "preparation_dir": str(prep_dir),
            "avatar_key": avatar_key,
        }

    # ------------------------------------------------------------------
    # Main entry
    # ------------------------------------------------------------------
    async def lipsync(
        self,
        video_path: str | Path,
        audio_path: str | Path,
        output_path: str | Path,
        progress_cb: Callable[[float, str], Any] | None = None,
        avatar_key: str | None = None,
        *,
        use_prepared: bool = False,
    ) -> dict[str, Any]:
        """Lip-sync a video clip to an audio track. Returns a result dict.

        Raises LipSyncNotConfiguredError when the local install is incomplete,
        FileNotFoundError for missing inputs, RuntimeError when the model
        process fails, LipSyncCancelledError when cancelled.

        Args:
            video_path: Source video or still image.
            audio_path: Driving audio (16 kHz mono WAV preferred; normalized
                automatically otherwise).
            output_path: Where to write the lip-synced video.
            progress_cb: Optional ``(frac, message)`` callback for real-time
                progress streaming.
            avatar_key: Optional avatar identifier. When set with
                ``use_prepared=True`` and latents are cached, skips the
                per-avatar preparation step (large speedup on repeat clips).
            use_prepared: When True and cached latents exist for *avatar_key*,
                reuse them instead of re-preparing.
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

        # Frame-rate validation -- MuseTalk is trained at 25 fps; mismatch drifts.
        source_fps = await asyncio.to_thread(self._probe_fps, video)
        if source_fps is not None and abs(source_fps - self.config.target_fps) > 0.5:
            logger.warning(
                "Source video fps (%.2f) differs from MuseTalk training fps (%d) -- "
                "expect lip-track drift. Resample the source to %d fps before syncing.",
                source_fps,
                self.config.target_fps,
                self.config.target_fps,
            )

        mock = self.config.mock

        def _note(p: float, m: str) -> None:
            if progress_cb:
                progress_cb(p, m)

        _note(0.05, "preparing audio")
        workdir = out.parent / f".lipsync_{out.stem}"
        workdir.mkdir(parents=True, exist_ok=True)
        try:
            wav = await asyncio.to_thread(
                self._prepare_audio, audio, workdir
            )
            # Optional avatar preparation (latent caching) -- skipped when
            # cached latents exist and use_prepared is set.
            if avatar_key and use_prepared and self.is_prepared(avatar_key):
                _note(0.12, f"using cached latents for avatar {avatar_key}")
            elif avatar_key:
                _note(0.12, f"preparing avatar {avatar_key} latents")
                await self.prepare_avatar(video, avatar_key, progress_cb=_note)

            # VRAM handshake (D7) -- preflighted through vram_manager.
            # Skipped in mock mode: there is no GPU to manage.
            if not mock:
                _note(0.20, "VRAM preflight")
                begin = await vram_manager.begin_lipsync_generation(
                    vram_budget_mb=self.config.vram_budget_mb
                )
                if not begin.get("success"):
                    raise RuntimeError(
                        "Insufficient VRAM for lip-sync: " + str(begin.get("error", "unknown"))
                    )
            try:
                _note(0.30, "running MuseTalk" if not mock else "mock inference")
                # Stream inference output for real per-frame progress when a
                # callback is provided; otherwise run synchronously in a thread.
                if progress_cb is not None:
                    await self._run_inference_streaming(
                        video, wav, out, avatar_key=avatar_key, progress_cb=_note
                    )
                else:
                    await asyncio.to_thread(
                        self._run_inference,
                        video,
                        wav,
                        out,
                        avatar_key=avatar_key,
                        progress_cb=_note,
                    )
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
            "source_fps": source_fps,
            "target_fps": self.config.target_fps,
            "use_float16": self.config.use_float16,
        }

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------
    def _probe_fps(self, video_path: Path) -> float | None:
        """Probe the video frame rate via ffprobe. Returns None on failure."""
        ffprobe = shutil.which("ffprobe")
        if not ffprobe:
            return None
        try:
            proc = subprocess.run(
                [
                    ffprobe,
                    "-v",
                    "error",
                    "-select_streams",
                    "v:0",
                    "-show_entries",
                    "stream=r_frame_rate",
                    "-of",
                    "default=noprint_wrappers=1:nokey=1",
                    str(video_path),
                ],
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=30,
            )
            if proc.returncode != 0:
                return None
            rate = proc.stdout.strip()
            if not rate or rate == "0/0":
                return None
            if "/" in rate:
                num, den = rate.split("/", 1)
                den_v = float(den)
                if den_v == 0:
                    return None
                return float(num) / den_v
            return float(rate)
        except (subprocess.TimeoutExpired, ValueError, OSError):
            logger.debug("ffprobe fps probe failed for %s", video_path, exc_info=True)
            return None

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
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=self.config.audio_normalization_timeout_s,
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError(
                f"Audio normalization timed out after {self.config.audio_normalization_timeout_s}s"
            ) from exc
        if proc.returncode != 0 or not wav.is_file():
            raise RuntimeError(f"Audio normalization failed: {proc.stderr[-500:]}")
        return wav

    def _run_inference(
        self,
        video: Path,
        audio_wav: Path,
        out: Path,
        avatar_key: str | None = None,
        progress_cb: Callable[[float, str], Any] | None = None,
    ) -> None:
        """Invoke MuseTalk through the configured command template (blocking).

        Runs the subprocess inside asyncio.to_thread but streams its output
        line-by-line so per-frame progress reaches the callback in real time.
        The template placeholders: {video} {audio} {output} {weights_dir}
        plus optional {prep_dir} {avatar_key} {batch_size} {float16_flag}.

        Cancellation: this method runs in a worker thread and cannot be
        interrupted from the event loop directly. Cancellation is instead
        handled at the async layer (``lipsync`` uses
        ``create_subprocess_exec`` when a progress callback is present, and
        ``cancel()`` terminates the subprocess). When no progress callback is
        provided the synchronous path below is used for simplicity.
        """
        if self.config.mock:
            logger.warning("MuseTalk mock mode: copying input video to output (no model run)")
            shutil.copyfile(video, out)
            return
        template = self.config.inference_command.strip()
        if not template:
            raise LipSyncNotConfiguredError(
                "inference.command is empty in config/lipsync.json -- "
                "confirm the invocation against the installed MuseTalk version "
                "on the Windows GPU box, then set it."
            )
        float16_flag = " --use_float16" if self.config.use_float16 else ""
        cmd_str = template.format(
            video=str(video),
            audio=str(audio_wav),
            output=str(out),
            weights_dir=str(self.config.weights_dir),
            prep_dir=str(self.preparation_dir_for(avatar_key)) if avatar_key else "",
            avatar_key=avatar_key or "",
            batch_size=str(self.config.batch_size),
            float16_flag=float16_flag.strip(),
        )
        # shlex-free split that keeps quoted segments intact (posix=False for
        # Windows-style paths with backslashes and spaces).
        cmd = shlex.split(cmd_str, posix=False)
        logger.info("MuseTalk inference: %s", cmd_str[:200])

        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=self.config.inference_timeout_s,
                cwd=str(self.config.weights_dir.parent),
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError(
                f"MuseTalk timed out after {self.config.inference_timeout_s}s"
            ) from exc
        if proc.returncode != 0:
            raise RuntimeError(
                f"MuseTalk inference failed (rc={proc.returncode}): "
                f"{(proc.stderr or '')[-800:]}"
            )
        # If a progress callback was provided but we ran synchronously (no
        # streaming), at least report completion based on the exit code.
        if progress_cb and proc.returncode == 0:
            progress_cb(1.0, "inference complete")

    async def _run_inference_streaming(
        self,
        video: Path,
        audio_wav: Path,
        out: Path,
        avatar_key: str | None = None,
        progress_cb: Callable[[float, str], Any] | None = None,
    ) -> None:
        """Async variant of _run_inference that streams subprocess output for
        real per-frame progress and supports cancellation.

        Used by ``lipsync`` when a progress callback is provided. Falls back
        to the synchronous path if the platform doesn't support async
        subprocess (Windows SelectorEventLoop).
        """
        if self.config.mock:
            logger.warning("MuseTalk mock mode: copying input video to output (no model run)")
            shutil.copyfile(video, out)
            return
        template = self.config.inference_command.strip()
        if not template:
            raise LipSyncNotConfiguredError(
                "inference.command is empty in config/lipsync.json -- "
                "confirm the invocation against the installed MuseTalk version "
                "on the Windows GPU box, then set it."
            )
        float16_flag = " --use_float16" if self.config.use_float16 else ""
        cmd_str = template.format(
            video=str(video),
            audio=str(audio_wav),
            output=str(out),
            weights_dir=str(self.config.weights_dir),
            prep_dir=str(self.preparation_dir_for(avatar_key)) if avatar_key else "",
            avatar_key=avatar_key or "",
            batch_size=str(self.config.batch_size),
            float16_flag=float16_flag.strip(),
        )
        cmd = shlex.split(cmd_str, posix=False)
        logger.info("MuseTalk inference (streaming): %s", cmd_str[:200])

        frame_re = re.compile(r"frame\s*(\d+)\s*/\s*(\d+)", re.IGNORECASE)
        pct_re = re.compile(
            r"(\d{1,3})\s*%\s*(?:complete|done|rendered)", re.IGNORECASE
        )

        self._reset_cancel()
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=str(self.config.weights_dir.parent),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except NotImplementedError:
            # Windows SelectorEventLoop -- fall back to synchronous run in a thread.
            logger.debug("async subprocess unavailable; falling back to thread")
            await asyncio.to_thread(
                self._run_inference, video, audio_wav, out, avatar_key=avatar_key, progress_cb=progress_cb
            )
            return
        self._current_proc = proc
        last_prog = [0.0]

        async def _read_stream(stream: asyncio.StreamReader, *, is_stderr: bool = False) -> str:
            chunks: list[bytes] = []
            while True:
                line = await stream.readline()
                if not line:
                    break
                chunks.append(line)
                text = line.decode(errors="replace").strip()
                if not text:
                    continue
                prog: float | None = None
                msg = text
                m = frame_re.search(text)
                if m:
                    cur, total = int(m.group(1)), int(m.group(2))
                    if total > 0:
                        prog = cur / total
                        msg = f"Rendering frame {cur}/{total}"
                if prog is None:
                    m = pct_re.search(text)
                    if m:
                        pct = int(m.group(1))
                        prog = pct / 100.0
                        msg = f"Rendering {pct}%"
                if prog is not None and progress_cb is not None:
                    if prog - last_prog[0] >= 0.02:
                        last_prog[0] = prog
                        try:
                            progress_cb(prog, msg)
                        except Exception:
                            logger.debug("progress_cb raised", exc_info=True)
                self._check_cancelled()
            return b"".join(chunks).decode(errors="replace")

        try:
            stdout_task = asyncio.create_task(_read_stream(proc.stdout))
            stderr_task = asyncio.create_task(_read_stream(proc.stderr, is_stderr=True))
            await asyncio.gather(stdout_task, stderr_task)
            await proc.wait()
        except LipSyncCancelledError:
            try:
                proc.terminate()
            except Exception:
                pass
            raise
        finally:
            self._current_proc = None
        self._check_cancelled()
        if proc.returncode != 0:
            raise RuntimeError(
                f"MuseTalk inference failed (rc={proc.returncode})"
            )
