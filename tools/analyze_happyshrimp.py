import sys
import os
import json
import argparse

# Add backend to path dynamically
backend_path = os.path.join(os.path.dirname(__file__), "..", "packages", "backend")
sys.path.insert(0, backend_path)

import numpy as np
import librosa
from app.services.cuda import cuda_audio, cuda_available

def analyze_audio_file(audio_path, output_path=None):
    """Analyze audio file with GPU acceleration."""
    print(f"CUDA available: {cuda_available()}")
    
    if not os.path.exists(audio_path):
        print(f"Error: Audio file not found: {audio_path}")
        return None
    
    print(f"\nLoading: {audio_path}")
    
    try:
        y, sr = librosa.load(audio_path, sr=22050, mono=True)
        print(f"Duration: {len(y)/sr:.2f}s, Samples: {len(y)}")
        
        # GPU-accelerated analysis
        result = cuda_audio.analyze(y)
        
        # Beat tracking
        tempo, beats = librosa.beat.beat_track(y=y, sr=sr, hop_length=cuda_audio.hop_length)
        beat_times = librosa.frames_to_time(beats, sr=sr, hop_length=cuda_audio.hop_length).tolist()
        
        print(f"\n=== Audio Analysis ===")
        print(f"Computed on: {result['computed_on']}")
        print(f"Tempo: {float(tempo[0]):.1f} BPM")
        print(f"Beats: {len(beat_times)}")
        print(f"First 8 beat times: {[round(t, 2) for t in beat_times[:8]]}")
        
        # Prepare beat data
        beat_data = {
            "tempo": float(tempo[0]),
            "beat_times": beat_times,
            "duration": len(y)/sr,
            "audio_file": audio_path
        }
        
        # Save beat data
        if output_path is None:
            output_path = os.path.join(os.path.dirname(__file__), "..", "output", "beat_data.json")
        
        with open(output_path, "w") as f:
            json.dump(beat_data, f, indent=2)
        print(f"\nBeat data saved to: {output_path}")
        
        return beat_data
        
    except Exception as e:
        print(f"Error during analysis: {e}")
        return None

def main():
    parser = argparse.ArgumentParser(description="Analyze audio file with GPU acceleration")
    parser.add_argument("audio_file", help="Path to audio file (wav/mp3)")
    parser.add_argument("--output", "-o", help="Output JSON file path")
    
    args = parser.parse_args()
    
    result = analyze_audio_file(args.audio_file, args.output)
    
    if result is None:
        sys.exit(1)

if __name__ == "__main__":
    main()
