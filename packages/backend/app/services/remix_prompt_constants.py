"""Shared constants for the natural-language remix drafter (remix plan B2).

Extracted from remix_prompt.py so the drafting facade stays thin. Nothing
here imports from the rest of the remix pipeline -- pure data only, which
keeps the dependency direction clean:

    remix_prompt_constants -> remix_prompt_parsing ->
    remix_recipe_heuristics -> remix_recipe_revision ->
    remix_prompt_drafting -> remix_prompt (facade)
"""

from __future__ import annotations

from typing import Any

# How a prompt may name each stem. Keys are the real stem names; values
# are lowercase tokens that mean "use this stem" in free text.
STEM_ALIASES: dict[str, tuple[str, ...]] = {
    "vocals": (
        "vocal",
        "vocals",
        "voice",
        "voices",
        "singing",
        "rap",
        "acapella",
        "a capella",
        "lyric",
        "lyrics",
    ),
    "drums": ("drum", "drums", "beat", "beats", "percussion", "kit", "break"),
    "bass": ("bass", "bassline", "sub", "low end", "lowend"),
    "other": ("other", "music", "instrumental", "harmony", "keys", "melody", "synth", "chords"),
}

# Tokens that carry no identity inside a track name. Without this, "The"
# or "V2" would count as a distinctive token and every prompt mentioning
# either would "match" half the library. Short function words belong here
# rather than behind a length filter: "Ad Nauseam" is a real identity and
# "Ad" is only two characters.
_STOP_TOKENS = {
    "the",
    "a",
    "an",
    "and",
    "of",
    "for",
    "with",
    "to",
    "in",
    "on",
    "at",
    "by",
    "from",
    "over",
    "under",
    "into",
    "using",
    "use",
    "v1",
    "v2",
    "v3",
    "v4",
    "mini",
    "suno",
    "sunov6mini",
    "mix",
    "remix",
    "original",
    "final",
    "version",
    "feat",
    "ft",
    "explicit",
    "clean",
}

# Adjective -> arrangement. B4 gave the adjectives parameters to land on:
# `stem_gain_db` adds per stem, `brightness_db` adds in dB/octave around
# 1 kHz (positive = brighter), and `lowpass_hz` is taken from the
# strongest matching adjective rather than summed -- two cutoffs in series
# would just be the lower one, so the map keeps the darker intent. The
# gains are deliberately modest: the render sums layers, so a loud
# adjective plus a loud layer clips.
MOOD_ARRANGEMENTS: dict[str, dict[str, Any]] = {
    "dark": {
        "stem_gain_db": {"bass": 1.5, "drums": 0.0, "vocals": -1.0, "other": -3.0},
        "lowpass_hz": 900.0,
        "brightness_db": -4.0,
        "bars": 8,
        "crossfade_bars": 4.0,
        "note": "dark: bass forward, highs rolled off (900 Hz lowpass, -4 dB/oct tilt)",
    },
    "darker": {
        "stem_gain_db": {"bass": 2.5, "drums": -0.5, "vocals": -1.0, "other": -4.0},
        "lowpass_hz": 600.0,
        "brightness_db": -6.0,
        "bars": 8,
        "crossfade_bars": 4.0,
        "note": "darker: stronger lowpass and tilt than 'dark'",
    },
    "punchy": {
        "stem_gain_db": {"drums": 3.0, "bass": 1.0},
        "bars": 4,
        "crossfade_bars": 1.0,
        "note": "punchy: drums up, short slots so hits land",
    },
    "punchier": {
        "stem_gain_db": {"drums": 4.0, "bass": 1.5},
        "bars": 2,
        "crossfade_bars": 1.0,
        "note": "punchier: harder than 'punchy'",
    },
    "smooth": {
        "stem_gain_db": {"drums": -1.5, "other": 1.0},
        "brightness_db": -2.0,
        "bars": 16,
        "crossfade_bars": 4.0,
        "note": "smooth: drums back, gentle darkening, long blends",
    },
    "dreamy": {
        "stem_gain_db": {"drums": -2.0, "other": 1.5, "vocals": 0.5},
        "lowpass_hz": 4000.0,
        "brightness_db": -2.0,
        "bars": 16,
        "crossfade_bars": 6.0,
        "note": "dreamy: softened highs, drums well back, slow crossfades",
    },
    "energetic": {
        "stem_gain_db": {"drums": 2.0, "other": 1.0},
        "brightness_db": 2.0,
        "bars": 4,
        "crossfade_bars": 1.0,
        "note": "energetic: driving, short slots, bright tilt",
    },
    "chill": {
        "stem_gain_db": {"drums": -1.0, "bass": 0.5},
        "brightness_db": -1.0,
        "bars": 16,
        "crossfade_bars": 3.0,
        "note": "chill: relaxed, slightly warm",
    },
    "heavy": {
        "stem_gain_db": {"bass": 2.0, "drums": 2.0, "other": -2.0},
        "lowpass_hz": 1200.0,
        "brightness_db": -3.0,
        "bars": 4,
        "crossfade_bars": 2.0,
        "note": "heavy: bass and drums forward, dark",
    },
    "vocal": {
        "stem_gain_db": {"vocals": 2.5},
        "bars": 8,
        "crossfade_bars": 2.0,
        "note": "vocal-forward",
    },
}

