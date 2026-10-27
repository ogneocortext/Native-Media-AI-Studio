"""Audio source separation service using Demucs.

Separates audio into isolated stems (vocals, drums, bass, other) for
per-instrument visualization and analysis.

Requires: pip install demucs
Or for lighter weight: pip install spleeter
"""

import asyncio
import hashlib
import json
import logging
import re
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, ClassVar

from ..core.config import PROJECT_ROOT

logger = logging.getLogger(__name__)

SEPARATION_DIR = PROJECT_ROOT / "output" / "stems"
SEPARATION_DIR.mkdir(parents=True, exist_ok=True)

# Idempotency cache: identical (audio content + model + params) skips GPU.
# Cache key = sha256 of file bytes + model + shifts + segment_size + overlap.
CACHE_DIR = SEPARATION_DIR / ".cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# Telemetry: one JSONL record per separation job for "why is this slow"
# debugging (extends D8 metrics path).
TELEMETRY_DIR = PROJECT_ROOT / "output" / "logs"
TELEMETRY_DIR.mkdir(parents=True, exist_ok=True)
TELEMETRY_PATH = TELEMETRY_DIR / "stem-telemetry.json"

# Draft/deliverable presets: (model, shifts). Draft = fast, deliverable = high
# quality (~4x time). Make the cost visible in the UI like D9's estimator.
PRESETS: dict[str, tuple[str, int]] = {
    "draft": ("htdemucs", 1),
    "deliverable": ("htdemucs_ft", 2),
}

# Pre-separation normalization target (LUFS). Research shows quiet inputs
# underperform Demucs; normalizing to ~-14 LUFS before separation improves
# stem quality without changing the separation algorithm.
NORMALIZE_TARGET_LUFS = -14.0

STEM_NAMES = ("vocals", "drums", "bass", "other")

# demucs 4.1.0's --segment is in SECONDS, and each model family caps
# it at the segment length it was trained with: HTDemucs at 7.8 s
# (probed from the safetensors __metadata__.kwargs.segment of every
# htdemucs/htdemucs_ft/htdemucs_6s checkpoint), the MDX bags at the
# 44 s default their yaml ships. The frontend's UVR5-style
# "128/256/512" knob is in samples, so a raw 256 would be 256
# *seconds* -- far past the HTDemucs cap, which demucs rejects with
# "Cannot use a Transformer model with a longer segment than it was
# trained for" (demucs/apply.py). Clamp to the model's trained max.
# MDX-Net vocal models (UVR-MDX-NET-Voc_FT, Kim_Vocal_2) are absent:
# they are not in the demucs HF repo, so their cap is unknown and the
# value passes through for demucs itself to validate.
DEMUCS_MAX_SEGMENT_SECONDS: dict[str, float] = {
    "htdemucs": 7.8,
    "htdemucs_ft": 7.8,
    "htdemucs_6s": 7.8,
    "mdx_extra": 44.0,
    "mdx_extra_q": 44.0,
    "mdx": 44.0,
    "mdx_q": 44.0,
}


def clamp_segment_seconds(model: str, segment_size: int | None) -> int | None:
    """Clamp a demucs ``--segment`` value (seconds) to the model's max.

    Returns the clamped value, or ``None`` when no segment was
    requested. Unknown models pass through unchanged -- demucs itself
    validates those. ``--segment`` is ``type=int``, so a fractional
    cap (HTDemucs' 7.8) truncates to 7, which is still under the
    limit demucs checks (``segment > max_allowed_segment``).
    """
    if segment_size is None:
        return None
    max_segment = DEMUCS_MAX_SEGMENT_SECONDS.get(model)
    if max_segment is None:
        return segment_size
    clamped = int(min(segment_size, max_segment))
    if clamped != segment_size:
        logger.warning(
            "segment_size=%d s exceeds what %s was trained for (max %s s) -- capping to %d s",
            segment_size,
            model,
            max_segment,
            clamped,
        )
    return clamped


