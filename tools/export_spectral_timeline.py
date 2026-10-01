"""Dense frame-accurate spectral timeline generator (the "data bridge").

Exports librosa analysis as a dense per-frame JSON timeline:
  [{frame, time, sub, mid, high, transient, centroid, rms}, ...]

This replaces 8 aggregate sections with frame-accurate data that can be
bound as uniforms into the Remotion/WebGL pipeline. Deterministic per-frame,
no real-time analysis bottleneck.

Usage:
    python tools/export_spectral_timeline.py <audio_file> [--output <json>] [--fps 24]
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path
from typing import Any

from tools.lib.audio import load_audio
from tools.lib.paths import output_dir

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def resample_timeline_to_fps(
    frames: list[dict[str, Any]],
    sr: int,
    hop_length: int,
    fps: int,
) -> list[dict[str, Any]]:
    """Resample analysis frames to target FPS for animation binding.

    Args:
        frames: Per-STFT-frame analysis data.
        sr: Sample rate.
        hop_length: STFT hop length.
        fps: Target frames per second.

    Returns:
        Dense per-frame timeline at the target FPS.
    """
    if not frames:
        return []

    frame_duration = hop_length / sr
    target_duration = 1.0 / fps
    total_time = frames[-1]["time"] + frame_duration
    n_target_frames = int(total_time * fps)

    timeline: list[dict[str, Any]] = []
    src_idx = 0

    for target_frame in range(n_target_frames):
        target_time = target_frame * target_duration

        while (
            src_idx < len(frames) - 1
            and frames[src_idx + 1]["time"] <= target_time
        ):
            src_idx += 1

        next_idx = min(src_idx + 1, len(frames) - 1)
        t0 = frames[src_idx]["time"]
        t1 = frames[next_idx]["time"]
        alpha = (target_time - t0) / (t1 - t0) if t1 > t0 else 0.0
        alpha = max(0.0, min(1.0, alpha))

        a = frames[src_idx]
        b = frames[next_idx]

        def lerp(key: str) -> float:
            return round(a[key] + alpha * (b[key] - a[key]), 6)

        timeline.append(
            {
                "frame": target_frame,
                "time": round(target_time, 4),
                "sub": lerp("sub"),
                "mid": lerp("mid"),
                "high": lerp("high"),
                "transient": lerp("transient"),
                "centroid": lerp("centroid"),
                "rms": lerp("rms"),
            }
        )

    return timeline


def generate_spectral_timeline(
    audio_path: str | Path,
    fps: int = 24,
    sr: int = 22050,
    hop_length: int = 512,
    n_fft: int = 2048,
) -> dict[str, Any]:
    """Generate a dense frame-accurate spectral timeline from an audio file.

    Args:
        audio_path: Path to audio file.
        fps: Target animation frame rate.
        sr: Sample rate for analysis.
        hop_length: STFT hop length.
        n_fft: FFT window size.

    Returns:
        Dict with metadata + dense per-frame timeline.
    """
    from app.services.spectral_bands import analyze_audio_bands

    print(f"Loading: {audio_path}")
    y, sr_loaded = load_audio(audio_path, sr=sr)
    duration = len(y) / sr_loaded

    print(f"Analyzing spectral bands (sr={sr_loaded}, hop={hop_length}, n_fft={n_fft})...")
    raw_frames = analyze_audio_bands(y, sr=sr_loaded, hop_length=hop_length, n_fft=n_fft)

    print(f"Resampling to {fps} fps...")
    timeline = resample_timeline_to_fps(raw_frames, sr_loaded, hop_length, fps)

    return {
        "audio_file": str(Path(audio_path).resolve()),
        "duration_seconds": round(duration, 3),
        "sample_rate": sr_loaded,
        "fps": fps,
        "hop_length": hop_length,
        "n_fft": n_fft,
        "frame_count": len(timeline),
        "bands": {
            "sub": [20, 120],
            "mid": [500, 2000],
            "high": [4000, 16000],
        },
        "timeline": timeline,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Export dense frame-accurate spectral timeline"
    )
    parser.add_argument("audio_file", help="Path to audio file (wav/mp3/m4a)")
    parser.add_argument("--output", "-o", help="Output JSON file path")
    parser.add_argument("--fps", type=int, default=24, help="Target FPS (default: 24)")
    parser.add_argument("--sr", type=int, default=22050, help="Sample rate (default: 22050)")
    parser.add_argument("--hop-length", type=int, default=512, help="STFT hop length")
    parser.add_argument("--n-fft", type=int, default=2048, help="FFT window size")

    args = parser.parse_args()

    try:
        data = generate_spectral_timeline(
            args.audio_file,
            fps=args.fps,
            sr=args.sr,
            hop_length=args.hop_length,
            n_fft=args.n_fft,
        )
    except FileNotFoundError as exc:
        logger.error(str(exc))
        sys.exit(1)
    except Exception as exc:
        logger.error("Analysis failed: %s", exc)
        sys.exit(1)

    print(f"\n=== Spectral Timeline ===")
    print(f"Duration: {data['duration_seconds']:.2f}s")
    print(f"Frames: {data['frame_count']} @ {data['fps']} fps")
    print(f"Bands: sub={data['bands']['sub']}, mid={data['bands']['mid']}, high={data['bands']['high']}")

    out_path = args.output
    if not out_path:
        out_path = str(output_dir("spectral_timelines") / "spectral_timeline.json")

    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    print(f"\nSaved to: {out.resolve()}")


if __name__ == "__main__":
    main()
