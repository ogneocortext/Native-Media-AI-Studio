"""
Remix DSP primitives.

Extracted from stem_remixer.py. Contains tempo alignment, STFT filtering,
low-pass, brightness tilt and equal-power crossfade ramps.
"""

from __future__ import annotations

import math
from typing import Any, Callable

import numpy as np

from .remix_constants import REMIX_SR

try:
    import librosa

    LIBROSA_AVAILABLE = True
except ImportError:  # pragma: no cover - librosa is a hard backend dep
    LIBROSA_AVAILABLE = False


def _db_to_linear(db: float) -> float:
    return math.pow(10.0, db / 20.0)


def _loop_to_length(y: np.ndarray, n_samples: int) -> np.ndarray:
    """Tile `y` until it covers `n_samples`, then trim to exactly that length.

    Remixes are often longer than their sources -- a 32-bar arrangement over a
    60-second stem would otherwise run dry and leave the tail silent, which
    reads as a bug rather than as an arrangement. Callers pass bar-aligned
    counts, so the loop seam lands on a downbeat.
    """
    if n_samples <= 0:
        return np.zeros((2, 0), dtype=np.float32)
    if y.size == 0:
        return np.zeros((2, n_samples), dtype=np.float32)
    if y.shape[-1] >= n_samples:
        return y[..., :n_samples]
    repeats = math.ceil(n_samples / y.shape[-1])
    return np.tile(y, (1, repeats))[..., :n_samples]


def _tempo_align(y: np.ndarray, source_bpm: float, target_bpm: float) -> np.ndarray:
    """Time-stretch so the source's tempo becomes `target_bpm`.

    `librosa.effects.time_stretch(rate=r)` multiplies tempo by r, so r is the
    target/source ratio. It changes duration without moving pitch, which is why
    key work needs a separate `pitch_shift`.
    """
    if source_bpm <= 0 or target_bpm <= 0:
        raise ValueError("tempo values must be positive")
    rate = target_bpm / source_bpm
    if abs(rate - 1.0) < 1e-3:
        return y
    return librosa.effects.time_stretch(y=y.astype(np.float32), rate=float(rate))


def _stft_filter(
    y: np.ndarray,
    sr: int,
    gain_by_bin: Callable[[np.ndarray], np.ndarray],
) -> np.ndarray:
    """Apply a per-bin magnitude gain in the STFT domain.

    Same construction as the enhancer's ``_high_pass`` (FFT magnitude shaping
    with librosa's stft/istft and length restoration) -- no scipy in this
    dependency set, and one implementation is easier to reason about than
    two. ``gain_by_bin`` maps the bin-frequency array to a linear gain array.
    """
    if y.size == 0 or not LIBROSA_AVAILABLE:
        return y
    n_fft = 2048
    hop = 512
    stft = librosa.stft(y.astype(np.float32), n_fft=n_fft, hop_length=hop)
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
    stft *= gain_by_bin(freqs).astype(np.float32)[:, np.newaxis]
    out = librosa.istft(stft, hop_length=hop)
    target_len = y.shape[-1]
    if out.shape[0] < target_len:
        out = np.pad(out, (0, target_len - out.shape[0]), mode="constant")
    elif out.shape[0] > target_len:
        out = out[:target_len]
    return out.astype(np.float32)


def _low_pass(y: np.ndarray, sr: int, cutoff_hz: float) -> np.ndarray:
    """Keep spectrum at or below ``cutoff_hz``, zero above. The B4 "dark" half."""
    return _stft_filter(y, sr, lambda freqs: (freqs <= cutoff_hz).astype(np.float32))


_TILT_PIVOT_HZ = 1000.0


def _brightness_tilt(y: np.ndarray, sr: int, db_per_octave: float) -> np.ndarray:
    """Shelf the spectrum above a 1 kHz pivot by ``db_per_octave`` dB/octave.

    The B4 "bright/dark" control that gain cannot express: positive lifts
    highs, negative cuts them. It is a *shelf*, not a constant slope --
    a true tilt would also boost the lows by 6 dB under a "darker"
    command, which fights the layer's own bass gain and reads as mud.

    In the STFT domain the gain is naturally a per-bin power ratio:
    the octave count above the pivot is log2(f/pivot), and 20*log10 of
    one octave is 6.02 dB, so the linear gain is 10**(db*octaves/20).
    Below the pivot the gain is unity.
    """
    if not db_per_octave:
        return y
    return _stft_filter(
        y,
        sr,
        lambda freqs: np.where(
            freqs <= _TILT_PIVOT_HZ,
            1.0,
            np.power(
                10.0,
                (db_per_octave * np.log2(np.maximum(freqs, 1.0) / _TILT_PIVOT_HZ)) / 20.0,
            ),
        ).astype(np.float32),
    )


def _equal_power_ramp(n: int) -> tuple[np.ndarray, np.ndarray]:
    """Cosine/sine pair for a constant-power crossfade.

    Linear fades sum to a dip at the midpoint (power ~0.5 of unity); cos/sin
    keep the sum flat. ``n <= 0`` returns silence rather than raising, so a
    zero-length crossfade is legal.
    """
    if n <= 0:
        empty = np.zeros(0, dtype=np.float32)
        return empty, empty.copy()
    t = np.linspace(0.0, 1.0, n, dtype=np.float32)
    return np.cos(t * math.pi / 2.0), np.sin(t * math.pi / 2.0)


__all__ = [
    "_db_to_linear",
    "_loop_to_length",
    "_tempo_align",
    "_stft_filter",
    "_low_pass",
    "_brightness_tilt",
    "_equal_power_ramp",
    "LIBROSA_AVAILABLE",
    "REMIX_SR",
]
