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
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Callable

from ..vram_manager import vram_manager

logger = logging.getLogger(__name__)


#: MuseTalk was trained at 25 fps. A mismatched source fps drifts the lip track.
DEFAULT_FPS = 25

#: Extensions MuseTalk's ``get_file_type()`` accepts (scripts/inference.py).
#: Anything else -- e.g. the ``.webp`` stills ``lipsync-upload`` allows --
#: dies with a bare ``ValueError`` deep in the worker.
_MUSETALK_VIDEO_EXTS = {".avi", ".mp4", ".mov", ".flv", ".mkv"}
_MUSETALK_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"}
#: Still-image formats we can transcode to PNG before inference.
_STILL_TRANSCODE_EXTS = {".webp", ".gif", ".heic", ".heif", ".avif"}


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


def _split_command(cmd_str: str) -> list[str]:
    """Split an inference command template into argv (Windows semantics).

    ``shlex.split`` is wrong here in both modes: ``posix=True`` eats the
    backslashes in Windows paths, and ``posix=False`` keeps the quote
    characters inside the tokens, which ``subprocess`` then re-quotes into a
    mangled command line (verified on Windows: a quoted path with spaces
    reaches the child with literal ``"`` characters and fails to open).
    This splitter treats ``"`` and ``'`` as grouping quotes that are removed,
    keeps backslashes literal, and splits on whitespace outside quotes --
    matching how the final argv is repacked for CreateProcess.
    """
    args: list[str] = []
    cur: list[str] = []
    quote: str | None = None
    started = False
    for ch in cmd_str:
        if quote is not None:
            if ch == quote:
                quote = None
            else:
                cur.append(ch)
            continue
        if ch in "\"'":
            quote = ch
            started = True
        elif ch in " \t\r\n":
            if started:
                args.append("".join(cur))
                cur = []
                started = False
        else:
            cur.append(ch)
            started = True
    if quote is not None:
        raise LipSyncError(f"Unterminated quote in inference command: {cmd_str[:120]}")
    if started:
        args.append("".join(cur))
    return args


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
    #: Space-free scratch dir for inference I/O. MuseTalk shells out to
    #: ``os.system("ffmpeg ... {path}")`` internally, which breaks on paths
    #: containing spaces — and this repo's root does. When None, resolved at
    #: runtime to the first writable space-free candidate.
    scratch_dir: Path | None = None
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
        scratch_raw = inference.get("scratch_dir") or raw.get("scratch_dir")
        scratch_dir: Path | None = None
        if scratch_raw:
            scratch_dir = Path(scratch_raw)
            if not scratch_dir.is_absolute():
                here = Path(__file__).resolve()
                scratch_dir = here.parents[5] / scratch_dir
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
            scratch_dir=scratch_dir,
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
                "warnings": [],
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
        # Component-level checks (non-fatal): a partial weights download
        # passes "dir non-empty" but crashes inside inference. MuseTalk v1.5
        # needs a UNet checkpoint/config, Whisper for audio features, and the
        # SD-VAE decoder — look for them anywhere under weights_dir.
        warnings: list[str] = []
        if weights_found:
            have_unet = any(weights.rglob("unet*.pth")) or any(
                weights.rglob("unet*config*.yaml")
            )
            have_whisper = any(p.name.lower() == "whisper" for p in weights.rglob("*"))
            have_vae = any(
                "vae" in p.name.lower() for p in weights.rglob("*.pth")
            ) or any(p.name.lower() == "sd-vae" for p in weights.rglob("*"))
            for label, ok in (
                ("MuseTalk UNet checkpoint/config (unet*.pth)", have_unet),
                ("Whisper weights (whisper/)", have_whisper),
                ("SD-VAE weights (sd-vae/ or *vae*.pth)", have_vae),
            ):
                if not ok:
                    warnings.append(f"{label} not found under {weights}")
        return {
            "installed": installed,
            "weights_found": weights_found,
            "weights_dir": str(weights),
            "ffmpeg_found": ffmpeg_found,
            "command_configured": command_configured,
            "vram_budget_mb": self.config.vram_budget_mb,
            "use_float16": self.config.use_float16,
            "missing": missing,
            "warnings": warnings,
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

    @staticmethod
    def _terminate_proc(proc: asyncio.subprocess.Process) -> None:
        try:
            proc.terminate()
        except Exception:
            pass

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

    def _resolve_scratch_dir(self) -> Path:
        """Space-free directory for inference I/O.

        MuseTalk shells ffmpeg through ``os.system`` with unquoted paths, so
        any space in the video/audio/output path breaks inference — and this
        repo's root contains spaces. Candidates are tried in order; the temp
        dir is the last resort even though it usually contains spaces too.
        """
        if self.config.scratch_dir is not None:
            self.config.scratch_dir.mkdir(parents=True, exist_ok=True)
            return self.config.scratch_dir
        for cand in (
            Path(r"C:\Users\Public\lipsync-tmp"),
            Path(r"C:\lipsync-tmp"),
            Path(r"D:\lipsync-tmp"),
            Path(tempfile.gettempdir()),
        ):
            if " " in str(cand):
                continue
            try:
                cand.mkdir(parents=True, exist_ok=True)
                return cand
            except OSError:
                continue
        return Path(tempfile.gettempdir())

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
        cmd = _split_command(cmd_str)

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
            try:
                stdout, stderr = await proc.communicate()
            except asyncio.CancelledError:
                # Outer timeout/cancellation: do not leave MuseTalk running
                # and holding VRAM after the job is gone.
                self._terminate_proc(proc)
                raise
            self._current_proc = None
            self._check_cancelled()
            if proc.returncode != 0:
                raise RuntimeError(
                    f"Avatar preparation failed (rc={proc.returncode}): "
                    f"{(stderr or b'').decode(errors='replace')[-800:]}"
                )
            _note(1.0, "preparation complete")
        except LipSyncCancelledError:
            self._terminate_proc(proc)
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
        ext = video.suffix.lower()
        if ext not in (_MUSETALK_VIDEO_EXTS | _MUSETALK_IMAGE_EXTS | _STILL_TRANSCODE_EXTS):
            raise ValueError(
                f"Unsupported input format {video.suffix!r} for {video.name}: "
                "MuseTalk accepts "
                f"{sorted(_MUSETALK_VIDEO_EXTS | _MUSETALK_IMAGE_EXTS)} "
                f"(plus transcoded {sorted(_STILL_TRANSCODE_EXTS)})"
            )
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

        # Avatar preparation reports its own 0..1 fraction; map it into the
        # 0.12-0.19 band so job progress stays monotonic.
        def _prep_note(p: float, m: str) -> None:
            _note(0.12 + min(max(p, 0.0), 1.0) * 0.07, m)

        # Inference reports a 0..1 fraction (frames rendered / percent done);
        # map it into the 0.30-0.95 band for the same reason.
        def _infer_note(p: float, m: str) -> None:
            _note(0.30 + min(max(p, 0.0), 1.0) * 0.65, m)

        _note(0.05, "preparing audio")
        self._reset_cancel()
        self._check_cancelled()
        workdir = out.parent / f".lipsync_{out.stem}"
        workdir.mkdir(parents=True, exist_ok=True)
        try:
            wav = await asyncio.to_thread(self._prepare_audio, audio, workdir)
            self._check_cancelled()
            # Optional avatar preparation (latent caching) -- skipped when
            # cached latents exist and use_prepared is set.
            if avatar_key and use_prepared and self.is_prepared(avatar_key):
                _note(0.12, f"using cached latents for avatar {avatar_key}")
            elif avatar_key:
                _note(0.12, f"preparing avatar {avatar_key} latents")
                await self.prepare_avatar(video, avatar_key, progress_cb=_prep_note)
                self._check_cancelled()

            # VRAM handshake (D7) -- preflighted through vram_manager.
            # Skipped in mock mode: there is no GPU to manage, and calling
            # end_lipsync_generation() without a matching begin would trigger
            # spurious model reloads as a side effect.
            vram_begun = False
            if not mock:
                _note(0.20, "VRAM preflight")
                begin = await vram_manager.begin_lipsync_generation(
                    vram_budget_mb=self.config.vram_budget_mb
                )
                if not begin.get("success"):
                    raise RuntimeError(
                        "Insufficient VRAM for lip-sync: " + str(begin.get("error", "unknown"))
                    )
                vram_begun = True
            try:
                _note(0.30, "running MuseTalk" if not mock else "mock inference")
                await self._infer_with_staging(
                    video, wav, out,
                    avatar_key=avatar_key, mock=mock, progress_cb=_infer_note,
                )
            finally:
                if vram_begun:
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
    async def _infer_with_staging(
        self,
        video: Path,
        wav: Path,
        out: Path,
        *,
        avatar_key: str | None,
        mock: bool,
        progress_cb: Callable[[float, str], Any] | None,
    ) -> None:
        """Run inference, staging I/O in a space-free scratch dir when needed.

        MuseTalk shells ffmpeg via ``os.system`` with unquoted paths, so any
        space in video/audio/output breaks it — and this repo's root has
        spaces. Real runs copy inputs into a scratch dir, render there, and
        copy the result back to ``out``.
        """
        infer_video, infer_audio, infer_out = video, wav, out
        staged_dir: Path | None = None
        if not mock:
            staged_dir = Path(
                tempfile.mkdtemp(prefix="ls_", dir=str(self._resolve_scratch_dir()))
            )
            infer_video = staged_dir / f"video{video.suffix or '.mp4'}"
            infer_audio = staged_dir / "audio.wav"
            infer_out = staged_dir / "output.mp4"
            shutil.copyfile(video, infer_video)
            shutil.copyfile(wav, infer_audio)
            if video.suffix.lower() in _STILL_TRANSCODE_EXTS:
                converted = staged_dir / "video.png"
                await asyncio.to_thread(self._transcode_still_to_png, infer_video, converted)
                infer_video = converted
        try:
            # Stream inference output for real per-frame progress when a
            # callback is provided; otherwise run synchronously in a thread.
            if progress_cb is not None:
                await self._run_inference_streaming(
                    infer_video, infer_audio, infer_out,
                    avatar_key=avatar_key, progress_cb=progress_cb,
                    scratch_dir=staged_dir,
                )
            else:
                await asyncio.to_thread(
                    self._run_inference,
                    infer_video, infer_audio, infer_out,
                    avatar_key=avatar_key, progress_cb=progress_cb,
                    scratch_dir=staged_dir,
                )
            self._check_cancelled()
            if staged_dir is not None:
                if not infer_out.is_file() or infer_out.stat().st_size == 0:
                    raise RuntimeError(f"MuseTalk produced no output at {infer_out}")
                shutil.copyfile(infer_out, out)
        finally:
            if staged_dir is not None:
                shutil.rmtree(staged_dir, ignore_errors=True)

    def _transcode_still_to_png(self, src: Path, dst: Path) -> None:
        """Transcode a still MuseTalk can't read (e.g. .webp) to PNG via ffmpeg."""
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            raise RuntimeError(
                f"Cannot transcode {src.suffix} still for MuseTalk: ffmpeg not on PATH"
            )
        proc = subprocess.run(
            [ffmpeg, "-y", "-v", "error", "-i", str(src), str(dst)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=120,
        )
        if proc.returncode != 0 or not dst.is_file():
            raise RuntimeError(
                f"Failed to transcode still {src.name} to PNG: "
                f"{(proc.stderr or '')[-300:]}"
            )

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
        scratch_dir: Path | None = None,
    ) -> None:
        """Invoke MuseTalk through the configured command template (blocking).

        Runs via ``subprocess.run`` inside ``asyncio.to_thread``; used when no
        progress callback is provided. Cancellation is not possible mid-run on
        this path -- ``lipsync`` prefers ``_run_inference_streaming`` whenever
        a callback exists, and ``_check_cancelled`` still observes the flag
        after the subprocess exits.
        The template placeholders: {video} {audio} {output} {weights_dir}
        plus optional {prep_dir} {avatar_key} {batch_size} {float16_flag}.
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
            scratch_dir=str(scratch_dir) if scratch_dir else "",
        )
        cmd = _split_command(cmd_str)
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
                f"MuseTalk inference failed (rc={proc.returncode}): {(proc.stderr or '')[-800:]}"
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
        scratch_dir: Path | None = None,
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
            scratch_dir=str(scratch_dir) if scratch_dir else "",
        )
        cmd = _split_command(cmd_str)
        logger.info("MuseTalk inference (streaming): %s", cmd_str[:200])

        frame_re = re.compile(r"frame\s*(\d+)\s*/\s*(\d+)", re.IGNORECASE)
        pct_re = re.compile(r"(\d{1,3})\s*%\s*(?:complete|done|rendered)", re.IGNORECASE)

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
                self._run_inference,
                video,
                audio_wav,
                out,
                avatar_key=avatar_key,
                progress_cb=progress_cb,
            )
            return
        self._current_proc = proc
        last_prog = [0.0]

        async def _read_stream(stream: asyncio.StreamReader) -> str:
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
            stderr_task = asyncio.create_task(_read_stream(proc.stderr))
            stdout_log, stderr_log = await asyncio.gather(stdout_task, stderr_task)
            await proc.wait()
        except (LipSyncCancelledError, asyncio.CancelledError):
            for t in (stdout_task, stderr_task):
                t.cancel()
            # Terminate first: on outer cancellation (e.g. the handler's
            # asyncio.timeout) the model process would otherwise keep running
            # and holding VRAM after the job is gone.
            self._terminate_proc(proc)
            try:
                await asyncio.wait_for(proc.wait(), timeout=10)
            except Exception:
                pass
            # Reap the reader tasks so a second LipSyncCancelledError is not
            # reported as "exception was never retrieved".
            await asyncio.gather(stdout_task, stderr_task, return_exceptions=True)
            raise
        finally:
            self._current_proc = None
        self._check_cancelled()
        if proc.returncode != 0:
            # MuseTalk catches its own exceptions and prints them to *stdout*
            # (scripts/inference.py "Error occurred during processing:"), so
            # prefer whichever stream tail carries an explicit error marker.
            detail = (stderr_log or "")[-800:]
            for stream_log in (stderr_log, stdout_log):
                if stream_log and (
                    "Error occurred" in stream_log or "Traceback" in stream_log
                ):
                    detail = stream_log[-800:]
                    break
            raise RuntimeError(
                f"MuseTalk inference failed (rc={proc.returncode}): {detail}"
            )
