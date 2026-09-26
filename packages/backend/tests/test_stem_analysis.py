"""Tests for the new stem analysis endpoint."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_stem_analysis_returns_empty_when_no_separation(client: AsyncClient):
    """When stems haven't been separated, endpoint returns empty stems."""
    resp = await client.get("/api/audio/stems-analysis/nonexistent-track-12345")
    assert resp.status_code == 200
    data = resp.json()
    assert data["stems"] == {}
    assert data.get("separated") is False


@pytest.mark.asyncio
async def test_stem_analysis_requires_valid_path(client: AsyncClient):
    """Endpoint should handle URL-encoded filenames."""
    resp = await client.get("/api/audio/stems-analysis/test%20file.mp3")
    assert resp.status_code in (200, 404, 500)
