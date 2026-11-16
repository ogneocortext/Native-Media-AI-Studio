"""Panel lifecycle states (R5).

A panel is a generated scene with a verdict. Rejection is normal data, not an
exception: the board records why a panel was dropped so the next pass knows.
This module is pure — no I/O, no LLM — and every transition is explicit.
Illegal transitions raise ``ValueError`` naming the from-state, to-state and
scene id; nothing is silently coerced.
"""

from __future__ import annotations

from typing import Any

PLANNED = "planned"
GENERATED = "generated"
ACCEPTED = "accepted"
REJECTED = "rejected"

PANEL_STATES = (PLANNED, GENERATED, ACCEPTED, REJECTED)

# planned -> generated -> accepted | rejected. Accepted and rejected are
# terminal for that panel; a replacement is a new scene, not a resurrection.
_LEGAL_TRANSITIONS = frozenset(
    {
        (PLANNED, GENERATED),
        (GENERATED, ACCEPTED),
        (GENERATED, REJECTED),
    }
)


def _scene_id(scene: dict[str, Any]) -> str | None:
    value = scene.get("id")
    return str(value) if value not in (None, "") else None


def _require_transition(from_state: str, to_state: str, scene: dict[str, Any]) -> None:
    if (from_state, to_state) in _LEGAL_TRANSITIONS:
        return
    scene_id = _scene_id(scene)
    where = f" for scene {scene_id!r}" if scene_id else ""
    raise ValueError(
        f"illegal panel transition{where}: {from_state!r} -> {to_state!r}"
    )


def _clean_text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def stamp_planned(scenes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return copies of ``scenes`` stamped ``state: "planned"``.

    Incoming ``state`` and ``reject_reason`` values are discarded: the
    generator owns lifecycle state, never the LLM.
    """
    stamped: list[dict[str, Any]] = []
    for scene in scenes or []:
        if not isinstance(scene, dict):
            continue
        clean = dict(scene)
        clean.pop("reject_reason", None)
        clean["state"] = PLANNED
        stamped.append(clean)
    return stamped


def mark_generated(scene: dict[str, Any], image_ref: str) -> dict[str, Any]:
    """Return a copy of ``scene`` moved to ``generated`` with its image ref."""
    ref = _clean_text(image_ref)
    if not ref:
        scene_id = _scene_id(scene)
        where = f" for scene {scene_id!r}" if scene_id else ""
        raise ValueError(f"mark_generated{where} requires a non-empty image_ref")
    _require_transition(str(scene.get("state") or PLANNED), GENERATED, scene)
    generated = dict(scene)
    generated["state"] = GENERATED
    generated["panel_image"] = ref
    return generated


def apply_verdict(
    scene: dict[str, Any], *, accepted: bool, reason: str | None
) -> dict[str, Any]:
    """Return a copy of ``scene`` moved to ``accepted`` or ``rejected``.

    A rejection without a reason is not data and raises ``ValueError``.
    """
    from_state = str(scene.get("state") or PLANNED)
    if accepted:
        _require_transition(from_state, ACCEPTED, scene)
        verdict = dict(scene)
        verdict["state"] = ACCEPTED
        verdict.pop("reject_reason", None)
        return verdict

    text = _clean_text(reason)
    if not text:
        scene_id = _scene_id(scene)
        where = f" for scene {scene_id!r}" if scene_id else ""
        raise ValueError(f"a rejected panel{where} requires a non-empty reason")
    _require_transition(from_state, REJECTED, scene)
    verdict = dict(scene)
    verdict["state"] = REJECTED
    verdict["reject_reason"] = text
    return verdict
