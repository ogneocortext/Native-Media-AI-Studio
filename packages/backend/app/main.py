"""Native Media AI Studio - Main FastAPI Application"""

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sse_starlette.sse import EventSourceResponse

from .adapters.registry import adapter_registry
from .core.config import PROJECT_ROOT, config
from .core.database import init_db
from .core.logging_config import setup_logging
from .core.port_manager import port_manager
from .diagnostics.health import health_monitor
from .diagnostics.resources import resource_monitoring_loop
from .queue.manager import queue_manager
from .queue.processor import processor
from .sse.handler import sse_manager

# Initialize logging before anything else
setup_logging(config.log_level)
logger = logging.getLogger(__name__)

output_dir = Path(config.output_dir)
output_dir.mkdir(parents=True, exist_ok=True)
for subdir in ["images", "video", "audio", "previews", "logs"]:
    (output_dir / subdir).mkdir(parents=True, exist_ok=True)

storage_dir = PROJECT_ROOT / "storage"
storage_dir.mkdir(parents=True, exist_ok=True)

# Background task handles
_background_tasks: list[asyncio.Task] = []


async def health_broadcast_loop():
    """Background loop that broadcasts health status every 5 seconds."""
    consecutive_errors = 0
    max_backoff = 30  # Max seconds to wait between retries

    while True:
        try:
            health_status = await health_monitor.get_aggregate_health()
            # Map internal adapter statuses to API contract: healthy -> online, offline -> offline
            for adapter in health_status.get("adapters", {}).values():
                adapter["status"] = "online" if adapter.get("status") == "healthy" else "offline"
            await sse_manager.broadcast_health_status(health_status)
            consecutive_errors = 0  # Reset on success
            await asyncio.sleep(5)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            consecutive_errors += 1
            backoff = min(2 ** consecutive_errors, max_backoff)
            logger.error(f"Health broadcast error ({consecutive_errors}): {e}")
            await asyncio.sleep(backoff)


async def _cancel_background_tasks():
    """Cancel all background tasks and wait for completion."""
    for task in _background_tasks:
        if not task.done():
            task.cancel()
    for task in _background_tasks:
        try:
            await task
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.warning(f"Background task error during shutdown: {e}")
    _background_tasks.clear()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting Native Media AI Studio...")

    # Initialize SQLite database
    try:
        init_db()
        queue_manager.reload_from_db()
        logger.info("Database initialized")
    except Exception as e:
        logger.error(f"Database initialization failed: {e}")
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
        logger.info(f"Backend port: {port_config['backend_port']}")
        logger.info(f"SSE port: {port_config['backend_port']}")
        logger.info(f"Frontend port: {port_config['frontend_port']}")
    except Exception as e:
        logger.error(f"Port configuration failed: {e}")
        raise

    # Subscribe to job updates
    await queue_manager.subscribe(sse_manager.send_job_update)

    # Start the processor
    try:
        await processor.start()
        logger.info("Queue processor started")
    except Exception as e:
        logger.error(f"Failed to start queue processor: {e}")

    logger.info("Native Media AI Studio started successfully")

    # Check adapter health
    try:
        service_health = await adapter_registry.check_all_health()
        for name, status in service_health.items():
            logger.info(f"{name}: {'healthy' if status else 'offline'}")
    except Exception as e:
        logger.warning(f"Adapter health check failed: {e}")

    # Start background tasks
    _background_tasks.append(asyncio.create_task(health_broadcast_loop()))
    logger.info("Health broadcast background task started")

    _background_tasks.append(asyncio.create_task(resource_monitoring_loop(interval_seconds=10.0)))
    logger.info("Resource monitoring task started")

    yield

    logger.info("Shutting down Native Media AI Studio...")

    # Cancel all background tasks
    await _cancel_background_tasks()
    logger.info("Background tasks stopped")

    try:
        await processor.stop()
        logger.info("Queue processor stopped")
    except Exception as e:
        logger.warning(f"Error stopping processor: {e}")

    # Release the shared httpx async client
    try:
        from .core.http_client import close_async_client
        await close_async_client()
    except Exception as e:
        logger.warning(f"Failed to close shared HTTP client: {e}")

    # Close all adapter sessions
    try:
        from .adapters.registry import adapter_registry
        await adapter_registry.close_all()
        logger.info("Adapter sessions closed")
    except Exception as e:
        logger.warning(f"Failed to close adapter sessions: {e}")

    logger.info("Shutdown complete")


