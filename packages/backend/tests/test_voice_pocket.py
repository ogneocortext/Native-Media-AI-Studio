"""Tests for the Pocket TTS proxy (app/api/voice_pocket.py).

Covers the fail-closed contract (missing token env -> 503), the degraded
voice-list fallback when Pocket /health is unreachable (closed test port --
the real Pocket server is never touched), and upstream-error mapping. The
live proxy path is exercised separately against the running rig.

Also covers the token-file resolution (pocket.token_file): file-first with
env-var fallback, mtime-based hot reload, and the single 401 retry.
"""

import asyncio
import os
import sys

import httpx
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


@pytest.fixture(autouse=True)
def _reset_token_cache():
    """Reset the module-level token file cache between tests."""
    voice_pocket._token_file_cache = None
    voice_pocket._token_file_cache_mtime = None
    yield


# ---------------------------------------------------------------------------
# Token file resolution (pocket.token_file)
# ---------------------------------------------------------------------------

def test_token_file_wins_over_env(monkeypatch, tmp_path):
    """token_file set + file present -> file value wins over env var."""
    token_file = tmp_path / "pocket-token.txt"
    token_file.write_text("file-token-value", encoding="utf-8")

    cfg = dict(CLOSED_PORT_CFG)
    cfg["token_file"] = str(token_file)
    monkeypatch.setattr(tts_settings, "pocket", lambda: cfg)
    monkeypatch.setenv("POCKET_TTS_TOKEN", "env-token-value")

    assert voice_pocket._token() == "file-token-value"


def test_token_file_missing_falls_back_to_env(monkeypatch, tmp_path):
    """token_file set + file missing -> falls back to env var."""
    token_file = tmp_path / "nonexistent.txt"

    cfg = dict(CLOSED_PORT_CFG)
    cfg["token_file"] = str(token_file)
    monkeypatch.setattr(tts_settings, "pocket", lambda: cfg)
    monkeypatch.setenv("POCKET_TTS_TOKEN", "env-token-value")

    assert voice_pocket._token() == "env-token-value"


def test_token_file_empty_string_env_behavior(monkeypatch):
    """token_file empty string -> env var behavior unchanged."""
    cfg = dict(CLOSED_PORT_CFG)
    cfg["token_file"] = ""
    monkeypatch.setattr(tts_settings, "pocket", lambda: cfg)
    monkeypatch.setenv("POCKET_TTS_TOKEN", "env-token-value")

    assert voice_pocket._token() == "env-token-value"


def test_no_token_file_no_env_var_503(monkeypatch):
    """Both token_file and env var absent -> _require_token raises 503."""
    cfg = dict(CLOSED_PORT_CFG)
    cfg["token_file"] = ""
    monkeypatch.setattr(tts_settings, "pocket", lambda: cfg)
    monkeypatch.delenv("POCKET_TTS_TOKEN", raising=False)

    with pytest.raises(HTTPException) as exc:
        _run(voice_pocket.pocket_health())
    assert exc.value.status_code == 503
    assert "POCKET_TTS_TOKEN" in exc.value.detail


def test_token_file_mtime_change_picks_up_new_value(monkeypatch, tmp_path):
    """mtime change on token file -> next _token() returns new value without force_refresh."""
    token_file = tmp_path / "pocket-token.txt"
    token_file.write_text("token-v1", encoding="utf-8")

    cfg = dict(CLOSED_PORT_CFG)
    cfg["token_file"] = str(token_file)
    monkeypatch.setattr(tts_settings, "pocket", lambda: cfg)

    assert voice_pocket._token() == "token-v1"

    # Change the file content (mtime changes)
    import time
    time.sleep(0.01)
    token_file.write_text("token-v2", encoding="utf-8")

    assert voice_pocket._token() == "token-v2"


# ---------------------------------------------------------------------------
# 401 retry (mock httpx -- real Pocket server never touched)
# ---------------------------------------------------------------------------

class FakeResponse:
    def __init__(self, status_code, json_data=None, content=b"", headers=None):
        self.status_code = status_code
        self._json = json_data or {}
        self.content = content
        self.headers = headers or {}

    def json(self):
        return self._json

    async def aiter_bytes(self):
        yield self.content

    async def aclose(self):
        pass


class FakeRequest:
    def __init__(self, method, url, json=None, headers=None):
        self.method = method
        self.url = url
        self.json = json
        self.headers = headers or {}


