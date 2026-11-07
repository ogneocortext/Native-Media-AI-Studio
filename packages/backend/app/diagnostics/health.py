"""
Health monitoring and diagnostics.
"""

import asyncio
import logging
import platform
import sys
import time
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any

import psutil

logger = logging.getLogger(__name__)


# (minimum build, display name) — Windows 11 starts at build 22000.
_WINDOWS_BUILD_NAMES = [
    (22631, "11 24H2"),
    (22621, "11 23H2"),
    (22000, "11 21H2/22H2"),
    (19045, "10 22H2"),
    (19044, "10 21H2"),
    (19041, "10 2004"),
]


def get_windows_version() -> str:
    """Get the correct Windows display version (e.g., Windows 11 Pro)."""
    if sys.platform != "win32":
        return platform.version()

    try:
        version = sys.getwindowsversion()
        build = version.build

        display_name = next(
            (name for min_build, name in _WINDOWS_BUILD_NAMES if build >= min_build),
            f"10 (Build {build})",
        )

        edition = _windows_edition()
        if edition:
            return f"Windows {display_name} {edition}"
        return f"Windows {display_name}"
    except Exception:
        return platform.version()


def _windows_edition() -> str | None:
    """Read the Windows edition name from the registry. None on failure."""
    try:
        import winreg

        key = winreg.OpenKey(
            winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows NT\CurrentVersion"
        )
        try:
            edition, _ = winreg.QueryValueEx(key, "DisplayEdition")
        except OSError:
            edition, _ = winreg.QueryValueEx(key, "EditionID")
        winreg.CloseKey(key)
        return edition
    except Exception:
        return None


class ServiceHealth(StrEnum):
    """Service health states"""
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    OFFLINE = "offline"


@dataclass
class CircuitBreakerState:
    """Circuit breaker state for an adapter"""
    failures: int = 0
    last_failure: datetime | None = None
    state: str = "closed"  # closed, open, half_open
    last_success: datetime | None = None


class CircuitBreaker:
    """Circuit breaker for adapter health checks"""

    def __init__(
        self,
        failure_threshold: int = 3,
        recovery_timeout: float = 60.0,
        half_open_max_calls: int = 3,
    ):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.half_open_max_calls = half_open_max_calls
        self._states: dict[str, CircuitBreakerState] = {}
        self._half_open_calls: dict[str, int] = {}

    def can_execute(self, name: str) -> bool:
        """Check if we can execute a health check for this adapter"""
        state = self._states.get(name)
        if not state:
            return True

        if state.state == "open":
            # Check if recovery timeout has passed
            if state.last_failure and \
               (datetime.now() - state.last_failure).total_seconds() > self.recovery_timeout:
                state.state = "half_open"
                self._half_open_calls[name] = 0
                logger.info(f"Circuit breaker for {name} moved to half-open")
                return True
            return False

        if state.state == "half_open":
            calls = self._half_open_calls.get(name, 0)
            return calls < self.half_open_max_calls

        return True  # closed

    def record_success(self, name: str):
        """Record a successful health check"""
        state = self._states.get(name)
        if not state:
            return

        state.failures = 0
        state.last_success = datetime.now()
        state.state = "closed"
        if name in self._half_open_calls:
            del self._half_open_calls[name]

    def record_failure(self, name: str):
        """Record a failed health check"""
        state = self._states.get(name)
        if not state:
            state = CircuitBreakerState()
            self._states[name] = state

        state.failures += 1
        state.last_failure = datetime.now()

        if state.state == "half_open":
            state.state = "open"
            logger.warning(f"Circuit breaker for {name} opened after half-open failure")
        elif state.failures >= self.failure_threshold:
            state.state = "open"
            logger.warning(f"Circuit breaker for {name} opened after {state.failures} failures")

    def get_state(self, name: str) -> str:
        """Get current circuit breaker state"""
        state = self._states.get(name)
        return state.state if state else "closed"

    def get_timeout(self, name: str, default_timeout: float) -> float:
        """Get appropriate timeout based on circuit breaker state"""
        state = self._states.get(name)
        if not state or state.state == "closed":
            return default_timeout

        # If circuit is open or half-open, use much shorter timeout
        # to fail fast and not block health endpoint
        return min(default_timeout, 2.0)


