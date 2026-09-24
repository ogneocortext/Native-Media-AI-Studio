"""Regression tests for the VRAM manager's Ollama offload/reload cycle.

Guards a previously-shipped bug: ``end_3d_generation`` referenced ``_cfg2``
after the config import was removed during a refactor, so reloading Ollama
after a 3D render raised ``NameError`` instead of reloading the model.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services import vram_manager as vram_module  # noqa: E402


@pytest.mark.asyncio
async def test_end_3d_generation_reloads_ollama_without_name_error(monkeypatch):
    manager = vram_module.vram_manager
    reloaded: list[str] = []

    async def fake_vram_status() -> dict:
        # Above MIN_VRAM_FOR_3D (4000MB) so the reload branch is taken.
        return {"available": True, "free_mb": 6000, "total_mb": 8192}

    async def fake_reload(model_name: str) -> bool:
        reloaded.append(model_name)
        return True

    monkeypatch.setattr(manager, "get_vram_status", fake_vram_status)
    monkeypatch.setattr(vram_module, "_reload_ollama_models", fake_reload)
    monkeypatch.setattr(manager, "_ollama_loaded", False)

    result = await manager.end_3d_generation()

    assert result["success"] is True
    actions = [a["action"] for a in result["actions"]]
    assert "reload_ollama" in actions
    assert len(reloaded) == 1
    assert result["ollama_loaded"] is True


def test_reload_sync_skips_non_default_llama_models():
    """Non-default llama models must be skipped before any network call."""
    assert vram_module._reload_ollama_models_sync("llama3-legacy") is False


# ---------------------------------------------------------------------------
# preflight_check — advisory path used by ensure_vram_available()
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_preflight_check_reports_free_vram_without_mutating_state(monkeypatch):
    manager = vram_module.vram_manager

    async def fake_vram_status() -> dict:
        return {"available": True, "free_mb": 8000, "total_mb": 8192}

    monkeypatch.setattr(manager, "get_vram_status", fake_vram_status)
    monkeypatch.setattr(manager, "_comfyui_busy", False)
    monkeypatch.setattr(manager, "_current_workload", vram_module.GPUWorkload.IDLE)

    result = await manager.preflight_check(required_mb=4096)

    assert result["available"] is True
    assert result["offloaded"] is False
    assert result["free_mb"] == 8000
    # The whole point: preflight must not impersonate a 3D render.
    assert manager._comfyui_busy is False
    assert manager._current_workload is vram_module.GPUWorkload.IDLE


@pytest.mark.asyncio
async def test_preflight_check_offloads_ollama_when_vram_is_low(monkeypatch):
    """Offloading returns a list[str]; the old code called .get() on it and threw."""
    manager = vram_module.vram_manager
    readings = {"count": 0}

    async def fake_vram_status() -> dict:
        readings["count"] += 1
        free = 1000 if readings["count"] == 1 else 9000
        return {"available": True, "free_mb": free, "total_mb": 8192}

    async def fake_unload() -> list[str]:
        return ["gemma4:e2b-it-qat"]

    monkeypatch.setattr(manager, "get_vram_status", fake_vram_status)
    monkeypatch.setattr(vram_module, "_unload_ollama_models", fake_unload)
    monkeypatch.setattr(manager, "_ollama_loaded", True)

    result = await manager.preflight_check(required_mb=4096)

    assert result["offloaded"] is True
    assert result["available"] is True
    assert result["free_mb"] == 9000
    assert manager._ollama_loaded is False


@pytest.mark.asyncio
async def test_preflight_check_reports_unavailable_when_offload_is_not_enough(monkeypatch):
    manager = vram_module.vram_manager

    async def fake_vram_status() -> dict:
        return {"available": True, "free_mb": 512, "total_mb": 8192}

    async def fake_unload() -> list[str]:
        return ["gemma4:e2b-it-qat"]

    monkeypatch.setattr(manager, "get_vram_status", fake_vram_status)
    monkeypatch.setattr(vram_module, "_unload_ollama_models", fake_unload)
    monkeypatch.setattr(manager, "_ollama_loaded", True)

    result = await manager.preflight_check(required_mb=4096)

    assert result["available"] is False
    assert "Insufficient VRAM" in result["message"]


@pytest.mark.asyncio
async def test_ensure_vram_available_uses_read_only_preflight(monkeypatch):
    """The music-video preflight must not flip the VRAM manager into RENDER_3D."""
    from app.api.integrations_config import ensure_vram_available

    manager = vram_module.vram_manager
    monkeypatch.setattr(manager, "_comfyui_busy", False)
    monkeypatch.setattr(manager, "_current_workload", vram_module.GPUWorkload.IDLE)

    async def fake_preflight(required_mb: int) -> dict:
        return {"available": True, "free_mb": 6000, "total_mb": 8192, "required_mb": required_mb,
                "offloaded": False, "message": "VRAM OK"}

    monkeypatch.setattr(manager, "preflight_check", fake_preflight)

    result = await ensure_vram_available(required_mb=2048)

    assert result["required_mb"] == 2048
    assert manager._comfyui_busy is False
    assert manager._current_workload is vram_module.GPUWorkload.IDLE


# ---------------------------------------------------------------------------
# VRAM baseline / leak tests — full job-cycle regression guard
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_3d_generation_cycle_returns_vram_to_baseline(monkeypatch):
    """After begin_3d_generation -> end_3d_generation, VRAM must return to
    within 512MB of the pre-job baseline. This guards against model-reload
    leaks where Ollama stays resident on GPU after a 3D render."""
    manager = vram_module.vram_manager
    baseline_mb = 7000
    readings = {
        "before": baseline_mb,
        "during": 3500,
        "after": baseline_mb,
    }
    read_count = {"n": 0}

    async def fake_vram_status() -> dict:
        read_count["n"] += 1
        if read_count["n"] == 1:
            mb = readings["before"]
        elif read_count["n"] == 2:
            mb = readings["during"]
        else:
            mb = readings["after"]
        return {"available": True, "free_mb": mb, "total_mb": 8192}

    monkeypatch.setattr(manager, "get_vram_status", fake_vram_status)
    monkeypatch.setattr(manager, "_ollama_loaded", True)
    monkeypatch.setattr(vram_module, "_unload_ollama_models", lambda: [])
    monkeypatch.setattr(vram_module, "_reload_ollama_models", lambda model: True)

    before = await manager.get_vram_status()
    assert before["free_mb"] == baseline_mb

    begin = await manager.begin_3d_generation()
    assert begin["success"] is True
    assert manager._current_workload is vram_module.GPUWorkload.RENDER_3D
    assert manager._comfyui_busy is True

    end = await manager.end_3d_generation()
    assert end["success"] is True

    after = await manager.get_vram_status()
    assert after["free_mb"] == readings["after"]
    drift_mb = abs(after["free_mb"] - before["free_mb"])
    assert drift_mb <= 512, (
        f"VRAM did not return to baseline: before={before['free_mb']}MB, "
        f"after={after['free_mb']}MB, drift={drift_mb}MB"
    )
    assert manager._current_workload is vram_module.GPUWorkload.IDLE
    assert manager._comfyui_busy is False
    assert manager._ollama_loaded is True


@pytest.mark.asyncio
async def test_music_generation_cycle_returns_vram_to_baseline(monkeypatch):
    """After begin_music_generation -> end_music_generation, VRAM must return
    to within 512MB of the pre-job baseline."""
    manager = vram_module.vram_manager
    baseline_mb = 6500
    readings = {
        "before": baseline_mb,
        "during": 1800,
        "after": baseline_mb,
    }
    read_count = {"n": 0}

    async def fake_vram_status() -> dict:
        read_count["n"] += 1
        if read_count["n"] == 1:
            mb = readings["before"]
        elif read_count["n"] == 2:
            mb = readings["during"]
        else:
            mb = readings["after"]
        return {"available": True, "free_mb": mb, "total_mb": 8192}

    monkeypatch.setattr(manager, "get_vram_status", fake_vram_status)
    monkeypatch.setattr(manager, "_ollama_loaded", True)
    async def fake_unload() -> list[str]:
        return []
    monkeypatch.setattr(vram_module, "_unload_ollama_models", fake_unload)
    async def fake_reload(model: str) -> bool:
        return True
    monkeypatch.setattr(vram_module, "_reload_ollama_models", fake_reload)

    before = await manager.get_vram_status()
    assert before["free_mb"] == baseline_mb

    begin = await manager.begin_music_generation(engine="ace", vram_budget_mb=6144)
    assert begin["success"] is True
    assert manager._current_workload is vram_module.GPUWorkload.MUSIC_GENERATION
    assert manager._music_gen_running is True

    end = await manager.end_music_generation()
    assert end["success"] is True

    after = await manager.get_vram_status()
    assert after["free_mb"] == readings["after"]
    drift_mb = abs(after["free_mb"] - before["free_mb"])
    assert drift_mb <= 512, (
        f"VRAM did not return to baseline after music generation: "
        f"before={before['free_mb']}MB, after={after['free_mb']}MB, drift={drift_mb}MB"
    )
    assert manager._current_workload is vram_module.GPUWorkload.IDLE
    assert manager._music_gen_running is False
    assert manager._ollama_loaded is True


@pytest.mark.asyncio
async def test_vram_manager_detects_leak_when_reload_fails(monkeypatch):
    """If Ollama reload fails after a job, the manager should expose the
    degraded state instead of silently claiming success."""
    manager = vram_module.vram_manager
    baseline_mb = 7000

    async def fake_vram_status() -> dict:
        return {"available": True, "free_mb": baseline_mb, "total_mb": 8192}

    monkeypatch.setattr(manager, "get_vram_status", fake_vram_status)
    monkeypatch.setattr(manager, "_ollama_loaded", False)
    async def fake_reload_fail(model: str) -> bool:
        return False
    monkeypatch.setattr(vram_module, "_reload_ollama_models", fake_reload_fail)

    result = await manager.end_3d_generation()

    assert result["success"] is True
    assert result["ollama_loaded"] is False
    actions = [a["action"] for a in result["actions"]]
    assert "reload_ollama" in actions
    reload_action = next(a for a in result["actions"] if a["action"] == "reload_ollama")
    assert reload_action["success"] is False