# Genre -> starting balance. Same philosophy as MOOD_ARRANGEMENTS: modest
# per-stem offsets (the render sums layers, so big numbers clip), keyed by
# the genre ids the visualizer's reactivity presets already use. A genre
# word in the prompt ("make it phonk") sets the balance; adjectives and
# explicit gains still compose on top.
GENRE_GAIN_PROFILES: dict[str, dict[str, float]] = {
    "phonk": {"drums": 2.0, "bass": 1.5, "vocals": -1.0, "other": -0.5},
    "synthwave": {"drums": 1.0, "bass": 1.0, "other": 1.0, "vocals": -0.5},
    "ambient": {"drums": -2.0, "bass": -1.0, "other": 1.5, "vocals": 0.0},
    "gfunk": {"bass": 2.0, "drums": 1.0, "other": 0.5, "vocals": 0.0},
    "grime": {"drums": 2.5, "bass": 1.5, "vocals": 0.5, "other": -0.5},
    "dubstep": {"bass": 2.5, "drums": 2.0, "vocals": -1.5, "other": -0.5},
    "lofi": {"drums": -1.0, "bass": 0.5, "other": 1.0, "vocals": -0.5},
    "cinematic": {"other": 2.0, "bass": 1.0, "drums": 0.5, "vocals": -0.5},
    "rb": {"vocals": 2.0, "bass": 1.0, "drums": -0.5, "other": 0.0},
    "pop": {"vocals": 1.5, "drums": 1.0, "other": 0.5, "bass": 0.0},
    "indie": {"other": 1.5, "drums": 0.5, "vocals": 0.5, "bass": 0.0},
    "trapmetal": {"drums": 2.5, "bass": 2.0, "vocals": 1.0, "other": -1.0},
    "balanced": {},
}

# Matchable prompt words per genre id. Kept local (not imported from
# visual_fallback) -- the matching semantics differ (prompt text vs track
# metadata) and the modules should not couple over a word list.
GENRE_TAGS: dict[str, list[str]] = {
    "phonk": ["phonk", "drift phonk"],
    "synthwave": ["synthwave", "outrun", "retrowave"],
    "ambient": ["ambient", "ethereal", "space ambient"],
    "gfunk": ["g-funk", "g funk", "west coast"],
    "grime": ["grime", "uk garage"],
    "dubstep": ["dubstep", "brostep", "riddim"],
    "lofi": ["lo-fi", "lofi", "chillhop"],
    "cinematic": ["cinematic", "orchestral", "epic", "trailer"],
    "rb": ["r&b", "rnb", "neo-soul", "neo soul"],
    "pop": ["pop", "dance-pop", "dance pop", "electropop"],
    "indie": ["indie", "indie rock"],
    "trapmetal": ["trap metal", "trapmetal"],
    "balanced": ["balanced"],
}

# Words that hand a stem across to a source mention ("vocals from X").
_CONNECTORS = {"from", "of", "using", "with", "on", "over", "into"}

# Sources that must never be drafted from -- the plan's B6 fixture guard.
# `demucs_test_input` is the ~10-second demucs test fixture that "once
# built mashups" (the plan's own cautionary tale); it sits in the source
# listing precisely because a naive `list_stem_sources` reports every
# stem directory on disk. Hash-named sources are library tracks and are
# NOT fixtures -- only test-input-looking names are.
_FIXTURE_PREFIXES = ("demucs_test_input", "test_input_", "test_input", "fixture_", "test_fixture")

# The Ollama model the drafter tries first, and the fallback it retries
# once before surrendering to the deterministic heuristic.
DEFAULT_MODEL = "qwen3.5:4b"
FALLBACK_MODEL = "qwen3.5:4b"

# The four separated stems the enhancer chain and this module deal with.
STEM_NAMES = ("vocals", "drums", "bass", "other")
