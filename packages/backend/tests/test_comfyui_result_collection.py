"""Tests for the ComfyUI result-collection path in `integrations_generation`.

`get_result` was refactored from two near-identical ~30-line blocks (images and
video) nested five levels deep into `_collect_comfyui_outputs` +
`_save_comfyui_asset`. It had no test coverage, so the behaviour it must preserve
is pinned here: images preferred over video; nodes without the requested key
skipped rather than errored; a blank filename falls through; sanitisation/fetch
failures become error results; nothing usable gives a specific error.
"""
import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..")))


def _mod():
    """Import lazily: importing at module scope opens DB state during collection."""
    import app.api.integrations_generation as m

    return m


def test_rejects_non_comfyui_service():
    m = _mod()
    from fastapi import HTTPException

    with pytest.raises(HTTPException):
        asyncio.run(m.get_result("not-comfyui", "abc"))


def test_pending_when_history_is_empty(monkeypatch):
    m = _mod()

    async def fake_history(base_url, prompt_id, timeout=30):
        return {}

    monkeypatch.setattr(m._cu, "fetch_history", fake_history)
    result = asyncio.run(m.get_result("comfyui", "abc"))
    assert result["status"] == "pending"
    assert result["prompt_id"] == "abc"


def test_pending_when_prompt_absent(monkeypatch):
    m = _mod()

    async def fake_history(base_url, prompt_id, timeout=30):
        return {"other-prompt": {}}

    monkeypatch.setattr(m._cu, "fetch_history", fake_history)
    assert asyncio.run(m.get_result("comfyui", "abc"))["status"] == "pending"


def test_error_when_no_outputs(monkeypatch):
    m = _mod()

    async def fake_history(base_url, prompt_id, timeout=30):
        return {"abc": {"outputs": {}}}

    monkeypatch.setattr(m._cu, "fetch_history", fake_history)
    result = asyncio.run(m.get_result("comfyui", "abc"))
    assert result["status"] == "error"
    assert "No outputs" in result["error"]


def test_image_output_is_saved_and_preferred_over_video(monkeypatch, tmp_path):
    """Images win over video, and the file lands under output/images."""
    m = _mod()
    monkeypatch.setattr(m, "PROJECT_ROOT", tmp_path)

    async def fake_history(base_url, prompt_id, timeout=30):
        return {
            "abc": {
                "outputs": {
                    "9": {"gifs": [{"filename": "clip.gif", "subfolder": ""}]},
                    "1": {"images": [{"filename": "pic.png", "subfolder": ""}]},
                }
            }
        }

    async def fake_fetch(base_url, filename, subfolder, timeout=30):
        return b"BYTES"

    monkeypatch.setattr(m._cu, "fetch_history", fake_history)
    monkeypatch.setattr(m._cu, "fetch_view_bytes", fake_fetch)

    result = asyncio.run(m.get_result("comfyui", "abc"))
    assert result["status"] == "completed"
    assert result["kind"] == "image", "images must be preferred over video"
    assert (tmp_path / "output" / "images" / "pic.png").read_bytes() == b"BYTES"


def test_video_output_used_when_no_images(monkeypatch, tmp_path):
    m = _mod()
    monkeypatch.setattr(m, "PROJECT_ROOT", tmp_path)

    async def fake_history(base_url, prompt_id, timeout=30):
        return {"abc": {"outputs": {"3": {"gifs": [{"filename": "clip.gif", "subfolder": ""}]}}}}

    async def fake_fetch(base_url, filename, subfolder, timeout=30):
        return b"VID"

    monkeypatch.setattr(m._cu, "fetch_history", fake_history)
    monkeypatch.setattr(m._cu, "fetch_view_bytes", fake_fetch)

    result = asyncio.run(m.get_result("comfyui", "abc"))
    assert result["kind"] == "video"
    assert (tmp_path / "output" / "video" / "clip.gif").read_bytes() == b"VID"


