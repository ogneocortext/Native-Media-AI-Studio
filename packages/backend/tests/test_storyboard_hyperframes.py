"""Tests for the storyboard-to-HyperFrames compiler."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services.storyboard_hyperframes import build_hyperframes_audio_payload, compile_storyboard


def test_compile_storyboard_writes_html_and_manifest(tmp_path: Path) -> None:
    result = compile_storyboard(
        {"track": "Demo", "duration": 5, "scenes": [
            {"id": "intro", "start": 0, "end": 2, "title": "Intro", "palette": {"base": "#000", "primary": "#123"}},
            {"id": "outro", "start": 2, "end": 5, "title": "Outro", "description": "Final image"},
        ]},
        tmp_path,
        name="Demo Track",
    )
    assert result.scene_count == 2
    assert result.composition_path.name == "demo-track.html"
    assert result.composition_path.exists()
    manifest = json.loads(result.manifest_path.read_text(encoding="utf-8"))
    assert manifest["scene_count"] == 2
    assert "STORYBOARD" in result.composition_path.read_text(encoding="utf-8")


def test_compile_storyboard_accepts_ollama_duration_contract(tmp_path: Path) -> None:
    result = compile_storyboard({"duration": 7, "scenes": [
        {"scene_number": 1, "title": "Opening", "description": "Setup", "duration_seconds": 3},
        {"scene_number": 2, "title": "Payoff", "description": "Resolution", "duration_seconds": 4},
    ]}, tmp_path)
    assert result.duration_seconds == 7
    manifest = json.loads(result.manifest_path.read_text(encoding="utf-8"))
    assert manifest["scenes"][1]["start"] == 3


def test_build_hyperframes_audio_payload_is_deterministic() -> None:
    payload = build_hyperframes_audio_payload(
        {"duration_seconds": 1.0, "energy_curve": [0.2, 0.8], "beat_times": [0.5], "downbeat_times": [0.5]},
        {"lines": [{"start": 0, "end": 1, "text": "Hello"}]}, fps=10, bands=4,
    )
    assert payload["fps"] == 10
    assert payload["totalFrames"] == 11
    assert len(payload["frames"]) == 11
    assert len(payload["frames"][0]["bands"]) == 4
    assert payload["frames"][5]["isBeat"] is True
    assert payload["frames"][5]["isDownbeat"] is True


def test_build_hyperframes_audio_payload_derives_four_four_downbeats() -> None:
    payload = build_hyperframes_audio_payload(
        {"duration_seconds": 2, "beat_times": [0, .5, 1, 1.5, 2]}, fps=10
    )
    assert payload["frames"][0]["isDownbeat"] is True
    assert payload["frames"][5]["isDownbeat"] is False
    assert payload["frames"][10]["isDownbeat"] is True


def test_compile_storyboard_rejects_overlap(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="invalid or overlapping timing"):
        compile_storyboard({"duration": 5, "scenes": [{"start": 0, "end": 3}, {"start": 2, "end": 4}]}, tmp_path)


def test_compile_storyboard_requires_scenes(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="non-empty scenes or beats"):
        compile_storyboard({"duration": 5, "scenes": []}, tmp_path)


# ---------------------------------------------------------------------------
# S3: scene schema + grid-absolute compiler times
# ---------------------------------------------------------------------------


def test_scene_schema_fields_round_trip_into_manifest(tmp_path: Path) -> None:
    character_ref = {
        "asset": "sol.png",
        "identity_checklist": ["freckles", "sunglasses", "hoop earring"],
        "off_axis": True,
    }
    result = compile_storyboard(
        {
            "track": "Enriched",
            "duration": 6,
            "beat_times": [0, 1, 2, 3, 4, 5, 6],
            "bpm": 120.0,
            "scenes": [
                {
                    "id": "verse-1",
                    "start_beat": 0,
                    "end_beat": 3,
                    "section": "Verse 1",
                    "lyric_lines": [
                        {"section": "Verse 1", "index": 0},
                        {"section": "Verse 1", "index": 1},
                    ],
                    "framing": "medium",
                    "source_aspect": "768x1152",
                    "character_ref": character_ref,
                    "accent": {"type": "beat_pulse", "amount": 0.025},
                },
                {
                    "id": "hook",
                    "start_beat": 3,
                    "end_beat": 6,
                    "section": "Hook",
                },
            ],
        },
        tmp_path,
        name="enriched",
    )
    manifest = json.loads(result.manifest_path.read_text(encoding="utf-8"))
    first = manifest["scenes"][0]
    assert first["section"] == "Verse 1"
    assert first["lyric_lines"] == [
        {"section": "Verse 1", "index": 0},
        {"section": "Verse 1", "index": 1},
    ]
    assert first["framing"] == "medium"
    assert first["source_aspect"] == "768x1152"
    assert first["character_ref"] == character_ref
    assert first["accent"] == {"type": "beat_pulse", "amount": 0.025}
    assert first["start"] == 0.0
    assert first["end"] == 3.0
    # Absent fields are not defaulted into existence on the other scene.
    assert "framing" not in manifest["scenes"][1]
    assert "character_ref" not in manifest["scenes"][1]
    assert "accent" not in manifest["scenes"][1]


def test_grid_times_override_conflicting_duration_seconds(tmp_path: Path) -> None:
    result = compile_storyboard(
        {
            "duration": 6,
            "beat_times": [0, 1, 2, 3, 4, 5, 6],
            "scenes": [
                {"id": "a", "start_beat": 0, "end_beat": 3, "duration_seconds": 2},
                {"id": "b", "start_beat": 3, "end_beat": 6, "duration_seconds": 99},
            ],
        },
        tmp_path,
        name="grid-wins",
    )
    manifest = json.loads(result.manifest_path.read_text(encoding="utf-8"))
    assert manifest["scenes"][0]["start"] == 0.0
    assert manifest["scenes"][0]["end"] == 3.0
    assert manifest["scenes"][1]["start"] == 3.0
    assert manifest["scenes"][1]["end"] == 6.0


def test_legacy_manifest_is_unchanged(tmp_path: Path) -> None:
    result = compile_storyboard(
        {
            "track": "Demo",
            "duration": 5,
            "scenes": [
                {
                    "id": "intro",
                    "start": 0,
                    "end": 2,
                    "title": "Intro",
                    "palette": {"base": "#000", "primary": "#123"},
                },
                {
                    "id": "outro",
                    "start": 2,
                    "end": 5,
                    "title": "Outro",
                    "description": "Final image",
                },
            ],
        },
        tmp_path,
        name="legacy",
    )
    manifest = json.loads(result.manifest_path.read_text(encoding="utf-8"))
    assert manifest == {
        "title": "Demo",
        "track": "Demo",
        "duration": 5.0,
        "scene_count": 2,
        "scenes": [
            {
                "id": "intro",
                "title": "Intro",
                "description": "",
                "start": 0.0,
                "end": 2.0,
                "palette": {"base": "#000", "primary": "#123"},
                "camera": {},
            },
            {
                "id": "outro",
                "title": "Outro",
                "description": "Final image",
                "start": 2.0,
                "end": 5.0,
                "palette": {},
                "camera": {},
            },
        ],
    }


def test_manifest_carries_board_grid_metadata(tmp_path: Path) -> None:
    result = compile_storyboard(
        {
            "track": "Meta",
            "duration": 4,
            "bpm": 123.0,
            "bpm_conflict": True,
            "grid_source": "studio-tracker",
            "beat_times": [0, 2, 4],
            "downbeats": [0, 2],
            "scenes": [{"id": "a", "start_beat": 0, "end_beat": 2}],
        },
        tmp_path,
        name="meta",
    )
    manifest = json.loads(result.manifest_path.read_text(encoding="utf-8"))
    assert manifest["bpm"] == 123.0
    assert manifest["bpm_conflict"] is True
    assert manifest["grid_source"] == "studio-tracker"
    assert manifest["beat_times"] == [0, 2, 4]
    assert manifest["downbeats"] == [0, 2]


def test_grid_scene_keeps_its_boundaries_across_a_removed_section(tmp_path: Path) -> None:
    """A not_sung gap must not stretch the previous scene's grid end."""
    result = compile_storyboard(
        {
            "duration": 8,
            "beat_times": [0, 2, 4, 6, 8],
            "scenes": [
                {"id": "verse-2", "start_beat": 0, "end_beat": 1},
                {"id": "hook", "start_beat": 3, "end_beat": 4},
            ],
        },
        tmp_path,
        name="gap",
    )
    manifest = json.loads(result.manifest_path.read_text(encoding="utf-8"))
    assert manifest["scenes"][0]["end"] == 2.0
    assert manifest["scenes"][1]["start"] == 6.0
    assert manifest["scenes"][1]["end"] == 8.0
