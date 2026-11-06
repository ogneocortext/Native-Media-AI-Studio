"""
Health and diagnostics API routes.
"""

from __future__ import annotations

import asyncio
import logging
import operator
import time
from typing import Any

import httpx
from fastapi import APIRouter, Request

from ..adapters.registry import adapter_registry
from ..core.config import PROJECT_ROOT, config
from ..diagnostics.health import health_monitor
from ..diagnostics.resources import resource_monitor

_GO_SIDECAR_ROLES = {
    "go-dashboard": "SSE + service health",
    "go-media": "FFmpeg media processing",
    "go-worker": "Async job + sidecar I/O",
    "go-gateway": "MCP bridge proxy",
    "go-ports": "Port availability checks",
}

_GO_SIDECARS = {
    "go-dashboard": ("go_dashboard_url", "/api/health"),
    "go-media": ("go_media_url", "/api/health"),
    "go-worker": ("go_worker_url", "/health"),
    "go-gateway": ("go_gateway_url", "/health"),
    "go-ports": ("go_ports_url", "/api/health"),
}

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/health", tags=["Health"])


async def _check_go_sidecar(name: str, url_attr: str, path: str) -> dict[str, Any]:
    url = getattr(config, url_attr, "")
    port = None
    if url:
        from urllib.parse import urlparse

        port = urlparse(url).port
    if not url:
        return {
            "name": name,
            "status": "offline",
            "url": None,
            "port": port,
            "error": "not configured",
        }
    started = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(2.0, connect=1.0)) as client:
            response = await client.get(f"{url.rstrip('/')}{path}")
        response.raise_for_status()
        return {
            "name": name,
            "role": _GO_SIDECAR_ROLES.get(name, "Go service"),
            "status": "online",
            "url": url,
            "port": port,
            "latency_ms": round((time.perf_counter() - started) * 1000, 1),
            "data": response.json(),
        }
    except Exception as exc:
        return {
            "name": name,
            "role": _GO_SIDECAR_ROLES.get(name, "Go service"),
            "status": "offline",
            "url": url,
            "port": port,
            "latency_ms": round((time.perf_counter() - started) * 1000, 1),
            "error": str(exc),
        }


@router.get("/ping", response_model=dict)
async def ping() -> dict:
    """Simple ping endpoint"""
    return {"status": "ok", "timestamp": ""}


@router.get("", response_model=dict)
@router.get("/", response_model=dict)
async def health_root() -> dict:
    """Aggregate health check returning backend and all adapter statuses."""
    return await health_check()


@router.get("/health", response_model=dict)
async def health_check() -> dict:
    """Aggregate health check returning backend and all adapter statuses.

    Returns:
        {
            "status": "healthy|degraded|unhealthy",
            "backend": "online|offline",
            "adapters": {
                "comfyui": {...},
                "ollama": {...}
            },
            "overall": "healthy|degraded"
        }
    """
    aggregate = await health_monitor.get_aggregate_health()

    # Map internal status to API response format
    # "healthy" in aggregate maps to "online" for backend
    backend_status = "online"

    # Map adapter statuses: healthy -> online, degraded/offline -> offline
    adapters_response = {}
    for name, adapter_data in aggregate.get("adapters", {}).items():
        adapter_status = adapter_data.get("status", "offline")
        error_msg = adapter_data.get("error")
        adapters_response[name] = {
            "status": "online" if adapter_status == "healthy" else "offline",
            "url": adapter_data.get("url"),
            "response_time_ms": adapter_data.get("response_time_ms"),
            "error": error_msg,
        }

    return {
        "status": aggregate.get("status", "healthy"),
        "backend": backend_status,
        "adapters": adapters_response,
        "overall": aggregate.get("overall", "healthy"),
    }


