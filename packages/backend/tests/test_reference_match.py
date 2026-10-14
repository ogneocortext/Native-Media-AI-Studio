"""Tests for services/reference_match.py.

The band math (profile, correction, interpolation) is pure numpy and fully
exercised here. The librosa STFT application path is the same construction
as stem_remixer's _stft_filter; without librosa, match_to_reference must
pass audio through untouched rather than produce uncorrected output.
"""

import wave

import numpy as np
import pytest
from app.services import reference_match


def _sine(hz: float, db: float = -6.0, seconds: float = 4.0, sr: int = 22050) -> np.ndarray:
    t = np.arange(int(seconds * sr)) / sr
    ch = (10 ** (db / 20.0) * np.sin(2 * np.pi * hz * t)).astype(np.float32)
    return np.stack([ch, ch])


def test_profile_is_zero_mean_and_shaped():
    prof = reference_match.spectral_profile(_sine(440.0), 22050)
    assert prof.shape == (12,)
    assert abs(float(np.mean(prof))) < 0.01


def test_profile_tilt_follows_content():
    low = reference_match.spectral_profile(_sine(55.0), 22050)
    high = reference_match.spectral_profile(_sine(8000.0), 22050)
    assert low[0] > low[-1]  # bass-heavy: low bands above mean
    assert high[-1] > high[0]  # bright: high bands above mean


def test_correction_smooths_clamps_and_scales():
    ref = np.zeros(12)
    ref[0] = 9.0
    tgt = np.zeros(12)
    g = reference_match.correction_gains_db(ref, tgt, strength=1.0, max_correction_db=6.0)
    # Smoothed: the +9 dB spike spreads to its neighbor; clamped at 6.
    assert g[0] == pytest.approx(6.0)
    assert g[1] == pytest.approx(3.0)
    assert g[2] == pytest.approx(0.0)
    half = reference_match.correction_gains_db(ref, tgt, strength=0.5, max_correction_db=6.0)
    assert half[0] == pytest.approx(3.0)


def test_correction_rejects_bad_shapes():
    with pytest.raises(ValueError):
        reference_match.correction_gains_db(np.zeros(5), np.zeros(12))


def test_bin_gains_are_positive_and_sized():
    freqs = np.fft.rfftfreq(4096, d=1.0 / 22050)
    gains = reference_match._bin_gains_linear(freqs, np.zeros(12))
    assert gains.shape == freqs.shape
    assert np.all(gains > 0)
    assert np.allclose(gains, 1.0)  # zero correction = unity


def test_match_passthrough_without_librosa(monkeypatch):
    """No librosa means untouched audio, never a silent wrong answer."""
    monkeypatch.setattr(reference_match, "LIBROSA_AVAILABLE", False)
    y = _sine(440.0)
    out = reference_match.match_to_reference(y, 22050, np.zeros(12), strength=0.5)
    assert out is y or np.array_equal(out, y)


def test_match_zero_strength_passthrough():
    y = _sine(440.0)
    out = reference_match.match_to_reference(y, 22050, np.zeros(12), strength=0.0)
    assert np.array_equal(out, y)


def test_resolve_reference_refuses_traversal(tmp_path, monkeypatch):
    monkeypatch.setattr(reference_match, "AUDIO_DIR", tmp_path)
    with pytest.raises(ValueError):
        reference_match.resolve_reference("../escape.wav")


def test_resolve_reference_404_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(reference_match, "AUDIO_DIR", tmp_path)
    with pytest.raises(FileNotFoundError):
        reference_match.resolve_reference("nope.wav")


def _write_wav(path, y: np.ndarray, sr: int = 22050):
    pcm = (np.clip(y[0], -1.0, 1.0) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


def test_profile_for_reference_caches(tmp_path, monkeypatch):
    monkeypatch.setattr(reference_match, "AUDIO_DIR", tmp_path)
    _write_wav(tmp_path / "ref.wav", _sine(440.0))
    # Stub the loader: librosa is absent in this environment.
    monkeypatch.setattr(reference_match, "_load_audio",
                        lambda path: (_sine(440.0), 22050))
    p1 = reference_match.profile_for_reference("ref.wav")
    p2 = reference_match.profile_for_reference("ref.wav")
    assert p1.shape == (12,)
    assert np.array_equal(p1, p2)
    assert abs(float(np.mean(p1))) < 0.01
