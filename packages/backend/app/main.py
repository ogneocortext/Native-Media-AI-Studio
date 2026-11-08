"""Native Media AI Studio - Main FastAPI Application"""

import asyncio
import json
import logging
import os
import socket
import sys
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

if sys.platform == "win32":
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    except Exception:
        pass

import uvicorn
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from sse_starlette.sse import EventSourceResponse
from starlette.middleware.base import BaseHTTPMiddleware

from .adapters.registry import adapter_registry
from .api import ascii as ascii_router
from .api.image_processing import router as image_processing_router
from .api.integrations_config import router as integrations_config_router
from .api.integrations_generation import router as integrations_generation_router
from .api.integrations_misc import router as integrations_misc_router
from .api.integrations_music_video import router as integrations_music_video_router
from .api.sub_agent import router as sub_agent_router
from .api.test_analytics import router as test_analytics_router
from .api.vst import router as vst_router
from .core.config import PROJECT_ROOT, config
from .core.cors import get_all_origins, get_public_origin_regex, is_local_origin
from .core.database import get_db, init_db
from .core.event_bus import HealthEventData, event_bus
from .core.idle_monitor import idle_monitor
from .core.logging_config import setup_logging, structured_logger
from .core.metrics import MetricsMiddleware, metrics_endpoint
from .core.port_manager import port_manager
from .core.rate_limit import RateLimitMiddleware
from .core.security_headers import SecurityHeadersMiddleware
from .core.tracing import setup_tracing
from .core.urls import atomic_chat_url
from .diagnostics.health import health_monitor
from .diagnostics.resources import resource_monitoring_loop
from .models.errors import ErrorResponse
from .queue.manager import queue_manager
from .queue.processor import processor
from .sse.handler import sse_manager
from .websocket.handler import connection_manager

# Initialize logging before anything else
setup_logging(config.log_level)
logger = logging.getLogger(__name__)


def _is_port_in_use(port: int, host: str = "127.0.0.1") -> bool:
    """Quick pre-flight check to warn if the target port is already occupied."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.5)
            return sock.connect_ex((host, port)) == 0
    except Exception:
        return False


async def _wait_for_port_free(port: int, host: str = "127.0.0.1", timeout: float = 5.0) -> bool:
    """Poll until the port is no longer accepting connections."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if not _is_port_in_use(port, host):
            return True
        await asyncio.sleep(0.25)
    return not _is_port_in_use(port, host)


def _release_zombie_port(port: int, host: str = "127.0.0.1") -> bool:
    """Last-resort attempt to clear a kernel zombie listener on Windows.

    Tries a temporary SO_REUSEADDR bind/close cycle. This does NOT move the
    backend to a different port; it only attempts to nudge the TCP stack to
    release the orphaned listener.
    """
    try:
        temp_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        temp_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        temp_sock.bind((host, port))
        temp_sock.listen(1)
        temp_sock.close()
        return True
    except Exception as exc:
        logger.warning("Zombie port release failed on %s:%d - %s", host, port, exc)
        return False


def _get_atomic_chat_model() -> str | None:
    """Query Atomic Chat's /v1/models to learn which model it has resident.

    Atomic Chat wraps Ollama on port 1337 and loads its own model into the
    same 8 GB VRAM. This function is a module-level helper so it can be
    called from lifespan() without adding nesting depth inside the try block.
    Returns None if Atomic Chat is unreachable or has no models registered.
    """
    import urllib.request

    try:
        headers = {}
        api_key = os.getenv("ATOMIC_CHAT_API_KEY", "").strip()
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        req = urllib.request.Request(atomic_chat_url("/v1/models"), headers=headers)
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read())
        models = data.get("data", [])
        if models:
            return models[0].get("id")
    except Exception:
        pass
    return None


def _get_ollama_last_model() -> str | None:
    """Return the last Ollama model loaded by the Ollama adapter.

    Module-level helper so lifespan() stays flat (no nested function with an
    inner try/if inside the database init try block). Returns None if the
    Ollama adapter is not registered or has no last model recorded.
    """
    try:
        adapter = adapter_registry.get_adapter("ollama")
        if adapter is None:
            return None
        return getattr(adapter, "_last_model", None)
    except Exception:
        return None


def _verify_ace_bridge_startup() -> None:
    """Verify ACE-Step bridge integrity on startup.

    Module-level helper so lifespan() stays flat (no extra nesting).
    A bridge issue is logged but never blocks startup -- the app keeps
    running with whatever ACE-Step is currently installed.
    """
    try:
        from .services.ace_bridge import ace_bridge

        integrity = ace_bridge.verify_bridge_integrity()
        if integrity["valid"]:
            logger.info(
                "ACE-Step bridge verified: v%s model=%s api=%s",
                integrity["tracked_version"],
                integrity["tracked_model_id"],
                integrity["api_compatibility"],
            )
        else:
            for issue in integrity["issues"]:
                structured_logger.warning("ace_step.bridge_issue", issue=issue)
        if integrity["warnings"]:
            for warning in integrity["warnings"]:
                structured_logger.info("ace_step.bridge_warning", warning=warning)
        if integrity["provider_update_detected"]:
            logger.warning(
                "ACE-Step provider update detected -- review config/ace-step/bridge.json"
            )
    except Exception as e:
        structured_logger.warning("ace_step.bridge_verification_skipped", error=str(e))


async def _ensure_backend_port_free(port: int) -> None:
    """If ``port`` is occupied but our backend is not responding there,
    attempt to free it before uvicorn tries to bind.

    This avoids silently drifting to another port and prevents the
    classic Windows stale-socket bind failure.
    """
    if not _is_port_in_use(port):
        return

    # Check if our backend is already serving on this port.
    if await port_manager.is_service_running("backend", port):
        logger.info("Backend already running on port %d; no cleanup needed", port)
        return

    logger.warning(
        "Port %d is occupied but backend is not responding; attempting cleanup before bind", port
    )
    port_manager.cleanup_orphaned_processes(port)
    freed = await _wait_for_port_free(port, timeout=5.0)
    if not freed:
        logger.warning(
            "Normal cleanup did not free backend port %d; attempting zombie release", port
        )
        if _release_zombie_port(port):
            freed = await _wait_for_port_free(port, timeout=5.0)

    if not freed:
        logger.error(
            "Failed to free backend port %d after cleanup. Falling back to alternate port.", port
        )
    else:
        logger.info("Backend port %d is now free", port)


