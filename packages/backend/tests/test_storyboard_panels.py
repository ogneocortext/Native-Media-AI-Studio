"""Tests for the panel lifecycle (Step 5 S4, R5)."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services.storyboard_panels import (
    ACCEPTED,
    GENERATED,
    PANEL_STATES,
    PLANNED,
    REJECTED,
    apply_verdict,
    mark_generated,
    stamp_planned,
)


def _planned(scene_id: str = "scene-1") -> dict:
    return stamp_planned([{"id": scene_id}])[0]


def _generated(scene_id: str = "scene-1") -> dict:
    return mark_generated(_planned(scene_id), "panel.png")


def test_states_are_the_four_lifecycle_values() -> None:
    assert PANEL_STATES == (PLANNED, GENERATED, ACCEPTED, REJECTED)


def test_stamp_planned_sets_state_and_discards_incoming_values() -> None:
    original = [{"id": "s1", "state": "accepted", "reject_reason": "old verdict"}]
    stamped = stamp_planned(original)

    assert stamped[0]["state"] == PLANNED
    assert "reject_reason" not in stamped[0]
    # Pure: the input dict is not mutated.
    assert original[0]["state"] == "accepted"


def test_the_three_legal_transitions_pass() -> None:
    planned = _planned()
    assert planned["state"] == PLANNED

    generated = mark_generated(planned, "panel.png")
    assert generated["state"] == GENERATED
    assert generated["panel_image"] == "panel.png"

    accepted = apply_verdict(generated, accepted=True, reason=None)
    assert accepted["state"] == ACCEPTED
    assert "reject_reason" not in accepted

    rejected = apply_verdict(generated, accepted=False, reason="wrong place")
    assert rejected["state"] == REJECTED
    assert rejected["reject_reason"] == "wrong place"


def test_planned_to_accepted_is_illegal() -> None:
    with pytest.raises(ValueError, match="planned.*accepted"):
        apply_verdict(_planned(), accepted=True, reason=None)


def test_accepted_to_generated_is_illegal() -> None:
    accepted = apply_verdict(_generated(), accepted=True, reason=None)
    with pytest.raises(ValueError, match="accepted.*generated"):
        mark_generated(accepted, "replacement.png")


def test_rejected_to_generated_is_illegal() -> None:
    rejected = apply_verdict(_generated(), accepted=False, reason="not the place")
    with pytest.raises(ValueError, match="rejected.*generated"):
        mark_generated(rejected, "replacement.png")


def test_rejection_without_a_reason_raises() -> None:
    generated = _generated()
    with pytest.raises(ValueError, match="requires a non-empty reason"):
        apply_verdict(generated, accepted=False, reason=None)
    with pytest.raises(ValueError, match="requires a non-empty reason"):
        apply_verdict(generated, accepted=False, reason="   ")


def test_mark_generated_requires_a_non_empty_image_ref() -> None:
    with pytest.raises(ValueError, match="non-empty image_ref"):
        mark_generated(_planned(), "")
    with pytest.raises(ValueError, match="non-empty image_ref"):
        mark_generated(_planned(), None)


def test_illegal_transition_names_the_scene_id() -> None:
    with pytest.raises(ValueError, match="scene-7"):
        apply_verdict(_planned("scene-7"), accepted=True, reason=None)
