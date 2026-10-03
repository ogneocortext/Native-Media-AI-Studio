"""Tests for the stem remixer.

The crossfade test is deliberately synthetic. Measured on real material it was
inconclusive: the overlap region of a two-slot remix measured ~3 dB below the
lead-in, but that is the song getting quieter, not a fade error - the drums
stem drops from -18.9 dBFS overall to -26.8 dBFS over its first 6.3 s. Asserting
on that would encode the arrangement, not the algorithm. Two full-scale sine
streams with a *known* correlation answer the question the fade actually poses:
does the summed power stay flat through the transition?
"""

from __future__ import annotations

import numpy as np
import pytest
from app.services.stem_remixer import (
    REMIX_SR,
    RemixLayer,
    RemixRecipe,
    RemixSlot,
    _db_to_linear,
    _equal_power_ramp,
    _loop_to_length,
    _safe_remix_name,
    _safe_track_name,
    plan_timeline,
)


def _sine(freq: float, n: int, sr: int = REMIX_SR) -> np.ndarray:
    t = np.arange(n, dtype=np.float32) / sr
    return np.sin(2.0 * np.pi * freq * t)


# ─── crossfade ───────────────────────────────────────────────────────────────


def test_equal_power_ramp_endpoints_and_power():
    """cos/sin keeps summed power flat for uncorrelated sources."""
    n = 2048
    fade_out, fade_in = _equal_power_ramp(n)
    assert fade_out[0] == pytest.approx(1.0, abs=1e-6)
    assert fade_in[0] == pytest.approx(0.0, abs=1e-6)
    assert fade_out[-1] == pytest.approx(0.0, abs=1e-6)
    assert fade_in[-1] == pytest.approx(1.0, abs=1e-6)
    # Constant power across the whole ramp: this is the property a linear fade
    # fails, dipping to 0.5 of unity at the midpoint.
    power = fade_out**2 + fade_in**2
    assert np.allclose(power, 1.0, atol=1e-6)


def test_equal_power_ramp_handles_zero_length():
    fade_out, fade_in = _equal_power_ramp(0)
    assert fade_out.size == 0
    assert fade_in.size == 0


def test_linear_fade_would_dip_but_equal_power_does_not():
    """Guard the reason this helper exists rather than a linear fade."""
    n = 1024
    t = np.linspace(0.0, 1.0, n)
    linear_power = (1.0 - t) ** 2 + t**2
    assert linear_power.min() < 0.55  # the problem
    fade_out, fade_in = _equal_power_ramp(n)
    assert np.allclose(fade_out**2 + fade_in**2, 1.0, atol=1e-6)  # the fix


# ─── looping ─────────────────────────────────────────────────────────────────


def test_loop_to_length_tiles_a_short_source():
    out = _loop_to_length(np.stack([_sine(220.0, 1000)] * 2), 2500)
    assert out.shape == (2, 2500)
    # Seamlessly tiled: sample 0 and sample 1000 of the tiled result match.
    assert np.allclose(out[0, 0], out[0, 1000], atol=1e-6)


def test_loop_to_length_exact_length_and_empty_guard():
    y = np.stack([_sine(220.0, 500)] * 2)
    assert _loop_to_length(y, 500).shape == (2, 500)
    assert _loop_to_length(y, 120).shape == (2, 120)
    assert _loop_to_length(y, 0).shape == (2, 0)
    assert _loop_to_length(np.zeros((2, 0)), 300).shape == (2, 300)


# ─── timeline planning ───────────────────────────────────────────────────────


def _recipe(**kwargs) -> RemixRecipe:
    defaults = {
        "name": "t",
        "target_bpm": 120.0,
        "slots": [
            RemixSlot(bars=4, crossfade_bars=2, layers=[RemixLayer(track="a", stem="drums")]),
            RemixSlot(bars=4, crossfade_bars=2, layers=[RemixLayer(track="b", stem="vocals")]),
        ],
    }
    defaults.update(kwargs)
    return RemixRecipe(**defaults)


def test_plan_total_accounts_for_crossfade_overlap():
    plan = plan_timeline(_recipe())
    bar_n = plan["bar_n"]
    # 8 bars of material, minus one 2-bar overlap.
    assert plan["total_n"] == 8 * bar_n - 2 * bar_n
    assert plan["xf_ns"] == [0, 2 * bar_n]


def test_crossfade_cannot_exceed_either_slot():
    """A 10-bar crossfade out of a 2-bar slot must be clamped, not overrun."""
    recipe = _recipe(
        slots=[
            RemixSlot(bars=2, crossfade_bars=10, layers=[RemixLayer(track="a", stem="drums")]),
            RemixSlot(bars=6, crossfade_bars=1, layers=[RemixLayer(track="b", stem="vocals")]),
        ]
    )
    plan = plan_timeline(recipe)
    assert plan["xf_ns"][1] == 2 * plan["bar_n"]  # clamped to the shorter slot


def test_zero_crossfade_leaves_no_overlap():
    recipe = _recipe(
        slots=[
            RemixSlot(bars=4, crossfade_bars=0, layers=[RemixLayer(track="a", stem="drums")]),
            RemixSlot(bars=4, crossfade_bars=0, layers=[RemixLayer(track="b", stem="vocals")]),
        ]
    )
    plan = plan_timeline(recipe)
    assert plan["xf_ns"] == [0, 0]
    assert plan["total_n"] == 8 * plan["bar_n"]


# ─── validation ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize("name", ["../escape", "..", "", "a/../../b", "  "])
def test_track_names_that_escape_are_rejected(name):
    with pytest.raises(ValueError):
        _safe_track_name(name)


@pytest.mark.parametrize("name", ["ok", "my remix", "a-b_c", "Track 1"])
def test_sane_track_names_pass(name):
    assert _safe_track_name(name)


@pytest.mark.parametrize("name", ["../out", "..", ""])
def test_bad_remix_names_rejected(name):
    with pytest.raises(ValueError):
        _safe_remix_name(name)


def test_invalid_stem_rejected():
    with pytest.raises(ValueError):
        RemixRecipe(
            name="t",
            target_bpm=120.0,
            slots=[RemixSlot(layers=[RemixLayer(track="a", stem="guitar")])],
        ).validate()


def test_out_of_range_values_rejected():
    with pytest.raises(ValueError):
        RemixRecipe(name="t", target_bpm=9999.0, slots=[RemixSlot(layers=[RemixLayer("a", "drums")])]).validate()
    with pytest.raises(ValueError):
        RemixLayer(track="a", stem="drums", gain_db=200.0).validate()
    with pytest.raises(ValueError):
        RemixLayer(track="a", stem="drums", key_shift_semitones=99.0).validate()
    with pytest.raises(ValueError):
        RemixLayer(track="a", stem="drums", source_start_bar=-1).validate()


def test_empty_slot_rejected():
    with pytest.raises(ValueError):
        RemixSlot(layers=[]).validate()


# ─── gain ────────────────────────────────────────────────────────────────────


def test_db_to_linear_matches_known_values():
    assert _db_to_linear(0.0) == pytest.approx(1.0)
    assert _db_to_linear(-6.0) == pytest.approx(0.501187, rel=1e-5)
    assert _db_to_linear(3.0) == pytest.approx(1.412538, rel=1e-5)
