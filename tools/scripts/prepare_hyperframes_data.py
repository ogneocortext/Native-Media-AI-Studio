#!/usr/bin/env python3
"""Prepare HyperFrames data for Built This From A Dream."""
import json, re, math
from pathlib import Path

ROOT = Path("tools/hyperframes-built-this-from-a-dream")
ROOT.mkdir(parents=True, exist_ok=True)

# ── 1. Parse LRC ──────────────────────────────────────────────────────────────
lrc_path = Path("output/audio/NeoCortext - Built This From A Dream.lrc")
lrc_text = lrc_path.read_text(encoding="utf-8")

time_re = re.compile(r"^\[(\d+):(\d+\.\d+)\](.*)$")
lyrics = []
for line in lrc_text.splitlines():
    m = time_re.match(line.strip())
    if not m:
        continue
    minutes = int(m.group(1))
    seconds = float(m.group(2))
    text = m.group(3).strip()
    if not text:
        continue
    # skip metadata tags like [ti:...] [ar:...]
    if text.startswith("[") and text.endswith("]"):
        continue
    lyrics.append({"time": minutes * 60 + seconds, "text": text})

# Build lyric lines with start/end (next line time = end)
for i, line in enumerate(lyrics):
    start = line.pop("time")
    next_start = lyrics[i + 1]["time"] if i + 1 < len(lyrics) else start + 5.0
    line["start"] = start
    line["end"] = next_start
    line["section"] = "verse"
    # Detect section markers
    txt = line["text"].lower()
    if txt in {"intro"} or "blue light" in txt:
        line["section"] = "intro"
    elif txt in {"verse"} or "started this thing" in txt.lower():
        line["section"] = "verse"
    elif txt in {"drop"} or "piece by piece" in txt.lower():
        line["section"] = "drop"
    elif txt in {"final drop"} or "it finally works" in txt.lower():
        line["section"] = "final_drop"

# Better section detection based on known LRC markers
sections = []
section_keywords = {
    "intro": ["[intro]"],
    "verse": ["[verse]"],
    "drop": ["[drop]"],
    "final_drop": ["[final drop]"],
}

def detect_section(text):
    t = text.lower()
    for sec, markers in section_keywords.items():
        for m in markers:
            if m in t:
                return sec
    return None

current_section = "intro"
for line in lyrics:
    detected = detect_section(line["text"])
    if detected:
        current_section = detected
    line["section"] = current_section

lyrics_path = ROOT / "lyrics.json"
lyrics_path.write_text(json.dumps({"lyrics": lyrics}, indent=2), encoding="utf-8")
print(f"Wrote {lyrics_path} ({len(lyrics)} lines)")

# ── 2. Build HyperFrames audio data from beat_data.json ───────────────────────
beat_path = Path("tools/output/built_this_from_a_dream_beat_data.json")
beat_data = json.loads(beat_path.read_text(encoding="utf-8"))

tempo = beat_data["tempo"]
duration = beat_data["duration"]
beat_times = beat_data["beat_times"]
fps = 24
total_frames = int(math.ceil(duration * fps))

# Build a simple energy curve from beat density (windowed)
window_sec = 2.0
energy_curve = []
for f in range(total_frames):
    t = f / fps
    t0 = max(0.0, t - window_sec / 2)
    t1 = min(duration, t + window_sec / 2)
    count = sum(1 for bt in beat_times if t0 <= bt < t1)
    energy_curve.append({"time": round(t, 3), "value": min(1.0, count / 8.0)})

# Build per-frame bands (simulated from beat proximity + energy)
# We don't have real FFT bands, so synthesize plausible ones from energy + beat phase
frames = []
beat_idx = 0
for f in range(total_frames):
    t = f / fps
    # Find nearest beat
    nearest_dist = 999.0
    nearest_idx = -1
    while beat_idx < len(beat_times) - 1 and beat_times[beat_idx + 1] <= t:
        beat_idx += 1
    if beat_idx < len(beat_times):
        d = abs(beat_times[beat_idx] - t)
        if d < nearest_dist:
            nearest_dist = d
            nearest_idx = beat_idx
    if nearest_idx + 1 < len(beat_times):
        d2 = abs(beat_times[nearest_idx + 1] - t)
        if d2 < nearest_dist:
            nearest_dist = d2

    beat_phase = max(0.0, 1.0 - min(nearest_dist / 0.25, 1.0))  # 0..1, 1=on beat
    e = energy_curve[f]["value"] if f < len(energy_curve) else 0.5

    # Simple band synthesis
    bass = min(1.0, e * 1.2 + beat_phase * 0.3)
    low_mid = min(1.0, e * 0.9 + beat_phase * 0.15)
    mid = min(1.0, e * 0.7 + (1.0 - beat_phase) * 0.2)
    upper_mid = min(1.0, e * 0.5 + (1.0 - beat_phase) * 0.25)
    presence = min(1.0, e * 0.4 + (1.0 - beat_phase) * 0.2)
    brilliance = min(1.0, e * 0.3 + (1.0 - beat_phase) * 0.15)
    air = min(1.0, e * 0.2 + (1.0 - beat_phase) * 0.1)

    frames.append({
        "time": round(t, 3),
        "bands": [round(bass, 3), round(low_mid, 3), round(mid, 3), round(upper_mid, 3), round(presence, 3), round(brilliance, 3), round(air, 3)],
    })

audio_data = {
    "fps": fps,
    "duration": duration,
    "tempo": tempo,
    "beat_count": len(beat_times),
    "beat_times": beat_times,
    "total_frames": total_frames,
    "energy_curve": energy_curve,
    "frames": frames,
}

audio_path = ROOT / "audio-data.json"
audio_path.write_text(json.dumps(audio_data), encoding="utf-8")
print(f"Wrote {audio_path} ({total_frames} frames, {len(beat_times)} beats)")
