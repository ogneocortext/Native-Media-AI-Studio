#!/usr/bin/env python3
"""
Audio feature export: MIDI and OSC formats.

Exports beat times, energy, and other audio features as:
- MIDI files (for DAWs, lighting consoles, hardware sequencers)
- OSC messages (for Max/MSP, TouchDesigner, Resolume, etc.)

Usage:
    # Export beat times as MIDI
    python tools/audio_export.py midi "E:/Music/song.mp3" --output output/midi/

    # Export energy as MIDI CC
    python tools/audio_export.py midi-cc "E:/Music/song.mp3" --output output/midi/

    # Export OSC stream (live playback)
    python tools/audio_export.py osc "E:/Music/song.mp3" --port 9000

    # Export OSC to file (for later playback)
    python tools/audio_export.py osc-file "E:/Music/song.mp3" --output output/osc/

    # Export all features as JSON (for custom integrations)
    python tools/audio_export.py json "E:/Music/song.mp3" --output output/features/

    # Dry-run: report what would be done without writing
    python tools/audio_export.py midi "E:/Music/song.mp3" --dry-run
"""

from __future__ import annotations

import argparse
import json
import logging
import operator
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tools.lib.cli_base import CLIError, Progress, json_print, setup_logging  # noqa: E402
from tools.lib.paths import output_dir

setup_logging()
logger = logging.getLogger(__name__)

__version__ = "1.0.0"


def _clamp_cc(energy: float) -> int:
    """Map a normalised energy value to a MIDI control-change byte in [0, 127].

    ``int(energy * 127)`` alone overflows to 128 once numerical drift pushes
    energy past 1.0, and goes negative for a negative sample. A CC value is an
    unsigned byte, so either would write an invalid message to the file.
    """
    return max(0, min(127, int(energy * 127)))


# ---------------------------------------------------------------------------
# Analysis helper (shared by all exporters)
# ---------------------------------------------------------------------------

def _analyze(audio_path: str, *, dry_run: bool = False):
    """Analyze an audio file, with optional dry-run shortcut.

    Returns the analysis result or raises CLIError.
    """
    if dry_run:
        # Return a minimal synthetic result so downstream code can preview
        # output paths without actually analysing.
        class _FakeBeats:
            tempo_bpm = 120.0
            beat_times: tuple[float, ...] = (0.5, 1.0, 1.5, 2.0)
            confidence = 1.0
            onset_times: tuple[float, ...] = ()

        class _FakeWaveform:
            duration_seconds = 10.0
            sample_rate = 44100
            amplitude_envelope: tuple[float, ...] = (0.0,) * 100
            rms_energy: tuple[float, ...] = (0.0,) * 100
            zero_crossing_rate: tuple[float, ...] = (0.0,) * 100
            centroid: tuple[float, ...] = (1000.0,) * 100
            spectral_rolloff: tuple[float, ...] = (5000.0,) * 100

        class _FakeResult:
            beats = _FakeBeats()
            waveform = _FakeWaveform()

        return _FakeResult()

    from app.services.audio_analyzer import AudioAnalyzer

    analyzer = AudioAnalyzer()
    return analyzer.analyze_file(audio_path)


# ---------------------------------------------------------------------------
# MIDI exports
# ---------------------------------------------------------------------------

