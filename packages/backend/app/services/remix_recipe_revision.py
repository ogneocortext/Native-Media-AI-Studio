"""Recipe revision and repair for the remix drafter (remix plan B2 / R1).

Extracted from remix_prompt.py. Turns model JSON into a valid recipe
(repair_recipe), refines a draft with one sentence (revise_heuristic_recipe),
and serialises between the REST wire shape and the service dataclasses
(request_to_recipe / recipe_to_request). Every repair is reported, never
silent.

Depends on remix_prompt_constants, remix_prompt_parsing and
remix_recipe_heuristics; imported by remix_prompt_drafting.
"""

from __future__ import annotations

import re
from typing import Any

from .remix_prompt_constants import _CONNECTORS, STEM_ALIASES, STEM_NAMES
from .remix_prompt_parsing import (
    _stem_word_at,
    _tokens,
    detect_genres,
    detect_moods,
    match_track,
    mentioned_sources,
)
from .remix_recipe_heuristics import _clamp_bpm, apply_genre_gains, apply_moods_to_layer
from .stem_remixer import RemixLayer, RemixRecipe, RemixSlot

# A direction word with an optional amount: "up 2 dB" / "down" / "+1.5db".
# The stem is resolved backwards from here (see parse_gain_deltas) so a
# track name earlier in the sentence can never be eaten into the stem.
_GAIN_DIR_RE = re.compile(
    r"(?P<direction>up|down|\+|-)\s*(?P<amount>\d+(?:\.\d+)?)?\s*(?:db)?\b",
    re.IGNORECASE,
)

# "drop/remove/mute/cut the bass [in slot 2]" / "remove vocals from slot 1".
# A bare "drop the bass" applies to every slot; a slot qualifier scopes it.
# The stem group is tempered: without the lookahead the greedy match eats
# "in slot 2" into the stem ("bass in slot" -> last word "slot" -> no stem).
_DROP_STEM_RE = re.compile(
    r"(?:drop|remove|mute|cut|take out|lose)\s+"
    r"(?:the\s+)?(?P<stem>[a-z][a-z ]{0,19}?)"
    r"(?=\s+(?:in|from|on)\s+slot\s+\d+|\s*$|[,.])"
    r"(?:\s+(?:in|from|on)\s+slot\s+(?P<slot>\d+))?",
    re.IGNORECASE,
)

# "make slot 1 twice as long" / "slot 2: 16 bars" / "double slot 1".
_SLOT_BARS_RE = re.compile(
    r"(?:slot\s+(?P<slot1>\d+)\s*[:=]?\s*(?P<bars1>\d+)\s*bars?)"
    r"|(?:make\s+slot\s+(?P<slot2>\d+)\s+(?P<mult>twice|half|double)|"
    r"(?P<verb>double|halve)\s+slot\s+(?P<slot3>\d+))",
    re.IGNORECASE,
)

# "quieter/louder" without a number: a fixed nudge, not a parse failure.
_QUIET_LOUD_RE = re.compile(
    r"(?P<stem>[a-z][a-z ]{1,20}?)\s+(?:a\s+(?:little|bit)\s+)?(?P<direction>quieter|louder|softer)",
    re.IGNORECASE,
)


def parse_gain_deltas(text: str) -> list[tuple[str, float]]:
    """Signed dB deltas per stem alias found in a revision prompt.

    "vocals up 2 dB" -> [("vocals", +2.0)]; "drums down 3" -> [("drums", -3.0)].
    A bare direction with no number ("vocals up") is +1 dB -- a nudge, not
    an error. Unknown stem words are ignored here; the caller's repair
    pipeline drops what cannot resolve, with a warning.

    Backwards resolution: the stem is the nearest alias within the 6 words
    before the direction, validated against the alias table. A forward regex
    eats the track name ("vocals from ad nauseam up" -> last word "up" -> no
    stem), so the direction anchors first and the stem is looked back from
    it. The window also skips filler ("drums a bit quieter" finds "drums"
    past "a bit").
    """
    out: list[tuple[str, float]] = []
    lowered = (text or "").lower()
    words = re.findall(r"[a-z0-9]+", lowered)
    for match in _GAIN_DIR_RE.finditer(lowered):
        # Word index of the direction: count words ending before it.
        prefix = lowered[: match.start()]
        idx = len(re.findall(r"[a-z0-9]+", prefix))
        stem = _nearest_stem_alias(words, idx)
        if stem is None:
            continue
        direction = match.group("direction").lower()
        amount = match.group("amount")
        delta = float(amount) if amount else 1.0
        if direction in ("down", "-"):
            delta = -delta
        out.append((stem, delta))
    for match in _QUIET_LOUD_RE.finditer(lowered):
        # The quiet/loud match includes the stem group, so anchor on the
        # direction subgroup -- match.start() is the stem's start, which the
        # greedy group may have pushed far left of the real stem word.
        prefix = lowered[: match.start("direction")]
        idx = len(re.findall(r"[a-z0-9]+", prefix))
        stem = _nearest_stem_alias(words, idx)
        if stem is None:
            continue
        direction = match.group("direction").lower()
        out.append((stem, -2.0 if direction in ("quieter", "softer") else 2.0))
    return out


