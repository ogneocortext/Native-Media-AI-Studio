#!/usr/bin/env python3
"""Vocal profile for a vocal stem: occupancy, voiced fraction, f0 range.
Usage: vocal_profile.py vocals.mp3
"""
import json, sys
import numpy as np
import librosa

SRC = sys.argv[1]
y, sr = librosa.load(SRC, sr=22050, mono=True)
dur = librosa.get_duration(y=y, sr=sr)

# occupancy: RMS in 2s windows above 8% of max
hop = sr * 2
rms = np.array([np.sqrt(np.mean(y[i:i + hop] ** 2))
                for i in range(0, len(y) - hop, hop)])
thr = rms.max() * 0.08
occ = rms > thr
ranges = []
start = None
for i, v in enumerate(occ):
    if v and start is None:
        start = i * 2
    if not v and start is not None:
        ranges.append([start, i * 2])
        start = None
if start is not None:
    ranges.append([start, len(occ) * 2])

# pitch range on voiced frames
f0, voiced_flag, _ = librosa.pyin(y, fmin=librosa.note_to_hz("C2"),
                                  fmax=librosa.note_to_hz("C6"))
voiced = f0[voiced_flag]

res = {
    "duration_s": round(dur, 1),
    "vocal_occupied_frac": round(float(occ.mean()), 3),
    "vocal_ranges_s": ranges,
    "voiced_frac": round(float(voiced_flag.mean()), 3),
    "f0_hz_min": round(float(np.min(voiced)), 1),
    "f0_hz_max": round(float(np.max(voiced)), 1),
    "f0_hz_median": round(float(np.median(voiced)), 1),
    "f0_note_min": str(librosa.hz_to_note(np.min(voiced))),
    "f0_note_max": str(librosa.hz_to_note(np.max(voiced))),
    "f0_note_median": str(librosa.hz_to_note(np.median(voiced))),
}
print(json.dumps(res, indent=2))
