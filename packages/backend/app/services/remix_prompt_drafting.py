"""Ollama entry point for the remix drafter (remix plan B2 / R1).

Extracted from remix_prompt.py. ``draft_recipe_from_prompt`` and
``revise_recipe_from_prompt`` are the only functions that reach Ollama;
everything else in the pipeline is deterministic and pure.

Depends on remix_prompt_constants, remix_prompt_parsing,
remix_recipe_heuristics and remix_recipe_revision; imported by the
``remix_prompt`` facade.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from .remix_prompt_constants import DEFAULT_MODEL, FALLBACK_MODEL, STEM_NAMES
from .remix_prompt_parsing import draftable_sources, mentioned_sources
from .remix_recipe_heuristics import build_heuristic_recipe
from .remix_recipe_revision import (
    build_revision_system_prompt,
    diff_recipes,
    recipe_to_request,
    repair_recipe,
    request_to_recipe,
    revise_heuristic_recipe,
    unknown_track_references,
)
from .stem_remixer import list_stem_sources

logger = logging.getLogger(__name__)

_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL | re.IGNORECASE)


def build_system_prompt(sources: list[dict[str, Any]]) -> str:
    """System prompt carrying the real source table and the exact schema.

    The source table is the guardrail: the model is told, in its own
    context, which tracks and stems exist, so it has no reason to
    invent names -- and if it does, ``repair_recipe`` catches it.
    """
    lines = [
        "You are a remix/mashup arranger. Reply with JSON only.",
        "",
        "Available sources (track -> stems, with cached tempo/duration when probed):",
    ]
    for src in sources:
        stems = ", ".join(s for s in STEM_NAMES if src.get("stems", {}).get(s)) or "none"
        extra = (
            f" (bpm {src['bpm']:g}, {src['duration_sec']:.0f}s)"
            if src.get("bpm") and src.get("duration_sec")
            else ""
        )
        lines.append(f"- {src['track']}{extra}: {stems}")
    lines += [
        "",
        "Reply with exactly this shape:",
        '{"name": str, "target_bpm": number, "explanation": str,',
        ' "mood_notes": [str], "slots": [{"bars": int, "crossfade_bars": number,',
        ' "layers": [{"track": str, "stem": str, "gain_db": number,',
        ' "key_shift_semitones": number, "source_start_bar": int}]}]}',
        "",
        "Rules: use only tracks and stems from the list above; 1-4 slots of 1-16 bars;",
        "layers per slot are 1-8 (a slot may stack the same stem at different",
        "source_start_bar values); gains within -24..+12 dB; key_shift_semitones stays 0",
        "unless the prompt names a key; source_start_bar is 0 unless the prompt names a",
        "start. Optional tone shaping per layer: lowpass_hz (200-20000 Hz, removes",
        "highs above it) and brightness_db (-12..+12 dB/octave around 1 kHz, positive",
        "= brighter). Use them for mood words -- 'dark' means lowpass plus a negative",
        "tilt, never just quieter.",
        "Tempo: keep target_bpm within 5% of the sources\u2019 BPMs; beyond 10% the drums",
        "smear audibly \u2014 only stretch further for a deliberate half-time (0.5x) or",
        "double-time (2.0x) feel.",
        "Structure: source_start_bar on multiples of 4 bars (prefer 8); when skipping a",
        "silent intro, round up past first_audible to the next 4-bar boundary. Match",
        "energy across layers: chorus vocals over a chorus instrumental, not a verse.",
        "Genre words set the starting balance -- 'phonk' means drums and bass",
        "forward, 'r&b' means vocals forward, 'ambient' means drums back and",
        "pads forward. Adjectives and explicit gains compose on top.",
        "Slotting: never stack two \u2018other\u2019 stems at similar gain in one slot (midrange",
        "masking) and never two bass layers \u2014 pick one, cut the other 3-6 dB, or lowpass it.",
        "Explain the arrangement in one sentence per slot.",
    ]
    return "\n".join(lines)


def build_user_prompt(prompt: str) -> str:
    return f"Arrange this request as a mashup recipe:\n\n{prompt.strip()}"


def _extract_json(text: str) -> dict[str, Any]:
    """Best-effort JSON extraction from model output (handles code fences)."""
    import json

    raw = (text or "").strip()
    fence = _JSON_FENCE_RE.search(raw)
    if fence:
        raw = fence.group(1).strip()
    try:
        data = json.loads(raw)
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    decoder = json.JSONDecoder()
    for match in re.finditer(r"\{", raw):
        try:
            data, _ = decoder.raw_decode(raw[match.start() :])
            if isinstance(data, dict):
                return data
        except Exception:
            continue
    raise ValueError("Model did not return a JSON object")


async def draft_recipe_from_prompt(
    prompt: str,
    sources: list[dict[str, Any]] | None = None,
    model: str | None = None,
) -> dict[str, Any]:
    """Draft a remix recipe from natural language.

    Returns ``{recipe, explanation, warnings, model_used, source}`` where
    ``recipe`` is the REST request shape (ready for ``/preview`` or
    ``/build``) and ``source`` is ``ollama`` or ``heuristic``. Raises
    ValueError only when nothing can be drafted (no track recognised, no
    stems anywhere) -- that is a caller error worth a 400, not a silent
    empty draft.
    """
    if not (prompt or "").strip():
        raise ValueError("Prompt is empty")
    if sources is None:
        sources = list_stem_sources()

    # B6 fixture guard: never let a test fixture into a draft, into the
    # model's context, or into the matching table. `excluded` is named in
    # the warnings so the filter is visible rather than silent.
    sources, excluded_fixtures = draftable_sources(list(sources))
    if not sources:
        raise ValueError("No library track has separated stems (see GET /api/audio/remix/sources).")
    fixture_warning = (
        [f"Excluded test-fixture source(s): {', '.join(excluded_fixtures)}."]
        if excluded_fixtures
        else []
    )
    # The tracks the prompt actually named, from the available table. Any
    # track the recipe uses beyond these is the model substituting for a
    # request it could not fulfil -- the reviewer must be told, because
    # "use The Last's drums" answered with take-the-crown's drums is the
    # kind of silent substitution that erodes trust in the draft.
    mentioned_tracks = {str(s.get("track", "")).lower() for s in mentioned_sources(sources, prompt)}

    # Honesty check: if the prompt names no source with separated stems,
    # say so -- the reviewer needs to know the arrangement came from the
    # model's picks rather than the request.
    if not mentioned_sources(sources, prompt):
        fixture_warning.append(
            "The prompt did not name a track with separated stems; this arrangement uses the model's picks "
            "from the available sources."
        )

    from ..adapters.ollama import OllamaAdapter

    chosen = (model or DEFAULT_MODEL).strip() or DEFAULT_MODEL
    adapter = OllamaAdapter(mock_mode=False)
    system = build_system_prompt(sources)
    user = build_user_prompt(prompt)

    async def _call(model_name: str) -> dict[str, Any]:
        result = await adapter.generate(
            {
                "system": system,
                "prompt": user,
                "model": model_name,
                "format": "json",
                "think": False,
                "options": {"temperature": 0.4, "num_ctx": 8192},
            }
        )
        return _extract_json(result.get("response", ""))

    data: dict[str, Any] | None = None
    used = chosen
    try:
        data = await _call(chosen)
    except Exception as exc:
        logger.warning(
            "Remix draft: primary model %s failed (%s), trying %s", chosen, exc, FALLBACK_MODEL
        )
        if chosen != FALLBACK_MODEL:
            try:
                data = await _call(FALLBACK_MODEL)
                used = FALLBACK_MODEL
            except Exception as exc2:
                logger.warning("Remix draft: fallback model failed too (%s); using heuristic", exc2)
    if data is None:
        recipe, warnings, explanation = build_heuristic_recipe(prompt, sources)
        return {
            "recipe": recipe_to_request(recipe),
            "explanation": explanation,
            "warnings": fixture_warning
            + warnings
            + [f"Ollama unavailable ({used}); drafted deterministically without a model."],
            "model_used": None,
            "source": "heuristic",
        }

    try:
        recipe, warnings = repair_recipe(data, sources)
    except ValueError:
        # A model recipe that resolves to nothing is not a failed request --
        # the deterministic draft is still a reviewable answer.
        logger.info("Remix draft: model recipe unusable, falling back to heuristic")
        recipe, warnings, explanation = build_heuristic_recipe(prompt, sources)
        return {
            "recipe": recipe_to_request(recipe),
            "explanation": explanation,
            "warnings": fixture_warning
            + warnings
            + [
                "Model's recipe did not resolve against the available sources; drafted deterministically."
            ],
            "model_used": used,
            "source": "heuristic",
        }
    explanation = (
        str(data.get("explanation", "") or "").strip() or "No explanation returned by the model."
    )
    used_tracks = {layer.track.lower() for slot in recipe.slots for layer in slot.layers}
    substituted = sorted(used_tracks - mentioned_tracks)
    if substituted:
        fixture_warning.append(
            "The prompt did not name these tracks and the model used them anyway "
            f"(unfulfillable request substituted): {', '.join(substituted)}."
        )
    return {
        "recipe": recipe_to_request(recipe),
        "explanation": explanation,
        "warnings": fixture_warning + warnings,
        "model_used": used,
        "source": "ollama",
    }


async def revise_recipe_from_prompt(
    prompt: str,
    base_recipe: dict[str, Any],
    sources: list[dict[str, Any]] | None = None,
    model: str | None = None,
    mix_report: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Revise a base recipe from one natural-language sentence (R1).

    Same contract as `draft_recipe_from_prompt`, plus `changes` -- the
    human-readable diff of base vs revised. The prompt is interpreted as
    *deltas* against the base ("vocals up 2 dB"), not a fresh draft; the
    deterministic repair pipeline runs unchanged on the revised recipe, so
    a revision can never produce something `/build` would reject.
    """
    if not (prompt or "").strip():
        raise ValueError("Prompt is empty")
    if sources is None:
        sources = list_stem_sources()

    sources, excluded_fixtures = draftable_sources(list(sources))
    if not sources:
        raise ValueError("No library track has separated stems (see GET /api/audio/remix/sources).")
    fixture_warning = (
        [f"Excluded test-fixture source(s): {', '.join(excluded_fixtures)}."]
        if excluded_fixtures
        else []
    )
    try:
        base = request_to_recipe(base_recipe)
    except ValueError as exc:
        raise ValueError(f"base_recipe is unusable: {exc}") from exc

    # R1: a revision naming a track with no separated stems cannot be
    # honoured. Refuse before the model call -- warn and hand the base back
    # unchanged, rather than spend a draft on it or substitute a source.
    unknown = unknown_track_references(prompt, sources)
    if unknown:
        names = ", ".join(unknown)
        return {
            "recipe": recipe_to_request(base),
            "explanation": f"Revision named track(s) with no separated stems: {names}.",
            "warnings": fixture_warning
            + [f"Revision named unknown track(s): {names}; recipe left unchanged."],
            "model_used": None,
            "source": "heuristic",
            "changes": [],
        }

    from ..adapters.ollama import OllamaAdapter

    chosen = (model or DEFAULT_MODEL).strip() or DEFAULT_MODEL
    adapter = OllamaAdapter(mock_mode=False)
    system = build_revision_system_prompt(sources, recipe_to_request(base), mix_report)
    user = f"Revise the current recipe as follows:\n\n{prompt.strip()}"

    async def _call(model_name: str) -> dict[str, Any]:
        result = await adapter.generate(
            {
                "system": system,
                "prompt": user,
                "model": model_name,
                "format": "json",
                "think": False,
                "options": {"temperature": 0.4, "num_ctx": 8192},
            }
        )
        return _extract_json(result.get("response", ""))

    data: dict[str, Any] | None = None
    used = chosen
    try:
        data = await _call(chosen)
    except Exception as exc:
        logger.warning(
            "Remix revision: primary model %s failed (%s), trying %s", chosen, exc, FALLBACK_MODEL
        )
        if chosen != FALLBACK_MODEL:
            try:
                data = await _call(FALLBACK_MODEL)
                used = FALLBACK_MODEL
            except Exception as exc2:
                logger.warning(
                    "Remix revision: fallback model failed too (%s); using heuristic", exc2
                )
    if data is None:
        revised, warnings = revise_heuristic_recipe(prompt, base, sources)
        return {
            "recipe": recipe_to_request(revised),
            "explanation": "Heuristic revision (Ollama unavailable).",
            "warnings": fixture_warning
            + warnings
            + [f"Ollama unavailable ({used}); revised deterministically without a model."],
            "model_used": None,
            "source": "heuristic",
            "changes": diff_recipes(base, revised),
        }

    try:
        revised, warnings = repair_recipe(data, sources)
    except ValueError:
        logger.info("Remix revision: model recipe unusable, falling back to heuristic")
        revised, warnings = revise_heuristic_recipe(prompt, base, sources)
        return {
            "recipe": recipe_to_request(revised),
            "explanation": "Heuristic revision (model output unusable).",
            "warnings": fixture_warning
            + warnings
            + [
                "Model's recipe did not resolve against the available sources; revised deterministically."
            ],
            "model_used": used,
            "source": "heuristic",
            "changes": diff_recipes(base, revised),
        }
    explanation = (
        str(data.get("explanation", "") or "").strip() or "No explanation returned by the model."
    )
    return {
        "recipe": recipe_to_request(revised),
        "explanation": explanation,
        "warnings": fixture_warning + warnings,
        "model_used": used,
        "source": "ollama",
        "changes": diff_recipes(base, revised),
    }
