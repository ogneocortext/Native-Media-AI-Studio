import sys
sys.path.insert(0, r"D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\packages\backend")

import numpy as np
import librosa
from app.services.cuda import cuda_audio, cuda_available

print(f"CUDA available: {cuda_available()}")
print(f"Sample rate: {cuda_audio.sample_rate} Hz")

# Load a real track
audio_path = r"D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\output\audio\The Architect's Ghost (Synthwave Mix).wav"
print(f"\nLoading: {audio_path}")

y, sr = librosa.load(audio_path, sr=22050, mono=True)
print(f"Duration: {len(y)/sr:.2f}s, Samples: {len(y)}")

# GPU-accelerated analysis
print("\nRunning GPU audio analysis...")
result = cuda_audio.analyze(y)

print(f"\nAnalysis complete:")
print(f"  Computed on: {result['computed_on']}")
print(f"  Frames: {result['n_frames']}")
print(f"  Duration: {result['duration_seconds']:.2f}s")
print(f"  Spectral centroid samples: {len(result['spectral_centroid'])}")
print(f"  Spectral rolloff samples: {len(result['spectral_rolloff'])}")
print(f"  Spectral bandwidth samples: {len(result['spectral_bandwidth'])}")
print(f"  Onset envelope samples: {len(result['onset_envelope'])}")

# Get beat times for animation sync
tempo, beats = librosa.beat.beat_track(y=y, sr=sr, hop_length=cuda_audio.hop_length)
beat_times = librosa.frames_to_time(beats, sr=sr, hop_length=cuda_audio.hop_length).tolist()

print(f"\n  Tempo: {float(tempo[0]):.1f} BPM")
print(f"  Beats detected: {len(beat_times)}")
print(f"  First 10 beat times: {beat_times[:10]}")
