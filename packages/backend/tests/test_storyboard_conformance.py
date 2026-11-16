"""Tests for the place/theme conformance check (Step 5 S4, R5).

The R5 receipt: a "neon dance" panel rendered as generic Chinatown and was
dropped. The board should carry that verdict itself.
"""

from __future__ import annotations

import base64
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
from app.services.storyboard_conformance import OllamaVlmConformanceChecker, parse_verdict
from app.services.storyboard_generator import StoryboardGeneratorHandler
from app.services.storyboard_hyperframes import compile_storyboard

# ---------------------------------------------------------------------------
# Verdict parsing
# ---------------------------------------------------------------------------


def test_parse_verdict_reads_json_and_fenced_json() -> None:
    plain = parse_verdict('{"conforms": true, "reason": "desert highway"}')
    assert plain == {"accepted": True, "reason": "desert highway"}

    fenced = parse_verdict('```json\n{"conforms": false, "reason": "neon Chinatown"}\n```')
    assert fenced == {"accepted": False, "reason": "neon Chinatown"}


def test_parse_verdict_rejects_missing_boolean_conforms() -> None:
    assert parse_verdict('{"reason": "desert"}') is None
    assert parse_verdict('{"conforms": "true", "reason": "desert"}') is None


def test_parse_verdict_rejects_empty_reason() -> None:
    assert parse_verdict('{"conforms": false, "reason": "   "}') is None
    assert parse_verdict('{"conforms": true}') is None


def test_parse_verdict_rejects_non_json() -> None:
    assert parse_verdict("looks fine to me") is None


# ---------------------------------------------------------------------------
# Ollama checker
# ---------------------------------------------------------------------------


class MockAdapter:
    def __init__(self, reply: Any) -> None:
        self.reply = reply
        self.calls: list[dict[str, Any]] = []

    async def chat(self, messages: Any, model: Any = None, **kwargs: Any) -> Any:
        self.calls.append({"messages": messages, "model": model, "kwargs": kwargs})
        if isinstance(self.reply, Exception):
            raise self.reply
        return {"message": {"content": self.reply}}


@pytest.fixture()
def image(tmp_path: Path) -> Path:
    path = tmp_path / "panel.png"
    path.write_bytes(b"\x89PNG\r\n\x1a\nfake-image-bytes")
    return path


async def test_checker_sends_base64_image_and_place_theme(image: Path) -> None:
    adapter = MockAdapter('{"conforms": true, "reason": "desert highway and skyline"}')
    checker = OllamaVlmConformanceChecker(adapter)
    verdict = await checker.check(
        str(image),
        "Arizona desert highways, Phoenix skyline",
        {"section": "Hook", "framing": "wide"},
    )

    assert verdict == {"accepted": True, "reason": "desert highway and skyline"}
    call = adapter.calls[0]
    message = call["messages"][0]
    assert message["role"] == "user"
    assert message["images"] == [base64.b64encode(image.read_bytes()).decode("ascii")]
    assert "Arizona desert highways, Phoenix skyline" in message["content"]
    assert "Hook" in message["content"]
    assert "wide" in message["content"]
    assert call["model"] == "gemma4:e2b-it-qat"
    assert call["kwargs"]["format"] == "json"


async def test_checker_returns_none_on_malformed_json(image: Path) -> None:
    checker = OllamaVlmConformanceChecker(MockAdapter("looks fine"))
    assert await checker.check(str(image), "Arizona", {}) is None


async def test_checker_returns_none_when_adapter_raises(image: Path) -> None:
    checker = OllamaVlmConformanceChecker(MockAdapter(RuntimeError("ollama down")))
    assert await checker.check(str(image), "Arizona", {}) is None


async def test_checker_returns_none_when_image_missing(tmp_path: Path) -> None:
    checker = OllamaVlmConformanceChecker(MockAdapter("{}"))
    assert await checker.check(str(tmp_path / "missing.png"), "Arizona", {}) is None


# ---------------------------------------------------------------------------
# Generator wiring
# ---------------------------------------------------------------------------


class FakeAdapter:
    def __init__(self, scenes: list[dict[str, Any]] | None = None) -> None:
        self.scenes = scenes or [
            {"title": "Arizona highway", "description": "Desert road at dusk"},
            {"title": "Neon dance", "description": "Crowded neon street"},
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
            "estimated_duration_seconds": 4.0,
            "style": "cinematic",
            "transitions": [],
            "model_used": "fake-model",
        }


class FakeChecker:
    def __init__(self, fn: Any) -> None:
        self.fn = fn
        self.calls: list[tuple[str, str, str | None]] = []

    def check(self, image_ref: str, place_theme: str, scene: dict[str, Any]) -> Any:
        self.calls.append((image_ref, place_theme, scene.get("id")))
        return self.fn(image_ref, scene)


def _job(place_theme: str | None, panel_images: dict[str, str]) -> Job:
    params: dict[str, Any] = {"theme": "r5", "panel_images": panel_images}
    if place_theme is not None:
        params["place_theme"] = place_theme
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


async def test_accept_marks_every_checked_panel_accepted(isolated_output: Path) -> None:
    checker = FakeChecker(lambda ref, scene: {"accepted": True, "reason": "desert highway"})
    handler = StoryboardGeneratorHandler(
        adapter=FakeAdapter(), conformance_checker=checker
    )
    response = await handler.process_job(
        _job("Arizona desert highways", {"scene-1": "a.png", "scene-2": "b.png"})
    )
    board = _read_board(isolated_output)

    assert [scene["state"] for scene in board["scenes"]] == ["accepted", "accepted"]
    assert response["panels_accepted"] == 2
    assert response["panels_rejected"] == 0
    assert len(checker.calls) == 2


