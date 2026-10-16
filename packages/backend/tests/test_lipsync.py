"""Tests for the local lip-sync integration (D42).

Covers the fail-open contract (missing weights / unconfigured command never
crash — they name the missing step), the VRAM declaration (D7), the job-type
wiring (D8), and route registration. The actual MuseTalk model call is a
Windows-GPU gate and is not exercised here.
"""

import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))


def _config(tmp_path, **overrides):
    """A MuseTalkConfig pointed at a temp weights dir."""
    from app.services.lipsync.musetalk_adapter import MuseTalkConfig

    kwargs = {"weights_dir": tmp_path / "musetalk"}
    kwargs.update(overrides)
    return MuseTalkConfig(**kwargs)


def test_check_installation_fail_open_missing_weights(tmp_path):
    from app.services.lipsync.musetalk_adapter import MuseTalkAdapter

    adapter = MuseTalkAdapter(_config(tmp_path))
    status = adapter.check_installation()
    assert status["installed"] is False
    assert status["weights_found"] is False
    assert any("weights" in m for m in status["missing"])


def test_check_installation_fail_open_missing_command(tmp_path):
    from app.services.lipsync.musetalk_adapter import MuseTalkAdapter

    weights = tmp_path / "musetalk"
    weights.mkdir()
    (weights / "dummy.pt").write_bytes(b"x")
    adapter = MuseTalkAdapter(_config(tmp_path))
    status = adapter.check_installation()
    # Command template is empty by default -> not installed, names the step
    assert status["installed"] is False
    assert status["command_configured"] is False
    assert any("inference.command" in m for m in status["missing"])


def test_lipsync_raises_not_configured(tmp_path):
    from app.services.lipsync.musetalk_adapter import (
        LipSyncNotConfiguredError,
        MuseTalkAdapter,
    )

    adapter = MuseTalkAdapter(_config(tmp_path))
    with pytest.raises(LipSyncNotConfiguredError, match="[Ww]eights|command|not ready"):
        asyncio.run(adapter.lipsync("v.mp4", "a.wav", "o.mp4"))


def test_lipsync_rejects_missing_inputs(tmp_path, monkeypatch):
    from app.services.lipsync.musetalk_adapter import MuseTalkAdapter

    adapter = MuseTalkAdapter(_config(tmp_path))
    # Pretend the install is ready so input validation is what gets tested
    monkeypatch.setattr(
        adapter, "check_installation", lambda: {"installed": True, "message": "ready"}
    )
    with pytest.raises(FileNotFoundError, match="Video not found"):
        asyncio.run(adapter.lipsync("nope.mp4", "a.wav", "o.mp4"))


def test_vram_budget_declared():
    from app.services.lipsync.musetalk_adapter import MuseTalkAdapter
    from app.services.vram_manager import GPUWorkload, VRAMManager

    assert MuseTalkAdapter.VRAM_BUDGET_MB == 4096
    assert GPUWorkload.LIPSYNC.value == "lipsync"

    m = VRAMManager.__new__(VRAMManager)
    m._init_thresholds()
    assert m.MIN_VRAM_FOR_LIPSYNC == 4096
    assert hasattr(m, "begin_lipsync_generation")
    assert hasattr(m, "end_lipsync_generation")


def test_vram_begin_end_lipsync_cycle():
    """begin sets the LIPSYNC workload, end restores IDLE (mocked GPU)."""
    from app.services.vram_manager import GPUWorkload, VRAMManager

    async def go():
        m = VRAMManager.__new__(VRAMManager)
        m._lock = asyncio.Lock()
        m._current_workload = GPUWorkload.IDLE
        m._ollama_loaded = True
        m._lipsync_running = False
        m.MIN_VRAM_FOR_LIPSYNC = 4096

        async def status():
            return {"free_mb": 6000}

        m.get_vram_status = status
        begun = await m.begin_lipsync_generation(vram_budget_mb=4096)
        assert begun["success"] is True
        assert m._current_workload == GPUWorkload.LIPSYNC
        assert m._lipsync_running is True

        # end() with Ollama still loaded takes the no-reload path
        async def status2():
            return {"free_mb": 6000}

        m.get_vram_status = status2
        ended = await m.end_lipsync_generation()
        assert ended["success"] is True
        assert m._current_workload == GPUWorkload.IDLE
        assert m._lipsync_running is False

    asyncio.run(go())


def test_jobtype_lipsync_exists():
    from app.models.job import JobType

    assert JobType.LIPSYNC.value == "lipsync"


def test_processor_registers_lipsync_handler():
    from app.models.job import JobType
    from app.queue.processor import JobProcessor

    processor = JobProcessor()
    assert JobType.LIPSYNC in processor._handlers


def test_video_router_has_lipsync_route():
    from app.api.video import router

    paths = [r.path for r in router.routes]
    assert "/api/video/lipsync" in paths
