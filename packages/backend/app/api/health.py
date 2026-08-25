"""
Health and diagnostics API routes.
"""
from fastapi import APIRouter

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


@router.get("/3d/status")
async def gen3d_status() -> dict:
    """3D generation service status."""
    from ..services.gen3d import gen3d_service
    return gen3d_service.get_status()


@router.post("/3d/generate")
async def gen3d_generate(request: dict) -> dict:
    """Generate a 3D model from text prompt.

    Request body:
        prompt: Text description
        output_name: Optional filename
        steps: Diffusion steps (default 15)
        seed: Random seed (default 42)
    """
    from ..services.gen3d import gen3d_service
    return await gen3d_service.generate_from_text(
        prompt=request.get("prompt", ""),
        output_name=request.get("output_name"),
        steps=request.get("steps", 15),
        seed=request.get("seed", 42),
    )


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
