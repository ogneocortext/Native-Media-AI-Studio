#!/usr/bin/env python3
"""
Analyze audio and generate Unity beat-synced animation data.

Usage:
    python tools/analyze_and_sync.py <audio_file> [--output <json_file>]

Outputs JSON with:
    - tempo (BPM)
    - beat_times (list of timestamps)
    - duration (seconds)
    - keyframes (frame numbers for 24fps animation)
"""

from __future__ import annotations

import argparse
import json
import logging
import sys

from tools.lib.paths import backend_dir, output_dir
from tools.lib.audio import analyze_audio, save_beat_data

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Analyze audio for Unity beat-sync"
    )
    parser.add_argument("audio_file", help="Path to audio file (wav/mp3)")
    parser.add_argument(
        "--output", "-o", help="Output JSON file path"
    )
    parser.add_argument(
        "--fps", type=int, default=24, help="Animation FPS (default: 24)"
    )

    args = parser.parse_args()
    audio_path = args.audio_file

    try:
        data = analyze_audio(audio_path, fps=args.fps)
    except FileNotFoundError as exc:
        logger.error(str(exc))
        sys.exit(1)
    except Exception as exc:
        logger.error("Analysis failed: %s", exc)
        sys.exit(1)

    print(f"\n=== Audio Analysis ===")
    print(f"Tempo: {data['tempo']:.1f} BPM")
    print(f"Duration: {data['duration']:.2f}s")
    print(f"Beats: {data['beat_count']}")
    print(f"First 8 beats: {data['beat_times'][:8]}")

    out_path = args.output
    if not out_path:
        out_path = str(output_dir("beat_data") / "beat_data.json")

    saved = save_beat_data(data, out_path)
    print(f"\nSaved to: {saved}")


if __name__ == "__main__":
    main()