def compute_cache_key(
    audio_path: str, model: str, shifts: int, segment_size: int | None, overlap: float | None
) -> str:
    """Idempotency key for a separation request.

    Hash of the audio file bytes plus all separation parameters. Identical
    inputs always map to the same key, so a cache hit skips GPU entirely.
    Changing any parameter (model, shifts, segment_size, overlap) produces
    a different key and triggers a fresh separation.
    """
    h = hashlib.sha256()
    h.update(Path(audio_path).read_bytes())
    h.update(model.encode())
    h.update(str(shifts).encode())
    h.update(str(segment_size).encode())
    h.update(str(overlap).encode())
    return h.hexdigest()


def cache_dir_for_key(cache_key: str) -> Path:
    """Return the cache directory for a given idempotency key."""
    return CACHE_DIR / cache_key


def cached_stems_exist(cache_key: str) -> dict[str, str] | None:
    """Return cached stem paths if a complete cache entry exists, else None.

    A cache entry is complete when all four stems (vocals, drums, bass,
    other) exist as WAV files and a manifest.json is present.
    """
    d = cache_dir_for_key(cache_key)
    manifest = d / "manifest.json"
    if not manifest.exists():
        return None
    try:
        _ = json.loads(manifest.read_text())
    except (json.JSONDecodeError, OSError):
        return None
    stems: dict[str, str] = {}
    for name in STEM_NAMES:
        p = d / f"{name}.wav"
        if not p.exists():
            return None
        stems[name] = str(p)
    return stems


def write_cache_entry(
    cache_key: str,
    stems: dict[str, str],
    model: str,
    shifts: int,
    duration: float,
    seconds: float,
    device: str,
    normalized: bool,
) -> None:
    """Write a complete cache entry: stem WAVs + manifest.json."""
    d = cache_dir_for_key(cache_key)
    d.mkdir(parents=True, exist_ok=True)
    for name, path in stems.items():
        src = Path(path)
        dst = d / f"{name}.wav"
        if not dst.exists() and src.exists():
            import shutil as _shutil

            _shutil.copy2(src, dst)
    manifest = {
        "cache_key": cache_key,
        "model": model,
        "shifts": shifts,
        "duration": duration,
        "seconds": seconds,
        "device": device,
        "normalized": normalized,
        "stems": {name: str(d / f"{name}.wav") for name in STEM_NAMES},
    }
    (d / "manifest.json").write_text(json.dumps(manifest, indent=2))


def log_telemetry(
    cache_key: str,
    filename: str,
    model: str,
    shifts: int,
    seconds: float,
    device: str,
    cache_hit: bool,
    normalized: bool,
    error: str | None = None,
) -> None:
    """Append one JSON record to the stem telemetry log.

    Extends D8's metrics path so "why is this slow" is answerable from
    structured data: model, shifts, seconds, device, cache hit/miss.
    """
    record = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "cache_key": cache_key,
        "filename": Path(filename).name,
        "model": model,
        "shifts": shifts,
        "seconds": round(seconds, 2),
        "device": device,
        "cache_hit": cache_hit,
        "normalized": normalized,
        "error": error,
    }
    try:
        # Read existing, append, write back (JSON array, not JSONL, for
        # easy grep/gate consumption).
        existing: list[dict] = []
        if TELEMETRY_PATH.exists():
            try:
                existing = json.loads(TELEMETRY_PATH.read_text())
                if not isinstance(existing, list):
                    existing = []
            except (json.JSONDecodeError, OSError):
                existing = []
        existing.append(record)
        TELEMETRY_PATH.write_text(json.dumps(existing, indent=2))
    except OSError as exc:
        logger.debug("telemetry write failed: %s", exc)


