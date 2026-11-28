"""Canonical storyboard board store: one editable JSON board per track.

Boards historically lived in three places at once -- a Markdown treatment
whose Overview Map table the Storyboards page parses, a ``sequences`` JSON
authoring file no backend code consumes, and the HyperFrames compiler's own
``scenes`` shape. This module is the single store the page edits:

- Saved boards live as JSON under ``storage/storyboards/<slug>.json``
  (gitignored runtime state, same pattern as the Room store).
- Seed boards are converted on the fly from the repo's authored files in
  ``docs/visual-storytelling/`` until the owner saves an edited copy.
- The saved/returned shape is the compiler's board shape (``scenes`` list),
  extended with the authoring fields the JSON boards carry (``camera_text``,
  ``palette_text``, ``typography``, ``transition``, ``blender``) so direction
  survives the round trip instead of being dropped at compile time.

Validation mirrors the compiler's timing rules (``storyboard_hyperframes``):
times are absolute seconds, ``end`` must exceed ``start``, and scenes may
not overlap. A board that fails validation is refused, never repaired
silently.
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..core.config import PROJECT_ROOT

BOARDS_DIR = PROJECT_ROOT / "storage" / "storyboards"
SEED_DIR = PROJECT_ROOT / "docs" / "visual-storytelling"

_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")

# Seed boards known to the store, keyed by slug. ``json`` is the authored
# sequences-format file when one exists; ``markdown`` is the treatment doc.
_SEEDS: dict[str, dict[str, str]] = {
    "still-i-rise": {"json": "STORYBOARD_StillIRise.json", "markdown": "STORYBOARD_StillIRise.md"},
    "take-the-crown": {"markdown": "STORYBOARD_TakeTheCrown.md"},
}

_SEED_TITLES: dict[str, str] = {
    "still-i-rise": "Still I Rise",
    "take-the-crown": "Take the Crown",
}


def _is_slug(value: str) -> bool:
    return bool(_SLUG_RE.match(value or ""))


def _board_path(slug: str) -> Path:
    return BOARDS_DIR / f"{slug}.json"


# --- Conversion -----------------------------------------------------------


def convert_sequences_board(raw: dict[str, Any], slug: str) -> dict[str, Any]:
    """Convert an authored ``sequences`` JSON board to the canonical shape.

    Field mapping is lossless for direction data: the camera directive
    string is preserved as ``camera_text`` (the compiler's ``camera`` field
    is a dict it currently never renders; the string is the authored
    direction and must not be dropped), lyrics become ``lyric_lines``, and
    palette strings become ``palette_text``.
    """
    scenes: list[dict[str, Any]] = []
    for seq in raw.get("sequences", []):
        if not isinstance(seq, dict):
            continue
        visual = str(seq.get("visual") or "")
        scene: dict[str, Any] = {
            "id": str(seq.get("id") or f"scene-{len(scenes) + 1}"),
            "section": str(seq.get("section") or ""),
            "start": float(seq.get("start") or 0),
            "end": float(seq.get("end") or 0),
            "lyric_lines": [str(line) for line in seq.get("lyrics", [])],
            "visual": visual,
            "description": visual,
            "camera_text": str(seq.get("camera") or ""),
            "palette_text": str(seq.get("palette") or ""),
            "typography": str(seq.get("typography") or ""),
            "transition": str(seq.get("transition") or ""),
            "blender": str(seq.get("blender") or ""),
        }
        scenes.append(scene)
    title = str(raw.get("title") or _SEED_TITLES.get(slug, slug))
    return {
        "slug": slug,
        "title": title,
        "track": _SEED_TITLES.get(slug, title),
        "duration": float(raw.get("duration") or (scenes[-1]["end"] if scenes else 0)),
        "fps": raw.get("fps"),
        "bpm": raw.get("bpm"),
        "key": raw.get("key"),
        "transitions": raw.get("transitions", []),
        "scenes": scenes,
        "source_format": "sequences-json",
    }


def _parse_timecode(value: str) -> float:
    """Seconds from ``M:SS`` (or a plain number string); 0 when unparsable."""
    value = (value or "").strip()
    if ":" in value:
        minutes, _, seconds = value.partition(":")
        try:
            return float(minutes) * 60 + float(seconds)
        except ValueError:
            return 0.0
    try:
        return float(value)
    except ValueError:
        return 0.0


def _parse_duration(value: str) -> float:
    """Seconds from a duration cell like ``6s``, ``6``, or ``0:06``."""
    value = (value or "").strip().rstrip("s")
    return _parse_timecode(value)


def convert_markdown_board(text: str, slug: str) -> dict[str, Any]:
    """Convert a treatment Markdown board via its Overview Map table.

    Uses the same table contract the Storyboards page has always parsed
    (SEQ / SECTION / timecode range / duration / lyric / visual /
    technique), so a converted board matches what the page showed.
    """
    scenes: list[dict[str, Any]] = []
    in_overview = False
    for line in text.split("\n"):
        if "## Overview Map" in line:
            in_overview = True
            continue
        if in_overview and line.startswith("#"):
            in_overview = False
            continue
        if not in_overview or not line.startswith("|"):
            continue
        if "SEQ" in line or "---" in line:
            continue
        cells = [c.strip() for c in line.split("|")]
        cells = [c for c in cells if c]
        if len(cells) < 7:
            continue
        seq, section, timecode, duration, lyric, visual, technique = cells[:7]
        start = _parse_timecode(timecode.split("-")[0].split("–")[0])
        dur = _parse_duration(duration)
        end = start + dur
        if scenes and start == 0 and dur > 0:
            start = scenes[-1]["end"]
            end = start + dur
        scenes.append(
            {
                "id": seq,
                "section": section,
                "start": start,
                "end": end,
                "lyric_lines": [lyric] if lyric else [],
                "visual": visual,
                "description": visual,
                "technique": technique,
            }
        )
    title = _SEED_TITLES.get(slug, slug)
    return {
        "slug": slug,
        "title": title,
        "track": title,
        "duration": scenes[-1]["end"] if scenes else 0,
        "scenes": scenes,
        "source_format": "markdown",
    }


# --- Validation -----------------------------------------------------------


def validate_board(board: Any) -> list[str]:
    """Return validation errors for a candidate board; empty means valid."""
    if not isinstance(board, dict):
        return ["board must be an object"]
    scenes = board.get("scenes")
    if not isinstance(scenes, list) or not scenes:
        return ["board must contain a non-empty scenes list"]
    errors: list[str] = []
    seen_ids: set[str] = set()
    previous_end = 0.0
    for index, scene in enumerate(scenes):
        if not isinstance(scene, dict):
            errors.append(f"scene {index} must be an object")
            continue
        scene_id = str(scene.get("id") or "")
        if scene_id and scene_id in seen_ids:
            errors.append(f"duplicate scene id: {scene_id}")
        seen_ids.add(scene_id)
        start, end = scene.get("start"), scene.get("end")
        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
            errors.append(f"scene {index} needs numeric start and end")
            continue
        if start < 0 or end <= start:
            errors.append(f"scene {index} has invalid timing ({start}..{end})")
        if start < previous_end - 0.001:
            errors.append(f"scene {index} overlaps the previous scene")
        previous_end = max(previous_end, float(end))
    return errors


# --- Store ----------------------------------------------------------------


def _seed_board(slug: str) -> dict[str, Any] | None:
    seed = _SEEDS.get(slug)
    if seed is None:
        return None
    json_name = seed.get("json")
    if json_name:
        json_path = SEED_DIR / json_name
        if json_path.exists():
            try:
                return convert_sequences_board(json.loads(json_path.read_text(encoding="utf-8")), slug)
            except (ValueError, OSError):
                pass
    md_name = seed.get("markdown")
    if md_name:
        md_path = SEED_DIR / md_name
        if md_path.exists():
            try:
                return convert_markdown_board(md_path.read_text(encoding="utf-8"), slug)
            except OSError:
                return None
    return None


def list_boards() -> list[dict[str, Any]]:
    """Summaries for every known board; a saved board shadows its seed."""
    summaries: dict[str, dict[str, Any]] = {}
    for slug in _SEEDS:
        board = _seed_board(slug)
        if board is not None:
            summaries[slug] = _summary(board, "seed")
    if BOARDS_DIR.exists():
        for path in sorted(BOARDS_DIR.glob("*.json")):
            slug = path.stem
            if not _is_slug(slug):
                continue
            try:
                board = json.loads(path.read_text(encoding="utf-8"))
            except (ValueError, OSError):
                continue
            if isinstance(board, dict):
                summaries[slug] = _summary(board, "saved")
    return [summaries[slug] for slug in sorted(summaries)]


def _summary(board: dict[str, Any], source: str) -> dict[str, Any]:
    scenes = board.get("scenes") or []
    return {
        "slug": str(board.get("slug") or ""),
        "title": str(board.get("title") or ""),
        "track": str(board.get("track") or ""),
        "scene_count": len(scenes),
        "duration": board.get("duration"),
        "source": source,
        "updated_at": board.get("updated_at"),
    }


def load_board(slug: str) -> dict[str, Any] | None:
    """The saved board for ``slug``, or its converted seed, or None."""
    if not _is_slug(slug):
        return None
    path = _board_path(slug)
    if path.exists():
        try:
            board = json.loads(path.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            board = None
        if isinstance(board, dict):
            return board
    return _seed_board(slug)


def save_board(slug: str, board: dict[str, Any]) -> dict[str, Any]:
    """Validate and atomically store ``board`` under ``slug``.

    Raises ValueError with the joined validation errors when the board is
    not storable; the caller turns that into a 400.
    """
    if not _is_slug(slug):
        raise ValueError(f"invalid board slug: {slug!r}")
    errors = validate_board(board)
    if errors:
        raise ValueError("; ".join(errors))
    stored = dict(board)
    stored["slug"] = slug
    stored["updated_at"] = datetime.now(timezone.utc).isoformat()
    BOARDS_DIR.mkdir(parents=True, exist_ok=True)
    path = _board_path(slug)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(stored, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)
    return stored
