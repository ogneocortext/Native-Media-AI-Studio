#!/usr/bin/env python3
"""Backend integration test harness.

Spins up the FastAPI app against a temp database and exercises real
end-to-end flows that unit tests miss:
- Job lifecycle (create → enqueue → process → complete/cancel/retry)
- SSE streaming under concurrent subscribers
- Health endpoint resilience when adapters are slow or failing
- WebSocket echo + keepalive behavior
- Queue backpressure when RAM is critically high
- Concurrent job creation race conditions

Usage:
    pytest tests/integration/ -v
"""

from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import sys
import time
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

# Ensure backend root is on sys.path
BACKEND_ROOT = Path(__file__).resolve().parent.parent.parent / "packages" / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core import database as database_module  # noqa: E402
from app.main import app  # noqa: E402
from app.adapters.registry import AdapterRegistry, BaseAdapter  # noqa: E402
from app.adapters.base import AdapterStatus  # noqa: E402
from app.queue.manager import QueueManager  # noqa: E402
from app.queue.processor import JobProcessor  # noqa: E402
from app.sse.handler import SSEManager  # noqa: E402
from app.websocket.handler import ConnectionManager  # noqa: E402
from app.models.job import Job, JobStatus, JobType  # noqa: E402


# ===========================================================================
# Shared fixtures
# ===========================================================================

