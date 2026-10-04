"""Tempo agreement across independent estimators.

Pure logic - no audio, no subprocess - so the rule that decides what we believe
can be tested in isolation.

Why this exists: on this library librosa and madmom *agreed* on
Human-in-the-Loop's 71.78 BPM and both were wrong. The real tempo is ~142.

**A majority vote does NOT fix this, and was measured failing at it.** With
librosa=71.78, madmom=71.43, essentia=142.39, a "two of three agree" rule picks
71.61 and discards essentia, because 71.78 and 142.39 differ by a factor of 1.98.
They are octave partners, so their disagreement is not observable from the
numbers: the pair that agrees is merely the pair sharing a reading.

What actually settled it is that essentia's RhythmExtractor2013 is a better
algorithm on this material, not that it was in a majority. So the primary is
trusted as the authority and the others only corroborate or contradict it.

See docs/knowledge-library/track-similarity-measurement-2026.md, section 6a.
"""

from __future__ import annotations

import math
from typing import Any

#: Fractional tolerance for two estimates to count as agreeing.
DEFAULT_TOLERANCE = 0.05

#: An estimate outside this is not a tempo. librosa returns 0.0 for silence, pure
#: tones and clips too short to contain a beat, and that must never be an answer.
MIN_VALID_BPM = 20.0
MAX_VALID_BPM = 400.0

#: Estimator names, in reporting order.
ESTIMATORS = ("librosa", "madmom", "essentia")

#: Trusted as the authority when available. Measured as the only estimator that
#: corrected a case where two others agreed and were both wrong. Override with
#: `set_primary_estimator` for the fallback path.
PRIMARY_ESTIMATOR: str | None = "essentia"


def set_primary_estimator(name: str | None) -> None:
    """Override which estimator is trusted as the authority.

    For tests and for operators who disable the WSL bridge. A module global is
    not lovely, but threading one knob through every caller of `corroborate`
    would be worse.
    """
    global PRIMARY_ESTIMATOR
    PRIMARY_ESTIMATOR = name


def is_valid_bpm(value: float | None) -> bool:
    """True when a number is plausibly a tempo rather than a failure sentinel."""
    if value is None or isinstance(value, bool):
        return False
    if not isinstance(value, (int, float)):
        return False
    if math.isnan(value) or math.isinf(value):
        return False
    return MIN_VALID_BPM <= float(value) <= MAX_VALID_BPM


def fold_to_reference(value: float, reference: float) -> float:
    """Bring `value` onto `reference`'s octave, choosing the closer multiple.

    The tempo-octave problem means a beat can be counted as a quarter or an
    eighth; reference * 2 and reference / 2 are the same pulse. Returns the folded
    value, not the multiplier, so callers can compare directly.
    """
    if reference <= 0 or value <= 0:
        return value
    candidates = (value, value * 2.0, value / 2.0)
    return min(candidates, key=lambda c: abs(c - reference))


def agree(a: float, b: float, tolerance: float = DEFAULT_TOLERANCE) -> bool:
    """True when two estimates agree after octave folding."""
    if not is_valid_bpm(a) or not is_valid_bpm(b):
        return False
    ref = (a + b) / 2.0
    folded = fold_to_reference(b, ref)
    return abs(folded - ref) / ref <= tolerance


def corroborate(
    estimates: dict[str, float | None],
    tolerance: float = DEFAULT_TOLERANCE,
) -> dict[str, Any]:
    """Decide a tempo from several independent estimators.

    The primary wins; the rest corroborate or contradict. This is deliberately not
    a vote - see the module docstring for the measurement that rules that out.

    Returns bpm, primary, agreeing, rejected, confidence and a reason string for
    the UI and the log.
    """
    usable = {name: float(v) for name, v in estimates.items() if is_valid_bpm(v)}
    invalid = sorted(name for name, v in estimates.items() if not is_valid_bpm(v))

    if not usable:
        return {
            "bpm": None,
            "primary": None,
            "agreeing": [],
            "rejected": sorted(estimates),
            "confidence": "none",
            "reason": "no estimator returned a usable tempo",
        }

    if PRIMARY_ESTIMATOR is not None and PRIMARY_ESTIMATOR in usable:
        primary_name = PRIMARY_ESTIMATOR
        primary = usable[primary_name]
        agreeing = sorted(
            n for n, v in usable.items()
            if n != primary_name and agree(v, primary, tolerance)
        )
        contradicting = sorted(set(usable) - {primary_name} - set(agreeing))
        note = primary_name + "=" + format(primary, ".2f")
        if agreeing:
            note += " corroborated by " + ", ".join(agreeing)
        if contradicting:
            note += " contradicted by " + ", ".join(contradicting)
            note += " (kept: it is the primary)"
        return {
            "bpm": round(primary, 2),
            "primary": primary_name,
            "agreeing": agreeing,
            "rejected": contradicting + invalid,
            "confidence": "high" if agreeing else "medium",
            "reason": note,
        }

    # Fallback: the primary is unavailable (WSL down, essentia not installed).
    names = sorted(usable)
    best: tuple[float, list[str]] | None = None
    for i, a_name in enumerate(names):
        for b_name in names[i + 1:]:
            a, b = usable[a_name], usable[b_name]
            if not agree(a, b, tolerance):
                continue
            ref = (a + b) / 2.0
            supporters = [n for n, v in usable.items() if agree(v, ref, tolerance)]
            if best is None or len(supporters) > len(best[1]):
                best = (ref, supporters)

    if best is None:
        detail = ", ".join(n + "=" + format(v, ".2f") for n, v in sorted(usable.items()))
        return {
            "bpm": None,
            "primary": None,
            "agreeing": [],
            "rejected": invalid,
            "confidence": "none",
            "reason": (
                str(PRIMARY_ESTIMATOR) + " unavailable and no two estimators agree within "
                + format(tolerance * 100, ".0f") + "%: " + detail
            ),
        }

    bpm, supporters = best
    supporters_text = ", ".join(supporters)
    return {
        "bpm": round(bpm, 2),
        "primary": None,
        "agreeing": supporters,
        "rejected": sorted(set(usable) - set(supporters)) + invalid,
        "confidence": "low",
        "reason": (
            str(PRIMARY_ESTIMATOR) + " unavailable; best available agreement is "
            + supporters_text + " at " + format(bpm, ".2f")
            + " (low confidence - octave errors cannot be detected without the primary)"
        ),
    }