# NOTE: Port cleanup is intentionally deferred to `main()` / `lifespan()`
# so importing this module does not perform network I/O or mutate system state.
# This keeps test imports and `python -c "import app.main"` side-effect free.


output_dir = Path(config.output_dir)
output_dir.mkdir(parents=True, exist_ok=True)
for subdir in ["images", "video", "audio", "previews", "logs"]:
    (output_dir / subdir).mkdir(parents=True, exist_ok=True)

storage_dir = PROJECT_ROOT / "storage"
storage_dir.mkdir(parents=True, exist_ok=True)

# Track when heavy jobs are running for adaptive health monitoring
_heavy_job_running: bool = False
_health_broadcast_interval: float = 60.0  # Start with idle interval (60s)
_IDLE_HEALTH_INTERVAL: float = 60.0  # 60s during idle
_HEAVY_HEALTH_INTERVAL: float = 5.0  # 5s during heavy jobs

# Job types considered "heavy" (resource-intensive)
_HEAVY_JOB_TYPES: set = {
    "music_video",
    "music_video_preview",
    "narrative_video",
    "scene_render",
    "comfyui_workflow",
    "remotion_render",
    "visualizer",
    "storyboard_generation",
}


async def _check_heavy_job_running() -> bool:
    """Check if a heavy job is currently running."""
    running_job = queue_manager._running_job
    if running_job is None:
        return False
    job_type = running_job.job_type
    job_type_value = job_type.value if hasattr(job_type, "value") else str(job_type)
    return job_type_value in _HEAVY_JOB_TYPES


async def _on_job_update(job):
    """Callback for job updates to track heavy job status."""
    global _heavy_job_running, _health_broadcast_interval

    was_heavy = _heavy_job_running
    _heavy_job_running = await _check_heavy_job_running()

    # Adjust interval based on heavy job status
    if _heavy_job_running:
        _health_broadcast_interval = _HEAVY_HEALTH_INTERVAL
    else:
        _health_broadcast_interval = _IDLE_HEALTH_INTERVAL

    if was_heavy != _heavy_job_running:
        logger.info(
            "Health broadcast interval changed",
            heavy_job_running=_heavy_job_running,
            interval=_health_broadcast_interval,
        )


async def health_broadcast_loop():
    """Background loop that broadcasts health status.
    Runs every 5s during heavy jobs, every 60s during idle.
    """
    consecutive_errors = 0
    max_backoff = 30  # Max seconds to wait between retries
    last_health_status: dict | None = None

    while True:
        try:
            # Get current interval (may change based on heavy job status)
            current_interval = _health_broadcast_interval

            health_status = await health_monitor.get_aggregate_health()
            # Guard against None return
            if health_status is None:
                logger.warning("health_monitor.get_aggregate_health() returned None, skipping broadcast")
                await asyncio.sleep(current_interval)
                continue

            # Map internal adapter statuses to the API contract (healthy -> online)
            # on a COPY. get_aggregate_health returns the shared cached dict, so
            # mutating it in place would corrupt the cache: the /api/health endpoint
            # then reads the already-mapped "online" and re-maps it to "offline",
            # making healthy adapters flap to offline between broadcasts.
            broadcast_status = {
                **health_status,
                "adapters": {
                    name: {
                        **adapter,
                        "status": "online" if adapter.get("status") == "healthy" else "offline",
                    }
                    for name, adapter in health_status.get("adapters", {}).items()
                },
            }

            # During idle, only broadcast if health actually changed
            unchanged = (
                not _heavy_job_running
                and last_health_status is not None
                and {k: v for k, v in broadcast_status.items() if k != "timestamp"}
                == {k: v for k, v in last_health_status.items() if k != "timestamp"}
            )
            if unchanged:
                # Health unchanged during idle - skip broadcast
                await asyncio.sleep(current_interval)
                continue
            if not _heavy_job_running:
                last_health_status = broadcast_status

            # Broadcast via event bus (reaches SSE + WS + any other subscribers)
            await event_bus.emit_health_change(HealthEventData(
                status=broadcast_status.get("status", "unknown"),
                overall=broadcast_status.get("overall", "unknown"),
                backend=broadcast_status.get("backend", "offline"),
                adapters=broadcast_status.get("adapters", {}),
            ))

            consecutive_errors = 0  # Reset on success
            await asyncio.sleep(current_interval)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            consecutive_errors += 1
            backoff = min(2**consecutive_errors, max_backoff)
            structured_logger.error(
                "health.broadcast_error",
                consecutive_errors=consecutive_errors,
                error=str(e),
            )
            await asyncio.sleep(backoff)


