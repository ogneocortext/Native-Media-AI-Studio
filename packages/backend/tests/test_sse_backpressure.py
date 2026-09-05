"""
Tests for SSE backpressure and connection limits:
- Max connections cap rejects new connections
- Slow consumers are dropped after queue_put_timeout
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.sse.handler import SSEManager


@pytest.mark.asyncio
async def test_sse_rejects_connection_at_capacity():
    """SSEManager.connect() must return an error queue when at max_connections."""
    manager = SSEManager()
    manager._active_connections.clear()
    manager._max_connections = 2

    # Fill to capacity with dummy queues
    q1 = asyncio.Queue()
    q2 = asyncio.Queue()
    manager._active_connections.extend([q1, q2])

    # Next connection should get a sentinel error
    new_queue = await manager.connect()

    assert new_queue is not None
    # The queue should contain a server-at-capacity error event
    event = await asyncio.wait_for(new_queue.get(), timeout=0.5)
    payload = json.loads(event["data"])
    assert "capacity" in payload.get("message", "").lower() or "Server at capacity" in payload.get("message", ""), (
        f"Expected capacity error message, got {payload}"
    )


@pytest.mark.asyncio
async def test_sse_drops_slow_consumer_on_timeout():
    """A client whose queue.put blocks past _queue_put_timeout is dropped."""
    manager = SSEManager()
    manager._active_connections.clear()
    manager._max_connections = 50
    manager._queue_put_timeout = 0.1

    # Create a queue that blocks forever on put()
    slow_queue = asyncio.Queue()
    original_put = slow_queue.put

    async def blocking_put(*args, **kwargs):
        await asyncio.sleep(10)  # block past timeout
        return await original_put(*args, **kwargs)

    slow_queue.put = blocking_put  # type: ignore[method-assign]
    manager._active_connections.append(slow_queue)

    # This should not hang; the slow client should be dropped
    await manager.send_message({"type": "test", "data": "hello"})

    assert slow_queue not in manager._active_connections, (
        "Slow client should be removed from active connections"
    )


@pytest.mark.asyncio
async def test_sse_broadcast_to_all_active_clients():
    """send_message must deliver events to every non-blocking client."""
    manager = SSEManager()
    manager._active_connections.clear()
    manager._max_connections = 50

    q1 = asyncio.Queue()
    q2 = asyncio.Queue()
    manager._active_connections.extend([q1, q2])

    await manager.send_message({"type": "health", "data": "ok"})

    # Both queues should have received the event
    msg1 = await asyncio.wait_for(q1.get(), timeout=0.5)
    msg2 = await asyncio.wait_for(q2.get(), timeout=0.5)

    payload1 = json.loads(msg1["data"])
    payload2 = json.loads(msg2["data"])
    assert payload1["type"] == "health"
    assert payload2["type"] == "health"
