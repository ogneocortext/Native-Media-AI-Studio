"""
Health and diagnostics API routes.
"""
from __future__ import annotations

import logging
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, UploadFile
from pydantic import BaseModel

from ..adapters.registry import adapter_registry
from ..core.config import config
from ..diagnostics.health import health_monitor
from ..diagnostics.resources import resource_monitor

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/health", tags=["Health"])


class Gen3DGenerateRequest(BaseModel):
    """Request for generating a 3D model from text."""

    prompt: str
    output_name: str | None = None
    steps: int = 15
    seed: int = 42
    cfg: float = 7.0


@router.get("/ping")
async def ping() -> dict:
    """Simple ping endpoint"""
    return {"status": "ok", "timestamp": ""}


@router.get("/")
async def health_root() -> dict:
    """Redirect /api/health to /api/health/health for frontend compatibility"""
    return await health_check()


@router.get("")
async def health_check_alias() -> dict:
    """Alias for /api/health (frontend compatibility)"""
    return await health_check()


@router.get("/health")
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


@router.get("/render/health")
async def render_health() -> dict:
    """Full health check for rendering services"""
    return await health_monitor.get_system_health()


@router.get("/gpu")
async def gpu_snapshot(log: bool = True) -> dict:
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
    include_processes: bool = False,
) -> dict:
    """Trending history from DB. `range` = 5m|15m|1h|6h|12h|24h|7d, or explicit since_ms epoch."""
    import time as _time

    from ..core.database import get_gpu_history
    if since_ms is None and range:
        mapping = {"5m": 5*60*1000, "15m": 15*60*1000, "30m": 30*60*1000, "1h": 60*60*1000, "6h": 6*60*60*1000, "12h": 12*60*60*1000, "24h": 24*60*60*1000, "7d": 7*24*60*60*1000}
        ms = mapping.get(range)
        if ms is not None:
            since_ms = int(_time.time()*1000) - ms
    limit = max(1, min(limit, 10000))
    pts = get_gpu_history(since_ms=since_ms, limit=limit, include_processes=include_processes)
    return {"points": pts, "count": len(pts), "since_ms": since_ms}


@router.get("/gpu/stats")
async def gpu_stats(range: str | None = None, since_ms: int | None = None) -> dict:
    """Aggregated stats + trend over window."""
    import time as _time

    from ..core.database import get_gpu_stats
    if since_ms is None and range:
        mapping = {"5m": 5*60*1000, "15m": 15*60*1000, "30m": 30*60*1000, "1h": 60*60*1000, "6h": 6*60*60*1000, "12h": 12*60*60*1000, "24h": 24*60*60*1000, "7d": 7*24*60*60*1000}
        ms = mapping.get(range)
        if ms is not None:
            since_ms = int(_time.time()*1000) - ms
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
    import json
    import urllib.request

    from ..adapters.registry import adapter_registry
    try:
        req = urllib.request.Request("http://127.0.0.1:11434/api/ps")
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
            models = data.get("models", [])

            # Get activity tracking from adapter
            activity = {}
            adapter = adapter_registry.get("ollama")
            if adapter and hasattr(adapter, "get_activity"):
                activity = adapter.get_activity()

            return {
                "loaded": len(models) > 0,
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
        return {"loaded": False, "models": [], "activity": {}, "error": str(e)}


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
    import subprocess
    try:
        result = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "Get-Process -Name ffmpeg -ErrorAction SilentlyContinue | Select-Object Id, CPU, WorkingSet64 | ConvertTo-Json"],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0 and result.stdout.strip():
            import json
            processes = json.loads(result.stdout)
            if not isinstance(processes, list):
                processes = [processes]
            return {"running": True, "count": len(processes), "processes": processes}
    except Exception:
        pass
    return {"running": False, "count": 0, "processes": []}


@router.get("/3d/status")
async def gen3d_status() -> dict:
    """3D generation service status."""
    from ..services.gen3d.gen3d_service import gen3d_service
    return gen3d_service.get_status()


@router.get("/3d/models")
async def gen3d_models() -> list[dict]:
    """List generated 3D models (newest first) for the sidebar 'Recent Models' panel."""
    from ..services.gen3d.gen3d_service import gen3d_service
    return gen3d_service.list_models()


@router.post("/3d/generate")
async def gen3d_generate(body: Gen3DGenerateRequest) -> dict:
    """Generate a 3D model from text prompt."""
    from ..services.gen3d.gen3d_service import gen3d_service
    return await gen3d_service.generate_from_text(
        prompt=body.prompt,
        output_name=body.output_name,
        steps=body.steps,
        seed=body.seed,
        cfg=body.cfg,
    )


ALLOWED_REF_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp"}
MAX_REF_IMAGE_BYTES = 15 * 1024 * 1024


@router.post("/3d/generate-image")
async def gen3d_generate_image(
    file: UploadFile = File(...),
    steps: int = 15,
    output_name: str | None = None,
) -> dict:
    """Generate a 3D model from a reference image (face/body lock source).

    Uploads the image to a temp file, runs the Hunyuan3D image-to-3D chain,
    then removes the temp file. Use this with a single anchor reference to
    keep AI-generated characters consistent (see knowledge library:
    character consistency method).
    """
    if file.content_type not in ALLOWED_REF_IMAGE_TYPES:
        from fastapi import HTTPException
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported image type {file.content_type}; use PNG, JPEG, or WebP",
        )
    suffix = Path(file.filename or "reference.png").suffix.lower() or ".png"
    if suffix not in {".png", ".jpg", ".jpeg", ".webp"}:
        suffix = ".png"
    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp_path = Path(tmp.name)
        with tmp_path.open("wb") as out:
            size = 0
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_REF_IMAGE_BYTES:
                    raise ValueError("Reference image exceeds 15 MB")
                out.write(chunk)
        from ..services.gen3d.gen3d_service import gen3d_service
        return await gen3d_service.generate_from_image(
            image_path=str(tmp_path),
            output_name=output_name,
            steps=steps,
        )
    except ValueError as e:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        if tmp_path is not None:
            try:
                tmp_path.unlink(missing_ok=True)
            except OSError:
                pass


@router.get("/diagnostics")
async def get_diagnostics() -> dict:
    """Get full diagnostics report"""
    return await health_monitor.get_full_diagnostics(config)


@router.get("/diagnostics/services")
async def check_services() -> dict:
    """Check all external services"""
    return await health_monitor.check_all_services(config)


@router.get("/diagnostics/system")
async def system_diagnostics() -> dict:
    """Get system diagnostics"""
    return await health_monitor.get_system_health()


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
        for proc in psutil.process_iter(['pid', 'name', 'memory_percent']):
            try:
                info = proc.info
                if info.get('name') and info.get('memory_percent', 0) > 0.5:
                    # Only get rss for processes using > 0.5% memory
                    try:
                        rss = proc.memory_info().rss
                    except Exception:
                        continue
                    processes.append({
                        "pid": info['pid'],
                        "name": info['name'],
                        "mem_mb": rss // (1024 * 1024),
                        "mem_percent": round(info.get('memory_percent', 0) or 0, 1),
                    })
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
    except Exception:
        pass

    # Sort by memory descending, take top 15
    processes.sort(key=lambda p: p['mem_mb'], reverse=True)
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
        "url": adapter.base_url
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

