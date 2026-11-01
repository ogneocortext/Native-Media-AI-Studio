"""
Remix recipe data model.

Extracted from stem_remixer.py. Contains the arrangement model dataclasses:
``RemixLayer``, ``RemixSlot``, ``RemixRecipe`` and ``RemixResult``.

A recipe is a list of slots over a bar grid. Each slot names the stems that play
during its span, so "A's drums under B's vocals, then swap" and "everything at
once" are the same mechanism with different slot contents.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from typing import Any

from .remix_constants import STEM_NAMES


@dataclass
class RemixLayer:
    """One stem playing inside a slot.

    ``key_shift_semitones`` is explicit because detection cannot be trusted on this
    material (see the module docstring). ``gain_db`` is relative to the stem's own
    level, so two layers of the same stem at 0 dB sum to unity.

    ``lowpass_hz`` / ``brightness_db`` are the tone-shaping pair the remix plan's
    B4 added, because "darker" was previously inexpressible -- the only lever
    was gain. ``lowpass_hz`` zeroes spectrum above the cutoff (same STFT trick as
    the enhancer's ``_high_pass``), and ``brightness_db`` tilts the spectrum in
    dB/octave around a 1 kHz pivot (positive = brighter). Both default to
    none, so every existing recipe renders bit-identically.
    """

    track: str
    stem: str
    gain_db: float = 0.0
    key_shift_semitones: float = 0.0
    # Offset into the source in *bars*, so a layer can enter partway through its
    # own song rather than always replaying from bar 0.
    source_start_bar: int = 0
    lowpass_hz: float | None = None
    brightness_db: float | None = None

    def validate(self) -> None:
        if self.stem not in STEM_NAMES:
            raise ValueError(f"stem must be one of {', '.join(STEM_NAMES)}")
        if not math.isfinite(self.gain_db) or not -60.0 <= self.gain_db <= 12.0:
            raise ValueError(f"gain_db out of range: {self.gain_db}")
        if self.lowpass_hz is not None and not (
            math.isfinite(self.lowpass_hz) and 200.0 <= self.lowpass_hz <= 20000.0
        ):
            # 200 Hz keeps the kick; 20 kHz is a no-op at REMIX_SR. B4.
            raise ValueError(f"lowpass_hz out of range: {self.lowpass_hz}")
        if self.brightness_db is not None and not (
            math.isfinite(self.brightness_db) and -12.0 <= self.brightness_db <= 12.0
        ):
            # +/-12 dB/octave is the range where a tilt reads as tone rather
            # than as a broken signal. B4.
            raise ValueError(f"brightness_db out of range: {self.brightness_db}")
        if not math.isfinite(self.key_shift_semitones) or abs(self.key_shift_semitones) > 12.0:
            raise ValueError(f"key_shift_semitones out of range: {self.key_shift_semitones}")
        if self.source_start_bar < 0:
            raise ValueError("source_start_bar must be >= 0")


@dataclass
class RemixSlot:
    """A span of the arrangement, in bars."""

    layers: list[RemixLayer]
    bars: int = 8
    # Equal-power crossfade into the *next* slot, in bars. Clamped to the slot
    # length at render time so a short slot cannot overlap its own predecessor.
    crossfade_bars: float = 2.0

    def validate(self) -> None:
        if not self.layers:
            raise ValueError("a slot needs at least one layer")
        if self.bars < 1:
            raise ValueError(f"bars must be >= 1, got {self.bars}")
        if not math.isfinite(self.crossfade_bars) or self.crossfade_bars < 0:
            # inf/nan pass a bare `>= 0` test and then blow up inside
            # plan_timeline's int(round(...)), far from the bad value.
            raise ValueError(f"crossfade_bars must be finite and >= 0, got {self.crossfade_bars}")
        for layer in self.layers:
            layer.validate()


@dataclass
class RemixRecipe:
    name: str
    target_bpm: float
    slots: list[RemixSlot]
    beats_per_bar: int = 4
    # Recorded in the manifest for reference; never acted on automatically.
    key: str | None = None

    def validate(self) -> None:
        if not self.slots:
            raise ValueError("a remix needs at least one slot")
        if not math.isfinite(self.target_bpm) or not 40.0 <= self.target_bpm <= 240.0:
            raise ValueError(f"target_bpm out of range: {self.target_bpm}")
        if not 1 <= self.beats_per_bar <= 16:
            raise ValueError(f"beats_per_bar out of range: {self.beats_per_bar}")
        for slot in self.slots:
            slot.validate()

    @property
    def bar_seconds(self) -> float:
        return self.beats_per_bar * 60.0 / self.target_bpm


@dataclass
class RemixResult:
    name: str
    directory: str
    stems: dict[str, str] = field(default_factory=dict)
    manifest: dict[str, Any] = field(default_factory=dict)
    duration_sec: float = 0.0
    warnings: list[str] = field(default_factory=list)
    mix_report: dict[str, Any] = field(default_factory=dict)


__all__ = ["RemixLayer", "RemixSlot", "RemixRecipe", "RemixResult"]
