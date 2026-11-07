"""
Shared pytest fixtures for the Native Media AI Studio backend test suite.

Provides:
- Temporary SQLite database isolated per test
- Async HTTP test client for FastAPI app
- Isolated QueueManager / SSEManager / ConnectionManager instances
- Mock adapter registry to avoid hitting real external services
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

# ---------------------------------------------------------------------------
# Ensure the backend package is importable when running pytest from the
# package root (``packages/backend``).
# ---------------------------------------------------------------------------
BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

# Repo root holds cli_output.py — the shared ASCII report formatter used by
# the terminal summary below and by tools/test_insights.py.
REPO_ROOT = BACKEND_ROOT.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from typing import TYPE_CHECKING

from app.adapters.base import BaseAdapter  # noqa: E402
from app.adapters.registry import AdapterRegistry  # noqa: E402
from app.core import database as database_module  # noqa: E402
from app.main import app  # noqa: E402
from app.models.job import Job, JobStatus, JobType  # noqa: E402
from app.queue.manager import QueueManager  # noqa: E402
from app.sse.handler import SSEManager  # noqa: E402
from app.websocket.handler import ConnectionManager  # noqa: E402

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

# ===========================================================================
# Temp-directory fallback
# ===========================================================================

#: Repo-local basetemp, used when the shared per-user temp root is unusable.
LOCAL_BASETEMP = BACKEND_ROOT.parent.parent / ".pytest_tmp"

#: Set when the fallback above had to be applied (surfaced in the report header).
_USING_LOCAL_BASETEMP = False


def pytest_configure(config: pytest.Config) -> None:
    """Point --basetemp at a repo-local directory to avoid PermissionError.

    This machine's %TEMP% lives in a profile folder that was renamed after the
    Windows account was created, so pytest still computes the original
    ``pytest-of-<user>`` root while stale entries inside it belong to the old
    profile. pytest's internal ``cleanup_dead_symlinks`` and
    ``_exit_stack.close()`` raise ``PermissionError`` when they try to stat
    those entries — even though all tests passed — making an otherwise green
    run exit non-zero. Using a repo-local basetemp avoids the problem entirely.
    """
    global _USING_LOCAL_BASETEMP  # noqa: PLW0603

    if config.option.basetemp is not None:
        return  # an explicit --basetemp always wins
    LOCAL_BASETEMP.mkdir(parents=True, exist_ok=True)
    config.option.basetemp = str(LOCAL_BASETEMP)
    _USING_LOCAL_BASETEMP = True


def pytest_report_header(config: pytest.Config) -> str:
    """Explain the basetemp override so the run is not mysteriously relocated."""
    if _USING_LOCAL_BASETEMP:
        return f"basetemp: {config.option.basetemp} (shared %TEMP% root not usable)"
    return ""


def pytest_sessionfinish(session: pytest.Session, exitstatus: int) -> None:
    """Wrap pytest's temp-directory cleanup to swallow PermissionError.

    On this machine the shared %TEMP% root contains stale entries owned by a
    renamed Windows profile. pytest's internal ``cleanup_dead_symlinks`` and
    ``_exit_stack.close()`` raise ``PermissionError`` when they try to stat
    those entries — even though all tests passed. Catching the error here
    prevents an otherwise green run from exiting non-zero.
    """
    try:
        tmp_path_factory = session.config._tmp_path_factory
    except AttributeError:
        return
    basetemp = getattr(tmp_path_factory, "_basetemp", None)
    if basetemp is None:
        return
    # The baseline cleanup already uses ignore_errors=True for rmtree, but
    # cleanup_dead_symlinks and _exit_stack.close do not. Wrap both.
    try:
        tmp_path_factory._exit_stack.close()
    except PermissionError:
        pass
    try:
        if basetemp.is_dir():
            from _pytest.pathlib import cleanup_dead_symlinks

            cleanup_dead_symlinks(basetemp)
    except PermissionError:
        pass


def pytest_terminal_summary(terminalreporter) -> None:
    """Print the ASCII-art results report with actionable insights.

    Runs for every pytest invocation so agents and users get the same
    interpretable summary regardless of how the suite was launched. Any
    failure inside the formatter is swallowed — cosmetics must never change
    the exit code.
    """
    try:
        from cli_output import (
            CLIOutput,
            build_test_insights,
            classify_failure,
            safe_print,
        )

        stats = terminalreporter.stats
        reports = {
            key: list(stats.get(key, []))
            for key in (
                "passed", "failed", "error", "skipped",
                "xfailed", "xpassed",
            )
        }
        all_reports = [r for group in reports.values() for r in group]
        if not all_reports:
            return

        passed = len(reports["passed"]) + len(reports["xpassed"])
        failed = len(reports["failed"])
        errors = len(reports["error"])
        skipped = len(reports["skipped"]) + len(reports["xfailed"])

        def _failure_entry(report) -> dict:
            longrepr = getattr(report, "longrepr", None)
            text = str(longrepr) if longrepr is not None else ""
            # Prefer pytest's "E "-prefixed assertion lines; they carry the
            # actual error, unlike traceback frame headers.
            message = ""
            fallback = ""
            for line in text.splitlines():
                stripped = line.strip()
                if not stripped or stripped.startswith("=") \
                        or "Traceback" in stripped:
                    continue
                if stripped.startswith("E ") or "Error" in stripped \
                        or "assert" in stripped:
                    message = stripped.lstrip("E ").strip() or stripped
                    break
                if not fallback:
                    fallback = stripped
            if not message:
                message = fallback
            nodeid = getattr(report, "nodeid", "?")
            lineno = getattr(report, "lineno", None)
            return {
                "name": nodeid,
                "file": nodeid.split("::")[0],
                "line": lineno if isinstance(lineno, int) else None,
                "message": message[:120],
                "code": classify_failure(
                    message, phase=getattr(report, "when", None)),
            }

        failures = [_failure_entry(r) for r in reports["failed"] + reports["error"]]

        # Skip reasons: pytest represents skips as (path, lineno, reason)
        # tuples — surface the top ones so "N skipped" is interpretable.
        skip_reasons: dict[str, int] = {}
        for r in reports["skipped"] + reports["xfailed"]:
            lr = getattr(r, "longrepr", None)
            reason = ""
            if isinstance(lr, tuple) and len(lr) >= 3:
                reason = str(lr[2])
            elif lr is not None:
                text = str(lr).strip()
                if text:
                    reason = text.splitlines()[-1]
            reason = reason.strip().splitlines()[0][:80] if reason.strip() else "unspecified"
            skip_reasons[reason] = skip_reasons.get(reason, 0) + 1
        slowest = [
            {"name": getattr(r, "nodeid", "?"),
             "duration_s": float(getattr(r, "duration", 0.0) or 0.0)}
            for r in sorted(all_reports,
                            key=lambda r: getattr(r, "duration", 0.0) or 0.0,
                            reverse=True)[:8]
        ]

        # Wall-clock duration to match the vitest/playwright reporters —
        # summing per-test durations hides setup/teardown and fixture time.
        session_start = getattr(terminalreporter, "_sessionstarttime", None)
        wall_s = (
            time.time() - session_start
            if isinstance(session_start, (int, float)) else None
        )
        duration_s = (
            wall_s if wall_s is not None and wall_s > 0
            else sum(
                float(getattr(r, "duration", 0.0) or 0.0)
                for r in all_reports
            )
        )

        insights = build_test_insights(
            failed=failed, skipped=skipped, errors=errors,
            slowest=slowest or None,
        )
        warning_count = len(stats.get("warnings", []))
        if warning_count:
            insights.append(
                f"{warning_count} warning(s) emitted — review deprecations "
                f"with `pytest -W` before they become failures."
            )
        if skip_reasons:
            top = sorted(skip_reasons.items(), key=lambda kv: -kv[1])[:3]
            insights.append(
                "Skip reasons: "
                + "; ".join(f"{reason} ({n})" for reason, n in top)
            )

        safe_print("")
        safe_print(CLIOutput().format_test_results(
            passed=passed,
            failed=failed,
            skipped=skipped,
            duration_s=duration_s,
            errors=errors,
            suite="pytest backend",
            failures=failures,
            slowest=slowest,
            insights=insights,
            rerun_hint="python -m pytest",
        ))
    except Exception:
        pass


# ===========================================================================
# Database fixture
# ===========================================================================

@pytest.fixture(autouse=False)
def temp_db(tmp_path, monkeypatch):
    """Point the database at a throwaway file for the test duration.

    Kept function-scoped so each test gets an isolated database — a
    session-scoped fixture would let tests leak state into each other
    (e.g. ``test_safe_vacuum_reclaims_pages`` sees tables dropped by
    earlier VACUUM tests).

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

    def __init__(self, name: str = "mock", *, healthy: bool = True, base_url: str = "http://mock"):
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
def make_job(temp_db):
    """Factory fixture to create jobs visible to the queue API.

    The job must be registered in BOTH places it can live:

    - The **global** ``queue_manager`` singleton — the in-memory queue.
      ``GET /api/jobs`` reads this instance, because
      ``app/api/jobs.py`` does ``from ..queue.manager import queue_manager``
      and calls ``await queue_manager.get_all_jobs()``, which sorts
      ``self._jobs``. Registering into some *other* QueueManager instance
      (for example the one built by the ``queue_manager_instance``
      fixture) puts the job in a queue nobody reads, and the endpoint
      then reports an empty list.
    - SQLite — so persistence, recovery and the DB-backed tests still see
      it. ``temp_db`` redirects ``DB_PATH`` to a throwaway file, so the
      suite stops writing rows into the real ``storage/studio.db``.

    Cleanup removes it from both.
    """
    from app.queue.manager import queue_manager

    created: list[Job] = []

    def _make(
        job_type: JobType = JobType.IMAGE_GENERATION,
        status: JobStatus = JobStatus.QUEUED,
        **overrides,
    ) -> Job:
        job = Job(job_type=job_type, status=status, **overrides)
        from app.queue.db_manager import JobDatabaseManager
        JobDatabaseManager.create_job(job)
        queue_manager._jobs[job.id] = job
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
        queue_manager._jobs.pop(job.id, None)
