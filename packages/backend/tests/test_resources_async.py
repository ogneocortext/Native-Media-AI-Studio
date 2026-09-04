"""
Tests for the async offloading fix in diagnostics/resources.py:
- _get_ollama_vram_usage uses asyncio.to_thread for blocking urllib
- cleanup_system_memory offloads blocking urllib calls via asyncio.to_thread
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.diagnostics.resources import ResourceMonitor


def test_get_ollama_vram_uses_to_thread():
    """_get_ollama_vram_usage must offload blocking urllib to a thread."""
    monitor = ResourceMonitor()

    # Mock the internal _sync_fetch by mocking the to_thread call
    fake_result = 128  # 128 MB

    async def fake_to_thread(func, *args, **kwargs):
        return fake_result

    with patch.object(asyncio, "to_thread", side_effect=fake_to_thread):
        result = asyncio.run(monitor._get_ollama_vram_usage())

    assert result == fake_result, "Expected to_thread to return the mocked VRAM value"


def test_cleanup_offloads_ollama_call_to_thread():
    """cleanup_system_memory must offload blocking Ollama offload to thread."""
    monitor = ResourceMonitor()

    fake_offload_result = "offloaded ollama test-model"

    async def fake_to_thread(func, *args, **kwargs):
        return fake_offload_result

    with patch.object(asyncio, "to_thread", side_effect=fake_to_thread), \
         patch("psutil.virtual_memory", return_value=MagicMock(percent=90)):
        result = asyncio.run(monitor.cleanup_system_memory())

    # The offload function should have been invoked via to_thread
    assert any("offloaded ollama" in str(a) for a in result.get("actions", [])), (
        f"Expected offload action in result, got {result}"
    )


@pytest.mark.asyncio
async def test_check_memory_does_not_block_event_loop():
    """ResourceMonitor.check_memory is async and must not block."""
    monitor = ResourceMonitor()

    # Should complete quickly without hanging
    result = await asyncio.wait_for(monitor.check_memory(), timeout=2.0)
    # Result is either None or a warning dict
    assert result is None or isinstance(result, dict)