def test_blank_filename_is_reported_as_error(monkeypatch, tmp_path):
    """A blank filename is a real error, not something to skip.

    `sanitize_filename("")` raises ValueError, so this must surface as an error
    result. An earlier version of this test assumed a blank name would fall
    through to the next candidate; that was the test being wrong, not the code.
    """
    m = _mod()
    monkeypatch.setattr(m, "PROJECT_ROOT", tmp_path)

    async def fake_history(base_url, prompt_id, timeout=30):
        return {
            "abc": {
                "outputs": {
                    "1": {"images": [{"filename": "", "subfolder": ""}]},
                    "2": {"images": [{"filename": "good.png", "subfolder": ""}]},
                }
            }
        }

    monkeypatch.setattr(m._cu, "fetch_history", fake_history)

    result = asyncio.run(m.get_result("comfyui", "abc"))
    assert result["status"] == "error"
    assert "Invalid filename" in result["error"]


def test_non_image_node_is_skipped_not_fatal(monkeypatch, tmp_path):
    """A node that simply lacks the key must be skipped, not treated as an error."""
    m = _mod()
    monkeypatch.setattr(m, "PROJECT_ROOT", tmp_path)

    async def fake_history(base_url, prompt_id, timeout=30):
        return {
            "abc": {
                "outputs": {
                    "1": {"latent_preview": [{"filename": "thumb.webp"}]},
                    "2": {"images": [{"filename": "good.png"}]},
                }
            }
        }

    async def fake_fetch(base_url, filename, subfolder, timeout=30):
        return b"OK"

    monkeypatch.setattr(m._cu, "fetch_history", fake_history)
    monkeypatch.setattr(m._cu, "fetch_view_bytes", fake_fetch)

    result = asyncio.run(m.get_result("comfyui", "abc"))
    assert result["status"] == "completed"
    assert result["output_path"].endswith("good.png")


def test_sanitisation_failure_returns_error(monkeypatch, tmp_path):
    m = _mod()
    monkeypatch.setattr(m, "PROJECT_ROOT", tmp_path)

    async def fake_history(base_url, prompt_id, timeout=30):
        return {"abc": {"outputs": {"1": {"images": [{"filename": "evil.png"}]}}}}

    def bad_sanitize(name):
        raise ValueError("bad name")

    monkeypatch.setattr(m._cu, "fetch_history", fake_history)
    monkeypatch.setattr(m._cu, "sanitize_filename", bad_sanitize)

    result = asyncio.run(m.get_result("comfyui", "abc"))
    assert result["status"] == "error"
    assert "bad name" in result["error"]


def test_fetch_failure_returns_error(monkeypatch, tmp_path):
    m = _mod()
    monkeypatch.setattr(m, "PROJECT_ROOT", tmp_path)

    async def fake_history(base_url, prompt_id, timeout=30):
        return {"abc": {"outputs": {"1": {"images": [{"filename": "a.png"}]}}}}

    async def boom(base_url, filename, subfolder, timeout=30):
        raise RuntimeError("view failed")

    monkeypatch.setattr(m._cu, "fetch_history", fake_history)
    monkeypatch.setattr(m._cu, "fetch_view_bytes", boom)

    result = asyncio.run(m.get_result("comfyui", "abc"))
    assert result["status"] == "error"
    assert "view failed" in result["error"]


def test_history_failure_is_reported_not_raised(monkeypatch):
    """The outer `except` must still convert a fetch failure into a result."""
    m = _mod()

    async def boom(base_url, prompt_id, timeout=30):
        raise RuntimeError("history unavailable")

    monkeypatch.setattr(m._cu, "fetch_history", boom)
    result = asyncio.run(m.get_result("comfyui", "abc"))
    assert result["status"] == "error"
    assert "history unavailable" in result["error"]


def test_non_dict_output_nodes_are_skipped(monkeypatch, tmp_path):
    """Malformed history entries must not raise."""
    m = _mod()
    monkeypatch.setattr(m, "PROJECT_ROOT", tmp_path)

    async def fake_history(base_url, prompt_id, timeout=30):
        return {
            "abc": {
                "outputs": {
                    "1": "not-a-dict",
                    "2": {"images": ["not-a-dict"]},
                    "3": {"images": [{"filename": "ok.png"}]},
                }
            }
        }

    async def fake_fetch(base_url, filename, subfolder, timeout=30):
        return b"OK"

    monkeypatch.setattr(m._cu, "fetch_history", fake_history)
    monkeypatch.setattr(m._cu, "fetch_view_bytes", fake_fetch)

    result = asyncio.run(m.get_result("comfyui", "abc"))
    assert result["status"] == "completed"
    assert result["output_path"].endswith("ok.png")
