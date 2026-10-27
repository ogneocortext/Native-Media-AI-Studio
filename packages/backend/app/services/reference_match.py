"""Reference-track tonal match for the master bus.

Sonible-style reference matching, done locally with plain DSP: measure the
reference track's average spectrum in log-spaced bands, then apply a
gentle, smoothed, clamped correction to the target so its tonal balance
leans toward the reference. No API, no key detection, no ML.

The correction is deliberately conservative: profiles are zero-mean (it
matches *balance*, never loudness -- the chain's own LUFS staging owns
that), the per-band delta is smoothed across bands (no narrow resonant
boosts), clamped to +/-max_correction_db, and scaled by strength
(0.5 = halfway there). A full-strength, unclamped match sounds like a
different master; this sounds like the same mix with better manners.

The band math (profile, delta, smoothing, interpolation) is pure numpy
and unit-tested. The spectral application uses librosa's stft/istft --
the same construction as stem_remixer's `_stft_filter` -- because
overlap-add normalization is exactly the kind of thing to reuse rather
than re-derive.
"""

from __future__ import annotations

import logging
import math
import os
from pathlib import Path
from typing import Any

import numpy as np

from ..core.config import PROJECT_ROOT

logger = logging.getLogger(__name__)

AUDIO_DIR = PROJECT_ROOT / "output" / "audio"

# 12 log-spaced bands covering the musical spectrum. Fewer bands than a
# 1/3-octave analyzer on purpose: the correction is smoothed anyway, and
# wide bands cannot chase narrow resonances.
BAND_CENTERS_HZ = np.logspace(math.log10(40.0), math.log10(16000.0), 12)
_FLOOR_DB = -80.0

try:
    import librosa

    LIBROSA_AVAILABLE = True
except ImportError:
    LIBROSA_AVAILABLE = False

# In-memory profile cache: reference -> zero-mean dB vector.
_profile_cache: dict[str, np.ndarray] = {}


def _bin_power(y: np.ndarray, sr: int, n_fft: int = 4096, hop: int = 2048) -> tuple[np.ndarray, np.ndarray]:
    """Mean power per FFT bin, Hann-windowed. Numpy only (analysis path)."""
    mono = np.mean(y[:2].astype(np.float64), axis=0)
    if mono.shape[0] < n_fft:
        mono = np.pad(mono, (0, n_fft - mono.shape[0]))
    window = np.hanning(n_fft)
    n_frames = 1 + (mono.shape[0] - n_fft) // hop
    shape = (n_frames, n_fft)
    strides = (mono.strides[0] * hop, mono.strides[0])
    frames = np.lib.stride_tricks.as_strided(mono, shape=shape, strides=strides).copy()
    frames *= window
    spectrum = np.fft.rfft(frames, n=n_fft, axis=1)
    power = np.mean(np.abs(spectrum) ** 2, axis=0)
    freqs = np.fft.rfftfreq(n_fft, d=1.0 / sr)
    return freqs, power


def profile_from_bin_power(freqs: np.ndarray, power: np.ndarray) -> np.ndarray:
    """Zero-mean per-band profile in dB from bin frequencies and powers.

    Pure numpy -- the unit-testable half. Bands are Gaussian-weighted in
    log-frequency (sigma ~0.35 octaves), so each band sees its neighborhood
    without hard edges.
    """
    log_f = np.log2(np.maximum(freqs, 1.0))
    log_c = np.log2(BAND_CENTERS_HZ)
    band_db = np.empty(len(BAND_CENTERS_HZ), dtype=np.float64)
    for i, lc in enumerate(log_c):
        weights = np.exp(-0.5 * ((log_f - lc) / 0.35) ** 2)
        band_power = float(np.sum(power * weights) / max(np.sum(weights), 1e-12))
        band_db[i] = 10.0 * math.log10(band_power + 1e-12)
    band_db = np.maximum(band_db, _FLOOR_DB)
    return band_db - float(np.mean(band_db))


def spectral_profile(y: np.ndarray, sr: int) -> np.ndarray:
    """Zero-mean per-band spectral profile in dB.

    Zero-mean because the match is about *balance*: a quiet reference and
    a loud reference with the same tonal shape must produce the same
    correction.
    """
    freqs, power = _bin_power(y, sr)
    return profile_from_bin_power(freqs, power)


def correction_gains_db(ref_profile: np.ndarray, target_profile: np.ndarray,
                        strength: float = 0.5,
                        max_correction_db: float = 6.0) -> np.ndarray:
    """Per-band correction in dB: smoothed, clamped, strength-scaled.

    Pure numpy -- the unit-testable core. Smoothing (3-point moving average
    over bands) prevents narrow corrections; clamping bounds the worst
    case; strength scales toward "halfway there" by default.
    """
    ref_profile = np.asarray(ref_profile, dtype=np.float64)
    target_profile = np.asarray(target_profile, dtype=np.float64)
    if ref_profile.shape != BAND_CENTERS_HZ.shape or target_profile.shape != BAND_CENTERS_HZ.shape:
        raise ValueError(f"profiles must match {BAND_CENTERS_HZ.shape}")
    delta = ref_profile - target_profile
    kernel = np.ones(3) / 3.0
    delta = np.convolve(np.pad(delta, 1, mode="edge"), kernel, mode="valid")
    return np.clip(delta, -max_correction_db, max_correction_db) * float(strength)


