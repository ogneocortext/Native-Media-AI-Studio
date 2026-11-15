"""Sung-truth diff (R2): compare a lyric sheet against a real transcription.

A written section is not necessarily a sung section. The Valley Phonk lyric
set contains a Bridge that was never sung in the Extended V2 render; per R2 it
earns no panels and no on-screen text. This module is pure: no I/O, no LLM,
no clock. It normalizes both sides to word tokens, matches each sheet line
against the transcript's word stream with a fuzzy threshold, and reports a
per-section ``sung`` / ``not_sung`` verdict.

Whisper output is noisy (``avg_logprob`` around -4.5 on the reference
transcript), so exact string equality is the wrong tool; set overlap over
content words is deliberate.
"""

from __future__ import annotations

import re
from typing import Any

# A sheet line counts as sung when at least this fraction of its content words
# appears anywhere in the transcript's normalized word stream.
LINE_MATCH_THRESHOLD = 0.6

# A section is sung when at least this fraction of its lines is sung.
SECTION_SUNG_MIN_FRACTION = 0.5

_WORD_RE = re.compile(r"[a-z0-9']+")

# Small function-word list. These carry no locating signal for a fuzzy match,
# and keeping them would let two unrelated lines pass on "the/and/to" alone.
STOPWORDS = frozenset(
    {
        "a", "ain", "aint", "an", "and", "are", "as", "at", "be", "but", "by",
        "can", "cant", "could", "did", "do", "does", "dont", "for", "from",
        "had", "has", "have", "he", "her", "here", "him", "his", "i", "if",
        "im", "in", "is", "it", "its", "ive", "me", "my", "no", "not", "of",
        "on", "or", "our", "she", "so", "that", "the", "their", "them", "then",
        "there", "these", "they", "this", "to", "us", "was", "we", "were",
        "what", "when", "where", "which", "who", "will", "with", "wont", "you",
        "your",
    }
)


def normalize_text(text: str) -> list[str]:
    """Lowercase, strip punctuation/apostrophes, and split into word tokens."""
    return [token.replace("'", "") for token in _WORD_RE.findall(text.lower()) if token]


def content_words(tokens: list[str]) -> list[str]:
    """Drop the stopword set, keeping order and duplicates."""
    return [token for token in tokens if token not in STOPWORDS]


def transcript_word_set(transcript: dict[str, Any]) -> set[str]:
    """Every normalized word in a Whisper-shaped transcript.

    Accepts ``segments`` (Whisper's native shape) and falls back to ``lines``
    (``{start, end, text}`` or bare strings) so cached payloads work too.
    """
    words: set[str] = set()
    segments = transcript.get("segments")
    if isinstance(segments, list):
        for segment in segments:
            if isinstance(segment, dict):
                words.update(normalize_text(str(segment.get("text") or "")))
            elif isinstance(segment, str):
                words.update(normalize_text(segment))
    if not words:
        lines = transcript.get("lines")
        if isinstance(lines, list):
            for line in lines:
                if isinstance(line, dict):
                    words.update(normalize_text(str(line.get("text") or "")))
                elif isinstance(line, str):
                    words.update(normalize_text(line))
    return words


def line_is_sung(line: str, words: set[str]) -> bool:
    """True when enough of a sheet line's content words appear in ``words``."""
    tokens = content_words(normalize_text(line))
    if not tokens:
        # No locating words at all (e.g. "oh oh oh"): treat as not sung rather
        # than passing every such line by default.
        return False
    hits = sum(1 for token in tokens if token in words)
    return hits / len(tokens) >= LINE_MATCH_THRESHOLD


def diff_sung_sections(
    sections: list[dict[str, Any]], transcript: dict[str, Any]
) -> list[dict[str, Any]]:
    """Return ``{name, status, lines_total, lines_sung}`` per lyric section."""
    words = transcript_word_set(transcript)
    results: list[dict[str, Any]] = []
    for section in sections or []:
        if not isinstance(section, dict):
            continue
        lines = [str(line) for line in (section.get("lines") or [])]
        lines_sung = sum(1 for line in lines if line_is_sung(line, words))
        lines_total = len(lines)
        is_sung = lines_total > 0 and lines_sung >= lines_total * SECTION_SUNG_MIN_FRACTION
        results.append(
            {
                "name": str(section.get("name") or ""),
                "status": "sung" if is_sung else "not_sung",
                "lines_total": lines_total,
                "lines_sung": lines_sung,
            }
        )
    return results


def not_sung_section_names(results: list[dict[str, Any]]) -> list[str]:
    """Flat list of section names whose verdict is ``not_sung``."""
    return [str(item.get("name") or "") for item in results if item.get("status") == "not_sung"]
