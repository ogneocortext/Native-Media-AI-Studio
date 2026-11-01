"""Unit tests for Bolt-era reasoning handling in the local-model adapters.

Covers:
- ``reasoning_content`` is preserved from the response (not dropped)
- ``think`` param maps to ``chat_template_kwargs: {"enable_thinking": ...}``
- Reasoning headroom (~200 tokens) added to ``max_tokens`` when thinking is on
- Route truth: each chat call logs the serving route

These tests mock the HTTP layer so they run without a live Ollama/Atomic
server.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

REPO_ROOT = __import__("pathlib").Path(__file__).resolve().parents[2]
import sys

sys.path.insert(0, str(REPO_ROOT))


class _FakeResponse:
    """Minimal aiohttp-like response mock."""

    def __init__(self, payload: dict[str, Any], status: int = 200):
        self.status = status
        self._payload = payload

    async def json(self) -> dict[str, Any]:
        return self._payload

    async def text(self) -> str:
        return json.dumps(self._payload)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False


class _FakeSession:
    """Minimal aiohttp-like session mock (supports get and post)."""

    def __init__(self, payload: dict[str, Any], status: int = 200):
        self._payload = payload
        self.status = status
        self.last_payload: dict[str, Any] | None = None
        self.last_url: str | None = None

    def get(self, url: str, **kwargs):
        self.last_url = url
        return _FakeResponse(self._payload, self.status)

    def post(self, url: str, *, json: Any = None, **kwargs):
        self.last_url = url
        self.last_payload = json
        return _FakeResponse(self._payload, self.status)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False


async def _run_with_mock(adapter_cls, base_url: str, payload: dict[str, Any],
                         status: int, coro):
    """Run ``coro(adapter, session)`` with ``get_shared_session`` mocked."""
    session = _FakeSession(payload, status)
    with patch("app.adapters.adapter_base.get_shared_session",
               new=AsyncMock(return_value=session)):
        adapter = adapter_cls(base_url=base_url)
        return await coro(adapter, session)


# ---------------------------------------------------------------------------
# Atomic Chat adapter
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_atomic_preserves_reasoning_content():
    """``reasoning_content`` from the response surfaces at the result top level."""
    from app.adapters.atomic_chat import AtomicChatAdapter

    resp_payload = {
        "model": "nvidia/Nemotron-3_5-Bolt-E4B-Q4_K_M",
        "created": 1730000000,
        "choices": [{
            "message": {
                "role": "assistant",
                "content": "10",
                "reasoning_content": "Step 1: divide both sides by 2",
            },
        }],
    }

    async def _coro(adapter, session):
        result = await adapter.chat(
            messages=[{"role": "user", "content": "What is 2 * 5?"}],
            think=True,
        )
        return result

    result = await _run_with_mock(
        AtomicChatAdapter, "http://127.0.0.1:1337", resp_payload, 200, _coro,
    )

    assert result["reasoning_content"] == "Step 1: divide both sides by 2"
    assert result["message"]["content"] == "10"
    assert result["model"] == "nvidia/Nemotron-3_5-Bolt-E4B-Q4_K_M"


@pytest.mark.asyncio
async def test_atomic_maps_think_to_chat_template_kwargs():
    """``think=True`` becomes ``chat_template_kwargs: {"enable_thinking": True}``."""
    from app.adapters.atomic_chat import AtomicChatAdapter

    resp_payload = {
        "model": "nvidia/Nemotron-3_5-Bolt-E4B-Q4_K_M",
        "created": 1730000000,
        "choices": [{"message": {"role": "assistant", "content": "ok"}}],
    }

    async def _coro(adapter, session):
        await adapter.chat(
            messages=[{"role": "user", "content": "hi"}],
            think=True,
        )
        return session

    session = await _run_with_mock(
        AtomicChatAdapter, "http://127.0.0.1:1337", resp_payload, 200, _coro,
    )

    payload = session.last_payload
    assert payload is not None
    assert payload.get("chat_template_kwargs") == {"enable_thinking": True}


@pytest.mark.asyncio
async def test_atomic_think_false_disable_reasoning():
    """``think=False`` becomes ``chat_template_kwargs: {"enable_thinking": False}``."""
    from app.adapters.atomic_chat import AtomicChatAdapter

    resp_payload = {
        "model": "nvidia/Nemotron-3_5-Bolt-E4B-Q4_K_M",
        "created": 1730000000,
        "choices": [{"message": {"role": "assistant", "content": "ok"}}],
    }

    async def _coro(adapter, session):
        await adapter.chat(
            messages=[{"role": "user", "content": "hi"}],
            think=False,
        )
        return session

    session = await _run_with_mock(
        AtomicChatAdapter, "http://127.0.0.1:1337", resp_payload, 200, _coro,
    )

    payload = session.last_payload
    assert payload is not None
    assert payload.get("chat_template_kwargs") == {"enable_thinking": False}


@pytest.mark.asyncio
async def test_atomic_no_think_omits_chat_template_kwargs():
    """When ``think`` is None, no ``chat_template_kwargs`` key is sent."""
    from app.adapters.atomic_chat import AtomicChatAdapter

    resp_payload = {
        "model": "nvidia/Nemotron-3_5-Bolt-E4B-Q4_K_M",
        "created": 1730000000,
        "choices": [{"message": {"role": "assistant", "content": "ok"}}],
    }

    async def _coro(adapter, session):
        await adapter.chat(
            messages=[{"role": "user", "content": "hi"}],
        )
        return session

    session = await _run_with_mock(
        AtomicChatAdapter, "http://127.0.0.1:1337", resp_payload, 200, _coro,
    )

    payload = session.last_payload
    assert payload is not None
    assert "chat_template_kwargs" not in payload


@pytest.mark.asyncio
async def test_atomic_adds_reasoning_headroom():
    """``max_tokens`` gets ~200 extra tokens when thinking is on."""
    from app.adapters.atomic_chat import AtomicChatAdapter

    resp_payload = {
        "model": "nvidia/Nemotron-3_5-Bolt-E4B-Q4_K_M",
        "created": 1730000000,
        "choices": [{"message": {"role": "assistant", "content": "ok"}}],
    }

    async def _coro(adapter, session):
        await adapter.chat(
            messages=[{"role": "user", "content": "hi"}],
            think=True,
            options={"max_tokens": 60},
        )
        return session

    session = await _run_with_mock(
        AtomicChatAdapter, "http://127.0.0.1:1337", resp_payload, 200, _coro,
    )

    payload = session.last_payload
    assert payload is not None
    opts = payload.get("options", {})
    assert opts.get("max_tokens") == 260, (
        f"expected max_tokens 260 (60 + 200 headroom), got {opts.get('max_tokens')}"
    )


@pytest.mark.asyncio
async def test_atomic_no_headroom_when_think_false():
    """No headroom added when ``think=False``."""
    from app.adapters.atomic_chat import AtomicChatAdapter

    resp_payload = {
        "model": "nvidia/Nemotron-3_5-Bolt-E4B-Q4_K_M",
        "created": 1730000000,
        "choices": [{"message": {"role": "assistant", "content": "ok"}}],
    }

    async def _coro(adapter, session):
        await adapter.chat(
            messages=[{"role": "user", "content": "hi"}],
            think=False,
            options={"max_tokens": 60},
        )
        return session

    session = await _run_with_mock(
        AtomicChatAdapter, "http://127.0.0.1:1337", resp_payload, 200, _coro,
    )

    payload = session.last_payload
    assert payload is not None
    opts = payload.get("options", {})
    assert opts.get("max_tokens") == 60


# ---------------------------------------------------------------------------
# Ollama adapter
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_ollama_preserves_reasoning_content():
    """Ollama ``reasoning_content`` surfaces at the result top level."""
    from app.adapters.ollama_adapter import OllamaAdapter

    resp_payload = {
        "model": "qwen3.5:4b",
        "created_at": "2026-11-01T00:00:00Z",
        "message": {
            "role": "assistant",
            "content": "10",
            "reasoning_content": "Step 1: divide both sides by 2",
        },
        "done": True,
    }

    async def _coro(adapter, session):
        result = await adapter.chat(
            messages=[{"role": "user", "content": "What is 2 * 5?"}],
            think=True,
        )
        return result

    result = await _run_with_mock(
        OllamaAdapter, "http://127.0.0.1:11434", resp_payload, 200, _coro,
    )

    assert result["reasoning_content"] == "Step 1: divide both sides by 2"
    assert result["message"]["content"] == "10"


@pytest.mark.asyncio
async def test_ollama_maps_think_to_chat_template_kwargs():
    """Ollama ``think=True`` becomes ``chat_template_kwargs: {"enable_thinking": True}``."""
    from app.adapters.ollama_adapter import OllamaAdapter

    resp_payload = {
        "model": "qwen3.5:4b",
        "created_at": "2026-11-01T00:00:00Z",
        "message": {"role": "assistant", "content": "ok"},
        "done": True,
    }

    async def _coro(adapter, session):
        await adapter.chat(
            messages=[{"role": "user", "content": "hi"}],
            think=True,
        )
        return session

    session = await _run_with_mock(
        OllamaAdapter, "http://127.0.0.1:11434", resp_payload, 200, _coro,
    )

    payload = session.last_payload
    assert payload is not None
    assert payload.get("chat_template_kwargs") == {"enable_thinking": True}


@pytest.mark.asyncio
async def test_ollama_adds_reasoning_headroom():
    """Ollama ``max_tokens`` gets ~200 extra tokens when thinking is on."""
    from app.adapters.ollama_adapter import OllamaAdapter

    resp_payload = {
        "model": "qwen3.5:4b",
        "created_at": "2026-11-01T00:00:00Z",
        "message": {"role": "assistant", "content": "ok"},
        "done": True,
    }

    async def _coro(adapter, session):
        await adapter.chat(
            messages=[{"role": "user", "content": "hi"}],
            think=True,
            options={"max_tokens": 60},
        )
        return session

    session = await _run_with_mock(
        OllamaAdapter, "http://127.0.0.1:11434", resp_payload, 200, _coro,
    )

    payload = session.last_payload
    assert payload is not None
    opts = payload.get("options", {})
    assert opts.get("max_tokens") == 260, (
        f"expected max_tokens 260 (60 + 200 headroom), got {opts.get('max_tokens')}"
    )


# ---------------------------------------------------------------------------
# Route truth logging
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_atomic_logs_route_atomic_chat(caplog):
    """Atomic chat logs include [route=atomic-chat]."""
    from app.adapters.atomic_chat import AtomicChatAdapter

    resp_payload = {
        "model": "nvidia/Nemotron-3_5-Bolt-E4B-Q4_K_M",
        "created": 1730000000,
        "choices": [{"message": {"role": "assistant", "content": "ok"}}],
    }

    async def _coro(adapter, session):
        await adapter.chat(
            messages=[{"role": "user", "content": "hi"}],
            think=True,
        )

    await _run_with_mock(
        AtomicChatAdapter, "http://127.0.0.1:1337", resp_payload, 200, _coro,
    )

    route_logs = [r for r in caplog.records if "route=atomic-chat" in r.getMessage()]
    assert route_logs, "expected a log line containing [route=atomic-chat]"


@pytest.mark.asyncio
async def test_ollama_logs_route_ollama(caplog):
    """Ollama chat logs include [route=ollama]."""
    from app.adapters.ollama_adapter import OllamaAdapter

    resp_payload = {
        "model": "qwen3.5:4b",
        "created_at": "2026-11-01T00:00:00Z",
        "message": {"role": "assistant", "content": "ok"},
        "done": True,
    }

    async def _coro(adapter, session):
        await adapter.chat(
            messages=[{"role": "user", "content": "hi"}],
            think=True,
        )

    await _run_with_mock(
        OllamaAdapter, "http://127.0.0.1:11434", resp_payload, 200, _coro,
    )

    route_logs = [r for r in caplog.records if "route=ollama" in r.getMessage()]
    assert route_logs, "expected a log line containing [route=ollama]"