class FakeClient:
    """Mock httpx.AsyncClient that returns responses from a shared queue."""

    def __init__(self, responses, call_count_ref, timeout=None):
        self._responses = responses
        self._call_count_ref = call_count_ref
        self.timeout = timeout

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    async def get(self, url, headers=None):
        resp = self._responses[self._call_count_ref[0]]
        self._call_count_ref[0] += 1
        return resp

    def build_request(self, method, url, json=None, headers=None):
        return FakeRequest(method, url, json=json, headers=headers)

    async def send(self, request, stream=False):
        resp = self._responses[self._call_count_ref[0]]
        self._call_count_ref[0] += 1
        return resp

    async def aclose(self):
        pass


def test_health_401_then_200_retry(monkeypatch):
    """Upstream 401 then 200 -> health succeeds after exactly one retry."""
    monkeypatch.setenv("POCKET_TTS_TOKEN", "initial-token")

    token_call_count = [0]

    def fake_token(force_refresh=False):
        token_call_count[0] += 1
        if token_call_count[0] == 1:
            return "initial-token"
        return "refreshed-token"

    monkeypatch.setattr(voice_pocket, "_token", fake_token)
    call_count_ref = [0]
    responses = [
        FakeResponse(401),
        FakeResponse(200, {
            "model": "test", "sample_rate": 24000,
            "voices_cached": ["maya"], "preset_voices": ["alba"], "busy": False,
        }),
    ]
    monkeypatch.setattr(httpx, "AsyncClient", lambda timeout=None: FakeClient(responses, call_count_ref))
    monkeypatch.setattr(tts_settings, "pocket", lambda: dict(CLOSED_PORT_CFG))

    res = _run(voice_pocket.pocket_health())
    assert res["model"] == "test"
    assert res["sample_rate"] == 24000
    assert call_count_ref[0] == 2  # initial + force_refresh retry


def test_health_401_twice_502(monkeypatch):
    """401 twice -> 502 (no further retries)."""
    monkeypatch.setenv("POCKET_TTS_TOKEN", "initial-token")

    token_call_count = [0]

    def fake_token(force_refresh=False):
        token_call_count[0] += 1
        if token_call_count[0] == 1:
            return "initial-token"
        return "refreshed-token"

    monkeypatch.setattr(voice_pocket, "_token", fake_token)
    call_count_ref = [0]
    responses = [
        FakeResponse(401),
        FakeResponse(401),
    ]
    monkeypatch.setattr(httpx, "AsyncClient", lambda timeout=None: FakeClient(responses, call_count_ref))
    monkeypatch.setattr(tts_settings, "pocket", lambda: dict(CLOSED_PORT_CFG))

    with pytest.raises(HTTPException) as exc:
        _run(voice_pocket.pocket_health())
    assert exc.value.status_code == 502
    assert call_count_ref[0] == 2  # initial + exactly one retry


def test_speak_401_then_200_retry(monkeypatch):
    """Upstream 401 then 200 -> speak succeeds after exactly one retry (before streaming)."""
    monkeypatch.setenv("POCKET_TTS_TOKEN", "initial-token")

    token_call_count = [0]

    def fake_token(force_refresh=False):
        token_call_count[0] += 1
        if token_call_count[0] == 1:
            return "initial-token"
        return "refreshed-token"

    monkeypatch.setattr(voice_pocket, "_token", fake_token)
    call_count_ref = [0]
    responses = [
        FakeResponse(401),
        FakeResponse(200, content=b"RIFF....WAVEfakeaudio",
                     headers={"content-type": "audio/wav"}),
    ]
    monkeypatch.setattr(httpx, "AsyncClient", lambda timeout=None: FakeClient(responses, call_count_ref))
    monkeypatch.setattr(tts_settings, "pocket", lambda: dict(CLOSED_PORT_CFG))

    req = voice_pocket.SpeakRequest(text="hi", voice="maya-blend65")
    resp = _run(voice_pocket.pocket_speak(req))
    assert resp is not None
    assert call_count_ref[0] == 2  # initial + force_refresh retry


# ---------------------------------------------------------------------------
# Existing tests (unchanged)
# ---------------------------------------------------------------------------

def test_health_503_when_token_env_unset(monkeypatch):
    # Pin the pocket config too: the real config/tts.json on a rig points
    # token_file at a live token file and base_url at the tailnet Pocket
    # server, so deleting only the env var no longer means "no token".
    monkeypatch.setattr(tts_settings, "pocket", lambda: dict(CLOSED_PORT_CFG))
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
