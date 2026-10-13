"""Natural-language remix drafting (remix plan B2).

The REST surface takes a fully hand-built ``RemixRecipeRequest`` — name,
target BPM, 1-64 slots, per-layer track/stem/gain/key-shift/start-bar — so
every musical decision sits with the caller. This module closes the gap
for the target scenario *"make a darker version of track X using its
drums and bass plus the vocals from track Y"*: a prompt goes in, a
reviewable recipe comes out.

Two deliberate constraints, both from the plan:

1. **Draft only — never prompt → audio in one shot.** The endpoint returns
   ``{recipe, explanation, warnings}``; the existing ``/preview`` and
   ``/build`` (job-tracked by B5) do the rest. The agent or the user
   reviews before a render is paid for.
2. **The model never invents sources.** The system prompt carries the
   real source table (track names, which stems exist, cached probe BPM),
   and every returned layer is re-resolved against it: an unresolvable
   track or missing stem is dropped with a warning rather than rendered
   as a 400 or, worse, a silent 404 at build time.

When Ollama is unreachable the draft falls back to a deterministic
heuristic over the same source table (track mentions + stem words + the
adjective map below), so an agent always gets back a *valid* recipe plus
a warning naming the fallback. A 503 would leave the caller with nothing
to review, which is strictly worse.

The adjective map is deliberately limited to the fields the recipe schema
accepts today (gain, key shift, start bar, slot bars/crossfade). B4's
tone shaping (``lowpass_hz`` / ``brightness_db``) is not landed yet, so
"dark" here means "bass up, other down" — the honest reading of "darker"
with the parameters that exist. Extend ``MOOD_ARRANGEMENTS`` when B4
lands; nothing else changes.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from .stem_remixer import RemixLayer, RemixRecipe, RemixSlot

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "qwen3.5:9b"
FALLBACK_MODEL = "qwen3.5:4b"

STEM_NAMES = ("vocals", "drums", "bass", "other")

# How a prompt may name each stem. Keys are the real stem names; values
# are lowercase tokens that mean "use this stem" in free text.
STEM_ALIASES: dict[str, tuple[str, ...]] = {
    "vocals": ("vocal", "vocals", "voice", "voices", "singing", "rap", "acapella", "a capella", "lyric", "lyrics"),
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
    "the", "a", "an", "and", "of", "for", "with", "to", "in", "on", "at", "by",
    "from", "over", "under", "into", "using", "use", "v1", "v2", "v3", "v4",
    "mini", "suno", "sunov6mini", "mix", "remix", "original", "final", "version",
    "feat", "ft", "explicit", "clean",
}

# Adjective -> arrangement, expressed only with today's fields (see the
# module docstring: B4's tone shaping is not landed). Gains are in dB,
# applied per stem on top of the model's own values.
MOOD_ARRANGEMENTS: dict[str, dict[str, Any]] = {
    "dark": {
        "stem_gain_db": {"bass": 1.5, "drums": 0.0, "vocals": -1.0, "other": -3.0},
        "bars": 8,
        "crossfade_bars": 4.0,
        "note": "dark: bass forward, everything bright pulled back (B4 tone shaping not landed yet)",
    },
    "darker": {
        "stem_gain_db": {"bass": 2.5, "drums": -0.5, "vocals": -1.0, "other": -4.0},
        "bars": 8,
        "crossfade_bars": 4.0,
        "note": "darker: stronger pull-back than 'dark'",
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
        "bars": 16,
        "crossfade_bars": 4.0,
        "note": "smooth: drums back, long blends",
    },
    "dreamy": {
        "stem_gain_db": {"drums": -2.0, "other": 1.5, "vocals": 0.5},
        "bars": 16,
        "crossfade_bars": 6.0,
        "note": "dreamy: drums well back, slow crossfades",
    },
    "energetic": {
        "stem_gain_db": {"drums": 2.0, "other": 1.0},
        "bars": 4,
        "crossfade_bars": 1.0,
        "note": "energetic: driving, short slots",
    },
    "chill": {
        "stem_gain_db": {"drums": -1.0, "bass": 0.5},
        "bars": 16,
        "crossfade_bars": 3.0,
        "note": "chill: relaxed",
    },
    "heavy": {
        "stem_gain_db": {"bass": 2.0, "drums": 2.0, "other": -2.0},
        "bars": 4,
        "crossfade_bars": 2.0,
        "note": "heavy: bass and drums forward",
    },
    "vocal": {"stem_gain_db": {"vocals": 2.5}, "bars": 8, "crossfade_bars": 2.0, "note": "vocal-forward"},
}

_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL | re.IGNORECASE)
_BPM_RE = re.compile(r"(\d{2,3})\s*bpm", re.IGNORECASE)

_CONNECTORS = {"from", "of", "using", "with", "on", "over", "into"}

# Sources that must never be drafted from — the plan's B6 fixture guard.
# `demucs_test_input` is the ~10-second demucs test fixture that "once
# built mashups" (the plan's own cautionary tale); it sits in the source
# listing precisely because a naive `list_stem_sources` reports every
# stem directory on disk. Hash-named sources are library tracks and are
# NOT fixtures — only test-input-looking names are.
_FIXTURE_PREFIXES = ("demucs_test_input", "test_input_", "test_input", "fixture_", "test_fixture")


def is_fixture_source(track: str) -> bool:
    """True for test-fixture stem directories that must not be drafted."""
    lowered = (track or "").strip().lower()
    return any(lowered.startswith(prefix) for prefix in _FIXTURE_PREFIXES)


def draftable_sources(
    sources: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[str]]:
    """Split the source table into (draftable, excluded fixture names).

    The excluded list is returned so the caller can name what was kept
    out of a draft — silently filtering is how a fixture stays a trap.
    """
    kept: list[dict[str, Any]] = []
    excluded: list[str] = []
    for src in sources:
        name = str(src.get("track", ""))
        if is_fixture_source(name):
            excluded.append(name)
        else:
            kept.append(src)
    return kept, excluded


def _stem_word_at(token: str) -> str | None:
    """The stem a single token names, or None. Single-word aliases only."""
    for stem, aliases in STEM_ALIASES.items():
        for alias in aliases:
            if " " not in alias and token == alias:
                return stem
    return None


def attribute_stems(prompt: str, mentioned: list[dict[str, Any]]) -> list[set[str]]:
    """Which stems the prompt asks each mentioned source for.

    The plan's target scenario is *"The Last using its drums and bass plus
    the vocals from Ad Nauseam"* — one prompt, two sources, different
    stems each. A global stem scan cannot answer it ("vocals" belongs to
    the second track, not the first), so attribution is explicit:

    1. **Corridor.** A source owns the token span from its own mention to
       the next source's mention; anything before the first mention sits
       in the first source's corridor.
    2. **From/of handoff.** A stem word immediately before
       ``from|of|using|...`` plus a source mention hands that stem to
       that source, overriding the corridor — this is what makes "the
       vocals from Ad Nauseam" work when the noun precedes the name.

    Both rules are token-position arithmetic, so the result is
    deterministic and testable. Multi-word aliases ("a capella") are not
    attributed; ``detect_stems`` still catches them when no attribution
    applies.
    """
    tokens = _tokens(prompt)
    starts: list[int] = []
    for src in mentioned:
        run = longest_shared_run(_name_tokens(str(src.get("track", ""))), tokens)
        first = run[0] if run else ""
        starts.append(tokens.index(first) if first in tokens else len(tokens))
    out: list[set[str]] = [set() for _ in mentioned]
    if not mentioned:
        return out
    for i, tok in enumerate(tokens):
        stem = _stem_word_at(tok)
        if stem is None:
            continue
        owner: int | None = None
        # Rule 1: "STEM from SOURCE" — the noun hands itself to the name.
        if i + 2 < len(tokens) and tokens[i + 1] in _CONNECTORS:
            for k, start in enumerate(starts):
                if start == i + 2:
                    owner = k
                    break
        # Rule 2: corridor ownership.
        if owner is None:
            owner = 0
            for k, start in enumerate(starts):
                if start <= i:
                    owner = k
                else:
                    break
        out[owner].add(stem)
    return out


# --------------------------------------------------------------------------
# Pure helpers: tokenisation, matching, adjective detection
# --------------------------------------------------------------------------


def _tokens(text: str) -> list[str]:
    """Lowercase alphanumeric tokens; punctuation and separators dropped."""
    return [t for t in re.split(r"[^a-z0-9]+", (text or "").lower()) if t]


def _distinctive(tokens: list[str]) -> list[str]:
    """The tokens that actually identify a name (stopwords and numbers out)."""
    return [t for t in tokens if t not in _STOP_TOKENS and not t.isdigit()]


def _name_tokens(text: str) -> list[str]:
    """A source name's identity tokens, with bracketed decorations dropped.

    ``Blind Architects (Vocals Forward Mix)`` identifies as
    ``blind architects`` — the parenthetical is a mix label, not part of
    how anyone refers to the track. Library variants that share a main
    name resolve to the sorted-first match, which is deterministic.
    """
    stripped = re.sub(r"[\(\[][^\)\]]*[\)\]]", " ", text or "")
    return _tokens(stripped)


def longest_shared_run(a: list[str], b: list[str]) -> list[str]:
    """Longest contiguous token run both lists share, in order.

    Contiguity is what separates a name from a coincidence: "The Last"
    matches ``the last original v1`` as a run, while a prompt that merely
    contains the words "the" and "last" far apart does not.
    """
    if not a or not b:
        return []
    # Index b's token positions for O(n·m) scanning.
    positions: dict[str, list[int]] = {}
    for idx, tok in enumerate(b):
        positions.setdefault(tok, []).append(idx)
    best: list[str] = []
    for start, tok in enumerate(a):
        for bpos in positions.get(tok, ()):  # noqa: B007 - candidate alignment
            run: list[str] = []
            i, j = start, bpos
            while i < len(a) and j < len(b) and a[i] == b[j]:
                run.append(a[i])
                i += 1
                j += 1
            if len(run) > len(best):
                best = run
    return best


def score_mention(reference: str, text: str) -> float:
    """How completely ``text`` mentions ``reference`` (0.0-1.0).

    Coverage counts distinctive tokens of the reference that appear in
    the text. It is the precision-oriented measure used by
    ``match_track``; the recall-oriented, abbreviation-friendly measure
    a prompt needs is ``mention_score``, below.
    """
    ref = _distinctive(_tokens(reference))
    if not ref:
        return 0.0
    haystack = set(_tokens(text))
    return sum(1 for t in ref if t in haystack) / len(ref)


def mention_score(source: dict[str, Any], prompt: str) -> float:
    """How strongly a prompt names this source (0.0 = not named).

    Built on the longest shared token *run* rather than set coverage, so
    the way people abbreviate works: *"The Last"* names
    ``SunoV6Mini-The Last-Original-V1`` (shared run ``the last``), and
    *"Ad Nauseam"* names ``SunoV6Mini-Ad-Nauseam``. Two guards keep it
    honest: a run made only of stopwords scores nothing, and a run made
    only of stem words ("vocals", "bass") scores nothing either —
    instrumentation is not identity, and without this a prompt's
    "vocals from X" would match a track called "Vocals Forward Mix".

    One distinctive token is enough to *identify* for a draft. The
    output is agent-reviewable and every resolution is named in the
    explanation, so over-matching costs a review; under-matching costs
    the feature. The reference-precision path is ``match_track``.
    """
    run = longest_shared_run(_name_tokens(str(source.get("track", ""))), _tokens(prompt))
    if not run:
        return 0.0
    distinctive = list(_distinctive(run))
    if not distinctive:
        return 0.0
    if all(any(t in aliases for aliases in STEM_ALIASES.values()) for t in distinctive):
        return 0.0
    return float(len(distinctive))


def mentioned_sources(sources: list[dict[str, Any]], prompt: str) -> list[dict[str, Any]]:
    """Every source the prompt names, in the order the prompt names them.

    Position beats strength: *"drums from X over vocals from Y"* reads as
    X first, and a 2-token match later in the sentence must not jump
    ahead of a 1-token one earlier. Ties (same position) resolve by name,
    and ``list_stem_sources`` returns that order, so the result is
    deterministic.
    """
    prompt_tokens = _tokens(prompt)
    hits: list[tuple[int, str, dict[str, Any]]] = []
    for src in sources:
        if mention_score(src, prompt) <= 0:
            continue
        run = longest_shared_run(_name_tokens(str(src.get("track", ""))), prompt_tokens)
        # First token of the shared run in the prompt = its mention position.
        first = run[0] if run else ""
        position = prompt_tokens.index(first) if first in prompt_tokens else len(prompt_tokens)
        hits.append((position, str(src.get("track", "")).lower(), src))
    hits.sort(key=lambda e: (e[0], e[1]))
    return [entry[2] for entry in hits]


def match_track(reference: str, sources: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Resolve one explicit track reference against the source table.

    Order matters: exact, then normalised equivalence, then bidirectional
    token coverage. Bidirectional because a reference abbreviates a name
    (``"Blind Architects"`` → ``"Blind Architects (Vocals Forward Mix)"``)
    as often as it spells it out. First match wins, so the caller's source
    list order (the API returns it sorted by name) makes ties
    deterministic.
    """
    if not reference or not sources:
        return None
    ref = reference.strip()
    low = ref.lower()
    for src in sources:
        if str(src.get("track", "")).lower() == low:
            return src
    for src in sources:
        if _name_tokens(str(src.get("track", ""))) == _name_tokens(ref):
            return src
    best: dict[str, Any] | None = None
    best_score = 0.0
    for src in sources:
        name = str(src.get("track", ""))
        score = max(score_mention(name, ref), score_mention(ref, name))
        if score > best_score:
            best, best_score = src, score
    # 0.6 rather than 1.0: a reference may legitimately abbreviate
    # ("Ad Nauseam" vs "SunoV6Mini-Ad-Nauseam"), but must share most of
    # the distinctive tokens to be the same track.
    return best if best_score >= 0.6 else None


