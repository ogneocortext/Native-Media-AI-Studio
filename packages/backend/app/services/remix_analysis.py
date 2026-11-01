"""
Remix analysis / track probing.

Extracted from stem_remixer.py. Contains tempo detection, key advisory
(report-only, never auto-applied) and Essentia tempo cross-checking.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import numpy as np

from .remix_constants import (
    _MAJOR_PROFILE,
    _PITCH_NAMES,
    KEY_CONFIDENCE_FLOOR,
    PROBE_CACHE_DIR,
    PROBE_CACHE_VERSION,
    REMIX_SR,
)

logger = logging.getLogger(__name__)

try:
    import librosa

    LIBROSA_AVAILABLE = True
except ImportError:  # pragma: no cover - librosa is a hard backend dep
    LIBROSA_AVAILABLE = False


def _tempo_agreement_for(track: str, librosa_bpm: float) -> dict[str, Any] | None:
    """Cross-check librosa against the cached Essentia reading, if there is one.

    Returns None when Essentia has not been measured for this track, so the probe
    response carries no agreement block it cannot support. Essentia is the primary
    authority in `tempo_agreement`, so a disagreement here means librosa is the
    value that should be distrusted - and, per the library measurement, that is
    the common case, not a rare edge.

    The imports are deferred to avoid a circular import: ``essentia_tempo_store``
    imports ``stem_remixer`` at module level, and this module is loaded by the
    ``stem_remixer`` shim.
    """
    from . import essentia_tempo_store, tempo_agreement

    essentia = essentia_tempo_store.cached_bpm(track)
    if essentia is None:
        return None
    return tempo_agreement.corroborate({"librosa": librosa_bpm, "essentia": essentia})


def probe_track(track: str) -> dict[str, Any]:
    """Detect tempo, and *report* key as an advisory with its confidence.

    Cached under ``output/remixes/.probes/``. It deliberately does *not* live
    beside the stems: that directory is owned by `source_separation` and contains
    nothing but stem WAVs, and a stray JSON there is a file nobody expects.
    """
    if not LIBROSA_AVAILABLE:
        raise RuntimeError("librosa is required for remix analysis")
    # Deferred to break the circular import: remix_source imports stem_remixer
    # which imports remix_analysis; importing remix_source here (after stem_remixer
    # is fully initialised) avoids the cycle.
    from .remix_source import _pick_analysis_stem, _safe_track_name, resolve_track_key

    # B6: accept a library filename/path here too, so /probe and the render
    # cache agree on what was asked.
    track = resolve_track_key(track)
    analysed_stem, analysis_path = _pick_analysis_stem(track)
    cache_path = PROBE_CACHE_DIR / f"{_safe_track_name(track)}.json"
    if cache_path.exists():
        try:
            cached = json.loads(cache_path.read_text(encoding="utf-8"))
            # Version guards the *schema*, not just the source. Without it,
            # adding a field left every existing cache serving a dict that lacks
            # it, and the caller failed on KeyError rather than on anything
            # visible. The stem is matched too, so switching the analysed stem
            # cannot return a measurement taken from a different one.
            if (
                cached.get("cache_version") == PROBE_CACHE_VERSION
                and cached.get("analysed_stem") == analysed_stem
                and cached.get("source") == analysis_path.name
            ):
                return cached
        except (json.JSONDecodeError, OSError):
            logger.debug("unreadable probe cache for %s, recomputing", track)

    y, sr = librosa.load(str(analysis_path), sr=REMIX_SR, mono=True)
    if y.size < sr * 5:
        raise ValueError(f"Track {track!r} is too short to analyse ({y.size / sr:.1f}s)")

    tempo, beats = librosa.beat.beat_track(y=y, sr=sr)
    bpm = float(np.atleast_1d(tempo)[0])

    chroma = librosa.feature.chroma_cqt(y=y, sr=sr).mean(axis=1)
    chroma = chroma / (chroma.sum() + 1e-9)
    # Flatness near 1.0 means the profile carries no pitch information at all,
    # which is the measured state of this library (0.978-0.998).
    geo = float(np.exp(np.mean(np.log(chroma + 1e-12))))
    arith = float(np.mean(chroma))
    flatness = geo / (arith + 1e-12)
    correlation = float(np.corrcoef(_MAJOR_PROFILE, chroma)[0, 1])

    # Where the stem first becomes audible. Measured on this library the vocals
    # of Ad-Nauseam are silent for the first ~6.3 s (peak -57 dBFS), so a slot
    # that lays them down from bar 0 renders an inaudible layer and looks like a
    # broken mixer rather than a song with an instrumental intro. Reporting the
    # entry point lets a caller pick `source_start_bar` deliberately.
    frame = 1024
    n_frames = max(1, len(y) // frame)
    frames = y[: n_frames * frame].reshape(n_frames, frame).astype(np.float64)
    frame_rms = np.sqrt(np.mean(frames**2, axis=1))
    loudest = float(np.max(frame_rms)) if frame_rms.size else 0.0
    if loudest > 1e-9:
        # -45 dB relative to the stem's own loudest frame.
        threshold = loudest * 10.0 ** (-45.0 / 20.0)
        audible = np.flatnonzero(frame_rms > threshold)
        first_audible = float(audible[0] * frame / sr) if audible.size else 0.0
    else:
        first_audible = 0.0

    # Deferred import to avoid the circular import through essentia_tempo_store.
    from . import essentia_tempo_store as _essentia_store

    result = {
        "cache_version": PROBE_CACHE_VERSION,
        "track": track,
        "bpm": round(bpm, 3),
        "duration_sec": round(float(len(y) / sr), 3),
        "first_audible_sec": round(first_audible, 3),
        "key_advisory": _PITCH_NAMES[int(np.argmax(chroma))],
        "key_correlation": round(correlation, 4),
        "chroma_flatness": round(flatness, 4),
        "key_confident": bool(correlation >= KEY_CONFIDENCE_FLOOR and flatness < 0.5),
        "beat_count": int(len(beats)),
        "analysed_stem": analysed_stem,
        "source": analysis_path.name,
        # Essentia, if it has been measured. Read straight from the cache: this
        # function is on the request path, and asking WSL for a tempo here would
        # add ~31 s to a dropdown. `essentia_tempo_store.cached_bpm` never touches
        # WSL, so an un-refreshed track simply reports None.
        "essentia_bpm": _essentia_store.cached_bpm(track),
        "tempo_agreement": _tempo_agreement_for(track, bpm),
    }
    try:
        cache_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    except OSError:
        logger.debug("could not write probe cache for %s", track)
    return result


__all__ = [
    "LIBROSA_AVAILABLE",
    "_tempo_agreement_for",
    "probe_track",
]
