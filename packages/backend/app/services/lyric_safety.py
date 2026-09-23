"""Lyric safety scanner: contamination + pronunciation hardening.

Ports the Preflight contamination-checker philosophy: engines sing EVERYTHING
in the lyrics field literally, so instruction prefaces, production-direction
words, and pronunciation-hostile patterns must be caught before paste.

Flag-for-review, never silently rewrite: findings carry a suggestion, the
caller decides. Bracketed section tags (``[Verse]``) are legitimate and are
stripped before scanning so they never trigger findings.

Pure logic (stdlib only) so it can run anywhere, including inside
``validate_output``.
"""

from __future__ import annotations

import re
from typing import Any, Optional

# Instruction / preface phrases that engines sing literally. Proven failure:
# "Do not change any words. Sing exactly as written." was sung verbatim in
# two Suno generations.
_INSTRUCTION_PATTERNS = (
    r"do not change any words",
    r"sing exactly as written",
    r"here are the lyrics",
    r"here is the (song|lyrics|track)",
    r"below (is|are) the lyrics",
    r"\bi('ve| have) written\b",
    r"\bas an ai\b",
    r"^of course,? here",
    r"^certainly,? here",
    r"^note:",
    r"^remember to\b",
    r"^make sure to\b",
    r"^keep in mind\b",
)
_INSTRUCTION_RE = re.compile("|".join(_INSTRUCTION_PATTERNS), re.IGNORECASE)

# Production-direction words that read as lyric content to the engine.
# The riddim/brostep set ("wobble", "growl bass", "reese") was caught by the
# user after "hear the wobble in my tone" passed unflagged and got sung.
_PRODUCTION_WORDS = (
    "wobble",
    "growl bass",
    "reese",
    "reese bass",
    "bpm",
    "time signature",
    "producer tag",
    "metronome",
    "count in",
    "count-in",
    "punch in",
    "punch-in",
    "sidechain",
    "bass drop",
    "beat drop",
)
_PRODUCTION_RES = [
    re.compile(rf"\b{re.escape(word)}\b", re.IGNORECASE)
    for word in _PRODUCTION_WORDS
]
_TAKE_RE = re.compile(r"\btake\s+\d+\b", re.IGNORECASE)  # "take 3"

_BRACKET_RE = re.compile(r"\[[^\]\n]*\]")
_ABBREV_RE = re.compile(r"\b(?:[A-Z]\.){2,}(?:[A-Z]\.?)?")


def _strip_tags(line: str) -> str:
    return _BRACKET_RE.sub("", line).strip()


def parse_bpm(value: Any) -> Optional[float]:
    """Pull a BPM number out of a brief tempo value like '140' or '140 BPM'."""
    if value is None:
        return None
    match = re.search(r"\d+(?:\.\d+)?", str(value))
    return float(match.group()) if match else None


def _is_caps_chant(line: str) -> bool:
    letters = [ch for ch in line if ch.isalpha()]
    return len(letters) >= 4 and all(ch.isupper() for ch in letters)


def scan_lyrics(
    lyrics: str,
    platform: str = "",
    bpm: Optional[float] = None,
) -> list[dict[str, Any]]:
    """Scan lyrics for contamination and pronunciation hazards.

    Returns a list of findings; each has ``kind``, ``line`` (1-based or
    None), ``text``, ``suggestion``, and a preformatted ``message``.
    ``platform`` is accepted for future per-engine rules and currently
    unused beyond plumbing.
    """
    del platform  # reserved for per-engine rules
    findings: list[dict[str, Any]] = []
    lines = lyrics.splitlines()

    def add(kind: str, line_no: Optional[int], text: str,
            suggestion: str, message: str) -> None:
        findings.append({
            "kind": kind,
            "line": line_no,
            "text": text,
            "suggestion": suggestion,
            "message": message,
        })

    for idx, raw in enumerate(lines, start=1):
        content = _strip_tags(raw)
        if not content:
            continue
        instruction = _INSTRUCTION_RE.search(content)
        if instruction:
            add(
                "instruction_text", idx, instruction.group(0).strip(),
                "Delete this line — it is not a lyric. Put directions in the Style field.",
                f"Lyric line {idx} looks like an instruction/preface "
                f"('{instruction.group(0).strip()}') — engines sing it literally. "
                "Delete it or move it to Style.",
            )
            continue  # an instruction line needs no further checks
        for pattern in _PRODUCTION_RES:
            hit = pattern.search(content)
            if hit:
                add(
                    "production_direction", idx, hit.group(0),
                    "Move production notes to the Style/prompt field, or reword the line.",
                    f"Production-direction word '{hit.group(0)}' in lyric line {idx} "
                    "may get sung — move it to Style or reword.",
                )
                break
        take_hit = _TAKE_RE.search(content)
        if take_hit:
            add(
                "production_direction", idx, take_hit.group(0),
                "Remove take markers from lyrics.",
                f"'{take_hit.group(0)}' in lyric line {idx} looks like a studio "
                "take marker — engines will sing it. Remove it.",
            )
        if _is_caps_chant(content):
            preview = content[:42] + ("..." if len(content) > 42 else "")
            add(
                "caps_chant", idx, preview,
                "Use mixed case; put delivery direction in [bracketed] section tags.",
                f"ALL-CAPS lyric line {idx} ('{preview}') risks chant/shout "
                "delivery — use mixed case and put direction in [tags].",
            )
        abbrev = _ABBREV_RE.search(content)
        if abbrev:
            plain = abbrev.group(0).replace(".", "")
            add(
                "abbreviation_periods", idx, abbrev.group(0),
                f"Write it without periods: {plain}.",
                f"Abbreviation '{abbrev.group(0)}' (line {idx}) with periods "
                f"stumbles — write '{plain}'.",
            )

    # Density heuristic: near-continuous vocals at high BPM slur.
    if bpm is not None and bpm >= 135:
        lyric_lines = [_strip_tags(raw) for raw in lines]
        lyric_lines = [line for line in lyric_lines if line]
        if len(lyric_lines) >= 12:
            avg_words = sum(len(line.split()) for line in lyric_lines) / len(lyric_lines)
            if avg_words > 9:
                add(
                    "dense_vocals", None, f"{len(lyric_lines)} lines, ~{avg_words:.0f} words/line",
                    "Add rests, breaks, or ad-lib space between phrases.",
                    f"Dense vocals at {bpm:g} BPM ({len(lyric_lines)} lines averaging "
                    f"~{avg_words:.0f} words) risk slurring — add rests/breaks.",
                )

    return findings
