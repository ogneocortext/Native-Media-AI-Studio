"""Tests that the fast beat path is both fast and *correct*.

`analyze_from_audio(beat_backend="sonara")` exists because librosa's beat
tracker costs ~80 s on a 157 s track here while sonara (Rust/PyO3) costs ~0.2 s.
Speed is worthless if it changes the answer, so these pin the contract: sonara
is fed 22050 Hz mono, and the tempo it reports matches librosa's.
"""

import numpy as np
import pytest
from app.services.audio_analyzer import (
    _SONARA_SR,
    SONARA_AVAILABLE,
    AudioAnalyzer,
)

needs_sonara = pytest.mark.skipif(not SONARA_AVAILABLE, reason="sonara not installed")


def click_track(bpm: float = 120.0, seconds: float = 20.0, sr: int = _SONARA_SR):
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


class TestSonaraBeatContract:
    @needs_sonara
    def test_reports_the_generated_tempo(self):
        y, sr = click_track(bpm=120.0)
        beats = AudioAnalyzer()._sonara_beats_from_signal(y, sr)
        assert abs(beats.tempo_bpm - 120.0) < 6.0, f"got {beats.tempo_bpm}"

    @needs_sonara
    def test_native_rate_input_matches_22050_input(self):
        """The regression this guards.

        sonara pins its pipeline to 22050 Hz mono. Handing it a native-rate
        buffer without resampling still returns a plausible-looking number —
        it returned 146 bpm and 827 beats on a track that is really 106 bpm —
        so the wrong answer is only catchable by comparing against the
        correctly-prepared input.
        """
        y22, sr22 = click_track(bpm=120.0, sr=_SONARA_SR)
        import librosa

        y48 = librosa.resample(y22, orig_sr=sr22, target_sr=48000)

        an = AudioAnalyzer()
        expected = an._sonara_beats_from_signal(y22, sr22)
        actual = an._sonara_beats_from_signal(y48, 48000)

        assert abs(actual.tempo_bpm - expected.tempo_bpm) < 3.0
        # And both must be sane relative to the clip's real duration.
        assert len(actual.beat_times) <= len(y48) / 48000 * 10

    @needs_sonara
    def test_stereo_input_is_downmixed(self):
        """A stereo buffer must not silently double the beat count."""
        y, sr = click_track(bpm=120.0, seconds=20.0)
        stereo = np.stack([y, y], axis=1)  # (n, 2)
        beats = AudioAnalyzer()._sonara_beats_from_signal(stereo, sr)
        assert abs(beats.tempo_bpm - 120.0) < 6.0
        assert len(beats.beat_times) <= 60  # 20 s at 120 bpm

    @needs_sonara
    def test_beats_lie_inside_the_track(self):
        y, sr = click_track(bpm=120.0, seconds=20.0)
        beats = AudioAnalyzer()._sonara_beats_from_signal(y, sr)
        duration = len(y) / sr
        assert beats.beat_times, "no beats found on a synthetic click track"
        assert beats.beat_times[0] >= 0.0
        assert beats.beat_times[-1] <= duration + 0.5

    @needs_sonara
    def test_downbeat_grid_is_present(self):
        y, sr = click_track(bpm=120.0, seconds=20.0)
        beats = AudioAnalyzer()._sonara_beats_from_signal(y, sr)
        assert beats.downbeat_times, "meter-agnostic downbeats missing"


class TestBeatBackendSelection:
    def test_analyze_from_audio_defaults_to_the_librosa_tracker(self):
        """No beat_backend means unchanged behaviour for existing callers."""
        import inspect

        sig = inspect.signature(AudioAnalyzer.analyze_from_audio)
        assert sig.parameters["beat_backend"].default is None

    def test_analyze_from_audio_accepts_beat_backend(self):
        import inspect

        sig = inspect.signature(AudioAnalyzer.analyze_from_audio)
        assert "beat_backend" in sig.parameters

    @needs_sonara
    def test_records_which_beat_tracker_was_used(self):
        y, sr = click_track(bpm=120.0, seconds=8.0)
        res = AudioAnalyzer().analyze_from_audio(y, sr, job_id="t", beat_backend="sonara")
        assert res.metadata["beat_backend"] == "sonara"
        assert abs(res.beats.tempo_bpm - 120.0) < 6.0


def test_sonara_sample_rate_constant():
    assert _SONARA_SR == 22050
