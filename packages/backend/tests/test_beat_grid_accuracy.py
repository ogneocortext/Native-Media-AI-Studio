"""Beat-grid accuracy: onset snapping, two-pass tempo, madmom dispatch.

The librosa path used to feed ``beat_track`` a fixed 120 BPM prior and
its own internal full-mix onset envelope, and the grid it returned sat
wherever the DP regularisation put it. These tests pin the improved
contract:

- ``analyze_beats`` estimates the tempo from a superflux-style
  percussive onset envelope first (two-pass) and reports the prior used.
- ``snap_beats_to_onsets`` moves beats onto real onset peaks, and only
  onto real peaks.
- ``analyze_from_audio(beat_backend="madmom")`` actually dispatches to
  the madmom grid on a decoded buffer, and the metadata names the grid
  that was really used (including on fallback).
"""

import numpy as np
import pytest

pytest.importorskip("librosa")

from app.services import audio_analyzer as aa
from app.services.audio_analyzer import AudioAnalyzer, snap_beats_to_onsets

SR = 22050
HOP = 512


def click_track(bpm: float = 126.0, seconds: float = 20.0, sr: int = SR):
    """A synthetic click track: impulses on every beat at `bpm`."""
    n = int(seconds * sr)
    y = np.zeros(n, dtype=np.float32)
    interval = 60.0 / bpm
    t = 0.0
    while t < seconds - 0.05:
        idx = int(t * sr)
        y[idx : idx + int(0.01 * sr)] = 0.9
        t += interval
    return y, sr


# ---------------------------------------------------------------------------
# snap_beats_to_onsets
# ---------------------------------------------------------------------------


def _envelope_with_peak(peak_frame: int, n: int = 200):
    env = np.full(n, 0.1)
    env[peak_frame] = 5.0
    return env


def test_snap_moves_beat_to_nearby_onset_peak():
    # Beat at 1.000 s is frame ~43; the onset peak sits at frame 45 (~1.045 s).
    env = _envelope_with_peak(45)
    snapped = snap_beats_to_onsets([1.0], env, SR, HOP)
    assert len(snapped) == 1
    assert abs(snapped[0] - 45 * HOP / SR) < 1e-3  # snap rounds to ms, like the rest of the grid


def test_snap_leaves_beat_alone_when_no_peak_above_floor():
    # Flat envelope: nothing rises above the median, so nothing moves.
    env = np.full(200, 0.1)
    assert snap_beats_to_onsets([1.0, 3.0], env, SR, HOP) == [1.0, 3.0]


def test_snap_ignores_peaks_outside_the_window():
    # Peak at frame 100 is ~1.3 s from the beat — far outside +/-70 ms.
    env = _envelope_with_peak(100)
    assert snap_beats_to_onsets([1.0], env, SR, HOP) == [1.0]


def test_snap_handles_empty_inputs():
    assert snap_beats_to_onsets([], _envelope_with_peak(45), SR, HOP) == []
    assert snap_beats_to_onsets([1.0], None, SR, HOP) == [1.0]
    assert snap_beats_to_onsets([1.0], np.zeros(0), SR, HOP) == [1.0]


# ---------------------------------------------------------------------------
# analyze_beats two-pass tempo (tools/lib/audio.py)
# ---------------------------------------------------------------------------


def test_analyze_beats_two_pass_finds_click_tempo():
    _, analyze_beats, _ = aa._import_shared_audio()
    y, sr = click_track(bpm=126.0)
    result = analyze_beats(y, sr, use_gpu=False)
    assert abs(result["tempo"] - 126.0) <= 4.0
    # The reported prior must come from the estimate, not the old fixed 120.
    assert abs(result["start_bpm_used"] - 126.0) <= 6.0
    expected_beats = 20.0 * 126.0 / 60.0
    assert abs(len(result["beat_times"]) - expected_beats) <= 4


def test_analyze_beats_explicit_start_bpm_is_respected():
    _, analyze_beats, _ = aa._import_shared_audio()
    y, sr = click_track(bpm=126.0)
    result = analyze_beats(y, sr, use_gpu=False, start_bpm=90.0)
    assert result["start_bpm_used"] == 90.0


# ---------------------------------------------------------------------------
# madmom beat_backend dispatch on a decoded buffer
# ---------------------------------------------------------------------------


def test_madmom_beat_backend_dispatches_and_reports(monkeypatch):
    def fake_grid(y_44k):
        beats = [round(0.5 * i, 3) for i in range(1, 40)]
        downbeats = beats[::4]
        return beats, downbeats

    monkeypatch.setattr(aa, "MADMOM_AVAILABLE", True)
    monkeypatch.setattr(aa, "_madmom_beats_downbeats", fake_grid)

    y, sr = click_track()
    result = AudioAnalyzer().analyze_from_audio(y, sr, beat_backend="madmom")
    assert result.metadata["beat_backend"] == "madmom"
    assert result.beats is not None
    assert abs(result.beats.tempo_bpm - 120.0) <= 1.0
    assert result.beats.downbeat_times == [round(0.5 * i, 3) for i in range(1, 40, 4)]  # fake grid's beats[::4]


def test_madmom_beat_backend_falls_back_and_reports_librosa(monkeypatch):
    monkeypatch.setattr(aa, "MADMOM_AVAILABLE", False)
    y, sr = click_track()
    result = AudioAnalyzer().analyze_from_audio(y, sr, beat_backend="madmom")
    assert result.metadata["beat_backend"] == "librosa"
    assert result.beats is not None
    assert len(result.beats.beat_times) > 0
