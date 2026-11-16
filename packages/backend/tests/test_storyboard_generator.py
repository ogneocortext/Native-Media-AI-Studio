"""Tests for the storyboard generator's measured-grid input (Step 5 S1, R1)."""

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
    derive_scene_times,
    detect_bpm_conflict,
    validate_grid,
)

LEGACY_BOARD_KEYS = {
    "job_id",
    "theme",
    "generated_at",
    "scenes",
    "total_scenes",
    "estimated_duration_seconds",
    "style",
    "transitions",
    "model_used",
    "mock",
}


class FakeAdapter:
    """Deterministic stand-in for OllamaAdapter (no service, no network)."""

    def __init__(self, scenes: list[dict[str, Any]] | None = None) -> None:
        self.scenes = scenes or [
            {"title": "Opening", "description": "A wide desert"},
            {"title": "Payoff", "description": "Neon skyline"},
        ]
        self.calls: list[dict[str, Any]] = []

    def get_default_model(self) -> str:
        return "fake-model"

    async def generate_with_fallback(self, params: dict[str, Any]) -> dict[str, Any]:
        self.calls.append(params)
        return {
            "theme": params.get("prompt", ""),
            "scenes": [dict(scene) for scene in self.scenes],
            "total_scenes": len(self.scenes),
            "estimated_duration_seconds": 10.0,
            "style": "cinematic",
            "transitions": ["cut"],
            "model_used": "fake-model",
        }


def _job(params: dict[str, Any]) -> Job:
    return Job(job_type=JobType.STORYBOARD_GENERATION, params=params)


def _beat_grid(bpm: float, count: int = 8) -> list[float]:
    interval = 60.0 / bpm
    return [index * interval for index in range(count)]


