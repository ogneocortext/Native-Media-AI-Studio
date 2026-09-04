"""
Tests for the high-priority ComfyUI manager fix:
- stderr is piped (not DEVNULL) so startup failures are captured
- a background asyncio task logs ComfyUI stderr lines
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.comfyui_manager import ComfyUIManager


def test_start_pipes_stderr():
    """ComfyUI.start() should pipe stderr so startup errors are captured."""
    manager = ComfyUIManager()

    fake_process = MagicMock()
    fake_process.poll.return_value = None
    fake_process.pid = 12345
    fake_process.stderr = iter(["line1", "line2", ""])

    mock_popen = MagicMock(return_value=fake_process)
    captured_tasks: list[asyncio.Task] = []

    original_create_task = asyncio.create_task

    def capturing_create_task(coro):
        task = original_create_task(coro)
        captured_tasks.append(task)
        return task

    async def fake_sleep(_seconds):
        pass

    with patch("app.services.comfyui_manager.subprocess.Popen", mock_popen), \
         patch("app.services.comfyui_manager.asyncio.sleep", fake_sleep), \
         patch("asyncio.create_task", side_effect=capturing_create_task), \
         patch.object(manager, "is_running", return_value=False), \
         patch.object(manager, "_check_cuda", new_callable=AsyncMock, return_value={"available": True}):
        result = asyncio.run(manager.start(port=8199))

    # Verify Popen was called
    assert mock_popen.called, "subprocess.Popen was not called"

    call_kwargs = mock_popen.call_args[1]
    assert "stderr" in call_kwargs

    # stderr must be PIPE so we can read startup errors
    import subprocess
    assert call_kwargs["stderr"] == subprocess.PIPE, (
        f"stderr should be PIPE, got {call_kwargs['stderr']!r}"
    )

    # stdout should still be discarded to avoid log spam
    assert call_kwargs["stdout"] == subprocess.DEVNULL

    # A background task should have been created to read stderr
    assert len(captured_tasks) >= 1, "Expected at least one background task for stderr logging"

    # The start call itself should succeed
    assert result.get("success") is True
    assert result.get("pid") == 12345
