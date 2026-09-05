"""
Tests for WebSocket connection limits:
- Max connections cap rejects excess clients with code 4001
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.websocket.handler import ConnectionManager


@pytest.mark.asyncio
async def test_websocket_rejects_at_capacity():
    """ConnectionManager.connect() must close excess WebSockets with code 4001."""
    manager = ConnectionManager()
    manager._active_connections.clear()
    manager._max_connections = 2

    ws1 = MagicMock()
    ws2 = MagicMock()
    ws3 = MagicMock()
    ws1.accept = AsyncMock()
    ws2.accept = AsyncMock()
    ws3.accept = AsyncMock()
    ws1.close = AsyncMock()
    ws2.close = AsyncMock()
    ws3.close = AsyncMock()

    # Fill to capacity
    manager._active_connections.add(ws1)
    manager._active_connections.add(ws2)

    # Third connection should be rejected
    await manager.connect(ws3)

    ws3.close.assert_called_once()
    call_kwargs = ws3.close.call_args
    assert call_kwargs.kwargs.get("code") == 4001 or call_kwargs[1].get("code") == 4001, (
        "Rejected WS should be closed with code 4001"
    )
    assert ws3 not in manager._active_connections


@pytest.mark.asyncio
async def test_websocket_accepts_under_capacity():
    """ConnectionManager.connect() should accept connections below max."""
    manager = ConnectionManager()
    manager._active_connections.clear()
    manager._max_connections = 5

    ws = MagicMock()
    ws.accept = AsyncMock()
    ws.close = AsyncMock()

    await manager.connect(ws)

    ws.accept.assert_called_once()
    ws.close.assert_not_called()
    assert ws in manager._active_connections


@pytest.mark.asyncio
async def test_websocket_disconnect_removes_connection():
    """disconnect() must remove the WebSocket from active set."""
    manager = ConnectionManager()
    manager._active_connections.clear()

    ws = MagicMock()
    manager._active_connections.add(ws)

    await manager.disconnect(ws)

    assert ws not in manager._active_connections
