"""Route-level tests for the remix API surface (`app/api/audio_remix.py`).

These tests exercise the HTTP layer directly so the route shapes documented in
`docs/agent-code-navigation.md` are backed by executable evidence. They use
only safe, read-only or validation-only endpoints — no renders, no builds,
no Ollama calls — so they run without fixture audio or external services.

The navigation doc's remix trace noted "no direct route test was found in
this trace"; this file closes that gap.
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

BACKEND_ROOT = __import__("pathlib").Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in __import__("sys").path:
    __import__("sys").path.insert(0, str(BACKEND_ROOT))

from app.main import app  # noqa: E402


@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.mark.asyncio
async def test_remix_sources_returns_list(client):
    """GET /api/audio/remix/sources always returns a JSON object with a
    "sources" key holding a list (possibly empty when no stems are separated)."""
    response = await client.get("/api/audio/remix/sources")
    assert response.status_code == 200
    body = response.json()
    assert "sources" in body
    assert isinstance(body["sources"], list)


@pytest.mark.asyncio
async def test_remix_probe_unknown_track_400(client):
    """POST /api/audio/remix/probe with a track that has no stems returns 400
    with an error envelope pointing at /sources for available tracks."""
    response = await client.post("/api/audio/remix/probe?track=does-not-exist")
    assert response.status_code == 400
    body = response.json()
    assert body["error"]["code"] == "BAD_REQUEST"
    assert "/api/audio/remix/sources" in body["error"]["message"]


@pytest.mark.asyncio
async def test_remix_probe_missing_track_param_422(client):
    """POST /api/audio/remix/probe without the required `track` query returns 422."""
    response = await client.post("/api/audio/remix/probe")
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_remix_preview_invalid_recipe_400(client):
    """POST /api/audio/remix/preview with a recipe referencing an unavailable
    track/stem returns 400 with an error envelope pointing at /sources."""
    response = await client.post(
        "/api/audio/remix/preview",
        json={
            "name": "test-preview",
            "target_bpm": 120.0,
            "slots": [
                {
                    "layers": [
                        {
                            "track": "does-not-exist",
                            "stem": "vocals",
                        }
                    ],
                    "bars": 4,
                }
            ],
        },
    )
    assert response.status_code == 400
    body = response.json()
    assert body["error"]["code"] == "BAD_REQUEST"
    assert "/api/audio/remix/sources" in body["error"]["message"]


@pytest.mark.asyncio
async def test_remix_preview_empty_recipe_400(client):
    """POST /api/audio/remix/preview with no slots returns 400."""
    response = await client.post(
        "/api/audio/remix/preview",
        json={"name": "test-preview", "target_bpm": 120.0, "slots": []},
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_remix_list_returns_list(client):
    """GET /api/audio/remix/list returns a JSON object with a "remixes" key
    holding a list (possibly empty when no remixes have been rendered)."""
    response = await client.get("/api/audio/remix/list")
    assert response.status_code == 200
    body = response.json()
    assert "remixes" in body
    assert isinstance(body["remixes"], list)


@pytest.mark.asyncio
async def test_remix_by_track_unknown_returns_empty(client):
    """GET /api/audio/remix/by-track/{track} for an unknown track returns 200
    with the track name and an empty remixes list."""
    response = await client.get("/api/audio/remix/by-track/does-not-exist")
    assert response.status_code == 200
    body = response.json()
    assert body["track"] == "does-not-exist"
    assert body["remixes"] == []
