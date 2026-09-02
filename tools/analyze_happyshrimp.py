"""GPU-accelerated audio analysis demo script.

Demonstrates the shared tools.lib.audio helpers with optional CUDA overlap.
"""

from __future__ import annotations

import sys

from tools.lib.paths import backend_dir, output_dir
from tools.lib.audio import analyze_audio, save_beat_data


def _add_backend_to_path() -> None:
    backend = str(backend_dir())
    if backend not in sys.path:
        sys.path.insert(0, backend)


_add_backend_to_path()


def analyze_audio_file(audio_path, output_path=None):
    """Analyze audio file with GPU acceleration."""
    print(f"CUDA available: check skipped (use analyze_audio for auto-detect)")

    try:
        data = analyze_audio(audio_path)
        print(f"\n=== Audio Analysis ===")
        print(f"Computed on: {data.get('gpu_result', {}).get('computed_on', 'CPU') if data.get('gpu_result') else 'CPU'}")
        print(f"Tempo: {data['tempo']:.1f} BPM")
        print(f"Beats: {data['beat_count']}")
        print(f"First 8 beat times: {[round(t, 2) for t in data['beat_times'][:8]]}")

        if output_path is None:
            output_path = str(output_dir("beat_data") / "beat_data.json")

        saved = save_beat_data(data, output_path)
        print(f"\nBeat data saved to: {saved}")
        return data

    except FileNotFoundError as exc:
        print(f"Error: Audio file not found: {exc}")
        return None
    except Exception as exc:
        print(f"Error during analysis: {exc}")
        return None


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Analyze audio file with GPU acceleration")
    parser.add_argument("audio_file", help="Path to audio file (wav/mp3)")
    parser.add_argument("--output", "-o", help="Output JSON file path")

    args = parser.parse_args()

    result = analyze_audio_file(args.audio_file, args.output)

    if result is None:
        sys.exit(1)


if __name__ == "__main__":
    main()