def _nearest_stem_alias(words: list[str], idx: int, window: int = 6) -> str | None:
    """Nearest stem alias at or before word index `idx` (exclusive).

    Scans backwards up to `window` words, trying two-word aliases ("low
    end") before single words at each position. Returns None when nothing
    in the window names a stem -- the caller skips the direction rather
    than guessing.
    """
    for back in range(1, min(window, idx) + 1):
        if back >= 2:
            two = _stem_word_at(words[idx - back] + " " + words[idx - back + 1])
            # Only accept the pair when the nearer word is not itself a stem
            # ("bass vocals up" means vocals, not "bass vocals").
            if two is not None and _stem_word_at(words[idx - back + 1]) is None:
                return two
        single = _stem_word_at(words[idx - back])
        if single is not None:
            return single
    return None


def parse_drop_stems(text: str) -> list[tuple[str, int | None]]:
    """(stem, slot_index_0based_or_None) removals named by a revision prompt.

    "drop the bass in slot 2" -> [("bass", 1)]; "remove vocals" ->
    [("vocals", None)] meaning every slot.
    """
    out: list[tuple[str, int | None]] = []
    lowered = (text or "").lower()
    for match in _DROP_STEM_RE.finditer(lowered):
        stem_word = match.group("stem").strip()
        stem = _stem_word_at(stem_word) or _stem_word_at(stem_word.split()[-1])
        if stem is None:
            continue
        slot_raw = match.group("slot")
        slot = int(slot_raw) - 1 if slot_raw else None
        out.append((stem, slot))
    return out


def parse_slot_bars(text: str) -> list[tuple[int, int, bool]]:
    """(slot_index_0based, value, absolute) length changes in a revision.

    "slot 2: 16 bars" is absolute (True); "make slot 1 twice as long" is
    relative (False) with value 2 for double/twice, 0 for half/halve.
    """
    out: list[tuple[int, int, bool]] = []
    lowered = (text or "").lower()
    for match in _SLOT_BARS_RE.finditer(lowered):
        if match.group("slot1"):
            out.append((int(match.group("slot1")) - 1, int(match.group("bars1")), True))
        elif match.group("slot2"):
            mult = match.group("mult").lower()
            out.append(
                (int(match.group("slot2")) - 1, 2 if mult in ("twice", "double") else 0, False)
            )
        elif match.group("slot3"):
            verb = match.group("verb").lower()
            out.append((int(match.group("slot3")) - 1, 2 if verb == "double" else 0, False))
    return out


# A track reference in the draft's own grammar -- the same connectors
# `attribute_stems` hands stems across -- captured with the original casing
# so a capitalised phrase can be told apart from filler.
_TRACK_REF_RE = re.compile(
    r"\b(?:" + "|".join(sorted(_CONNECTORS)) + r")\s+(?P<name>[A-Za-z0-9][^,.;:!?]*)"
)

