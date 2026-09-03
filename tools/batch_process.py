#!/usr/bin/env python3
"""
Batch audio processing CLI.

Process multiple audio files at once: analyze, fingerprint, separate stems,
detect structure, and export features.

Usage:
    # Analyze all audio files in a directory
    python tools/batch_process.py analyze "E:/Music/*.mp3"

    # Full pipeline on a directory
    python tools/batch_process.py full "E:/Music/*.mp3" --output output/batch/

    # Export beat data for Unity
    python tools/batch_process.py export-unity "E:/Music/*.mp3" --output output/beat_data/

    # Generate MIDI from beat times
    python tools/batch_process.py export-midi "E:/Music/*.mp3" --output output/midi/

    # Find acoustic duplicates
    python tools/batch_process.py find-duplicates "E:/Music/*.mp3"

    # Analyze with structure detection
    python tools/batch_process.py structure "E:/Music/*.mp3"
"""

from __future__ import annotations

import argparse
import asyncio
import glob
import json
import sys
from pathlib import Path

from tools.lib.paths import PROJECT_ROOT, backend_dir, output_dir
from tools.lib.audio import analyze_audio, analyze_audio_async, save_beat_data


def _add_backend_to_path() -> None:
    """Ensure backend package is importable without a package install."""
    backend = str(backend_dir())
    if backend not in sys.path:
        sys.path.insert(0, backend)


_add_backend_to_path()


def find_audio_files(pattern: str) -> list[str]:
    """Find audio files matching a glob pattern."""
    supported = {".mp3", ".wav", ".flac", ".ogg", ".m4a", ".wma", ".aac"}
    files = glob.glob(pattern, recursive=True)
    return [f for f in files if Path(f).suffix.lower() in supported]


async def batch_analyze(files: list[str], output_dir: str | None = None) -> list[dict]:
    """Analyze multiple audio files."""
    from app.services.audio_analyzer import AudioAnalyzer

    analyzer = AudioAnalyzer()
    results: list[dict] = []

    for i, f in enumerate(files):
        print(f"[{i+1}/{len(files)}] Analyzing: {Path(f).name}")
        try:
            result = analyzer.analyze_file(f)
            results.append({
                "file": f,
                "tempo_bpm": result.beats.tempo_bpm,
                "duration": result.waveform.duration_seconds,
                "beat_count": len(result.beats.beat_times),
                "confidence": result.beats.confidence,
            })
            if output_dir:
                out = Path(output_dir)
                out.mkdir(parents=True, exist_ok=True)
                analyzer.save_to_json(result, out / f"{Path(f).stem}_analysis.json")
        except Exception as exc:
            print(f"  Error: {exc}")
            results.append({"file": f, "error": str(exc)})

    return results


async def batch_structure(files: list[str], output_dir: str | None = None) -> list[dict]:
    """Run structure analysis on multiple files."""
    from app.services.structure_analysis import structure_analyzer

    results: list[dict] = []
    for i, f in enumerate(files):
        print(f"[{i+1}/{len(files)}] Structure analysis: {Path(f).name}")
        try:
            result = await structure_analyzer.analyze(f)
            results.append({
                "file": f,
                "tempo_bpm": result.tempo_bpm,
                "key": result.key,
                "sections": len(result.sections),
                "mood": result.mood,
            })
            if output_dir:
                out = Path(output_dir)
                out.mkdir(parents=True, exist_ok=True)
                await structure_analyzer.save_analysis(result)
        except Exception as exc:
            print(f"  Error: {exc}")
            results.append({"file": f, "error": str(exc)})

    return results


async def batch_fingerprint(files: list[str]) -> list[dict]:
    """Fingerprint multiple audio files."""
    from app.services.audio_fingerprinting import audio_fingerprinter

    if not audio_fingerprinter.is_available():
        print("fpcalc not found. Install chromaprint: https://acoustid.org/chromaprint")
        return []

    results: list[dict] = []
    for i, f in enumerate(files):
        print(f"[{i+1}/{len(files)}] Fingerprinting: {Path(f).name}")
        result = await audio_fingerprinter.fingerprint_file(f)
        results.append({
            "file": f,
            "hash": result.hash,
            "duration": result.duration,
            "error": result.error,
        })

    return results


