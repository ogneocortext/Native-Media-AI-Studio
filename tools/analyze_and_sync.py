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

import sys
import os
import json
import argparse

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "packages", "backend"))

import numpy as np
import librosa

def analyze_audio(audio_path, fps=24):
    """Analyze audio and return beat data for Unity animation."""
    
    print(f"Loading: {audio_path}")
    y, sr = librosa.load(audio_path, sr=22050, mono=True)
    duration = len(y) / sr
    
    # Try GPU analysis first
    try:
        from app.services.cuda import cuda_audio, cuda_available
        if cuda_available():
            print("Using GPU audio analysis...")
            result = cuda_audio.analyze(y)
            print(f"  Computed on: {result['computed_on']}")
    except Exception as e:
        print(f"GPU analysis failed ({e}), using CPU...")
    
    # Beat tracking
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, hop_length=512)
    beat_times = librosa.frames_to_time(beats, sr=sr, hop_length=512).tolist()
    
    # Convert to animation keyframes
    keyframes = [round(t * fps) for t in beat_times]
    
    data = {
        "tempo": float(tempo[0]) if isinstance(tempo, np.ndarray) else float(tempo),
        "fps": fps,
        "duration": duration,
        "beat_count": len(beat_times),
        "beat_times": [round(t, 3) for t in beat_times],
        "keyframes": keyframes,
        "audio_file": audio_path
    }
    
    return data

def main():
    parser = argparse.ArgumentParser(description="Analyze audio for Unity beat-sync")
    parser.add_argument("audio_file", help="Path to audio file (wav/mp3)")
    parser.add_argument("--output", "-o", help="Output JSON file path")
    parser.add_argument("--fps", type=int, default=24, help="Animation FPS (default: 24)")
    
    args = parser.parse_args()
    
    if not os.path.exists(args.audio_file):
        print(f"Error: File not found: {args.audio_file}")
        sys.exit(1)
    
    data = analyze_audio(args.audio_file, args.fps)
    
    # Print summary
    print(f"\n=== Audio Analysis ===")
    print(f"Tempo: {data['tempo']:.1f} BPM")
    print(f"Duration: {data['duration']:.2f}s")
    print(f"Beats: {data['beat_count']}")
    print(f"First 8 beats: {data['beat_times'][:8]}")
    
    # Save to JSON
    output_path = args.output or os.path.join(
        os.path.dirname(__file__), "beat_data.json"
    )
    with open(output_path, "w") as f:
        json.dump(data, f, indent=2)
    print(f"\nSaved to: {output_path}")

if __name__ == "__main__":
    main()
