"""Natural-language remix drafting (remix plan B2).

The REST surface takes a fully hand-built ``RemixRecipeRequest`` -- name,
target BPM, 1-64 slots, per-layer track/stem/gain/key-shift/start-bar -- so
every musical decision sits with the caller. This module closes the gap
for the target scenario *"make a darker version of track X using its
drums and bass plus the vocals from track Y"*: a prompt goes in, a
reviewable recipe comes out.

Two deliberate constraints, both from the plan:

1. **Draft only -- never prompt -> audio in one shot.** The endpoint returns
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

The adjective map lands on B4's tone-shaping fields as well as gain:
"dark" is a 900 Hz lowpass plus a -4 dB/octave tilt, not merely quieter,
because before B4 the word had no parameter to mean.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from .stem_remixer import RemixLayer, RemixRecipe, RemixSlot, list_stem_sources

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "qwen3.5:4b"
FALLBACK_MODEL = "qwen3.5:4b"

STEM_NAMES = ("vocals", "drums", "bass", "other")

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

_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL | re.IGNORECASE)
_BPM_RE = re.compile(r"(\d{2,3})\s*bpm", re.IGNORECASE)

_CONNECTORS = {"from", "of", "using", "with", "on", "over", "into"}

# Sources that must never be drafted from -- the plan's B6 fixture guard.
# `demucs_test_input` is the ~10-second demucs test fixture that "once
# built mashups" (the plan's own cautionary tale); it sits in the source
# listing precisely because a naive `list_stem_sources` reports every
# stem directory on disk. Hash-named sources are library tracks and are
# NOT fixtures -- only test-input-looking names are.
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
    out of a draft -- silently filtering is how a fixture stays a trap.
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
    the vocals from Ad Nauseam"* -- one prompt, two sources, different
    stems each. A global stem scan cannot answer it ("vocals" belongs to
    the second track, not the first), so attribution is explicit:

    1. **Corridor.** A source owns the token span from its own mention to
       the next source's mention; anything before the first mention sits
       in the first source's corridor.
    2. **From/of handoff.** A stem word immediately before
       ``from|of|using|...`` plus a source mention hands that stem to
       that source, overriding the corridor -- this is what makes "the
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
        # Rule 1: "STEM from SOURCE" -- the noun hands itself to the name.
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
    ``blind architects`` -- the parenthetical is a mix label, not part of
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
    # Index b's token positions for O(n.m) scanning.
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
    only of stem words ("vocals", "bass") scores nothing either --
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
    (``"Blind Architects"`` -> ``"Blind Architects (Vocals Forward Mix)"``)
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


def detect_genres(text: str) -> list[str]:
    """Which genre-profile ids this text names, longest tag first.

    Same contract as detect_moods: word-boundary match so "pop" does not
    fire inside "popular", longest tag first so "drift phonk" beats "phonk".
    """
    lowered = (text or "").lower()
    hits: list[str] = []
    for gid, tags in GENRE_TAGS.items():
        for tag in sorted(tags, key=len, reverse=True):
            if re.search(rf"\b{re.escape(tag)}\b", lowered):
                hits.append(gid)
                break
    return sorted(hits, key=lambda g: max(len(t) for t in GENRE_TAGS[g]), reverse=True)


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


# --------------------------------------------------------------------------
# Recipe assembly and repair
# --------------------------------------------------------------------------


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


def recipe_to_request(recipe: RemixRecipe, overwrite: bool = False) -> dict[str, Any]:
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


# --------------------------------------------------------------------------
# R1 revision loop (remix-iteration plan): refine a draft with one sentence
# --------------------------------------------------------------------------

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
    name = str(data.get("name", "") or "mashup-draft").strip() or "mashup-draft"
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


# --------------------------------------------------------------------------
# Ollama entry point
# --------------------------------------------------------------------------


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
