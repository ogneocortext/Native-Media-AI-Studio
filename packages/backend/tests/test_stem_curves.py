"""Tests for the shared stem-curve resampler.

These existed before as two byte-identical private copies with **no coverage at
all** - `stem_visualization` was untested, so a fix to `stem_analysis` would have
left the visualization path silently wrong. Consolidating is only half the point;
these are the other half.
"""

from __future__ import annotations

from app.services.stem_curves import downsample_curve


def test_empty_curve():
    assert downsample_curve([], 10) == []


def test_short_curve_is_returned_unchanged_as_floats():
    assert downsample_curve([1, 2, 3], 10) == [1.0, 2.0, 3.0]


def test_exact_length_is_unchanged():
    assert downsample_curve([1, 2, 3], 3) == [1.0, 2.0, 3.0]


def test_result_length_never_exceeds_target():
    for target in (1, 2, 5, 17, 64):
        assert len(downsample_curve(list(range(1000)), target)) <= target


def test_max_pooling_preserves_a_narrow_peak():
    """The whole reason for max rather than mean: an envelope's peaks are the signal."""
    curve = [0.0] * 49 + [9.0] + [0.0] * 50
    out = downsample_curve(curve, 10)
    assert max(out) == 9.0, "averaging would have erased the transient"


def test_mean_would_have_lost_the_peak_which_is_why_max_is_used():
    curve = [0.0] * 99 + [100.0]
    out = downsample_curve(curve, 100)
    assert out[-1] == 100.0


def test_all_zero_curve_stays_zero():
    assert downsample_curve([0.0] * 200, 8) == [0.0] * 8


def test_input_is_not_mutated():
    curve = [1.0, 2.0, 3.0, 4.0]
    before = list(curve)
    downsample_curve(curve, 2)
    assert curve == before


def test_non_positive_target_is_empty_not_an_error():
    # A zero target would make `segment` a division by zero without this guard.
    assert downsample_curve([1.0, 2.0, 3.0], 0) == []
    assert downsample_curve([1.0, 2.0, 3.0], -5) == []


def test_values_are_floats():
    out = downsample_curve([1, 2, 3, 4, 5, 6], 3)
    assert all(isinstance(v, float) for v in out)
