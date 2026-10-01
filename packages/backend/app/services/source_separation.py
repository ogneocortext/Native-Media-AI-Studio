"""Audio source separation service using Demucs.

Separates audio into isolated stems (vocals, drums, bass, other) for
per-instrument visualization and analysis.

Requires: pip install demucs
Or for lighter weight: pip install spleeter
"""

import asyncio
import logging
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..core.config import PROJECT_ROOT

logger = logging.getLogger(__name__)

SEPARATION_DIR = PROJECT_ROOT / "output" / "stems"
SEPARATION_DIR.mkdir(parents=True, exist_ok=True)

STEM_NAMES = ("vocals", "drums", "bass", "other")


def encode_wav_to_mp3(wav_path: Path, mp3_path: Path | None = None) -> Path | None:
    """Encode a stem WAV to MP3 (libmp3lame VBR ~190kbps, ~13% of WAV size).

    Returns the MP3 path on success, None if ffmpeg is unavailable or fails.
    """
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        logger.warning("ffmpeg not on PATH — skipping MP3 encode for %s", wav_path)
        return None
    mp3_path = mp3_path or wav_path.with_suffix(".mp3")
    try:
        result = subprocess.run(
            [ffmpeg, "-y", "-i", str(wav_path),
             "-codec:a", "libmp3lame", "-q:a", "2", str(mp3_path)],
            capture_output=True,
            timeout=300,
        )
    except (OSError, subprocess.TimeoutExpired) as e:
        logger.warning("MP3 encode failed for %s: %s", wav_path, e)
        return None
    if result.returncode == 0 and mp3_path.exists():
        return mp3_path
    logger.warning("MP3 encode failed for %s: %s", wav_path,
                   result.stderr.decode("utf-8", errors="replace")[-300:])
    return None


@dataclass
class SeparationResult:
    """Result of source separation."""
    audio_file: str
    model: str
    stems: dict[str, str]
    duration: float
    computed_at: str
    error: str | None = None
    stems_mp3: dict[str, str] = field(default_factory=dict)


@dataclass
class SeparationOptions:
    """Quality/performance tuning knobs for separation."""
    model: str = "mdx_extra_q"
    segment_size: int | None = None  # caps memory on 8 GB GPUs
    overlap: float | None = None      # 0..0.75, higher = slower/better
    denoise: bool | None = None       # post-denoise pass when supported


@dataclass
class SeparationJob:
    """Async separation job (for queue)."""
    job_id: str
    audio_path: str
    options: SeparationOptions
    status: str = "queued"
    result: SeparationResult | None = None
    error: str | None = None