# Supervised background task manager
class SupervisedTaskManager:
    """Manages background tasks with automatic restart on failure."""

    def __init__(self):
        self._tasks: dict[str, asyncio.Task] = {}
        self._task_configs: dict[str, dict] = {}
        self._supervisor_task: asyncio.Task | None = None
        self._running = False

    def add_task(
        self,
        name: str,
        coro_factory: callable,
        *,
        restart_on_failure: bool = True,
        restart_delay: float = 5.0,
        max_restarts: int | None = None,
    ):
        """Register a task for supervised execution.

        Args:
            name: Unique task name
            coro_factory: Factory function that returns a new coroutine
            restart_on_failure: Whether to restart on failure
            restart_delay: Delay before restart (seconds)
            max_restarts: Max restarts (None or -1 = infinite, 0 = no restarts)
        """
        self._task_configs[name] = {
            "coro_factory": coro_factory,
            "restart_on_failure": restart_on_failure,
            "restart_delay": restart_delay,
            "max_restarts": max_restarts,
            "restart_count": 0,
        }

    async def start_all(self):
        """Start all registered tasks and the supervisor."""
        self._running = True

        for _name, _config in self._task_configs.items():
            self._tasks[_name] = asyncio.create_task(
                self._run_supervised(_name, _config)
            )
            logger.info(f"Supervised task started: {_name}")

        # Start supervisor
        self._supervisor_task = asyncio.create_task(self._supervisor_loop())
        logger.info("Task supervisor started")

    async def _run_supervised(self, name: str, config: dict):
        """Run a task with supervision."""
        coro_factory = config["coro_factory"]
        restart_on_failure = config["restart_on_failure"]
        restart_delay = config["restart_delay"]
        max_restarts = config["max_restarts"]
        restart_count = config["restart_count"]

        # Treat -1 as infinite (same as None) for backwards compatibility
        infinite_restarts = max_restarts is None or max_restarts == -1

        while self._running:
            try:
                coro = coro_factory()
                await coro
                # Task completed normally - don't restart
                logger.info(f"Task {name} completed normally")
                break

            except asyncio.CancelledError:
                logger.info(f"Task {name} cancelled")
                break
            except Exception as e:
                structured_logger.error("task.crashed", task=name, error=str(e), restart_count=restart_count)

                if not restart_on_failure:
                    logger.error(f"Task {name} not configured for restart, stopping")
                    break

                if not infinite_restarts and restart_count >= max_restarts:
                    logger.error(f"Task {name} exceeded max restarts ({max_restarts})")
                    break

                restart_count += 1
                config["restart_count"] = restart_count
                logger.info(f"Restarting task {name} in {restart_delay}s (attempt {restart_count})")
                await asyncio.sleep(restart_delay)

    async def _supervisor_loop(self):
        """Monitor all tasks and log their status."""
        while self._running:
            try:
                for name, task in list(self._tasks.items()):
                    if task.done():
                        if not self._running:
                            continue
                        try:
                            exc = task.exception()
                            if exc and not isinstance(exc, asyncio.CancelledError):
                                config = self._task_configs.get(name, {})
                                if config.get("restart_on_failure", True):
                                    logger.warning(f"Task {name} finished unexpectedly, will be restarted by supervisor")
                                    # Task will be restarted by its own loop
                        except asyncio.CancelledError:
                            pass
                await asyncio.sleep(10)  # Check every 10 seconds
            except asyncio.CancelledError:
                break
            except Exception as e:
                structured_logger.error("supervisor.error", error=str(e))
                await asyncio.sleep(10)

    async def stop_all(self):
        """Stop all tasks and the supervisor."""
        self._running = False

        # Cancel supervisor
        if self._supervisor_task:
            self._supervisor_task.cancel()
            try:
                await self._supervisor_task
            except asyncio.CancelledError:
                pass

        # Cancel all tasks
        for _name, task in self._tasks.items():
            if not task.done():
                task.cancel()

        # Wait for all tasks to finish
        for _name, task in self._tasks.items():
            try:
                await task
            except asyncio.CancelledError:
                pass
            except Exception as e:
                structured_logger.warning("task.shutdown_error", task=_name, error=str(e))

        self._tasks.clear()
        logger.info("All supervised tasks stopped")


# Global supervised task manager
_task_manager = SupervisedTaskManager()


async def _cancel_background_tasks():
    """Cancel all background tasks and wait for completion."""
    await _task_manager.stop_all()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting Native Media AI Studio...")

    # Initialize SQLite database
    try:
        init_db()
        await queue_manager.reload_from_db()
        # Composition-root wiring: VRAM accounting needs queued jobs to
        # reserve memory, but `services.vram_manager` must not import
        # `queue.manager` (that cycle is queue.manager ->
        # diagnostics.resources -> services.vram_manager -> queue.manager).
        # Injecting the provider here breaks it and keeps the wiring visible.
        from .models.job import JobStatus
        from .services.vram_manager import vram_manager

        async def _queued_jobs_for_vram():
            return await queue_manager.get_jobs_by_status(JobStatus.QUEUED)

        vram_manager.set_queue_provider(_queued_jobs_for_vram)

        # Same pattern, same reason: vram_manager used to import
        # `adapters.ollama` (four times, deferred) to read that adapter's
        # private `_last_model`. That closed the final import cycle:
        #   services.vram_manager -> adapters.ollama -> queue.manager
        #   -> diagnostics.resources -> services.vram_manager
        # Wiring it here keeps the adapter import at the composition root.
        from .services.vram_manager import (
            set_last_atomic_chat_model_provider,
            set_last_model_provider,
        )

        set_last_model_provider(_get_ollama_last_model)

        # Same pattern for Atomic Chat: it wraps Ollama on port 1337 and loads
        # its own model (e.g. qwen3.5) into the same 8 GB VRAM. The VRAM
        # manager needs to know which model Atomic Chat has resident so it can
        # coordinate unloading/reloading when switching backends.
        set_last_atomic_chat_model_provider(_get_atomic_chat_model)

        logger.info("Database initialized")
    except Exception as e:
        structured_logger.error("database.initialization_failed", error=str(e))
        raise

    # Record the port layout in config/ports.json.
    # If `run()` already pre-resolved ports before uvicorn bound the socket,
    # the resolved config is already accurate. Otherwise (server started via
    # `uvicorn app.main:app`) uvicorn has already bound config.backend_port, so
    # re-running the dynamic resolution here would see the port "occupied" by
    # ourselves and could pick a different port than the one we are on.
    try:
        if not port_manager.get_resolved_config():
            port_config = port_manager.set_default_config()
        else:
            port_config = port_manager.get_resolved_config()
        structured_logger.info(
            "config.port_resolved",
            backend_port=port_config["backend_port"],
            sse_url=port_config.get("events_url") or port_config.get("sse_url"),
            frontend_port=port_config["frontend_port"],
        )
    except Exception as e:
        structured_logger.error("config.port_resolution_failed", error=str(e))
        raise

    # Subscribe to job updates -- fan-out via event bus
    async def _fanout_job_update(job):
        await event_bus.send_job_update(job)

    await queue_manager.subscribe(_fanout_job_update)
    # Tracks heavy-job status so health broadcasts speed up during renders.
    await queue_manager.subscribe(_on_job_update)

    # Start the processor
    try:
        await processor.start()
        logger.info("Queue processor started")
    except Exception as e:
        structured_logger.error("queue.processor_start_failed", error=str(e))

    # Start the stem separation worker (UVR5 hierarchical + Demucs queue)
    try:
        from .services.source_separation import source_separator

        await source_separator.start_worker()
        logger.info("Stem separation worker started")
    except Exception as e:
        structured_logger.warning("stem_separation.worker_start_skipped", error=str(e))

    logger.info("Native Media AI Studio started successfully")

    # Check adapter health
    try:
        service_health = await adapter_registry.check_all_health()
        for name, status in service_health.items():
            structured_logger.info("adapter.health", adapter=name, healthy=status)
    except Exception as e:
        structured_logger.warning("adapter.health_check_failed", error=str(e))

    # Verify ACE-Step bridge integrity on startup.
    _verify_ace_bridge_startup()

