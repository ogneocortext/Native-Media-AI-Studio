"""
Shared pytest fixtures for the Native Media AI Studio backend test suite.

Provides:
- Temporary SQLite database isolated per test
- Async HTTP test client for FastAPI app
- Isolated QueueManager / SSEManager / ConnectionManager instances
- Mock adapter registry to avoid hitting real external services
"""

from __future__ import annotations

import asyncio
from typing import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from pathlib import Path

# ---------------------------------------------------------------------------
# Ensure the backend package is importable when running pytest from the
# package root (``packages/backend``).
# ---------------------------------------------------------------------------
BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in __import__("sys").path:
    __import__("sys").path.insert(0, str(BACKEND_ROOT))

from app.core import database as database_module  # noqa: E402
from app.main import app  # noqa: E402
from app.adapters.registry import AdapterRegistry, BaseAdapter  # noqa: E402
from app.queue.manager import QueueManager  # noqa: E402
from app.queue.processor import JobProcessor  # noqa: E402
from app.sse.handler import SSEManager  # noqa: E402
from app.websocket.handler import ConnectionManager  # noqa: E402
from app.models.job import Job, JobStatus, JobType  # noqa: E402


# ===========================================================================
# Database fixture
# ===========================================================================

@pytest.fixture(autouse=False)
def temp_db(tmp_path, monkeypatch):
    """Point the database at a throwaway file for the test duration.

    Usage::

        def test_something(temp_db):
            ...
    """
    db_path = tmp_path / "test_studio.db"
    monkeypatch.setattr(database_module, "DB_PATH", db_path)
    database_module.init_db()
    yield db_path
    # No explicit cleanup needed — tmp_path is removed by pytest.


# ===========================================================================
# FastAPI test client
# ===========================================================================

@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    """Async HTTP client against the FastAPI app (no real network)."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# ===========================================================================
# Queue / SSE / WebSocket manager fixtures
# ===========================================================================

@pytest_asyncio.fixture
async def queue_manager_instance() -> QueueManager:
    """Fresh QueueManager with no jobs and no subscribers."""
    qm = QueueManager()
    qm._jobs.clear()
    qm._subscribers.clear()
    return qm


@pytest_asyncio.fixture
async def sse_manager_instance() -> SSEManager:
    """Fresh SSEManager with no connections."""
    mgr = SSEManager()
    mgr._active_connections.clear()
    return mgr


@pytest_asyncio.fixture
async def connection_manager_instance() -> ConnectionManager:
    """Fresh ConnectionManager with no connections."""
    mgr = ConnectionManager()
    mgr._active_connections.clear()
    return mgr


# ===========================================================================
# Mock adapter fixtures
# ===========================================================================

class MockAdapter(BaseAdapter):
    """Minimal adapter that can be configured for health_check responses."""

    def __init__(self, name: str = "mock", healthy: bool = True, base_url: str = "http://mock"):
        self._name = name
        self._healthy = healthy
        self._base_url = base_url
        self._status = "online" if healthy else "offline"
        self._last_error: str | None = None

    @property
    def name(self) -> str:
        return self._name

    @property
    def base_url(self) -> str:
        return self._base_url

    async def health_check(self) -> bool:
        return self._healthy

    def get_status(self):
        from app.adapters.base import AdapterStatus
        return AdapterStatus.ONLINE if self._healthy else AdapterStatus.OFFLINE

    def get_last_error(self):
        return self._last_error

    async def close(self):
        pass


@pytest.fixture
def mock_adapter_registry(monkeypatch):
    """Return a registry pre-loaded with mock adapters (no real network)."""
    registry = AdapterRegistry()
    registry._adapters = {
        "comfyui": MockAdapter(name="comfyui", healthy=True, base_url="http://127.0.0.1:8188"),
        "ollama": MockAdapter(name="ollama", healthy=True, base_url="http://127.0.0.1:11434"),
    }
    registry._initialized = True

    # Patch the global singleton so imports pick up the mock registry
    monkeypatch.setattr("app.adapters.registry.adapter_registry", registry)
    monkeypatch.setattr("app.diagnostics.health.adapter_registry", registry)
    monkeypatch.setattr("app.main.adapter_registry", registry)
    return registry


@pytest.fixture
def mock_adapter_offline(monkeypatch):
    """Registry where the comfyui adapter is offline."""
    registry = AdapterRegistry()
    registry._adapters = {
        "comfyui": MockAdapter(name="comfyui", healthy=False, base_url="http://127.0.0.1:8188"),
        "ollama": MockAdapter(name="ollama", healthy=True, base_url="http://127.0.1:11434"),
    }
    registry._initialized = True
    monkeypatch.setattr("app.adapters.registry.adapter_registry", registry)
    monkeypatch.setattr("app.diagnostics.health.adapter_registry", registry)
    monkeypatch.setattr("app.main.adapter_registry", registry)
    return registry


# ===========================================================================
# Job factory helper
# ===========================================================================

@pytest.fixture
def make_job():
    """Factory fixture to create jobs in the database."""
    created: list[Job] = []

    def _make(
        job_type: JobType = JobType.IMAGE_GENERATION,
        status: JobStatus = JobStatus.QUEUED,
        **overrides,
    ) -> Job:
        job = Job(job_type=job_type, status=status, **overrides)
        from app.queue.db_manager import JobDatabaseManager
        JobDatabaseManager.create_job(job)
        created.append(job)
        return job

    yield _make

    # Best-effort cleanup
    from app.queue.db_manager import JobDatabaseManager
    for job in created:
        try:
            JobDatabaseManager.delete_job(job.id)
        except Exception:
            pass