# Words that end a reference without naming anything: "from the top",
# "using its drums", "on slot 2", "up 2 dB". A phrase made only of these
# is not a track claim, so it never warns. The single-word stem aliases
# are included: "using The Last's drums" names the track, not the drums.
_REF_FILLER = {
    "the",
    "a",
    "an",
    "it",
    "its",
    "them",
    "that",
    "this",
    "there",
    "here",
    "top",
    "start",
    "beginning",
    "middle",
    "end",
    "front",
    "back",
    "intro",
    "outro",
    "first",
    "second",
    "third",
    "one",
    "two",
    "three",
    "half",
    "twice",
    "double",
    "bit",
    "little",
    "more",
    "less",
    "again",
    "up",
    "down",
    "quieter",
    "louder",
    "softer",
    "db",
    "slot",
    "slots",
    "bar",
    "bars",
    "beat",
    "beats",
} | {alias for aliases in STEM_ALIASES.values() for alias in aliases if " " not in alias}

# Articles are part of a name ("The Vow", "The Last"), so the leading trim
# pops operands only -- an article at the front stays.
_REF_ARTICLES = {"the", "a", "an"}


def _clean_track_reference(raw: str) -> str:
    """Trim a captured reference to its name: operand words off both ends.

    "The Vow up 2 dB" -> "The Vow"; "The Last's drums" -> "The Last's".
    Returns "" when nothing but filler remains -- that reference named no
    track, so the caller must not warn about it.
    """
    words = (raw or "").split()

    def first_token(word: str) -> str:
        parts = _tokens(word)
        return parts[0] if parts else ""

    while words:
        tok = first_token(words[-1])
        if tok and tok not in _REF_FILLER and not tok.isdigit():
            break
        words.pop()
    while (
        words
        and first_token(words[0]) in _REF_FILLER
        and first_token(words[0]) not in _REF_ARTICLES
    ):
        words.pop(0)
    return " ".join(words).strip(" -").strip("'").strip('"')


def unknown_track_references(text: str, sources: list[dict[str, Any]]) -> list[str]:
    """Track names a revision references that resolve to no source.

    "vocals from The Vow up 2 dB" with no such track in the library is a
    revision the arranger cannot honour: the honest answer is a warning
    and the base recipe unchanged -- repair-before-return, same as drafts.
    Applying the delta to every matching layer instead is the silent
    substitution the draft path already refuses to make.

    Conservative by construction: only a connector phrase carrying a
    capitalised name counts. Lowercase filler ("vocals from the top up
    2 dB") is ordinary language, not a track claim, and never warns.
    Resolution reuses `match_track` and `mentioned_sources`, so the
    abbreviations the draft grammar accepts ("Ad Nauseam" for
    SunoV6Mini-Ad-Nauseam) resolve here too.
    """
    out: list[str] = []
    for match in _TRACK_REF_RE.finditer(text or ""):
        name = _clean_track_reference(match.group("name"))
        if not name:
            continue
        if not any(ch.isupper() for ch in name):
            continue
        if match_track(name, sources) is not None:
            continue
        if mentioned_sources(sources, name):
            continue
        out.append(name)
    return out


def request_to_recipe(data: dict[str, Any]) -> RemixRecipe:
    """Rebuild a service recipe from the REST request shape (R1 base_recipe).

    The mirror of `recipe_to_request`: a panel's live recipe arrives as the
    wire shape, and the revision loop needs the service dataclasses to run
    the repair pipeline over them.
    """
    slots: list[RemixSlot] = []
    raw_slots = data.get("slots") or []
    for raw in raw_slots[:64]:
        if not isinstance(raw, dict):
            continue
        layers: list[RemixLayer] = []
        for rl in (raw.get("layers") or [])[:8]:
            if not isinstance(rl, dict):
                continue
            layers.append(
                RemixLayer(
                    track=str(rl.get("track", "") or ""),
                    stem=str(rl.get("stem", "") or "").lower(),
                    gain_db=float(rl.get("gain_db", 0.0) or 0.0),
                    key_shift_semitones=float(rl.get("key_shift_semitones", 0.0) or 0.0),
                    source_start_bar=int(rl.get("source_start_bar", 0) or 0),
                    lowpass_hz=(
                        float(rl["lowpass_hz"]) if rl.get("lowpass_hz") is not None else None
                    ),
                    brightness_db=(
                        float(rl["brightness_db"]) if rl.get("brightness_db") is not None else None
                    ),
                )
            )
        try:
            bars = int(raw.get("bars", 8))
        except (TypeError, ValueError):
            bars = 8
        try:
            xfade = float(raw.get("crossfade_bars", 2.0))
        except (TypeError, ValueError):
            xfade = 2.0
        slots.append(RemixSlot(bars=bars, crossfade_bars=xfade, layers=layers))
    if not slots:
        raise ValueError("base_recipe has no slots; nothing to revise")
    name = str(data.get("name", "") or "").strip() or "mashup-draft"
    try:
        bpm = float(data.get("target_bpm", 120.0))
    except (TypeError, ValueError):
        bpm = 120.0
    try:
        bpb = int(data.get("beats_per_bar", 4))
    except (TypeError, ValueError):
        bpb = 4
    return RemixRecipe(
        name=name, target_bpm=bpm, beats_per_bar=bpb, key=data.get("key"), slots=slots
    )


