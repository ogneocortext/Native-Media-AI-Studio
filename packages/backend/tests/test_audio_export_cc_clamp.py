"""Regression guard: MIDI CC values must stay in [0, 127].

Before the fix, ``int(energy * 127)`` could yield 128 when ``energy`` exceeded
1.0 (amplitude envelopes are normalised to [0, 1], but numerical drift in the
probing pipeline occasionally pushes a sample above 1). MIDI CC is an unsigned
byte, so 128 is out of range and would write garbage to the file.
"""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..")))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "tools")))

from audio_export import _clamp_cc


def test_zero_energy_maps_to_zero():
    assert _clamp_cc(0.0) == 0


def test_one_energy_maps_to_max():
    assert _clamp_cc(1.0) == 127


def test_fractional_values_round_down():
    assert _clamp_cc(0.5) == 63
    assert _clamp_cc(0.49999) == 63


def test_over_one_is_clamped_to_127():
    # Energy above 1.0 must clamp to the top of the CC range.
    for e in (1.0, 1.5, 2.0, 3.7):
        assert _clamp_cc(e) == 127


def test_negative_is_clamped_to_zero():
    assert _clamp_cc(-0.5) == 0
