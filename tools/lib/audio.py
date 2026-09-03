"""Shared audio analysis helpers for Native Media AI Studio tools.

Provides a single source of truth for:
- Loading audio with librosa
- Beat tracking (librosa + optional CUDA stream overlap)
- Converting beat times to frame keyframes
- Saving beat data to JSON

Import this in any tool that needs audio analysis instead of copy-pasting
librosa boilerplate.
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Low-level helpers
# ---------------------------------------------------------------------------

def load_audio(audio_path: str | Path, sr: int = 22050):
    """Load an audio file with librosa.

    Returns:
        Tuple of (y, sr).

    Raises:
        FileNotFoundError: If the file does not exist.
        Exception: Propagated from librosa.load.
    """
    import librosa
    p = Path(audio_path)
    if not p.exists():
        raise FileNotFoundError(f"Audio file not found: {p}")
    return librosa.load(str(p), sr=sr, mono=True)


def analyze_beats(y, sr, *, use_gpu: bool = True) -> dict[str, Any]:
    """Run beat tracking, optionally overlapping GPU analysis.

    Args:
        y: Audio time series.
        sr: Sample rate.
        use_gpu: If True, attempt CUDA-accelerated analysis.

    Returns:
        Dict with keys: tempo, beat_times, duration, gpu_result.
    """
    import librosa
    import numpy as np

    gpu_result = None

    if use_gpu:
        try:
            from app.services.cuda import cuda_audio, cuda_available
            if cuda_available():
                import torch
                gpu_stream = torch.cuda.Stream()
                result_holder: dict[str, Any] = {}

                def _gpu_worker():
                    with torch.cuda.stream(gpu_stream):
                        result_holder["data"] = cuda_audio.analyze(y)

                gpu_thread = threading.Thread(target=_gpu_worker)
                gpu_thread.start()

                tempo, beats = librosa.beat.beat_track(y=y, sr=sr, hop_length=512)
                beat_times = librosa.frames_to_time(beats, sr=sr, hop_length=512).tolist()

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
        tempo, beats = librosa.beat.beat_track(y=y, sr=sr, hop_length=512)
        beat_times = librosa.frames_to_time(beats, sr=sr, hop_length=512).tolist()

    duration = len(y) / sr
    tempo_val = float(tempo.item() if hasattr(tempo, "item") else tempo)

    return {
        "tempo": tempo_val,
        "beat_times": [round(t, 3) for t in beat_times],
        "duration": duration,
        "gpu_result": gpu_result,
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
    - tools/analyze_happyshrimp.py
    - tools/batch_process.py
    - tools/audio_export.py

    Args:
        audio_path: Path to an audio file.
        fps: Target animation frame rate (default 24).

    Returns:
        Dict with tempo, beat_times, keyframes, duration, beat_count.
    """
    print(f"Loading: {audio_path}")
    y, sr = load_audio(audio_path)
    result = analyze_beats(y, sr, use_gpu=True)
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
    with open(out, "w") as f:
        json.dump(data, f, indent=2)
    return out.resolve()
