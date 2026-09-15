"""
Tests for the dynamic CORS origin fix:
- The allowlist is built from config (not hardcoded) in app.core.cors
- WebSocket origin validation uses the same dynamic set
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.config import config
from app.core.cors import get_local_origins, is_local_origin
from app.main import app

# The allowlist is centralized in app.core.cors; app.main consumes it for both
# the CORS middleware and the WebSocket origin check.
_local_origins = get_local_origins()


def test_local_origins_contains_configured_ports():
    """_local_origins must include both the configured backend and frontend ports."""
    expected_backend = f"http://localhost:{config.backend_port}"
    expected_frontend = f"http://localhost:{config.frontend_port}"

    assert expected_backend in _local_origins, (
        f"Backend origin {expected_backend} missing from CORS allowlist"
    )
    assert expected_frontend in _local_origins, (
        f"Frontend origin {expected_frontend} missing from CORS allowlist"
    )


def test_local_origins_includes_127_loopback():
    """The allowlist must include 127.0.0.1 variants for local tools."""
    assert any(o.startswith("http://127.0.0.1:") for o in _local_origins), (
        "127.0.0.1 loopback origins missing from CORS allowlist"
    )


def test_local_origins_is_set_not_list():
    """_local_origins should be a set (or at least unique) so dedup works."""
    from app.core.cors import get_local_origins

    origins = get_local_origins()

    # Must be iterable and non-empty
    assert len(origins) > 0
    # No duplicates
    assert len(origins) == len(set(origins)), "Duplicate origins in allowlist"


@pytest.mark.asyncio
async def test_cors_middleware_accepts_local_origin():
    """Preflight OPTIONS from a local origin should be accepted."""
    from httpx import ASGITransport, AsyncClient

    # Pick one allowed origin
    allowed_origin = next(iter(_local_origins))

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.options(
            "/api/health",
            headers={
                "Origin": allowed_origin,
                "Access-Control-Request-Method": "GET",
            },
        )

    assert response.status_code in (200, 204), (
        f"CORS preflight failed with {response.status_code}"
    )
    acao = response.headers.get("access-control-allow-origin")
    assert acao == allowed_origin, f"Expected ACAO={allowed_origin}, got {acao}"


@pytest.mark.asyncio
async def test_cors_rejects_unknown_origin():
    """Preflight from an untrusted origin should be denied (no ACAO)."""
    from httpx import ASGITransport, AsyncClient

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.options(
            "/api/health",
            headers={
                "Origin": "https://evil.example.com",
                "Access-Control-Request-Method": "GET",
            },
        )

    acao = response.headers.get("access-control-allow-origin", "")
    assert acao == "", f"Untrusted origin should be rejected, got ACAO={acao}"


def test_is_local_origin_matches_exactly():
    """Origin matching must be exact — a look-alike host must not pass."""
    assert is_local_origin(f"http://127.0.0.1:{config.frontend_port}") is True
    # `startswith`-style matching would wrongly accept these.
    assert is_local_origin("http://127.0.0.1:5173.evil.example.com") is False
    assert is_local_origin("http://evil.example.com") is False
    assert is_local_origin("") is False


@pytest.mark.asyncio
async def test_websocket_rejects_untrusted_origin():
    """WS handler must close untrusted origins with 4001 (regression: NameError).

    The handler previously referenced a removed module-level `_local_origins`,
    raising NameError for every origin-bearing WebSocket handshake.
    """
    from unittest.mock import AsyncMock, MagicMock

    from app.main import websocket_endpoint

    ws = MagicMock()
    ws.headers = {"origin": "https://evil.example.com"}
    ws.close = AsyncMock()
    ws.accept = AsyncMock()

    await websocket_endpoint(ws)

    ws.accept.assert_not_called()
    ws.close.assert_awaited_once()
    assert ws.close.call_args.kwargs.get("code") == 4001


@pytest.mark.asyncio
async def test_websocket_accepts_trusted_origin():
    """A trusted local origin must be accepted and registered."""
    from unittest.mock import AsyncMock, MagicMock

    from app.main import websocket_endpoint
    from app.websocket.handler import connection_manager
    from fastapi import WebSocketDisconnect

    connection_manager._active_connections.clear()

    ws = MagicMock()
    ws.headers = {"origin": f"http://127.0.0.1:{config.frontend_port}"}
    ws.accept = AsyncMock()
    ws.send_text = AsyncMock()
    ws.close = AsyncMock()
    # Terminate the keepalive loop immediately.
    ws.receive_text = AsyncMock(side_effect=WebSocketDisconnect(1000))

    await websocket_endpoint(ws)

    ws.accept.assert_awaited_once()
    ws.close.assert_not_called()
    assert ws not in connection_manager._active_connections