async def normalize_audio_lufs(
    audio_path: str, target_lufs: float = NORMALIZE_TARGET_LUFS
) -> tuple[str, bool]:
    """Normalize *audio_path* to *target_lufs* using FFmpeg ebur128 + gain.

    Returns (normalized_path, did_normalize). On any failure returns the
    original path with did_normalize=False -- separation proceeds on the
    unnormalized input rather than failing.

    Quiet inputs underperform Demucs (research in the mastering doc), so a
    pre-separation normalize to ~-14 LUFS improves stem quality without
    changing the separation algorithm. The gain is computed from measured
    loudness (never asserted) and applied with ffmpeg -af volume.
    """
    import asyncio as _asyncio

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        logger.warning("ffmpeg not on PATH -- skipping pre-separation normalize")
        return audio_path, False

    from .ffmpeg_tools import compute_loudness

    loudness = await compute_loudness(audio_path)
    current_lufs = loudness.get("integrated_lufs")
    if current_lufs is None:
        logger.debug("could not measure loudness for %s -- skipping normalize", audio_path)
        return audio_path, False

    gain_db = target_lufs - current_lufs
    # Clamp to +/-12 dB to avoid runaway gain on silent or extreme tracks.
    gain_db = max(-12.0, min(12.0, gain_db))
    if abs(gain_db) < 0.25:
        # Within a quarter-LU of target -- no normalize needed.
        return audio_path, False

    out_path = Path(tempfile.gettempdir()) / (
        f"norm_{Path(audio_path).stem}_{abs(gain_db):.1f}dB.wav"
    )
    cmd = [
        ffmpeg,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(audio_path),
        "-af",
        f"volume={gain_db}dB",
        "-c:a",
        "pcm_f32le",
        str(out_path),
    ]
    try:
        proc = await _asyncio.to_thread(
            subprocess.run,
            cmd,
            capture_output=True,
            text=True,
            timeout=300,
        )
        if proc.returncode == 0 and out_path.exists() and out_path.stat().st_size > 0:
            logger.info(
                "Pre-separation normalize: %.1f dB -> target %.1f LUFS", gain_db, target_lufs
            )
            return str(out_path), True
        logger.warning("Normalize ffmpeg failed for %s: %s", audio_path, proc.stderr[-200:])
    except (OSError, subprocess.TimeoutExpired) as exc:
        logger.warning("Normalize failed for %s: %s", audio_path, exc)
    return audio_path, False


def find_stem_dir(filename: str) -> Path | None:
    """Locate the Demucs output dir for a library file, tolerating renames.

    Separation output dirs are created from the *source* filename at separation
    time (``output/stems/<model>/<track>/``), so hash prefixes (``85a406ef_...``),
    renames, and case/spacing differences all break an exact lookup. Resolve:
    exact -> normalized equality -> normalized containment (deterministic order).

    Checks all known model directories (mdx_extra_q first, then htdemucs) so
    existing stems remain discoverable after the default model change.

    Lives here rather than in the API layer because it is a pure path query over
    SEPARATION_DIR, which this module owns. It used to be
    ``api/audio_stems.py::_find_stem_dir``; ``services/stem_analysis.py`` had a
    thin wrapper that imported it back out of the API module, which is backwards
    layering and broke outright when the stem routes were split into their own
    module (ImportError -> HTTP 500 on /api/audio/stems-analysis).
    """
    base_dirs = [SEPARATION_DIR / m for m in SourceSeparator.SUPPORTED_MODELS]
    # Prefer newer models so a track separated with both returns the best one.
    base_dirs.sort(key=lambda p: p.name != "mdx_extra_q")

    stem = Path(filename).stem

    def norm(s: str) -> str:
        return re.sub(r"[^a-z0-9]", "", s.lower())

    stripped = re.sub(r"^([0-9a-f]{8}_)+", "", stem, flags=re.IGNORECASE)
    targets = {norm(stripped), norm(stem)} - {""}

    for base in base_dirs:
        exact = base / stem
        if exact.exists():
            return exact
        if not base.exists():
            continue
        try:
            dirs = sorted([d for d in base.iterdir() if d.is_dir()], key=lambda d: d.name)
        except OSError:
            continue
        for d in dirs:
            if norm(d.name) in targets:
                return d
        for d in dirs:
            dn = norm(d.name)
            if dn and any(t in dn or dn in t for t in targets):
                return d
    return None


