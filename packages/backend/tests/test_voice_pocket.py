"""Tests for the Pocket TTS proxy (app/api/voice_pocket.py).

Covers the fail-closed contract (missing token env -> 503), the degraded
voice-list fallback when Pocket /health is unreachable (closed test port --
the real Pocket server is never touched), and upstream-error mapping. The
live proxy path is exercised separately against the running rig.
"""

import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from fastapi import HTTPException  # noqa: E402

from app.api import voice_pocket  # noqa: E402
from app.core import tts_settings  # noqa: E402

CLOSED_PORT_CFG = {
    "base_url": "http://127.0.0.1:9",
    "token_env": "POCKET_TTS_TOKEN",
    "default_voice": "maya-blend65",
    "timeout_s": 2,
}


def _run(coro):
    return asyncio.run(coro)


def test_health_503_when_token_env_unset(monkeypatch):
    monkeypatch.delenv("POCKET_TTS_TOKEN", raising=False)
    with pytest.raises(HTTPException) as exc:
        _run(voice_pocket.pocket_health())
    assert exc.value.status_code == 503
    assert "POCKET_TTS_TOKEN" in exc.value.detail


def test_voices_degraded_fallback_on_unreachable(monkeypatch):
    monkeypatch.setenv("POCKET_TTS_TOKEN", "test-token")
    monkeypatch.setattr(tts_settings, "pocket", lambda: dict(CLOSED_PORT_CFG))
    res = _run(voice_pocket.pocket_voices())
    assert res["degraded"] is True
    assert res["default_voice"] == "maya-blend65"
    names = [v["name"] for v in res["voices"]]
    assert "maya" in names and "maya-blend65" in names
    # alba appears in both fallback lists -- custom wins, listed once.
    assert names.count("alba") == 1
    kinds = {v["name"]: v["kind"] for v in res["voices"]}
    assert kinds["alba"] == "custom"


def test_health_503_on_unreachable(monkeypatch):
    monkeypatch.setenv("POCKET_TTS_TOKEN", "test-token")
    monkeypatch.setattr(tts_settings, "pocket", lambda: dict(CLOSED_PORT_CFG))
    with pytest.raises(HTTPException) as exc:
        _run(voice_pocket.pocket_health())
    assert exc.value.status_code == 503


def test_speak_503_on_unreachable(monkeypatch):
    monkeypatch.setenv("POCKET_TTS_TOKEN", "test-token")
    monkeypatch.setattr(tts_settings, "pocket", lambda: dict(CLOSED_PORT_CFG))
    req = voice_pocket.SpeakRequest(text="hi", voice="maya-blend65")
    with pytest.raises(HTTPException) as exc:
        _run(voice_pocket.pocket_speak(req))
    assert exc.value.status_code == 503


def test_voices_filters_absolute_paths(monkeypatch):
    """Absolute .safetensors paths cached upstream must never reach the UI."""
    monkeypatch.setenv("POCKET_TTS_TOKEN", "test-token")

    async def fake_health(token):
        return {
            "voices_cached": ["maya", "D:\\Tools\\streaming-tts\\pocket\\voices\\maya-blend65.safetensors"],
            "preset_voices": ["alba", "anna"],
        }

    monkeypatch.setattr(voice_pocket, "_fetch_health", fake_health)
    res = _run(voice_pocket.pocket_voices())
    assert res["degraded"] is False
    names = [v["name"] for v in res["voices"]]
    assert "maya" in names
    assert not any("safetensors" in n or ":" in n or "\\" in n for n in names)
    assert names.count("alba") == 1
