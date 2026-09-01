"""
Health monitoring and diagnostics.
"""
import asyncio
import logging
import platform
import sys
import time
from datetime import datetime
from enum import Enum
from typing import Any

import psutil

logger = logging.getLogger(__name__)


def get_windows_version() -> str:
    """Get the correct Windows display version (e.g., Windows 11 Pro)."""
    if sys.platform != 'win32':
        return platform.version()
    
    # On Windows, platform.version() returns the NT kernel version (e.g., "10.0.22631")
    # which doesn't directly tell us if it's Windows 10 or 11.
    # Windows 11 starts from build 22000.
    try:
        version = sys.getwindowsversion()
        build = version.build
        
        # Determine Windows display name based on build number
        if build >= 22631:
            display_name = "11 24H2"
        elif build >= 22621:
            display_name = "11 23H2"
        elif build >= 22000:
            display_name = "11 21H2/22H2"
        elif build >= 19045:
            display_name = "10 22H2"
        elif build >= 19044:
            display_name = "10 21H2"
        elif build >= 19041:
            display_name = "10 2004"
        else:
            display_name = f"10 (Build {build})"
        
        # Try to get the edition (Pro, Home, etc.)
        try:
            import winreg
            key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows NT\CurrentVersion")
            edition, _ = winreg.QueryValueEx(key, "DisplayEdition")
            product_name, _ = winreg.QueryValueEx(key, "ProductName")
            winreg.CloseKey(key)
            return f"Windows {display_name} {edition}"
        except Exception:
            # Fallback: try EditionID
            try:
                import winreg
                key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows NT\CurrentVersion")
                edition_id, _ = winreg.QueryValueEx(key, "EditionID")
                winreg.CloseKey(key)
                return f"Windows {display_name} {edition_id}"
            except Exception:
                return f"Windows {display_name}"
    except Exception:
        return platform.version()


class ServiceHealth(str, Enum):
    """Service health states"""
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    OFFLINE = "offline"