async def batch_separate(files: list[str], output_dir: str | None = None) -> list[dict]:
    """Separate stems for multiple audio files."""
    from app.services.source_separation import source_separator

    if not source_separator.is_available():
        print("No separation tool found. Install demucs: pip install demucs")
        return []

    results: list[dict] = []
    for i, f in enumerate(files):
        print(f"[{i+1}/{len(files)}] Separating: {Path(f).name}")
        result = await source_separator.separate(f, output_dir=output_dir)
        results.append({
            "file": f,
            "model": result.model,
            "stems": list(result.stems.keys()),
            "error": result.error,
        })

    return results


async def batch_export_unity(files: list[str], output_dir: str) -> list[dict]:
    """Export beat data for Unity animation."""
    from app.services.audio_analyzer import AudioAnalyzer

    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    analyzer = AudioAnalyzer()
    results: list[dict] = []

    for i, f in enumerate(files):
        print(f"[{i+1}/{len(files)}] Exporting Unity data: {Path(f).name}")
        try:
            result = analyzer.analyze_file(f)
            data = {
                "tempo": result.beats.tempo_bpm,
                "fps": 24,
                "duration": result.waveform.duration_seconds,
                "beat_count": len(result.beats.beat_times),
                "beat_times": [round(t, 3) for t in result.beats.beat_times],
                "keyframes": [round(t * 24) for t in result.beats.beat_times],
                "energy_envelope": result.waveform.amplitude_envelope,
                "audio_file": f,
            }

            output_path = out / f"{Path(f).stem}_unity.json"
            with open(output_path, "w") as fp:
                json.dump(data, fp, indent=2)

            results.append({"file": f, "output": str(output_path)})
        except Exception as exc:
            print(f"  Error: {exc}")
            results.append({"file": f, "error": str(exc)})

    return results


async def batch_export_midi(files: list[str], output_dir: str) -> list[dict]:
    """Export beat times as MIDI files."""
    try:
        import mido
    except ImportError:
        print("mido not installed. Run: pip install mido")
        return []

    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    from app.services.audio_analyzer import AudioAnalyzer

    analyzer = AudioAnalyzer()
    results: list[dict] = []

    for i, f in enumerate(files):
        print(f"[{i+1}/{len(files)}] Exporting MIDI: {Path(f).name}")
        try:
            result = analyzer.analyze_file(f)
            mid = mido.MidiFile()
            track = mido.MidiTrack()
            mid.tracks.append(track)

            tempo = mido.bpm2tempo(result.beats.tempo_bpm)
            track.append(mido.MetaMessage("set_tempo", tempo=tempo, time=0))

            ticks_per_beat = mid.ticks_per_beat
            prev_time = 0
            for beat_time in result.beats.beat_times:
                beat_ticks = int(beat_time * ticks_per_beat * result.beats.tempo_bpm / 60)
                delta = beat_ticks - prev_time
                track.append(mido.Message("note_on", note=60, velocity=100, time=delta))
                track.append(mido.Message("note_off", note=60, velocity=0, time=10))
                prev_time = beat_ticks + 10

            output_path = out / f"{Path(f).stem}_beats.mid"
            mid.save(str(output_path))
            results.append({"file": f, "output": str(output_path)})
        except Exception as exc:
            print(f"  Error: {exc}")
            results.append({"file": f, "error": str(exc)})

    return results


async def batch_find_duplicates(files: list[str]) -> list[dict]:
    """Find acoustic duplicates among files."""
    from app.services.audio_fingerprinting import audio_fingerprinter

    if not audio_fingerprinter.is_available():
        print("fpcalc not found. Install chromaprint: https://acoustid.org/chromaprint")
        return []

    print(f"Checking {len(files)} files for acoustic duplicates...")
    duplicates = await audio_fingerprinter.find_duplicates(files)

    results: list[dict] = []
    for group in duplicates:
        if len(group.files) > 1:
            print(f"\nDuplicate group ({group.confidence:.0%} confidence):")
            for f in group.files:
                print(f"  - {f}")
            results.append({
                "files": group.files,
                "confidence": group.confidence,
            })

    if not results:
        print("No acoustic duplicates found.")
    else:
        print(f"\nFound {len(results)} duplicate groups.")

    return results