def detect_stems(text: str) -> set[str]:
    """Stem names this text asks for, by alias. Whole-word only.

    Word-boundary matters: "drum" must not fire on "drumstick"-style
    noise in a track title, and the multi-word aliases ("a capella",
    "low end") are matched before the single-word scan.
    """
    lowered = (text or "").lower()
    found: set[str] = set()
    for stem, aliases in STEM_ALIASES.items():
        for alias in aliases:
            if " " in alias:
                if alias in lowered:
                    found.add(stem)
            elif re.search(rf"\b{re.escape(alias)}\b", lowered):
                found.add(stem)
    return found


def detect_moods(text: str) -> list[str]:
    """Which adjective-map keys this text contains, longest first.

    Longest-first so "punchier" wins over "punchy" and the stronger
    arrangement is not shadowed by its own prefix.
    """
    lowered = (text or "").lower()
    hits = [m for m in MOOD_ARRANGEMENTS if re.search(rf"\b{re.escape(m)}\b", lowered)]
    return sorted(hits, key=len, reverse=True)


def _clamp_bpm(value: Any, default: float = 120.0) -> float:
    try:
        bpm = float(value)
    except (TypeError, ValueError):
        return default
    if not 40.0 <= bpm <= 240.0:
        return default
    return bpm


# --------------------------------------------------------------------------
# Recipe assembly and repair
# --------------------------------------------------------------------------