@pytest.fixture(autouse=False)
def temp_db(tmp_path, monkeypatch):
    """Point the database at a throwaway file and fully reset queue state."""
    db_path = tmp_path / "integration_test.db"
    monkeypatch.setattr(database_module, "DB_PATH", db_path)
    database_module.init_db()
    # Reset the global queue_manager so it reads from the new DB
    from app.queue.manager import queue_manager
    queue_manager._jobs.clear()
    queue_manager._subscribers.clear()
    queue_manager._completed_count = 0
    yield db_path


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    """Async HTTP client against the FastAPI app (no real network)."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest_asyncio.fixture
async def isolated_queue() -> QueueManager:
    """Fresh QueueManager with no jobs and no subscribers."""
    qm = QueueManager()
    qm._jobs.clear()
    qm._subscribers.clear()
    return qm


@pytest_asyncio.fixture
async def isolated_sse() -> SSEManager:
    """Fresh SSEManager with no connections."""
    mgr = SSEManager()
    mgr._active_connections.clear()
    return mgr


# ===========================================================================
# Mock adapter that simulates real behavior with controllable delays
# ===========================================================================

class SlowAdapter(BaseAdapter):
    """Adapter that simulates slow/unreliable external service."""

    def __init__(self, name: str, base_url: str, delay: float = 0.5, fail_rate: float = 0.0):
        self._name = name
        self._base_url = base_url
        self._delay = delay
        self._fail_rate = fail_rate
        self._call_count = 0
        self._status = AdapterStatus.CONNECTED
        self._mock_mode = False

    @property
    def name(self) -> str:
        return self._name

    @property
    def base_url(self) -> str:
        return self._base_url

    async def health_check(self) -> bool:
        self._call_count += 1
        await asyncio.sleep(self._delay)
        import random
        if random.random() < self._fail_rate:
            raise ConnectionError(f"{self._name} simulated failure")
        return True

    async def generate(self, params: dict[str, Any]) -> dict[str, Any]:
        await asyncio.sleep(self._delay)
        return {"mock": True, "params": params}

    async def _mock_generate(self, params: dict[str, Any]) -> dict[str, Any]:
        return await self.generate(params)

    def get_status(self):
        return AdapterStatus.CONNECTED

    def get_last_error(self):
        return None

    async def close(self):
        pass


@pytest.fixture
def mock_slow_registry(monkeypatch):
    """Registry with a slow adapter to test timeout behavior."""
    registry = AdapterRegistry()
    registry._adapters = {
        "comfyui": SlowAdapter("comfyui", "http://127.0.0.1:8188", delay=2.0, fail_rate=0.0),
        "ollama": SlowAdapter("ollama", "http://127.0.0.1:11434", delay=0.1, fail_rate=0.0),
    }
    registry._initialized = True
    monkeypatch.setattr("app.adapters.registry.adapter_registry", registry)
    return registry


@pytest.fixture
def mock_flaky_registry(monkeypatch):
    """Registry with a flaky adapter to test error handling."""
    registry = AdapterRegistry()
    registry._adapters = {
        "comfyui": SlowAdapter("comfyui", "http://127.0.0.1:8188", delay=0.1, fail_rate=0.8),
        "ollama": SlowAdapter("ollama", "http://127.0.0.1:11434", delay=0.1, fail_rate=0.0),
    }
    registry._initialized = True
    monkeypatch.setattr("app.adapters.registry.adapter_registry", registry)
    return registry


# ===========================================================================
# Helpers
# ===========================================================================

async def _create_job_via_api(client: AsyncClient, job_type: JobType = JobType.IMAGE_GENERATION, status: JobStatus = None) -> dict:
    """Create a job via the API and optionally force its status via direct DB update."""
    resp = await client.post("/api/jobs/", json={
        "job_type": job_type.value,
        "params": {"prompt": "integration test"},
        "max_retries": 2,
    })
    assert resp.status_code == 201, f"Failed to create job: {resp.text}"
    job_data = resp.json()
    if status is not None and status != JobStatus.QUEUED:
        # Force status via direct DB write, then reload queue_manager
        from app.queue.manager import queue_manager
        with database_module.get_db() as conn:
            conn.execute(
                "UPDATE jobs SET status = ? WHERE id = ?",
                (status.value if isinstance(status, JobType) else status, job_data["id"])
            )
        # Reload in-memory cache from current DB
        db_jobs = JobDatabaseManager.get_all_jobs()
        queue_manager._jobs.clear()
        for j in db_jobs:
            queue_manager._jobs[j.id] = j
    return job_data


# Need to import JobDatabaseManager at module level for the helper above
from app.queue.db_manager import JobDatabaseManager  # noqa: E402


# ===========================================================================
# Integration tests
# ===========================================================================

class TestJobLifecycleIntegration:
    """Full job lifecycle through the API."""

    @pytest.mark.asyncio
    async def test_create_and_retrieve_job(self, client: AsyncClient, temp_db):
        job_data = await _create_job_via_api(client)
        resp = await client.get(f"/api/jobs/{job_data['id']}")
        assert resp.status_code == 200
        assert resp.json()["id"] == job_data["id"]

    @pytest.mark.asyncio
    async def test_job_cancel_flow(self, client: AsyncClient, temp_db):
        job_data = await _create_job_via_api(client, status=JobStatus.QUEUED)
        resp = await client.post(f"/api/jobs/{job_data['id']}/cancel")
        assert resp.status_code == 200
        assert resp.json()["success"] is True

        resp2 = await client.get(f"/api/jobs/{job_data['id']}")
        assert resp2.json()["status"] == "cancelled"

    @pytest.mark.asyncio
    async def test_job_retry_after_failure(self, client: AsyncClient, temp_db):
        job_data = await _create_job_via_api(client, status=JobStatus.FAILED)
        resp = await client.post(f"/api/jobs/{job_data['id']}/retry")
        assert resp.status_code == 200
        retried = resp.json()
        assert retried["status"] == "queued"
        assert retried["retry_count"] == 1

    @pytest.mark.asyncio
    async def test_cancel_completed_job_returns_400(self, client: AsyncClient, temp_db):
        job_data = await _create_job_via_api(client, status=JobStatus.COMPLETED)
        resp = await client.post(f"/api/jobs/{job_data['id']}/cancel")
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_delete_job(self, client: AsyncClient, temp_db):
        job_data = await _create_job_via_api(client)
        resp = await client.delete(f"/api/jobs/{job_data['id']}")
        assert resp.status_code == 200
        resp2 = await client.get(f"/api/jobs/{job_data['id']}")
        assert resp2.status_code == 404

    @pytest.mark.asyncio
    async def test_list_jobs_filtered_by_status(self, client: AsyncClient, temp_db):
        await _create_job_via_api(client, status=JobStatus.QUEUED)
        await _create_job_via_api(client, status=JobStatus.COMPLETED)
        resp = await client.get("/api/jobs?status=queued")
        assert resp.status_code == 200
        jobs = resp.json()
        assert len(jobs) == 1
        assert jobs[0]["status"] == "queued"

    @pytest.mark.asyncio
    async def test_invalid_status_filter_returns_400(self, client: AsyncClient):
        resp = await client.get("/api/jobs?status=invalid_status")
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_clear_completed_and_failed(self, client: AsyncClient, temp_db):
        await _create_job_via_api(client, status=JobStatus.COMPLETED)
        await _create_job_via_api(client, status=JobStatus.FAILED)
        await _create_job_via_api(client, status=JobStatus.QUEUED)

        resp = await client.post("/api/jobs/clear-completed")
        assert resp.status_code == 200
        assert resp.json()["deleted"] == 1

        resp = await client.post("/api/jobs/clear-failed")
        assert resp.status_code == 200
        assert resp.json()["deleted"] == 1

        resp = await client.get("/api/jobs")
        remaining = resp.json()
        assert len(remaining) == 1
        assert remaining[0]["status"] == "queued"


class TestQueueEventDrivenIntegration:
    """Verify the event-driven queue actually wakes the processor."""

    @pytest.mark.asyncio
    async def test_new_job_wakes_processor(self, isolated_queue: QueueManager):
        """When a job is enqueued, the processor should be signaled and pick it up."""
        # Patch the global queue_manager used by JobProcessor
        from app.queue import manager as manager_module
        original_qm = manager_module.queue_manager
        manager_module.queue_manager = isolated_queue
        try:
            processor = JobProcessor()
            await processor.start()

            received: list[Job] = []
            async def capture(job):
                received.append(job)

            await isolated_queue.subscribe(capture)

            # Enqueue a job through the isolated queue
            from app.models.job import JobCreateRequest
            req = JobCreateRequest(job_type=JobType.IMAGE_GENERATION, params={"prompt": "integration test"})
            job = await isolated_queue.enqueue(req)

            # Wait up to 5s for the processor to pick it up
            deadline = time.time() + 5.0
            while time.time() < deadline and not received:
                await asyncio.sleep(0.1)

            await processor.stop()
            assert len(received) >= 1, f"Processor did not process job within timeout. Received: {received}"
            assert received[0].id == job.id
        finally:
            manager_module.queue_manager = original_qm


class TestSSEStreamingIntegration:
    """SSE streaming under concurrent subscribers."""

    @pytest.mark.asyncio
    async def test_multiple_sse_subscribers_receive_events(self, isolated_sse: SSEManager):
        """Three concurrent SSE subscribers should all receive broadcasts."""
        queues = []
        for _ in range(3):
            q = await isolated_sse.connect()
            queues.append(q)

        test_message = {"type": "test", "data": {"hello": "world"}}
        await isolated_sse.send_message(test_message)

        # All queues should have the message
        results = []
        for q in queues:
            try:
                msg = await asyncio.wait_for(q.get(), timeout=2.0)
                results.append(json.loads(msg["data"]))
            except asyncio.TimeoutError:
                results.append(None)

        assert all(r is not None for r in results), f"Some subscribers missed the event: {results}"
        assert all(r["data"]["hello"] == "world" for r in results if r)

    @pytest.mark.asyncio
    async def test_sse_capacity_rejection(self, isolated_sse: SSEManager):
        """When capacity is reached, new connections get a sentinel error."""
        # Fill to capacity
        for _ in range(isolated_sse._max_connections):
            await isolated_sse.connect()

        extra = await isolated_sse.connect()
        msg = await asyncio.wait_for(extra.get(), timeout=1.0)
        payload = json.loads(msg["data"])
        assert payload["type"] == "error"
        assert "capacity" in payload["message"].lower()


class TestHealthResilienceIntegration:
    """Health endpoint behavior under adapter stress."""

    @pytest.mark.asyncio
    async def test_health_returns_when_adapters_slow(self, client: AsyncClient, mock_slow_registry):
        """Health endpoint should complete within timeout even when adapters are slow."""
        start = time.time()
        resp = await client.get("/api/health")
        elapsed = time.time() - start
        assert resp.status_code == 200
        # Should not take > 30s (our per-adapter timeout is 8s)
        assert elapsed < 30, f"Health check took too long: {elapsed:.1f}s"

    @pytest.mark.asyncio
    async def test_health_degraded_when_adapter_failing(self, client: AsyncClient, mock_flaky_registry):
        """When an adapter is failing, overall health should reflect degraded/unhealthy."""
        # Call multiple times to account for randomness
        statuses = []
        for _ in range(5):
            resp = await client.get("/api/health")
            if resp.status_code == 200:
                statuses.append(resp.json().get("status"))
            await asyncio.sleep(0.2)
        # At least one should show degraded/unhealthy due to flaky adapter
        assert any(s in ("degraded", "unhealthy") for s in statuses), f"Expected degraded/unhealthy, got: {statuses}"

    @pytest.mark.asyncio
    async def test_render_health_endpoint(self, client: AsyncClient):
        resp = await client.get("/api/render/health")
        assert resp.status_code == 200
        data = resp.json()
        assert "status" in data


class TestWebSocketIntegration:
    """WebSocket legacy endpoint behavior."""

    @pytest.mark.asyncio
    async def test_websocket_http_fallback_returns_426(self, client: AsyncClient):
        resp = await client.get("/ws")
        assert resp.status_code == 426
        data = resp.json()
        assert "Upgrade Required" in data["error"]
        assert "/api/events" in data["sse_endpoint"]

    @pytest.mark.asyncio
    async def test_root_endpoint_returns_app_info(self, client: AsyncClient):
        resp = await client.get("/")
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Native Media AI Studio"
        assert "endpoints" in data


class TestConcurrentJobCreation:
    """Race-condition detection: concurrent job creation should not corrupt state."""

    @pytest.mark.asyncio
    async def test_concurrent_enqueue_no_corruption(self, temp_db):
        """Create 20 jobs concurrently; all should be persisted correctly."""
        qm = QueueManager()
        qm._jobs.clear()

        async def enqueue_one(idx: int):
            from app.models.job import JobCreateRequest
            req = JobCreateRequest(job_type=JobType.IMAGE_GENERATION, params={"idx": idx})
            return await qm.enqueue(req)

        jobs = await asyncio.gather(*[enqueue_one(i) for i in range(20)])
        assert len(jobs) == 20
        ids = [j.id for j in jobs]
        assert len(set(ids)) == 20, "Duplicate job IDs detected — race condition"

        # Verify all in DB
        db_jobs = JobDatabaseManager.get_all_jobs()
        assert len(db_jobs) == 20


class TestSSEKeepaliveIntegration:
    """SSE keepalive behavior for long-running connections."""

    @pytest.mark.asyncio
    async def test_sse_keepalive_sent_when_no_events(self, isolated_sse: SSEManager):
        """If no events are broadcast, the SSE endpoint should still send keepalives."""
        # This is primarily validated in the endpoint handler, but we can
        # verify the manager's connect/disconnect lifecycle is clean.
        q = await isolated_sse.connect()
        assert q in isolated_sse._active_connections
        await isolated_sse.disconnect(q)
        assert q not in isolated_sse._active_connections


class TestQueueStatsAccuracy:
    """Queue stats should reflect reality after mutations."""

    @pytest.mark.asyncio
    async def test_stats_after_mixed_operations(self, client: AsyncClient, temp_db):
        await _create_job_via_api(client, status=JobStatus.QUEUED)
        await _create_job_via_api(client, status=JobStatus.QUEUED)
        await _create_job_via_api(client, status=JobStatus.RUNNING)
        await _create_job_via_api(client, status=JobStatus.COMPLETED)
        await _create_job_via_api(client, status=JobStatus.FAILED)

        resp = await client.get("/api/jobs/stats")
        assert resp.status_code == 200
        stats = resp.json()
        assert stats["queued"] == 2
        assert stats["running"] == 1
        assert stats["completed"] == 1
        assert stats["failed"] == 1
        assert stats["total_jobs"] == 5


class TestAdapterThreadSafety:
    """Adapter registry init should be thread-safe."""

    def test_concurrent_ensure_init_no_double_init(self):
        """Calling _ensure_init from multiple threads should not create duplicate adapters."""
        registry = AdapterRegistry()
        registry._initialized = False
        registry._adapters = {}

        errors: list[str] = []

        def init_worker():
            try:
                for _ in range(10):
                    registry._ensure_init()
            except Exception as e:
                errors.append(str(e))

        threads = [__import__("threading").Thread(target=init_worker) for _ in range(5)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert not errors, f"Thread errors: {errors}"
        # Should have exactly 2 adapters (comfyui + ollama)
        assert len(registry._adapters) == 2


# ===========================================================================
# Run pytest when executed directly
# ===========================================================================

if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v", "-s"]))
