"""
Tests for the dynamic CORS origin fix in main.py:
- _local_origins is built from config (not hardcoded)
- WebSocket origin validation uses the dynamic set
"""
from __future__ import annotations

import pytest


def test_local_origins_contains_configured_ports():
    """_local_origins must include both the configured backend and frontend ports."""
    from app.main import app, _local_origins
    from app.core.config import config

    expected_backend = f"http://localhost:{config.backend_port}"
    expected_frontend = f"http://localhost:{config.frontend_port}"

    assert expected_backend in _local_origins, (
        f"Backend origin {expected_backend} missing from CORS allowlist"
    )
    assert expected_frontend in _local_origins, (
        f"Frontend origin {expected_frontend} missing from CORS allowlist"
    )


def test_local_origins_includes_127_loopback():
    """_local_origins must include 127.0.0.1 variants for local tools."""
    from app.main import _local_origins

    assert any(o.startswith("http://127.0.0.1:") for o in _local_origins), (
        "127.0.0.1 loopback origins missing from CORS allowlist"
    )


def test_local_origins_is_set_not_list():
    """_local_origins should be a set (or at least unique) so dedup works."""
    from app.main import _local_origins

    # Must be iterable and non-empty
    assert len(_local_origins) > 0
    # No duplicates
    assert len(_local_origins) == len(set(_local_origins)), "Duplicate origins in allowlist"


@pytest.mark.asyncio
async def test_cors_middleware_accepts_local_origin():
    """Preflight OPTIONS from a local origin should be accepted."""
    from app.main import app, _local_origins
    from httpx import AsyncClient, ASGITransport

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
    from app.main import app
    from httpx import AsyncClient, ASGITransport

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
