"""Shared audio analysis helpers for Native Media AI Studio tools.

Provides a single source of truth for:
- Loading audio with librosa
- Beat tracking (librosa + optional CUDA stream overlap)
- Converting beat times to frame keyframes
- Saving beat data to JSON

This module is intentionally backend-agnostic at import time.
When torch/app.services.cuda are unavailable it falls back to CPU-only
librosa analysis.  Pass ``use_gpu=False`` to skip the GPU probe entirely.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import threading
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Optional CUDA backend probe (resolved once at import time)
# ---------------------------------------------------------------------------

_CUDA_AVAILABLE = False
_GPU_IMPORT_ERROR: str | None = None

try:
    from app.services.cuda import cuda_audio, cuda_available  # type: ignore[import]
    if cuda_available():
        # Probe: surfaces a broken torch install here instead of mid-analysis.
        import torch  # noqa: F401  # type: ignore[import]
        _CUDA_AVAILABLE = True
except Exception as _exc:  # pragma: no cover - environment dependent
    _GPU_IMPORT_ERROR = str(_exc)


def _log_gpu_status() -> None:
    if _CUDA_AVAILABLE:
        logger.debug("CUDA backend detected")
    elif _GPU_IMPORT_ERROR is not None:
        logger.debug("CUDA backend unavailable: %s", _GPU_IMPORT_ERROR)
    else:
        logger.debug("CUDA backend not configured")


# ---------------------------------------------------------------------------
# Low-level helpers
# ---------------------------------------------------------------------------

def load_audio(audio_path: str | Path, sr: int | None = 22050):
    """Load an audio file with librosa.

    Falls back to ffmpeg for formats librosa/soundfile cannot decode
    (e.g. .m4a on platforms where libsndfile lacks MP4 support).

    Returns:
        Tuple of (y, sr).

    Raises:
        FileNotFoundError: If the file does not exist.
        Exception: Propagated from librosa.load or ffmpeg fallback.
    """
    import librosa
    p = Path(audio_path)
    if not p.exists():
        raise FileNotFoundError(f"Audio file not found: {p}")
    try:
        return librosa.load(str(p), sr=sr, mono=True)
    except Exception as exc:
        # Fallback: transcode through ffmpeg when librosa cannot decode the
        # container/codec (common for .m4a on Windows where libsndfile lacks
        # MP4 support).
        suffix = p.suffix.lower()
        if suffix not in {".m4a", ".mp4", ".aac"}:
            raise
        import subprocess
        import tempfile
        ffmpeg = shutil.which("ffmpeg") or shutil.which("ffmpeg.exe")
        if not ffmpeg:
            raise RuntimeError(f"librosa failed to decode {suffix} and ffmpeg is not available") from exc
        # Unique temp name: concurrent analyses of the same track must not
        # clobber each other's intermediate file.
        handle, tmp_name = tempfile.mkstemp(prefix="kilo_audio_", suffix=".wav")
        os.close(handle)
        tmp = Path(tmp_name)
        # Build the argument list explicitly — a previous `insert(-2, ...)`
        # approach produced `-ac -ar <sr> 2` and ffmpeg rejected the file.
        cmd = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-i", str(p)]
        if sr is not None:
            cmd += ["-ar", str(sr)]
        cmd += ["-ac", "1", str(tmp)]
        try:
            subprocess.run(cmd, encoding="utf-8", errors="replace", check=True, capture_output=True, text=True)
            return librosa.load(str(tmp), sr=sr, mono=True)
        finally:
            tmp.unlink(missing_ok=True)


def _beat_onset_envelope(y, sr, hop_length: int = 512):
    """Superflux-style onset envelope built from the percussive component.

    Beat tracking is only as good as its onset envelope. The envelope
    ``beat_track`` builds internally runs on the full mix, so harmonic
    content (pads, sliding 808s) smears the drum transients the tracker is
    trying to lock onto. HPSS isolates the percussive stream first, and
    lag=2 / max_size=3 (the superflux settings) suppress vibrato and
    sustained-note false onsets.
    """
    import librosa

    y_perc = librosa.effects.percussive(y)
    return librosa.onset.onset_strength(
        y=y_perc,
        sr=sr,
        hop_length=hop_length,
        lag=2,
        max_size=3,
        fmin=27.5,
        fmax=16000.0,
    )


def _estimate_tempo(onset_envelope, sr, hop_length: int = 512, seed_bpm: float = 120.0) -> float:
    """Two-pass tempo: estimate from the onset envelope before tracking.

    A fixed 120 BPM prior biases the dynamic-programming tracker toward
    120 and its octaves on tracks that sit far from it. Estimating the
    tempo from the same envelope the tracker will consume, then feeding
    it back as ``start_bpm``, removes most octave errors up front.
    """
    import librosa
    import numpy as np

    est = librosa.feature.tempo(
        onset_envelope=onset_envelope,
        sr=sr,
        hop_length=hop_length,
        start_bpm=seed_bpm,
        aggregate=np.median,
    )
    val = float(np.atleast_1d(est).flat[0]) if est is not None else 0.0
    return val if 30.0 <= val <= 300.0 else seed_bpm


def analyze_beats(y, sr, *, use_gpu: bool = True, start_bpm: float | None = None, tightness: float = 100.0) -> dict[str, Any]:
    """Run beat tracking, optionally overlapping GPU analysis.

    Args:
        y: Audio time series.
        sr: Sample rate.
        use_gpu: If True, attempt CUDA-accelerated analysis.
        start_bpm: Tempo prior for the beat tracker. ``None`` (default)
            estimates the tempo from the onset envelope first (two-pass);
            an explicit value is used as given.
        tightness: Beat distribution tightness around tempo (default 100).

    Returns:
        Dict with keys: tempo, beat_times, duration, gpu_result,
        start_bpm_used.
    """
    import librosa

    hop_length = 512

    # Build the envelope + tempo prior once; both the GPU-overlap and CPU
    # paths consume the same inputs. Any failure here falls back to the
    # legacy behaviour (beat_track's internal envelope, 120 BPM prior) —
    # a degraded grid beats a failed analysis.
    onset_envelope = None
    prior_bpm = start_bpm if start_bpm is not None else 120.0
    try:
        onset_envelope = _beat_onset_envelope(y, sr, hop_length)
        if start_bpm is None:
            prior_bpm = _estimate_tempo(onset_envelope, sr, hop_length)
    except Exception as exc:
        logger.debug("Onset-envelope pre-pass failed, using legacy beat_track inputs: %s", exc)
        onset_envelope = None
        prior_bpm = start_bpm if start_bpm is not None else 120.0

    def _track():
        if onset_envelope is not None:
            return librosa.beat.beat_track(
                onset_envelope=onset_envelope,
                sr=sr,
                hop_length=hop_length,
                start_bpm=prior_bpm,
                tightness=tightness,
            )
        return librosa.beat.beat_track(
            y=y, sr=sr, hop_length=hop_length, start_bpm=prior_bpm, tightness=tightness
        )

    gpu_result = None

    if use_gpu and _CUDA_AVAILABLE:
        try:
            import torch
            gpu_stream = torch.cuda.Stream()
            result_holder: dict[str, Any] = {}

            def _gpu_worker():
                with torch.cuda.stream(gpu_stream):
                    result_holder["data"] = cuda_audio.analyze(y)

            gpu_thread = threading.Thread(target=_gpu_worker)
            gpu_thread.start()

            tempo, beats = _track()
            beat_times = librosa.frames_to_time(beats, sr=sr, hop_length=hop_length).tolist()

            gpu_thread.join()
            gpu_stream.synchronize()
            gpu_result = result_holder.get("data")

            if gpu_result:
                logger.info(
                    "GPU computed on: %s (%d frames)",
                    gpu_result.get("computed_on"),
                    gpu_result.get("n_frames", 0),
                )
        except Exception as exc:
            logger.debug("GPU analysis skipped: %s", exc)

    if gpu_result is None:
        tempo, beats = _track()
        beat_times = librosa.frames_to_time(beats, sr=sr, hop_length=hop_length).tolist()

    duration = len(y) / sr
    tempo_val = float(tempo.item() if hasattr(tempo, "item") else tempo)

    return {
        "tempo": tempo_val,
        "beat_times": [round(t, 3) for t in beat_times],
        "duration": duration,
        "gpu_result": gpu_result,
        "start_bpm_used": prior_bpm,
    }


def beat_times_to_keyframes(beat_times: list[float], fps: int = 24) -> list[int]:
    """Convert beat timestamps (seconds) to animation frame numbers."""
    return [round(t * fps) for t in beat_times]


# ---------------------------------------------------------------------------
# High-level analysis used by tools
# ---------------------------------------------------------------------------

def analyze_audio(audio_path: str | Path, fps: int = 24) -> dict[str, Any]:
    """Analyze audio and return beat data for animation.

    This is the canonical implementation used by:
    - tools/analyze_and_sync.py
    - tools/audio_analysis_demo.py
    - tools/batch_process.py
    - tools/audio_export.py

    Args:
        audio_path: Path to an audio file.
        fps: Target animation frame rate (default 24).

    Returns:
        Dict with tempo, beat_times, keyframes, duration, beat_count.
    """
    print(f"Loading: {audio_path}")
    _log_gpu_status()
    y, sr = load_audio(audio_path)
    result = analyze_beats(y, sr)
    result["keyframes"] = beat_times_to_keyframes(result["beat_times"], fps)
    result["beat_count"] = len(result["beat_times"])
    result["fps"] = fps
    result["audio_file"] = str(Path(audio_path).resolve())
    return result


async def analyze_audio_async(audio_path: str | Path, fps: int = 24) -> dict[str, Any]:
    """Async wrapper around analyze_audio for tools that use asyncio.run()."""
    return analyze_audio(audio_path, fps=fps)


def save_beat_data(data: dict[str, Any], output_path: str | Path) -> Path:
    """Save beat analysis JSON to disk.

    Args:
        data: Dict produced by analyze_audio().
        output_path: Destination file path.

    Returns:
        Resolved Path of the written file.
    """
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    return out.resolve()
