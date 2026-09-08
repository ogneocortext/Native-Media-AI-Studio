#!/usr/bin/env python3
"""Generate a compact HyperFrames-ready data payload."""
import json, math
from pathlib import Path

ROOT = Path("tools/hyperframes-built-this-from-a-dream")
beat_data = json.loads(Path("tools/output/built_this_from_a_dream_beat_data.json").read_text())
lyrics = json.loads((ROOT / "lyrics.json").read_text())["lyrics"]

tempo = beat_data["tempo"]
duration = beat_data["duration"]
beat_times = beat_data["beat_times"]
fps = 24
total_frames = int(math.ceil(duration * fps))

# ── Simplified energy curve (windowed beat density) ───────────────────────────
window_sec = 2.0
energy_curve = []
for f in range(total_frames):
    t = f / fps
    t0 = max(0.0, t - window_sec / 2)
    t1 = min(duration, t + window_sec / 2)
    count = sum(1 for bt in beat_times if t0 <= bt < t1)
    energy_curve.append(round(min(1.0, count / 8.0), 3))

# ── Simplified per-frame bands (downsample to ~10fps for size) ───────────────
band_frames = []
step = max(1, int(fps / 10))  # every 100ms at 24fps
for f in range(0, total_frames, step):
    t = f / fps
    # nearest beat distance
    nearest = min(beat_times, key=lambda bt: abs(bt - t)) if beat_times else 0
    dist = abs(nearest - t)
    beat_phase = max(0.0, 1.0 - min(dist / 0.25, 1.0))
    e = energy_curve[f] if f < len(energy_curve) else 0.5
    bass = round(min(1.0, e * 1.2 + beat_phase * 0.3), 3)
    low_mid = round(min(1.0, e * 0.9 + beat_phase * 0.15), 3)
    mid = round(min(1.0, e * 0.7 + (1.0 - beat_phase) * 0.2), 3)
    upper_mid = round(min(1.0, e * 0.5 + (1.0 - beat_phase) * 0.25), 3)
    presence = round(min(1.0, e * 0.4 + (1.0 - beat_phase) * 0.2), 3)
    brilliance = round(min(1.0, e * 0.3 + (1.0 - beat_phase) * 0.15), 3)
    air = round(min(1.0, e * 0.2 + (1.0 - beat_phase) * 0.1), 3)
    band_frames.append({
        "t": round(t, 2),
        "b": [bass, low_mid, mid, upper_mid, presence, brilliance, air]
    })

payload = {
    "fps": fps,
    "duration": duration,
    "tempo": round(tempo, 2),
    "beat_times": [round(bt, 3) for bt in beat_times],
    "energy_curve": energy_curve,
    "band_frames": band_frames,
    "lyrics": lyrics,
}

out_path = ROOT / "data.json"
out_path.write_text(json.dumps(payload), encoding="utf-8")
print(f"Wrote {out_path} ({out_path.stat().st_size // 1024} KB)")