class HealthMonitor:
    """Monitors system and service health"""

    def __init__(self):
        self._last_check: datetime | None = None
        self._cache: dict[str, Any] = {}
        self._cached_health: dict[str, Any] | None = None
        self._cache_ttl_seconds: float = 5.0  # Increased cache TTL for stability

        # Circuit breaker for adapter health checks
        self._circuit_breaker = CircuitBreaker(
            failure_threshold=3,
            recovery_timeout=60.0,
            half_open_max_calls=3,
        )

        # Offline adapter cache - remember adapters that are down
        self._offline_cache: dict[str, dict[str, Any]] = {}
        self._offline_cache_ttl: float = 30.0  # seconds

        # Per-adapter timeouts - reduced defaults
        self.default_timeout: float = 5.0  # Reduced from 8.0
        self.comfyui_timeout: float = 8.0  # Reduced from 15.0
        self.short_timeout: float = 2.0  # For offline services

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
            "usage_percent": psutil.cpu_percent(interval=None),
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
            disk = psutil.disk_usage(".")
            return {
                "total_gb": round(disk.total / (1024**3), 2),
                "free_gb": round(disk.free / (1024**3), 2),
                "percent": disk.percent,
            }
        except Exception:
            return {"error": "Unable to get disk info"}

    async def check_service(self, name: str, url: str | None = None) -> dict[str, Any]:
        """Check health of an external service using its adapter"""
        from ..adapters.registry import adapter_registry

        adapter = adapter_registry.get(name)
        if not adapter:
            return {
                "name": name,
                "status": ServiceHealth.OFFLINE.value,
                "error": "Adapter not found",
                "url": url,
            }

        try:
            is_healthy = await adapter.health_check()
            error = None
            if hasattr(adapter, "get_last_error"):
                error = adapter.get_last_error()
            return {
                "name": name,
                "status": ServiceHealth.HEALTHY.value
                if is_healthy
                else ServiceHealth.OFFLINE.value,
                "url": adapter.base_url,
                "adapter_name": adapter.name,
                "error": error,
            }
        except Exception as e:
            return {
                "name": name,
                "status": ServiceHealth.OFFLINE.value,
                "url": adapter.base_url if adapter else url,
                "error": str(e),
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
                "response_time_ms": None,
            }

        # Check circuit breaker first
        if not self._circuit_breaker.can_execute(name):
            logger.debug(f"Circuit breaker open for {name}, skipping health check")
            return self._get_offline_result(name, adapter)

        # Determine timeout based on circuit breaker state
        timeout = self._circuit_breaker.get_timeout(name,
            self.comfyui_timeout if name == "comfyui" else self.default_timeout)

        start_time = time.perf_counter()
        try:
            is_healthy = await asyncio.wait_for(adapter.health_check(), timeout=timeout)
            response_time_ms = round((time.perf_counter() - start_time) * 1000, 2)
            error = None
            if hasattr(adapter, "get_last_error"):
                error = adapter.get_last_error()

            result = {
                "name": name,
                "status": ServiceHealth.HEALTHY.value
                if is_healthy
                else ServiceHealth.OFFLINE.value,
                "url": adapter.base_url,
                "adapter_name": adapter.name,
                "response_time_ms": response_time_ms,
                "error": error,
            }

            # Update circuit breaker
            if is_healthy:
                self._circuit_breaker.record_success(name)
                # Remove from offline cache on success
                self._offline_cache.pop(name, None)
            else:
                self._circuit_breaker.record_failure(name)
                self._cache_offline_result(name, adapter)

            return result

        except TimeoutError:
            response_time_ms = round((time.perf_counter() - start_time) * 1000, 2)
            self._circuit_breaker.record_failure(name)
            self._cache_offline_result(name, adapter)
            return self._get_offline_result(name, adapter, "Health check timed out", response_time_ms)

        except Exception as e:
            response_time_ms = round((time.perf_counter() - start_time) * 1000, 2)
            self._circuit_breaker.record_failure(name)
            self._cache_offline_result(name, adapter)
            return self._get_offline_result(name, adapter, str(e), response_time_ms)

    def _get_offline_result(self, name: str, adapter: Any, error: str = None, response_time_ms: float = None) -> dict[str, Any]:
        """Get standardized offline result"""
        return {
            "name": name,
            "status": ServiceHealth.OFFLINE.value,
            "url": adapter.base_url if adapter else None,
            "adapter_name": adapter.name if adapter else None,
            "error": error,
            "response_time_ms": response_time_ms,
        }

    def _cache_offline_result(self, name: str, adapter: Any):
        """Cache offline result to avoid repeated checks"""
        self._offline_cache[name] = {
            "cached_at": datetime.now(),
            "url": adapter.base_url if adapter else None,
            "error": "Cached offline",
        }

    def _is_offline_cached(self, name: str) -> bool:
        """Check if adapter is in offline cache and cache is still valid"""
        if name not in self._offline_cache:
            return False
        entry = self._offline_cache[name]
        age = (datetime.now() - entry["cached_at"]).total_seconds()
        if age > self._offline_cache_ttl:
            del self._offline_cache[name]
            return False
        return True

    async def check_all_services(self, config: Any) -> dict[str, Any]:
        """Check health of all configured services with per-adapter timeouts."""
        from ..adapters.registry import adapter_registry

        results = {}
        for name, adapter in adapter_registry.get_all_adapters().items():
            try:
                result = await self.check_service_with_timing(name)
                results[name] = {
                    "name": name,
                    "status": result.get("status", ServiceHealth.OFFLINE.value),
                    "url": result.get("url", adapter.base_url),
                    "adapter_name": adapter.name,
                    "response_time_ms": result.get("response_time_ms"),
                    "error": result.get("error"),
                }
            except Exception as e:
                results[name] = {
                    "name": name,
                    "status": ServiceHealth.OFFLINE.value,
                    "url": adapter.base_url,
                    "adapter_name": adapter.name,
                    "error": str(e),
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
                timeout=10.0,  # Global timeout for all adapter checks
            )
        except TimeoutError:
            # If global timeout fires, mark all as offline
            for name in adapters.keys():
                results[name] = {
                    "status": ServiceHealth.OFFLINE.value,
                    "url": adapters[name].base_url,
                    "response_time_ms": 10000.0,
                    "error": "Health check timed out",
                }
            return results

        for result in check_results:
            if isinstance(result, Exception):
                idx = check_results.index(result)
                name = list(adapters.keys())[idx] if idx < len(adapters) else f"unknown_{idx}"
                results[name] = {
                    "status": ServiceHealth.OFFLINE.value,
                    "url": adapters[name].base_url if name in adapters else None,
                    "error": str(result),
                }
                continue
            adapter_name = result["name"]
            results[adapter_name] = {
                "status": result["status"],
                "url": result["url"],
                "response_time_ms": result.get("response_time_ms"),
            }

        return results

    async def get_aggregate_health(self) -> dict[str, Any]:
        """Get the full aggregate health status."""
        # Check if we have a recent cached result
        now = datetime.now()
        if (
            self._cached_health
            and self._last_check
            and (now - self._last_check).total_seconds() < self._cache_ttl_seconds
        ):
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
            "backend": "online",
            "adapters": adapters_health,
            "overall": overall,
            "timestamp": now.isoformat(),
        }
        self._last_check = now

        logger.debug(
            "Health check: status=%s, overall=%s, adapters=%s",
            status,
            overall,
            {k: v.get("status") for k, v in adapters_health.items()},
        )

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
