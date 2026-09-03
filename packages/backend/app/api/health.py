"""
Health and diagnostics API routes.
"""
import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, UploadFile

from ..adapters.registry import adapter_registry
from ..core.config import config
from ..diagnostics.health import health_monitor
from ..diagnostics.resources import resource_monitor

router = APIRouter(prefix="/api/health", tags=["Health"])


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
async def gpu_snapshot() -> dict:
    """GPU snapshot: VRAM load, utilization, temperature, and per-process breakdown."""
    return await resource_monitor.get_gpu_snapshot()


@router.get("/gpu/processes")
async def gpu_processes() -> dict:
    """Per-process GPU memory usage via Windows Performance Counters (WDDM)."""
    processes = await resource_monitor.get_gpu_processes_human()
    return {"processes": processes, "count": len(processes)}


@router.get("/ollama/models")
async def ollama_models() -> dict:
    """Get currently loaded Ollama models with VRAM usage and active tasks."""
    import urllib.request
    import json
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
async def gen3d_generate(request: dict) -> dict:
    """Generate a 3D model from text prompt.

    Request body:
        prompt: Text description
        output_name: Optional filename
        steps: Diffusion steps (default 15)
        seed: Random seed (default 42)
    """
    from ..services.gen3d.gen3d_service import gen3d_service
    return await gen3d_service.generate_from_text(
        prompt=request.get("prompt", ""),
        output_name=request.get("output_name"),
        steps=request.get("steps", 15),
        seed=request.get("seed", 42),
        cfg=request.get("cfg", 7.0),
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
    from ..diagnostics.resources import resource_monitor
    import psutil

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