def export_midi_beats(
    audio_path: str,
    output_path: str,
    note: int = 60,
    velocity: int = 100,
    *,
    dry_run: bool = False,
) -> dict:
    """Export beat times as MIDI notes."""
    try:
        import mido
    except ImportError:
        return {"error": "mido not installed. Run: pip install mido"}

    if dry_run:
        return {
            "file": audio_path,
            "output": output_path,
            "beats_exported": 4,
            "tempo_bpm": 120.0,
            "dry_run": True,
        }

    with Progress(total=1, label="analysing audio") as p:
        result = _analyze(audio_path)
        p.advance()

    mid = mido.MidiFile()
    track = mido.MidiTrack()
    mid.tracks.append(track)

    tempo = mido.bpm2tempo(result.beats.tempo_bpm)
    track.append(mido.MetaMessage("set_tempo", tempo=tempo, time=0))
    track.append(mido.MetaMessage("time_signature", numerator=4, denominator=4, time=0))

    ticks_per_beat = mid.ticks_per_beat
    prev_ticks = 0

    for i, beat_time in enumerate(result.beats.beat_times):
        beat_ticks = int(beat_time * ticks_per_beat * result.beats.tempo_bpm / 60)
        delta = max(0, beat_ticks - prev_ticks)

        bar_position = i % 4
        vel = velocity if bar_position == 0 else velocity - 20

        track.append(mido.Message("note_on", note=note, velocity=vel, time=delta))
        track.append(mido.Message("note_off", note=note, velocity=0, time=10))
        prev_ticks = beat_ticks + 10

    mid.save(output_path)
    return {
        "file": audio_path,
        "output": output_path,
        "beats_exported": len(result.beats.beat_times),
        "tempo_bpm": result.beats.tempo_bpm,
    }


def export_midi_energy_cc(
    audio_path: str,
    output_path: str,
    cc_number: int = 1,
    *,
    dry_run: bool = False,
) -> dict:
    """Export energy envelope as MIDI CC (Control Change)."""
    try:
        import mido
    except ImportError:
        return {"error": "mido not installed. Run: pip install mido"}

    if dry_run:
        return {
            "file": audio_path,
            "output": output_path,
            "cc_points": 100,
            "cc_number": cc_number,
            "dry_run": True,
        }

    with Progress(total=1, label="analysing audio") as p:
        result = _analyze(audio_path)
        p.advance()

    mid = mido.MidiFile()
    track = mido.MidiTrack()
    mid.tracks.append(track)

    tempo = mido.bpm2tempo(result.beats.tempo_bpm)
    track.append(mido.MetaMessage("set_tempo", tempo=tempo, time=0))

    envelope = result.waveform.amplitude_envelope
    duration = result.waveform.duration_seconds
    ticks_per_second = mid.ticks_per_beat * result.beats.tempo_bpm / 60

    prev_ticks = 0
    for i, energy in enumerate(envelope):
        time_pos = (i / len(envelope)) * duration
        ticks = int(time_pos * ticks_per_second)
        delta = max(0, ticks - prev_ticks)

        cc_value = _clamp_cc(energy)
        track.append(mido.Message("control_change", control=cc_number, value=cc_value, time=delta))
        prev_ticks = ticks

    mid.save(output_path)
    return {
        "file": audio_path,
        "output": output_path,
        "cc_points": len(envelope),
        "cc_number": cc_number,
    }


# ---------------------------------------------------------------------------
# OSC exports
# ---------------------------------------------------------------------------

def export_osc_stream(
    audio_path: str,
    port: int = 9000,
    host: str = "127.0.0.1",
    *,
    dry_run: bool = False,
) -> dict:
    """Stream audio features as OSC messages in real-time."""
    try:
        from pythonosc import udp_client
    except ImportError:
        return {"error": "python-osc not installed. Run: pip install python-osc"}

    if dry_run:
        return {
            "file": audio_path,
            "host": host,
            "port": port,
            "beats_sent": 4,
            "dry_run": True,
        }

    with Progress(total=1, label="analysing audio") as p:
        result = _analyze(audio_path)
        p.advance()

    client = udp_client.SimpleUDPClient(host, port)

    client.send_message("/tempo", result.beats.tempo_bpm)
    client.send_message("/duration", result.waveform.duration_seconds)

    print(f"Streaming OSC to {host}:{port}")
    print(f"Tempo: {result.beats.tempo_bpm} BPM")
    print(f"Duration: {result.waveform.duration_seconds:.1f}s")
    print(f"Beats: {len(result.beats.beat_times)}")
    print("Press Ctrl+C to stop...")

    start_time = time.time()
    beat_idx = 0
    envelope = result.waveform.amplitude_envelope

    try:
        while True:
            elapsed = time.time() - start_time

            while beat_idx < len(result.beats.beat_times) and result.beats.beat_times[beat_idx] <= elapsed:
                client.send_message("/beat", 1.0)
                beat_idx += 1

            energy_idx = int((elapsed / result.waveform.duration_seconds) * len(envelope))
            if energy_idx < len(envelope):
                client.send_message("/energy", envelope[energy_idx])

            if elapsed > result.waveform.duration_seconds:
                break

            time.sleep(0.05)
    except KeyboardInterrupt:
        pass

    return {
        "file": audio_path,
        "host": host,
        "port": port,
        "beats_sent": beat_idx,
    }