def _stems_for(source: dict[str, Any], wanted: set[str]) -> tuple[list[str], str | None]:
    """Which stems of this source a request resolves to, plus a repair note.

    ``wanted`` empty means the arrangement backbone (drums, bass, vocals,
    other — the order the plan's dark-mashup scenario is built on). When a
    named stem is not separated, the backbone substitutes with a warning
    rather than dropping the track: a draft that returns *something*
    reviewable beats a 400 the caller has to parse, and the note names
    exactly what was asked for and what was used. Only a source with no
    stems at all is skipped.
    """
    available = {s for s in STEM_NAMES if source.get("stems", {}).get(s)}
    if not available:
        return [], f"{source['track']}: no stems are separated yet (see GET /api/audio/remix/sources)"
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
    """Fold the detected adjectives into one layer's gain.

    Gains add, so two adjectives compose rather than the last winning.
    """
    gain = layer.gain_db
    for mood in moods:
        gain += float(MOOD_ARRANGEMENTS[mood].get("stem_gain_db", {}).get(layer.stem, 0.0))
    layer.gain_db = round(max(-24.0, min(12.0, gain)), 2)
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


def build_heuristic_recipe(prompt: str, sources: list[dict[str, Any]]) -> tuple[RemixRecipe, list[str], str]:
    """Deterministic draft when the model is unavailable (or unusable).

    Composes the plan's target scenario directly: every track the prompt
    mentions becomes one slot; stems named in the prompt (or the
    drums/bass/vocals/other backbone) fill it; detected adjectives shape
    gains and slot lengths. Always returns a *valid* recipe — that is the
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
    # Per-source stems: the prompt's own assignment ("drums and bass from
    # X, vocals from Y"), falling back to the global scan when it names
    # stems outside any corridor.
    wanted_per_source = attribute_stems(text, mentioned)
    global_stems = detect_stems(text)
    bpm = _clamp_bpm(mentioned[0].get("bpm"), 120.0)
    bars, xfade = _slot_shape(moods)
    slots: list[RemixSlot] = []
    for idx, source in enumerate(mentioned[:4]):  # the schema allows 64; a readable draft does not need them
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
                layers=[apply_moods_to_layer(RemixLayer(track=source["track"], stem=s), moods) for s in stems],
            )
        )
    if not slots:
        raise ValueError("None of the mentioned tracks have stems separated yet (see GET /api/audio/remix/sources).")
    if len(mentioned) > 4:
        warnings.append(f"{len(mentioned)} tracks mentioned; drafted the first 4 to keep the arrangement readable.")
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


def recipe_to_request(recipe: RemixRecipe, overwrite: bool = False) -> dict[str, Any]:
    """Serialise a service recipe into the REST request shape.

    ``overwrite`` defaults to False here, unlike the REST schema's True:
    A5's "no silent overwrite" starts on this side of the boundary — a
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
                    }
                    for layer in slot.layers
                ],
            }
            for slot in recipe.slots
        ],
    }


