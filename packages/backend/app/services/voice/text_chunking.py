"""Sentence-boundary chunking for F5-TTS synthesis.

F5-TTS generates at most ~30 s of audio per pass (reference + generated
audio share that budget), so long scripts are split at sentence boundaries
and synthesized chunk-by-chunk, then concatenated by the wrapper. Callers
are expected to send Shorts-length scripts (~30 s); the totals below are
the enforced contract, not a suggestion.
"""

from __future__ import annotations

import re

#: One inference pass covers reference audio (~≤12 s) + generated audio inside
#: a ~30 s window, so ~20 s of speech per chunk is the safe ceiling. At a
#: typical ~14–16 chars/s speaking rate that is roughly 300–380 characters.
DEFAULT_MAX_CHUNK_CHARS = 380

#: Hard cap on the whole request. ~4000 chars ≈ 60–90 s of speech — well past
#: a Shorts script, and it bounds job runtime on the 1070 Ti.
DEFAULT_MAX_TOTAL_CHARS = 4000

#: Sentence enders: ASCII terminal punctuation followed by whitespace, or
#: CJK terminators (no whitespace needed).
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?…])\s+|(?<=[。！？])")
#: Clause-level fallback for over-long sentences.
_CLAUSE_SPLIT = re.compile(r"(?<=[,;:—–-])\s+|(?<=[，；：、])")


def _hard_split(segment: str, max_chars: int) -> list[str]:
    """Split *segment* at word boundaries; hard-cut only as a last resort."""
    out: list[str] = []
    rest = segment.strip()
    while len(rest) > max_chars:
        window = rest[: max_chars + 1]
        cut = window.rfind(" ")
        if cut <= 0:
            cut = max_chars
        out.append(rest[:cut].strip())
        rest = rest[cut:].strip()
    if rest:
        out.append(rest)
    return out


def _split_oversized(sentence: str, max_chars: int) -> list[str]:
    """Break a sentence that alone exceeds *max_chars* at clause boundaries."""
    pieces = [p.strip() for p in _CLAUSE_SPLIT.split(sentence) if p.strip()]
    if len(pieces) <= 1:
        return _hard_split(sentence, max_chars)
    out: list[str] = []
    cur = ""
    for piece in pieces:
        candidate = f"{cur} {piece}".strip() if cur else piece
        if len(candidate) <= max_chars:
            cur = candidate
        else:
            if cur:
                out.append(cur)
            cur = piece if len(piece) <= max_chars else ""
            if not cur:
                out.extend(_hard_split(piece, max_chars))
    if cur:
        out.append(cur)
    return out


def chunk_text(
    text: str,
    *,
    max_chunk_chars: int = DEFAULT_MAX_CHUNK_CHARS,
    max_total_chars: int = DEFAULT_MAX_TOTAL_CHARS,
) -> list[str]:
    """Split *text* into synthesis-sized chunks at sentence boundaries.

    Returns a non-empty list of stripped chunks, each ≤ ``max_chunk_chars``
    (except pathological no-whitespace input, which is hard-cut). Raises
    ``ValueError`` for empty text or text over ``max_total_chars``.
    """
    cleaned = re.sub(r"\s+", " ", text or "").strip()
    if not cleaned:
        raise ValueError("text is empty")
    if len(cleaned) > max_total_chars:
        raise ValueError(
            f"text too long: {len(cleaned)} chars exceeds the "
            f"{max_total_chars}-char limit (~60–90 s of speech)"
        )

    sentences = [s.strip() for s in _SENTENCE_SPLIT.split(cleaned) if s.strip()]
    chunks: list[str] = []
    cur = ""
    for sentence in sentences:
        if len(sentence) > max_chunk_chars:
            if cur:
                chunks.append(cur)
                cur = ""
            chunks.extend(_split_oversized(sentence, max_chunk_chars))
            continue
        candidate = f"{cur} {sentence}".strip() if cur else sentence
        if len(candidate) <= max_chunk_chars:
            cur = candidate
        else:
            chunks.append(cur)
            cur = sentence
    if cur:
        chunks.append(cur)
    return chunks
