"""Prompt parsing for the natural-language remix drafter (remix plan B2).

Extracted from remix_prompt.py. Everything here is deterministic text
processing: mention scoring, track matching, stem/mood/genre detection and
the B6 fixture guard. No Ollama, no audio decoding, no recipe dataclasses
-- those live in remix_recipe_heuristics / remix_recipe_revision.

Depends only on remix_prompt_constants (+ stdlib), so this module is a
leaf in the dependency graph.
"""

from __future__ import annotations

import re
from typing import Any

from .remix_prompt_constants import (
    _CONNECTORS,
    _FIXTURE_PREFIXES,
    _STOP_TOKENS,
    GENRE_TAGS,
    MOOD_ARRANGEMENTS,
    STEM_ALIASES,
)


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
