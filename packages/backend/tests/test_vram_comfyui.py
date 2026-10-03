"""ComfyUI VRAM offload for the audio-analysis path.

ComfyUI was the largest unmanaged VRAM consumer: `POST /free` returns ~5.3 GB on
this machine, against ~1.7 GB from offloading Ollama. The audio CUDA pass needs
only 1200 MB, so a card sitting at ~1.8 GB free would fall back to the CPU
(~92 s) purely because ComfyUI was idle-but-resident.

The behaviour that must never regress is the safety gate: freeing ComfyUI's
models while a prompt is running would strand the job and lose the user's work.
That is asserted here with no network and no ComfyUI server.
"""

import asyncio

import pytest
from app.services import vram_manager as vm


async def _true():
    return True


async def _true_list():
    return ["test-model"]


@pytest.fixture(autouse=True)
def _no_ollama_offload(monkeypatch):
    """Keep these tests off the network; Ollama offload is covered elsewhere."""
    monkeypatch.setattr(vm, "_unload_ollama_models", _true_list)


def _mgr():
    """A VRAMManager with only the state these tests care about."""
    m = vm.VRAMManager.__new__(vm.VRAMManager)
    m._current_workload = vm.GPUWorkload.IDLE
    m._ollama_loaded = True
    m._comfyui_busy = False
    m._comfyui_models_loaded = True
    m._music_gen_running = False
    m._audio_analysis_running = False
    m._lock = asyncio.Lock()
    m.MIN_VRAM_FOR_AUDIO = 1200
    m.MIN_VRAM_FOR_MUSIC = 6144
    m.MIN_VRAM_FOR_3D = 4000
    m.MIN_SYSTEM_RAM_FOR_OFFLOAD = 4096
    # Read by get_vram_status() -> get_status(); stubbed so these tests never
    # touch real GPU probing.
    m._nvml_available = False
    m._gpustat_available = False
    m.thresholds = {
        "vram_warning": 85.0,
        "vram_critical": 92.0,
        "vram_available": 50.0,
    }
    return m


class TestQueueGate:
    """`_comfyui_queue_depth_sync` / `_comfyui_is_idle` gate the offload."""

    def test_idle_when_nothing_running_or_queued(self, monkeypatch):
        monkeypatch.setattr(vm, "_comfyui_queue_depth_sync", lambda: (0, 0))
        assert vm._comfyui_is_idle_sync() is True

    def test_not_idle_while_a_prompt_is_running(self, monkeypatch):
        monkeypatch.setattr(vm, "_comfyui_queue_depth_sync", lambda: (1, 0))
        assert vm._comfyui_is_idle_sync() is False

    def test_not_idle_with_queued_work(self, monkeypatch):
        # Nothing executing yet, but a render is coming: freeing now would make
        # that queued job start with no models resident.
        monkeypatch.setattr(vm, "_comfyui_queue_depth_sync", lambda: (0, 3))
        assert vm._comfyui_is_idle_sync() is False


class TestUnload:
    """The busy path must refuse to send `/free` at all."""

    def test_refuses_when_a_prompt_is_running(self, monkeypatch):
        monkeypatch.setattr(vm, "_comfyui_queue_depth_sync", lambda: (1, 0))
        result = vm._unload_comfyui_models_sync()
        assert result["success"] is False
        assert result["skipped"] == "busy"
        assert result["running"] == 1

    def test_unreachable_comfyui_is_reported_not_crashed(self, monkeypatch):
        import urllib.request

        def boom(*a, **k):
            raise OSError("connection refused")

        monkeypatch.setattr(urllib.request, "urlopen", boom)
        result = vm._unload_comfyui_models_sync()
        assert result["success"] is False
        assert result["skipped"] == "error"
async def _false():
    return False


class TestBeginAudioAnalysisOrdering:
    """Ollama is tried first, ComfyUI only if that was not enough."""

    def test_comfyui_left_alone_when_budget_already_met(self, monkeypatch):
        m = _mgr()

        async def status():
            return {"free_mb": 4000, "total_mb": 8192, "available": True}

        monkeypatch.setattr(m, "get_vram_status", status)
        frees = []

        async def spy():
            frees.append(True)
            return {"success": True}

        monkeypatch.setattr(vm, "_unload_comfyui_models", spy)

        out = asyncio.run(m.begin_audio_analysis())

        assert out["meets_budget"] is True
        assert frees == [], "freed ComfyUI when VRAM was already sufficient"
        assert m._comfyui_models_loaded is True

    def test_comfyui_freed_when_still_short_and_idle(self, monkeypatch):
        m = _mgr()
        frees = []

        async def status():
            # Short before and after the Ollama tier, so the ComfyUI tier runs.
            return {"free_mb": 900, "total_mb": 8192, "available": True}

        monkeypatch.setattr(m, "get_vram_status", status)
        monkeypatch.setattr(m, "_can_safely_offload", lambda: False)
        monkeypatch.setattr(vm, "_comfyui_is_idle", _true)

        async def fake_unload():
            frees.append(True)
            return {"success": True, "skipped": None}

        monkeypatch.setattr(vm, "_unload_comfyui_models", fake_unload)

        out = asyncio.run(m.begin_audio_analysis())

        assert frees == [True], "ComfyUI offload should run exactly once"
        assert m._comfyui_models_loaded is False
        assert any(a.get("action") == "offload_comfyui" for a in out["actions"])

    def test_comfyui_untouched_when_busy(self, monkeypatch):
        m = _mgr()
        m._comfyui_busy = True

        async def status():
            return {"free_mb": 900, "total_mb": 8192, "available": True}

        monkeypatch.setattr(m, "get_vram_status", status)
        monkeypatch.setattr(m, "_can_safely_offload", lambda: False)
        frees = []

        async def spy():
            frees.append(True)
            return {"success": True}

        monkeypatch.setattr(vm, "_unload_comfyui_models", spy)

        out = asyncio.run(m.begin_audio_analysis())

        assert frees == [], "freed ComfyUI while a render was running"
        assert m._comfyui_models_loaded is True
        assert out["meets_budget"] is False

    def test_comfyui_untouched_when_queue_is_non_empty(self, monkeypatch):
        """The other busy signal: a queued render, with no local flag set."""
        m = _mgr()

        async def status():
            return {"free_mb": 900, "total_mb": 8192, "available": True}

        monkeypatch.setattr(m, "get_vram_status", status)
        monkeypatch.setattr(m, "_can_safely_offload", lambda: False)
        monkeypatch.setattr(vm, "_comfyui_is_idle", _false)
        frees = []

        async def spy():
            frees.append(True)
            return {"success": True}

        monkeypatch.setattr(vm, "_unload_comfyui_models", spy)

        asyncio.run(m.begin_audio_analysis())

        assert frees == [], "freed ComfyUI with a prompt queued"
        assert m._comfyui_models_loaded is True

    def test_end_restores_the_flag_for_the_next_workload(self, monkeypatch):
        m = _mgr()
        m._comfyui_models_loaded = False

        async def status():
            return {"free_mb": 6000, "total_mb": 8192, "available": True}

        monkeypatch.setattr(m, "get_vram_status", status)
        monkeypatch.setattr(vm, "_reload_ollama_models", lambda name: _true())

        asyncio.run(m.end_audio_analysis())

        # ComfyUI lazy-loads on the next prompt, so the flag must read loaded
        # again or a later offload would be skipped as unnecessary.
        assert m._comfyui_models_loaded is True

    def test_status_exposes_comfyui_model_state(self):
        assert "comfyui_models_loaded" in _mgr().get_status()
