"""Searchable index over Treblo's published v3 style tags.

Backs the Treblo Tag Picker. Reads the extracted tag data that ships in the repo
(`tools/music-gen/treblo-tag-picker/treblo-tags.json`); that file is the single
source of truth and is never hand-edited here.

**No network calls, by design.** This module only reads a local file. The picker
produces text the user pastes into Treblo's own UI, so nothing is generated,
fetched, or sent anywhere. See the hard boundary in SPEC.md.

Loading follows the same shape as `music_prompt_generator`: read once, warn rather
than raise if the file is unreadable, and degrade to an empty index so a missing
data file can never take the backend down.
"""

from __future__ import annotations

import json
import logging

from ..core.config import PROJECT_ROOT

logger = logging.getLogger(__name__)

_TAGS_PATH = PROJECT_ROOT / "tools" / "music-gen" / "treblo-tag-picker" / "treblo-tags.json"

#: Cap on results. The picker shows a ranked list; returning all 4,160 for a
#: one-character query would help nobody and would ship a large payload.
DEFAULT_LIMIT = 50

#: Ranking tiers, lower is better. Exact > prefix > word-prefix > substring >
#: fuzzy subsequence. Ties inside a tier keep the site's page order, which is
#: curated (popular tags first) and is better evidence than alphabetical order.
_TIER_EXACT = 0
_TIER_PREFIX = 1
_TIER_WORD_PREFIX = 2
_TIER_SUBSTRING = 3
_TIER_FUZZY = 4

_tags: list[str] = []
_related: dict[str, list[int]] = {}
_loaded = False


def _load() -> None:
    """Load the tag data once. Never raises."""
    global _tags, _related, _loaded
    if _loaded:
        return
    try:
        data = json.loads(_TAGS_PATH.read_text(encoding="utf-8"))
        tags = data.get("tags") or []
        related = data.get("related_index") or {}
        if not isinstance(tags, list) or not tags:
            logger.warning("Treblo tag file has no tags: %s", _TAGS_PATH)
        _tags = [str(t) for t in tags]
        # Drop indices that cannot resolve rather than letting one bad row turn a
        # related lookup into an IndexError at request time.
        _related = {
            str(k): [int(i) for i in v if isinstance(i, int) and 0 <= i < len(_tags)]
            for k, v in related.items()
            if isinstance(v, list)
        }
        _loaded = True
        logger.info("Loaded %d Treblo style tags", len(_tags))
    except Exception as exc:
        logger.warning("Failed to load Treblo tags from %s: %s", _TAGS_PATH, exc)
        _tags, _related, _loaded = [], {}, True


def tag_count() -> int:
    """How many tags are indexed."""
    _load()
    return len(_tags)


def all_tags() -> list[str]:
    """Every tag, in the site's page order."""
    _load()
    return list(_tags)


def _is_subsequence(needle: str, haystack: str) -> bool:
    """Typo-tolerant match: every char of `needle` appears in order in `haystack`."""
    it = iter(haystack)
    return all(ch in it for ch in needle)


def _tier(tag: str, query: str) -> int:
    """Rank a single tag against a lowercased query, or None if it does not match."""
    if tag == query:
        return _TIER_EXACT
    if tag.startswith(query):
        return _TIER_PREFIX
    if any(word.startswith(query) for word in tag.split()):
        # "drift phonk" for query "drift": a word-prefix beats a mid-word substring
        # such as "dark drift" matching "drif".
        return _TIER_WORD_PREFIX
    if query in tag:
        return _TIER_SUBSTRING
    if _is_subsequence(query, tag):
        return _TIER_FUZZY
    return None


def search_tags(query: str, limit: int = DEFAULT_LIMIT) -> list[str]:
    """Rank tags against a query. Case-insensitive; empty query returns nothing.

    Ranking is tiered so that "phonk" returns the tag itself before the hundreds
    that merely contain it, which a naive substring search would not do.
    """
    _load()
    q = (query or "").strip().lower()
    if not q:
        return []
    scored: list[tuple[int, int, str]] = []
    for index, tag in enumerate(_tags):
        tier = _tier(tag.lower(), q)
        if tier is not None:
            # (tier, index) keeps site order as the tie-break, not the alphabet.
            scored.append((tier, index, tag))
    scored.sort(key=lambda r: (r[0], r[1]))
    return [tag for _tier_i, _i, tag in scored[:limit]]


def related_tags(tag: str, limit: int = 12) -> list[str]:
    """Tags the site lists as related to `tag`.

    Matching is case-insensitive but the lookup key is the site's exact spelling,
    because near-duplicate punctuation variants are genuinely distinct tags
    (`r&b` vs `r b`) and must not be folded together.
    """
    _load()
    key = (tag or "").strip()
    if not key:
        return []
    if key not in _related:
        lowered = key.lower()
        for candidate in _related:
            if candidate.lower() == lowered:
                key = candidate
                break
        else:
            return []
    out: list[str] = []
    seen = {key}
    for i in _related.get(key, []):
        name = _tags[i]
        if name not in seen:
            seen.add(name)
            out.append(name)
            if len(out) >= limit:
                break
    return out


def build_tag_string(selection: list[str]) -> str:
    """Join a selection into a paste-ready tag string.

    Deduplicated case-insensitively but preserving the **first spelling** the
    caller used, and preserving selection order - both matter because the tags are
    pasted verbatim into Treblo. No tag contains a comma (verified against the
    data), so comma-joining is safe here.
    """
    seen: set[str] = set()
    out: list[str] = []
    for raw in selection or []:
        tag = (raw or "").strip()
        if not tag:
            continue
        lowered = tag.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        out.append(tag)
    return ", ".join(out)