@pytest.fixture()
def isolated_output(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(storyboard_generator, "OUTPUT_DIR", tmp_path)
    monkeypatch.setattr(
        storyboard_generator,
        "go_write_sidecar",
        lambda *args, **kwargs: _async_none(),
    )
    return tmp_path


async def _async_none() -> None:
    return None


def _read_board(output_dir: Path) -> dict[str, Any]:
    files = list(output_dir.glob("*.json"))
    assert len(files) == 1, f"expected one board file, got {files}"
    return json.loads(files[0].read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Grid validation
# ---------------------------------------------------------------------------


def test_validate_grid_accepts_a_consistent_grid() -> None:
    result = validate_grid(120.0, _beat_grid(120.0), [0, 4])
    assert result["ok"] is True
    assert result["bpm"] == 120.0
    assert result["beat_count"] == 8
    assert result["downbeat_count"] == 2
    assert result["grid_sec"] == pytest.approx(3.5)
    assert result["conflict_warnings"] == []


def test_validate_grid_rejects_non_monotonic_beat_times() -> None:
    with pytest.raises(ValueError, match="monotonically increasing"):
        validate_grid(120.0, [0.0, 0.5, 0.4, 1.0], [])


def test_validate_grid_rejects_out_of_range_downbeat() -> None:
    with pytest.raises(ValueError, match="out of range"):
        validate_grid(120.0, _beat_grid(120.0), [99])


def test_validate_grid_rejects_short_grid() -> None:
    with pytest.raises(ValueError, match="at least 2 beats"):
        validate_grid(120.0, [0.0], [])


def test_validate_grid_rejects_implied_bpm_mismatch() -> None:
    # 0.5 s intervals imply 120 BPM; the job claims 150.
    with pytest.raises(ValueError, match="implied BPM"):
        validate_grid(150.0, _beat_grid(120.0), [])


# ---------------------------------------------------------------------------
# Conflict detection (design doc section 5, the Unproductive case)
# ---------------------------------------------------------------------------


def test_detect_bpm_conflict_flags_the_unproductive_case() -> None:
    # Library files 136 (Flow v1); the Extended V2 render measured 123.0.
    assert detect_bpm_conflict(123.0, 136.0) is True


def test_detect_bpm_conflict_clears_matching_bpms() -> None:
    assert detect_bpm_conflict(123.0, 123.0) is False
    assert detect_bpm_conflict(123.0, 124.0) is False  # within +/-2
    assert detect_bpm_conflict(123.0, 125.1) is True


def test_detect_bpm_conflict_without_library_bpm_is_false() -> None:
    assert detect_bpm_conflict(123.0, None) is False


# ---------------------------------------------------------------------------
# Scene timing derivation
# ---------------------------------------------------------------------------


def test_derive_scene_times_snaps_to_exact_beat_times() -> None:
    beats = _beat_grid(120.0)
    sections = [
        {"name": "Intro", "start": 0.0, "end": 1.0},
        {"name": "Hook", "start": 1.0, "end": 2.5},
    ]
    derived = derive_scene_times(sections, beats)
    assert derived[0]["start_beat"] == 0
    assert derived[0]["end_beat"] == 2
    assert derived[0]["start_sec"] == beats[0]
    assert derived[0]["end_sec"] == beats[2]
    assert derived[1]["start_beat"] == 2
    assert derived[1]["end_beat"] == 5
    assert derived[1]["start_sec"] == beats[2]
    assert derived[1]["end_sec"] == beats[5]
    # The original section fields survive.
    assert derived[1]["name"] == "Hook"


def test_derive_scene_times_picks_the_closest_beat() -> None:
    beats = _beat_grid(120.0)  # 0.0, 0.5, 1.0, ...
    derived = derive_scene_times([{"name": "X", "start": 0.74, "end": 0.76}], beats)
    # 0.74 is nearer 0.5 (0.24) than 1.0 (0.26).
    assert derived[0]["start_beat"] == 1
    assert derived[0]["start_sec"] == beats[1]


# ---------------------------------------------------------------------------
# Job-level behavior
# ---------------------------------------------------------------------------


async def test_analysis_job_produces_a_grid_anchored_board(isolated_output: Path) -> None:
    adapter = FakeAdapter()
    handler = StoryboardGeneratorHandler(adapter=adapter)
    beats = _beat_grid(120.0)
    job = _job(
        {
            "theme": "night drive",
            "analysis": {
                "bpm": 120.0,
                "beat_times": beats,
                "downbeats": [0, 4],
                "sections": [
                    {"name": "Intro", "start": 0.0, "end": 1.0},
                    {"name": "Hook", "start": 1.0, "end": 2.5},
                ],
                "source": "studio-tracker",
            },
        }
    )

    response = await handler.process_job(job)
    board = _read_board(isolated_output)

    assert response["bpm"] == 120.0
    assert response["bpm_conflict"] is False
    assert board["bpm"] == 120.0
    assert board["bpm_conflict"] is False
    assert board["grid_source"] == "studio-tracker"
    assert board["beat_times"] == beats
    assert board["downbeats"] == [0, 4]
    assert len(board["sections"]) == 2

    # Every scene's absolute times are the exact beat times at its beat indexes.
    for scene in board["scenes"]:
        assert scene["start_sec"] == beats[scene["start_beat"]]
        assert scene["end_sec"] == beats[scene["end_beat"]]
        assert scene["start"] == scene["start_sec"]
        assert scene["end"] == scene["end_sec"]

    # The LLM still supplies description text; the grid owns the timing.
    assert board["scenes"][0]["description"] == "A wide desert"
    assert board["scenes"][0]["section"] == "Intro"
    assert board["scenes"][1]["section"] == "Hook"


async def test_library_bpm_conflict_reaches_the_board(isolated_output: Path) -> None:
    handler = StoryboardGeneratorHandler(adapter=FakeAdapter())
    beats = _beat_grid(123.0)
    job = _job(
        {
            "theme": "unproductive",
            "track_lyrics_id": "unproductive-valley-phonk",
            "analysis": {
                "bpm": 123.0,
                "beat_times": beats,
                "downbeats": [],
                "sections": [{"name": "Intro", "start": 0.0, "end": 60.0 / 123.0}],
                "source": "studio-tracker",
            },
        }
    )

    await handler.process_job(job)
    board = _read_board(isolated_output)

    # The library entry files 136; the measured grid is 123.0 (design doc section 5).
    assert board["bpm"] == 123.0
    assert board["bpm_conflict"] is True
    assert "library" in board["bpm_conflict_sources"]


async def test_metadata_bpm_conflict_reaches_the_board(isolated_output: Path) -> None:
    handler = StoryboardGeneratorHandler(adapter=FakeAdapter())
    job = _job(
        {
            "theme": "x",
            "metadata_bpm": 136.0,
            "analysis": {
                "bpm": 123.0,
                "beat_times": _beat_grid(123.0),
                "downbeats": [],
                "sections": [{"name": "Intro", "start": 0.0, "end": 1.0}],
                "source": "file-tags",
            },
        }
    )

    await handler.process_job(job)
    board = _read_board(isolated_output)
    assert board["bpm_conflict"] is True
    assert "metadata" in board["bpm_conflict_sources"]


async def test_legacy_job_keeps_the_pre_s1_board_shape(isolated_output: Path) -> None:
    handler = StoryboardGeneratorHandler(adapter=FakeAdapter())
    job = _job({"theme": "a creative story", "num_scenes": 2})

    response = await handler.process_job(job)
    board = _read_board(isolated_output)

    assert set(board) == LEGACY_BOARD_KEYS
    assert "bpm" not in response
    assert "bpm_conflict" not in response
    assert "panels_generated" not in response
    # LLM scenes pass through with lifecycle state stamped (S4); no grid fields.
    assert board["scenes"][0] == {
        "title": "Opening",
        "description": "A wide desert",
        "state": "planned",
    }
    assert "start_beat" not in board["scenes"][0]
    assert "start" not in board["scenes"][0]


async def test_invalid_grid_fails_the_job_with_the_named_check(isolated_output: Path) -> None:
    handler = StoryboardGeneratorHandler(adapter=FakeAdapter())
    job = _job(
        {
            "theme": "x",
            "analysis": {
                "bpm": 120.0,
                "beat_times": [0.0, 0.5, 0.4],
                "downbeats": [],
                "sections": [],
            },
        }
    )

    with pytest.raises(ValueError, match="monotonically increasing"):
        await handler.process_job(job)
    assert not list(isolated_output.glob("*.json"))


# ---------------------------------------------------------------------------
# S3: scene schema + characters + place_theme
# ---------------------------------------------------------------------------


def _valley_analysis() -> dict[str, Any]:
    entry = storyboard_generator.load_track_lyrics("unproductive-valley-phonk")
    assert entry is not None
    sections = entry["sections"]
    return {
        "bpm": 120.0,
        "beat_times": [index * 0.5 for index in range(64)],
        "downbeats": [],
        "sections": [
            {"name": section["name"], "start": index * 4.0, "end": (index + 1) * 4.0}
            for index, section in enumerate(sections)
        ],
        "source": "studio-tracker",
    }


async def test_lyric_lines_are_derived_from_library_sections(isolated_output: Path) -> None:
    handler = StoryboardGeneratorHandler(adapter=FakeAdapter())
    job = _job(
        {
            "theme": "unproductive",
            "track_lyrics_id": "unproductive-valley-phonk",
            "analysis": _valley_analysis(),
        }
    )

    await handler.process_job(job)
    board = _read_board(isolated_output)

    verse1 = next(scene for scene in board["scenes"] if scene["section"] == "Verse 1")
    assert len(verse1["lyric_lines"]) == 7
    assert verse1["lyric_lines"][0] == {"section": "Verse 1", "index": 0}
    assert verse1["lyric_lines"][-1] == {"section": "Verse 1", "index": 6}
    assert board["enrichment_report"]["lyric_lines_attached"] == 32


async def test_character_ref_attaches_to_a_named_scene(isolated_output: Path) -> None:
    handler = StoryboardGeneratorHandler(
        adapter=FakeAdapter(
            scenes=[{"title": "Sol in the monsoon", "description": "Sol walks the wet street"}]
        )
    )
    job = _job(
        {
            "theme": "Sol",
            "characters": [
                {
                    "name": "Sol",
                    "asset": "characters/sol.png",
                    "identity_checklist": ["freckles", "sunglasses", "hoop earring"],
                    "off_axis": True,
                }
            ],
        }
    )

    await handler.process_job(job)
    board = _read_board(isolated_output)

    assert board["characters"][0]["asset"] == "characters/sol.png"
    ref = board["scenes"][0]["character_ref"]
    assert ref == {
        "asset": "characters/sol.png",
        "identity_checklist": ["freckles", "sunglasses", "hoop earring"],
        "off_axis": True,
    }
    assert board["enrichment_report"]["character_refs_attached"] == 1


async def test_llm_character_ref_is_overwritten_by_the_roster(isolated_output: Path) -> None:
    handler = StoryboardGeneratorHandler(
        adapter=FakeAdapter(
            scenes=[
                {
                    "title": "Sol close",
                    "description": "Sol looks away",
                    "character_ref": {"asset": "invented.png"},
                }
            ]
        )
    )
    job = _job(
        {
            "theme": "x",
            "characters": [
                {"name": "Sol", "asset": "sol.png", "identity_checklist": [], "off_axis": False}
            ],
        }
    )

    await handler.process_job(job)
    board = _read_board(isolated_output)
    assert board["scenes"][0]["character_ref"]["asset"] == "sol.png"


async def test_unmatched_character_stays_absent_and_is_counted(isolated_output: Path) -> None:
    handler = StoryboardGeneratorHandler(
        adapter=FakeAdapter(
            scenes=[{"title": "A wide desert", "description": "Empty highway at dusk"}]
        )
    )
    job = _job(
        {
            "theme": "x",
            "characters": [
                {"name": "Sol", "asset": "sol.png", "identity_checklist": [], "off_axis": True},
                {"name": "Mae", "asset": "mae.png", "identity_checklist": [], "off_axis": False},
            ],
        }
    )

    await handler.process_job(job)
    board = _read_board(isolated_output)
    assert "character_ref" not in board["scenes"][0]
    assert board["enrichment_report"]["character_refs_unmatched"] == 1


async def test_place_theme_reaches_the_prompt_and_board(isolated_output: Path) -> None:
    adapter = FakeAdapter()
    handler = StoryboardGeneratorHandler(adapter=adapter)
    job = _job({"theme": "night drive", "place_theme": "Route 66 at night"})

    await handler.process_job(job)
    board = _read_board(isolated_output)

    assert board["place_theme"] == "Route 66 at night"
    assert "Route 66 at night" in adapter.calls[0]["prompt"]


async def test_underivable_schema_fields_stay_absent(isolated_output: Path) -> None:
    handler = StoryboardGeneratorHandler(adapter=FakeAdapter())
    job = _job(
        {
            "theme": "x",
            "analysis": {
                "bpm": 120.0,
                "beat_times": _beat_grid(120.0),
                "downbeats": [],
                "sections": [{"name": "Intro", "start": 0.0, "end": 1.0}],
                "source": "studio-tracker",
            },
        }
    )

    await handler.process_job(job)
    board = _read_board(isolated_output)
    scene = board["scenes"][0]
    assert "character_ref" not in scene
    assert "lyric_lines" not in scene
    assert "framing" not in scene
    assert "source_aspect" not in scene
    assert "accent" not in scene


# ---------------------------------------------------------------------------
# S4: panel lifecycle
# ---------------------------------------------------------------------------


async def test_llm_supplied_lifecycle_state_is_discarded(isolated_output: Path) -> None:
    handler = StoryboardGeneratorHandler(
        adapter=FakeAdapter(
            scenes=[
                {
                    "title": "Opening",
                    "description": "A wide desert",
                    "state": "accepted",
                    "reject_reason": "LLM invented this",
                }
            ]
        )
    )
    job = _job({"theme": "x"})

    await handler.process_job(job)
    board = _read_board(isolated_output)

    assert board["scenes"][0]["state"] == "planned"
    assert "reject_reason" not in board["scenes"][0]


async def test_panel_images_mark_matching_scenes_generated(isolated_output: Path) -> None:
    handler = StoryboardGeneratorHandler(adapter=FakeAdapter())
    job = _job(
        {
            "theme": "x",
            "panel_images": {"scene-1": "panels/one.png", "scene-9": "panels/missing.png"},
        }
    )

    response = await handler.process_job(job)
    board = _read_board(isolated_output)

    assert board["scenes"][0]["state"] == "generated"
    assert board["scenes"][0]["panel_image"] == "panels/one.png"
    assert board["scenes"][1]["state"] == "planned"
    assert "panel_image" not in board["scenes"][1]
    assert board["panel_images_unmatched"] == 1
    assert response["panels_generated"] == 1