def export_osc_file(
    audio_path: str,
    output_path: str,
    *,
    dry_run: bool = False,
) -> dict:
    """Export audio features as OSC timeline file."""
    if dry_run:
        return {
            "file": audio_path,
            "output": output_path,
            "messages": 10,
            "dry_run": True,
        }

    with Progress(total=1, label="analysing audio") as p:
        result = _analyze(audio_path)
        p.advance()

    osc_data = {
        "metadata": {
            "file": audio_path,
            "tempo_bpm": result.beats.tempo_bpm,
            "duration": result.waveform.duration_seconds,
        },
        "messages": [],
    }

    osc_data["messages"].append({
        "time": 0.0,
        "address": "/tempo",
        "args": [result.beats.tempo_bpm],
    })

    for i, beat_time in enumerate(result.beats.beat_times):
        bar_position = i % 4
        intensity = 1.0 if bar_position == 0 else 0.7
        osc_data["messages"].append({
            "time": round(beat_time, 3),
            "address": "/beat",
            "args": [intensity],
        })

    envelope = result.waveform.amplitude_envelope
    duration = result.waveform.duration_seconds
    for i in range(0, len(envelope), 10):
        time_pos = (i / len(envelope)) * duration
        osc_data["messages"].append({
            "time": round(time_pos, 3),
            "address": "/energy",
            "args": [round(envelope[i], 3)],
        })

    osc_data["messages"].sort(key=operator.itemgetter("time"))

    if not dry_run:
        with open(output_path, "w") as f:
            json.dump(osc_data, f, indent=2)

    return {
        "file": audio_path,
        "output": output_path,
        "messages": len(osc_data["messages"]),
    }


# ---------------------------------------------------------------------------
# JSON export
# ---------------------------------------------------------------------------

