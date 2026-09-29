"""
Shared pytest fixtures for the Native Media AI Studio backend test suite.

Provides:
- Temporary SQLite database isolated per test
- Async HTTP test client for FastAPI app
- Isolated QueueManager / SSEManager / ConnectionManager instances
- Mock adapter registry to avoid hitting real external services
"""

from __future__ import annotations

import getpass
import tempfile
from collections.abc import AsyncGenerator
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

# ---------------------------------------------------------------------------
# Ensure the backend package is importable when running pytest from the
# package root (``packages/backend``).
# ---------------------------------------------------------------------------
BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in __import__("sys").path:
    __import__("sys").path.insert(0, str(BACKEND_ROOT))

from app.adapters.registry import AdapterRegistry, BaseAdapter  # noqa: E402
from app.core import database as database_module  # noqa: E402
from app.main import app  # noqa: E402
from app.models.job import Job, JobStatus, JobType  # noqa: E402
from app.queue.manager import QueueManager  # noqa: E402
from app.sse.handler import SSEManager  # noqa: E402
from app.websocket.handler import ConnectionManager  # noqa: E402

# ===========================================================================
# Temp-directory fallback
# ===========================================================================

#: Repo-local basetemp, used when the shared per-user temp root is unusable.
LOCAL_BASETEMP = BACKEND_ROOT.parent.parent / ".pytest_tmp"

#: Set when the fallback above had to be applied (surfaced in the report header).
_USING_LOCAL_BASETEMP = False


def _temp_root_usable(root: Path) -> bool:
    """Return True when pytest can create *and* expire numbered temp dirs here.

    This machine's %TEMP% lives in a profile folder that was renamed after the
    Windows account was created, so pytest still computes the original
    ``pytest-of-<user>`` root while stale entries inside it belong to the old
    profile. Expiring those raises ``PermissionError`` in
    ``tmp_path_factory._exit_stack.close()`` — i.e. *after* every test has
    passed — which makes an otherwise green run exit non-zero.
    """
    try:
        root.mkdir(parents=True, exist_ok=True)
        probe = root / ".nma-write-probe"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        # Mirror what pytest does when it expires previous runs: for every entry
        # in the root it calls ``entry.resolve().exists()``. ``Path.exists()``
        # re-raises PermissionError (only ENOENT/ENOTDIR/ELOOP are swallowed),
        # and ``os.path.realpath`` hides it — so use the pathlib call here.
        for entry in root.iterdir():
            entry.resolve().exists()
    except OSError:
        return False
    return True


def pytest_configure(config: pytest.Config) -> None:
    """Point --basetemp at a repo-local directory when %TEMP% cannot be used."""
    global _USING_LOCAL_BASETEMP  # noqa: PLW0603

    if config.option.basetemp is not None:
        return  # an explicit --basetemp always wins
    root = Path(tempfile.gettempdir()) / f"pytest-of-{getpass.getuser()}"
    if not _temp_root_usable(root):
        LOCAL_BASETEMP.mkdir(parents=True, exist_ok=True)
        config.option.basetemp = str(LOCAL_BASETEMP)
        _USING_LOCAL_BASETEMP = True


def pytest_report_header(config: pytest.Config) -> str:
    """Explain the basetemp override so the run is not mysteriously relocated."""
    if _USING_LOCAL_BASETEMP:
        return f"basetemp: {config.option.basetemp} (shared %TEMP% root not usable)"
    return ""


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
