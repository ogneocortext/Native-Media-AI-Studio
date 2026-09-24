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
