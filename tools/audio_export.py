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
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
import time
from pathlib import Path

from tools.lib.paths import backend_dir, output_dir
from tools.lib.audio import analyze_audio, load_audio

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def _add_backend_to_path() -> None:
    backend = str(backend_dir())
    if backend not in sys.path:
        sys.path.insert(0, backend)


_add_backend_to_path()


# ---------------------------------------------------------------------------
# MIDI exports
# ---------------------------------------------------------------------------

def export_midi_beats(
    audio_path: str,
    output_path: str,
    note: int = 60,
    velocity: int = 100,
) -> dict:
    """Export beat times as MIDI notes.

    Args:
        audio_path: Path to audio file.
        output_path: Output MIDI file path.
        note: MIDI note number for beats (default: 60 = C4).
        velocity: Note velocity (default: 100).

    Returns:
        Dict with export info.
    """
    try:
        import mido
    except ImportError:
        return {"error": "mido not installed. Run: pip install mido"}

    from app.services.audio_analyzer import AudioAnalyzer

    analyzer = AudioAnalyzer()
    result = analyzer.analyze_file(audio_path)

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
) -> dict:
    """Export energy envelope as MIDI CC (Control Change).

    Useful for controlling filters, effects, or visual parameters
    from a DAW or MIDI controller.

    Args:
        audio_path: Path to audio file.
        output_path: Output MIDI file path.
        cc_number: MIDI CC number (default: 1 = Mod Wheel).

    Returns:
        Dict with export info.
    """
    try:
        import mido
    except ImportError:
        return {"error": "mido not installed. Run: pip install mido"}

    from app.services.audio_analyzer import AudioAnalyzer

    analyzer = AudioAnalyzer()
    result = analyzer.analyze_file(audio_path)

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

        cc_value = int(energy * 127)
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
) -> dict:
    """Stream audio features as OSC messages in real-time.

    Sends beat and energy data over OSC for live visualization
    in TouchDesigner, Max/MSP, Resolume, etc.

    OSC Addresses:
        /beat <float: intensity> — sent on each beat
        /energy <float: 0-1> — sent every 50ms
        /tempo <float: bpm> — sent once at start

    Args:
        audio_path: Path to audio file.
        port: UDP port to send OSC to.
        host: Host to send OSC to.

    Returns:
        Dict with stream info.
    """
    try:
        from pythonosc import udp_client
    except ImportError:
        return {"error": "python-osc not installed. Run: pip install python-osc"}

    from app.services.audio_analyzer import AudioAnalyzer

    analyzer = AudioAnalyzer()
    result = analyzer.analyze_file(audio_path)

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
) -> dict:
    """Export audio features as OSC timeline file.

    Writes timestamped OSC messages to a JSON file that can be
    played back by OSC tools or converted to other formats.

    Args:
        audio_path: Path to audio file.
        output_path: Output JSON file path.

    Returns:
        Dict with export info.
    """
    from app.services.audio_analyzer import AudioAnalyzer

    analyzer = AudioAnalyzer()
    result = analyzer.analyze_file(audio_path)

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

    osc_data["messages"].sort(key=lambda m: m["time"])

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
) -> dict:
    """Export all audio features as JSON for custom integrations.

    Args:
        audio_path: Path to audio file.
        output_path: Output JSON file path.

    Returns:
        Dict with export info.
    """
    from app.services.audio_analyzer import AudioAnalyzer

    analyzer = AudioAnalyzer()
    result = analyzer.analyze_file(audio_path)

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

def main() -> None:
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
        """,
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

    if not os.path.exists(args.audio_file):
        print(f"Error: File not found: {args.audio_file}")
        sys.exit(1)

    if args.output:
        output = args.output
    else:
        stem = Path(args.audio_file).stem
        output = str(output_dir("export") / stem)

    result: dict = {}
    if args.command == "midi":
        if not output.endswith(".mid"):
            os.makedirs(output, exist_ok=True)
            output = os.path.join(output, f"{Path(args.audio_file).stem}_beats.mid")
        result = export_midi_beats(args.audio_file, output, args.note, args.velocity)
    elif args.command == "midi-cc":
        if not output.endswith(".mid"):
            os.makedirs(output, exist_ok=True)
            output = os.path.join(output, f"{Path(args.audio_file).stem}_energy.mid")
        result = export_midi_energy_cc(args.audio_file, output, args.cc)
    elif args.command == "osc":
        result = export_osc_stream(args.audio_file, args.port, args.host)
    elif args.command == "osc-file":
        if not output.endswith(".json"):
            os.makedirs(output, exist_ok=True)
            output = os.path.join(output, f"{Path(args.audio_file).stem}_osc.json")
        result = export_osc_file(args.audio_file, output)
    elif args.command == "json":
        if not output.endswith(".json"):
            os.makedirs(output, exist_ok=True)
            output = os.path.join(output, f"{Path(args.audio_file).stem}_features.json")
        result = export_features_json(args.audio_file, output)
    else:
        parser.print_help()
        sys.exit(1)

    if "error" in result:
        print(f"Error: {result['error']}")
        sys.exit(1)
    else:
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