@router.get("/health/agent")
async def agent_health() -> dict:
    """Unified agent-friendly health endpoint with all service states.

    This endpoint consolidates health information from multiple sources into
    a single response optimized for AI agent consumption. It includes:

    - Backend health and runtime info
    - All adapter statuses (ComfyUI, Ollama, etc.)
    - Go sidecar statuses
    - GPU availability and VRAM
    - Queue health (including stranded jobs)
    - Model availability (Ollama)

    This is designed to be the single endpoint an agent calls to determine
    whether the system is ready for work and what services are available.

    Returns:
        {
            "overall_status": "healthy|degraded|unhealthy",
            "backend": {...},
            "adapters": {...},
            "sidecars": {...},
            "gpu": {...},
            "queue": {...},
            "models": {...},
            "timestamp": "ISO-8601"
        }
    """
    import time

    # Collect all health data in parallel where possible
    aggregate = await health_monitor.get_aggregate_health()

    # Backend info
    import sys

    backend_info = {
        "status": "online",
        "python_version": sys.version.split()[0],
        "python_executable": sys.executable,
        "python_prefix": sys.prefix,
    }

    # Adapters
    adapters = {}
    for name, adapter_data in aggregate.get("adapters", {}).items():
        adapters[name] = {
            "status": "online" if adapter_data.get("status") == "healthy" else "offline",
            "url": adapter_data.get("url"),
            "response_time_ms": adapter_data.get("response_time_ms"),
            "error": adapter_data.get("error"),
        }

    # Go sidecars
    sidecar_tasks = {
        name: _check_go_sidecar(name, url_attr, path)
        for name, (url_attr, path) in _GO_SIDECARS.items()
    }
    sidecar_names = list(sidecar_tasks)
    sidecar_results = await asyncio.gather(*(sidecar_tasks[name] for name in sidecar_names))
    sidecars = dict(zip(sidecar_names, sidecar_results, strict=True))

    # GPU snapshot
    gpu = await resource_monitor.get_gpu_snapshot()

    # Queue health
    from ..queue.manager import queue_manager

    queue_stats = await queue_manager.get_stats()
    stranded = await queue_manager.count_stale_running_jobs()
    queue_info = {
        "is_healthy": queue_stats.is_healthy and queue_stats.active_jobs < 50 and stranded == 0,
        "active_jobs": queue_stats.active_jobs,
        "queued_jobs": queue_stats.queued_jobs,
        "failed_jobs": queue_stats.failed_jobs,
        "stranded_running_jobs": stranded,
    }

    # Ollama models
    from ..core import ollama_client as _oc
    from ..core.urls import ollama_url

    models_info = {"loaded": False, "server_online": False, "models": []}
    try:
        import aiohttp

        session = await _oc.get_shared_session()
        async with session.get(
            ollama_url("/api/ps"), timeout=aiohttp.ClientTimeout(total=5)
        ) as resp:
            if resp.status == 200:
                data = await resp.json()
                models_info = {
                    "loaded": len(data.get("models", [])) > 0,
                    "server_online": True,
                    "models": [
                        {
                            "name": m.get("name", "unknown"),
                            "size_mb": (m.get("size", 0) or 0) // (1024 * 1024),
                            "vram_mb": (m.get("size_vram", 0) or 0) // (1024 * 1024),
                        }
                        for m in data.get("models", [])
                    ],
                }
    except Exception:
        pass

    # Determine overall status
    adapter_statuses = [a.get("status") for a in adapters.values()]
    sidecar_statuses = [s.get("status") for s in sidecars.values()]
    any_online = any(s == "online" for s in adapter_statuses + sidecar_statuses)

    if not queue_info["is_healthy"]:
        overall = "unhealthy"
    elif not gpu.get("available"):
        overall = "degraded"
    elif not models_info["server_online"]:
        overall = "degraded"
    elif not any_online:
        overall = "degraded"
    else:
        overall = "healthy"

    return {
        "overall_status": overall,
        "backend": backend_info,
        "adapters": adapters,
        "sidecars": sidecars,
        "gpu": gpu,
        "queue": queue_info,
        "models": models_info,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


@router.get("/render/health")
async def render_health() -> dict:
    """Full health check for rendering services"""
    return await health_monitor.get_system_health()


@router.get("/gpu")
async def gpu_snapshot(*, log: bool = True) -> dict:
    """GPU snapshot: VRAM load, utilization, temperature, and per-process breakdown."""
    snap = await resource_monitor.get_gpu_snapshot()
    if log and snap.get("available"):
        try:
            import asyncio as _asyncio

            from ..core.database import log_gpu_telemetry

            # off-thread DB write so NVML poll stays fast
            await _asyncio.to_thread(log_gpu_telemetry, snap)
        except Exception as e:
            logger.debug("GPU telemetry write skipped: %s", e)
    return snap


@router.get("/gpu/processes")
async def gpu_processes() -> dict:
    """Per-process GPU memory usage via Windows Performance Counters (WDDM)."""
    processes = await resource_monitor.get_gpu_processes_human()
    return {"processes": processes, "count": len(processes)}


@router.get("/gpu/history")
async def gpu_history(
    range: str | None = None,
    since_ms: int | None = None,
    limit: int = 2000,
    *,
    include_processes: bool = False,
) -> dict:
    """Trending history from DB. `range` = 5m|15m|1h|6h|12h|24h|7d, or explicit since_ms epoch."""
    import time as _time

    from ..core.database import get_gpu_history

    if since_ms is None and range:
        mapping = {
            "5m": 5 * 60 * 1000,
            "15m": 15 * 60 * 1000,
            "30m": 30 * 60 * 1000,
            "1h": 60 * 60 * 1000,
            "6h": 6 * 60 * 60 * 1000,
            "12h": 12 * 60 * 60 * 1000,
            "24h": 24 * 60 * 60 * 1000,
            "7d": 7 * 24 * 60 * 60 * 1000,
        }
        ms = mapping.get(range)
        if ms is not None:
            since_ms = int(_time.time() * 1000) - ms
    limit = max(1, min(limit, 10000))
    pts = get_gpu_history(since_ms=since_ms, limit=limit, include_processes=include_processes)
    return {"points": pts, "count": len(pts), "since_ms": since_ms}


@router.get("/gpu/stats")
async def gpu_stats(range: str | None = None, since_ms: int | None = None) -> dict:
    """Aggregated stats + trend over window."""
    import time as _time

    from ..core.database import get_gpu_stats

    if since_ms is None and range:
        mapping = {
            "5m": 5 * 60 * 1000,
            "15m": 15 * 60 * 1000,
            "30m": 30 * 60 * 1000,
            "1h": 60 * 60 * 1000,
            "6h": 6 * 60 * 60 * 1000,
            "12h": 12 * 60 * 60 * 1000,
            "24h": 24 * 60 * 60 * 1000,
            "7d": 7 * 24 * 60 * 60 * 1000,
        }
        ms = mapping.get(range)
        if ms is not None:
            since_ms = int(_time.time() * 1000) - ms
    return get_gpu_stats(since_ms=since_ms)


@router.delete("/gpu/history")
async def gpu_history_clear(keep_days: int = 0) -> dict:
    """Clear history. keep_days=0 wipes all; otherwise keep last N days."""
    from ..core.database import cleanup_old_gpu_telemetry

    if keep_days <= 0:
        from ..core.database import get_db

        with get_db() as conn:
            cur = conn.execute("DELETE FROM gpu_telemetry")
            return {"deleted": cur.rowcount, "kept_days": 0}
    deleted = cleanup_old_gpu_telemetry(keep_days=keep_days)
    return {"deleted": deleted, "kept_days": keep_days}


@router.get("/ollama/models")
async def ollama_models() -> dict:
    """Get currently loaded Ollama models with VRAM usage and active tasks."""
    import aiohttp

    from ..adapters.registry import adapter_registry
    from ..core import ollama_client as _oc
    from ..core.urls import ollama_url

    try:
        session = await _oc.get_shared_session()
        async with session.get(
            ollama_url("/api/ps"), timeout=aiohttp.ClientTimeout(total=5)
        ) as resp:
            if resp.status != 200:
                return {"loaded": False, "server_online": False, "models": [], "activity": {}}
            data = await resp.json()
            models = data.get("models", [])

            # Get activity tracking from adapter
            activity = {}
            adapter = adapter_registry.get("ollama")
            if adapter and hasattr(adapter, "get_activity"):
                activity = adapter.get_activity()

            return {
                "loaded": len(models) > 0,
                "server_online": True,
                "models": [
                    {
                        "name": m.get("name", "unknown"),
                        "size_mb": (m.get("size", 0) or 0) // (1024 * 1024),
                        "vram_mb": (m.get("size_vram", 0) or 0) // (1024 * 1024),
                        "expires_at": m.get("expires_at", ""),
                        "activity": activity.get(m.get("name", "")),
                    }
                    for m in models
                ],
                "activity": activity,
            }
    except Exception as e:
        return {
            "loaded": False,
            "server_online": False,
            "models": [],
            "activity": {},
            "error": str(e),
        }


@router.post("/ollama/clear-activity")
async def clear_ollama_activity() -> dict:
    """Manually clear all Ollama activity tracking (for stuck tasks)."""
    from ..adapters.registry import adapter_registry

    adapter = adapter_registry.get("ollama")
    if not adapter:
        return {"status": "error", "detail": "Ollama not available"}
    adapter._active_tasks.clear()
    return {"status": "cleared"}


@router.get("/ffmpeg")
async def ffmpeg_status() -> dict:
    """Check for running ffmpeg processes."""
    try:
        import psutil

        procs = []
        for proc in psutil.process_iter(["pid", "name", "cpu_percent", "memory_info"]):
            try:
                if "ffmpeg" in (proc.info.get("name") or "").lower():
                    mem = proc.info.get("memory_info")
                    procs.append(
                        {
                            "pid": proc.info.get("pid"),
                            "cpu": proc.info.get("cpu_percent"),
                            "working_set_mb": round(mem.rss / (1024 * 1024), 1) if mem else 0,
                        }
                    )
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
        return {"running": bool(procs), "count": len(procs), "processes": procs}
    except Exception:
        return {"running": False, "count": 0, "processes": []}


@router.get("/diagnostics")
async def get_diagnostics() -> dict:
    """Get full diagnostics report"""
    return await health_monitor.get_full_diagnostics(config)


@router.get("/diagnostics/services")
async def check_services() -> dict:
    """Check all external services including sidecars."""
    adapter_results = await health_monitor.check_all_services(config)
    tasks = {
        name: _check_go_sidecar(name, url_attr, path)
        for name, (url_attr, path) in _GO_SIDECARS.items()
    }
    names = list(tasks)
    results = await asyncio.gather(*(tasks[name] for name in names))
    sidecar_results = dict(zip(names, results, strict=True))
    return {
        "adapters": adapter_results,
        "sidecars": sidecar_results,
    }


@router.get("/diagnostics/system")
async def system_diagnostics() -> dict:
    """Get system diagnostics"""
    data = await health_monitor.get_system_health()
    # Which environment is actually serving requests?
    #
    # This is not visible anywhere else and has been the source of real
    # confusion: on Windows the venv launcher (D:\conda-envs\nma-studio-cuda)
    # launches a process whose ExecutablePath is the *base* interpreter
    # (Python311), so task-manager and CIM both show C:\...\Python311 and the
    # server looks like it is running in the wrong environment. It is not -
    # sys.prefix is what identifies the environment, and a wrong one has
    # different packages (Python311 base has no madmom_infer and a broken
    # torch/numpy bridge).
    #
    # Reporting sys.executable and sys.prefix makes that checkable in one call
    # instead of inferring it from process listings.
    import sys

    return {
        **data,
        "python": {
            "executable": sys.executable,
            "prefix": sys.prefix,
            "base_prefix": sys.base_prefix,
            "version": sys.version.split()[0],
        },
    }


@router.get("/queue")
async def queue_health() -> dict:
    """Queue health snapshot for Go sidecars and frontend."""
    from ..queue.manager import queue_manager

    stats = await queue_manager.get_stats()
    metrics = await queue_manager.get_metrics()
    # Jobs stranded in RUNNING by a crashed/restarted worker. They count as
    # "active" forever while nothing is actually running, so a queue can look
    # busy and healthy while being completely wedged. Surface them explicitly
    # rather than letting `active_jobs < 50` mask it.
    stranded = await queue_manager.count_stale_running_jobs()
    return {
        "stats": stats.model_dump(mode="json"),
        "metrics": metrics,
        "stranded_running_jobs": stranded,
        "is_healthy": stats.is_healthy and stats.active_jobs < 50 and stranded == 0,
    }


@router.post("/diagnostics/memory/cleanup")
async def cleanup_memory() -> dict:
    """Trigger system RAM cleanup (GC, torch cache, old temp files, Ollama offload if needed)."""
    import psutil

    from ..diagnostics.resources import resource_monitor

    before = psutil.virtual_memory().percent
    result = await resource_monitor.cleanup_system_memory()
    after = psutil.virtual_memory().percent
    mem = psutil.virtual_memory()
    return {
        "before_percent": before,
        "after_percent": after,
        "freed_percent": round(before - after, 1),
        "actions": result["actions"],
        "memory": {
            "total_mb": mem.total // (1024 * 1024),
            "used_mb": mem.used // (1024 * 1024),
            "available_mb": mem.available // (1024 * 1024),
            "percent": mem.percent,
        },
    }


@router.get("/diagnostics/memory")
async def memory_diagnostics() -> dict:
    """Get detailed memory breakdown including top processes by RAM usage."""
    import psutil

    mem = psutil.virtual_memory()
    total_mb = mem.total // (1024 * 1024)
    used_mb = mem.used // (1024 * 1024)
    available_mb = mem.available // (1024 * 1024)

    # Get top processes by memory usage (limit to 50 for speed)
    processes = []
    try:
        for proc in psutil.process_iter(["pid", "name", "memory_percent"]):
            try:
                info = proc.info
                if info.get("name") and info.get("memory_percent", 0) > 0.5:
                    # Only get rss for processes using > 0.5% memory
                    try:
                        rss = proc.memory_info().rss
                    except Exception:
                        continue
                    processes.append(
                        {
                            "pid": info["pid"],
                            "name": info["name"],
                            "mem_mb": rss // (1024 * 1024),
                            "mem_percent": round(info.get("memory_percent", 0) or 0, 1),
                        }
                    )
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
    except Exception:
        pass

    # Sort by memory descending, take top 15
    processes.sort(key=operator.itemgetter("mem_mb"), reverse=True)
    top_processes = processes[:15]

    return {
        "memory": {
            "total_mb": total_mb,
            "used_mb": used_mb,
            "available_mb": available_mb,
            "percent": mem.percent,
        },
        "top_processes": top_processes,
        "process_count": len(processes),
    }


# Note: /api/services/status is registered at root level in main.py


@router.post("/services/{service}/check")
async def check_service(service: str) -> dict:
    """Check a specific service"""
    adapter = adapter_registry.get(service)
    if not adapter:
        return {"status": "error", "message": f"Unknown service: {service}"}

    is_healthy = await adapter.health_check()
    return {
        "service": service,
        "status": "healthy" if is_healthy else "offline",
        "url": adapter.base_url,
    }


# Shared MCP context store: lightweight state for character, scene, audio, viz.
# This is intentionally simple file-backed state so MCP servers can read it
# without tight coupling to the frontend or backend session.

_CONTEXT_PATH = config.output_dir / "mcp-context.json"


def _read_context() -> dict:
    try:
        import json

        if not _CONTEXT_PATH.exists():
            return {}
        return json.loads(_CONTEXT_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _write_context(data: dict) -> None:
    try:
        import json

        _CONTEXT_PATH.parent.mkdir(parents=True, exist_ok=True)
        _CONTEXT_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")
    except Exception:
        pass


@router.get("/context")
async def get_mcp_context() -> dict:
    return _read_context()


@router.post("/context")
async def set_mcp_context(payload: dict) -> dict:
    _write_context(payload or {})
    return {"ok": True, "context": _read_context()}


# ---------------------------------------------------------------------------
# API Catalog (agent-friendly endpoint discovery)
# ---------------------------------------------------------------------------


@router.get("/catalog")
async def api_catalog(request: Request) -> dict:
    """Agent-friendly API catalog: groups endpoints by category for discovery.

    Returns a structured catalog of all API endpoints, grouped by functional
    area. This is designed for AI agents to programmatically discover available
    endpoints without parsing the full OpenAPI spec or reading source code.

    Returns:
        {
            "version": "1.0",
            "categories": {
                "health": [{"path": "/api/health", "method": "GET", "description": "..."}],
                "audio": [...],
                "video": [...],
                ...
            }
        }
    """
    # Access app from request state to avoid circular import
    app = request.app
    openapi_schema = app.openapi()
    paths = openapi_schema.get("paths", {})

    # Define category mappings (path prefix -> category name)
    categories = {
        "/api/health": "Health & Diagnostics",
        "/api/audio": "Audio Processing",
        "/api/video": "Video Processing",
        "/api/image": "Image Processing",
        "/api/comfyui": "ComfyUI Integration",
        "/api/ollama": "Ollama/LLM",
        "/api/retrieval": "Knowledge Retrieval",
        "/api/media": "Media Library",
        "/api/outputs": "Output Management",
        "/api/jobs": "Job Queue",
        "/api/hardware": "Hardware/GPU",
        "/api/transcription": "Transcription",
        "/api/vision": "Vision Analysis",
        "/api/unity": "Unity Integration",
        "/api/blender": "Blender Integration",
        "/api/hyperframes": "HyperFrames",
        "/api/sub_agent": "Sub-agent Operations",
        "/api/logs": "Logs & Analytics",
        "/api/data": "Data Services",
        "/api/database_admin": "Database Admin",
        "/api/integrations": "External Integrations",
        "/api/music": "Music Generation",
        "/api/lyrics": "Lyrics Processing",
        "/api/native_open": "Native OpenAI Bridge",
        "/api/treblo_tags": "Treblo Tags",
        "/api/mcp_validate": "MCP Validation",
        "/api/notifications": "Notifications",
    }

    # Group endpoints by category
    catalog: dict[str, list[dict]] = {}
    for path, path_item in paths.items():
        # Determine category from path prefix
        category = "Other"
        for prefix, cat_name in categories.items():
            if path.startswith(prefix):
                category = cat_name
                break

        if category not in catalog:
            catalog[category] = []

        # Extract endpoint info for each method
        for method, details in path_item.items():
            if method.lower() in ["get", "post", "put", "delete", "patch"]:
                catalog[category].append(
                    {
                        "path": path,
                        "method": method.upper(),
                        "summary": details.get("summary", ""),
                        "description": details.get("description", ""),
                        "tags": details.get("tags", []),
                    }
                )

    # Sort categories and endpoints
    sorted_catalog = dict(sorted(catalog.items()))
    for cat in sorted_catalog:
        sorted_catalog[cat].sort(key=operator.itemgetter("path", "method"))

    return {
        "version": "1.0",
        "backend_url": f"http://{config.backend_host}:{config.backend_port}",
        "categories": sorted_catalog,
        "total_endpoints": sum(len(eps) for eps in sorted_catalog.values()),
    }


# ---------------------------------------------------------------------------
# Model Reliability (programmatic access to model scores)
# ---------------------------------------------------------------------------


@router.get("/model-reliability")
async def model_reliability() -> dict:
    """Programmatic access to model reliability scores for agent decision-making.

    Returns the same scoring data as `tools/model-reliability/score.py` but
    via HTTP so agents can query it without running CLI commands or reading
    the tracked output files.

    Scoring rules (see tools/model-reliability/README.md):
        +20 per source currently listing the model as free (max 40)
        +30 if observed working within 7 days (else +15 if within 30 days)
        -50 if observed failing within 7 days
        floor 0

    Returns:
        {
            "models": [
                {
                    "name": "gemma4:e2b-it-qat",
                    "score": 70,
                    "tier": "RELIABLE NOW",
                    "sources": ["ollama"],
                    "last_worked": "2026-11-15",
                    "last_failed": null,
                    "notes": []
                },
                ...
            ],
            "snapshot_dates": {"ollama": "2026-11-15"},
            "updated_at": "2026-11-15T10:30:00Z"
        }
    """
    import datetime
    import glob
    import json
    import os

    base = os.path.join(str(PROJECT_ROOT), "tools", "model-reliability")
    snap_dir = os.path.join(base, "snapshots")
    observed_path = os.path.join(base, "observed.jsonl")

    def days_ago(d):
        return (datetime.date.today() - datetime.date.fromisoformat(d)).days

    def latest_snapshots():
        latest = {}
        if not os.path.isdir(snap_dir):
            return latest
        for path in glob.glob(os.path.join(snap_dir, "*.json")):
            try:
                with open(path, encoding="utf-8") as f:
                    snap = json.load(f)
                src = snap["source"]
                if src not in latest or snap["fetched_at"] > latest[src]["fetched_at"]:
                    latest[src] = snap
            except Exception:
                continue
        return latest

    def load_observed():
        rows = []
        if not os.path.exists(observed_path):
            return rows
        try:
            with open(observed_path, encoding="utf-8-sig") as f:
                for line in f:
                    line = line.strip()
                    if line:
                        r = json.loads(line)
                        if r.get("model") and r.get("model") != "*":
                            rows.append(r)
        except Exception:
            pass
        return rows

    def model_observed(model, rows):
        worked, failed, notes = [], [], []
        for r in rows:
            if r["model"] != model:
                continue
            if "worked" in r:
                worked_bool = bool(r["worked"])
            elif "outcome" in r:
                worked_bool = str(r["outcome"]).lower() == "success"
            else:
                worked_bool = True
            date = r.get("date")
            if not date and r.get("ts"):
                date = str(r["ts"])[:10]
            if date:
                (worked if worked_bool else failed).append(date)
            if r.get("note"):
                notes.append(f"[{r.get('route', '?')}] {r['note']}")
        return (max(worked) if worked else None, max(failed) if failed else None, notes)

    def tier_for(score, lw, lf):
        if lf and (not lw or lf >= lw) and days_ago(lf) <= 7:
            return "AVOID"
        if lw and days_ago(lw) <= 7:
            return "RELIABLE NOW"
        if lw:
            return "worked before"
        return "listed, untested"

    def score_model(sources, lw, lf):
        score = 20 * len(sources)
        if lw and days_ago(lw) <= 7:
            score += 30
        elif lw and days_ago(lw) <= 30:
            score += 15
        if lf and days_ago(lf) <= 7:
            score -= 50
        return max(0, score)

    snaps = latest_snapshots()
    rows = load_observed()

    advertised = {}
    for src, snap in snaps.items():
        for m in snap["models"]:
            advertised.setdefault(m["id"], set()).add(src)

    for r in rows:
        if r["model"] not in advertised:
            advertised[r["model"]] = set()

    if not advertised:
        return {
            "models": [],
            "snapshot_dates": {},
            "updated_at": datetime.datetime.utcnow().isoformat() + "Z",
            "note": "No observed sessions and no snapshots available",
        }

    table = []
    for model, sources in advertised.items():
        lw, lf, model_notes = model_observed(model, rows)
        score = score_model(sources, lw, lf)
        table.append(
            {
                "name": model,
                "score": score,
                "tier": tier_for(score, lw, lf),
                "sources": sorted(sources),
                "last_worked": lw,
                "last_failed": lf,
                "notes": model_notes[:2],  # Limit to top 2 notes
            }
        )

    table.sort(key=lambda t: (-t["score"], t["name"]))

    return {
        "models": table,
        "snapshot_dates": {s: snaps[s]["fetched_at"][:10] for s in sorted(snaps)},
        "updated_at": datetime.datetime.utcnow().isoformat() + "Z",
    }
