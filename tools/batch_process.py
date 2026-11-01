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

    # Dry-run: report what would be done without processing
    python tools/batch_process.py analyze "E:/Music/*.mp3" --dry-run
"""

from __future__ import annotations

import argparse
import asyncio
import glob
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tools.lib.cli_base import CLIError, Progress, json_print, setup_logging  # noqa: E402
from tools.lib.paths import add_backend_to_path

add_backend_to_path()

__version__ = "1.0.0"

logger = setup_logging()


def find_audio_files(pattern: str) -> list[str]:
    """Find audio files matching a glob pattern."""
    supported = {".mp3", ".wav", ".flac", ".ogg", ".m4a", ".wma", ".aac"}
    files = glob.glob(pattern, recursive=True)
    return [f for f in files if Path(f).suffix.lower() in supported]


# ---------------------------------------------------------------------------
# Batch operations (each supports dry_run)
# ---------------------------------------------------------------------------

async def batch_analyze(files: list[str], output_dir: str | None = None, *, dry_run: bool = False) -> list[dict]:
    """Analyze multiple audio files."""
    if dry_run:
        return [
            {"file": f, "dry_run": True, "would_analyze": True} for f in files
        ]

    from app.services.audio_analyzer import AudioAnalyzer

    analyzer = AudioAnalyzer()
    results: list[dict] = []

    with Progress(total=len(files), label="analyzing") as p:
        for f in files:
            logger.info("[%s] Analyzing: %s", Path(f).name, f)
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
                logger.error("Error analyzing %s: %s", f, exc)
                results.append({"file": f, "error": str(exc)})
            p.advance()

    return results


async def batch_structure(files: list[str], output_dir: str | None = None, *, dry_run: bool = False) -> list[dict]:
    """Run structure analysis on multiple files."""
    if dry_run:
        return [
            {"file": f, "dry_run": True, "would_structure": True} for f in files
        ]

    from tools.structure_analysis import structure_analyzer

    results: list[dict] = []

    with Progress(total=len(files), label="structure") as p:
        for f in files:
            logger.info("[%s] Structure analysis: %s", Path(f).name, f)
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
                logger.error("Structure error for %s: %s", f, exc)
                results.append({"file": f, "error": str(exc)})
            p.advance()

    return results


async def batch_fingerprint(files: list[str], *, dry_run: bool = False) -> list[dict]:
    """Fingerprint multiple audio files."""
    if dry_run:
        return [
            {"file": f, "dry_run": True, "would_fingerprint": True} for f in files
        ]

    from tools.audio_fingerprinting import audio_fingerprinter

    if not audio_fingerprinter.is_available():
        logger.error("fpcalc not found. Install chromaprint: https://acoustid.org/chromaprint")
        raise CLIError("fpcalc not found")

    results: list[dict] = []

    with Progress(total=len(files), label="fingerprinting") as p:
        for f in files:
            logger.info("[%s] Fingerprinting: %s", Path(f).name, f)
            result = await audio_fingerprinter.fingerprint_file(f)
            results.append({
                "file": f,
                "hash": result.hash,
                "duration": result.duration,
                "error": result.error,
            })
            p.advance()

    return results


async def batch_separate(files: list[str], output_dir: str | None = None, *, dry_run: bool = False) -> list[dict]:
    """Separate stems for multiple audio files."""
    if dry_run:
        return [
            {"file": f, "dry_run": True, "would_separate": True} for f in files
        ]

    from app.services.source_separation import source_separator

    if not source_separator.is_available():
        logger.error("No separation tool found. Install demucs: pip install demucs")
        raise CLIError("source separator not available")

    results: list[dict] = []

    with Progress(total=len(files), label="separating") as p:
        for f in files:
            logger.info("[%s] Separating: %s", Path(f).name, f)
            result = await source_separator.separate(f, output_dir=output_dir)
            results.append({
                "file": f,
                "model": result.model,
                "stems": list(result.stems.keys()),
                "error": result.error,
            })
            p.advance()

    return results


async def batch_export_unity(files: list[str], output_dir: str, *, dry_run: bool = False) -> list[dict]:
    """Export beat data for Unity animation."""
    if dry_run:
        return [
            {"file": f, "dry_run": True, "would_export_unity": True} for f in files
        ]

    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    from app.services.audio_analyzer import AudioAnalyzer

    analyzer = AudioAnalyzer()
    results: list[dict] = []

    with Progress(total=len(files), label="exporting Unity") as p:
        for f in files:
            logger.info("[%s] Exporting Unity data: %s", Path(f).name, f)
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
                logger.error("Unity export error for %s: %s", f, exc)
                results.append({"file": f, "error": str(exc)})
            p.advance()

    return results


async def batch_export_midi(files: list[str], output_dir: str, *, dry_run: bool = False) -> list[dict]:
    """Export beat times as MIDI files."""
    if dry_run:
        return [
            {"file": f, "dry_run": True, "would_export_midi": True} for f in files
        ]

    try:
        import mido
    except ImportError as exc:
        logger.error("mido not installed. Run: pip install mido")
        raise CLIError("mido not installed") from exc

    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    from app.services.audio_analyzer import AudioAnalyzer

    analyzer = AudioAnalyzer()
    results: list[dict] = []

    with Progress(total=len(files), label="exporting MIDI") as p:
        for f in files:
            logger.info("[%s] Exporting MIDI: %s", Path(f).name, f)
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
                logger.error("MIDI export error for %s: %s", f, exc)
                results.append({"file": f, "error": str(exc)})
            p.advance()

    return results


async def batch_find_duplicates(files: list[str], *, dry_run: bool = False) -> list[dict]:
    """Find acoustic duplicates among files."""
    if dry_run:
        return [
            {"file": f, "dry_run": True, "would_check_duplicates": True} for f in files
        ]

    from tools.audio_fingerprinting import audio_fingerprinter

    if not audio_fingerprinter.is_available():
        logger.error("fpcalc not found. Install chromaprint: https://acoustid.org/chromaprint")
        raise CLIError("fpcalc not found")

    logger.info("Checking %d files for acoustic duplicates...", len(files))
    duplicates = await audio_fingerprinter.find_duplicates(files)

    results: list[dict] = []
    for group in duplicates:
        if len(group.files) > 1:
            logger.info("Duplicate group (%.0f%% confidence):", group.confidence * 100)
            for f in group.files:
                logger.info("  - %s", f)
            results.append({
                "files": group.files,
                "confidence": group.confidence,
            })

    if not results:
        logger.info("No acoustic duplicates found.")
    else:
        logger.info("Found %d duplicate groups.", len(results))

    return results


async def run_full_pipeline(files: list[str], output_dir: str, *, dry_run: bool = False) -> dict:
    """Run full analysis pipeline on multiple files."""
    if dry_run:
        return {
            "total_files": len(files),
            "dry_run": True,
            "would_run_pipeline": True,
            "output_dir": output_dir,
        }

    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    logger.info("%s", "=" * 60)
    logger.info("FULL BATCH PIPELINE — %d files", len(files))
    logger.info("%s", "=" * 60)

    logger.info("STEP 1: Audio Analysis")
    analysis_results = await batch_analyze(files, str(out / "analysis"), dry_run=False)

    logger.info("STEP 2: Structure Analysis")
    structure_results = await batch_structure(files, str(out / "structure"), dry_run=False)

    logger.info("STEP 3: Unity Export")
    unity_results = await batch_export_unity(files, str(out / "unity"), dry_run=False)

    logger.info("STEP 4: MIDI Export")
    midi_results = await batch_export_midi(files, str(out / "midi"), dry_run=False)

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

    logger.info("%s", "=" * 60)
    logger.info("COMPLETE — Output: %s", out)
    logger.info("%s", "=" * 60)
    return summary


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> int:
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

    # Dry-run: report what would be done without processing
    python tools/batch_process.py analyze "E:/Music/*.mp3" --dry-run
        """,
    )
    parser.add_argument(
        "--version", action="version", version=f"batch_process {__version__}"
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="Debug logging")
    parser.add_argument("-q", "--quiet", action="store_true", help="Warnings only")
    parser.add_argument(
        "--dry-run", action="store_true", help="Report what would be done without processing"
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

    # Re-configure logging after parsing verbosity flags
    from tools.lib.cli_base import setup_logging as _setup  # noqa: E402

    global logger
    logger = _setup(verbose=args.verbose, quiet=args.quiet)

    dry_run = args.dry_run
    files = find_audio_files(args.pattern)
    if not files:
        raise CLIError(f"No audio files found matching: {args.pattern}")

    logger.info("Found %d audio files", len(files))

    try:
        if args.command == "analyze":
            results = asyncio.run(batch_analyze(files, args.output, dry_run=dry_run))
        elif args.command == "structure":
            results = asyncio.run(batch_structure(files, args.output, dry_run=dry_run))
        elif args.command == "fingerprint":
            results = asyncio.run(batch_fingerprint(files, dry_run=dry_run))
        elif args.command == "separate":
            results = asyncio.run(batch_separate(files, args.output, dry_run=dry_run))
        elif args.command == "export-unity":
            output = args.output or "output/unity/"
            results = asyncio.run(batch_export_unity(files, output, dry_run=dry_run))
        elif args.command == "export-midi":
            output = args.output or "output/midi/"
            results = asyncio.run(batch_export_midi(files, output, dry_run=dry_run))
        elif args.command == "find-duplicates":
            results = asyncio.run(batch_find_duplicates(files, dry_run=dry_run))
        elif args.command == "full":
            output = args.output or "output/batch/"
            results = asyncio.run(run_full_pipeline(files, output, dry_run=dry_run))
        else:
            parser.print_help()
            return 1
    except CLIError:
        raise
    except Exception as exc:
        raise CLIError(f"Batch processing failed: {exc}") from exc

    if isinstance(results, dict):
        # Full pipeline returns a dict summary
        json_print(results)
    else:
        success = len([r for r in results if "error" not in r])
        failed = len([r for r in results if "error" in r])
        summary = {"command": args.command, "succeeded": success, "failed": failed, "total": len(results)}
        json_print(summary)

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except CLIError as exc:
        logger.error("%s", exc)
        sys.exit(1)
