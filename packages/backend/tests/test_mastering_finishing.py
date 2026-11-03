"""
Tests for the T-AUD-08 corrective finishing chain (services/mastering.py).

The unit tests exercise ``_apply_finishing_chain`` directly (pure DSP, no
ffmpeg). The end-to-end tests encode the T-AUD-08 acceptance criteria as
executable assertions, run against a synthetic "AI defect" fixture whose
band profile mirrors the E1 reference take (sub-heavy, presence-starved):

  - sub share (20-120 Hz) starts E1-like (~75%) and must land <= 48%
  - presence share (2-8 kHz) starts E1-like (~4%) and must land >= 12%
  - final loudness of the written artifact within -14.0 +/- 0.5 LUFS,
    re-measured from the mastered file (D17: assert the artifact)

Band shares are computed with the module's own ``_band_energy_db`` against
the decoded artifact's total RMS, so before/after use one definition.

ffmpeg-dependent tests skip when ffmpeg is absent, matching test_mastering.py.
"""

from __future__ import annotations

import asyncio
import math
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

FFMPEG = shutil.which("ffmpeg")
requires_ffmpeg = pytest.mark.skipif(
    not FFMPEG, reason="ffmpeg not on PATH; master end-to-end skipped"
)

import app.services.mastering as mastering  # noqa: E402
from scipy import signal as scipy_signal  # noqa: E402

SR = 44100


def _sine(freq_hz, duration_sec, amplitude=0.5, sample_rate=SR):
    t = np.arange(int(duration_sec * sample_rate)) / sample_rate
    return amplitude * np.sin(2 * math.pi * freq_hz * t)


async def _write_m4a(path, samples, sample_rate=SR):
    """Encode a real m4a (AAC) file from samples via ffmpeg (as test_mastering)."""
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


def _defect_mix(duration_sec=8.0):
    """Synthetic sub-heavy / presence-light stereo mix (the AI-defect profile).

    Component powers put the sub share near E1's 75.6% and the presence
    share near E1's 3.8% before any finishing is applied.
    """
    mono = (
        _sine(50, duration_sec, 0.45)
        + _sine(100, duration_sec, 0.20)
        + _sine(300, duration_sec, 0.22)
        + _sine(800, duration_sec, 0.12)
        + _sine(3200, duration_sec, 0.10)
        + _sine(9000, duration_sec, 0.05)
    )
    mono = (0.8 * mono).astype(np.float32)
    return np.column_stack([mono, mono * 0.98]).astype(np.float32)


def _share_pct(samples, sample_rate, low_hz, high_hz):
    """Band share of total power (%), via the module's own band measurement."""
    band_db = mastering._band_energy_db(samples, sample_rate, low_hz, high_hz)
    mono = np.mean(samples, axis=1) if samples.ndim == 2 else samples
    total_rms = float(np.sqrt(np.mean(mono**2) + 1e-12))
    total_db = 20.0 * math.log10(total_rms)
    return 100.0 * 10.0 ** ((band_db - total_db) / 10.0)


def _sub_share(samples, sample_rate):
    return _share_pct(
        samples, sample_rate, mastering.BAND_SUB_LO_HZ, mastering.BAND_SUB_HI_HZ
    )


def _presence_share(samples, sample_rate):
    return _share_pct(
        samples,
        sample_rate,
        mastering.BAND_PRESENCE_LO_HZ,
        mastering.BAND_PRESENCE_HI_HZ,
    )


# ---------------------------------------------------------------------------
# Pure DSP (no ffmpeg required): the filter designs themselves, measured
# with freqz against what their names and docstrings promise.
# ---------------------------------------------------------------------------


def _response_db(design, freqs):
    b, a = design
    _, h = scipy_signal.freqz(b, a, worN=list(freqs), fs=SR)
    return {f: float(20.0 * math.log10(abs(mag))) for f, mag in zip(freqs, h)}


def test_lowshelf_zero_gain_is_identity():
    resp = _response_db(
        mastering._design_lowshelf(SR, 120, 0.0, mastering.FINISHING_LOW_SHELF_Q),
        [50, 300, 1000, 5000],
    )
    for f, db in resp.items():
        assert abs(db) <= 0.25, f"0 dB lowshelf moves {f} Hz by {db:+.1f} dB"


def test_lowshelf_design_shape():
    resp = _response_db(
        mastering._design_lowshelf(SR, 120, -3.0, mastering.FINISHING_LOW_SHELF_Q),
        [50, 1000],
    )
    # A -3 dB shelf at 120 Hz: ~-3 dB deep in the shelf band, ~0 dB above it.
    assert -4.5 <= resp[50] <= -1.5, resp
    assert abs(resp[1000]) <= 0.5, resp


def test_peaking_zero_gain_is_identity():
    resp = _response_db(
        mastering._design_peaking(SR, 3200, 0.0, mastering.FINISHING_PEAK_Q),
        [50, 300, 3200, 9000],
    )
    for f, db in resp.items():
        assert abs(db) <= 0.25, f"0 dB peaking moves {f} Hz by {db:+.1f} dB"


def test_peaking_design_shape():
    resp = _response_db(
        mastering._design_peaking(SR, 3200, 2.5, mastering.FINISHING_PEAK_Q),
        [300, 3200],
    )
    # A +2.5 dB peak at 3.2 kHz: the lift lives at the centre, not broadband.
    assert 1.5 <= resp[3200] <= 3.5, resp
    assert abs(resp[300]) <= 0.75, resp