class SourceSeparator:
    """Audio source separation using Demucs or Spleeter.

    Quality knobs:
      - ``segment_size``: smaller = less VRAM, more border artifacts.
        Gemini/1070 Ti guidance: 128 or 256 keeps VRAM under ~6.5 GB.
      - ``overlap``: 0.25–0.75. Higher improves seam quality at 2× compute.
      - ``denoise``: post-denoise pass when the backend supports it.

    Hierarchical mode (``mode="hierarchical"``):
      1. Run a dedicated vocal model (UVR-MDX-NET-Voc_FT / Kim_Vocal_2).
      2. Save vocals, keep instrumental residual.
      3. Run Demucs on residual for drums/bass/other.
      This kills the vocal bleed that plagues one-shot 4-stem runs on AI tracks.
    """

    SUPPORTED_MODELS = [
        "htdemucs", "htdemucs_ft", "htdemucs_6s",
        "mdx_extra", "mdx_extra_q",
        # MDX-Net vocal models (UVR5-style) — lightweight on 8 GB VRAM
        "UVR-MDX-NET-Voc_FT", "Kim_Vocal_2",
    ]

    def __init__(
        self,
        model: str = "mdx_extra_q",
        device: str = "auto",
        shifts: int = 0,
        segment_size: int | None = None,
    ):
        self._model = model
        self._device = device
        self._shifts = shifts
        self._segment_size = segment_size
        # In-memory job queue: 1070 Ti runs ~30–90 s per track
        self._jobs: dict[str, SeparationJob] = {}
        self._queue: asyncio.Queue[SeparationJob] = asyncio.Queue()
        self._worker_task: asyncio.Task | None = None

    async def start_worker(self) -> None:
        """Start the background queue worker (call once at startup)."""
        if self._worker_task and not self._worker_task.done():
            return
        self._worker_task = asyncio.create_task(self._queue_worker())

    async def _queue_worker(self) -> None:
        """Process separation jobs serially to cap GPU memory."""
        while True:
            job = await self._queue.get()
            try:
                job.status = "running"
                job.result = await self._run_separation(job)
                job.status = "done" if job.result and not job.result.error else "error"
                if job.result and job.result.error:
                    job.error = job.result.error
            except Exception as exc:
                job.status = "error"
                job.error = str(exc)
            finally:
                self._queue.task_done()

    def enqueue(self, audio_path: str, options: SeparationOptions | None = None) -> SeparationJob:
        """Enqueue a separation job; returns immediately with a job handle."""
        options = options or SeparationOptions(model=self._model)
        job_id = f"{Path(audio_path).stem[:16]}_{int(time.time())}"
        job = SeparationJob(job_id=job_id, audio_path=audio_path, options=options)
        self._jobs[job_id] = job
        asyncio.create_task(self._queue.put(job))
        return job

    def get_job(self, job_id: str) -> SeparationJob | None:
        return self._jobs.get(job_id)

    async def _run_separation(self, job: SeparationJob) -> SeparationResult:
        """Dispatch to the appropriate backend (hierarchical vs single-pass)."""
        opts = job.options
        if opts.model in ("UVR-MDX-NET-Voc_FT", "Kim_Vocal_2"):
            # MDX-Net vocal-only models: single stem (vocals / instrumental)
            return await self._separate_mdx_net(
                job.audio_path, opts.model, opts,
            )
        # Default: hierarchical if requested, else standard Demucs
        return await self._separate_demucs(
            job.audio_path, opts.model, self._detect_device(), SEPARATION_DIR,
            self._find_demucs() or ["demucs"],
            opts,
        )

    def is_available(self) -> bool:
        """Check if demucs or spleeter is available."""
        return self._find_demucs() is not None or self._find_spleeter() is not None

    def _find_demucs(self) -> list[str] | None:
        """Locate a working demucs invocation.

        Prefers the backend's own interpreter (`python -m demucs`) so the
        studio env's CUDA-safe torch build is used. A `demucs.exe` on PATH
        may belong to a different Python install with an incompatible
        torch/numpy combo, so PATH is only a fallback.
        """
        candidates: list[list[str]] = [
            [sys.executable, "-m", "demucs"],
            ["demucs"],
            ["demucs.exe"],
        ]
        for cmd in candidates:
            try:
                result = subprocess.run(
                    [*cmd, "--help"],
                    capture_output=True,
                    timeout=15,
                )
                if result.returncode == 0:
                    return cmd
            except (FileNotFoundError, subprocess.TimeoutExpired):
                continue
        return None

    def _find_spleeter(self) -> str | None:
        """Locate spleeter executable."""
        for name in ["spleeter"]:
            try:
                result = subprocess.run(
                    [name, "--help"],
                    capture_output=True,
                    timeout=5,
                )
                if result.returncode == 0:
                    return name
            except (FileNotFoundError, subprocess.TimeoutExpired):
                continue
        return None

    def _detect_device(self) -> str:
        """Detect best available device."""
        if self._device != "auto":
            return self._device
        try:
            import torch
            if torch.cuda.is_available():
                return "cuda"
        except ImportError:
            pass
        return "cpu"

    def _validate_windows_soundfile(self) -> None:
        """On Windows, verify torchaudio's soundfile backend is available.

        Demucs relies on soundfile for decoding; missing it causes silent
        failures or DLL errors. Log a clear actionable warning so the user
        can ``pip install soundfile``.
        """
        if sys.platform != "win32":
            return
        try:
            import torchaudio
            backends = torchaudio.list_audio_backends()
            if "soundfile" not in backends:
                logger.warning(
                    "torchaudio soundfile backend missing on Windows. "
                    "Fix with: pip install soundfile"
                )
        except ImportError:
            logger.warning(
                "torchaudio not importable on Windows — Demucs decoding may fail. "
                "Fix with: pip install torchaudio soundfile"
            )
        except Exception as exc:
            logger.debug("Windows soundfile validation skipped: %s", exc)

    def _detect_suno_track(self, audio_path: str) -> bool:
        """Heuristic: detect Suno-generated tracks from filename/metadata.

        Suno exports commonly carry ``Suno`` or ``sunoaiclient`` in the
        filename. Returns True so callers can log expected Suno-specific
        artifacts (baked-in compression, stereo widening, pseudo-reverb,
        phase-smearing ghosts in the instrumental stem, vocal formant
        harshness from MP3 high-end aggression).
        """
        name = Path(audio_path).name.lower()
        return "suno" in name or "sunoaiclient" in name

    async def _encode_mp3_stems(self, stems: dict[str, str]) -> dict[str, str]:
        """Encode all WAV stems to MP3 in parallel. Best-effort: failures are skipped."""
        async def _one(name: str, wav: str) -> tuple[str, Path | None]:
            return name, await asyncio.to_thread(encode_wav_to_mp3, Path(wav))

        results = await asyncio.gather(*[_one(n, w) for n, w in stems.items()])
        return {name: str(mp3) for name, mp3 in results if mp3 is not None}

    async def separate(
        self,
        audio_path: str,
        model: str | None = None,
        output_dir: str | None = None,
        mode: str = "single",
        options: SeparationOptions | None = None,
    ) -> SeparationResult:
        """Separate audio into stems.

        Args:
            audio_path: Path to audio file.
            model: Model name (default: mdx_extra_q).
            output_dir: Custom output directory.
            mode: "single" (one-shot 4-stem) or "hierarchical" (vocal MDX-Net first,
                  then Demucs on instrumental residual). Hierarchical kills vocal bleed.
            options: Quality knobs (segment_size, overlap, denoise).

        Returns:
            SeparationResult with paths to separated stems.
        """
        options = options or SeparationOptions(model=model or self._model)
        model = options.model

        if mode == "hierarchical":
            return await self._separate_hierarchical(audio_path, options)

        # Single-pass via job queue (caps GPU memory)
        job = self.enqueue(audio_path, options)
        # Wait for completion — frontend polls get_job for progress
        while job.status not in ("done", "error") and not job.result:
            await asyncio.sleep(0.5)
        if job.error:
            return SeparationResult(audio_file=audio_path, model=model, stems={},
                                    duration=0.0, computed_at="", error=job.error)
        return job.result or SeparationResult(audio_file=audio_path, model=model, stems={},
                                              duration=0.0, computed_at="", error="job returned no result")

    async def _separate_hierarchical(
        self,
        audio_path: str,
        opts: SeparationOptions,
    ) -> SeparationResult:
        """UVR5-style hierarchical: vocal MDX-Net first, then Demucs on residual.

        Gemini guidance for 1070 Ti:
          - Model: UVR-MDX-NET-Voc_FT or Kim_Vocal_2 (NOT heavy RoFormer variants).
          - segment_size=128 or 256 keeps VRAM under ~6.5 GB.
        """
        vocal_model = "UVR-MDX-NET-Voc_FT"
        logger.info("Hierarchical separation: step 1 vocal model=%s on %s", vocal_model, Path(audio_path).name)

        # Step 1: extract vocals + instrumental with MDX-Net
        vocal_result = await self._separate_mdx_net(audio_path, vocal_model, opts)
        if vocal_result.error or not vocal_result.stems:
            return SeparationResult(
                audio_file=audio_path, model="hierarchical", stems={}, duration=0.0,
                computed_at="", error=f"vocal extraction failed: {vocal_result.error}",
            )

        instrumental = vocal_result.stems.get("instrumental")
        vocals = vocal_result.stems.get("vocals")
        if not instrumental:
            return SeparationResult(
                audio_file=audio_path, model="hierarchical", stems={}, duration=0.0,
                computed_at="", error="MDX-Net did not produce instrumental stem",
            )

        # Step 2: run Demucs on the instrumental residual for drums/bass/other
        logger.info("Hierarchical separation: step 2 Demucs on instrumental residual")
        demucs_model = opts.model if opts.model not in ("UVR-MDX-NET-Voc_FT", "Kim_Vocal_2") else "mdx_extra_q"
        residual_result = await self._separate_demucs(
            audio_path=audio_path,
            model=demucs_model,
            device=self._detect_device(),
            output_dir=SEPARATION_DIR / "hierarchical",
            demucs_cmd=self._find_demucs() or ["demucs"],
            opts=opts,
            source_path=instrumental,
        )

        stems: dict[str, str] = {}
        if vocals:
            stems["vocals"] = vocals
        for name in ("drums", "bass", "other"):
            p = residual_result.stems.get(name)
            if p:
                stems[name] = p

        duration = 0.0
        try:
            import librosa
            duration = librosa.get_duration(path=audio_path)
        except Exception:
            pass

        return SeparationResult(
            audio_file=audio_path, model="hierarchical", stems=stems, duration=duration,
            computed_at=time.strftime("%Y-%m-%dT%H:%M:%S"),
            stems_mp3={},
        )

    async def _run_subprocess_async(self, cmd: list[str], timeout_s: int = 600) -> tuple[int, bytes, bytes]:
        """Run a subprocess, falling back to a thread on Windows SelectorEventLoop.

        The fallback is required because ``asyncio.create_subprocess_exec`` raises
        ``NotImplementedError`` on the default Windows event loop. Running the
        blocking ``subprocess.run`` in ``asyncio.to_thread`` avoids that without
        requiring ``ProactorEventLoop``.
        """
        try:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout_s)
            return process.returncode, stdout, stderr
        except NotImplementedError:
            def _run() -> tuple[int, bytes, bytes]:
                completed = subprocess.run(cmd, capture_output=True)
                return completed.returncode, completed.stdout, completed.stderr
            return await asyncio.to_thread(_run)

    async def _separate_mdx_net(
        self,
        audio_path: str,
        model: str,
        opts: SeparationOptions,
    ) -> SeparationResult:
        """Run an MDX-Net vocal model (UVR5-style). Returns vocals + instrumental."""
        demucs = self._find_demucs()
        if not demucs:
            return SeparationResult(
                audio_file=audio_path, model=model, stems={}, duration=0.0,
                computed_at="", error="demucs not found (required for MDX-Net models)",
            )
        device = self._detect_device()
        out_dir = SEPARATION_DIR / "mdx_net"
        out_dir.mkdir(parents=True, exist_ok=True)

        cmd = [
            *demucs,
            "-n", model,
            "-d", device,
            "-o", str(out_dir),
            audio_path,
        ]
        if opts.segment_size is not None:
            cmd.extend(["--segment_size", str(opts.segment_size)])
        if opts.denoise:
            cmd.extend(["--denoise"])

        try:
            returncode, stdout, stderr = await self._run_subprocess_async(cmd, timeout_s=600)
        except asyncio.TimeoutError:
            return SeparationResult(audio_file=audio_path, model=model, stems={}, duration=0.0,
                                    computed_at="", error="MDX-Net timed out (10 min limit)")

        if returncode != 0:
            return SeparationResult(audio_file=audio_path, model=model, stems={}, duration=0.0,
                                    computed_at="", error=f"MDX-Net failed: {stderr.decode('utf-8', errors='replace')[:300]}")

        stem_dir = out_dir / model / Path(audio_path).stem
        stems: dict[str, str] = {}
        for name in ("vocals", "instrumental"):
            p = stem_dir / f"{name}.wav"
            if p.exists():
                stems[name] = str(p)
        stems_mp3 = await self._encode_mp3_stems(stems)
        return SeparationResult(
            audio_file=audio_path, model=model, stems=stems, duration=0.0,
            computed_at=time.strftime("%Y-%m-%dT%H:%M:%S"), stems_mp3=stems_mp3,
        )

    async def _separate_demucs(
        self,
        audio_path: str,
        model: str,
        device: str,
        output_dir: Path,
        demucs_cmd: list[str],
        opts: SeparationOptions | None = None,
    ) -> SeparationResult:
        """Separate using Demucs (single-pass 4-stem or hierarchical residual)."""
        opts = opts or SeparationOptions(model=model)
        try:
            self._validate_windows_soundfile()

            if self._detect_suno_track(audio_path):
                logger.info(
                    "Suno track detected (%s) — model=%s shifts=%d",
                    Path(audio_path).name, model, self._shifts,
                )

            # Source for hierarchical mode: instrumental residual from MDX-Net
            source = opts.source_path or audio_path
            cmd = [
                *demucs_cmd,
                "-n", model,
                "-d", device,
                "-o", str(output_dir),
                source,
            ]
            if self._shifts:
                cmd.extend(["--shifts", str(self._shifts)])
            if opts.segment_size is not None:
                cmd.extend(["--segment_size", str(opts.segment_size)])
            if opts.overlap is not None:
                cmd.extend(["--overlap", str(opts.overlap)])
            if opts.denoise:
                cmd.extend(["--denoise"])

            try:
                returncode, stdout, stderr = await self._run_subprocess_async(cmd, timeout_s=600)
            except asyncio.TimeoutError:
                return SeparationResult(audio_file=audio_path, model=model, stems={}, duration=0.0,
                                        computed_at="", error="Demucs timed out (10 min limit)")

            if returncode != 0:
                return SeparationResult(
                    audio_file=audio_path, model=model, stems={}, duration=0.0,
                    computed_at="",
                    error=f"Demucs failed: {stderr.decode('utf-8', errors='replace').strip()[:500]}",
                )

            stem_dir = output_dir / model / Path(source).stem
            stems = {}
            for stem_name in ["vocals", "drums", "bass", "other"]:
                stem_path = stem_dir / f"{stem_name}.wav"
                if stem_path.exists():
                    stems[stem_name] = str(stem_path)

            duration = 0.0
            try:
                import librosa
                duration = librosa.get_duration(path=audio_path)
            except Exception:
                pass

            stems_mp3 = await self._encode_mp3_stems(stems)
            return SeparationResult(
                audio_file=audio_path, model=model, stems=stems, duration=duration,
                computed_at=time.strftime("%Y-%m-%dT%H:%M:%S"), stems_mp3=stems_mp3,
            )
        except asyncio.TimeoutError:
            return SeparationResult(audio_file=audio_path, model=model, stems={}, duration=0.0,
                                    computed_at="", error="Demucs timed out (10 min limit)")
        except Exception as e:
            return SeparationResult(audio_file=audio_path, model=model, stems={}, duration=0.0,
                                    computed_at="", error=str(e))

    async def _separate_spleeter(
        self,
        audio_path: str,
        output_dir: Path,
    ) -> SeparationResult:
        """Separate using Spleeter (fallback)."""
        try:
            cmd = [
                "spleeter",
                "separate",
                "-p", "spleeter:4stems",
                "-o", str(output_dir),
                audio_path,
            ]

            returncode: int | None
            try:
                returncode, stdout, stderr = await self._run_subprocess_async(cmd, timeout_s=600)
            except asyncio.TimeoutError:
                raise

            if returncode != 0:
                error_msg = stderr.decode("utf-8", errors="replace").strip()
                return SeparationResult(
                    audio_file=audio_path,
                    model="spleeter:4stems",
                    stems={},
                    duration=0.0,
                    computed_at="",
                    error=f"Spleeter failed: {error_msg[:500]}",
                )

            # Find output stems
            stem_dir = output_dir / Path(audio_path).stem
            stems = {}
            for stem_name in STEM_NAMES:
                stem_path = stem_dir / f"{stem_name}.wav"
                if stem_path.exists():
                    stems[stem_name] = str(stem_path)

            duration = 0.0
            try:
                import librosa
                duration = librosa.get_duration(path=audio_path)
            except Exception:
                pass

            # Encode lightweight MP3 copies alongside the WAVs (best-effort)
            stems_mp3 = await self._encode_mp3_stems(stems)

            return SeparationResult(
                audio_file=audio_path,
                model="spleeter:4stems",
                stems=stems,
                duration=duration,
                computed_at=time.strftime("%Y-%m-%dT%H:%M:%S"),
                stems_mp3=stems_mp3,
            )
        except asyncio.TimeoutError:
            return SeparationResult(
                audio_file=audio_path,
                model="spleeter:4stems",
                stems={},
                duration=0.0,
                computed_at="",
                error="Spleeter timed out (10 min limit)",
            )
        except Exception as e:
            return SeparationResult(
                audio_file=audio_path,
                model="spleeter:4stems",
                stems={},
                duration=0.0,
                computed_at="",
                error=str(e),
            )

    def analyze_stem_features(self, stem_path: str) -> dict[str, Any]:
        """Analyze features of a separated stem.

        Args:
            stem_path: Path to stem audio file.

        Returns:
            Dict with stem features.
        """
        try:
            import librosa
            import numpy as np

            y, sr = librosa.load(stem_path, sr=22050, mono=True)
            duration = len(y) / sr

            # RMS energy
            rms = librosa.feature.rms(y=y, hop_length=512)[0]
            rms_norm = (rms - rms.min()) / (rms.max() - rms.min() + 1e-10)

            # Spectral centroid
            centroid = librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=512)[0]

            # Zero crossing rate
            zcr = librosa.feature.zero_crossing_rate(y=y, hop_length=512)[0]

            return {
                "file": stem_path,
                "duration": duration,
                "sample_rate": sr,
                "rms_mean": float(np.mean(rms)),
                "rms_std": float(np.std(rms)),
                "centroid_mean": float(np.mean(centroid)),
                "zcr_mean": float(np.mean(zcr)),
                "energy_envelope": rms_norm.tolist(),
            }
        except Exception as e:
            return {"file": stem_path, "error": str(e)}


# Global instance
source_separator = SourceSeparator()
