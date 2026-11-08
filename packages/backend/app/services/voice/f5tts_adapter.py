"""F5-TTS voice-synthesis adapter -- local-only inference, no API calls.

Zero-shot voice cloning: a ``voice_id`` resolves to a reference clip +
transcript under ``voices/`` (or the caller supplies ``ref_audio_path`` +
``ref_text`` directly). Long text is chunked at sentence boundaries by
:mod:`app.services.voice.text_chunking` and synthesized in one subprocess
(``tools/f5tts_run.py`` inside ``D:\\venvs\\f5tts``), which loads the model
once, generates each chunk, concatenates, and writes a single WAV to
``output/audio/`` -- the same place every other audio producer writes, so
the file is downloadable via ``GET /api/audio/file/...`` and visible in the
media library with no extra wiring.

Design notes:
  * The model never stays resident: the wrapper process exits after each
    job and releases VRAM. Synthesis does not assume MuseTalk (or anything
    else) is or isn't on the GPU.
  * ``ref_text`` is REQUIRED -- the F5-TTS ASR fallback (whisper via
    transformers) needs torch>=2.6 and is disabled in this env. Every voice
    profile therefore stores its reference transcript.
  * VRAM is preflighted through vram_manager (D7): begin/end_voice_synthesis
    offload Ollama when needed and restore it afterwards. Budget is ~2.5 GB
    (fp32 on Pascal -- the model auto-selects fp16 only on sm_70+).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Callable

from ..vram_manager import vram_manager
from .text_chunking import chunk_text

logger = logging.getLogger(__name__)

_REF_AUDIO_EXTS = {".wav", ".mp3", ".flac", ".m4a", ".ogg"}
_VOICE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

#: Progress bands: model load + chunk loop is reported by the wrapper as
#: F5TTS_PROGRESS fractions; map wrapper 0..1 into job 0.30..0.95.
_INFER_BAND = (0.30, 0.95)


class VoiceSynthesisError(Exception):
    """Base error for voice-synthesis failures."""


class VoiceNotConfiguredError(VoiceSynthesisError):
    """Raised when the local F5-TTS install is incomplete (fail-open)."""


class VoiceCancelledError(VoiceSynthesisError):
    """Raised when synthesis is cancelled mid-run."""


@dataclass
class VoiceConfig:
    """Resolved configuration for the adapter (config/voice.json)."""

    python_exe: str
    wrapper_script: Path
    voices_dir: Path
    model: str = "F5TTS_v1_Base"
    hf_cache_dir: Path | None = None
    vram_budget_mb: int = 2560
    inference_timeout_s: int = 1800
    max_chunk_chars: int = 380
    max_total_chars: int = 4000
    mock: bool = False
    extra_args: list[str] = field(default_factory=list)

    @classmethod
    def load(cls, config_path: Path | None = None) -> VoiceConfig:
        """Load from config/voice.json, falling back to defaults."""
        raw: dict[str, Any] = {}
        if config_path is None:
            # <repo>/packages/backend/app/services/voice/ -> <repo>/config
            here = Path(__file__).resolve()
            config_path = here.parents[5] / "config" / "voice.json"
        if config_path.is_file():
            try:
                raw = json.loads(config_path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError) as exc:
                logger.warning("Could not read %s: %s -- using defaults", config_path, exc)
        here = Path(__file__).resolve()
        repo_root = here.parents[5]

        def _abs(p: str) -> Path:
            path = Path(p)
            return path if path.is_absolute() else repo_root / path

        inference = raw.get("inference", {})
        chunking = raw.get("chunking", {})
        voices_raw = raw.get("voices_dir", "voices")
        hf_raw = inference.get("hf_cache_dir") or raw.get("hf_cache_dir")
        mock_cfg = raw.get("mock", {})
        mock = bool(mock_cfg.get("enabled", False)) if isinstance(mock_cfg, dict) else bool(mock_cfg)
        return cls(
            python_exe=str(inference.get("python", r"D:\venvs\f5tts\Scripts\python.exe")),
            wrapper_script=_abs(str(inference.get("wrapper", "tools/f5tts_run.py"))),
            voices_dir=_abs(str(voices_raw)),
            model=str(inference.get("model", "F5TTS_v1_Base")),
            hf_cache_dir=_abs(str(hf_raw)) if hf_raw else None,
            vram_budget_mb=int(raw.get("vram_budget_mb", 2560)),
            inference_timeout_s=int(inference.get("timeout_seconds", 1800)),
            max_chunk_chars=int(chunking.get("max_chunk_chars", 380)),
            max_total_chars=int(chunking.get("max_total_chars", 4000)),
            mock=mock,
            extra_args=[str(a) for a in inference.get("extra_args", [])],
        )


class F5TTSAdapter:
    """Local F5-TTS inference with VRAM handshake, fail-open config, and
    streamed per-chunk progress.

    The wrapper runs via ``asyncio.create_subprocess_exec`` so progress lines
    stream to the callback in real time and :meth:`cancel` can terminate the
    process (releasing VRAM) instead of waiting out the timeout.
    """

    #: Declared VRAM cost (D7). Mirrors MIN_VRAM_FOR_VOICE in vram_manager.
    VRAM_BUDGET_MB = 2560

    def __init__(self, config: VoiceConfig | None = None) -> None:
        self.config = config or VoiceConfig.load()
        self._current_proc: asyncio.subprocess.Process | None = None
        self._cancelled = False

    # ------------------------------------------------------------------
    # Voice profiles
    # ------------------------------------------------------------------
    def list_voices(self) -> list[dict[str, Any]]:
        """Return registered voice profiles (voices/<id>/ with ref audio + transcript)."""
        voices: list[dict[str, Any]] = []
        if not self.config.voices_dir.is_dir():
            return voices
        for entry in sorted(self.config.voices_dir.iterdir()):
            if not entry.is_dir() or not _VOICE_ID_RE.match(entry.name):
                continue
            ref = self._find_ref_audio(entry)
            transcript = self._find_ref_text(entry)
            if ref is None or transcript is None:
                continue
            profile: dict[str, Any] = {"voice_id": entry.name}
            meta_file = entry / "profile.json"
            if meta_file.is_file():
                try:
                    profile.update(json.loads(meta_file.read_text(encoding="utf-8")))
                except (json.JSONDecodeError, OSError):
                    pass
            profile["ref_audio"] = str(ref)
            voices.append(profile)
        return voices

    def resolve_voice(
        self,
        voice_id: str | None = None,
        *,
        ref_audio_path: str | None = None,
        ref_text: str | None = None,
    ) -> tuple[Path, str]:
        """Resolve (ref_audio_path, ref_text) from a voice_id or explicit args.

        Exactly one source must be given: ``voice_id`` OR
        (``ref_audio_path`` + ``ref_text``). Raises VoiceSynthesisError with
        operator-facing guidance on bad input.
        """
        if voice_id:
            if not _VOICE_ID_RE.match(voice_id):
                raise VoiceSynthesisError(
                    f"Invalid voice_id {voice_id!r} -- use letters, digits, '-' or '_' (max 64)"
                )
            profile_dir = self.config.voices_dir / voice_id
            ref = self._find_ref_audio(profile_dir) if profile_dir.is_dir() else None
            text = self._find_ref_text(profile_dir) if profile_dir.is_dir() else None
            if ref is None or text is None:
                raise VoiceSynthesisError(
                    f"Voice profile '{voice_id}' is incomplete -- expected "
                    f"{profile_dir}/<ref audio.{'/'.join(sorted(_REF_AUDIO_EXTS))}> "
                    "and ref.txt (or profile.json with \"ref_text\")"
                )
            return ref, text
        if ref_audio_path and ref_text:
            ref = Path(ref_audio_path)
            if not ref.is_file():
                raise FileNotFoundError(f"Reference audio not found: {ref}")
            if ref.suffix.lower() not in _REF_AUDIO_EXTS:
                raise VoiceSynthesisError(
                    f"Unsupported reference audio type {ref.suffix!r} -- "
                    f"allowed: {', '.join(sorted(_REF_AUDIO_EXTS))}"
                )
            return ref, ref_text.strip()
        if ref_audio_path or ref_text:
            raise VoiceSynthesisError(
                "Provide both ref_audio_path and ref_text, or a voice_id"
            )
        raise VoiceSynthesisError("voice_id or (ref_audio_path + ref_text) is required")

    @staticmethod
    def _find_ref_audio(profile_dir: Path) -> Path | None:
        for ext in sorted(_REF_AUDIO_EXTS):
            cand = profile_dir / f"ref{ext}"
            if cand.is_file():
                return cand
        # Fallback: any media file named *ref* / *reference*
        for cand in sorted(profile_dir.iterdir()):
            if cand.suffix.lower() in _REF_AUDIO_EXTS and "ref" in cand.stem.lower():
                return cand
        return None

    @staticmethod
    def _find_ref_text(profile_dir: Path) -> str | None:
        for name in ("ref.txt", "ref_text.txt", "transcript.txt"):
            cand = profile_dir / name
            if cand.is_file():
                text = cand.read_text(encoding="utf-8").strip()
                if text:
                    return text
        meta = profile_dir / "profile.json"
        if meta.is_file():
            try:
                data = json.loads(meta.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                data = {}
            text = str(data.get("ref_text", "")).strip()
            if text:
                return text
        return None

    # ------------------------------------------------------------------
    # Preflight
    # ------------------------------------------------------------------
    def check_installation(self) -> dict[str, Any]:
        """Report what is present and what is missing. Never raises."""
        if self.config.mock:
            return {
                "installed": True,
                "mock": True,
                "python_found": Path(self.config.python_exe).is_file(),
                "wrapper_found": self.config.wrapper_script.is_file(),
                "voices_dir": str(self.config.voices_dir),
                "voices": [v["voice_id"] for v in self.list_voices()],
                "model": self.config.model,
                "hf_cache_dir": str(self.config.hf_cache_dir) if self.config.hf_cache_dir else None,
                "vram_budget_mb": self.config.vram_budget_mb,
                "missing": [],
                "message": "mock mode (dev-only: copies reference audio, no GPU)",
            }
        python_found = Path(self.config.python_exe).is_file()
        wrapper_found = self.config.wrapper_script.is_file()
        voices_found = self.config.voices_dir.is_dir()
        weights_found = self._weights_present()
        installed = python_found and wrapper_found and voices_found and weights_found
        missing: list[str] = []
        if not python_found:
            missing.append(f"python not found: {self.config.python_exe}")
        if not wrapper_found:
            missing.append(f"wrapper missing: {self.config.wrapper_script}")
        if not voices_found:
            missing.append(f"voices dir missing: {self.config.voices_dir}")
        if not weights_found:
            missing.append(
                f"F5-TTS weights not cached (expected under "
                f"{self.config.hf_cache_dir or 'HF cache'}; first run downloads ~1.4 GB)"
            )
        return {
            "installed": installed,
            "python_found": python_found,
            "wrapper_found": wrapper_found,
            "voices_found": voices_found,
            "weights_found": weights_found,
            "voices_dir": str(self.config.voices_dir),
            "voices": [v["voice_id"] for v in self.list_voices()],
            "model": self.config.model,
            "hf_cache_dir": str(self.config.hf_cache_dir) if self.config.hf_cache_dir else None,
            "vram_budget_mb": self.config.vram_budget_mb,
            "missing": missing,
            "message": "ready" if installed else "missing: " + "; ".join(missing),
        }

    def _weights_present(self) -> bool:
        """True when the F5-TTS checkpoint snapshot exists in the HF cache."""
        cache = self.config.hf_cache_dir
        if cache is None:
            return False
        hub = cache / "hub"
        if not hub.is_dir():
            return False
        for snap in hub.glob("models--SWivid--F5-TTS/snapshots/*/F5TTS_v1_Base"):
            if any(snap.glob("model_*.safetensors")) or any(snap.glob("model_*.pt")):
                return True
        # E2TTS / other model dirs still count as 'weights present'
        return any(hub.glob("models--SWivid--F5-TTS/snapshots/*"))

    def _require_ready(self) -> None:
        status = self.check_installation()
        if not status["installed"]:
            raise VoiceNotConfiguredError("F5-TTS is not ready: " + status["message"])

    # ------------------------------------------------------------------
    # Cancellation
    # ------------------------------------------------------------------
    def cancel(self) -> None:
        """Request cancellation; terminates the wrapper subprocess (VRAM freed)."""
        self._cancelled = True
        if self._current_proc is not None and self._current_proc.returncode is None:
            try:
                self._current_proc.terminate()
            except Exception:
                logger.debug("Failed to terminate F5-TTS subprocess", exc_info=True)

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
            raise VoiceCancelledError("voice synthesis cancelled by caller")

    # ------------------------------------------------------------------
    # Main entry
    # ------------------------------------------------------------------
    async def synthesize(
        self,
        text: str,
        output_path: str | Path,
        *,
        voice_id: str | None = None,
        ref_audio_path: str | None = None,
        ref_text: str | None = None,
        progress_cb: Callable[[float, str], Any] | None = None,
    ) -> dict[str, Any]:
        """Synthesize *text* in a cloned voice. Returns a result dict.

        Raises VoiceNotConfiguredError when the install is incomplete,
        VoiceSynthesisError for bad voice/text input, FileNotFoundError for
        missing files, RuntimeError when the model process fails,
        VoiceCancelledError when cancelled.
        """
        self._require_ready()
        out = Path(output_path)
        out.parent.mkdir(parents=True, exist_ok=True)

        ref_audio, ref_transcript = self.resolve_voice(
            voice_id, ref_audio_path=ref_audio_path, ref_text=ref_text
        )
        chunks = chunk_text(
            text,
            max_chunk_chars=self.config.max_chunk_chars,
            max_total_chars=self.config.max_total_chars,
        )

        def _note(p: float, m: str) -> None:
            if progress_cb:
                progress_cb(p, m)

        _note(0.05, f"resolved voice '{voice_id or 'custom'}'; {len(chunks)} chunk(s)")
        self._reset_cancel()
        self._check_cancelled()

        if self.config.mock:
            # Dev-only: copy the reference clip so the queue/poll/download
            # path is exercised end-to-end with no GPU.
            shutil.copyfile(ref_audio, out)
            _note(1.0, "mock synthesis complete")
            return {
                "success": True,
                "output_path": str(out),
                "voice_id": voice_id,
                "ref_audio": str(ref_audio),
                "chunks": len(chunks),
                "backend": "f5tts-mock",
                "sample_rate": None,
            }

        workdir = Path(tempfile.mkdtemp(prefix="f5tts_", dir=_scratch_dir()))
        try:
            chunks_file = workdir / "chunks.txt"
            chunks_file.write_text("\n".join(chunks), encoding="utf-8")

            argv = [
                self.config.python_exe,
                str(self.config.wrapper_script),
                "--ref-audio", str(ref_audio),
                "--ref-text", ref_transcript,
                "--text-file", str(chunks_file),
                "--output", str(out),
                "--model", self.config.model,
            ]
            if self.config.hf_cache_dir is not None:
                argv += ["--hf-cache", str(self.config.hf_cache_dir)]
            argv += self.config.extra_args

            # VRAM handshake (D7) -- offload Ollama/Atomic Chat when tight.
            _note(0.20, "VRAM preflight")
            begin = await vram_manager.begin_voice_synthesis(
                vram_budget_mb=self.config.vram_budget_mb
            )
            if not begin.get("success"):
                raise RuntimeError(
                    "Insufficient VRAM for voice synthesis: " + str(begin.get("error", "unknown"))
                )
            try:
                await self._run_wrapper(argv, progress_cb=_map_progress(_note))
            finally:
                await vram_manager.end_voice_synthesis()
        finally:
            shutil.rmtree(workdir, ignore_errors=True)

        _note(0.98, "verifying output")
        self._check_cancelled()
        if not out.is_file() or out.stat().st_size == 0:
            raise RuntimeError(f"F5-TTS produced no output at {out}")
        _note(1.0, "done")
        return {
            "success": True,
            "output_path": str(out),
            "voice_id": voice_id,
            "ref_audio": str(ref_audio),
            "chunks": len(chunks),
            "backend": "f5tts",
            "model": self.config.model,
        }

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------
    async def _run_wrapper(
        self,
        argv: list[str],
        *,
        progress_cb: Callable[[float, str], Any] | None,
    ) -> None:
        """Run the wrapper, streaming F5TTS_PROGRESS lines to the callback."""
        env = dict(os.environ)
        env["PYTHONUTF8"] = "1"
        env["PYTHONIOENCODING"] = "utf-8"
        self._reset_cancel()
        proc = await asyncio.create_subprocess_exec(
            *argv,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        self._current_proc = proc
        stderr_chunks: list[bytes] = []
        try:
            assert proc.stdout is not None and proc.stderr is not None
            while True:
                line = await proc.stdout.readline()
                if not line:
                    break
                text_line = line.decode("utf-8", errors="replace").rstrip()
                m = re.match(r"F5TTS_PROGRESS ([0-9.]+)\s*(.*)", text_line)
                if m and progress_cb is not None:
                    progress_cb(float(m.group(1)), m.group(2).strip())
            # Drain stderr concurrently-ish: read remaining after stdout EOF.
            stderr_data = await proc.stderr.read()
            stderr_chunks.append(stderr_data)
            rc = await proc.wait()
        except asyncio.CancelledError:
            self._terminate_proc(proc)
            raise
        finally:
            self._current_proc = None
        self._check_cancelled()
        if rc != 0:
            tail = b"".join(stderr_chunks).decode("utf-8", errors="replace")[-1200:]
            raise RuntimeError(f"F5-TTS inference failed (rc={rc}): {tail}")


def _map_progress(note: Callable[[float, str], None]) -> Callable[[float, str], None]:
    lo, hi = _INFER_BAND

    def _cb(frac: float, message: str) -> None:
        note(lo + min(max(frac, 0.0), 1.0) * (hi - lo), message)

    return _cb


def _scratch_dir() -> Path:
    """Writable temp dir for the chunks file (space-free preferred)."""
    for cand in (Path(r"C:\Users\Public\f5tts-tmp"), Path(r"D:\f5tts-tmp")):
        if " " not in str(cand):
            try:
                cand.mkdir(parents=True, exist_ok=True)
                return cand
            except OSError:
                continue
    return Path(tempfile.gettempdir())
