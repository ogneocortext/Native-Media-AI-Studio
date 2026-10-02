"""Tests for the audio-analysis VRAM handover.

Audio analysis runs a CUDA spectral pass worth ~300x the CPU path on a
GTX 1070 Ti (0.3s against ~92s). Ollama holds ~1.5 GB of the same 8 GB card,
enough to push that pass over and make it fail silently. These cover the
handover: free VRAM before, restore after, and restore even when the analysis
raises.

The manager is built with __new__ rather than __init__ so the tests do not
probe real GPU state or talk to a real Ollama.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..")))


def _manager(free_mb, ollama_loaded=True, can_offload=True):
    """A VRAMManager with only the attributes these tests touch."""
    import app.services.vram_manager as vm

    m = vm.VRAMManager.__new__(vm.VRAMManager)
    m._lock = asyncio.Lock()
    m._ollama_loaded = ollama_loaded
    m._audio_analysis_running = False
    m._current_workload = None
    m.MIN_VRAM_FOR_AUDIO = 1200
    m.MIN_VRAM_FOR_MUSIC = 6144
    m._can_safely_offload = lambda: can_offload

    free = {"value": free_mb}

    async def status():
        return {"free_mb": free["value"]}

    m.get_vram_status = status
    return m, free


def test_audio_workload_exists():
    from app.services.vram_manager import GPUWorkload

    assert GPUWorkload.AUDIO_ANALYSIS.value == "audio_analysis"


def test_begin_offloads_ollama_when_vram_short():
    """The whole point: low VRAM must free Ollama before the CUDA pass."""
    import app.services.vram_manager as vm

    m, free = _manager(500)
    unloaded = []

    async def fake_unload():
        unloaded.append("model")
        free["value"] = 5000          # offloading frees VRAM
        return ["gemma4:e2b"]

    vm._unload_ollama_models = fake_unload

    result = asyncio.run(m.begin_audio_analysis())

    assert result["success"] is True
    assert result["offloaded"] is True
    assert unloaded == ["model"], "Ollama was not offloaded"
    assert m._ollama_loaded is False
    assert m._audio_analysis_running is True


def test_begin_skips_offload_when_vram_sufficient():
    """No churn when there is already room."""
    m, _ = _manager(6000)
    result = asyncio.run(m.begin_audio_analysis())

    assert result["offloaded"] is False
    assert result["actions"] == []
    assert m._ollama_loaded is True


def test_begin_proceeds_when_offload_unsafe():
    """Low system RAM must not block the request; CPU analysis still works."""
    m, _ = _manager(400, can_offload=False)
    result = asyncio.run(m.begin_audio_analysis())

    assert result["success"] is True, "must never fail the request"
    assert result["offloaded"] is False
    assert result["meets_budget"] is False
    assert m._ollama_loaded is True


def test_end_reloads_only_when_room():
    import app.services.vram_manager as vm

    m, _ = _manager(7000, ollama_loaded=False)
    m._audio_analysis_running = True
    reloaded = []

    async def fake_reload(model):
        reloaded.append(model)
        return True

    vm._reload_ollama_models = fake_reload

    result = asyncio.run(m.end_audio_analysis())

    assert len(reloaded) == 1, "Ollama was not reloaded"
    assert m._ollama_loaded is True
    assert m._audio_analysis_running is False
    assert result["actions"][0]["action"] == "reload_ollama"


def test_end_leaves_offloaded_when_no_room():
    """No thrash: if there is still no room, stay offloaded."""
    m, _ = _manager(900, ollama_loaded=False)
    m._audio_analysis_running = True

    result = asyncio.run(m.end_audio_analysis())

    assert result["actions"] == []
    assert m._ollama_loaded is False
