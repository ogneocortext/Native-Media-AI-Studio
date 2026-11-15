"""Tests for the sung-truth diff (Step 5 S2, R2).

The headline fixture is the real one from the design doc: the Valley Phonk
lyric set has 8 sections / 32 lines, and its written Bridge was not sung in
the Extended V2 render. A transcript containing the other seven sections must
therefore return Bridge ``not_sung`` and the board must contain no Bridge scene.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import pytest

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.models.job import Job, JobType
from app.services import storyboard_generator
from app.services.storyboard_generator import (
    StoryboardGeneratorHandler,
    load_track_lyrics,
)
from app.services.storyboard_sung_diff import (
    LINE_MATCH_THRESHOLD,
    SECTION_SUNG_MIN_FRACTION,
    diff_sung_sections,
    line_is_sung,
    normalize_text,
    not_sung_section_names,
    transcript_word_set,
)

VALLEY_PHONK_ID = "unproductive-valley-phonk"


def _valley_sections() -> list[dict[str, Any]]:
    entry = load_track_lyrics(VALLEY_PHONK_ID)
    assert entry is not None, "the real Valley Phonk library entry must exist"
    return entry["sections"]


def _transcript_without(section_names: set[str]) -> dict[str, Any]:
    """Whisper-shaped transcript containing every line except the named sections."""
    segments = []
    for section in _valley_sections():
        if section["name"] in section_names:
            continue
        for index, line in enumerate(section["lines"]):
            segments.append(
                {
                    "start": float(index),
                    "end": float(index) + 1.0,
                    "text": line,
                }
            )
    return {"segments": segments}


# ---------------------------------------------------------------------------
# Pure-function behavior
# ---------------------------------------------------------------------------


def test_normalize_strips_punctuation_and_apostrophes() -> None:
    assert normalize_text("I'm unproductive, and free!") == ["im", "unproductive", "and", "free"]


def test_line_match_threshold_is_sixty_percent() -> None:
    assert LINE_MATCH_THRESHOLD == 0.6
    assert SECTION_SUNG_MIN_FRACTION == 0.5


def test_line_is_sung_uses_content_word_overlap() -> None:
    words = transcript_word_set({"segments": [{"text": "nothing to prove today"}]})
    assert line_is_sung("Nothing to prove today", words) is True
    assert line_is_sung("Voices in my head used to sound like deadlines", words) is False


def test_transcript_word_set_accepts_lines_shape() -> None:
    words = transcript_word_set({"lines": [{"text": "hello there"}, "second line"]})
    assert "hello" in words
    assert "second" in words


def test_diff_marks_a_sheet_only_section_not_sung() -> None:
    sections = [
        {"name": "Verse", "lines": ["nothing to prove today"]},
        {"name": "Bridge", "lines": ["voices in my head used to sound like deadlines"]},
    ]
    results = diff_sung_sections(sections, {"segments": [{"text": "nothing to prove today"}]})
    assert results[0]["status"] == "sung"
    assert results[0]["lines_total"] == 1
    assert results[0]["lines_sung"] == 1
    assert results[1]["status"] == "not_sung"
    assert results[1]["lines_sung"] == 0
    assert not_sung_section_names(results) == ["Bridge"]


# ---------------------------------------------------------------------------
# The real fixture (design doc section 5 / R2 receipt)
# ---------------------------------------------------------------------------


def test_valley_phonk_fixture_has_eight_sections_and_thirty_two_lines() -> None:
    sections = _valley_sections()
    assert len(sections) == 8
    assert sum(len(section["lines"]) for section in sections) == 32
    assert [section["name"] for section in sections].count("Bridge") == 1


def test_valley_phonk_bridge_is_not_sung_when_transcript_omits_it() -> None:
    sections = _valley_sections()
    transcript = _transcript_without({"Bridge"})
    results = diff_sung_sections(sections, transcript)

    by_name = {item["name"]: item for item in results if item["name"] != "Bridge"}
    bridge = [item for item in results if item["name"] == "Bridge"]
    assert len(bridge) == 1
    assert bridge[0]["status"] == "not_sung"
    assert bridge[0]["lines_total"] == 4
    # Only a minority of the Bridge's lines clear the 60% word-overlap bar.
    assert bridge[0]["lines_sung"] < bridge[0]["lines_total"] * SECTION_SUNG_MIN_FRACTION
    assert all(item["status"] == "sung" for item in by_name.values())
    assert not_sung_section_names(results) == ["Bridge"]


def test_whisper_noise_still_matches_above_threshold() -> None:
    """Garbled, partial Whisper-style words keep a section above the threshold."""
    sections = [
        {
            "name": "Hook",
            "lines": [
                "Nothing to prove today",
                "I'm unproductive and free",
                "Doing nothing beautifully",
                "I'm unproductive and free",
            ],
        }
    ]
    noisy = {
        "segments": [
            {"text": "uhh nuthin to prove today"},
            {"text": "um unproductive and freee"},
            {"text": "doin nuthin beautiful"},
            {"text": "mm unproductive and free"},
        ]
    }
    results = diff_sung_sections(sections, noisy)
    assert results[0]["status"] == "sung"
    assert results[0]["lines_sung"] >= 2


# ---------------------------------------------------------------------------
# Generator wiring
# ---------------------------------------------------------------------------


class SectionAdapter:
    """Fake adapter returning one richly-described scene per section."""

    def __init__(self, count: int) -> None:
        self.count = count
        self.calls: list[dict[str, Any]] = []

    def get_default_model(self) -> str:
        return "fake-model"

    async def generate_with_fallback(self, params: dict[str, Any]) -> dict[str, Any]:
        self.calls.append(params)
        return {
            "theme": params.get("prompt", ""),
            "scenes": [
                {"title": f"Shot {index + 1}", "description": f"Visual {index + 1}"}
                for index in range(self.count)
            ],
            "total_scenes": self.count,
            "estimated_duration_seconds": 32.0,
            "style": "cinematic",
            "transitions": [],
            "model_used": "fake-model",
        }


def _grid_job(transcript: dict[str, Any] | None, track_lyrics_id: str | None) -> Job:
    sections = _valley_sections()
    # 64 beats at 120 BPM = 32 s; eight beats (4 s) per section.
    beat_times = [index * 0.5 for index in range(64)]
    analysis_sections = []
    for index, section in enumerate(sections):
        analysis_sections.append(
            {
                "name": section["name"],
                "start": index * 4.0,
                "end": (index + 1) * 4.0,
            }
        )
    params: dict[str, Any] = {
        "theme": "unproductive",
        "analysis": {
            "bpm": 120.0,
            "beat_times": beat_times,
            "downbeats": [],
            "sections": analysis_sections,
            "source": "studio-tracker",
        },
    }
    if track_lyrics_id is not None:
        params["track_lyrics_id"] = track_lyrics_id
    if transcript is not None:
        params["transcript"] = transcript
    return Job(job_type=JobType.STORYBOARD_GENERATION, params=params)


@pytest.fixture()
def isolated_output(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(storyboard_generator, "OUTPUT_DIR", tmp_path)
    monkeypatch.setattr(storyboard_generator, "go_write_sidecar", lambda *a, **k: _async_none())
    return tmp_path


async def _async_none() -> None:
    return None


def _read_board(output_dir: Path) -> dict[str, Any]:
    files = list(output_dir.glob("*.json"))
    assert len(files) == 1
    return json.loads(files[0].read_text(encoding="utf-8"))


async def test_board_drops_the_not_sung_bridge_scene(isolated_output: Path) -> None:
    handler = StoryboardGeneratorHandler(adapter=SectionAdapter(count=8))
    job = _grid_job(_transcript_without({"Bridge"}), VALLEY_PHONK_ID)

    await handler.process_job(job)
    board = _read_board(isolated_output)

    assert board["sections_not_sung"] == ["Bridge"]
    scenes = board["scenes"]
    assert len(scenes) == 7
    assert all(scene["section"] != "Bridge" for scene in scenes)
    # No Bridge text survives anywhere in the board.
    assert "Voices in my head" not in json.dumps(board)
    # Every retained section carries a status, and the Bridge is marked in data.
    statuses = {section["name"]: section["status"] for section in board["sections"]}
    assert statuses["Bridge"] == "not_sung"
    assert statuses["Hook"] == "sung"


async def test_missing_transcript_keeps_post_s1_behavior(isolated_output: Path) -> None:
    handler = StoryboardGeneratorHandler(adapter=SectionAdapter(count=8))
    job = _grid_job(None, VALLEY_PHONK_ID)

    await handler.process_job(job)
    board = _read_board(isolated_output)

    assert "sections_not_sung" not in board
    assert len(board["scenes"]) == 8
    assert all("status" not in section for section in board["sections"])


async def test_missing_track_lyrics_id_keeps_post_s1_behavior(isolated_output: Path) -> None:
    handler = StoryboardGeneratorHandler(adapter=SectionAdapter(count=8))
    job = _grid_job(_transcript_without({"Bridge"}), None)

    await handler.process_job(job)
    board = _read_board(isolated_output)

    assert "sections_not_sung" not in board
    assert len(board["scenes"]) == 8