# Start background tasks via supervised manager
    _task_manager.add_task(
        name="health_broadcast",
        coro_factory=health_broadcast_loop,
        restart_on_failure=True,
        restart_delay=5.0,
    )
    _task_manager.add_task(
        name="resource_monitoring",
        coro_factory=resource_monitoring_loop,
        restart_on_failure=True,
        restart_delay=5.0,
    )
    await _task_manager.start_all()
    logger.info("Health broadcast background task started")
    logger.info("Resource monitoring task started (30s interval)")

    # Start the idle monitor that auto-unloads services after 15 minutes of inactivity
    await idle_monitor.start()
    logger.info("Idle monitor started (15-minute timeout)")

    # Wire up event bus with delivery managers
    event_bus.set_managers(sse_manager=sse_manager, ws_manager=connection_manager)
    logger.info("Event bus wired with SSE and WebSocket managers")

    yield

    logger.info("Shutting down Native Media AI Studio...")

    # Cancel all background tasks
    await _cancel_background_tasks()
    logger.info("Background tasks stopped")

    # Stop the idle monitor
    await idle_monitor.stop()
    logger.info("Idle monitor stopped")

    # Release NVML handles held by the resource monitor and VRAM manager;
    # both expose shutdown() for exactly this and it was never called, so
    # repeated lifespan entries (tests, reloads) leaked the handle.
    try:
        from .diagnostics.resources import resource_monitor
        from .services.vram_manager import vram_manager

        resource_monitor.shutdown()
        vram_manager.shutdown()
    except Exception as e:
        structured_logger.warning("gpu.nvml_shutdown_failed", error=str(e))

    # Remove the job-update fan-out subscription so a re-imported app
    # (e.g. tests that enter lifespan repeatedly) does not accumulate
    # duplicate subscribers on the queue manager.
    try:
        await queue_manager.unsubscribe(_fanout_job_update)
        await queue_manager.unsubscribe(_on_job_update)
    except Exception as e:
        structured_logger.warning("queue.fanout_unsubscribe_failed", error=str(e))

    try:
        await processor.stop()
        logger.info("Queue processor stopped")
    except Exception as e:
        structured_logger.warning("queue.processor_stop_failed", error=str(e))

    # Release the shared httpx async client
    try:
        from .core.http_client import close_async_client

        await close_async_client()
    except Exception as e:
        structured_logger.warning("http.client_close_failed", error=str(e))

    # Release the shared aiohttp sessions (ComfyUI route client)
    try:
        from .core import comfyui_client

        await comfyui_client.close_shared_session()
    except Exception as e:
        structured_logger.warning("http.aiohttp_close_failed", error=str(e))

    # Close Ollama shared session
    try:
        from .core import ollama_client

        await ollama_client.close_shared_session()
    except Exception as e:
        structured_logger.warning("ollama.client_close_failed", error=str(e))

    # Close all adapter sessions (HTTP + bridge — one registry now).
    try:
        await adapter_registry.close_all()
        logger.info("Adapter sessions closed")
    except Exception as e:
        structured_logger.warning("adapter.sessions_close_failed", error=str(e))

    # Shutdown music generation services
    try:
        from .adapters.music_gen import close_shared_session, shutdown_music_gen_services

        await shutdown_music_gen_services()
        await close_shared_session()
        logger.info("Music generation services stopped")
    except Exception as e:
        structured_logger.warning("music_gen.services_stop_failed", error=str(e))

    # Checkpoint the WAL file before releasing connections so the -wal file does
    # not keep growing between restarts on a long-running home server.
    try:
        from .core.database import checkpoint_wal

        checkpointed = checkpoint_wal()
        if checkpointed is not None:
            logger.info("Checkpointed %d WAL frame(s) on shutdown", checkpointed)
    except Exception as e:
        structured_logger.warning("database.wal_checkpoint_failed", error=str(e))

    # Release pooled SQLite connections so the process does not exit holding file
    # handles. On Windows an open handle blocks the database file from being
    # replaced, which would break a later compaction or restore.
    try:
        from .core.database import close_pooled_connections

        closed = close_pooled_connections()
        if closed:
            logger.info("Closed %d pooled database connection(s)", closed)
    except Exception as e:
        structured_logger.warning("database.pooled_connections_close_failed", error=str(e))

    logger.info("Shutdown complete")


app = FastAPI(
    title="Native Media AI Studio",
    description="Local AI media generation platform for music, image, and video",
    version="1.8.0",
    lifespan=lifespan,
)

