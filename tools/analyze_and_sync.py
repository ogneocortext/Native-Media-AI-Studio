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
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tools.lib.audio import analyze_audio, save_beat_data  # noqa: E402
from tools.lib.cli_base import CLIError, Progress, setup_logging  # noqa: E402
from tools.lib.paths import output_dir

logger = setup_logging()

__version__ = "1.0.0"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Analyze audio for Unity beat-sync",
        epilog=f"analyze_and_sync v{__version__}",
    )
    parser.add_argument(
        "--version", action="version", version=f"analyze_and_sync {__version__}"
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="Debug logging")
    parser.add_argument("-q", "--quiet", action="store_true", help="Warnings only")
    parser.add_argument("audio_file", help="Path to audio file (wav/mp3)")
    parser.add_argument(
        "--output", "-o", help="Output JSON file path"
    )
    parser.add_argument(
        "--fps", type=int, default=24, help="Animation FPS (default: 24)"
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Report what would be done without writing"
    )

    args = parser.parse_args()

    # Re-configure logging after parsing verbosity flags
    from tools.lib.cli_base import setup_logging as _setup

    global logger
    logger = _setup(verbose=args.verbose, quiet=args.quiet)

    audio_path = Path(args.audio_file)
    if not audio_path.exists():
        raise CLIError(f"Audio file not found: {audio_path}")

    if args.dry_run:
        logger.info("[dry-run] would analyze %s and write to %s", audio_path, args.output or output_dir("beat_data") / "beat_data.json")
        return 0

    try:
        with Progress(total=1, label="analyzing audio") as p:
            data = analyze_audio(str(audio_path), fps=args.fps)
            p.advance()
    except FileNotFoundError as exc:
        raise CLIError(str(exc)) from exc
    except Exception as exc:
        raise CLIError(f"Analysis failed: {exc}") from exc

    print("\n=== Audio Analysis ===")
    print(f"Tempo: {data['tempo']:.1f} BPM")
    print(f"Duration: {data['duration']:.2f}s")
    print(f"Beats: {data['beat_count']}")
    print(f"First 8 beats: {data['beat_times'][:8]}")

    out_path = args.output
    if not out_path:
        out_path = str(output_dir("beat_data") / "beat_data.json")

    saved = save_beat_data(data, out_path)
    print(f"\nSaved to: {saved}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except CLIError as exc:
        logger.error("%s", exc)
        sys.exit(1)
