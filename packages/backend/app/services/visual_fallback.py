"""Deterministic visual-source fallback selector (Q2).

Python mirror of the frontend ``selectVisualPreset()``
(``packages/frontend/src/features/visualizer/visualPresets.ts``).

When the music-video worker's preferred AI visual source (ComfyUI / Wan) is
unavailable, this picks a deterministic visualization preset from the
track's genre/energy/BPM/section so the job degrades to a beat-synced
render instead of failing.

Pure logic: no GPU, no VRAM, no model loads, no ComfyUI imports. Safe to
run in the studio backend env (D2, D7).

Keep ``_PRESET_GENRES`` in sync with the ``genres`` arrays in
``visualPresets.ts``; the matching algorithm below mirrors
``selectVisualPreset`` step for step (normalize -> longest-phrase-first
padded-token match -> keyword fallback -> energy/BPM thresholds ->
``"balanced"`` default).

Known tracks are checked first via ``_TRACK_PRESET_OVERRIDES`` (fragment ->
preset id), mirroring the ``basePresetId`` choices in the frontend's
``trackVisualProfiles.ts`` — keep both files in sync when profiles change.
"""

from __future__ import annotations

import re
from typing import Optional

# Preset catalog mirrored from visualPresets.ts (id -> genre phrases).
_PRESET_GENRES: dict[str, list[str]] = {
    "phonk": ["phonk", "drift", "trap", "drift phonk"],
    "synthwave": ["synthwave", "retro", "neon", "80s", "outrun"],
    "ambient": ["ambient", "trance", "progressive", "ethereal", "space"],
    "gfunk": ["g-funk", "funk", "west coast", "smooth", "rap"],
    "grime": ["grime", "uk", "fast", "aggressive", "hip hop"],
    "dubstep": ["dubstep", "brostep", "bass", "heavy", "electronic"],
    "lofi": ["lo-fi", "lofi", "chill", "warm", "nostalgic", "jazz"],
    "cinematic": ["cinematic", "orchestral", "dramatic", "epic", "trailer"],
    "rb": ["r&b", "rnb", "soul", "neo-soul", "slow jam"],
    "pop": ["pop", "dance-pop", "electropop", "k-pop", "j-pop"],
    "indie": ["indie", "indie rock", "indie folk", "alternative", "folk"],
    "trapMetal": ["trap metal", "trap-metal", "metal", "rap metal", "nu metal"],
    "balanced": [],
}

DEFAULT_PRESET = "balanced"

FALLBACK_PRESETS = frozenset(_PRESET_GENRES)

# Track-specific overrides: spaceless normalized fragment -> preset id.
# Checked before the generic genre/keyword/energy/BPM matching so known
# tracks get their tuned base preset instead of the generic guess.
# Mirrors the basePresetId choices in
# packages/frontend/src/features/visualizer/trackVisualProfiles.ts — keep
# the two in sync. Longest fragment first (tuple order matters):
# "unproductivevalleyphonk" must win over "unproductive" and
# "patchnotesv35" over "patchnotes".
_TRACK_PRESET_OVERRIDES: tuple[tuple[str, str], ...] = (
    ("unproductivevalleyphonk", "phonk"),
    ("humanintheloop", "cinematic"),
    ("patchnotesv35", "dubstep"),
    ("patchnotes", "dubstep"),
    ("unproductive", "gfunk"),
    ("hitl", "cinematic"),
)

# Keyword fallback, same order as the frontend.
_KEYWORD_FALLBACK: list[tuple[tuple[str, ...], str]] = [
    (("phonk", "drift"), "phonk"),
    (("synthwave", "neon", "retro", "outrun"), "synthwave"),
    (("ambient", "trance", "space"), "ambient"),
    (("g funk", "funk", "west coast"), "gfunk"),
    (("grime", "uk garage"), "grime"),
    (("dubstep", "brostep", "bass", "heavy"), "dubstep"),
    (("lo fi", "lofi", "chill"), "lofi"),
    (("cinematic", "orchestral", "epic", "trailer"), "cinematic"),
    (("r&b", "rnb", "soul", "neo soul", "slow jam"), "rb"),
    (("dance pop", "electropop", "k pop", "j pop", "pop"), "pop"),
    (("indie rock", "indie folk", "indie", "alternative", "folk"), "indie"),
    (("trap metal", "rap metal", "nu metal", "metal"), "trapMetal"),
]


def _normalize(text: str) -> str:
    """Lowercase, collapse separators to spaces, squeeze whitespace.

    Keeps ``&`` and ``+`` so tokens like ``r&b`` stay matchable.
    """
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9&+]+", " ", text.lower())).strip()


def _includes_token(haystack: str, token: str) -> bool:
    """Padded-substring check on normalized text (no "rap" in "grape" bugs)."""
    if not token:
        return False
    return f" {haystack} ".find(f" {token} ") != -1


def _coerce_float(value: object) -> Optional[float]:
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def is_known_preset(preset_id: str) -> bool:
    """Return True if ``preset_id`` is a valid fallback preset."""
    return preset_id in FALLBACK_PRESETS


def select_fallback_preset(
    genre: Optional[str] = None,
    energy: Optional[float] = None,
    bpm: Optional[float] = None,
    section: Optional[str] = None,
    track_name: Optional[str] = None,
) -> str:
    """Pick a deterministic visualization preset for fallback rendering.

    Mirrors the frontend ``selectVisualPreset``: genre/section/track-name
    phrases are matched longest-first, then keyword fallback, then
    energy/BPM thresholds, defaulting to ``"balanced"``.

    Same inputs always yield the same preset (no randomness, no I/O).
    """
    # Known-track override first: a tuned profile beats the generic guess.
    if track_name:
        squashed = _normalize(track_name).replace(" ", "")
        for fragment, preset_id in _TRACK_PRESET_OVERRIDES:
            if fragment and fragment in squashed:
                return preset_id

    haystack = _normalize(
        " ".join(part for part in (genre, track_name, section) if part)
    )

    candidates: list[tuple[str, str]] = []
    for preset_id, genres in _PRESET_GENRES.items():
        for phrase in genres:
            normalized = _normalize(phrase)
            if normalized:
                candidates.append((preset_id, normalized))
    # Longest phrase first so "trap metal" wins over "trap"/"metal".
    candidates.sort(key=lambda item: len(item[1]), reverse=True)
    for preset_id, phrase in candidates:
        if _includes_token(haystack, phrase):
            return preset_id

    for tokens, preset_id in _KEYWORD_FALLBACK:
        if any(_includes_token(haystack, _normalize(token)) for token in tokens):
            return preset_id

    energy_value = _coerce_float(energy)
    if energy_value is not None:
        if energy_value > 0.75:
            return "dubstep"
        if energy_value > 0.6:
            return "grime"
        if energy_value < 0.3:
            return "ambient"
        if energy_value < 0.4:
            return "lofi"

    bpm_value = _coerce_float(bpm)
    if bpm_value is not None:
        if bpm_value > 140:
            return "dubstep"
        if bpm_value > 120:
            return "grime"
        if bpm_value < 85:
            return "ambient"
        if bpm_value < 100:
            return "lofi"

    return DEFAULT_PRESET
