"""Torch-fallback GPU snapshot must report unknown sensors as null, not 0.

When NVML is unavailable, ``ResourceMonitor._torch_gpu_snapshot`` still returns
real torch memory figures but has no source for utilization, memory-controller
utilization, or temperature. Those fields must be ``None`` so the UI can show
"sensor unavailable" instead of a fabricated idle-GPU reading.
"""

from types import SimpleNamespace

import pytest
import torch

from app.diagnostics.resources import ResourceMonitor


@pytest.mark.asyncio
async def test_torch_fallback_reports_unknown_sensors_as_null(monkeypatch):
    monkeypatch.setattr(torch.cuda, "is_available", lambda: True)
    monkeypatch.setattr(
        torch.cuda,
        "get_device_properties",
        lambda idx: SimpleNamespace(name="TestGPU"),
    )
    gib = 1024**3
    monkeypatch.setattr(torch.cuda, "mem_get_info", lambda idx: (4 * gib, 8 * gib))

    snap = await ResourceMonitor._torch_gpu_snapshot()

    assert snap is not None
    assert snap["available"] is True
    assert snap["name"] == "TestGPU"
    assert snap["fallback"] == "torch.cuda"
    # Real torch measurements survive.
    assert snap["memory_total_mb"] == 8192
    assert snap["memory_free_mb"] == 4096
    assert snap["memory_used_mb"] == 4096
    # Unknown sensors are null, never a fabricated 0.
    assert snap["gpu_utilization"] is None
    assert snap["memory_controller_utilization"] is None
    assert snap["temperature_c"] is None


@pytest.mark.asyncio
async def test_torch_fallback_returns_none_without_cuda(monkeypatch):
    monkeypatch.setattr(torch.cuda, "is_available", lambda: False)
    assert await ResourceMonitor._torch_gpu_snapshot() is None
