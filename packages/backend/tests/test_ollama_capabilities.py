"""Tests for authoritative Ollama model capabilities.

These pin the normalisation rules and the degradation path. The HTTP layer is
stubbed because the point under test is how this repo *interprets* /api/show,
not that Ollama answers - and a live-server test would make the suite depend on
which models happen to be installed, which differs per machine.
"""

from __future__ import annotations

import pytest
from app.core import ollama_client


class _Resp:
    def __init__(self, status, payload):
        self.status = status
        self._payload = payload

    async def json(self, content_type=None):
        return self._payload

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


class _Session:
    """Minimal aiohttp stand-in that replays queued /api/show responses."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def post(self, url, json=None, timeout=None):
        self.calls.append((url, json))
        item = self.responses.pop(0) if self.responses else (500, {})
        return _Resp(*item)


@pytest.fixture(autouse=True)
def _clear_cache():
    ollama_client.clear_capability_cache()
    yield
    ollama_client.clear_capability_cache()


def _patch_session(monkeypatch, responses):
    session = _Session(responses)
    monkeypatch.setattr(ollama_client, "get_shared_session", lambda: _async(session))
    return session


async def _await(value):
    return value


def _async(value):
    async def _inner():
        return value
    return _inner()


# ── vocabulary normalisation ──────────────────────────────────────────────────


def test_completion_is_exposed_as_chat():
    assert ollama_client.normalize_capabilities(["completion"]) == ["chat"]


def test_embedding_is_exposed_as_embed():
    assert ollama_client.normalize_capabilities(["embedding"]) == ["embed"]


def test_unknown_capabilities_pass_through():
    assert ollama_client.normalize_capabilities(["audio", "vision"]) == ["audio", "vision"]


def test_audio_is_preserved():
    """gemma4 reports audio; it is a real capability, not noise to drop."""
    assert "audio" in ollama_client.normalize_capabilities(["completion", "audio"])


def test_decision_models_are_not_offered_chat_tools_or_thinking():
    """Ollama 0.35.1: a decision model answers /v1/systemone, not chat."""
    caps = ollama_client.normalize_capabilities(["decision", "vision"])
    assert "decision" in caps
    assert "vision" in caps, "decision models can still be multimodal"
    for blocked in ("chat", "tools", "thinking"):
        assert blocked not in caps


def test_decision_wins_even_if_the_server_also_lists_completion():
    caps = ollama_client.normalize_capabilities(["decision", "completion", "tools"])
    assert not {"chat", "tools"} & set(caps)


def test_duplicates_are_collapsed():
    assert ollama_client.normalize_capabilities(["completion", "chat", "vision"]) == ["chat", "vision"]


def test_none_is_tolerated():
    assert ollama_client.normalize_capabilities(None) == []


# ── fetching and degradation ──────────────────────────────────────────────────


async def test_returns_authoritative_capabilities(monkeypatch):
    _patch_session(monkeypatch, [(200, {"capabilities": ["completion", "vision", "tools", "thinking"]})])
    caps = await ollama_client.get_model_capabilities("qwen3-vl:2b")
    assert caps == ["chat", "vision", "tools", "thinking"]


async def test_http_error_returns_none_not_an_empty_list(monkeypatch):
    """None means 'could not ask'; [] would mean 'has no capabilities'."""
    _patch_session(monkeypatch, [(404, {"error": "not found"})])
    assert await ollama_client.get_model_capabilities("nope") is None


async def test_server_error_returns_none(monkeypatch):
    _patch_session(monkeypatch, [(500, {})])
    assert await ollama_client.get_model_capabilities("boom") is None


async def test_blank_model_name_is_not_asked_about(monkeypatch):
    session = _patch_session(monkeypatch, [])
    assert await ollama_client.get_model_capabilities("  ") is None
    assert session.calls == [], "a blank name must not produce a request"


async def test_second_call_is_served_from_cache(monkeypatch):
    session = _patch_session(monkeypatch, [(200, {"capabilities": ["completion", "vision"]})])
    await ollama_client.get_model_capabilities("m")
    await ollama_client.get_model_capabilities("m")
    assert len(session.calls) == 1, "capabilities are cached for CAPABILITY_TTL_SEC"


async def test_cache_can_be_cleared(monkeypatch):
    session = _patch_session(monkeypatch, [
        (200, {"capabilities": ["completion"]}),
        (200, {"capabilities": ["completion", "vision"]}),
    ])
    await ollama_client.get_model_capabilities("m")
    ollama_client.clear_capability_cache()
    caps = await ollama_client.get_model_capabilities("m")
    assert "vision" in caps
    assert len(session.calls) == 2


async def test_a_cached_result_is_not_mutated_by_the_caller(monkeypatch):
    """A caller that appends to the list must not poison the cache."""
    _patch_session(monkeypatch, [(200, {"capabilities": ["completion", "vision"]})])
    first = await ollama_client.get_model_capabilities("m")
    first.append("bogus")
    assert await ollama_client.get_model_capabilities("m") == ["chat", "vision"]


# ── bulk ──────────────────────────────────────────────────────────────────────


async def test_bulk_returns_none_for_the_models_that_failed(monkeypatch):
    """One model answering must not be lost because a sibling 404'd."""
    _patch_session(monkeypatch, [
        (200, {"capabilities": ["completion", "vision"]}),
        (404, {"error": "not found"}),
        (200, {"capabilities": ["embedding"]}),
    ])
    caps = await ollama_client.get_capabilities_bulk(["a", "b", "c"])
    assert caps["a"] == ["chat", "vision"]
    assert caps["b"] is None
    assert caps["c"] == ["embed"]


async def test_bulk_of_nothing_is_empty(monkeypatch):
    _patch_session(monkeypatch, [])
    assert await ollama_client.get_capabilities_bulk([]) == {}


async def test_bulk_survives_one_call_raising(monkeypatch):
    class Exploding(_Session):
        def post(self, url, json=None, timeout=None):
            if json.get("model") == "bad":
                raise ValueError("boom")
            return super().post(url, json=json, timeout=timeout)

    session = Exploding([(200, {"capabilities": ["completion"]})])
    monkeypatch.setattr(ollama_client, "get_shared_session", lambda: _async(session))
    caps = await ollama_client.get_capabilities_bulk(["good", "bad"])
    assert caps["good"] == ["chat"]
    assert caps["bad"] is None
