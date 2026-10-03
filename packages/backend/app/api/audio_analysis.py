"""
Audio analysis helpers, split out of app/api/audio.py.

Owns: the analysis-result builder (_build_analysis_result), the curve maths it
depends on, the visualization-suggestion heuristics, and section labelling
(heuristic plus the Ollama pass).

No routes live here. These are pure functions over an analysis result; the
endpoints stay in audio.py, which imports them. That is deliberate - unlike the
stem split, there is nothing to re-register in main.py, so the risk is confined
to import errors rather than to the route surface.

Extracted for size, not behaviour. tools/snapshot-audio-routes.py --check is
still the guard for the route surface, and note it cannot see this kind of
change at all: nothing here was a route.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

from fastapi import HTTPException

from ..core.config import PROJECT_ROOT

logger = logging.getLogger(__name__)

# Mirrors audio.py: same value, same derivation. These must not drift, or the
# two modules will disagree about schema versions and where audio lives.
AUDIO_DIR = PROJECT_ROOT / "output" / "audio"

# Moved here from audio.py. It lives with _build_analysis_result, which is its
# only writer, so there is a single definition and a single bump point - audio.py
# imports it back for _analysis_is_stale, which reads it.
#
# Bump when the analysis payload changes shape, so cached results computed by an
# older analyzer are treated as stale instead of being served forever.
#
# Content-addressed uploads (sha256[:8] names) mean a re-upload of the same audio
# now hits the same cache entry every time, which is exactly what makes this
# necessary: without a version stamp, an entry written before a field existed
# would be served indefinitely and the field would never appear. That is the
# state the library was in - key detection was missing from every stored result.
#
# v2: added key detection (estimated_key, key_confidence, key_confidence_r,
#     key_runner_up, key_runner_up_r). Results stamped v1 or lower are stale.
ANALYSIS_SCHEMA_VERSION = 2


def _is_downbeat(index: int, beats_per_bar: int = 4) -> bool:
    """Return True when this beat index is a strong downbeat.

    Meter-aware (beats_per_bar from beat regularity analysis), falling back to
    4/4 when unavailable. Duplicated from audio.py rather than imported: both
    modules are peers, and audio.py imports plenty from here already, so a
    back-import would be circular.
    """
    return index % beats_per_bar == 0



def _check_backend_available(backend: str) -> None:
    """Raise 503 if the requested analysis backend is not installed."""
    from ..services.audio_analyzer import (
        LIBROSA_AVAILABLE,
        MADMOM_AVAILABLE,
        SONARA_AVAILABLE,
    )
    backend = (backend or "sonara").lower()
    if backend == "sonara" and not SONARA_AVAILABLE:
        raise HTTPException(status_code=503, detail="sonara not installed. Run: pip install sonara")
    if backend == "madmom" and not MADMOM_AVAILABLE:
        raise HTTPException(status_code=503, detail="madmom-infer not installed. Run: pip install madmom-infer")
    if backend == "librosa" and not LIBROSA_AVAILABLE:
        raise HTTPException(status_code=503, detail="librosa not installed. Run: pip install librosa soundfile")
    if backend not in ("sonara", "madmom", "librosa"):
        raise HTTPException(status_code=400, detail=f"Unknown backend: {backend}. Choose sonara, madmom, or librosa.")


def _downsample_curve(curve, max_points):
    """Downsample a curve to at most `max_points` points via uniform sampling."""
    if not curve:
        return []
    if max_points < 2:
        return [curve[0]]
    if len(curve) <= max_points:
        return list(curve)
    indices = [int(round(i * (len(curve) - 1) / (max_points - 1))) for i in range(max_points)]
    return [curve[i] for i in indices]


def _rms_at_time(rms, sr, hop_length, time):
    if not rms:
        return 0.5
    frame = int(round(time * sr / hop_length))
    frame = max(0, min(frame, len(rms) - 1))
    return rms[frame]


_RESPONSE_SIZE_CONTRACT = """
Response-size contract for analysis payloads.
Historical bug: the full-resolution RMS envelope (~23k points on a 4-min
track) was emitted four times per response (~2.4 MB JSON) even though
``energy_curve`` is documented as "60-100 points for viz". Curves are now
downsampled once and reused; beats are capped at a level that covers long,
high-tempo tracks instead of silently dropping data at 800.
"""
_ENERGY_CURVE_POINTS = 100
_ENVELOPE_POINTS = 1024
_MAX_BEATS = 4000
# Spectral curves for visualization: 512 points keeps the payload small while
# preserving enough resolution for per-frame brightness/rolloff/noisiness lookups.
_SPECTRAL_POINTS = 512


def _build_analysis_result(
    result,
    unique_id: str,
    file_path: Path,
    analyzer,
) -> dict:
    """Build the standard analysis response dict from an AudioAnalysisResult."""
    tempo = result.beats.tempo_bpm if result.beats else 120.0
    duration = result.waveform.duration_seconds if result.waveform else 0.0
    beat_times_full = list(result.beats.beat_times) if result.beats else []
    onset_times_full = list(result.beats.onset_times) if result.beats else []
    confidence = result.beats.confidence if result.beats else 0.0
    envelope_full = list(result.waveform.amplitude_envelope) if result.waveform else []
    rms = result.waveform.rms_energy if result.waveform and result.waveform.rms_energy else []
    sr = result.waveform.sample_rate if result.waveform else 22050
    hop = analyzer.hop_length

    # Normalize raw RMS to 0..1 so BeatEvent.energy matches the shared contract
    # (it was previously raw RMS, i.e. ~0.05 instead of a 0-1 level).
    if rms:
        rms_peak = max(max(rms), 1e-10)
        rms_norm = [float(v) / rms_peak for v in rms]
    else:
        rms_norm = []

    sections = _generate_sections_from_analysis(
        duration=duration,
        tempo=tempo,
        beat_times=beat_times_full,
        onset_times=onset_times_full,
        rms_energy=rms,
        hop_length=analyzer.hop_length,
        sample_rate=sr,
    )

    # Downsample each curve exactly once and reuse it everywhere it appears.
    envelope = [round(float(v), 4) for v in _downsample_curve(envelope_full, _ENVELOPE_POINTS)]
    energy_curve = [round(float(v), 4) for v in _downsample_curve(envelope_full, _ENERGY_CURVE_POINTS)]

    beat_times = [round(float(t), 3) for t in beat_times_full[:_MAX_BEATS]]
    beats_truncated = len(beat_times_full) > _MAX_BEATS
    downbeat_times = (
        [round(float(t), 3) for t in (result.beats.downbeat_times or [])[:1000]] if result.beats else []
    )
    from ..services.audio_analyzer import detect_meter
    meter = detect_meter(beat_times_full) if beat_times_full else 4
    spectral_summary = _spectral_summary(result)

    viz_suggestion = _suggest_visualization(
        tempo, duration, sections, envelope_full, spectral_summary
    )
    kinetic_suggestion = _suggest_kinetic_preset(tempo, sections)
    theme_suggestion = _suggest_theme_seed(sections, envelope_full)

    return {
        "tempo_bpm": round(float(tempo), 1),
        "duration_seconds": round(float(duration), 2),
        "beat_count": int(len(beat_times_full)),
        "beats_truncated": beats_truncated,
        "sections": sections,
        "beat_times": beat_times,
        "downbeat_times": downbeat_times,
        "onset_times": [round(float(t), 3) for t in onset_times_full[:800]],
        "energy_curve": energy_curve,
        "confidence": round(float(confidence), 3),
        "amplitude_envelope": envelope,
        "spectral": spectral_summary,
        # Full spectral curves for visualization (downsampled to keep payload small).
        # Consumers that only need timbre summary should continue using ``spectral``.
        "spectral_centroid": [
            round(float(v), 3)
            for v in _downsample_curve(
                list(result.waveform.centroid or []), _SPECTRAL_POINTS
            )
        ],
        "spectral_rolloff": [
            round(float(v), 3)
            for v in _downsample_curve(
                list(result.waveform.spectral_rolloff or []), _SPECTRAL_POINTS
            )
        ],
        "spectral_bandwidth": [
            round(float(v), 3)
            for v in _downsample_curve(
                list(result.waveform.spectral_bandwidth or []), _SPECTRAL_POINTS
            )
        ],
        "zero_crossing_rate": [
            round(float(v), 3)
            for v in _downsample_curve(
                list(result.waveform.zero_crossing_rate or []), _SPECTRAL_POINTS
            )
        ],
        "stored_path": str(file_path),
        "relative_path": _relative_audio_path(file_path),
        "job_id": unique_id,
        "metadata": result.metadata,
        # Timing contract for frontend + Remotion + AI agents
        "timing_contract": {
            "filename": file_path.name,
            "duration": round(float(duration), 2),
            "bpm": round(float(tempo), 1),
            "bpmConfidence": round(float(confidence), 3),
            "beats": [
                {
                    "time": bt,
                    "drumType": None,
                    "energy": round(float(_rms_at_time(rms_norm, sr, hop, bt)), 4),
                    # Meter-aware downbeat detection (replaces hardcoded 4/4).
                    "isDownbeat": _is_downbeat(i, meter),
                    "bpm": round(float(tempo), 1),
                }
                for i, bt in enumerate(beat_times)
            ],
            "sections": sections,
            "energyCurve": [
                {"time": round(float(i) * duration / max(len(energy_curve) - 1, 1), 3), "value": v}
                for i, v in enumerate(energy_curve)
            ],
            "amplitudeEnvelope": envelope,
        },
        # Visualization hints for AI/agent-driven preset generation
        "suggested_visualization": viz_suggestion.get("value"),
        "suggested_visualization_confidence": round(viz_suggestion.get("confidence", 0.0), 3),
        "suggested_visualization_candidates": _visualization_candidates(tempo, duration, sections, envelope_full, spectral_summary),
        "suggested_kinetic_preset": kinetic_suggestion.get("value"),
        "suggested_kinetic_preset_confidence": round(kinetic_suggestion.get("confidence", 0.0), 3),
        "suggested_theme_seed": theme_suggestion.get("value"),
        "suggested_theme_seed_confidence": round(theme_suggestion.get("confidence", 0.0), 3),
        # Stamped here rather than at each call site so every producer of an
        # analysis (analyze, analyze-cuda, and anything added later) is covered
        # by one change. A cached result is only reusable while this matches
        # ANALYSIS_SCHEMA_VERSION - see _analysis_is_stale.
        "schema_version": ANALYSIS_SCHEMA_VERSION,
    }


def _relative_audio_path(file_path: Path) -> str:
    """Return the AUDIO_DIR-relative POSIX path, tolerating external paths."""
    try:
        return file_path.relative_to(AUDIO_DIR).as_posix()
    except ValueError:
        return file_path.name


def _spectral_summary(result) -> dict:
    """Compact spectral statistics (means), so agents can reason about timbre.

    Only a handful of numbers per track — the full spectral curves stay in the
    analyzer's own JSON, never in this API payload.
    """
    wf = getattr(result, "waveform", None)
    if wf is None:
        return {}

    def _mean(values):
        vals = [float(v) for v in (values or []) if v is not None]
        if not vals:
            return None
        return round(sum(vals) / len(vals), 3)

    summary = {
        "centroid_mean": _mean(wf.centroid),
        "rolloff_mean": _mean(wf.spectral_rolloff),
        "bandwidth_mean": _mean(wf.spectral_bandwidth),
        "zcr_mean": _mean(wf.zero_crossing_rate),
    }
    return {k: v for k, v in summary.items() if v is not None}


def _suggest_visualization(tempo: float, duration: float, sections: list[dict], energy_curve: list[float], spectral: dict | None = None) -> dict:
    """Suggest a visualization style based on track characteristics.

    Returns ``{"value": str, "confidence": float}`` so callers can weight the
    suggestion instead of blindly applying it.
    """
    avg_energy = sum(energy_curve) / len(energy_curve) if energy_curve else 0.5
    has_chorus = any(s.get("type") == "chorus" for s in sections)
    spectral = spectral or {}

    # Spectral brightness: high centroid + rolloff → bright/aggressive styles
    centroid_mean = spectral.get("centroid_mean")
    rolloff_mean = spectral.get("rolloff_mean")
    is_bright = (centroid_mean is not None and centroid_mean > 3000) or (rolloff_mean is not None and rolloff_mean > 8000)
    is_dark = (centroid_mean is not None and centroid_mean < 1500) and (rolloff_mean is not None and rolloff_mean < 5000)

    if avg_energy > 0.65 and tempo > 135:
        return {"value": "geometric", "confidence": 0.85}
    if avg_energy > 0.65 and tempo <= 135:
        return {"value": "pulse", "confidence": 0.8}
    if avg_energy > 0.45 and tempo > 120:
        return {"value": "particles", "confidence": 0.75}
    if avg_energy < 0.4 and tempo < 100:
        return {"value": "aurora", "confidence": 0.8}
    if has_chorus and avg_energy > 0.5:
        return {"value": "synthwave", "confidence": 0.7}
    if avg_energy < 0.35:
        return {"value": "cosmic", "confidence": 0.75}
    if tempo > 140:
        return {"value": "pulse", "confidence": 0.6}
    if tempo < 90:
        return {"value": "aurora", "confidence": 0.6}
    # Spectral tie-breaker for mid-energy tracks
    if is_bright:
        return {"value": "geometric", "confidence": 0.55}
    if is_dark:
        return {"value": "cosmic", "confidence": 0.55}
    return {"value": "geometric", "confidence": 0.5}


def _suggest_kinetic_preset(tempo: float, sections: list[dict]) -> dict:
    """Suggest a kinetic typography preset based on track characteristics.

    Returns ``{"value": str, "confidence": float}``.
    """
    has_chorus = any(s.get("type") == "chorus" for s in sections)
    if tempo > 140 and has_chorus:
        return {"value": "dubstep", "confidence": 0.85}
    if tempo > 130:
        return {"value": "cinematic", "confidence": 0.75}
    if tempo < 100:
        return {"value": "ambient", "confidence": 0.8}
    return {"value": "synthwave", "confidence": 0.6}


def _suggest_theme_seed(sections: list[dict], energy_curve: list[float]) -> dict:
    """Suggest a theme seed string for AI-driven color generation.

    Returns ``{"value": str, "confidence": float}``.
    """
    avg_energy = sum(energy_curve) / len(energy_curve) if energy_curve else 0.5
    if avg_energy > 0.7:
        return {"value": "neon", "confidence": 0.85}
    if avg_energy < 0.35:
        return {"value": "ethereal", "confidence": 0.8}
    return {"value": "balanced", "confidence": 0.6}


def _visualization_candidates(
    tempo: float,
    duration: float,
    sections: list[dict],
    energy_curve: list[float],
    spectral: dict | None = None,
) -> list[dict]:
    """Return a ranked shortlist of visualization candidates with confidence scores.

    The primary suggestion is always first; candidates let the frontend show
    alternatives or fall back gracefully when the top pick is missing from the
    preset catalog.
    """
    primary = _suggest_visualization(tempo, duration, sections, energy_curve, spectral)
    seen = {primary["value"]}
    candidates = [{"value": primary["value"], "confidence": primary["confidence"]}]

    # Add 1-2 fallback candidates from the same heuristic space.
    avg_energy = sum(energy_curve) / len(energy_curve) if energy_curve else 0.5
    has_chorus = any(s.get("type") == "chorus" for s in sections)
    fallbacks: list[tuple[str, float]] = []
    if avg_energy > 0.5 and tempo > 120:
        fallbacks.append(("pulse", 0.5))
    if has_chorus:
        fallbacks.append(("synthwave", 0.45))
    if avg_energy < 0.4:
        fallbacks.append(("aurora", 0.45))
    if tempo > 130:
        fallbacks.append(("geometric", 0.4))
    if avg_energy > 0.6:
        fallbacks.append(("particles", 0.4))

    for value, confidence in fallbacks:
        if value not in seen:
            candidates.append({"value": value, "confidence": confidence})
            seen.add(value)
        if len(candidates) >= 3:
            break

    return candidates


def _generate_sections_from_analysis(
    duration: float,
    tempo: float,
    beat_times: list[float],
    onset_times: list[float],
    rms_energy: list[float],
    hop_length: int,
    sample_rate: int,
) -> list[dict]:
    """Energy-aware section generation from real librosa features.

    Uses RMS energy percentiles + positional priors + beat snapping +
    onset-density transitions. Falls back to uniform heuristic if energy unavailable.
    """
    if duration <= 0:
        return [{"type": "full", "start": 0.0, "end": 10.0, "energy": 0.5, "confidence": 0.5}]

    # Tempo-proportional beat-snap tolerance: half a beat, capped at 0.6s
    beat_tolerance = min(0.6, (60.0 / max(tempo, 1.0)) * 0.5) if tempo > 0 else 0.6

    # Helper: snap a time to the nearest beat if within tolerance.
    def _snap_to_beat(t: float) -> float:
        if not beat_times:
            return t
        nearest = min(beat_times, key=lambda b: abs(b - t))
        return nearest if abs(nearest - t) < beat_tolerance else t

    # Helper: RMS mean over a time window.
    def _rms_mean(t_start: float, t_end: float) -> float:
        if not rms_energy or duration <= 0:
            return 0.0
        idx_s = max(0, min(int((t_start / duration) * len(rms_energy)), len(rms_energy) - 1))
        idx_e = max(idx_s + 1, min(int((t_end / duration) * len(rms_energy)), len(rms_energy)))
        window = rms_energy[idx_s:idx_e]
        return float(sum(window) / len(window)) if window else 0.0

    # Helper: onset density in a time window.
    def _onset_density(t_start: float, t_end: float) -> int:
        if not onset_times:
            return 0
        return sum(1 for ot in onset_times if t_start <= ot <= t_end)

    # Step 1: detect candidate boundaries from onset-density spikes + energy
    # derivative, then snap them to the nearest beat.
    candidate_bounds = [0.0]
    if onset_times and rms_energy and len(rms_energy) >= 10:
        # Build a coarse onset-density histogram over the track.
        num_bins = max(4, min(32, int(duration / 5)))
        bin_dur = duration / num_bins
        onset_counts = [
            _onset_density(i * bin_dur, (i + 1) * bin_dur)
            for i in range(num_bins)
        ]
        max_onset = max(onset_counts) if onset_counts else 1

        # Energy derivative (frame-to-frame delta, absolute)
        energy_deltas = [0.0]
        for i in range(1, len(rms_energy)):
            energy_deltas.append(abs(rms_energy[i] - rms_energy[i - 1]))

        # Score each bin as a boundary candidate.
        for i in range(1, num_bins - 1):
            t_mid = (i + 0.5) * bin_dur
            od_score = onset_counts[i] / max_onset if max_onset > 0 else 0.0
            ed_score = 0.0
            idx_start = max(0, int((i * bin_dur / duration) * len(rms_energy)))
            idx_end = min(len(energy_deltas), int(((i + 1) * bin_dur / duration) * len(rms_energy)))
            if idx_end > idx_start:
                ed_score = sum(energy_deltas[idx_start:idx_end]) / (idx_end - idx_start)
                ed_score = min(1.0, ed_score * 10.0)  # normalize generously
            score = 0.6 * od_score + 0.4 * ed_score
            if score > 0.25:
                candidate_bounds.append(_snap_to_beat(t_mid))

    candidate_bounds.append(duration)
    # Deduplicate + sort
    candidate_bounds = sorted({round(b, 2) for b in candidate_bounds if 0.0 <= b <= duration})

    # Step 2: enforce minimum section duration by merging weak/too-short sections.
    min_sec_dur = max(4.0, 60.0 / max(tempo, 1.0) * 4) if tempo > 0 else 8.0
    merged = [candidate_bounds[0]]
    for b in candidate_bounds[1:]:
        if b - merged[-1] >= min_sec_dur:
            merged.append(b)
        else:
            # Too short — absorb into previous section
            merged[-1] = round(b, 2)
    if merged[-1] < duration:
        merged.append(duration)

    # A track shorter than min_sec_dur collapses every candidate boundary into
    # one (the first boundary absorbs the second at line 483), so `merged` ends
    # up with a single entry. `all_energies` is then empty and the min/max below
    # raised `ValueError: min() arg is an empty sequence`, turning the whole
    # analysis request into a 500. min_sec_dur has an 8 s floor, so every clip
    # under it — SFX, stingers, short intros — failed. Always keep two
    # boundaries so a whole-track section is still produced.
    if len(merged) < 2:
        merged = [0.0, float(duration)] if duration > 0 else [0.0, 0.0]

    # Energy per section (computed once, reused for capping + classification).
    all_energies = [_rms_mean(s, e) for s, e in zip(merged, merged[1:], strict=False)]

    # Cap number of sections for the wizard UI (8 max).
    if len(merged) > 9:
        # Keep boundaries that best preserve energy changes.
        # Always keep first + last
        keep = [0.0, duration]
        # Pick interior boundaries with largest energy deltas.
        interior = list(range(1, len(merged) - 1))
        def _boundary_score(idx: int) -> float:
            prev = abs(all_energies[idx] - all_energies[idx - 1]) if idx > 0 else 0.0
            nxt = abs(all_energies[idx] - all_energies[idx + 1]) if idx < len(all_energies) - 1 else 0.0
            return prev + nxt
        interior.sort(key=_boundary_score, reverse=True)
        for idx in interior[:6]:
            keep.append(merged[idx])
        keep = sorted(set(keep))
        merged = keep
        # Recompute energies after trimming.
        all_energies = [_rms_mean(s, e) for s, e in zip(merged, merged[1:], strict=False)]

    # Step 3: classify each section.
    sections = []
    # Defensive: the guard above should make this non-empty, but a section list
    # that dies on min() turns a cosmetic gap into a failed request.
    emin, emax = (min(all_energies), max(all_energies)) if all_energies else (0.0, 0.0)
    erange = (emax - emin) or 1.0
    sorted_e = sorted(all_energies)
    p33 = sorted_e[len(sorted_e) // 3] if sorted_e else 0
    p66 = sorted_e[(len(sorted_e) * 2) // 3] if sorted_e else 0
    onset_densities = [_onset_density(s, e) for s, e in zip(merged, merged[1:], strict=False)]
    max_onset = max(onset_densities) if onset_densities else 1
    num_sections = len(merged) - 1

    for i in range(num_sections):
        s, e = merged[i], merged[i + 1]
        mean_e = all_energies[i]
        od = onset_densities[i] / max_onset if max_onset > 0 else 0
        norm = (mean_e - emin) / erange
        confidence = 0.75  # improved confidence from data-driven boundaries

        if i == 0:
            typ = "intro"
            confidence = 0.9
        elif i == num_sections - 1:
            typ = "outro"
            confidence = 0.9
        elif norm >= 0.66 or mean_e >= p66:
            typ = "chorus"
            confidence = 0.8 + norm * 0.15
        elif norm <= 0.33 or mean_e <= p33:
            mid_pos = i >= num_sections // 3 and i <= 2 * num_sections // 3
            if mid_pos and od < 0.4:
                typ = "bridge"
                confidence = 0.75
            elif od > 0.6:
                typ = "pre-chorus"
                confidence = 0.7
            else:
                typ = "interlude" if mid_pos else "verse"
                confidence = 0.65
        else:
            if od > 0.65 and 0 < i < num_sections - 1:
                typ = "pre-chorus"
                confidence = 0.7
            else:
                typ = "verse"
                confidence = 0.75

        ui_energy = round(min(1.0, max(0.05, (norm * 0.7 + 0.3) if typ in ("chorus", "drop") else norm * 0.6 + 0.2)), 3)
        sections.append({
            "type": typ,
            "start": round(float(s), 2),
            "end": round(float(e), 2),
            "energy": ui_energy,
            "confidence": round(min(1.0, confidence), 2),
        })

    # Ensure chronological and non-overlapping
    for i in range(1, len(sections)):
        if sections[i]["start"] < sections[i - 1]["end"]:
            sections[i]["start"] = sections[i - 1]["end"]
        if sections[i]["end"] <= sections[i]["start"]:
            sections[i]["end"] = round(min(duration, sections[i]["start"] + min_sec_dur), 2)

    return sections


# Seconds allowed per model in the section-refinement chain.
#
# Sections are a semantic refinement over a heuristic that already works, so
# the LLM must never dominate the request. Measured on a GTX 1070 Ti: the
# configured default answers in 16s warm and ~89s cold; deepseek-r1:7b ran
# 89s and qwen3.5:4b exceeded 120s. A 12s budget means a cold model is dropped
# and the heuristic stands, instead of holding the request open.
_SECTION_LLM_TIMEOUT = 12


def _section_models(default_model: str) -> list[str]:
    """Models to try for section labelling, cheapest first.

    The configured default leads, then small fast fallbacks. deepseek-r1:7b is
    not in the chain any more: it is a reasoning model, which is a poor fit for
    a fixed-schema JSON task and measured 89s cold. It was tried first
    previously, so every request paid that cost before falling through.
    """
    ordered = [default_model, "gemma4:e2b-it-qat", "llama3.2:3b", "qwen3.5:4b"]
    # De-duplicate, preserving order - default_model may already be one of these.
    seen: set[str] = set()
    return [m for m in ordered if m and not (m in seen or seen.add(m))]


async def _generate_sections_llm(
    duration: float,
    tempo: float,
    beat_times: list[float],
    rms_energy: list[float],
    lyrics_hint: str = "",
) -> list[dict] | None:
    """Try LLM (deepseek-r1:7b → qwen3.5:4b fallback) to label sections semantically.
    Returns None on failure so caller can fall back to heuristic."""
    from ..core.config import config as app_config

    # Summarize energy curve (downsample to ~20 points for prompt)
    if rms_energy and len(rms_energy) > 20:
        step = len(rms_energy) / 20
        sampled = [rms_energy[int(i*step)] for i in range(20)]
    else:
        sampled = rms_energy or []
    energy_str = ", ".join(f"{v:.2f}" for v in sampled[:20])
    beat_count = len(beat_times)
    sys = (
        "You are a music structure analyzer. Given tempo, beat count, duration and "
        "normalized RMS energy curve (0-1, 20 samples over track), output ONLY JSON: "
        '{"sections":[{"type":"intro|verse|chorus|bridge|outro","start":0.0,"end":12.5,"energy":0.7}]} '
        "Rules: 4-8 sections, chronological, non-overlapping, cover 0..duration, "
        "energy 0-1 correlates with loudness. Use chorus for peaks, intro/outro for edges."
    )
    user = f"tempo: {tempo:.1f} BPM, beats: {beat_count}, duration: {duration:.1f}s, energy: [{energy_str}]{' lyrics: '+lyrics_hint[:200] if lyrics_hint else ''}"
    from ..core import ollama_client as _oc
    from ..core.text import strip_code_fences
    for model in _section_models(app_config.default_model):
        try:
            # Some Ollama builds reject unknown keys like `think`; omit it.
            content = await _oc.chat_content(
                [{"role": "system", "content": sys}, {"role": "user", "content": user}],
                model=model,
                # Kept short deliberately: a cold model load measured ~89s, and
                # sections are a nice-to-have refinement over a solid heuristic,
                # so a slow model must degrade to the fallback quickly rather
                # than hold the request open.
                timeout=_SECTION_LLM_TIMEOUT,
                # think=false is the single biggest win in this call. Measured on
                # Ollama 0.35.0 with gemma4:e2b-it-qat on a GTX 1070 Ti: the
                # identical request took 39.5s and returned content_len=0 with
                # thinking=1738 chars, and 0.6s with think=false and content
                # length 67. The model spends the whole budget reasoning about a
                # task that needs no reasoning, then answers.
                #
                # This is the documented fix in
                # docs/knowledge-library/ollama-thinking-structured-outputs.md
                # (/api/chat + think=false; /api/generate does not honor it
                # reliably). The comment that used to sit here said "some builds
                # reject unknown keys like think; omit it" - which is why it was
                # never sent, and why this was slow.
                extra={
                    "format": "json",
                    "think": False,
                    "options": {"temperature": 0.2, "num_ctx": 4096},
                },
            )
            if not content:
                continue
            parsed = json.loads(strip_code_fences(content))
            secs = parsed.get("sections") if isinstance(parsed, dict) else parsed
            if isinstance(secs, list) and 2 <= len(secs) <= 8:
                # Validate and clamp
                out = []
                for s in secs:
                    if not isinstance(s, dict):
                        continue
                    typ = str(s.get("type", "verse")).lower()
                    if typ not in ("intro","verse","chorus","bridge","outro","pre-chorus","drop"):
                        typ = "verse"
                    out.append({
                        "type": typ,
                        "start": round(float(s.get("start", 0)), 2),
                        "end": round(float(s.get("end", duration)), 2),
                        "energy": round(max(0.05, min(1.0, float(s.get("energy", 0.5)))), 3),
                    })
                if not out:
                    continue
                out.sort(key=lambda x: x["start"])
                # Ensure coverage
                out[0]["start"] = 0.0
                out[-1]["end"] = round(duration, 2)
                return out
        except Exception:
            continue
    return None


async def _apply_llm_sections(analysis_result: dict, result, rms_energy: list[float]) -> None:
    """Best-effort LLM section refinement. Mutates `analysis_result["sections"]` on success."""
    try:
        llm_secs = await _generate_sections_llm(
            analysis_result["duration_seconds"],
            analysis_result["tempo_bpm"],
            result.beats.beat_times,
            rms_energy,
        )
        if llm_secs:
            analysis_result["sections"] = llm_secs
    except Exception as e:
        # Best-effort: keep the fallback sections on any failure, but surface
        # the reason so silent LLM degradations remain debuggable.
        logger.debug("LLM section refinement failed, using fallback sections: %s", e, exc_info=True)


def _generate_sections(duration: float, tempo: float, beat_count: int) -> list[dict]:
    """Legacy fallback — uniform slicing (kept for queue path)."""
    return _generate_sections_from_analysis(duration, tempo, [], [], [], 512, 22050)