async def run_full_pipeline(files: list[str], output_dir: str) -> dict:
    """Run full analysis pipeline on multiple files."""
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    print(f"\n{'='*60}")
    print(f"FULL BATCH PIPELINE — {len(files)} files")
    print(f"{'='*60}\n")

    print("STEP 1: Audio Analysis")
    analysis_results = await batch_analyze(files, str(out / "analysis"))

    print("\nSTEP 2: Structure Analysis")
    structure_results = await batch_structure(files, str(out / "structure"))

    print("\nSTEP 3: Unity Export")
    unity_results = await batch_export_unity(files, str(out / "unity"))

    print("\nSTEP 4: MIDI Export")
    midi_results = await batch_export_midi(files, str(out / "midi"))

    summary = {
        "total_files": len(files),
        "analysis": len([r for r in analysis_results if "error" not in r]),
        "structure": len([r for r in structure_results if "error" not in r]),
        "unity": len([r for r in unity_results if "error" not in r]),
        "midi": len([r for r in midi_results if "error" not in r]),
        "output_dir": str(out),
    }

    with open(out / "batch_summary.json", "w") as f:
        json.dump(summary, f, indent=2)

    print(f"\n{'='*60}")
    print(f"COMPLETE — Output: {out}")
    print(f"{'='*60}")
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Batch audio processing for Native Media AI Studio",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # Analyze all MP3s in a directory
    python tools/batch_process.py analyze "E:/Music/*.mp3"

    # Full pipeline with output directory
    python tools/batch_process.py full "E:/Music/*.mp3" --output output/batch/

    # Export Unity beat data
    python tools/batch_process.py export-unity "E:/Music/*.mp3" --output output/unity/

    # Generate MIDI from beats
    python tools/batch_process.py export-midi "E:/Music/*.mp3" --output output/midi/

    # Find acoustic duplicates
    python tools/batch_process.py find-duplicates "E:/Music/*.mp3"

    # Structure analysis
    python tools/batch_process.py structure "E:/Music/*.mp3" --output output/structure/
        """,
    )
    parser.add_argument(
        "command",
        choices=[
            "analyze", "full", "export-unity", "export-midi",
            "find-duplicates", "structure", "fingerprint", "separate",
        ],
        help="Command to run",
    )
    parser.add_argument("pattern", help="Glob pattern for audio files")
    parser.add_argument("--output", "-o", help="Output directory")
    parser.add_argument(
        "--device",
        choices=["cpu", "cuda", "auto"],
        default="auto",
        help="Device for separation (default: auto)",
    )

    args = parser.parse_args()

    files = find_audio_files(args.pattern)
    if not files:
        print(f"No audio files found matching: {args.pattern}")
        sys.exit(1)

    print(f"Found {len(files)} audio files")

    if args.command == "analyze":
        results = asyncio.run(batch_analyze(files, args.output))
    elif args.command == "structure":
        results = asyncio.run(batch_structure(files, args.output))
    elif args.command == "fingerprint":
        results = asyncio.run(batch_fingerprint(files))
    elif args.command == "separate":
        results = asyncio.run(batch_separate(files, args.output))
    elif args.command == "export-unity":
        output = args.output or "output/unity/"
        results = asyncio.run(batch_export_unity(files, output))
    elif args.command == "export-midi":
        output = args.output or "output/midi/"
        results = asyncio.run(batch_export_midi(files, output))
    elif args.command == "find-duplicates":
        results = asyncio.run(batch_find_duplicates(files))
    elif args.command == "full":
        output = args.output or "output/batch/"
        results = asyncio.run(run_full_pipeline(files, output))
    else:
        parser.print_help()
        sys.exit(1)

    success = len([r for r in results if "error" not in r])
    failed = len([r for r in results if "error" in r])
    print(f"\nSummary: {success} succeeded, {failed} failed")


if __name__ == "__main__":
    main()
