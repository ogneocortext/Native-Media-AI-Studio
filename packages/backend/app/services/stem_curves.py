"""Shared curve resampling for stem analysis and visualization.

`_downsample_curve` existed as two byte-identical copies - one in `stem_analysis`
and one in `stem_visualization` - and the visualization copy had no test coverage at
all, so a bug fixed in one would have left the other silently wrong. One
implementation, tested once, used by both.

Max-pooling rather than averaging, deliberately: these curves are amplitude
envelopes, where a narrow transient is the signal. Averaging a percussive hit with
its silent neighbours flattens the very peak the envelope exists to show, which
reads as "this stem is quiet here" when it is not.
"""

from __future__ import annotations


def downsample_curve(curve: list[float], target: int) -> list[float]:
    """Resample `curve` to about `target` points, preserving peaks.

    Returns `[]` for an empty curve, and the curve unchanged (as floats) when it is
    already at or below `target` length. Never returns more than `target` points.
    """
    if target <= 0:
        return []
    if not curve:
        return []
    if len(curve) <= target:
        return [float(v) for v in curve]

    segment = len(curve) / target
    out: list[float] = []
    for i in range(target):
        start = int(i * segment)
        end = int((i + 1) * segment)
        chunk = curve[start:end]
        # float() matters: max() over an int list returns an int, so without this the
        # max-pooling path returned ints while the short-circuit path returned
        # floats - the same function returning two different types depending on the
        # input length, contradicting its own annotation.
        out.append(float(max(chunk)) if chunk else 0.0)
    return out