def encode_wav_to_mp3(wav_path: Path, mp3_path: Path | None = None) -> Path | None:
    """Encode a stem WAV to MP3 (libmp3lame VBR ~190kbps, ~13% of WAV size).

    Returns the MP3 path on success, None if ffmpeg is unavailable or fails.
    """
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        logger.warning("ffmpeg not on PATH -- skipping MP3 encode for %s", wav_path)
        return None
    mp3_path = mp3_path or wav_path.with_suffix(".mp3")
    try:
        result = subprocess.run(
            [
                ffmpeg,
                "-y",
                "-i",
                str(wav_path),
                "-codec:a",
                "libmp3lame",
                "-q:a",
                "2",
                str(mp3_path),
            ],
            capture_output=True,
            timeout=300,
        )
    except (OSError, subprocess.TimeoutExpired) as e:
        logger.warning("MP3 encode failed for %s: %s", wav_path, e)
        return None
    if result.returncode == 0 and mp3_path.exists():
        return mp3_path
    logger.warning(
        "MP3 encode failed for %s: %s",
        wav_path,
        result.stderr.decode("utf-8", errors="replace")[-300:],
    )
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
    # demucs --segment, in SECONDS; clamped to the model's
    # trained max by clamp_segment_seconds.
    segment_size: int | None = None
    overlap: float | None = None  # 0..0.75, higher = slower/better
    denoise: bool | None = None  # accepted for API compat; demucs has no --denoise flag
    preset: str | None = None  # "draft" | "deliverable" overrides model+shifts
    shifts: int = 0  # demucs --shifts (0=draft-speed, 2=deliverable-quality)


@dataclass
class SeparationJob:
    """Async separation job (for queue)."""

    job_id: str
    audio_path: str
    options: SeparationOptions
    status: str = "queued"
    result: SeparationResult | None = None
    error: str | None = None
    # "single" (one-shot 4-stem) or "hierarchical" (vocal MDX-Net first, then
    # Demucs on the residual). Set by separate() before enqueueing; the worker
    # reads it to choose a backend. Hierarchical needs more GPU than single-pass,
    # which is why it must also go through the serialising worker.
    mode: str = "single"


