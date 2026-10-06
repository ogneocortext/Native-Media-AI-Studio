"""Deterministic visual preset fallback for music video generation.

When ComfyUI / AI rendering is unavailable, this module selects a shader
preset from audio metadata (genre, track name, energy, BPM) so the worker can
degrade gracefully to the FFmpeg visualization path instead of failing.

Mirrors the frontend ``selectVisualPreset()`` in
``packages/frontend/src/features/visualizer/visualPresets.ts`` so the
backend and frontend make the same choice from the same inputs.
"""

from __future__ import annotations

import re

# Preset catalog — kept in sync with visualPresets.ts.
# Only the fields needed for selection are listed here (id + genre tags).
_PRESETS: list[dict[str, str | list[str]]] = [
    {
        "id": "phonk",
        "genres": ["phonk", "drift", "trap", "drift phonk"],
    },
    {
        "id": "synthwave",
        "genres": ["synthwave", "retro", "neon", "80s", "outrun"],
    },
    {
        "id": "ambient",
        "genres": ["ambient", "trance", "progressive", "ethereal", "space"],
    },
    {
        "id": "gfunk",
        "genres": ["g-funk", "funk", "west coast", "smooth", "rap"],
    },
    {
        "id": "grime",
        "genres": ["grime", "uk", "fast", "aggressive", "hip hop"],
    },
    {
        "id": "dubstep",
        "genres": ["dubstep", "brostep", "bass", "heavy", "electronic"],
    },
    {
        "id": "lofi",
        "genres": ["lo-fi", "lofi", "chill", "warm", "nostalgic", "jazz"],
    },
    {
        "id": "cinematic",
        "genres": ["cinematic", "orchestral", "dramatic", "epic", "trailer"],
    },
    {
        "id": "rb",
        "genres": ["r&b", "rnb", "soul", "neo-soul", "slow jam"],
    },
    {
        "id": "pop",
        "genres": ["pop", "dance-pop", "electropop", "k-pop", "j-pop"],
    },
    {
        "id": "indie",
        "genres": ["indie", "indie rock", "indie folk", "alternative", "folk"],
    },
    {
        "id": "trapMetal",
        "genres": ["trap metal", "trap-metal", "metal", "rap metal", "nu metal"],
    },
    {
        "id": "balanced",
        "genres": [],
    },
]

# Token-based keyword fallbacks (ordered by priority).
# Matched against the normalized genre + track name haystack.
_KEYWORD_FALLBACKS: list[tuple[list[str], str]] = [
    (["phonk", "drift"], "phonk"),
    (["synthwave", "neon", "retro", "outrun"], "synthwave"),
    (["ambient", "trance", "space"], "ambient"),
    (["g funk", "funk", "west coast"], "gfunk"),
    (["grime", "uk garage"], "grime"),
    (["dubstep", "brostep", "bass", "heavy"], "dubstep"),
    (["lo fi", "lofi", "chill"], "lofi"),
    (["cinematic", "orchestral", "epic", "trailer"], "cinematic"),
    (["r&b", "rnb", "soul", "neo soul", "slow jam"], "rb"),
    (["dance pop", "electropop", "k pop", "j pop", "pop"], "pop"),
    (["indie rock", "indie folk", "indie", "alternative", "folk"], "indie"),
    (["trap metal", "rap metal", "nu metal", "metal"], "trapMetal"),
]


def _normalize(text: str) -> str:
    """Lowercase, collapse separators to spaces, squeeze whitespace.

    Keeps ``&`` and ``+`` so tokens like ``r&b`` and ``k-pop`` (→ ``k pop``)
    stay matchable on both sides, matching the frontend's ``normalizeSearchText``.
    """
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9&+]+", " ", text.lower())).strip()


def _token_in(haystack: str, token: str) -> bool:
    """Padded-substring check on already-normalized text.

    Prevents false matches like ``rap`` ⊂ ``grape``.
    """
    if not token:
        return False
    return f" {token} " in f" {haystack} "


def select_fallback_preset(
    genre: str | None = None,
    energy: float | None = None,
    bpm: float | None = None,
    track_name: str | None = None,
) -> str:
    """Pick a deterministic shader preset from audio metadata.

    Parameters
    ----------
    genre : str | None
        Primary genre tag (e.g. ``"trap metal"``).
    energy : float | None
        Normalized energy curve mean, 0–1.
    bpm : float | None
        Detected tempo in beats per minute.
    track_name : str | None
        Track title — combined with *genre* into the match haystack,
        mirroring the frontend's ``selectVisualPreset(trackName, genre, …)``.

    Returns
    -------
    str
        Preset id (e.g. ``"dubstep"``, ``"ambient"``, ``"balanced"``).

    Same inputs → same output (deterministic). Unknown or missing inputs
    fall through to ``"balanced"``.
    """
    haystack = _normalize(f"{genre or ''} {track_name or ''}")

    # 1. Longest-first genre-tag match across the preset catalog.
    candidates: list[tuple[str, str]] = []
    for preset in _PRESETS:
        for g in preset["genres"]:
            phrase = _normalize(g)
            if phrase:
                candidates.append((preset["id"], phrase))
    candidates.sort(key=lambda x: len(x[1]), reverse=True)
    for preset_id, phrase in candidates:
        if _token_in(haystack, phrase):
            return preset_id

    # 2. Token-based keyword fallback for track names / genres.
    for tokens, preset_id in _KEYWORD_FALLBACKS:
        normalized_tokens = [_normalize(t) for t in tokens]
        if any(_token_in(haystack, t) for t in normalized_tokens):
            return preset_id

    # 3. Energy/BPM-based selection (mirrors frontend thresholds).
    if energy is not None:
        if energy > 0.75:
            return "dubstep"
        if energy > 0.6:
            return "grime"
        if energy < 0.3:
            return "ambient"
        if energy < 0.4:
            return "lofi"

    if bpm is not None:
        if bpm > 140:
            return "dubstep"
        if bpm > 120:
            return "grime"
        if bpm < 85:
            return "ambient"
        if bpm < 100:
            return "lofi"

    return "balanced"
