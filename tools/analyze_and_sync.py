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
    
    # GPU + CPU overlap per CUDA Programming Guide 2.5 (Async Execution)
    # Launch GPU STFT on a non-default stream while CPU does beat tracking
    gpu_future = None
    gpu_stream = None
    try:
        from app.services.cuda import cuda_audio, cuda_available
        if cuda_available():
            import torch
            print("Using GPU audio analysis (stream overlapped)...")
            gpu_stream = torch.cuda.Stream()
            # Capture result holder to synchronize later
            gpu_result = {}

            def _launch():
                with torch.cuda.stream(gpu_stream):
                    gpu_result["data"] = cuda_audio.analyze(y)

            # Launch async — don't block CPU
            _launch()
            gpu_future = gpu_result
    except Exception as e:
        print(f"GPU analysis failed ({e}), using CPU...")
        gpu_future = None
    
    # Beat tracking runs concurrently with GPU on CPU (overlapped)
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, hop_length=512)
    beat_times = librosa.frames_to_time(beats, sr=sr, hop_length=512).tolist()

    # Ensure GPU work finished before returning (Guide 2.5: explicit sync)
    if gpu_future is not None and gpu_stream is not None:
        try:
            import torch
            gpu_stream.synchronize()
            result = gpu_future.get("data") if isinstance(gpu_future, dict) else None
            if result:
                print(f"  GPU computed on: {result['computed_on']} ({result['n_frames']} frames)")
        except Exception as e:
            print(f"  GPU sync warning: {e}")
    
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
