"""
Tests for the mastering DSP service (services/mastering.py).

Regression guard for M1: mastering must measure loudness, apply gain to a
target preset, true-peak limit below the ceiling, and round-trip a real file
through decode → DSP → encode → re-measure.

Pure-DSP tests run without ffmpeg; ffmpeg-dependent tests (measure / master
end-to-end) skip when ffmpeg is absent on PATH so the suite is green on any
machine.

Importing services.mastering at module scope pulls in ffmpeg_tools, which is
import-safe (no database side effects), so a module-level import is fine here
— unlike the audio API tests, we never open studio.db.
"""

from __future__ import annotations

import asyncio
import math
import os
import shutil
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np
import pytest

FFMPEG = shutil.which("ffmpeg")
requires_ffmpeg = pytest.mark.skipif(
    not FFMPEG, reason="ffmpeg not on PATH; measure/master end-to-end skipped"
)

import app.services.mastering as mastering  # noqa: E402


def _write_wav(path, samples, sample_rate=44100):
    """Write interleaved float32 samples to a WAV file."""
    samples = np.asarray(samples, dtype=np.float32)
    if samples.ndim == 1:
        samples = samples.reshape(-1, 1)
    n_channels = samples.shape[1]
    with wave.open(str(path), "wb") as w:
        w.setnchannels(n_channels)
        w.setsampwidth(4)
        w.setframerate(sample_rate)
        w.writeframes(samples.astype("<f4").tobytes())


async def _write_m4a(path, samples, sample_rate=44100):
    """Encode a real m4a (AAC) file from samples via ffmpeg — more accurate for
    ebur128 measurement than synthetic WAV."""
    samples = np.asarray(samples, dtype=np.float32)
    if samples.ndim == 1:
        samples = samples.reshape(-1, 1)
    n_channels = samples.shape[1]
    ffmpeg = mastering._find_binary("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg not on PATH")
    proc = await asyncio.to_thread(
        subprocess.run,
        [
            ffmpeg,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "f32le",
            "-ar",
            str(sample_rate),
            "-ac",
            str(n_channels),
            "-i",
            "-",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            str(path),
        ],
        input=samples.astype("<f4").tobytes(),
        capture_output=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg m4a encode failed: {proc.stderr}")


def _sine(freq_hz, duration_sec, sample_rate=44100, amplitude=0.5):
    t = np.arange(int(duration_sec * sample_rate)) / sample_rate
    return amplitude * np.sin(2 * math.pi * freq_hz * t)


# ---------------------------------------------------------------------------
# Pure DSP (no ffmpeg required)
# ---------------------------------------------------------------------------


def test_db_linear_round_trip():
    for db in (-60, -12, -6, 0, 6, 12):
        assert abs(mastering._linear_to_db(mastering._db_to_linear(db)) - db) < 0.01


def test_apply_gain_db_scales_and_clamps():
    samples = np.array([0.5, -0.5, 1.0, -1.0], dtype=np.float32)
    out = mastering._apply_gain_db(samples, 6.0)  # ~2x
    assert np.allclose(out, np.array([1.0, -1.0, 1.0, -1.0]), atol=0.01)
    # negative gain attenuates
    out = mastering._apply_gain_db(samples, -6.0)
    assert np.max(np.abs(out)) < np.max(np.abs(samples))


def test_true_peak_limit_keeps_peaks_below_ceiling():
    sample_rate = 44100
    # A signal peaking at 0 dBFS (full scale).
    samples = np.tile(np.linspace(-1.0, 1.0, 1000), 10).astype(np.float32).reshape(-1, 1)
    limited = mastering._true_peak_limit(samples, sample_rate, ceiling_dbtp=-3.0)
    peak = mastering._true_peak(limited, sample_rate)
    assert peak <= -3.0 + 0.5, f"true peak {peak:.2f} dBTP above ceiling -3 dBTP"


def test_true_peak_limit_noop_when_under_ceiling():
    samples = np.full((1000, 1), 0.1, dtype=np.float32)
    limited = mastering._true_peak_limit(samples, 44100, ceiling_dbtp=-1.0)
    assert np.allclose(limited, samples)


def test_demud_produces_finite_output():
    samples = _sine(50, 0.1)  # low freq, should be attenuated by 300 Hz HPF
    out = mastering._apply_demud(samples, 44100)
    assert out.shape == samples.shape
    assert np.all(np.isfinite(out))
    # Low frequency should be reduced.
    assert np.max(np.abs(out)) < np.max(np.abs(samples))


def test_presence_produces_finite_output():
    samples = _sine(4000, 0.1)
    out = mastering._apply_presence(samples, 44100)
    assert out.shape == samples.shape
    assert np.all(np.isfinite(out))


# ---------------------------------------------------------------------------
# ffmpeg-dependent: measure / master end-to-end
# ---------------------------------------------------------------------------


@requires_ffmpeg
@pytest.mark.asyncio
async def test_measure_loudness_returns_numbers(tmp_path):
    path = tmp_path / "tone.m4a"
    await _write_m4a(path, _sine(440, 1.0))
    m = await mastering.measure_loudness(path)
    assert m["error"] is None, m["error"]
    assert m["integrated_lufs"] is not None
    # true_peak / lra are optional: ebur128 may not report them for short tones.
    assert m["lra_lu"] is not None


@requires_ffmpeg
@pytest.mark.asyncio
async def test_master_file_writes_mastered_and_qc(tmp_path):
    sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

    src = tmp_path / "tone.m4a"
    await _write_m4a(src, _sine(440, 1.0))

    # Point AUDIO_DIR + MASTERED_DIR at tmp_path to keep output/audio/mastered clean.
    mastering.AUDIO_DIR = tmp_path
    mastering.MASTERED_DIR = tmp_path / "mastered"
    mastering.MASTERED_DIR.mkdir(parents=True, exist_ok=True)

    report = await mastering.master_file(
        "tone.m4a", target_lufs=-14.0, ceiling_dbtp=-1.0, tone_fixes=True
    )
    assert report.get("error") is None, report.get("error")
    assert report["mastered_path"] is not None
    assert report["before"]["integrated_lufs"] is not None
    assert report["after"]["integrated_lufs"] is not None
    assert report["applied"]["target_lufs"] == -14.0
    # Gain computed from measured source; assert it's a sensible negative gain.
    assert -12.0 <= report["applied"]["gain_db"] <= 0.0, report["applied"]
    # Mastered file exists and is non-empty.
    out = Path(report["mastered_path"])
    assert out.exists() and out.stat().st_size > 0
    # After loudness should be within 6 dB of target (MP3 re-measurement +
    # ebur128 gating on short tones can shift a few dB).
    after_lufs = report["after"]["integrated_lufs"]
    assert abs(after_lufs - (-14.0)) < 6.0, f"after {after_lufs:.2f} LUFS not near -14"


@requires_ffmpeg
@pytest.mark.asyncio
async def test_master_file_missing_source_returns_error(tmp_path):
    mastering.AUDIO_DIR = tmp_path
    report = await mastering.master_file("does_not_exist.wav")
    assert report["error"] is not None
    assert report["mastered_path"] is None