async def test_reject_keeps_the_exact_reason(isolated_output: Path) -> None:
    def verdict(ref: str, scene: dict[str, Any]) -> dict[str, Any]:
        if ref == "b.png":
            return {
                "accepted": False,
                "reason": "generic Chinatown streetscape, wrong place",
            }
        return {"accepted": True, "reason": "desert highway"}

    handler = StoryboardGeneratorHandler(
        adapter=FakeAdapter(), conformance_checker=FakeChecker(verdict)
    )
    response = await handler.process_job(
        _job("Arizona desert highways", {"scene-1": "a.png", "scene-2": "b.png"})
    )
    board = _read_board(isolated_output)

    assert board["scenes"][1]["state"] == "rejected"
    assert (
        board["scenes"][1]["reject_reason"]
        == "generic Chinatown streetscape, wrong place"
    )
    assert response["panels_rejected"] == 1
    assert response["panels_accepted"] == 1


async def test_none_verdict_is_a_failed_check_not_a_verdict(isolated_output: Path) -> None:
    handler = StoryboardGeneratorHandler(
        adapter=FakeAdapter(), conformance_checker=FakeChecker(lambda ref, scene: None)
    )
    response = await handler.process_job(
        _job("Arizona desert highways", {"scene-1": "a.png"})
    )
    board = _read_board(isolated_output)

    assert board["scenes"][0]["state"] == "generated"
    assert board["scenes"][0]["conformance_error"] == "check could not be performed"
    assert board["conformance_errors"] == 1
    assert response["panels_accepted"] == 0
    assert response["panels_rejected"] == 0


async def test_malformed_verdict_is_a_failed_check(isolated_output: Path) -> None:
    handler = StoryboardGeneratorHandler(
        adapter=FakeAdapter(),
        conformance_checker=FakeChecker(lambda ref, scene: {"accepted": False, "reason": "  "}),
    )
    await handler.process_job(_job("Arizona desert highways", {"scene-1": "a.png"}))
    board = _read_board(isolated_output)

    assert board["scenes"][0]["state"] == "generated"
    assert board["conformance_errors"] == 1


async def test_no_checker_leaves_panels_generated(isolated_output: Path) -> None:
    handler = StoryboardGeneratorHandler(adapter=FakeAdapter())
    response = await handler.process_job(
        _job("Arizona desert highways", {"scene-1": "a.png"})
    )
    board = _read_board(isolated_output)

    assert board["scenes"][0]["state"] == "generated"
    assert "panels_accepted" not in response
    assert "panels_rejected" not in response


async def test_checker_without_place_theme_is_never_called(isolated_output: Path) -> None:
    checker = FakeChecker(lambda ref, scene: {"accepted": True, "reason": "unused"})
    handler = StoryboardGeneratorHandler(
        adapter=FakeAdapter(), conformance_checker=checker
    )
    response = await handler.process_job(_job(None, {"scene-1": "a.png"}))
    board = _read_board(isolated_output)

    assert checker.calls == []
    assert board["scenes"][0]["state"] == "generated"
    assert "panels_accepted" not in response


# ---------------------------------------------------------------------------
# The R5 fixture, end to end
# ---------------------------------------------------------------------------


def _r5_job() -> Job:
    return Job(
        job_type=JobType.STORYBOARD_GENERATION,
        params={
            "theme": "r5",
            "place_theme": "Arizona desert highways, Phoenix skyline",
            "panel_images": {"scene-1": "panels/highway.png", "scene-2": "panels/neon.png"},
            "analysis": {
                "bpm": 120.0,
                "beat_times": [index * 0.5 for index in range(8)],
                "downbeats": [],
                "sections": [
                    {"name": "Intro", "start": 0.0, "end": 2.0},
                    {"name": "Hook", "start": 2.0, "end": 4.0},
                ],
                "source": "studio-tracker",
            },
        },
    )


async def test_r5_neon_panel_is_rejected_and_excluded_from_the_manifest(
    isolated_output: Path, tmp_path: Path
) -> None:
    def verdict(ref: str, scene: dict[str, Any]) -> dict[str, Any]:
        if scene.get("id") == "scene-2":
            return {
                "accepted": False,
                "reason": "generic Chinatown streetscape, wrong place",
            }
        return {"accepted": True, "reason": "desert highway with Phoenix skyline"}

    handler = StoryboardGeneratorHandler(
        adapter=FakeAdapter(), conformance_checker=FakeChecker(verdict)
    )
    await handler.process_job(_r5_job())
    board = _read_board(isolated_output)

    neon = next(scene for scene in board["scenes"] if scene["id"] == "scene-2")
    assert neon["state"] == "rejected"
    assert neon["reject_reason"] == "generic Chinatown streetscape, wrong place"

    compiled_dir = tmp_path / "compiled"
    compiled_dir.mkdir()
    result = compile_storyboard(board, compiled_dir, name="r5")
    manifest = json.loads(result.manifest_path.read_text(encoding="utf-8"))

    assert manifest["scene_count"] == 1
    assert all(scene["id"] != "scene-2" for scene in manifest["scenes"])
    assert "generic Chinatown" not in json.dumps(manifest)