class SourceSeparator:
    """Audio source separation using Demucs or Spleeter.

    Quality knobs:
      - ``segment_size``: demucs ``--segment``, in SECONDS.
        Smaller = less VRAM, more border artifacts. Clamped to
        the model's trained max (HTDemucs 7.8 s, MDX bags 44 s)
        -- see ``clamp_segment_seconds``.
      - ``overlap``: 0.25--0.75. Higher improves seam quality at 2x compute.
      - ``denoise``: accepted but ignored -- demucs has no denoise flag.

    Hierarchical mode (``mode="hierarchical"``):
      1. Run a dedicated vocal model (UVR-MDX-NET-Voc_FT / Kim_Vocal_2).
      2. Save vocals, keep instrumental residual.
      3. Run Demucs on residual for drums/bass/other.
      This kills the vocal bleed that plagues one-shot 4-stem runs on AI tracks.
    """

    # ClassVar: a read-only constant table. Left as a plain list, every access via
    # `self.SUPPORTED_MODELS.append(...)` would mutate it for the whole process,
    # since class attributes are shared rather than per-instance.
    SUPPORTED_MODELS: ClassVar[list[str]] = [
        "htdemucs",
        "htdemucs_ft",
        "htdemucs_6s",
        "mdx_extra",
        "mdx_extra_q",
        # MDX-Net vocal models (UVR5-style) -- lightweight on 8 GB VRAM
        "UVR-MDX-NET-Voc_FT",
        "Kim_Vocal_2",
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
        # In-memory job queue: 1070 Ti runs ~30--90 s per track
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
        if job.mode == "hierarchical":
            return await self._separate_hierarchical(job.audio_path, opts)
        if opts.model in ("UVR-MDX-NET-Voc_FT", "Kim_Vocal_2"):
            # MDX-Net vocal-only models: single stem (vocals / instrumental)
            return await self._separate_mdx_net(
                job.audio_path,
                opts.model,
                opts,
            )
        # Default: standard Demucs
        return await self._separate_demucs(
            job.audio_path,
            opts.model,
            self._detect_device(),
            SEPARATION_DIR,
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
                "torchaudio not importable on Windows -- Demucs decoding may fail. "
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
            options: Quality knobs (segment_size, overlap, denoise, preset, shifts).

        Returns:
            SeparationResult with paths to separated stems.

        M2 hardening:
          - ``preset`` ("draft"/"deliverable") overrides model+shifts.
          - Idempotency cache: identical (audio + model + params) skips GPU.
          - Pre-separation normalize to ~-14 LUFS improves Demucs on quiet inputs.
          - Telemetry logged per job (model/shifts/seconds/device/cache_hit).
        """
        options = options or SeparationOptions(model=model or self._model)
        model = options.model
        shifts = options.shifts

        # --- M2: preset mapping (draft/deliverable overrides model+shifts) ---
        if options.preset:
            if options.preset not in PRESETS:
                return SeparationResult(
                    audio_file=audio_path,
                    model=model,
                    stems={},
                    duration=0.0,
                    computed_at="",
                    error=f"Unknown preset: {options.preset}. Choose: {', '.join(sorted(PRESETS))}",
                )
            preset_model, preset_shifts = PRESETS[options.preset]
            model = preset_model
            shifts = preset_shifts
            options.model = model
            options.shifts = shifts

        # --- M2: idempotency cache check ---
        cache_key = compute_cache_key(
            audio_path,
            model,
            shifts,
            options.segment_size,
            options.overlap,
        )
        cached = cached_stems_exist(cache_key)
        if cached is not None:
            log_telemetry(
                cache_key,
                audio_path,
                model,
                shifts,
                0.0,
                self._detect_device(),
                cache_hit=True,
                normalized=False,
            )
            try:
                import librosa

                duration = librosa.get_duration(path=audio_path)
            except Exception:
                duration = 0.0
            logger.info(
                "Cache hit for %s (key=%s) -- skipping GPU", Path(audio_path).name, cache_key[:12]
            )
            stems_mp3 = await self._encode_mp3_stems(cached)
            return SeparationResult(
                audio_file=audio_path,
                model=model,
                stems=cached,
                duration=duration,
                computed_at=time.strftime("%Y-%m-%dT%H:%M:%S"),
                stems_mp3=stems_mp3,
            )

        # --- M2: pre-separation normalize to ~-14 LUFS ---
        normalize_start = time.perf_counter()
        norm_path, did_normalize = await normalize_audio_lufs(audio_path)
        normalize_seconds = time.perf_counter() - normalize_start

        # --- Run separation (through the serializing queue) ---
        start = time.perf_counter()
        if mode == "hierarchical":
            result = await self._run_through_queue(norm_path, options, mode="hierarchical")
        else:
            result = await self._run_through_queue(norm_path, options, mode="single")
        total_seconds = time.perf_counter() - start

        # --- M2: write cache entry on success ---
        if result.stems and not result.error:
            write_cache_entry(
                cache_key,
                result.stems,
                model,
                shifts,
                result.duration,
                total_seconds,
                self._detect_device(),
                normalized=did_normalize,
            )

        # --- M2: telemetry ---
        log_telemetry(
            cache_key,
            audio_path,
            model,
            shifts,
            total_seconds + normalize_seconds,
            self._detect_device(),
            cache_hit=False,
            normalized=did_normalize,
            error=result.error,
        )

        # Clean up the normalized temp file (cache entry already copied stems).
        if norm_path != audio_path:
            try:
                Path(norm_path).unlink(missing_ok=True)
            except OSError:
                pass

        return result

    async def _run_through_queue(
        self,
        audio_path: str,
        options: SeparationOptions,
        mode: str = "single",
    ) -> SeparationResult:
        """Run one separation as a queued job and wait for it to finish.

        All GPU work goes through here so the single worker in `_queue_worker`
        serialises it. Callers poll the job rather than streaming progress; the
        frontend polls `get_stems_status` / `get_job` for that.
        """
        job = self.enqueue(audio_path, options)
        job.mode = mode
        # Wait for completion -- frontend polls get_job for progress
        while job.status not in ("done", "error") and not job.result:
            await asyncio.sleep(0.5)
        if job.error:
            return SeparationResult(
                audio_file=audio_path,
                model=options.model,
                stems={},
                duration=0.0,
                computed_at="",
                error=job.error,
            )
        return job.result or SeparationResult(
            audio_file=audio_path,
            model=options.model,
            stems={},
            duration=0.0,
            computed_at="",
            error="job returned no result",
        )

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
        logger.info(
            "Hierarchical separation: step 1 vocal model=%s on %s",
            vocal_model,
            Path(audio_path).name,
        )

        # Step 1: extract vocals + instrumental with MDX-Net
        vocal_result = await self._separate_mdx_net(audio_path, vocal_model, opts)
        if vocal_result.error or not vocal_result.stems:
            return SeparationResult(
                audio_file=audio_path,
                model="hierarchical",
                stems={},
                duration=0.0,
                computed_at="",
                error=f"vocal extraction failed: {vocal_result.error}",
            )

        instrumental = vocal_result.stems.get("instrumental")
        vocals = vocal_result.stems.get("vocals")
        if not instrumental:
            return SeparationResult(
                audio_file=audio_path,
                model="hierarchical",
                stems={},
                duration=0.0,
                computed_at="",
                error="MDX-Net did not produce instrumental stem",
            )

        # Step 2: run Demucs on the instrumental residual for drums/bass/other
        logger.info("Hierarchical separation: step 2 Demucs on instrumental residual")
        demucs_model = (
            opts.model if opts.model not in ("UVR-MDX-NET-Voc_FT", "Kim_Vocal_2") else "mdx_extra_q"
        )
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
            audio_file=audio_path,
            model="hierarchical",
            stems=stems,
            duration=duration,
            computed_at=time.strftime("%Y-%m-%dT%H:%M:%S"),
            stems_mp3={},
        )

    async def _run_subprocess_async(
        self, cmd: list[str], timeout_s: int = 600
    ) -> tuple[int, bytes, bytes]:
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
                audio_file=audio_path,
                model=model,
                stems={},
                duration=0.0,
                computed_at="",
                error="demucs not found (required for MDX-Net models)",
            )
        device = self._detect_device()
        out_dir = SEPARATION_DIR / "mdx_net"
        out_dir.mkdir(parents=True, exist_ok=True)

        cmd = [
            *demucs,
            "-n",
            model,
            "-d",
            device,
            "-o",
            str(out_dir),
            audio_path,
        ]
        if opts.segment_size is not None:
            # demucs 4.1.0 renamed --segment_size to --segment;
            # clamp to the model's trained max (see
            # clamp_segment_seconds).
            cmd.extend(
                [
                    "--segment",
                    str(clamp_segment_seconds(model, opts.segment_size)),
                ]
            )
        if opts.denoise:
            # demucs has no --denoise flag in any 4.x release.
            logger.warning("denoise requested but demucs has no --denoise flag -- ignoring")

        try:
            returncode, stdout, stderr = await self._run_subprocess_async(cmd, timeout_s=600)
        except asyncio.TimeoutError:
            return SeparationResult(
                audio_file=audio_path,
                model=model,
                stems={},
                duration=0.0,
                computed_at="",
                error="MDX-Net timed out (10 min limit)",
            )

        if returncode != 0:
            return SeparationResult(
                audio_file=audio_path,
                model=model,
                stems={},
                duration=0.0,
                computed_at="",
                error=f"MDX-Net failed: {stderr.decode('utf-8', errors='replace')[:300]}",
            )

        stem_dir = out_dir / model / Path(audio_path).stem
        stems: dict[str, str] = {}
        for name in ("vocals", "instrumental"):
            p = stem_dir / f"{name}.wav"
            if p.exists():
                stems[name] = str(p)
        stems_mp3 = await self._encode_mp3_stems(stems)
        return SeparationResult(
            audio_file=audio_path,
            model=model,
            stems=stems,
            duration=0.0,
            computed_at=time.strftime("%Y-%m-%dT%H:%M:%S"),
            stems_mp3=stems_mp3,
        )

    async def _separate_demucs(
        self,
        audio_path: str,
        model: str,
        device: str,
        output_dir: Path,
        demucs_cmd: list[str],
        opts: SeparationOptions | None = None,
        source_path: str | None = None,
    ) -> SeparationResult:
        """Separate using Demucs (single-pass 4-stem or hierarchical residual).

        `source_path` is the file Demucs is actually pointed at. It differs from
        `audio_path` only in hierarchical mode, where step 2 separates the
        MDX-Net *instrumental residual* rather than the original track.

        It is a plain parameter rather than a `SeparationOptions` field on
        purpose: `SeparationOptions` is the user-facing quality-knob bag
        (model, segment_size, overlap, denoise) and this is an internal
        control-flow detail of the two-step algorithm. It previously lived on
        `opts`, where it was read as `opts.source_path` -- an attribute the
        dataclass never defined, so *every* Demucs run raised `AttributeError`
        and was swallowed into `error="'SeparationOptions' object has no
        attribute 'source_path'"`. The hierarchical caller meanwhile passed
        `source_path=` as a keyword the signature rejected, so that path raised
        `TypeError` before it could even reach the read.
        """
        opts = opts or SeparationOptions(model=model)
        try:
            self._validate_windows_soundfile()

            if self._detect_suno_track(audio_path):
                logger.info(
                    "Suno track detected (%s) -- model=%s shifts=%d",
                    Path(audio_path).name,
                    model,
                    self._shifts,
                )

            # Source for hierarchical mode: the instrumental residual from
            # MDX-Net, else the original track. This is the line that raised
            # AttributeError on every single-pass run -- see the docstring.
            source = source_path or audio_path
            cmd = [
                *demucs_cmd,
                "-n",
                model,
                "-d",
                device,
                "-o",
                str(output_dir),
                source,
            ]
            if self._shifts:
                cmd.extend(["--shifts", str(self._shifts)])
            if opts.segment_size is not None:
                # demucs 4.1.0 renamed --segment_size to --segment; the
                # old spelling is an unrecognized argument, so argparse
                # prints the usage text and exits 2 before separating.
                # --segment is in seconds and each model caps it at the
                # segment it was trained with, so clamp (a UVR5-style
                # 256 would otherwise be 256 seconds and trip the
                # HTDemucs 7.8 s cap).
                cmd.extend(
                    [
                        "--segment",
                        str(clamp_segment_seconds(model, opts.segment_size)),
                    ]
                )
            if opts.overlap is not None:
                cmd.extend(["--overlap", str(opts.overlap)])
            if opts.denoise:
                # demucs has no --denoise flag in any 4.x release; the
                # knob is accepted by the API but this backend cannot
                # honor it.
                logger.warning("denoise requested but demucs has no --denoise flag -- ignoring")

            try:
                returncode, stdout, stderr = await self._run_subprocess_async(cmd, timeout_s=600)
            except asyncio.TimeoutError:
                return SeparationResult(
                    audio_file=audio_path,
                    model=model,
                    stems={},
                    duration=0.0,
                    computed_at="",
                    error="Demucs timed out (10 min limit)",
                )

            if returncode != 0:
                return SeparationResult(
                    audio_file=audio_path,
                    model=model,
                    stems={},
                    duration=0.0,
                    computed_at="",
                    error=f"Demucs failed: {stderr.decode('utf-8', errors='replace').strip()[:500]}",
                )

            stem_dir = output_dir / model / Path(source).stem
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

            stems_mp3 = await self._encode_mp3_stems(stems)
            return SeparationResult(
                audio_file=audio_path,
                model=model,
                stems=stems,
                duration=duration,
                computed_at=time.strftime("%Y-%m-%dT%H:%M:%S"),
                stems_mp3=stems_mp3,
            )
        except asyncio.TimeoutError:
            return SeparationResult(
                audio_file=audio_path,
                model=model,
                stems={},
                duration=0.0,
                computed_at="",
                error="Demucs timed out (10 min limit)",
            )
        except Exception as e:
            return SeparationResult(
                audio_file=audio_path,
                model=model,
                stems={},
                duration=0.0,
                computed_at="",
                error=str(e),
            )

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
                "-p",
                "spleeter:4stems",
                "-o",
                str(output_dir),
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

    def analyze_stem_phase_mono(self, stem_path: str) -> dict[str, Any]:
        """Phase/mono compatibility check for a separated stem.

        Computes left/right phase correlation (Pearson) and mono-sum
        compatibility (energy of (L+R)/2 vs stereo energy). Returns
        phase_status ("ok"|"wide"|"inverted") and mono_status
        ("ok"|"risk"|"cancel") with human recommendations.

        Mono files report perfect scores with no issues possible.
        """
        try:
            import librosa
            import numpy as np

            y, sr = librosa.load(stem_path, sr=None, mono=False)

            if y.ndim == 1:
                return {
                    "file": stem_path,
                    "phase_correlation": 1.0,
                    "mono_compatibility": 1.0,
                    "phase_status": "ok",
                    "mono_status": "ok",
                    "channels": 1,
                    "sample_rate": sr,
                    "recommendations": ["Mono source -- no phase issues possible"],
                }

            left = y[0]
            right = y[1]

            # Phase correlation: Pearson correlation between L and R.
            l_mean = float(np.mean(left))
            r_mean = float(np.mean(right))
            l_centered = left - l_mean
            r_centered = right - r_mean
            denom = np.sqrt(
                np.dot(l_centered, l_centered) * np.dot(r_centered, r_centered)
            )
            correlation = float(np.dot(l_centered, r_centered) / (denom + 1e-10))
            correlation = float(np.clip(correlation, -1.0, 1.0))

            # Mono compatibility: energy of (L+R)/2 vs stereo energy.
            # 1.0 = perfect (no cancellation), 0.0 = total cancellation.
            mono = (left + right) / 2
            stereo_energy = float(np.sum(left**2 + right**2))
            mono_energy = float(np.sum(mono**2))
            if stereo_energy > 0:
                mono_compat = float(2.0 * mono_energy / stereo_energy)
                mono_compat = float(np.clip(mono_compat, 0.0, 1.0))
            else:
                mono_compat = 1.0

            # Status classifications.
            if correlation > 0.7:
                phase_status = "ok"
            elif correlation < -0.3:
                phase_status = "inverted"
            elif correlation > 0.3:
                phase_status = "wide"
            else:
                phase_status = "ok"

            if mono_compat > 0.8:
                mono_status = "ok"
            elif mono_compat > 0.5:
                mono_status = "risk"
            else:
                mono_status = "cancel"

            recommendations: list[str] = []
            if phase_status == "inverted":
                recommendations.append(
                    "Phase inverted between L/R -- check polarity"
                )
            elif phase_status == "wide":
                recommendations.append(
                    "Wide stereo image -- verify mono collapse"
                )
            if mono_status in ("risk", "cancel"):
                recommendations.append(
                    "Mono compatibility risk -- elements may cancel in mono"
                )
            if phase_status == "ok" and mono_status == "ok":
                recommendations.append(
                    "Phase and mono compatibility look good"
                )

            return {
                "file": stem_path,
                "phase_correlation": round(correlation, 3),
                "mono_compatibility": round(mono_compat, 3),
                "phase_status": phase_status,
                "mono_status": mono_status,
                "channels": 2,
                "sample_rate": sr,
                "recommendations": recommendations,
            }
        except Exception as e:
            return {"file": stem_path, "error": str(e)}


# Global instance
source_separator = SourceSeparator()