def test_highshelf_design_shape():
    resp = _response_db(
        mastering._design_highshelf(
            SR, 9000, mastering.FINISHING_HIGH_SHELF_GAIN_DB, mastering.FINISHING_HIGH_SHELF_Q
        ),
        [300, 12000],
    )
    # A +1.5 dB shelf at 9 kHz: lift above the corner, ~0 dB in the body.
    assert 0.75 <= resp[12000] <= 2.25, resp
    assert abs(resp[300]) <= 0.5, resp


def test_finishing_chain_moves_broadband_shares_in_the_right_direction():
    """Direction-only guard over the whole chain (any correct chain passes)."""
    mix = _defect_mix(duration_sec=2.0)
    out = mastering._apply_finishing_chain(mix, SR, 3.0, 2.5)
    assert out.shape == mix.shape
    assert np.all(np.isfinite(out))
    assert _sub_share(out, SR) < _sub_share(mix, SR) - 10.0
    assert _presence_share(out, SR) > _presence_share(mix, SR) + 3.0


# ---------------------------------------------------------------------------
# End-to-end acceptance (ffmpeg required)
# ---------------------------------------------------------------------------


async def _run_finishing_master(tmp_path, **overrides):
    src = tmp_path / "defect.m4a"
    await _write_m4a(src, _defect_mix())
    mastering.AUDIO_DIR = tmp_path
    mastering.MASTERED_DIR = tmp_path / "mastered"
    mastering.MASTERED_DIR.mkdir(parents=True, exist_ok=True)
    kwargs = dict(
        target_lufs=-14.0,
        ceiling_dbtp=-1.0,
        tone_fixes=True,
        finishing=True,
        sub_cut_db=3.0,
        presence_db=2.5,
    )
    kwargs.update(overrides)
    report = await mastering.master_file("defect.m4a", **kwargs)
    assert report.get("error") is None, report.get("error")
    return report


@requires_ffmpeg
@pytest.mark.asyncio
async def test_fixture_has_the_defect_profile(tmp_path):
    """Guard: if the fixture drifts, the acceptance tests below test nothing."""
    src = tmp_path / "defect.m4a"
    mix = _defect_mix()
    await _write_m4a(src, mix)
    pcm = await mastering._decode_audio(src)
    assert _sub_share(pcm.samples, pcm.sample_rate) >= 65.0
    assert _presence_share(pcm.samples, pcm.sample_rate) <= 8.0


@requires_ffmpeg
@pytest.mark.asyncio
async def test_finishing_brings_sub_share_into_acceptance(tmp_path):
    report = await _run_finishing_master(tmp_path)
    pcm = await mastering._decode_audio(Path(report["mastered_path"]))
    after_sub = _sub_share(pcm.samples, pcm.sample_rate)
    # T-AUD-08 acceptance: sub share <= 48% (E1 reference: 75.6% -> 43.8%).
    assert after_sub <= 48.0, f"sub share {after_sub:.1f}% above the 48% ceiling"


@requires_ffmpeg
@pytest.mark.asyncio
async def test_finishing_brings_presence_share_into_acceptance(tmp_path):
    report = await _run_finishing_master(tmp_path)
    pcm = await mastering._decode_audio(Path(report["mastered_path"]))
    after_presence = _presence_share(pcm.samples, pcm.sample_rate)
    # T-AUD-08 acceptance: presence share >= 12% (E1 reference: 3.8% -> 14.6%).
    assert after_presence >= 12.0, (
        f"presence share {after_presence:.1f}% below the 12% floor"
    )


@requires_ffmpeg
@pytest.mark.asyncio
async def test_finishing_final_loudness_within_acceptance_tolerance(tmp_path):
    report = await _run_finishing_master(tmp_path)
    after_lufs = report["after"]["integrated_lufs"]
    assert after_lufs is not None
    # T-AUD-08 acceptance: final loudness -14.0 +/- 0.5 LUFS, re-measured from
    # the written artifact. The 2026-11-03 stand-in run measured -14.6 via
    # compute_loudness; if this test fails the same way, the gain loop is
    # closing on a pre-limiter measurement and must trim after limiting.
    assert abs(after_lufs - (-14.0)) <= 0.5, (
        f"final loudness {after_lufs:.2f} LUFS outside -14.0 +/- 0.5"
    )


@requires_ffmpeg
@pytest.mark.asyncio
async def test_no_finishing_params_matches_explicit_defaults(tmp_path):
    """Acceptance clause: callers passing no finishing params are unchanged."""
    src = tmp_path / "defect.m4a"
    await _write_m4a(src, _defect_mix(duration_sec=4.0))
    mastering.AUDIO_DIR = tmp_path
    mastering.MASTERED_DIR = tmp_path / "mastered"
    mastering.MASTERED_DIR.mkdir(parents=True, exist_ok=True)

    default = await mastering.master_file("defect.m4a", target_lufs=-14.0)
    explicit = await mastering.master_file(
        "defect.m4a",
        target_lufs=-14.0,
        finishing=False,
        sub_cut_db=0.0,
        presence_db=0.0,
    )
    assert default.get("error") is None and explicit.get("error") is None
    assert default["applied"]["finishing"] is False
    assert default["applied"]["band_energy"] == explicit["applied"]["band_energy"]
    d_lufs = default["after"]["integrated_lufs"]
    e_lufs = explicit["after"]["integrated_lufs"]
    assert abs(d_lufs - e_lufs) <= 0.05, (d_lufs, e_lufs)