def diff_recipes(base: RemixRecipe, revised: RemixRecipe) -> list[str]:
    """Human-readable changes between a base recipe and its revision.

    Compared by (track, stem) identity within each positional slot: the
    revision loop preserves order, so positional diff names what the user
    asked about. Empty means unchanged -- "looks good" is valid, not an error.
    """
    changes: list[str] = []
    if abs(base.target_bpm - revised.target_bpm) > 1e-9:
        changes.append(f"target tempo {base.target_bpm:g} -> {revised.target_bpm:g} BPM")
    for i, (b_slot, r_slot) in enumerate(zip(base.slots, revised.slots, strict=False)):
        ref = f"slot {i + 1}"
        if b_slot.bars != r_slot.bars:
            changes.append(f"{ref}: length {b_slot.bars} -> {r_slot.bars} bars")
        if abs(b_slot.crossfade_bars - r_slot.crossfade_bars) > 1e-9:
            changes.append(
                f"{ref}: crossfade {b_slot.crossfade_bars:g} -> {r_slot.crossfade_bars:g} bars"
            )
        b_layers = {(layer.track.lower(), layer.stem): layer for layer in b_slot.layers}
        r_layers = {(layer.track.lower(), layer.stem): layer for layer in r_slot.layers}
        for key in b_layers:
            if key not in r_layers:
                changes.append(f"{ref}: removed {key[1]} from {b_layers[key].track}")
        for key, r_layer in r_layers.items():
            if key not in b_layers:
                changes.append(f"{ref}: added {r_layer.stem} from {r_layer.track}")
                continue
            b_layer = b_layers[key]
            if abs(b_layer.gain_db - r_layer.gain_db) > 1e-9:
                changes.append(
                    f"{ref}: {r_layer.stem} gain {b_layer.gain_db:g} -> {r_layer.gain_db:g} dB"
                )
            if abs(b_layer.key_shift_semitones - r_layer.key_shift_semitones) > 1e-9:
                changes.append(
                    f"{ref}: {r_layer.stem} key shift {b_layer.key_shift_semitones:g} -> {r_layer.key_shift_semitones:g} st"
                )
            if b_layer.source_start_bar != r_layer.source_start_bar:
                changes.append(
                    f"{ref}: {r_layer.stem} start bar {b_layer.source_start_bar} -> {r_layer.source_start_bar}"
                )
            if (b_layer.lowpass_hz or None) != (r_layer.lowpass_hz or None):
                changes.append(
                    f"{ref}: {r_layer.stem} lowpass {b_layer.lowpass_hz} -> {r_layer.lowpass_hz} Hz"
                )
            if abs((b_layer.brightness_db or 0.0) - (r_layer.brightness_db or 0.0)) > 1e-9:
                b_tilt = b_layer.brightness_db or 0.0
                r_tilt = r_layer.brightness_db or 0.0
                changes.append(f"{ref}: {r_layer.stem} brightness {b_tilt:g} -> {r_tilt:g} dB/oct")
    if len(revised.slots) > len(base.slots):
        for i in range(len(base.slots), len(revised.slots)):
            changes.append(f"slot {i + 1}: added ({revised.slots[i].bars} bars)")
    elif len(base.slots) > len(revised.slots):
        for i in range(len(revised.slots), len(base.slots)):
            changes.append(f"slot {i + 1}: removed")
    return changes


