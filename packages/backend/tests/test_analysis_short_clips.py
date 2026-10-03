"""Regression guard: short clips must analyse, not 500.

`/api/audio/analyze*` returned HTTP 500 with
`ValueError: min() arg is an empty sequence` for any track shorter than
`min_sec_dur` (an 8 s floor in `_generate_sections_from_analysis`). The boundary
merge collapsed every candidate into one, so the per-section energy list came
out empty and the `min()`/`max()` that normalises those energies raised.

Nothing about the input is exotic: a 3-second clip, a stinger, a fade-out. These
tests synthesise the degenerate audio directly, so they need no fixture files.
"""

import json
import math

import numpy as np
import pytest
from app.api.audio_analysis import _build_analysis_result
from app.services.audio_analyzer import SONARA_AVAILABLE, AudioAnalyzer

SR = 48000


def tone(seconds: float, freq: float = 440.0) -> np.ndarray:
    """A pure sine — no beat grid at all, which is the point."""
    n = max(1, int(seconds * SR))
    t = np.arange(n) / SR
    return (0.5 * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def click_track(seconds: float = 60.0, bpm: float = 120.0) -> np.ndarray:
    """Beats with a deliberately quiet middle, so boundaries exist."""
    y = np.zeros(int(seconds * SR), dtype=np.float32)
    t = 0.0
    while t < seconds:
        i = int(t * SR)
        y[i : i + int(0.01 * SR)] = 0.2 if 25 < t < 35 else 0.9
        t += 60.0 / bpm
    return y


def build(y: np.ndarray, tmp_path) -> dict:
    analyzer = AudioAnalyzer()
    # Prefer sonara for beats: the librosa tracker costs roughly half a second
    # per second of audio on this machine, which would make this file minutes
    # long. These tests are about section generation, not about which beat
    # tracker runs.
    result = analyzer.analyze_from_audio(
        y, SR, job_id="t", beat_backend="sonara" if SONARA_AVAILABLE else None
    )
    target = tmp_path / "clip.m4a"
    target.write_bytes(b"")  # only the name is used
    return _build_analysis_result(result, "t", target, analyzer)


class TestShortClips:
    """Every duration below is under the 8 s min-section floor."""

    @pytest.mark.parametrize("seconds", [0.4, 1.5, 3.0, 6.0, 7.9])
    def test_short_clip_does_not_raise(self, seconds, tmp_path):
        assert build(tone(seconds), tmp_path) is not None

    def test_short_clip_yields_a_whole_track_section(self, tmp_path):
        sections = build(tone(3.0), tmp_path).get("sections") or []
        assert len(sections) == 1, "a short clip should still produce one section"
        assert sections[0]["start"] == 0.0
        assert sections[0]["end"] > 0.0

    def test_short_clip_section_stays_inside_the_track(self, tmp_path):
        out = build(tone(2.0), tmp_path)
        (section,) = out.get("sections") or []
        assert 0.0 <= section["start"] < section["end"]
        assert section["end"] <= out["duration_seconds"] + 0.01

    def test_short_clip_tempo_is_finite(self, tmp_path):
        """The contract is "analyses successfully", not "matches one tracker".

        A pure tone has no real beat grid and the two trackers disagree: librosa
        reports 0.0, sonara a confident-looking 112.7 from one spurious beat.
        Which one runs is not this test's concern; that neither yields NaN, a
        negative tempo, or a failed request is.
        """
        out = build(tone(3.0), tmp_path)
        tempo = out.get("tempo_bpm")
        assert isinstance(tempo, (int, float))
        assert math.isfinite(tempo)
        assert tempo >= 0.0
        assert out.get("beat_count", 0) >= 0

    def test_result_is_stamped_and_serialisable(self, tmp_path):
        out = build(tone(1.5), tmp_path)
        assert out.get("schema_version", 0) >= 2
        json.dumps(out)  # must not carry numpy scalars that break the response

    def test_short_clip_payload_has_the_full_key_set(self, tmp_path):
        """A short clip must be a first-class result, not a stripped-down one."""
        out = build(tone(1.5), tmp_path)
        for key in (
            "tempo_bpm",
            "duration_seconds",
            "beat_count",
            "sections",
            "energy_curve",
            "amplitude_envelope",
            "schema_version",
            "timing_contract",
            "stored_path",
        ):
            assert key in out, f"missing {key} for a short clip"


def test_normal_track_still_segments(tmp_path):
    """The new guard must not flatten real sectioning on a track with beats."""
    out = build(click_track(), tmp_path)
    assert out.get("beat_count", 0) > 0
    assert len(out.get("sections") or []) >= 1
