"""
Tests for the async offloading fix in diagnostics/resources.py:
- _get_ollama_vram_usage uses asyncio.to_thread for blocking urllib
- cleanup_system_memory offloads blocking urllib calls via asyncio.to_thread
- check_vram offloads blocking GPU calls via asyncio.to_thread
- get_gpu_snapshot offloads blocking NVML calls via asyncio.to_thread
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

from app.diagnostics.resources import ResourceMonitor


def test_get_ollama_vram_uses_to_thread():
    """_get_ollama_vram_usage must offload blocking urllib to a thread."""
    monitor = ResourceMonitor()

    fake_result = 128  # 128 MB

    async def fake_to_thread(func, *args, **kwargs):
        return fake_result

    with patch.object(asyncio, "to_thread", side_effect=fake_to_thread):
        result = asyncio.run(monitor._get_ollama_vram_usage())

    assert result == fake_result, "Expected to_thread to return the mocked VRAM value"


def test_cleanup_offloads_ollama_call_to_thread():
    """cleanup_system_memory must offload blocking Ollama offload to thread."""
    monitor = ResourceMonitor()

    fake_offload_result = "offloaded ollama test-model"

    async def fake_to_thread(func, *args, **kwargs):
        return fake_offload_result

    with patch.object(asyncio, "to_thread", side_effect=fake_to_thread), \
         patch("psutil.virtual_memory", return_value=MagicMock(percent=90)):
        result = asyncio.run(monitor.cleanup_system_memory())

    # The offload function should have been invoked via to_thread
    assert any("offloaded ollama" in str(a) for a in result.get("actions", [])), (
        f"Expected offload action in result, got {result}"
    )


@pytest.mark.asyncio
async def test_check_memory_does_not_block_event_loop():
    """ResourceMonitor.check_memory is async and must not block."""
    monitor = ResourceMonitor()

    # Should complete quickly without hanging
    result = await asyncio.wait_for(monitor.check_memory(), timeout=2.0)
    # Result is either None or a warning dict
    assert result is None or isinstance(result, dict)


@pytest.mark.asyncio
async def test_check_vram_uses_to_thread():
    """check_vram must offload blocking GPU calls to a thread."""
    monitor = ResourceMonitor()

    fake_vram_result = {
        "type": "vram",
        "level": "warning",
        "message": "VRAM high: 6000MB / 8192MB (73.2%)",
        "current_value": 73.2,
        "threshold": 92.0,
        "unit": "percent",
        "details": {
            "used_mb": 6000,
            "total_mb": 8192,
            "gpu_utilization": 45,
            "temperature_c": 62,
        },
    }

    async def fake_to_thread(func, *args, **kwargs):
        return fake_vram_result

    with patch.object(asyncio, "to_thread", side_effect=fake_to_thread):
        result = await asyncio.wait_for(monitor.check_vram(), timeout=2.0)

    assert result is not None
    assert result["type"] == "vram"
    assert result["level"] == "warning"


@pytest.mark.asyncio
async def test_get_gpu_snapshot_uses_to_thread():
    """get_gpu_snapshot must offload blocking NVML calls to a thread."""
    monitor = ResourceMonitor()

    fake_snapshot = {
        "available": True,
        "name": "GeForce GTX 1070 Ti",
        "memory_used_mb": 6000,
        "memory_free_mb": 2192,
        "memory_total_mb": 8192,
        "memory_percent": 73.2,
        "gpu_utilization": 45,
        "memory_controller_utilization": 30,
        "temperature_c": 62,
        "processes": [],
        "memory_available": True,
    }

    async def fake_to_thread(func, *args, **kwargs):
        return fake_snapshot

    with patch.object(asyncio, "to_thread", side_effect=fake_to_thread):
        result = await asyncio.wait_for(monitor.get_gpu_snapshot(), timeout=2.0)

    assert result["available"] is True
    assert result["name"] == "GeForce GTX 1070 Ti"
    assert result["memory_percent"] == 73.2


@pytest.mark.asyncio
async def test_check_all_includes_vram_details():
    """check_all must include process breakdown in VRAM warning details."""
    monitor = ResourceMonitor()

    fake_vram_result = {
        "type": "vram",
        "level": "warning",
        "message": "VRAM high: 6000MB / 8192MB (73.2%)",
        "current_value": 73.2,
        "threshold": 92.0,
        "unit": "percent",
        "details": {
            "used_mb": 6000,
            "total_mb": 8192,
            "gpu_utilization": 45,
            "temperature_c": 62,
            "processes": [
                {"pid": 1234, "name": "python.exe", "used_mb": 2048},
                {"pid": 5678, "name": "ollama.exe", "used_mb": 1024},
            ],
        },
    }

    call_count = 0

    async def fake_to_thread(func, *args, **kwargs):
        nonlocal call_count
        call_count += 1
        # First call: check_vram via _check_vram_nvml_sync/_check_vram_gpustat_sync
        # Second call: _get_gpu_processes_sync
        # Third call: _enrich_process_names_sync
        if "get_gpu_processes" in str(func):
            return ([{"pid": 1234, "used_mb": 2048, "name": "python.exe", "kind": "compute"}], True)
        if "enrich_process_names" in str(func):
            return [{"pid": 1234, "used_mb": 2048, "name": "python.exe", "kind": "compute"}]
        return fake_vram_result

    with patch.object(asyncio, "to_thread", side_effect=fake_to_thread), \
         patch("psutil.virtual_memory", return_value=MagicMock(percent=50)), \
         patch("psutil.disk_usage", return_value=MagicMock(percent=50)):
        warnings = await monitor.check_all()

    vram_warnings = [w for w in warnings if w.get("type") == "vram"]
    assert len(vram_warnings) == 1
    assert "processes" in vram_warnings[0].get("details", {})
