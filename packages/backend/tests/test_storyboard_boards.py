"""Tests for the storyboard board store and its API.

Hermetic: seed and saved dirs are pointed at tmp_path fixtures carrying a
small sequences-JSON board and a small Markdown board, so the conversions
are exercised without depending on the repo's real board files.
"""

from __future__ import annotations

import json

import pytest

SEQUENCES_BOARD = {
    "title": "Test Rise — NeoCortext",
    "duration": 40.0,
    "fps": 30,
    "bpm": 100.0,
    "sequences": [
        {
            "id": "S01",
            "section": "INTRO",
            "start": 0,
            "end": 18,
            "lyrics": ["line one", "line two"],
            "visual": "Wide horizon",
            "camera": "Slow push 0.99 to 1.01",
            "palette": "220 slate",
            "typography": "Mono pill",
            "transition": "Light leak wipe",
        },
        {
            "id": "S02",
            "section": "CHORUS",
            "start": 18,
            "end": 40,
            "lyrics": ["hook line"],
            "visual": "Hero bloom",
            "camera": "Scale with bass",
            "palette": "258 violet",
            "typography": "Hero split",
            "transition": "Wipe",
        },
    ],
    "transitions": [{"at": 18, "type": "Light leak wipe"}],
}

MARKDOWN_BOARD = """# Test Crown

## Overview Map (2 Sequences = lyricBlocks)

| SEQ | Section | Timecode | Dur | Lyric Hook | Visual Story (1 sentence) | 2026 Technique |
|-----|---------|----------|-----|------------|---------------------------|----------------|
| S01 | INTRO | 00:00-00:30 | 30s | *(no lyrics)* | Dark field, crown dim. | Letterbox 20px, slow push |
| S02 | OUTRO | 00:30-01:00 | 30s | *Take the crown* | Fade to monument. | Fade out |

## Production Notes
"""


@pytest.fixture
def board_storage(tmp_path, monkeypatch: pytest.MonkeyPatch):
    """Point the store at temp dirs holding the two fixture seeds."""
    import app.services.storyboard_boards as boards_mod

    seed_dir = tmp_path / "seeds"
    seed_dir.mkdir()
    (seed_dir / "STORYBOARD_StillIRise.json").write_text(
        json.dumps(SEQUENCES_BOARD), encoding="utf-8"
    )
    (seed_dir / "STORYBOARD_TakeTheCrown.md").write_text(MARKDOWN_BOARD, encoding="utf-8")
    monkeypatch.setattr(boards_mod, "SEED_DIR", seed_dir)
    monkeypatch.setattr(boards_mod, "BOARDS_DIR", tmp_path / "saved")
    return boards_mod


@pytest.fixture
def client(board_storage):
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app)


def test_sequences_seed_converts_losslessly(board_storage):
    board = board_storage.load_board("still-i-rise")
    assert board is not None
    assert board["duration"] == 40.0
    assert len(board["scenes"]) == 2
    first = board["scenes"][0]
    assert first["lyric_lines"] == ["line one", "line two"]
    assert first["camera_text"] == "Slow push 0.99 to 1.01"
    assert first["palette_text"] == "220 slate"
    assert first["description"] == first["visual"]
    assert board_storage.validate_board(board) == []


def test_markdown_seed_converts_via_overview_table(board_storage):
    board = board_storage.load_board("take-the-crown")
    assert board is not None
    assert len(board["scenes"]) == 2
    assert board["duration"] == 60.0
    assert board["scenes"][0]["start"] == 0.0
    assert board["scenes"][0]["end"] == 30.0
    assert board["scenes"][1]["technique"] == "Fade out"
    assert board_storage.validate_board(board) == []


def test_save_round_trip_and_saved_shadows_seed(board_storage):
    board = board_storage.load_board("still-i-rise")
    board["scenes"][0]["camera_text"] = "Locked off, no move"
    stored = board_storage.save_board("still-i-rise", board)
    assert stored["updated_at"]
    reloaded = board_storage.load_board("still-i-rise")
    assert reloaded["scenes"][0]["camera_text"] == "Locked off, no move"
    summaries = {b["slug"]: b for b in board_storage.list_boards()}
    assert summaries["still-i-rise"]["source"] == "saved"
    assert summaries["take-the-crown"]["source"] == "seed"


def test_validation_rejects_overlap_and_empty(board_storage):
    overlapping = {
        "scenes": [
            {"id": "a", "start": 0, "end": 10},
            {"id": "b", "start": 9, "end": 20},
        ]
    }
    assert any("overlap" in e for e in board_storage.validate_board(overlapping))
    with pytest.raises(ValueError):
        board_storage.save_board("still-i-rise", overlapping)
    with pytest.raises(ValueError):
        board_storage.save_board("still-i-rise", {"scenes": []})


def test_bad_slug_is_refused(board_storage):
    assert board_storage.load_board("../secret") is None
    with pytest.raises(ValueError):
        board_storage.save_board("../secret", {"scenes": [{"id": "a", "start": 0, "end": 1}]})


def test_api_get_put_and_404(client, board_storage):
    listing = client.get("/api/storyboards").json()
    assert {b["slug"] for b in listing["boards"]} == {"still-i-rise", "take-the-crown"}

    board = client.get("/api/storyboards/still-i-rise").json()
    assert board["scenes"][1]["section"] == "CHORUS"

    board["scenes"][1]["visual"] = "Edited visual"
    saved = client.put("/api/storyboards/still-i-rise", json={"board": board})
    assert saved.status_code == 200
    assert saved.json()["scene_count"] == 2
    assert client.get("/api/storyboards/still-i-rise").json()["scenes"][1]["visual"] == "Edited visual"

    assert client.get("/api/storyboards/nope").status_code == 404
    bad = client.put(
        "/api/storyboards/still-i-rise", json={"board": {"scenes": []}}
    )
    assert bad.status_code == 400
