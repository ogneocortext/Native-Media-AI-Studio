"""Heuristic recipe assembly for the remix drafter (remix plan B2).

Extracted from remix_prompt.py. Deterministic fallback drafting: every
track the prompt mentions becomes one slot; stems named in the prompt (or
the drums/bass/vocals/other backbone) fill it; detected adjectives shape
gains and slot lengths. Always returns a *valid* recipe -- that is the
point of the fallback.

Depends on remix_prompt_constants and remix_prompt_parsing; imported by
remix_recipe_revision and remix_prompt_drafting.
"""

from __future__ import annotations

from typing import Any

from .remix_prompt_constants import GENRE_GAIN_PROFILES, MOOD_ARRANGEMENTS, STEM_NAMES
from .remix_prompt_parsing import (
    attribute_stems,
    detect_genres,
    detect_moods,
    detect_stems,
    mentioned_sources,
)
from .stem_remixer import RemixLayer, RemixRecipe, RemixSlot


def apply_genre_gains(layer: RemixLayer, genres: list[str]) -> RemixLayer:
    """Fold genre starting-balance offsets into one layer's gain.

    Gains add and clamp like moods; the first (strongest-match) genre wins
    when several hit, so "drift phonk trap metal" does not stack two bass
    boosts into clipping.
    """
    if not genres:
        return layer
    profile = GENRE_GAIN_PROFILES.get(genres[0], {})
    gain = layer.gain_db + float(profile.get(layer.stem, 0.0))
    layer.gain_db = round(max(-24.0, min(12.0, gain)), 2)
    return layer


def _clamp_bpm(value: Any, default: float = 120.0) -> float:
    try:
        bpm = float(value)
    except (TypeError, ValueError):
        return default
    if not 40.0 <= bpm <= 240.0:
        return default
    return bpm


def _stems_for(source: dict[str, Any], wanted: set[str]) -> tuple[list[str], str | None]:
    """Which stems of this source a request resolves to, plus a repair note.

    ``wanted`` empty means the arrangement backbone (drums, bass, vocals,
    other -- the order the plan's dark-mashup scenario is built on). When a
    named stem is not separated, the backbone substitutes with a warning
    rather than dropping the track: a draft that returns *something*
    reviewable beats a 400 the caller has to parse, and the note names
    exactly what was asked for and what was used. Only a source with no
    stems at all is skipped.
    """
    available = {s for s in STEM_NAMES if source.get("stems", {}).get(s)}
    if not available:
        return (
            [],
            f"{source['track']}: no stems are separated yet (see GET /api/audio/remix/sources)",
        )
    if not wanted:
        return [s for s in ("drums", "bass", "vocals", "other") if s in available], None
    chosen = [s for s in STEM_NAMES if s in wanted and s in available]
    if chosen:
        return chosen, None
    missing = sorted(wanted - available)
    backbone = [s for s in ("drums", "bass", "vocals", "other") if s in available]
    return backbone, (
        f"{source['track']}: {', '.join(missing)} not separated; used {', '.join(backbone)} instead"
    )


def apply_moods_to_layer(layer: RemixLayer, moods: list[str]) -> RemixLayer:
    """Fold the detected adjectives into one layer.

    Gains and tilts add, so two adjectives compose rather than the last
    winning. The lowpass is the exception: it is taken from the *strongest*
    mood (``detect_moods`` returns longest-first) because filtering 900 Hz
    then 600 Hz is the 600 Hz filter, and summing cutoffs would silently
    pick whichever happened to be lower.
    """
    gain = layer.gain_db
    tilt = layer.brightness_db or 0.0
    lowpass: float | None = None
    for mood in moods:
        shape = MOOD_ARRANGEMENTS[mood]
        gain += float(shape.get("stem_gain_db", {}).get(layer.stem, 0.0))
        tilt += float(shape.get("brightness_db", 0.0))
        cutoff = shape.get("lowpass_hz")
        if cutoff is not None and lowpass is None:
            lowpass = float(cutoff)
    layer.gain_db = round(max(-24.0, min(12.0, gain)), 2)
    layer.brightness_db = round(max(-12.0, min(12.0, tilt)), 2)
    if lowpass is not None:
        layer.lowpass_hz = lowpass
    return layer


def _slot_shape(moods: list[str], fallback_bars: int = 8) -> tuple[int, float]:
    """Slot bars/crossfade the adjectives ask for, else the caller's."""
    bars = fallback_bars
    xfade = 2.0
    for mood in moods:  # first hit wins; detect_moods returns strongest-first
        shape = MOOD_ARRANGEMENTS[mood]
        bars = int(shape.get("bars", bars))
        xfade = float(shape.get("crossfade_bars", xfade))
        break
    return bars, xfade


def build_heuristic_recipe(
    prompt: str, sources: list[dict[str, Any]]
) -> tuple[RemixRecipe, list[str], str]:
    """Deterministic draft when the model is unavailable (or unusable).

    Composes the plan's target scenario directly: every track the prompt
    mentions becomes one slot; stems named in the prompt (or the
    drums/bass/vocals/other backbone) fill it; detected adjectives shape
    gains and slot lengths. Always returns a *valid* recipe -- that is the
    point of the fallback.
    """
    warnings: list[str] = []
    text = prompt or ""
    mentioned = mentioned_sources(sources, text)
    if not mentioned:
        raise ValueError(
            "No library track was recognised in the prompt. Name one explicitly, "
            "or call GET /api/audio/remix/sources for the available tracks."
        )
    moods = detect_moods(text)
    genres = detect_genres(text)
    # Per-source stems: the prompt's own assignment ("drums and bass from
    # X, vocals from Y"), falling back to the global scan when it names
    # stems outside any corridor.
    wanted_per_source = attribute_stems(text, mentioned)
    global_stems = detect_stems(text)
    bpm = _clamp_bpm(mentioned[0].get("bpm"), 120.0)
    bars, xfade = _slot_shape(moods)
    slots: list[RemixSlot] = []
    for idx, source in enumerate(
        mentioned[:4]
    ):  # the schema allows 64; a readable draft does not need them
        wanted = wanted_per_source[idx] or global_stems
        stems, note = _stems_for(source, wanted)
        if note:
            warnings.append(note)
        if not stems:
            continue
        slots.append(
            RemixSlot(
                bars=bars,
                crossfade_bars=xfade,
                layers=[
                    apply_genre_gains(
                        apply_moods_to_layer(RemixLayer(track=source["track"], stem=s), moods),
                        genres,
                    )
                    for s in stems
                ],
            )
        )
    if not slots:
        raise ValueError(
            "None of the mentioned tracks have stems separated yet (see GET /api/audio/remix/sources)."
        )
    if len(mentioned) > 4:
        warnings.append(
            f"{len(mentioned)} tracks mentioned; drafted the first 4 to keep the arrangement readable."
        )
    recipe = RemixRecipe(name="mashup-draft", target_bpm=bpm, slots=slots)
    explanation = (
        "Heuristic draft (Ollama unavailable): "
        + ", ".join(
            f"{src['track']} [{', '.join(layer.stem for layer in slot.layers)}]"
            for src, slot in zip(mentioned[:4], slots, strict=False)
        )
        + (f"; adjectives applied: {', '.join(moods)}" if moods else "; no adjectives detected")
        + f"; target {bpm:g} BPM from {mentioned[0]['track']}'s probe."
    )
    return recipe, warnings, explanation
