"""Agent-facing audio profile generator.

Produces a structured, JSON-serializable profile plus a plain-language
description so AI agents can reason about an audio file without decoding
or processing raw samples themselves.

This module is intentionally standalone — it only depends on librosa and
numpy, both already required by the project. It can run directly:
    python tools/audio_agent_profile.py path/to/track.mp3

Or be imported and called programmatically:
    from tools.audio_agent_profile import profile_for_file
    profile = profile_for_file("track.mp3")
    print(profile["agent_description"])
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import librosa
import numpy as np

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _t(v):
    """Safely round a tempo-like value to 1 decimal."""
    return round(float(np.atleast_1d(v)[0]), 1)


def _mean(vals):
    vals = [float(v) for v in vals if v is not None]
    return round(sum(vals) / len(vals), 3) if vals else None


def _clamp01(v: float) -> float:
    return max(0.0, min(1.0, float(v)))


def _load_mono(path: str | Path, sr: int | None = 22050) -> tuple[np.ndarray, int]:
    """Load mono audio, with an ffmpeg fallback for formats soundfile misses."""
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"Audio file not found: {p}")
    try:
        return librosa.load(str(p), sr=sr, mono=True)
    except Exception:
        suffix = p.suffix.lower()
        if suffix not in {".m4a", ".mp4", ".aac"}:
            raise
        ffmpeg = shutil.which("ffmpeg") or shutil.which("ffmpeg.exe")
        if not ffmpeg:
            raise RuntimeError("librosa failed and ffmpeg is unavailable") from None
        handle, tmp_name = tempfile.mkstemp(prefix="kilo_agent_audio_", suffix=".wav")
        os.close(handle)
        try:
            tmp = Path(tmp_name)
            cmd = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-i", str(p)]
            if sr is not None:
                cmd += ["-ar", str(sr)]
            cmd += ["-ac", "1", str(tmp)]
            subprocess.run(cmd, encoding="utf-8", errors="replace", check=True, capture_output=True, text=True)
            return librosa.load(str(tmp), sr=sr, mono=True)
        finally:
            try:
                Path(tmp_name).unlink(missing_ok=True)
            except Exception:
                pass


# ---------------------------------------------------------------------------
# Section detector (onset + energy, beat-snapped)
# ---------------------------------------------------------------------------

def _build_sections(
    duration: float,
    beat_times: list[float],
    onset_times: list[float],
    rms: np.ndarray,
    hop_length: int = 512,
    sr: int = 22050,
) -> list[dict[str, Any]]:
    if duration <= 0 or not beat_times:
        return [{"type": "full", "start": 0.0, "end": round(duration, 2), "energy": 0.5, "confidence": 0.5}]

    # Coarse onset-density histogram
    num_bins = max(4, min(24, int(duration / 6)))
    bin_dur = duration / num_bins
    onset_counts = [
        sum(1 for ot in onset_times if i * bin_dur <= ot < (i + 1) * bin_dur)
        for i in range(num_bins)
    ]
    max_onset = max(onset_counts) if onset_counts else 1

    # RMS energy per section candidate
    def _rms_mean(t_start: float, t_end: float) -> float:
        if rms.size == 0:
            return 0.0
        idx_s = max(0, min(int((t_start / duration) * len(rms)), len(rms) - 1))
        idx_e = max(idx_s + 1, min(int((t_end / duration) * len(rms)), len(rms)))
        window = rms[idx_s:idx_e]
        return float(window.mean()) if window.size else 0.0

    # Candidate boundaries from onset density spikes
    candidates = [0.0]
    for i in range(1, num_bins - 1):
        od = onset_counts[i] / max_onset
        if od > 0.35:
            t_mid = (i + 0.5) * bin_dur
            # snap to nearest beat
            if beat_times:
                nearest = min(beat_times, key=lambda b: abs(b - t_mid))
                if abs(nearest - t_mid) < 0.6:
                    candidates.append(nearest)
                else:
                    candidates.append(t_mid)
            else:
                candidates.append(t_mid)
    candidates.append(duration)
    candidates = sorted({round(b, 2) for b in candidates if 0.0 <= b <= duration})

    # Enforce minimum section duration (4 beats, min 4 s)
    if len(beat_times) > 1:
        beat_interval = float(np.median(np.diff(beat_times)))
        min_sec = max(4.0, (60.0 / max(beat_interval, 0.1)) * 4)
    else:
        min_sec = 4.0
    merged = [candidates[0]]
    for b in candidates[1:]:
        if b - merged[-1] >= min_sec:
            merged.append(b)
        else:
            merged[-1] = round(b, 2)
    # Always have at least a start and end — a single-entry merged list
    # produces a zero-length section. Keep the first candidate (0.0) and
    # append duration as the end.
    if len(merged) < 2:
        merged = [candidates[0], duration]
    elif merged[-1] < duration:
        merged.append(duration)

    energies = [_rms_mean(s, e) for s, e in zip(merged, merged[1:])]
    if not energies:
        return [{"type": "full", "start": 0.0, "end": round(duration, 2), "energy": 0.5, "confidence": 0.5}]

    emin, emax = min(energies), max(energies)
    erange = (emax - emin) or 1.0
    sorted_e = sorted(energies)
    p33 = sorted_e[len(sorted_e) // 3]
    p66 = sorted_e[(len(sorted_e) * 2) // 3]
    onset_dens = [
        sum(1 for ot in onset_times if s <= ot < e)
        for s, e in zip(merged, merged[1:])
    ]
    max_od = max(onset_dens) if onset_dens and max(onset_dens) > 0 else 1
    n = len(merged) - 1
    out = []
    for i in range(n):
        s, e = merged[i], merged[i + 1]
        mean_e = energies[i]
        od = onset_dens[i] / max_od
        norm = (mean_e - emin) / erange
        conf = 0.7
        if i == 0:
            typ = "intro"
            conf = 0.9
        elif i == n - 1:
            typ = "outro"
            conf = 0.9
        elif norm >= 0.66 or mean_e >= p66:
            typ = "chorus"
            conf = 0.8 + norm * 0.15
        elif norm <= 0.33 or mean_e <= p33:
            mid = i >= n // 3 and i <= 2 * n // 3
            if mid and od < 0.4:
                typ = "bridge"
                conf = 0.75
            elif od > 0.6:
                typ = "pre-chorus"
                conf = 0.7
            else:
                typ = "interlude" if mid else "verse"
                conf = 0.65
        else:
            if od > 0.65 and 0 < i < n - 1:
                typ = "pre-chorus"
                conf = 0.7
            else:
                typ = "verse"
                conf = 0.75
        ui_energy = round(min(1.0, max(0.05, (norm * 0.7 + 0.3) if typ in ("chorus", "drop") else norm * 0.6 + 0.2)), 3)
        out.append({
            "type": typ,
            "start": round(float(s), 2),
            "end": round(float(e), 2),
            "energy": ui_energy,
            "confidence": round(min(1.0, conf), 2),
        })
    # Fix overlaps
    for i in range(1, len(out)):
        if out[i]["start"] < out[i - 1]["end"]:
            out[i]["start"] = out[i - 1]["end"]
        if out[i]["end"] <= out[i]["start"]:
            out[i]["end"] = round(min(duration, out[i]["start"] + min_sec), 2)
    return out


# ---------------------------------------------------------------------------
# Agent interpretation
# ---------------------------------------------------------------------------

def _interpret(
    duration: float,
    tempo: float,
    key: str,
    key_conf: float,
    dynamic_range: float,
    band_energy: dict[str, float],
    centroid: float,
    rolloff: float,
    zcr: float,
    stereo_corr: float,
    beat_times: list[float],
    sections: list[dict[str, Any]],
) -> dict[str, Any]:
    sub = band_energy.get("sub_20_120", 0.0)
    lowmid = band_energy.get("lowmid_120_500", 0.0)
    mid = band_energy.get("mid_500_2k", 0.0)
    presence = band_energy.get("presence_2k_8k", 0.0)
    air = band_energy.get("air_8k_20k", 0.0)

    bass_heavy = sub > 28
    bright = centroid > 3000 or rolloff > 8000
    dark = centroid < 1500 and rolloff < 5000
    vocal_presence = presence > 22
    high_energy = any(s.get("energy", 0) > 0.65 for s in sections)
    has_chorus = any(s.get("type") == "chorus" for s in sections)

    # Energy level
    if high_energy and tempo > 135:
        energy_level = "very high"
    elif high_energy or tempo > 120:
        energy_level = "high"
    elif tempo > 100:
        energy_level = "medium"
    else:
        energy_level = "low"

    # Mood tags
    moods: list[str] = []
    if bass_heavy and energy_level in ("high", "very high"):
        moods.append("driving")
    if bright and energy_level in ("high", "very high"):
        moods.append("aggressive")
    if dark and energy_level == "low":
        moods.append("moody")
    if vocal_presence:
        moods.append("vocal-forward")
    if mid > 25 and not bass_heavy:
        moods.append("balanced")
    if air > 15 and bright:
        moods.append("airy")
    if not moods:
        moods.append("neutral")

    # Scene fit (media-agent oriented)
    scene_fit: list[str] = []
    if energy_level == "very high" and bass_heavy:
        scene_fit.extend(["action", "chase", "sports", "title_sequence"])
    elif energy_level == "high" and bright:
        scene_fit.extend(["promo", "trailer", "transition"])
    elif energy_level == "high":
        scene_fit.extend(["montage", "travel", "lifestyle"])
    elif has_chorus and energy_level == "medium":
        scene_fit.extend(["narrative", "emotional_peak", "character_moment"])
    elif energy_level == "low" and dark:
        scene_fit.extend(["horror", "suspense", "quiet_tension"])
    elif energy_level == "low":
        scene_fit.extend(["ambient", "credits", "slow_pan"])
    else:
        scene_fit.append("general")

    # EQ suggestion (ties into the EQ system we already built)
    if bass_heavy and bright:
        eq_preset = "warm"
    elif bass_heavy and not bright:
        eq_preset = "vocalPresence"
    elif bright and not bass_heavy:
        eq_preset = "bassBoost"
    elif energy_level == "low" and dark:
        eq_preset = "bright"
    else:
        eq_preset = "flat"

    # Editing hints
    cut_points = [s["end"] for s in sections if s.get("type") in ("verse", "pre-chorus", "chorus")]
    loop_candidates = [s["start"] for s in sections if s.get("type") == "chorus"]
    best_loop = loop_candidates[0] if loop_candidates else beat_times[0] if beat_times else 0.0

    # Build plain-language description
    mode_str = key.split()[-1] if " " in key else "unknown mode"
    key_name = key.replace(mode_str, "").strip()
    desc_parts = [
        f"{tempo:.1f} BPM {key} ({key_conf:.0%} confidence)",
        f"{duration:.1f}s",
        f"{energy_level} energy",
        f"{', '.join(moods)}",
    ]
    if bass_heavy:
        desc_parts.append(f"bass-heavy ({sub:.1f}% sub-120Hz)")
    if bright:
        desc_parts.append("bright spectral tilt")
    if vocal_presence:
        desc_parts.append("vocal presence range strong")
    description = ". ".join(desc_parts) + "."

    return {
        "energy_level": energy_level,
        "moods": moods[:4],
        "scene_fit": scene_fit[:5],
        "suggested_eq_preset": eq_preset,
        "editing": {
            "cut_points_s": cut_points[:10],
            "best_loop_start_s": round(best_loop, 2),
            "estimated_best_intro_s": round(sections[0]["end"] if sections else 0.0, 2),
        },
        "description": description,
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def profile_for_file(path: str | Path, sr: int | None = 22050) -> dict[str, Any]:
    """Run a full agent profile on *path* and return a JSON-safe dict."""
    p = Path(path)
    y, sr = _load_mono(p, sr=sr)
    dur = float(len(y) / sr)

    # Tempo & beats
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
    beat_times = librosa.frames_to_time(beat_frames, sr=sr).tolist()

    # Key (Krumhansl/Schneider correlation)
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    chroma_mean = chroma.mean(axis=1)
    major = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
    minor = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
    names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    key_scores = []
    for i in range(12):
        for tmpl, mode in ((major, "major"), (minor, "minor")):
            r = float(np.corrcoef(chroma_mean, np.roll(tmpl, i))[0, 1])
            key_scores.append((r, f"{names[i]} {mode}"))
    key_scores.sort(key=lambda x: x[0], reverse=True)
    estimated_key = key_scores[0][1]
    # Correlation can be negative; clamp to [0, 1] so the description never
    # shows a misleading "-30% confidence".
    key_conf = round(max(0.0, min(1.0, key_scores[0][0])), 3)
    # Raw (unclamped) r, under the same key analyze.py uses. Consumers that make
    # decisions from confidence - e.g. the chroma->hue mapper's 0.4 fallback
    # threshold - read key_confidence_r so both analyzers stay interchangeable;
    # key_confidence remains the display-friendly clamped value.
    key_conf_r = round(key_scores[0][0], 3)
    # Runner-up, for the chroma->hue mapper to blend between when confidence is
    # middling (docs/architecture/chroma-hue-mapping.md). analyze.py emits the
    # same pair of keys; keeping both analyzers aligned is deliberate, so a
    # consumer does not have to know which tool produced a given analysis file.
    runner_up_key = key_scores[1][1]
    runner_up_conf = round(key_scores[1][0], 3)

    # Dynamics
    rms = librosa.feature.rms(y=y, frame_length=4096, hop_length=2048)[0]
    rms_db = librosa.amplitude_to_db(rms, ref=np.max)
    dynamic_range = round(float(rms_db.max() - np.percentile(rms_db, 5)), 1)

    # Spectral bands
    S = np.abs(librosa.stft(y, n_fft=4096)) ** 2
    freqs = librosa.fft_frequencies(sr=sr, n_fft=4096)
    band_ranges = {
        "sub_20_120": (20, 120),
        "lowmid_120_500": (120, 500),
        "mid_500_2k": (500, 2000),
        "presence_2k_8k": (2000, 8000),
        "air_8k_20k": (8000, 20000),
    }
    total = float(S.sum())
    band_energy = {
        k: round(float(S[(freqs >= lo) & (freqs < hi)].sum() / total * 100), 1)
        for k, (lo, hi) in band_ranges.items()
    }

    # Spectral summary
    centroid = float(np.mean(librosa.feature.spectral_centroid(y=y, sr=sr)[0]))
    rolloff = float(np.mean(librosa.feature.spectral_rolloff(y=y, sr=sr)[0]))
    zcr = float(np.mean(librosa.feature.zero_crossing_rate(y=y)[0]))

    # Stereo correlation (approximate; falls back to 1.0 on mono decode failure).
    # Load stereo in the same pass as mono to avoid decoding the file twice.
    try:
        y_stereo, _ = librosa.load(str(p), sr=sr, mono=False)
        if y_stereo.ndim == 2 and y_stereo.shape[0] >= 2:
            L, R = y_stereo[0], y_stereo[1]
            if np.std(L) > 0 and np.std(R) > 0:
                stereo_corr = round(float(np.corrcoef(L, R)[0, 1]), 3)
            else:
                stereo_corr = 1.0
        else:
            stereo_corr = 1.0
    except Exception:
        stereo_corr = 1.0

    # Onsets for section detection
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=512)
    onset_frames = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr, units="frames")
    onset_times = librosa.frames_to_time(onset_frames, sr=sr, hop_length=512).tolist()

    sections = _build_sections(dur, beat_times, onset_times, rms, sr=sr)

    agent_profile = _interpret(
        dur, _t(tempo), estimated_key, key_conf, dynamic_range,
        band_energy, centroid, rolloff, zcr, stereo_corr, beat_times, sections,
    )

    return {
        "file": p.name,
        "path": str(p.resolve()),
        "duration_seconds": round(dur, 2),
        "tempo_bpm": _t(tempo),
        "beat_count": len(beat_times),
        "estimated_key": estimated_key,
        "key_confidence": key_conf,
        "key_confidence_r": key_conf_r,
        "key_runner_up": runner_up_key,
        "key_runner_up_r": runner_up_conf,
        "dynamic_range_db": dynamic_range,
        "band_energy_pct": band_energy,
        "spectral": {
            "centroid_mean": round(centroid),
            "rolloff_mean": round(rolloff),
            "zcr_mean": round(zcr, 4),
        },
        "stereo_correlation": stereo_corr,
        "sections": sections,
        "agent_profile": agent_profile,
    }


def describe(path: str | Path, sr: int | None = 22050) -> str:
    """Return a one-paragraph plain-language description of *path*."""
    try:
        profile = profile_for_file(path, sr=sr)
        return profile["agent_profile"]["description"]
    except Exception as exc:
        logger.error("Failed to describe %s: %s", path, exc)
        return f"Analysis unavailable for {Path(path).name}: {exc}"


def main() -> None:
    import argparse
    parser = argparse.ArgumentParser(description="Generate an agent-facing audio profile.")
    parser.add_argument("path", help="Audio file path")
    parser.add_argument("--sr", type=int, default=22050, help="Target sample rate (default 22050)")
    parser.add_argument("--text", action="store_true", help="Print only the plain-language description")
    args = parser.parse_args()

    if args.text:
        print(describe(args.path, sr=args.sr))
    else:
        print(json.dumps(profile_for_file(args.path, sr=args.sr), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
