"""Suno cross-reference: how well each Treblo tag is attested in Suno community use.

Backs the picker's Suno-facing layer. `suno-crossref.json` ships in the repo and is
never hand-edited here.

**What the tiers mean.** They come from cross-referencing Treblo's tag list against
a Suno community corpus (1,000+ prompts, 13 genres):

- **tier1 / "verified"** - the tag matches a Suno community descriptor verbatim.
- **tier2 / "community-used"** - the tag's words appear in community descriptors.
- **tier3 / "unverified"** - not attested *in this corpus*.

Tier 3 is emphatically **not** a quality verdict. The corpus covers 13 genres, so it
misses obvious Suno-safe terms: measured, `classical`, `pop`, `rock` and `jazz` are
all tier1, while `male vocalist` lands in tier3. Presenting tier3 as "won't work"
would be a lie about the corpus, so the UI badges it as unverified and leaves it
unbadged rather than warning.

`suno_production_vocab` (314 phrases) is the genuinely additive part: it is
Suno-community production/effect language - `808 bass slides`, `vinyl crackle`,
`half-time` - that covers *how* users steer sound, which Treblo's genre/mood list
does not. Measured: none of the 314 collide with a Treblo tag, so they can be offered
as a separate Suno-only suggestion row without muddying the tag list.

**No network calls.** This reads one local file; the user pastes the result into
Suno themselves.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from ..core.config import PROJECT_ROOT

logger = logging.getLogger(__name__)

_CROSSREF_PATH = PROJECT_ROOT / "tools" / "music-gen" / "treblo-tag-picker" / "suno-crossref.json"

#: Short, human-facing labels. Kept here rather than in the frontend so the wording
#: that overclaims ("unverified", never "unsupported") is decided in one place.
TIER_LABELS = {
    1: "verified",
    2: "community-used",
    3: "unverified",
}

#: Stable wire values, so the frontend never has to hard-code integers.
TIER_KEYS = {1: "tier1_exact_match", 2: "tier2_word_attested", 3: "tier3_untested_in_corpus"}

_TIER_LIST_KEYS = ("tier1_exact_match", "tier2_word_attested", "tier3_untested_in_corpus")

_tag_tier: dict[str, int] = {}
_production: list[str] = []
_meta: dict[str, Any] = {}
_loaded = False


def _load() -> None:
    """Load the cross-reference once. Never raises."""
    global _tag_tier, _production, _meta, _loaded
    if _loaded:
        return
    try:
        data = json.loads(_CROSSREF_PATH.read_text(encoding="utf-8"))
        tier: dict[str, int] = {}
        for level, key in enumerate(_TIER_LIST_KEYS, start=1):
            for tag in data.get(key) or []:
                # First writer wins. The tiers are disjoint as shipped (verified),
                # and if a future re-extraction overlaps them, the stronger
                # attestation should not be overwritten by a weaker one.
                tier.setdefault(str(tag), level)
        _tag_tier = tier
        _production = [str(p) for p in (data.get("suno_production_vocab") or [])]
        _meta = data.get("meta") if isinstance(data.get("meta"), dict) else {}
        _loaded = True
        logger.info(
            "Loaded Suno cross-reference: %d tiered tags, %d production phrases",
            len(_tag_tier), len(_production),
        )
    except Exception as exc:
        logger.warning("Failed to load Suno cross-reference from %s: %s", _CROSSREF_PATH, exc)
        _tag_tier, _production, _meta, _loaded = {}, [], {}, True


def tier_for(tag: str) -> int | None:
    """1, 2 or 3 for an attested tag; None when the tag is not in the mapping."""
    _load()
    return _tag_tier.get((tag or "").strip().lower())


def attestation_for(tags: list[str]) -> dict[str, dict[str, Any]]:
    """Attestation records for `tags`, keyed by the tag as given.

    Omit a tag from the result when it has no record, so the caller can distinguish
    "no attestation" from "not a real tag".
    """
    _load()
    out: dict[str, dict[str, Any]] = {}
    for raw in tags or []:
        tag = (raw or "").strip()
        tier = _tag_tier.get(tag.lower())
        if tier is None:
            continue
        out[tag] = {"tier": tier, "key": TIER_KEYS[tier], "label": TIER_LABELS[tier]}
    return out


def production_vocab(query: str = "", limit: int = 24) -> list[str]:
    """Suno production/effect phrases, optionally filtered by a query.

    Same tiered ranking idea as the tag search: exact, then prefix, then substring.
    """
    _load()
    q = (query or "").strip().lower()
    if not q:
        return _production[:limit]
    exact, prefix, substring = [], [], []
    for phrase in _production:
        low = phrase.lower()
        if low == q:
            exact.append(phrase)
        elif low.startswith(q):
            prefix.append(phrase)
        elif q in low:
            substring.append(phrase)
    ranked = exact + prefix + substring
    return ranked[:limit]


def production_count() -> int:
    _load()
    return len(_production)


def tier_counts() -> dict[str, int]:
    """Tier histogram, for the UI to describe its own scope honestly."""
    _load()
    counts = {1: 0, 2: 0, 3: 0}
    for tier in _tag_tier.values():
        counts[tier] = counts.get(tier, 0) + 1
    return {TIER_KEYS[k]: v for k, v in counts.items()}


def meta() -> dict[str, Any]:
    """Provenance for the UI: which corpora this came from and how it was built."""
    _load()
    return dict(_meta)
