# Remix Prompt Architecture — 2026-10

> **Status:** Implemented  
> **Last Updated:** 2026-10-30  
> **Status:** Active

## Overview

`packages/backend/app/services/remix_prompt.py` was a 72 KB, 1747-line monolith
that mixed prompt parsing, heuristic recipe assembly, model-output repair/revision,
and Ollama drafting entry points. It was decomposed into a clean dependency DAG
of sibling modules with a thin re-exporting facade — the same treatment applied
to `vram_manager.py` earlier (see `docs/architecture/decision-log.md`).

## Dependency DAG

```
remix_prompt_constants.py      (pure data — STEM_ALIASES, MOOD_ARRANGEMENTS,
                                GENRE_GAIN_PROFILES, GENRE_TAGS, STEM_NAMES,
                                _CONNECTORS, _FIXTURE_PREFIXES, DEFAULT_MODEL,
                                FALLBACK_MODEL)
        │
        ▼
remix_prompt_parsing.py        (mention scoring, track matching,
                                stem/mood/genre detection, B6 fixture guard)
        │
        ▼
remix_recipe_heuristics.py     (build_heuristic_recipe, apply_genre_gains,
                                apply_moods_to_layer, _clamp_bpm, _stems_for,
                                _slot_shape)
        │
        ▼
remix_recipe_revision.py       (repair_recipe, revise_heuristic_recipe,
                                request_to_recipe, diff_recipes,
                                build_revision_system_prompt,
                                unknown_track_references, parse_* helpers)
        │
        ▼
remix_prompt_drafting.py       (build_system_prompt, build_user_prompt,
                                draft_recipe_from_prompt,
                                revise_recipe_from_prompt — Ollama entry point)
        │
        ▼
remix_prompt.py                (thin re-exporting facade — nothing else)
```

## Module Reference

### `remix_prompt_constants.py`

Pure data — no imports from other remix modules. Defines:

| Constant | Purpose |
|----------|---------|
| `STEM_ALIASES` | Maps stem names to lowercase prompt tokens ("vocals" → `("vocal", "vocals", "voice", ...)`), used for both stem attribution and alias detection |
| `MOOD_ARRANGEMENTS` | Adjective → arrangement mapping (stem gains, lowpass_hz, brightness_db, bars, crossfade_bars, note) |
| `GENRE_GAIN_PROFILES` | Genre → starting stem balance offsets |
| `GENRE_TAGS` | Genre → list of matchable prompt words |
| `STEM_NAMES` | The four separated stems: `("vocals", "drums", "bass", "other")` |
| `_CONNECTORS` | Connector words for stem handoff ("from", "of", "using", "with", "on", "over", "into") |
| `_STOP_TOKENS` | Stop tokens excluded from identity scoring |
| `_FIXTURE_PREFIXES` | Source prefixes that must never be drafted from (fixture guard) |
| `DEFAULT_MODEL`, `FALLBACK_MODEL` | Ollama model names |

### `remix_prompt_parsing.py`

Pure text processing. Depends only on `remix_prompt_constants` + stdlib:

| Function | Purpose |
|----------|---------|
| `is_fixture_source(track)` | B6 fixture guard — test directories excluded from drafting |
| `draftable_sources(sources)` | Split source table into (draftable, excluded fixtures) |
| `score_mention(reference, text)` | Precision-oriented mention coverage (0.0–1.0) |
| `mention_score(source, prompt)` | Recall-friendly mention scoring via longest shared run |
| `mentioned_sources(sources, prompt)` | All sources the prompt names, in mention order |
| `match_track(reference, sources)` | Bidirectional token-coverage track resolution |
| `detect_stems(text)` | Whole-word stem alias detection |
| `detect_moods(text)` | Adjective detection, longest-first |
| `detect_genres(text)` | Genre detection, longest tag first |
| `attribute_stems(prompt, mentioned)` | Corridor + from/of handoff stem attribution |

### `remix_recipe_heuristics.py`

Deterministic fallback recipe assembly. Depends on `remix_prompt_constants` and `remix_prompt_parsing`:

| Function | Purpose |
|----------|---------|
| `build_heuristic_recipe(prompt, sources)` | Compose a deterministic draft when Ollama is unavailable |
| `apply_genre_gains(layer, genres)` | Fold genre starting-balance offsets into a layer |
| `apply_moods_to_layer(layer, moods)` | Fold detected adjectives into a layer's gains/tilt/lowpass |
| `_clamp_bpm(value, default)` | Clamp BPM to [40, 240] |
| `_stems_for(source, wanted)` | Resolve which stems of a source a request resolves to |
| `_slot_shape(moods, fallback_bars)` | Slot bars/crossfade from adjectives |

### `remix_recipe_revision.py`

Recipe revision and repair. Depends on `remix_prompt_constants`, `remix_prompt_parsing`, `remix_recipe_heuristics`:

| Function | Purpose |
|----------|---------|
| `repair_recipe(data, sources)` | Turn model JSON into a valid recipe; every repair reported |
| `revise_heuristic_recipe(prompt, base, sources)` | Deterministic revision when model unavailable |
| `request_to_recipe(data)` | Rebuild service recipe from REST request shape |
| `diff_recipes(base, revised)` | Human-readable changes between recipes |
| `build_revision_system_prompt(...)` | System prompt for revision mode (recipe verbatim, deltas only) |
| `unknown_track_references(text, sources)` | Track names referenced but not resolved |
| `parse_gain_deltas(text)` | Signed dB deltas per stem alias |
| `parse_drop_stems(text)` | Stem removals with optional slot scope |
| `parse_slot_bars(text)` | Slot length changes (absolute or relative) |
| `recipe_to_request(recipe, overwrite)` | Serialise service recipe to REST request shape |

### `remix_prompt_drafting.py`

Ollama entry point. Depends on all sibling modules:

| Function | Purpose |
|----------|---------|
| `build_system_prompt(sources)` | System prompt carrying real source table + exact schema |
| `build_user_prompt(prompt)` | User prompt wrapper |
| `draft_recipe_from_prompt(prompt, sources?, model?)` | Draft recipe from natural language; Ollama with heuristic fallback |
| `revise_recipe_from_prompt(prompt, base_recipe, sources?, model?, mix_report?)` | Revise base recipe from one sentence; deterministic fallback |

### `remix_prompt.py` (facade)

Thin re-exporting facade — imports everything from the sibling modules and
re-exports every name callers/tests touch. Defines no logic of its own.

## Dependency Direction

```
remix_prompt_constants  →  remix_prompt_parsing  →  remix_recipe_heuristics
                                                            ↓
                                                    remix_recipe_revision
                                                            ↓
                                                    remix_prompt_drafting
                                                            ↓
                                                    remix_prompt (facade)
```

Nothing in this chain imports from `app.api` or `app.services`. The dependency graph is a clean DAG.

## B6 Fixture Guard

`is_fixture_source()` prevents test-fixture stem directories (e.g.
`demucs_test_input`) from being drafted into mashups. The `draftable_sources()`
function splits the source table into draftable sources and excluded fixture
names, so the filter is visible rather than silent.

## Why This Split Matters

| Before | After |
|--------|-------|
| 72 KB / 1747 lines | ~1200 lines across 5 focused modules |
| Mixed concerns | Single responsibility per module |
| Difficult to test | Each module independently testable |
| Hidden coupling | Explicit dependency DAG |
| Behavior hidden in one file | Behavior documented per module |

## Verification

- `ruff check` clean on all six modules
- `tools/check-import-cycles.py`: 0 cycles
- `pytest tests/test_remix_prompt.py`: 65/65 pass
