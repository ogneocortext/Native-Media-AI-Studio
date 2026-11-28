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
import re
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
    # A 0 dBFS sine — program material, not a discontinuity (whose resample
    # ringing would be a metering artifact, not a limiter failure).
    t = np.arange(sample_rate * 2) / sample_rate
    samples = np.sin(2 * math.pi * 997 * t).reshape(-1, 1).astype(np.float32)
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
async def test_master_file_writes_mastered_and_qc(tmp_path, temp_db):
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


@requires_ffmpeg
@pytest.mark.asyncio
async def test_master_file_after_true_peak_matches_independent_ebur128(tmp_path, temp_db):
    """QC honesty: ``after.true_peak_dbtp`` is the ebur128 measure of the
    written artifact — it must match an independent ebur128 run on the same
    file, and the limiter's internal estimate must appear only under its own
    ``applied.true_peak_estimate_dbtp`` name."""
    mastering.AUDIO_DIR = tmp_path
    mastering.MASTERED_DIR = tmp_path / "mastered"
    mastering.MASTERED_DIR.mkdir(parents=True, exist_ok=True)
    src = tmp_path / "tone.m4a"
    await _write_m4a(src, _sine(440, 2.0))

    report = await mastering.master_file(
        "tone.m4a", target_lufs=-14.0, ceiling_dbtp=-1.0
    )
    assert report.get("error") is None, report.get("error")
    out = Path(report["mastered_path"])
    assert out.exists() and out.stat().st_size > 0

    proc = subprocess.run(
        [
            FFMPEG, "-hide_banner", "-nostats", "-i", str(out),
            "-af", "ebur128=peak=true", "-f", "null", "-",
        ],
        capture_output=True, text=True, encoding="utf-8", timeout=120,
    )
    m = re.search(
        r"True peak:\s*\n\s*Peak:\s*([+-]?\d+(?:\.\d+)?)\s*dBFS",
        proc.stderr or "",
        re.IGNORECASE,
    )
    assert m, f"could not parse ebur128 true peak: {(proc.stderr or '')[-400:]}"
    independent_tp = float(m.group(1))

    reported_tp = report["after"]["true_peak_dbtp"]
    assert reported_tp is not None
    assert abs(reported_tp - independent_tp) <= 0.1, (
        f"QC true_peak {reported_tp} vs independent ebur128 {independent_tp}"
    )
    assert "true_peak_estimate_dbtp" in report["applied"]


@requires_ffmpeg
@pytest.mark.asyncio
async def test_master_file_ceiling_loop_converges_on_hot_input(tmp_path, temp_db):
    """A 7 kHz square wave produces inter-sample peaks the old 2x estimate
    missed by >10 dB. With the repaired estimator plus the bounded
    compliance loop, the written MP3 must land at or below the -1 dBTP
    ceiling with no exceedance warning."""
    mastering.AUDIO_DIR = tmp_path
    mastering.MASTERED_DIR = tmp_path / "mastered"
    mastering.MASTERED_DIR.mkdir(parents=True, exist_ok=True)

    sample_rate = 48000
    t = np.arange(sample_rate * 3) / sample_rate
    sq = np.sign(np.sin(2 * math.pi * 7000 * t))
    stereo = (np.stack([sq, np.roll(sq, 5)], axis=1) * 0.9).astype(np.float32)
    src = tmp_path / "hot_square.wav"
    # 16-bit PCM, not float WAV: the quantization noise is part of what pushes
    # the inter-sample peaks over the ceiling on this signal.
    with wave.open(str(src), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes((stereo * 32767).astype("<i2").tobytes())

    report = await mastering.master_file(
        "hot_square.wav", target_lufs=-14.0, ceiling_dbtp=-1.0
    )
    assert report.get("error") is None, report.get("error")

    after_tp = report["after"]["true_peak_dbtp"]
    assert after_tp is not None and after_tp <= -1.0, (
        f"expected compliant true peak, got {after_tp}"
    )
    warnings = report.get("qc_warnings") or []
    assert not any("exceeds ceiling" in w for w in warnings), warnings


@requires_ffmpeg
@pytest.mark.asyncio
async def test_master_file_ceiling_loop_warns_after_max_attempts(
    tmp_path, monkeypatch, temp_db
):
    """Pathological case: if the artifact still measures over ceiling after
    MAX_CEILING_PASSES trims, qc_warnings must state the final value and the
    number of attempts — never an over-ceiling file with empty warnings."""
    mastering.AUDIO_DIR = tmp_path
    mastering.MASTERED_DIR = tmp_path / "mastered"
    mastering.MASTERED_DIR.mkdir(parents=True, exist_ok=True)
    src = tmp_path / "tone.m4a"
    await _write_m4a(src, _sine(440, 2.0))

    async def fake_measure(_path):
        return {
            "integrated_lufs": -14.0,
            "true_peak_dbtp": 5.0,
            "lra_lu": 5.0,
            "error": None,
        }

    monkeypatch.setattr(mastering, "measure_loudness", fake_measure)

    report = await mastering.master_file(
        "tone.m4a", target_lufs=-14.0, ceiling_dbtp=-1.0
    )
    assert report.get("error") is None, report.get("error")
    assert report["applied"]["ceiling_compliance_attempts"] == (
        mastering.MAX_CEILING_PASSES
    )
    warnings = report.get("qc_warnings") or []
    assert any(
        "still exceeds ceiling" in w and "attempts" in w for w in warnings
    ), warnings


@requires_ffmpeg
@pytest.mark.asyncio
async def test_master_file_records_provenance(tmp_path, temp_db):
    """A successful master writes a ``<file>.provenance.json`` sidecar and a
    ``media_provenance`` DB row linking output -> source, so the origin
    survives restarts."""
    import json as _json

    from app.core.database import get_derivatives, get_provenance

    mastering.AUDIO_DIR = tmp_path
    mastering.MASTERED_DIR = tmp_path / "mastered"
    mastering.MASTERED_DIR.mkdir(parents=True, exist_ok=True)
    src = tmp_path / "tone.m4a"
    await _write_m4a(src, _sine(440, 1.0))

    report = await mastering.master_file(
        "tone.m4a", target_lufs=-14.0, ceiling_dbtp=-1.0
    )
    assert report.get("error") is None, report.get("error")
    out = Path(report["mastered_path"])

    sidecar = out.with_name(out.name + ".provenance.json")
    assert sidecar.is_file(), "provenance sidecar missing"
    record = _json.loads(sidecar.read_text(encoding="utf-8"))
    assert record["tool"] == "mastering"
    assert record["source_paths"] and record["source_paths"][0].endswith(
        "tone.m4a"
    )
    assert "tone.m4a" in record["source_paths"][0]

    rows = get_provenance(record["output_path"])
    assert rows, "no media_provenance row for mastered file"
    assert rows[0]["tool"] == "mastering"
    assert any("tone.m4a" in s for s in rows[0]["source_paths"])

    # The reverse link: asking what derived from the source finds the master.
    src_rel = record["source_paths"][0]
    derivatives = get_derivatives(src_rel)
    assert any(d["output_path"] == record["output_path"] for d in derivatives)