def export_features_json(
    audio_path: str,
    output_path: str,
    *,
    dry_run: bool = False,
) -> dict:
    """Export all audio features as JSON for custom integrations."""
    if dry_run:
        return {
            "file": audio_path,
            "output": output_path,
            "features": [
                "tempo_bpm", "duration", "sample_rate", "beat_times",
                "beat_count", "onset_times", "energy_envelope",
            ],
            "dry_run": True,
        }

    with Progress(total=1, label="analysing audio") as p:
        result = _analyze(audio_path)
        p.advance()

    data = {
        "file": audio_path,
        "tempo_bpm": result.beats.tempo_bpm,
        "duration": result.waveform.duration_seconds,
        "sample_rate": result.waveform.sample_rate,
        "beat_times": result.beats.beat_times,
        "beat_count": len(result.beats.beat_times),
        "onset_times": result.beats.onset_times,
        "energy_envelope": result.waveform.amplitude_envelope,
        "rms_energy": result.waveform.rms_energy[:100],
        "zero_crossing_rate": result.waveform.zero_crossing_rate[:100],
        "spectral_centroid": result.waveform.centroid[:100] if result.waveform.centroid else [],
        "spectral_rolloff": result.waveform.spectral_rolloff[:100] if result.waveform.spectral_rolloff else [],
        "keyframes_24fps": [round(t * 24) for t in result.beats.beat_times],
        "keyframes_30fps": [round(t * 30) for t in result.beats.beat_times],
        "keyframes_60fps": [round(t * 60) for t in result.beats.beat_times],
    }

    if not dry_run:
        with open(output_path, "w") as f:
            json.dump(data, f, indent=2)

    return {
        "file": audio_path,
        "output": output_path,
        "features": list(data.keys()),
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Export audio features as MIDI, OSC, or JSON",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # Export beat times as MIDI
    python tools/audio_export.py midi "E:/Music/song.mp3" --output output/midi/

    # Export energy as MIDI CC
    python tools/audio_export.py midi-cc "E:/Music/song.mp3" --output output/midi/

    # Stream OSC live
    python tools/audio_export.py osc "E:/Music/song.mp3" --port 9000

    # Export OSC to file
    python tools/audio_export.py osc-file "E:/Music/song.mp3" --output output/osc/

    # Export all features as JSON
    python tools/audio_export.py json "E:/Music/song.mp3" --output output/features/

    # Dry-run: report what would be done without writing
    python tools/audio_export.py midi "E:/Music/song.mp3" --dry-run
        """,
    )
    parser.add_argument(
        "--version", action="version", version=f"audio_export {__version__}"
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="Debug logging")
    parser.add_argument("-q", "--quiet", action="store_true", help="Warnings only")
    parser.add_argument(
        "--dry-run", action="store_true", help="Report what would be done without writing"
    )
    parser.add_argument(
        "command",
        choices=["midi", "midi-cc", "osc", "osc-file", "json"],
        help="Export format",
    )
    parser.add_argument("audio_file", help="Path to audio file")
    parser.add_argument("--output", "-o", help="Output file or directory")
    parser.add_argument("--port", type=int, default=9000, help="OSC UDP port (default: 9000)")
    parser.add_argument("--host", default="127.0.0.1", help="OSC host (default: 127.0.0.1)")
    parser.add_argument("--note", type=int, default=60, help="MIDI note number (default: 60)")
    parser.add_argument("--velocity", type=int, default=100, help="MIDI velocity (default: 100)")
    parser.add_argument("--cc", type=int, default=1, help="MIDI CC number (default: 1)")

    args = parser.parse_args()

    # Re-configure logging after parsing verbosity flags
    from tools.lib.cli_base import setup_logging as _setup  # noqa: E402

    global logger
    logger = _setup(verbose=args.verbose, quiet=args.quiet)

    audio_path = Path(args.audio_file)
    if not audio_path.exists():
        raise CLIError(f"File not found: {args.audio_file}")

    if args.output:
        output = args.output
    else:
        stem = audio_path.stem
        output = str(output_dir("export") / stem)

    dry_run = args.dry_run

    result: dict = {}
    if args.command == "midi":
        if not output.endswith(".mid"):
            Path(output).mkdir(parents=True, exist_ok=True)
            output = str(Path(output) / f"{audio_path.stem}_beats.mid")
        result = export_midi_beats(args.audio_file, output, args.note, args.velocity, dry_run=dry_run)
    elif args.command == "midi-cc":
        if not output.endswith(".mid"):
            Path(output).mkdir(parents=True, exist_ok=True)
            output = str(Path(output) / f"{audio_path.stem}_energy.mid")
        result = export_midi_energy_cc(args.audio_file, output, args.cc, dry_run=dry_run)
    elif args.command == "osc":
        result = export_osc_stream(args.audio_file, args.port, args.host, dry_run=dry_run)
    elif args.command == "osc-file":
        if not output.endswith(".json"):
            Path(output).mkdir(parents=True, exist_ok=True)
            output = str(Path(output) / f"{audio_path.stem}_osc.json")
        result = export_osc_file(args.audio_file, output, dry_run=dry_run)
    elif args.command == "json":
        if not output.endswith(".json"):
            Path(output).mkdir(parents=True, exist_ok=True)
            output = str(Path(output) / f"{audio_path.stem}_features.json")
        result = export_features_json(args.audio_file, output, dry_run=dry_run)
    else:
        parser.print_help()
        return 1

    if "error" in result:
        raise CLIError(result["error"])

    json_print(result)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except CLIError as exc:
        logger.error("%s", exc)
        sys.exit(1)