def _bin_gains_linear(freqs: np.ndarray, band_gains_db: np.ndarray) -> np.ndarray:
    """Interpolate per-band dB gains to per-bin linear gains (log-freq)."""
    log_f = np.log2(np.maximum(freqs, 1.0))
    log_c = np.log2(BAND_CENTERS_HZ)
    interp_db = np.interp(log_f, log_c, band_gains_db,
                          left=band_gains_db[0], right=band_gains_db[-1])
    return (10.0 ** (interp_db / 20.0)).astype(np.float32)


def match_to_reference(
    y: np.ndarray,
    sr: int,
    ref_profile: np.ndarray,
    strength: float = 0.5,
    max_correction_db: float = 6.0,
) -> np.ndarray:
    """Nudge `y`'s tonal balance toward `ref_profile` (zero-mean dB vector).

    With strength=0 the audio passes through untouched. Without librosa
    the audio passes through untouched (and logs) -- a missing DSP
    dependency must not silently produce uncorrected audio that claims
    to be corrected.
    """
    if y.size == 0 or strength <= 0.0:
        return y
    if not LIBROSA_AVAILABLE:
        logger.warning("reference match skipped: librosa not available")
        return y
    target = spectral_profile(y, sr)
    gains_db = correction_gains_db(ref_profile, target, strength, max_correction_db)
    if not np.any(gains_db):
        return y
    # Same construction as stem_remixer's _stft_filter: per-bin magnitude
    # shaping with librosa stft/istft and length restoration.
    n_fft, hop = 2048, 512
    stereo = y[:2].astype(np.float32)
    if stereo.shape[0] == 1:
        stereo = np.repeat(stereo, 2, axis=0)
    out_ch = []
    for c in range(stereo.shape[0]):
        stft = librosa.stft(stereo[c], n_fft=n_fft, hop_length=hop)
        freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
        stft = stft * _bin_gains_linear(freqs, gains_db)[:, np.newaxis]
        back = librosa.istft(stft, hop_length=hop)
        target_len = stereo.shape[1]
        if back.shape[0] < target_len:
            back = np.pad(back, (0, target_len - back.shape[0]))
        else:
            back = back[:target_len]
        out_ch.append(back.astype(np.float32))
    return np.stack(out_ch)


def resolve_reference(ref: str) -> Path:
    """Resolve a reference track to a file under the audio library.

    Accepts an AUDIO_DIR-relative path (the form the analysis index uses)
    or an absolute path. Refuses anything escaping the library.
    """
    candidate = Path(ref)
    if not candidate.is_absolute():
        candidate = AUDIO_DIR / ref
    candidate = candidate.resolve()
    base = AUDIO_DIR.resolve()
    if not str(candidate).startswith(str(base) + os.sep):
        raise ValueError(f"Reference escapes the audio library: {ref!r}")
    if not candidate.is_file():
        raise FileNotFoundError(f"Reference track not found: {ref!r}")
    return candidate


def profile_for_reference(ref: str) -> np.ndarray:
    """Zero-mean spectral profile for a reference track, cached in memory."""
    if ref not in _profile_cache:
        path = resolve_reference(ref)
        y, sr = _load_audio(path)
        _profile_cache[ref] = spectral_profile(y, sr)
        if len(_profile_cache) > 8:
            _profile_cache.pop(next(iter(_profile_cache)))
        logger.debug("reference profile cached for %s", ref)
    return _profile_cache[ref].copy()


def _load_audio(path: Path) -> tuple[np.ndarray, int]:
    """Load a reference file to (2, N) float32. Librosa handles mp3/wav."""
    if not LIBROSA_AVAILABLE:
        raise RuntimeError("librosa is required to load a reference track")
    y, sr = librosa.load(str(path), sr=None, mono=False)
    if y.ndim == 1:
        y = y[np.newaxis, :]
    y = y[:2].astype(np.float32)
    if y.shape[0] == 1:
        y = np.repeat(y, 2, axis=0)
    return y, int(sr)


def describe_profile(profile: np.ndarray) -> dict[str, Any]:
    """Human-readable summary of a profile, for step records."""
    return {
        "bands": len(profile),
        "range_hz": [float(BAND_CENTERS_HZ[0]), float(BAND_CENTERS_HZ[-1])],
        "tilt_db": round(float(profile[-1] - profile[0]), 2),
    }
