#!/usr/bin/env python3
"""Re-render the spectrogram figure with consistent hop_length."""
import os, sys
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import librosa
import librosa.display

WAV = sys.argv[1]
OUT = sys.argv[2]
os.makedirs(OUT, exist_ok=True)

y, sr = librosa.load(WAV, sr=44100, mono=True)
N_FFT, HOP = 4096, 1024

fig, ax = plt.subplots(2, 1, figsize=(14, 8), sharex=True)
D = librosa.amplitude_to_db(np.abs(librosa.stft(y, n_fft=N_FFT, hop_length=HOP)), ref=np.max)
img = librosa.display.specshow(D, sr=sr, hop_length=HOP, x_axis="time",
                               y_axis="log", ax=ax[0], cmap="magma")
ax[0].set_title("Spectrogram (log freq)")
fig.colorbar(img, ax=ax[0], format="%+2.0f dB")

rms = librosa.feature.rms(y=y, frame_length=4096, hop_length=2048)[0]
times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=2048)
rms_db = librosa.amplitude_to_db(rms, ref=np.max)
ax[1].plot(times, rms_db, color="cyan", lw=0.8)
ax[1].set_ylim(-60, 3)
ax[1].set_title("Energy over time (dB)")
ax[1].set_xlabel("seconds")
tempo, beats = librosa.beat.beat_track(y=y, sr=sr)
beat_times = librosa.frames_to_time(beats, sr=sr)
for bt in beat_times[::4]:
    ax[1].axvline(bt, color="white", alpha=0.15, lw=0.5)
fig.tight_layout()
fig.savefig(os.path.join(OUT, "spectrogram.png"), dpi=90)
print("re-rendered spectrogram.png, D frames:", D.shape[1])
