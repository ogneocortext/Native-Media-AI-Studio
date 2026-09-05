"""
Tests for per-adapter health check timeouts:
- check_service_with_timing enforces an 8-second timeout per adapter
- A hung adapter does not stall check_all_services
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.diagnostics.health import HealthMonitor, ServiceHealth


def _make_adapter(name: str, healthy: bool = True, delay: float = 0.0):
    adapter = MagicMock()
    adapter.name = name
    adapter.base_url = f"http://{name}:8080"
    if delay:

        async def _slow():
            await asyncio.sleep(delay)
            return healthy

        adapter.health_check = _slow
    else:
        adapter.health_check = AsyncMock(return_value=healthy)
    adapter.get_last_error.return_value = None
    return adapter


@pytest.mark.asyncio
async def test_check_service_with_timing_success():
    """Healthy adapter should return healthy status with response_time_ms."""
    monitor = HealthMonitor()
    adapter = _make_adapter("test", healthy=True)

    fake_registry = MagicMock()
    fake_registry.get.return_value = adapter

    with patch("app.adapters.registry.adapter_registry", fake_registry):
        result = await monitor.check_service_with_timing("test")

    assert result["status"] == ServiceHealth.HEALTHY.value
    assert result["response_time_ms"] is not None
    assert result["error"] is None


@pytest.mark.asyncio
async def test_check_service_with_timing_timeout():
    """Adapter that hangs past 8s should be marked offline."""
    monitor = HealthMonitor()
    # 20 seconds > 8s timeout
    adapter = _make_adapter("slow", healthy=True, delay=20.0)

    fake_registry = MagicMock()
    fake_registry.get.return_value = adapter

    with patch("app.adapters.registry.adapter_registry", fake_registry):
        result = await monitor.check_service_with_timing("slow")

    assert result["status"] == ServiceHealth.OFFLINE.value
    assert result["error"] == "Health check timed out"
    # Should return within ~8s, not 20s
    assert result["response_time_ms"] is not None


@pytest.mark.asyncio
async def test_check_all_services_does_not_stall_on_one_hung_adapter():
    """check_all_services must complete even if one adapter never responds."""
    monitor = HealthMonitor()

    fast_ok = _make_adapter("fast_ok", healthy=True, delay=0.01)
    hung = _make_adapter("hung", healthy=True, delay=30.0)
    fast_fail = _make_adapter("fast_fail", healthy=False, delay=0.01)

    adapter_map = {
        "fast_ok": fast_ok,
        "hung": hung,
        "fast_fail": fast_fail,
    }

    fake_registry = MagicMock()
    fake_registry.get_all_adapters.return_value = adapter_map
    fake_registry.get.side_effect = lambda name: adapter_map.get(name)

    with patch("app.adapters.registry.adapter_registry", fake_registry):
        # Should complete well under the hung adapter's delay
        start = asyncio.get_event_loop().time()
        results = await asyncio.wait_for(
            monitor.check_all_services(config=None), timeout=10.0
        )
        elapsed = asyncio.get_event_loop().time() - start

    assert elapsed < 9.0, f"check_all_services took {elapsed:.1f}s — hung adapter stalled it"
    assert "hung" in results
    assert results["hung"]["status"] == ServiceHealth.OFFLINE.value
    assert results["fast_ok"]["status"] == ServiceHealth.HEALTHY.value
