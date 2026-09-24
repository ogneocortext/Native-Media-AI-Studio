"""Backend integration tests for the full pipeline API surface.

Uses FastAPI's TestClient (via conftest.py `client` fixture) to verify
that the frontend can successfully call the backend endpoints that make
up the music-video pipeline.

Test coverage maps to the P1b phase of [[e2e-test-plan-2026]].
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


pytestmark = pytest.mark.asyncio


async def test_health_endpoint_returns_online(client):
    """The health page is the first integration point the frontend checks."""
    resp = await client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["backend"] == "online"
    assert "adapters" in data


async def test_job_types_endpoint_lists_available_types(client):
    """Frontend job submission forms need the allowed job types."""
    resp = await client.get("/api/jobs/types")
    assert resp.status_code == 200
    data = resp.json()
    assert "types" in data
    assert isinstance(data["types"], list)
    assert len(data["types"]) > 0


async def test_queue_stats_endpoint_returns_counts(client, make_job):
    """The queue page reads stats to render Total/Pending/Running/Completed/Failed."""
    make_job(job_type="image_generation", status="queued")
    make_job(job_type="image_generation", status="running")
    make_job(job_type="image_generation", status="completed")

    resp = await client.get("/api/jobs/stats")
    assert resp.status_code == 200
    stats = resp.json()
    assert stats["pending"] >= 0
    assert stats["running"] >= 0
    assert stats["completed"] >= 0
    assert stats["total_jobs"] >= 0


async def test_list_jobs_returns_created_jobs(client, make_job):
    """Queue page fetches /api/jobs to render job cards."""
    make_job(job_type="image_generation", status="queued")

    resp = await client.get("/api/jobs")
    assert resp.status_code == 200
    jobs = resp.json()
    assert isinstance(jobs, list)
    assert len(jobs) >= 1


async def test_comfyui_models_endpoint_returns_list(client):
    """3D generation page checks available checkpoints."""
    resp = await client.get("/api/integrations/comfyui/checkpoints")
    assert resp.status_code == 200
    data = resp.json()
    assert "checkpoints" in data
    assert isinstance(data["checkpoints"], list)


async def test_video_models_endpoint_returns_tiers(client):
    """Video generation page reads model list with 8GB tier tags."""
    resp = await client.get("/api/integrations/comfyui/video-models")
    assert resp.status_code == 200
    data = resp.json()
    assert "video_models" in data
    assert isinstance(data["video_models"], list)


async def test_audio_files_endpoint_returns_list(client):
    """Audio analysis page lists available tracks."""
    resp = await client.get("/api/audio/files")
    assert resp.status_code == 200
    data = resp.json()
    assert "files" in data
    assert isinstance(data["files"], list)