_OPENAPI_TAGS = [
    {"name": "Health", "description": "Backend, adapter, queue, and resource health checks."},
    {"name": "Jobs", "description": "Media generation job queue and lifecycle operations."},
    {"name": "Hardware", "description": "Hardware profile and benchmark operations."},
    {"name": "Integrations", "description": "External generation and media service integrations."},
    {"name": "Outputs", "description": "Generated media and output metadata operations."},
    {
        "name": "Audio",
        "description": "Audio upload, analysis, separation, and conversion operations.",
    },
    {"name": "Transcription", "description": "Speech transcription operations."},
    {"name": "Lyrics", "description": "Lyric parsing and synchronization operations."},
    {"name": "ComfyUI", "description": "ComfyUI workflow and model operations."},
    {"name": "Logs", "description": "Application log inspection and management operations."},
    {"name": "Log Analytics", "description": "Log analytics and trend operations."},
    {"name": "Data", "description": "Application data and visualization preset operations."},
    {"name": "Video", "description": "Video generation and editing operations."},
    {"name": "Vision", "description": "Vision analysis and image operations."},
    {
        "name": "Native Open",
        "description": "Local file and native application integration operations.",
    },
    {"name": "Docs", "description": "Application documentation operations."},
    {"name": "HyperFrames", "description": "HyperFrames composition and rendering operations."},
    {"name": "Media", "description": "Media inspection and file operations."},
    {
        "name": "Media Library",
        "description": "Media library organization: favorites, collections, tags, trash.",
    },
    {"name": "Music Generation", "description": "Music generation engine operations."},
    {"name": "Music Prompts", "description": "Music prompt creation and management operations."},
    {"name": "Root", "description": "Application root and compatibility endpoints."},
    {"name": "WebSocket", "description": "Legacy WebSocket compatibility endpoints."},
    {"name": "SSE", "description": "Server-sent event stream endpoints."},
    {"name": "Services", "description": "Adapter service status endpoints."},
    {"name": "Render", "description": "Rendering health and diagnostics endpoints."},
    {"name": "Notifications", "description": "Notification center and event history endpoints."},
]

_OPENAPI_SERVERS = [{"url": "/", "description": "Current backend origin"}]
_OPENAPI_CONTACT = {"name": "Native Media AI Studio"}
_OPENAPI_LICENSE = {
    "name": "Apache-2.0",
    "url": "https://www.apache.org/licenses/LICENSE-2.0.html",
}

# Opt-in tracing: set NMA_TRACING=1 to enable OpenTelemetry console exporter
setup_tracing(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(get_all_origins()),
    # Tunnel hostnames are randomized per start, so they cannot be listed in
    # allow_origins; without this regex every preflight from a sandbox VM agent
    # is rejected with 400 and no Access-Control-Allow-Origin header.
    allow_origin_regex=get_public_origin_regex(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # localtunnel/ngrok sit in front of the app, so responses pass through an
    # extra proxy. Reflect the real scheme/IP or the browser blocks them.
    expose_headers=[
        "X-Request-ID",
        "X-Response-Time",
        "X-RateLimit-Limit",
        "X-RateLimit-Remaining",
        "X-RateLimit-Reset",
    ],
)

# TrustedHost middleware - validates the Host header to prevent HTTP Host header attacks.
# In local dev, allow localhost and 127.0.0.1.  In production, restrict to known hosts.
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=[
        "localhost",
        "127.0.0.1",
        "testserver",
        "test",
        "*.local",
        "*.loca.lt",
        "*.ngrok-free.app",
        "*.ngrok.app",
        "*.trycloudflare.com",
        # Tailnet (Tailscale serve TCP forward -> localhost:8004) so remote
        # agents like Maya can reach the API at http://100.95.60.73:8004.
        "100.95.60.73",
        "customrig.tailb89a58.ts.net",
    ],
)

# GZip compression for responses > 1KB (4-13% throughput improvement).
app.add_middleware(GZipMiddleware, minimum_size=1024)

# Rate limiting - protects against DoS and abusive clients.
app.add_middleware(RateLimitMiddleware)

# Security headers - HSTS, CSP, X-Frame-Options, etc.
app.add_middleware(SecurityHeadersMiddleware)

# Prometheus RED metrics - Rate, Errors, Duration for observability.
app.add_middleware(MetricsMiddleware)

# Request size limit - protects against oversized uploads/DoS.
# Default 100MB, configurable via NMA_MAX_REQUEST_SIZE_MB.
_MAX_REQUEST_SIZE_MB = int(os.getenv("NMA_MAX_REQUEST_SIZE_MB", "100"))
_MAX_REQUEST_SIZE_BYTES = _MAX_REQUEST_SIZE_MB * 1024 * 1024


@app.middleware("http")
async def request_size_limit(request: Request, call_next):
    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            size = int(content_length)
        except ValueError:
            size = 0
        if size > _MAX_REQUEST_SIZE_BYTES:
            return JSONResponse(
                status_code=413,
                content={
                    "error": {
                        "code": "REQUEST_ENTITY_TOO_LARGE",
                        "message": f"Request body exceeds {_MAX_REQUEST_SIZE_MB} MB limit",
                    }
                },
            )
    return await call_next(request)


class RequestIDMiddleware(BaseHTTPMiddleware):
    """Inject X-Request-ID and X-Response-Time into every response."""

    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
        request.state.request_id = request_id
        try:
            from .core.logging_config import set_request_id

            set_request_id(request_id)
        except Exception:
            pass
        start = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            duration_ms = (time.perf_counter() - start) * 1000
            logger.exception(
                "Request failed: %s %s (%.1fms, request_id=%s)",
                request.method,
                request.url.path,
                duration_ms,
                request_id,
            )
            raise
        duration_ms = (time.perf_counter() - start) * 1000
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Response-Time"] = f"{duration_ms:.2f}ms"
        # Access log: one line per request at INFO (slow) / DEBUG (fast) so
        # the app log shows traffic without flooding on health polls.
        # SSE/health polling is frequent -- keep those at DEBUG.
        msg = "%s %s -> %d (%.1fms, request_id=%s)"
        args = (request.method, request.url.path, response.status_code, duration_ms, request_id)
        if request.url.path in ("/api/health", "/api/events") or duration_ms < 500:
            logger.debug(msg, *args)
        else:
            logger.info(msg, *args)
        return response


app.add_middleware(RequestIDMiddleware)


# ---------------------------------------------------------------------------
# Uniform error envelope
# ---------------------------------------------------------------------------


