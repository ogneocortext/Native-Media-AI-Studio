#!/usr/bin/env python3
"""Analyze a track: tempo, key, dynamics, spectral balance, stereo, clipping."""
import json, subprocess, sys, os
import numpy as np

SRC = sys.argv[1]
OUT = sys.argv[2]
os.makedirs(OUT, exist_ok=True)
WAV = os.path.join(OUT, "decoded.wav")

subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", SRC, "-ar", "44100",
                "-ac", "2", "-c:a", "pcm_s16le", WAV], check=True)

import librosa

y_stereo, sr = librosa.load(WAV, sr=44100, mono=False)
y = librosa.to_mono(y_stereo)
dur = librosa.get_duration(y=y, sr=sr)

res = {"duration_s": round(dur, 1)}

def _t(t):
    return round(float(np.atleast_1d(t)[0]), 1)

# --- tempo & beats (full track + halves for drift check) ---
tempo, beats = librosa.beat.beat_track(y=y, sr=sr)
res["tempo_bpm"] = _t(tempo)
res["beat_count"] = int(len(beats))
mid = len(y) // 2
t1, _ = librosa.beat.beat_track(y=y[:mid], sr=sr)
t2, _ = librosa.beat.beat_track(y=y[mid:], sr=sr)
res["tempo_first_half"] = _t(t1)
res["tempo_second_half"] = _t(t2)
res["tempo_drift_bpm"] = round(abs(_t(t1) - _t(t2)), 2)

# --- key estimate via chroma vs Krumhansl templates ---
chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
chroma_mean = chroma.mean(axis=1)
major = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
minor = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
key_scores = []
for i in range(12):
    for tmpl, mode in ((major, "major"), (minor, "minor")):
        r = np.corrcoef(chroma_mean, np.roll(tmpl, i))[0, 1]
        key_scores.append((float(r), f"{names[i]} {mode}"))
key_scores.sort(key=lambda x: x[0], reverse=True)
res["estimated_key"] = key_scores[0][1]
res["key_confidence_r"] = round(key_scores[0][0], 3)
res["key_runner_up"] = key_scores[1][1]
res["key_runner_up_r"] = round(key_scores[1][0], 3)

# --- dynamics: RMS energy curve ---
rms = librosa.feature.rms(y=y, frame_length=4096, hop_length=2048)[0]
times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=2048)
rms_db = librosa.amplitude_to_db(rms, ref=np.max)
res["dynamic_range_db"] = round(float(rms_db.max() - np.percentile(rms_db, 5)), 1)
q = int(np.argmin(rms)); p = int(np.argmax(rms))
res["quietest_moment_s"] = round(float(times[q]), 1)
res["loudest_moment_s"] = round(float(times[p]), 1)

# --- spectral balance ---
cent = librosa.feature.spectral_centroid(y=y, sr=sr)[0]
roll = librosa.feature.spectral_rolloff(y=y, sr=sr, roll_percent=0.85)[0]
contrast = librosa.feature.spectral_contrast(y=y, sr=sr)
bw = librosa.feature.spectral_bandwidth(y=y, sr=sr)[0]
res["spectral_centroid_hz"] = round(float(np.mean(cent)))
res["spectral_rolloff_85_hz"] = round(float(np.mean(roll)))
res["spectral_bandwidth_hz"] = round(float(np.mean(bw)))
res["spectral_contrast_db"] = [round(float(v), 1) for v in contrast.mean(axis=1)]

# band energy: sub / low-mid / presence / air
S = np.abs(librosa.stft(y, n_fft=4096)) ** 2
freqs = librosa.fft_frequencies(sr=sr, n_fft=4096)
bands = {"sub_20_120": (20, 120), "lowmid_120_500": (120, 500),
         "mid_500_2k": (500, 2000), "presence_2k_8k": (2000, 8000),
         "air_8k_20k": (8000, 20000)}
tot = S.sum()
res["band_energy_pct"] = {k: round(float(S[(freqs >= lo) & (freqs < hi)].sum() / tot * 100), 1)
                          for k, (lo, hi) in bands.items()}

# --- stereo image ---
L, R = y_stereo[0], y_stereo[1]
corr = float(np.corrcoef(L, R)[0, 1])
side = (L - R) / 2
midch = (L + R) / 2
width_ratio = float(np.sqrt(np.mean(side ** 2)) / (np.sqrt(np.mean(midch ** 2)) + 1e-9))
res["stereo_correlation"] = round(corr, 3)
res["stereo_width_side_mid_ratio"] = round(width_ratio, 3)

# --- clipping / near-peak sample count ---
peak = float(np.max(np.abs(y_stereo)))
near_clip = int(np.sum(np.abs(y_stereo) >= 0.999))
res["peak_linear"] = round(peak, 4)
res["peak_dbfs"] = round(float(20 * np.log10(peak + 1e-12)), 2)
res["samples_near_clip"] = near_clip
res["rms_dbfs"] = round(float(20 * np.log10(np.sqrt(np.mean(y ** 2)) + 1e-12)), 1)

with open(os.path.join(OUT, "analysis.json"), "w") as f:
    json.dump(res, f, indent=2)
print(json.dumps(res, indent=2))

# --- visuals ---
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import librosa.display

fig, ax = plt.subplots(2, 1, figsize=(14, 8), sharex=True)
D = librosa.amplitude_to_db(np.abs(librosa.stft(y, n_fft=4096, hop_length=1024)), ref=np.max)
img = librosa.display.specshow(D, sr=sr, hop_length=1024, x_axis="time", y_axis="log", ax=ax[0], cmap="magma")
ax[0].set_title("Spectrogram (log freq)")
fig.colorbar(img, ax=ax[0], format="%+2.0f dB")
ax[1].plot(times, rms_db, color="cyan", lw=0.8)
ax[1].set_ylim(-60, 3); ax[1].set_title("Energy over time (dB)")
ax[1].set_xlabel("seconds")
beat_times = librosa.frames_to_time(beats, sr=sr)
for bt in beat_times[::4]:
    ax[1].axvline(bt, color="white", alpha=0.15, lw=0.5)
fig.tight_layout()
fig.savefig(os.path.join(OUT, "spectrogram.png"), dpi=90)
print("saved spectrogram.png")
