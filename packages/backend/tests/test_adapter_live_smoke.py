"""
Live smoke tests for the local-model adapters — T-MOD-04 step 6, executable.

The unit tests in test_adapter_reasoning.py mock the HTTP layer; they prove
the adapter code, not that a real server answers. These tests close that
gap: they run only when the service port is actually open (probed at import
time, the same pattern test_mastering.py uses for ffmpeg), and skip cleanly
otherwise, so the default suite stays green on any machine.

Run them deliberately when the services are up:

    pytest tests/test_adapter_live_smoke.py -m integration -v

Atomic Chat must be open with a model loaded (it serves exactly one model;
the adapter discovers it from /v1/models). Ollama is checked for health
only — which model is resident is the operator's choice.
"""

from __future__ import annotations

import socket

import pytest

pytestmark = pytest.mark.integration

ATOMIC_URL = "http://127.0.0.1:1337"
OLLAMA_URL = "http://127.0.0.1:11434"


def _port_open(port: int, timeout: float = 1.0) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=timeout):
            return True
    except OSError:
        return False


requires_atomic = pytest.mark.skipif(
    not _port_open(1337), reason="Atomic Chat not listening on 127.0.0.1:1337"
)
requires_ollama = pytest.mark.skipif(
    not _port_open(11434), reason="Ollama not listening on 127.0.0.1:11434"
)


@requires_atomic
@pytest.mark.asyncio
async def test_atomic_health_check_live():
    from app.adapters.atomic_chat import AtomicChatAdapter

    adapter = AtomicChatAdapter(ATOMIC_URL)
    assert await adapter.health_check() is True


@requires_atomic
@pytest.mark.asyncio
async def test_atomic_chat_roundtrip_live():
    """A real completion through the resident model (T-MOD-04 step 6).

    think=False keeps this cheap and deterministic in shape: the contract
    under test is transport + response normalization, not reasoning.
    """
    from app.adapters.atomic_chat import AtomicChatAdapter

    adapter = AtomicChatAdapter(ATOMIC_URL)
    result = await adapter.chat(
        messages=[{"role": "user", "content": "Reply with the single word: ready"}],
        think=False,
    )
    assert result.get("model"), result
    content = (result.get("message") or {}).get("content") or ""
    assert content.strip(), f"empty content in live response: {result!r}"


@requires_ollama
@pytest.mark.asyncio
async def test_ollama_health_check_live():
    from app.adapters.ollama_adapter import OllamaAdapter

    adapter = OllamaAdapter(OLLAMA_URL)
    assert await adapter.health_check() is True