def _error_response(status_code: int, code: str, message: str, details: object = None):
    payload = {
        "error": {
            "code": code,
            "message": message,
        }
    }
    if details is not None:
        payload["error"]["details"] = details
    return JSONResponse(status_code=status_code, content=payload)


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    code = "VALIDATION_ERROR" if exc.status_code == 422 else "BAD_REQUEST"
    if exc.status_code == 404:
        code = "NOT_FOUND"
    elif exc.status_code == 413:
        code = "PAYLOAD_TOO_LARGE"
    elif exc.status_code == 503:
        code = "SERVICE_UNAVAILABLE"
    elif exc.status_code == 504:
        code = "GATEWAY_TIMEOUT"
    elif exc.status_code >= 500:
        code = "INTERNAL_ERROR"
    return _error_response(
        exc.status_code, code, str(exc.detail) if exc.detail else "Request failed"
    )


@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(request: Request, exc: RequestValidationError):
    """Return validation failures through the same envelope as HTTP errors."""
    return _error_response(
        422,
        "VALIDATION_ERROR",
        "Request validation failed",
        jsonable_encoder(exc.errors()),
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    request_id = getattr(request.state, "request_id", "-")
    logger.error(
        "Unhandled exception on %s %s (request_id=%s)",
        request.method,
        request.url.path,
        request_id,
        exc_info=True,
    )
    return _error_response(500, "INTERNAL_ERROR", "An unexpected error occurred.")


from .api import (  # noqa: E402
    ai,
    animationstudio,
    assets,
    audio,
    audio_edit,
    audio_mastering,
    audio_remix,
    audio_stems,
    chiptune,
    comfyui,
    data,
    database_admin,
    docs,
    gen3d,
    hardware,
    health,
    hyperframes,
    jobs,
    log_analytics,
    logs,
    lyrics,
    mcp_skills,
    mcp_validate,
    media,
    media_library,
    music_gen,
    music_prompts,
    native_open,
    notifications,
    outputs,
    retrieval,
    threestudio,
    transcription,
    treblo_tags,
    unity_control,
    video,
    vision,
    visualizer,
    voice,
)

app.include_router(jobs.router)
app.include_router(health.router)
app.include_router(hardware.router)
app.include_router(gen3d.router)
app.include_router(integrations_config_router, prefix="/api/integrations")
app.include_router(integrations_music_video_router, prefix="/api/integrations")
app.include_router(integrations_generation_router, prefix="/api/integrations")
app.include_router(integrations_misc_router, prefix="/api/integrations")
app.include_router(outputs.router)
app.include_router(assets.router)
app.include_router(treblo_tags.router)
app.include_router(audio.router)
# Stem routes live in their own module but share the /api/audio prefix, so the
# public paths are unchanged. Keep this next to the audio include - splitting
# audio.py only works while both routers are registered here.
app.include_router(audio_stems.router)
app.include_router(chiptune.router)
# VST plugin hosting for AI music creation
app.include_router(vst_router)
# File editing (/extract, /rename, /trim, /file) lives in its own module but
# shares the /api/audio prefix, so the public paths are unchanged. All three
# audio routers must stay registered here or the split silently drops routes.
app.include_router(audio_edit.router)
# Remixing (/api/audio/remix/*) is its own module for the same reason: a new
# audio responsibility goes in the module that matches it, not in audio.py.
# Same trap - an unregistered router loses every route silently, because
# OpenAPI is built from decorators and never runs a handler body.
app.include_router(audio_remix.router)
# Mastering (/api/audio/master, /api/audio/master/measure/{filename}) is its
# own module for the same reason as audio_stems/audio_edit: same /api/audio
# prefix, unregistered router = silently dropped routes.
app.include_router(audio_mastering.router)
app.include_router(transcription.router)
app.include_router(lyrics.router)
app.include_router(comfyui.router)
app.include_router(logs.router)
app.include_router(log_analytics.router)
app.include_router(data.router)
app.include_router(database_admin.router)
app.include_router(video.router)
app.include_router(voice.router)
app.include_router(vision.router)
app.include_router(native_open.router)
app.include_router(unity_control.router)
app.include_router(docs.router)
app.include_router(hyperframes.router)
app.include_router(media.router)
app.include_router(media_library.router)
app.include_router(music_gen.router)
app.include_router(music_prompts.router)
app.include_router(notifications.router)
app.include_router(mcp_validate.router)
app.include_router(mcp_skills.router)
app.include_router(image_processing_router)
app.include_router(sub_agent_router)
app.include_router(retrieval.router)
app.include_router(visualizer.router)
app.include_router(threestudio.router)
app.include_router(animationstudio.router)
app.include_router(ai.router)
app.include_router(ascii_router.router)
app.include_router(test_analytics_router)


# Additional root-level routes
@app.get("/api/services/status", response_model=dict)
async def get_service_status() -> dict:
    """Get status of all adapters with error details"""
    return {
        "adapters": adapter_registry.get_status_all(),
        "adapter_details": adapter_registry.get_status_with_errors(),
        "connections": await sse_manager.connection_count(),
    }


@app.get("/api/render/health", response_model=dict)
async def get_render_health() -> dict:
    """Get system health for rendering"""
    return await health_monitor.get_system_health()


@app.get("/api/healthz", response_model=dict, tags=["Health"])
async def healthz():
    """Liveness probe - returns 200 if the process is alive.
    Does NOT check dependencies (database, adapters, etc.) so that
    load balancers can distinguish between "process is up" and "process
    is ready to serve traffic".
    """
    return {"status": "ok", "timestamp": datetime.now().isoformat()}


@app.get("/api/readyz", response_model=dict, tags=["Health"])
async def readyz():
    """Readiness probe - returns 200 only when all dependencies are healthy.
    Checks database connectivity and adapter health. Load balancers should
    route traffic only to instances passing this check.
    """
    checks = {}
    overall = "ok"

    # Check database connectivity
    try:
        with get_db() as conn:
            conn.execute("SELECT 1").fetchone()
        checks["database"] = "ok"
    except Exception as e:
        checks["database"] = f"error: {e}"
        overall = "degraded"

    # Check adapter health
    try:
        service_health = await adapter_registry.check_all_health()
        for name, status in service_health.items():
            checks[name] = "ok" if status else "offline"
            if not status:
                overall = "degraded"
    except Exception as e:
        checks["adapters"] = f"error: {e}"
        overall = "degraded"

    return {"status": overall, "checks": checks, "timestamp": datetime.now().isoformat()}


@app.get("/metrics", tags=["Health"])
async def metrics():
    """Prometheus metrics endpoint (Rate, Errors, Duration)."""
    return await metrics_endpoint()


_ERROR_RESPONSE_CONTENT = {
    "application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}
}


def _register_error_schema(schema: dict) -> None:
    """Register the shared error envelope used by every exception handler."""
    components = schema.setdefault("components", {})
    schemas = components.setdefault("schemas", {})
    if "ErrorResponse" in schemas:
        return

    error_schema = ErrorResponse.model_json_schema(ref_template="#/components/schemas/{model}")
    for name, definition in error_schema.pop("$defs", {}).items():
        schemas.setdefault(name, definition)
    schemas["ErrorResponse"] = error_schema


def _tag_for_path(path: str) -> str:
    """Choose a useful top-level tag for routes defined directly on ``app``."""
    if path == "/":
        return "Root"
    if path == "/ws":
        return "WebSocket"
    if path == "/api/events":
        return "SSE"
    parts = [part for part in path.split("/") if part]
    if parts and parts[0] == "api" and len(parts) > 1:
        return {
            "services": "Services",
            "render": "Render",
        }.get(parts[1], parts[1].replace("-", " ").title())
    return "Root"


def _operation_description(method: str, path: str, summary: str) -> str:
    """Provide a useful description for routes without a docstring."""
    descriptions = {
        ("GET", "/api/health/context"): "Get the current shared MCP context.",
        ("POST", "/api/health/context"): "Set values in the shared MCP context.",
        ("GET", "/api/hyperframes/status"): "Get the HyperFrames project and engine status.",
        ("GET", "/api/hyperframes/examples"): "List available HyperFrames starter examples.",
        (
            "POST",
            "/api/hyperframes/preview",
        ): "Start a HyperFrames preview for the current composition.",
        ("POST", "/api/hyperframes/render"): "Render the current HyperFrames composition.",
        ("GET", "/"): "Return application metadata and links to core endpoints.",
        ("GET", "/ws"): "Return an upgrade-required response for plain HTTP WebSocket clients.",
    }
    return descriptions.get((method, path), f"{summary.rstrip('.')}.")


def _normalize_operations(schema: dict) -> None:
    """Fill missing tags/descriptions and document uniform error responses."""
    _register_error_schema(schema)

    tag_names = {tag["name"] for tag in schema.get("tags", [])}
    for path, path_item in schema.get("paths", {}).items():
        for method, operation in path_item.items():
            if method.lower() not in {
                "get",
                "put",
                "post",
                "delete",
                "patch",
                "options",
                "head",
                "trace",
            }:
                continue

            tags = operation.get("tags")
            if not tags:
                tag = _tag_for_path(path)
                operation["tags"] = [tag]
                tag_names.add(tag)
            else:
                tag_names.update(tags)

            if not operation.get("description"):
                operation["description"] = _operation_description(
                    method.upper(), path, operation.get("summary", "Operation")
                )

            responses = operation.setdefault("responses", {})
            if "500" not in responses:
                responses["500"] = {
                    "description": "Internal server error",
                    "content": _ERROR_RESPONSE_CONTENT,
                }
            if "422" not in responses and ("parameters" in operation or "requestBody" in operation):
                responses["422"] = {
                    "description": "Request validation failed",
                    "content": _ERROR_RESPONSE_CONTENT,
                }

    existing_tags = {
        tag["name"]: tag
        for tag in schema.get("tags", [])
        if isinstance(tag, dict) and tag.get("name")
    }
    for name in sorted(tag_names):
        existing_tags.setdefault(
            name,
            {
                "name": name,
                "description": f"{name} API operations.",
            },
        )
    schema["tags"] = [existing_tags[name] for name in sorted(existing_tags)]


def custom_openapi():
    """Build a stable, documented OpenAPI 3.1 schema for API clients."""
    if app.openapi_schema:
        return app.openapi_schema

    schema = get_openapi(
        title=app.title,
        version=app.version,
        description=app.description,
        routes=app.routes,
        openapi_version=app.openapi_version,
        tags=_OPENAPI_TAGS,
        servers=_OPENAPI_SERVERS,
        contact=_OPENAPI_CONTACT,
        license_info=_OPENAPI_LICENSE,
    )
    schema["info"].setdefault("contact", _OPENAPI_CONTACT)
    schema["info"].setdefault("license", _OPENAPI_LICENSE)
    schema.setdefault("servers", _OPENAPI_SERVERS)
    _normalize_operations(schema)
    app.openapi_schema = schema
    return schema


app.openapi = custom_openapi

# Serve render outputs unconditionally: on a clean checkout the dir may
# not exist yet at boot, and a missing mount 404s every roll/WAV the UI
# links to (the chiptune page's previews were the visible symptom).
config.output_dir.mkdir(parents=True, exist_ok=True)
app.mount("/output", StaticFiles(directory=str(config.output_dir)), name="output")


@app.get("/", response_model=dict)
async def root():
    return {
        "name": "Native Media AI Studio",
        "version": app.version,
        "description": "Local AI media generation platform",
        "endpoints": {
            "docs": "/docs",
            "health": "/api/health",
            "hardware": "/api/hardware",
            "jobs": "/api/jobs",
            "integrations": "/api/integrations",
        },
    }


# ---------------------------------------------------------------------------
# Legacy WebSocket endpoint -- kept for backward compatibility.
# New clients should use SSE at /api/events (see sseService.ts).
# Returns 426 for plain HTTP GET with a JSON hint.
# ---------------------------------------------------------------------------
@app.get("/ws")
async def ws_http_fallback():
    return JSONResponse(
        status_code=426,
        content={
            "error": "Upgrade Required",
            "message": "This endpoint requires a WebSocket upgrade. Connect via ws://host:8000/ws or prefer SSE at /api/events.",
            "sse_endpoint": "/api/events",
            "ws_endpoint": "/ws",
        },
    )


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket shim that mirrors SSE broadcasts for legacy clients."""
    # Origin validation: only accept connections from trusted local origins.
    # Mirrors the CORS allowlist (app.core.cors) so dynamic backend/frontend
    # ports stay in sync. Non-browser clients send no Origin header and pass.
    origin = websocket.headers.get("origin", "")
    if origin and not is_local_origin(origin):
        await websocket.close(code=4001, reason="Origin not allowed")
        return
    if not await connection_manager.connect(websocket):
        return
    try:
        # Send initial hello so legacy clients know the protocol
        await websocket.send_text(
            json.dumps(
                {
                    "type": "connected",
                    "data": {
                        "message": "Connected to Native Media AI Studio (WS compat layer). Prefer SSE at /api/events."
                    },
                    "timestamp": datetime.now().isoformat(),
                }
            )
        )
        # Keep connection alive -- echo any client message and forward keepalives
        while True:
            try:
                msg = await asyncio.wait_for(websocket.receive_text(), timeout=10)
                # Echo back for diagnostics; ignore unknown payloads
                await websocket.send_text(
                    json.dumps(
                        {
                            "type": "echo",
                            "data": {"received": msg[:500]},
                            "timestamp": datetime.now().isoformat(),
                        }
                    )
                )
            except TimeoutError:
                await websocket.send_text(
                    json.dumps({"type": "keepalive", "timestamp": datetime.now().isoformat()})
                )
    except WebSocketDisconnect:
        pass
    except Exception as e:
        structured_logger.debug("ws.connection_ended", error=str(e))
    finally:
        await connection_manager.disconnect(websocket)


@app.get("/api/events")
async def sse_endpoint(request: Request):
    """SSE endpoint for real-time server-to-client updates.
    Provides health status, job progress, and resource warnings
    via Server-Sent Events (SSE). The browser's EventSource API
    handles automatic reconnection and event resumption.
    """
    queue = await sse_manager.connect()
    if queue is None:
        # At capacity. Return 200 text/event-stream with a jittered retry so
        # EventSource backs off and reconnects instead of failing permanently.
        # A non-200 (e.g. 503) would make EventSource stop retrying altogether.
        retry_ms = 5000 + int(time.time() * 1000) % 25000  # 5–30 s jitter
        return StreamingResponse(
            content=f"retry: {retry_ms}\n\n",
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache"},
        )

    # Support Last-Event-ID replay: capture for use inside the generator
    last_event_id = request.headers.get("Last-Event-ID")
    last_id: int | None = None
    if last_event_id:
        try:
            last_id = int(last_event_id)
        except (ValueError, TypeError):
            pass

    async def event_generator():
        # Send replay events first if Last-Event-ID was provided
        if last_id is not None:
            try:
                replay_events = await sse_manager.get_replay_events(last_id)
                for event in replay_events:
                    yield {
                        "id": event["id"],
                        "data": event["data"],
                    }
            except Exception:
                # Malformed replay payload or bad Last-Event-ID: skip replay
                # rather than killing the stream after headers are sent.
                pass

        try:
            # Send initial connection event
            yield {
                "event": "connected",
                "data": json.dumps(
                    {
                        "type": "connected",
                        "timestamp": datetime.now().isoformat(),
                    }
                ),
            }

            while True:
                # Check if client disconnected
                if await request.is_disconnected():
                    break

                try:
                    # Wait for events from the queue (with timeout to send keepalive)
                    event_data = await asyncio.wait_for(queue.get(), timeout=5)
                    yield {
                        "id": event_data["id"],
                        "data": event_data["data"],
                    }
                except TimeoutError:
                    # Send keepalive comment to prevent connection timeout
                    yield {
                        "event": "keepalive",
                        "data": json.dumps(
                            {
                                "type": "keepalive",
                                "timestamp": datetime.now().isoformat(),
                            }
                        ),
                    }
        except asyncio.CancelledError:
            pass
        except Exception as e:
            structured_logger.error("sse.connection_error", error=str(e))
        finally:
            await sse_manager.disconnect(queue)

    return EventSourceResponse(event_generator())


async def main():
    """Run the FastAPI application with resolved ports"""
    # Resolve ports BEFORE uvicorn binds so that:
    #   1. ports.json is accurate before the frontend starts, and
    #   2. the dynamic port resolution never sees the port we are about to bind
    #      as "occupied by a stale process".
    try:
        resolved_config = await port_manager.resolve_all_ports()
        port = resolved_config["backend_port"]
        structured_logger.info("backend.port_resolved", port=port)
    except Exception as e:
        structured_logger.warning(
            "backend.port_pre_resolution_failed",
            default_port=config.backend_port,
            error=str(e),
        )
        port = config.backend_port

    # If our resolved port is already occupied by our own service, exit
    # instead of binding a second instance. This is the "sticky port"
    # guard that prevents duplicate backends when an agent re-invokes the
    # server while it is already running.
    if await port_manager.is_service_running("backend", port):
        logger.info("Backend already running on port %d; skipping duplicate bind.", port)
        return

    # If we fell back to an alternate port (e.g. 8000 -> 8001) while the
    # canonical backend is healthy, exit too. Without this, two launchers
    # racing at boot each bind their own port and both stay up (observed
    # 2026-09-20: healthy instances on :8000 AND :8001). A zombie on the
    # canonical port still allows fallback: is_service_running only
    # returns True for a *responding* backend.
    canonical_port = config.backend_port
    if port != canonical_port and await port_manager.is_service_running("backend", canonical_port):
        logger.info(
            "Healthy backend already serving canonical port %d; "
            "refusing fallback duplicate on port %d.",
            canonical_port,
            port,
        )
        return

    # If the port is occupied by a stale/non-responding process, try to
    # free it before uvicorn attempts the bind. If cleanup fails, the port
    # manager will fall back to an alternate port instead of raising.
    await _ensure_backend_port_free(port)

    uvicorn_config = uvicorn.Config(
        app,
        host=config.backend_host,
        port=port,
        log_level=config.log_level.lower(),
        ws="websockets",
        timeout_keep_alive=30,
    )
    server = uvicorn.Server(uvicorn_config)
    await server.serve()


def run():
    asyncio.run(main())


if __name__ == "__main__":
    run()