class HealthMonitor:
    """Monitors system and service health"""

    def __init__(self):
        self._last_check: datetime | None = None
        self._cache: dict[str, Any] = {}
        self._cached_health: dict[str, Any] | None = None
        self._cache_ttl_seconds: float = 2.0  # Cache health for 2 seconds to avoid excessive checks

    async def get_system_health(self) -> dict[str, Any]:
        """Get overall system health"""
        return {
            "status": ServiceHealth.HEALTHY.value,
            "timestamp": datetime.now().isoformat(),
            "platform": platform.system(),
            "platform_version": get_windows_version(),
            "cpu": self._get_cpu_info(),
            "memory": self._get_memory_info(),
            "disk": self._get_disk_info(),
        }

    def _get_cpu_info(self) -> dict[str, Any]:
        """Get CPU information"""
        return {
            "usage_percent": psutil.cpu_percent(interval=0.1),
            "count": psutil.cpu_count(),
            "count_logical": psutil.cpu_count(logical=True),
        }

    def _get_memory_info(self) -> dict[str, Any]:
        """Get memory information"""
        mem = psutil.virtual_memory()
        return {
            "total_gb": round(mem.total / (1024**3), 2),
            "available_gb": round(mem.available / (1024**3), 2),
            "used_gb": round(mem.used / (1024**3), 2),
            "percent": mem.percent,
        }

    def _get_disk_info(self) -> dict[str, Any]:
        """Get disk information"""
        try:
            disk = psutil.disk_usage('.')
            return {
                "total_gb": round(disk.total / (1024**3), 2),
                "free_gb": round(disk.free / (1024**3), 2),
                "percent": disk.percent,
            }
        except Exception:
            return {"error": "Unable to get disk info"}

    async def check_service(self, name: str, url: str | None = None) -> dict[str, Any]:
        """Check health of an external service using its adapter"""
        # Import here to avoid circular imports
        from ..adapters.registry import adapter_registry

        adapter = adapter_registry.get(name)
        if not adapter:
            return {
                "name": name,
                "status": ServiceHealth.OFFLINE.value,
                "error": "Adapter not found",
                "url": url
            }

        try:
            is_healthy = await adapter.health_check()
            error = None
            if hasattr(adapter, 'get_last_error'):
                error = adapter.get_last_error()
            return {
                "name": name,
                "status": ServiceHealth.HEALTHY.value if is_healthy else ServiceHealth.OFFLINE.value,
                "url": adapter.base_url,
                "adapter_name": adapter.name,
                "error": error,
            }
        except Exception as e:
            return {
                "name": name,
                "status": ServiceHealth.OFFLINE.value,
                "url": adapter.base_url if adapter else url,
                "error": str(e)
            }

    async def check_service_with_timing(self, name: str, url: str | None = None) -> dict[str, Any]:
        """Check health of a service with response time measurement."""
        from ..adapters.registry import adapter_registry

        adapter = adapter_registry.get(name)
        if not adapter:
            return {
                "name": name,
                "status": ServiceHealth.OFFLINE.value,
                "error": "Adapter not found",
                "url": url,
                "response_time_ms": None
            }

        start_time = time.perf_counter()
        try:
            # Use asyncio.wait_for to enforce a per-adapter timeout
            is_healthy = await asyncio.wait_for(adapter.health_check(), timeout=8.0)
            response_time_ms = round((time.perf_counter() - start_time) * 1000, 2)
            error = None
            if hasattr(adapter, 'get_last_error'):
                error = adapter.get_last_error()
            return {
                "name": name,
                "status": ServiceHealth.HEALTHY.value if is_healthy else ServiceHealth.OFFLINE.value,
                "url": adapter.base_url,
                "adapter_name": adapter.name,
                "response_time_ms": response_time_ms,
                "error": error,
            }
        except asyncio.TimeoutError:
            response_time_ms = round((time.perf_counter() - start_time) * 1000, 2)
            return {
                "name": name,
                "status": ServiceHealth.OFFLINE.value,
                "url": adapter.base_url if adapter else url,
                "adapter_name": adapter.name if adapter else None,
                "error": "Health check timed out",
                "response_time_ms": response_time_ms
            }
        except Exception as e:
            response_time_ms = round((time.perf_counter() - start_time) * 1000, 2)
            return {
                "name": name,
                "status": ServiceHealth.OFFLINE.value,
                "url": adapter.base_url if adapter else url,
                "adapter_name": adapter.name if adapter else None,
                "error": str(e),
                "response_time_ms": response_time_ms
            }

    async def check_all_services(self, config: Any) -> dict[str, Any]:
        """Check health of all configured services"""
        from ..adapters.registry import adapter_registry

        results = {}
        for name, adapter in adapter_registry.get_all_adapters().items():
            try:
                is_healthy = await adapter.health_check()
                error = None
                if hasattr(adapter, 'get_last_error'):
                    error = adapter.get_last_error()
                results[name] = {
                    "name": name,
                    "status": ServiceHealth.HEALTHY.value if is_healthy else ServiceHealth.OFFLINE.value,
                    "url": adapter.base_url,
                    "adapter_name": adapter.name,
                    "error": error,
                }
            except Exception as e:
                results[name] = {
                    "name": name,
                    "status": ServiceHealth.OFFLINE.value,
                    "url": adapter.base_url,
                    "error": str(e)
                }

        return results

    async def check_all_adapters(self) -> dict[str, dict[str, Any]]:
        """Check all adapters and return structured response with response times."""
        from ..adapters.registry import adapter_registry

        adapters = adapter_registry.get_all_adapters()
        results = {}

        # Check all adapters concurrently with a global timeout
        tasks = [self.check_service_with_timing(name) for name in adapters.keys()]
        try:
            check_results = await asyncio.wait_for(
                asyncio.gather(*tasks, return_exceptions=True),
                timeout=10.0  # Global timeout for all adapter checks
            )
        except asyncio.TimeoutError:
            # If global timeout fires, mark all as offline
            for name in adapters.keys():
                results[name] = {
                    "status": ServiceHealth.OFFLINE.value,
                    "url": adapters[name].base_url,
                    "response_time_ms": 10000.0,
                    "error": "Health check timed out"
                }
            return results

        for result in check_results:
            if isinstance(result, Exception):
                # Find the adapter name from the tasks list
                idx = check_results.index(result)
                name = list(adapters.keys())[idx] if idx < len(adapters) else f"unknown_{idx}"
                results[name] = {
                    "status": ServiceHealth.OFFLINE.value,
                    "url": adapters[name].base_url if name in adapters else None,
                    "error": str(result),
                }
                continue
            adapter_name = result["name"]
            # Map to simplified structure for health endpoint
            results[adapter_name] = {
                "status": result["status"],
                "url": result["url"],
                "response_time_ms": result.get("response_time_ms")
            }

        return results

    async def get_aggregate_health(self) -> dict[str, Any]:
        """Get the full aggregate health status.
        
        Returns:
            dict with structure:
            {
                "status": "healthy|degraded|unhealthy",
                "backend": "online|offline",
                "adapters": {...},
                "overall": "healthy|degraded"
            }
        """
        # Check if we have a recent cached result
        now = datetime.now()
        if (self._cached_health and self._last_check and
            (now - self._last_check).total_seconds() < self._cache_ttl_seconds):
            return self._cached_health

        # Get adapter health with response times
        adapters_health = await self.check_all_adapters()

        # Determine overall status based on adapter states
        adapter_statuses = [adapter["status"] for adapter in adapters_health.values()]
        any_offline = any(s == ServiceHealth.OFFLINE.value for s in adapter_statuses)

        # Overall: healthy if all adapters online, degraded if any offline
        overall = "healthy" if not any_offline else "degraded"

        # Overall status: unhealthy if backend offline, degraded if adapters offline, healthy otherwise
        if any_offline:
            status = "degraded"
        else:
            status = "healthy"

        self._cached_health = {
            "status": status,
            "backend": "online",  # Backend is online if it responds to health check
            "adapters": adapters_health,
            "overall": overall,
            "timestamp": now.isoformat()
        }
        self._last_check = now

        logger.debug("Health check: status=%s, overall=%s, adapters=%s",
                     status, overall, {k: v.get("status") for k, v in adapters_health.items()})

        return self._cached_health

    async def get_full_diagnostics(self, config: Any) -> dict[str, Any]:
        """Get full diagnostic report"""
        return {
            "system": await self.get_system_health(),
            "services": await self.check_all_services(config),
            "timestamp": datetime.now().isoformat(),
        }


# Global health monitor
health_monitor = HealthMonitor()
