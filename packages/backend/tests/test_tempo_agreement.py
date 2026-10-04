"""Tests for the tempo agreement rule.

The headline case is `test_hitl_majority_vote_would_have_been_wrong`: it pins the
failure mode that motivated this module, so a future "simplify to a majority vote"
refactor fails here rather than silently shipping a wrong tempo.
"""

from __future__ import annotations

import pytest
from app.services import tempo_agreement as ta

# Measured on this library; see the knowledge-library article, section 6a.
HITL = {"librosa": 71.78, "madmom": 71.43, "essentia": 142.39}
AD_NAUSEAM = {"librosa": 143.55, "madmom": 72.29, "essentia": 143.63}
TAKE_CROWN = {"librosa": 152.00, "madmom": 150.00, "essentia": 150.22}
FIXTURE = {"librosa": 99.38, "madmom": 120.00, "essentia": 122.28}


@pytest.fixture(autouse=True)
def _restore_primary():
    original = ta.PRIMARY_ESTIMATOR
    yield
    ta.set_primary_estimator(original)


# ─── validity ─────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("value", [None, 0.0, -1.0, 19.9, 401.0, float("nan"), float("inf"), "x", True])
def test_non_tempos_are_rejected(value):
    assert not ta.is_valid_bpm(value)


@pytest.mark.parametrize("value", [71.78, 120.0, 143.55, 399.9])
def test_plausible_tempos_are_accepted(value):
    assert ta.is_valid_bpm(value)


def test_librosa_zero_sentinel_is_never_believed():
    """librosa returns 0.0 for silence and short clips; it must not become an answer."""
    result = ta.corroborate({"librosa": 0.0, "madmom": 0.0, "essentia": 0.0})
    assert result["bpm"] is None
    assert result["confidence"] == "none"


# ─── folding ──────────────────────────────────────────────────────────────────


def test_fold_picks_the_nearer_octave():
    assert ta.fold_to_reference(142.39, 142.0) == pytest.approx(142.39)
    assert ta.fold_to_reference(142.39, 71.2) == pytest.approx(71.195)


def test_octave_partners_do_not_count_as_agreeing():
    """`agree()` compares against the midpoint, so for octave partners the reference
    sits between the two candidates and the error is ~33% - they never agree.

    This is not a bug, it is the mechanism behind the headline failure: 71.78 and
    142.39 look like a disagreement to `agree()`, while the pair that genuinely
    shared an octave looked like a unanimous agreement. Folding helps when the two
    readings are close (99.38 vs 100.0); it cannot adjudicate a whole octave apart.
    """
    assert not ta.agree(142.39, 71.78)
    assert not ta.agree(143.55, 71.5)
    # Same octave but genuinely different: also not agreement.
    assert not ta.agree(142.39, 99.38)


def test_close_readings_agree_regardless_of_small_scale_error():
    assert ta.agree(100.0, 99.38)
    assert ta.agree(150.0, 152.0)


# ─── the headline case ────────────────────────────────────────────────────────


def test_hitl_majority_vote_would_have_been_wrong():
    """librosa and madmom agree with each other on 71.78; essentia says 142.39.

    A two-of-three vote picks the *agreeing pair*, which is the wrong answer -
    71.78 and 142.39 are octave partners, so the disagreement is invisible. This
    asserts the primary-authority rule instead.
    """
    result = ta.corroborate(HITL)
    assert result["bpm"] == pytest.approx(142.39)
    assert result["primary"] == "essentia"
    assert result["confidence"] == "medium"  # contradicted, not corroborated
    assert set(result["agreeing"]) == set()
    assert set(result["rejected"]) == {"librosa", "madmom"}


def test_madmom_is_the_outlier_on_ad_nauseam():
    result = ta.corroborate(AD_NAUSEAM)
    assert result["bpm"] == pytest.approx(143.63)
    assert result["agreeing"] == ["librosa"]
    assert "madmom" in result["rejected"]
    assert result["confidence"] == "high"


def test_all_three_agreeing_is_high_confidence():
    result = ta.corroborate(TAKE_CROWN)
    assert result["bpm"] == pytest.approx(150.22)
    assert set(result["agreeing"]) == {"librosa", "madmom"}
    assert result["confidence"] == "high"
    assert result["rejected"] == []


def test_disagreement_is_reported_not_hidden():
    """The 10s fixtures are the one case where no two really agree."""
    result = ta.corroborate(FIXTURE)
    assert result["bpm"] is not None
    assert result["agreeing"] == ["madmom"]
    assert "librosa" in result["rejected"]
    assert "contradicted" in result["reason"]


def test_single_usable_estimator_is_medium_not_high():
    result = ta.corroborate({"librosa": 0.0, "madmom": None, "essentia": 120.0})
    assert result["bpm"] == pytest.approx(120.0)
    assert result["confidence"] == "medium"
    assert "librosa" in result["rejected"]


def test_no_usable_estimator_yields_none():
    result = ta.corroborate({"librosa": 0.0, "madmom": None, "essentia": None})
    assert result["bpm"] is None
    assert result["confidence"] == "none"
    assert set(result["rejected"]) == {"librosa", "madmom", "essentia"}


# ─── fallback when the primary is unavailable ─────────────────────────────────


def test_fallback_is_explicitly_low_confidence_and_repeats_the_wrong_answer():
    """Documents the cost of losing essentia: the wrong tempo comes back, but it is
    flagged, so callers can refuse to use it."""
    ta.set_primary_estimator(None)
    result = ta.corroborate(HITL)
    assert result["bpm"] == pytest.approx(71.61)
    assert result["confidence"] == "low"
    assert result["primary"] is None
    assert "low confidence" in result["reason"]


def test_fallback_still_handles_the_normal_cases():
    ta.set_primary_estimator(None)
    assert ta.corroborate(AD_NAUSEAM)["confidence"] == "low"
    assert ta.corroborate({"librosa": 120.0, "madmom": 120.5})["bpm"] == pytest.approx(120.25)


def test_fallback_with_total_disagreement_returns_none():
    ta.set_primary_estimator(None)
    result = ta.corroborate({"librosa": 90.0, "madmom": 200.0})
    assert result["bpm"] is None
    assert "no two estimators agree" in result["reason"]


# ─── tolerance ────────────────────────────────────────────────────────────────


def test_tolerance_is_respected():
    assert ta.corroborate({"a": 100.0, "b": 104.0}, tolerance=0.05)["bpm"] == pytest.approx(102.0)
    assert ta.corroborate({"a": 100.0, "b": 140.0}, tolerance=0.05)["bpm"] is None