def build_revision_system_prompt(
    sources: list[dict[str, Any]],
    base_recipe: dict[str, Any],
    mix_report: dict[str, Any] | None = None,
) -> str:
    """System prompt for revision mode: the recipe verbatim, deltas only.

    `mix_report` is the last build's measured levels (per-stem LUFS, true
    peak, clipping). When present the model revises against what was
    actually rendered, not just the recipe's gain numbers -- e.g. a
    "vocals up 2 dB" on a vocal stem already clipping is better answered
    by pulling the other stems down.
    """
    import json

    lines = [
        "You are a remix/mashup arranger revising an existing recipe. Reply with JSON only.",
        "",
        "Current recipe (apply ONLY what the revision asks; leave everything else identical):",
        json.dumps(base_recipe),
        "",
        "Available sources (track -> stems, with cached tempo/duration when probed):",
    ]
    for src in sources:
        stems = ", ".join(s for s in STEM_NAMES if src.get("stems", {}).get(s)) or "none"
        extra = ""
        if src.get("bpm") and src.get("duration_sec"):
            extra = f" (bpm {src['bpm']:g}, {src['duration_sec']:.0f}s)"
        lines.append(f"- {src['track']}{extra}: {stems}")
    lines += [
        "",
        "Reply with exactly this shape (the FULL revised recipe, not a diff):",
        '{"name": str, "target_bpm": number, "explanation": str,',
        ' "mood_notes": [str], "slots": [{"bars": int, "crossfade_bars": number,',
        ' "layers": [{"track": str, "stem": str, "gain_db": number,',
        ' "key_shift_semitones": number, "source_start_bar": int}]}]}',
        "",
        "Rules: return every slot and layer from the current recipe unless the",
        "revision explicitly removes it; use only tracks and stems from the list",
        "above; gains within -24..+12 dB. Explain the revision in one sentence.",
    ]
    if mix_report:
        lines += [
            "",
            "Last build's measured mix report (per-stem integrated LUFS, true",
            "peak, pre-limiter peak, clipping flag):",
            json.dumps(mix_report),
            "If the revision raises a gain, check this report first: a stem",
            "already near clipping is better balanced by lowering the others.",
        ]
    return "\n".join(lines)


