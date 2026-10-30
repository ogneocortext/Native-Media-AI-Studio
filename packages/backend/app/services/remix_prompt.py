"""Natural-language remix drafting (remix plan B2).

Facade over the remix prompt pipeline: a prompt goes in, a reviewable
recipe comes out.  The logic itself lives in sibling modules; this module
re-exports every name ``app.services.remix_prompt`` callers and tests
touch so existing imports keep working.

    remix_prompt_constants   STEM_ALIASES, MOOD_ARRANGEMENTS, ...
    remix_prompt_parsing     mention scoring, track matching, stem/mood/genre detection, fixture guard
    remix_recipe_heuristics  build_heuristic_recipe, apply_genre_gains, apply_moods_to_layer, ...
    remix_recipe_revision    repair_recipe, revise_heuristic_recipe, request_to_recipe, diff_recipes, ...
    remix_prompt_drafting    build_system_prompt, draft_recipe_from_prompt, revise_recipe_from_prompt

Only ``draft_recipe_from_prompt`` / ``revise_recipe_from_prompt`` reach
Ollama; everything else is deterministic and pure.  Nothing in this file
defines logic anymore -- it is the re-export surface only.
"""

from __future__ import annotations

from .remix_prompt_constants import (
    _CONNECTORS,
    _FIXTURE_PREFIXES,
    _STOP_TOKENS,
    DEFAULT_MODEL,
    FALLBACK_MODEL,
    GENRE_GAIN_PROFILES,
    GENRE_TAGS,
    MOOD_ARRANGEMENTS,
    STEM_ALIASES,
    STEM_NAMES,
)
from .remix_prompt_drafting import (
    build_system_prompt,
    build_user_prompt,
    draft_recipe_from_prompt,
    revise_recipe_from_prompt,
)
from .remix_prompt_parsing import (
    attribute_stems,
    detect_genres,
    detect_moods,
    detect_stems,
    draftable_sources,
    is_fixture_source,
    match_track,
    mention_score,
    mentioned_sources,
    score_mention,
)
from .remix_recipe_heuristics import (
    _clamp_bpm,
    _slot_shape,
    _stems_for,
    apply_genre_gains,
    apply_moods_to_layer,
    build_heuristic_recipe,
)
from .remix_recipe_revision import (
    build_revision_system_prompt,
    diff_recipes,
    parse_drop_stems,
    parse_gain_deltas,
    parse_slot_bars,
    recipe_to_request,
    repair_recipe,
    request_to_recipe,
    revise_heuristic_recipe,
    unknown_track_references,
)
from .stem_remixer import RemixLayer, RemixRecipe, RemixSlot, list_stem_sources

__all__ = [
    "DEFAULT_MODEL",
    "FALLBACK_MODEL",
    "GENRE_GAIN_PROFILES",
    "GENRE_TAGS",
    "MOOD_ARRANGEMENTS",
    "RemixLayer",
    "RemixRecipe",
    "RemixSlot",
    "STEM_ALIASES",
    "STEM_NAMES",
    "_CONNECTORS",
    "_FIXTURE_PREFIXES",
    "_STOP_TOKENS",
    "_clamp_bpm",
    "_slot_shape",
    "_stems_for",
    "apply_genre_gains",
    "apply_moods_to_layer",
    "attribute_stems",
    "build_heuristic_recipe",
    "build_revision_system_prompt",
    "build_system_prompt",
    "build_user_prompt",
    "diff_recipes",
    "draft_recipe_from_prompt",
    "draftable_sources",
    "detect_genres",
    "detect_moods",
    "detect_stems",
    "is_fixture_source",
    "list_stem_sources",
    "match_track",
    "mentioned_sources",
    "mention_score",
    "parse_drop_stems",
    "parse_gain_deltas",
    "parse_slot_bars",
    "recipe_to_request",
    "repair_recipe",
    "request_to_recipe",
    "revise_heuristic_recipe",
    "revise_recipe_from_prompt",
    "score_mention",
    "unknown_track_references",
]