def repair_recipe(data: dict[str, Any], sources: list[dict[str, Any]]) -> tuple[RemixRecipe, list[str]]:
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
                warnings.append(f"slot {i} layer {j}: track {ref!r} is not a separated source, dropped")
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
        warnings.append(f"Model returned up to 8 layers per slot; dropped {dropped_layers} excess layers.")

    raw_bpm = data.get("target_bpm")
    bpm = _clamp_bpm(raw_bpm, 120.0)
    if isinstance(raw_bpm, (int, float)) and not (40.0 <= float(raw_bpm) <= 240.0):
        warnings.append(f"target_bpm {raw_bpm} is outside 40-240, used {bpm:g}")

    name = str(data.get("name", "") or "").strip() or "mashup-draft"
    recipe = RemixRecipe(name=name, target_bpm=bpm, slots=slots)
    recipe.validate()
    return recipe, warnings


# --------------------------------------------------------------------------
# Ollama entry point
# --------------------------------------------------------------------------


def build_system_prompt(sources: list[dict[str, Any]]) -> str:
    """System prompt carrying the real source table and the exact schema.

    The source table is the guardrail: the model is told, in its own
    context, which tracks and stems exist, so it has no reason to
    invent names — and if it does, ``repair_recipe`` catches it.
    """
    lines = [
        "You are a remix/mashup arranger. Reply with JSON only.",
        "",
        "Available sources (track -> stems, with cached tempo/duration when probed):",
    ]
    for src in sources:
        stems = ", ".join(s for s in STEM_NAMES if src.get("stems", {}).get(s)) or "none"
        extra = f" (bpm {src['bpm']:g}, {src['duration_sec']:.0f}s)" if src.get("bpm") and src.get("duration_sec") else ""
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
        "start. Explain the arrangement in one sentence per slot.",
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
            data, _ = decoder.raw_decode(raw[match.start():])
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
    stems anywhere) — that is a caller error worth a 400, not a silent
    empty draft.
    """
    if not (prompt or "").strip():
        raise ValueError("Prompt is empty")
    if sources is None:
        from . import stem_remixer

        sources = stem_remixer.list_stem_sources()

    # B6 fixture guard: never let a test fixture into a draft, into the
    # model's context, or into the matching table. `excluded` is named in
    # the warnings so the filter is visible rather than silent.
    sources, excluded_fixtures = draftable_sources(list(sources))
    if not sources:
        raise ValueError("No library track has separated stems (see GET /api/audio/remix/sources).")
    fixture_warning = (
        [f"Excluded test-fixture source(s): {', '.join(excluded_fixtures)}."] if excluded_fixtures else []
    )
    # The tracks the prompt actually named, from the available table. Any
    # track the recipe uses beyond these is the model substituting for a
    # request it could not fulfil — the reviewer must be told, because
    # "use The Last's drums" answered with take-the-crown's drums is the
    # kind of silent substitution that erodes trust in the draft.
    mentioned_tracks = {str(s.get("track", "")).lower() for s in mentioned_sources(sources, prompt)}

    # Honesty check: if the prompt names no source with separated stems,
    # say so — the reviewer needs to know the arrangement came from the
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
        logger.warning("Remix draft: primary model %s failed (%s), trying %s", chosen, exc, FALLBACK_MODEL)
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
            "warnings": fixture_warning + warnings + [f"Ollama unavailable ({used}); drafted deterministically without a model."],
            "model_used": None,
            "source": "heuristic",
        }

    try:
        recipe, warnings = repair_recipe(data, sources)
    except ValueError:
        # A model recipe that resolves to nothing is not a failed request —
        # the deterministic draft is still a reviewable answer.
        logger.info("Remix draft: model recipe unusable, falling back to heuristic")
        recipe, warnings, explanation = build_heuristic_recipe(prompt, sources)
        return {
            "recipe": recipe_to_request(recipe),
            "explanation": explanation,
            "warnings": fixture_warning + warnings + ["Model's recipe did not resolve against the available sources; drafted deterministically."],
            "model_used": used,
            "source": "heuristic",
        }
    explanation = str(data.get("explanation", "") or "").strip() or "No explanation returned by the model."
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