app = FastAPI(
    title="Native Media AI Studio",
    description="Local AI media generation platform for music, image, and video",
    version="1.0.0",
    lifespan=lifespan,
)

# Local-first app: allow the dev frontend origins explicitly. A wildcard origin
# combined with allow_credentials=True is rejected by browsers per the CORS spec.
_local_origins = {
    f"http://localhost:{config.frontend_port}",
    f"http://127.0.0.1:{config.frontend_port}",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    f"http://localhost:{config.backend_port}",
    f"http://127.0.0.1:{config.backend_port}",
    f"http://localhost:{config.frontend_port}",
    f"http://127.0.0.1:{config.frontend_port}",
}

app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(_local_origins),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from .api import audio, comfyui, data, docs, health, integrations, jobs, logs, outputs, video  # noqa: E402

app.include_router(jobs.router)
app.include_router(health.router)
app.include_router(integrations.router)
app.include_router(outputs.router)
app.include_router(audio.router)
app.include_router(comfyui.router)
app.include_router(logs.router)
app.include_router(data.router)
app.include_router(video.router)
app.include_router(docs.router)

# Additional root-level routes
@app.get("/api/services/status")
async def get_service_status() -> dict:
    """Get status of all adapters with error details"""
    return {
        "adapters": adapter_registry.get_status_all(),
        "adapter_details": adapter_registry.get_status_with_errors(),
        "connections": sse_manager.connection_count(),
    }

@app.get("/api/render/health")
async def get_render_health() -> dict:
    """Get system health for rendering"""
    return await health_monitor.get_system_health()

if config.output_dir.exists():
    app.mount("/output", StaticFiles(directory=str(config.output_dir)), name="output")


@app.get("/")
async def root():
    return {
        "name": "Native Media AI Studio",
        "version": "1.0.0",
        "description": "Local AI media generation platform",
        "endpoints": {
            "docs": "/docs",
            "health": "/api/health",
            "jobs": "/api/jobs",
            "integrations": "/api/integrations",
        },
    }


@ app.get("/api/events")
async def sse_endpoint(request: Request):
    """SSE endpoint for real-time server-to-client updates.
    
    Provides health status, job progress, and resource warnings
    via Server-Sent Events (SSE). The browser's EventSource API
    handles automatic reconnection and event resumption.
    """
    queue = await sse_manager.connect()

    async def event_generator():
        try:
            # Send initial connection event
            yield {
                "event": "connected",
                "data": json.dumps({
                    "type": "connected",
                    "timestamp": datetime.now().isoformat(),
                }),
            }

            while True:
                # Check if client disconnected
                if await request.is_disconnected():
                    break

                try:
                    # Wait for events from the queue (with timeout to send keepalive)
                    event_data = await asyncio.wait_for(queue.get(), timeout=15)
                    yield {
                        "id": event_data["id"],
                        "data": event_data["data"],
                    }
                except asyncio.TimeoutError:
                    # Send keepalive comment to prevent connection timeout
                    yield {
                        "event": "keepalive",
                        "data": json.dumps({
                            "type": "keepalive",
                            "timestamp": datetime.now().isoformat(),
                        }),
                    }
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"SSE connection error: {e}")
        finally:
            await sse_manager.disconnect(queue)

    return EventSourceResponse(event_generator())


def run():
    """Run the FastAPI application with resolved ports"""
    # Resolve ports BEFORE uvicorn binds so that:
    #   1. ports.json is accurate before the frontend starts, and
    #   2. the dynamic port resolution never sees the port we are about to bind
    #      as "occupied by a stale process".
    try:
        resolved_config = asyncio.run(port_manager.resolve_all_ports())
        port = resolved_config["backend_port"]
        logger.info(f"Resolved backend port: {port}")
    except Exception as e:
        logger.warning(f"Port pre-resolution failed, using default port {config.backend_port}: {e}")
        port = config.backend_port

    uvicorn_config = uvicorn.Config(
        app,
        host=config.backend_host,
        port=port,
        log_level=config.log_level.lower(),
        ws="websockets-sansio",
    )
    server = uvicorn.Server(uvicorn_config)
    asyncio.run(server.serve())


if __name__ == "__main__":
    run()