def revise_heuristic_recipe(
    prompt: str, base: RemixRecipe, sources: list[dict[str, Any]]
) -> tuple[RemixRecipe, list[str]]:
    """Deterministic revision when the model is unavailable (or unneeded).

    Parses gain deltas ("vocals up 2 dB"), stem removals ("drop the bass in
    slot 2") and slot-length changes ("make slot 1 twice as long") directly
    off the base recipe. A revision that names an unknown track warns and
    leaves the recipe unchanged -- repair-before-return, same as drafts.
    """
    import copy

    warnings: list[str] = []
    revised = copy.deepcopy(base)
    text = prompt or ""

    # A revision naming a track with no separated stems ("vocals from The
    # Vow up 2 dB") cannot be honoured: warn and leave the recipe
    # unchanged rather than apply the delta to every matching layer.
    unknown = unknown_track_references(text, sources)
    if unknown:
        names = ", ".join(unknown)
        warnings.append(f"Revision named unknown track(s): {names}; recipe left unchanged.")
        return base, warnings

    deltas = parse_gain_deltas(text)
    drops = parse_drop_stems(text)
    bars_changes = parse_slot_bars(text)

    if not deltas and not drops and not bars_changes:
        moods = detect_moods(text)
        genres = detect_genres(text)
        if moods or genres:
            for slot in revised.slots:
                for k, layer in enumerate(slot.layers):
                    layer = apply_moods_to_layer(copy.copy(layer), moods)
                    slot.layers[k] = apply_genre_gains(layer, genres)
            applied = [f"mood(s): {', '.join(moods)}"] if moods else []
            if genres:
                applied.append(f"genre(s): {', '.join(genres)}")
            warnings.append(f"Applied {'; '.join(applied)}.")
        else:
            warnings.append("No revision understood; recipe unchanged.")
        return revised, warnings

    # Track scope: "vocals from Ad Nauseam up 2 dB" scopes the delta to that
    # source; otherwise the stem delta applies to every matching stem.
    mentioned = mentioned_sources(sources, text)
    scoped_track: str | None = None
    if deltas and mentioned:
        scoped_track = str(mentioned[0].get("track", "")).lower()

    for stem, delta in deltas:
        applied = 0
        for slot in revised.slots:
            for layer in slot.layers:
                if layer.stem != stem:
                    continue
                if scoped_track and layer.track.lower() != scoped_track:
                    continue
                layer.gain_db = round(max(-24.0, min(12.0, layer.gain_db + delta)), 2)
                applied += 1
        if applied == 0:
            warnings.append(f"No {stem} layer found to adjust; gain unchanged.")

    for stem, slot_idx in drops:
        targets = [slot_idx] if slot_idx is not None else list(range(len(revised.slots)))
        removed = 0
        for i in targets:
            if 0 <= i < len(revised.slots):
                before = len(revised.slots[i].layers)
                revised.slots[i].layers = [ly for ly in revised.slots[i].layers if ly.stem != stem]
                removed += before - len(revised.slots[i].layers)
        if removed == 0:
            ref = f" in slot {slot_idx + 1}" if slot_idx is not None else ""
            warnings.append(f"No {stem} layer found{ref} to remove.")

    for slot_idx, bars, absolute in bars_changes:
        if 0 <= slot_idx < len(revised.slots):
            if absolute:
                revised.slots[slot_idx].bars = max(1, min(256, bars))
            elif bars == 2:
                revised.slots[slot_idx].bars = max(1, min(256, revised.slots[slot_idx].bars * 2))
            else:
                revised.slots[slot_idx].bars = max(1, revised.slots[slot_idx].bars // 2)
        else:
            warnings.append(f"Slot {slot_idx + 1} does not exist; length unchanged.")

    # A revision must still be buildable: re-resolve every layer against the
    # source table, dropping what no longer resolves with a warning.
    by_name = {str(s.get("track", "")).lower(): s for s in sources}
    for i, slot in enumerate(revised.slots):
        kept: list[RemixLayer] = []
        for layer in slot.layers:
            src = by_name.get(layer.track.lower()) or match_track(layer.track, sources)
            if src is None or not src.get("stems", {}).get(layer.stem):
                warnings.append(
                    f"slot {i + 1}: {layer.stem} from {layer.track} no longer resolves, dropped"
                )
                continue
            layer.track = str(src["track"])
            kept.append(layer)
        slot.layers = kept
    revised.slots = [slot for slot in revised.slots if slot.layers]
    if not revised.slots:
        warnings.append("Revision removed every layer; returning the base recipe unchanged.")
        return base, warnings
    revised.validate()
    return revised, warnings


def _tone_field(
    raw: Any, lo: float, hi: float, label: str, warnings: list[str], ref: str
) -> float | None:
    """Clamp one B4 tone field from model output, warning on any change."""
    if raw is None:
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        warnings.append(f"{ref}: {label} {raw!r} is not a number, ignored")
        return None
    if not lo <= value <= hi:
        clamped = max(lo, min(hi, value))
        warnings.append(
            f"{ref}: {label} {value:g} outside [{lo:g}, {hi:g}], clamped to {clamped:g}"
        )
        return clamped
    return value


def repair_recipe(
    data: dict[str, Any], sources: list[dict[str, Any]]
) -> tuple[RemixRecipe, list[str]]:
    """Turn model JSON into a valid recipe, repairing what it got wrong.

    Every repair is reported, never silent: the caller is an agent
    reviewing a draft, so "the model said X, I used Y" is exactly what
    the warning list is for. Unrepairable (no layers at all) raises
    ValueError, which the endpoint maps to a 400.
    """
    warnings: list[str] = []
    if not isinstance(data, dict):
        raise ValueError("Model did not return a JSON object")
    by_name = {str(s.get("track", "")).lower(): s for s in sources}
    raw_moods = data.get("mood_notes")
    mood_text = " ".join(str(m) for m in raw_moods) if isinstance(raw_moods, list) else ""
    moods = detect_moods(mood_text)

    raw_slots = data.get("slots")
    if not isinstance(raw_slots, list) or not raw_slots:
        raise ValueError("Model returned no slots; a mashup needs at least one")
    if len(raw_slots) > 64:
        warnings.append(f"Model returned {len(raw_slots)} slots; capped at the schema's 64.")
    dropped_layers = 0
    slots: list[RemixSlot] = []
    for i, raw in enumerate(raw_slots[:64]):
        if not isinstance(raw, dict):
            warnings.append(f"slot {i}: not an object, skipped")
            continue
        raw_layers = raw.get("layers")
        if not isinstance(raw_layers, list):
            warnings.append(f"slot {i}: no layers, skipped")
            continue
        if len(raw_layers) > 8:
            dropped_layers += len(raw_layers) - 8
        layers: list[RemixLayer] = []
        for j, rl in enumerate(raw_layers[:8]):
            if not isinstance(rl, dict):
                warnings.append(f"slot {i} layer {j}: not an object, skipped")
                continue
            ref = str(rl.get("track", "") or "")
            src = by_name.get(ref.lower()) or match_track(ref, sources)
            if src is None:
                warnings.append(
                    f"slot {i} layer {j}: track {ref!r} is not a separated source, dropped"
                )
                continue
            stem = str(rl.get("stem", "") or "").lower()
            if stem not in STEM_NAMES or not src.get("stems", {}).get(stem):
                available = [s for s in STEM_NAMES if src.get("stems", {}).get(s)]
                warnings.append(
                    f"slot {i} layer {j}: stem {stem!r} not available for {src['track']} "
                    f"(available: {', '.join(available) or 'none'}), dropped"
                )
                continue
            layer = RemixLayer(
                track=str(src["track"]),
                stem=stem,
                gain_db=float(rl.get("gain_db", 0.0) or 0.0),
                key_shift_semitones=float(rl.get("key_shift_semitones", 0.0) or 0.0),
                source_start_bar=int(rl.get("source_start_bar", 0) or 0),
                lowpass_hz=_tone_field(
                    rl.get("lowpass_hz"),
                    200.0,
                    20000.0,
                    "lowpass_hz",
                    warnings,
                    f"slot {i} layer {j}",
                ),
                brightness_db=_tone_field(
                    rl.get("brightness_db"),
                    -12.0,
                    12.0,
                    "brightness_db",
                    warnings,
                    f"slot {i} layer {j}",
                ),
            )
            layers.append(apply_moods_to_layer(layer, moods))
        if layers:
            try:
                bars = int(raw.get("bars", 8))
                xfade = float(raw.get("crossfade_bars", 2.0))
            except (TypeError, ValueError):
                bars, xfade = 8, 2.0
                warnings.append(f"slot {i}: unreadable bars/crossfade, used 8 / 2.0")
            slots.append(RemixSlot(bars=bars, crossfade_bars=xfade, layers=layers))
    if not slots:
        raise ValueError("No layer in the model's recipe resolved against the available sources")
    if dropped_layers:
        warnings.append(
            f"Model returned up to 8 layers per slot; dropped {dropped_layers} excess layers."
        )

    raw_bpm = data.get("target_bpm")
    bpm = _clamp_bpm(raw_bpm, 120.0)
    if isinstance(raw_bpm, (int, float)) and not (40.0 <= float(raw_bpm) <= 240.0):
        warnings.append(f"target_bpm {raw_bpm} is outside 40-240, used {bpm:g}")

    name = str(data.get("name", "") or "").strip() or "mashup-draft"
    recipe = RemixRecipe(name=name, target_bpm=bpm, slots=slots)
    recipe.validate()
    return recipe, warnings


def recipe_to_request(recipe: RemixRecipe, *, overwrite: bool = False) -> dict[str, Any]:
    """Serialise a service recipe into the REST request shape.

    ``overwrite`` defaults to False here, unlike the REST schema's True:
    A5's "no silent overwrite" starts on this side of the boundary -- a
    drafted recipe must never clobber an existing mashup by default.
    """
    return {
        "name": recipe.name,
        "target_bpm": recipe.target_bpm,
        "beats_per_bar": recipe.beats_per_bar,
        "key": recipe.key,
        "overwrite": overwrite,
        "slots": [
            {
                "bars": slot.bars,
                "crossfade_bars": slot.crossfade_bars,
                "layers": [
                    {
                        "track": layer.track,
                        "stem": layer.stem,
                        "gain_db": layer.gain_db,
                        "key_shift_semitones": layer.key_shift_semitones,
                        "source_start_bar": layer.source_start_bar,
                        # B4: None (not 0) so a build request omits them and the
                        # renderer takes the untouched path.
                        "lowpass_hz": layer.lowpass_hz,
                        "brightness_db": layer.brightness_db,
                    }
                    for layer in slot.layers
                ],
            }
            for slot in recipe.slots
        ],
    }
