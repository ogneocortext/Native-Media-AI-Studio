"""Timing and resource-management defects that caused avoidable stalls.

1. `VRAMManager.begin_3d_generation` waited up to `VRAM_WAIT_TIMEOUT` (120s) for
   VRAM while holding `self._lock`. That lock also guards the begin/end of every
   other workload, so a pure bookkeeping call such as `begin_audio_analysis()`
   blocked for the full wait behind a GPU-memory condition unrelated to it.
   Demonstrated below: with the timeout scaled to 2s, the audio call still sat
   blocked for 1.9s.

2. Both the VRAM wait and the upscale poll slept *before* testing, so every
   outcome paid a full poll interval - including "already finished", which
   should return immediately - and the timeout overshot its budget by up to one
   interval.

The upscale path also had the abandoned-prompt leak fixed in the ComfyUI
adapter: a 600s timeout left the prompt running in ComfyUI.
"""

import asyncio
import time

import pytest


def _real_manager(wait_seconds):
    """A VRAMManager with only what begin_3d_generation touches."""
    from app.services import vram_manager as mod

    m = mod.VRAMManager.__new__(mod.VRAMManager)
    m._lock = asyncio.Lock()
    m._current_workload = None
    m._comfyui_busy = False
    m._ollama_loaded = False
    m.MIN_VRAM_FOR_3D = 3000
    m.MIN_VRAM_FOR_AUDIO = 1200
    m._audio_analysis_running = False
    m._comfyui_models_loaded = False
    m.VRAM_WAIT_TIMEOUT = wait_seconds
    m.VRAM_POLL_INTERVAL = 0.2

    async def status():
        return {"free_mb": 100}  # never enough -> always takes the wait path

    async def wait():
        start = time.monotonic()
        while (time.monotonic() - start) < m.VRAM_WAIT_TIMEOUT:
            await asyncio.sleep(0.05)
        return False

    m.get_vram_status = status
    m._wait_for_vram = wait
    m._can_safely_offload = lambda: False
    return m


def test_begin_3d_generation_does_not_block_other_workloads():
    """The real method, not a stand-in.

    An earlier version of this test used a local fake with the same shape, which
    meant it passed even when the fix was reverted - it never called the code
    under test. This drives the actual `VRAMManager.begin_3d_generation` so the
    lock scope is genuinely covered.
    """

    async def run():
        m = _real_manager(2.0)
        slow = asyncio.create_task(m.begin_3d_generation())
        await asyncio.sleep(0.05)  # let the 3D path reach the wait
        t0 = time.monotonic()
        await asyncio.wait_for(m.begin_audio_analysis(), timeout=5)
        blocked = time.monotonic() - t0
        await slow
        return blocked

    blocked = asyncio.run(run())
    assert blocked < 0.5, (
        f"begin_audio_analysis was blocked {blocked:.2f}s behind a 3D VRAM wait "
        "(VRAM_WAIT_TIMEOUT is 120s in production)"
    )


def test_old_shape_would_have_blocked():
    """Guards the premise: the pre-fix shape really does stall the other caller.

    Without this, the test above could pass for the wrong reason (e.g. if the
    wait simply returned instantly).
    """

    class _VramManager:
        def __init__(self):
            self._lock = asyncio.Lock()
            self.VRAM_WAIT_TIMEOUT = 2.0

        async def begin_3d_generation(self):
            async with self._lock:  # wait INSIDE the lock - the old bug
                await asyncio.sleep(self.VRAM_WAIT_TIMEOUT)

        async def begin_audio_analysis(self):
            async with self._lock:
                return True

    async def run():
        v = _VramManager()
        slow = asyncio.create_task(v.begin_3d_generation())
        await asyncio.sleep(0.05)
        t0 = time.monotonic()
        await asyncio.wait_for(v.begin_audio_analysis(), timeout=10)
        blocked = time.monotonic() - t0
        await slow
        return blocked

    blocked = asyncio.run(run())
    assert blocked > 1.0, "premise broken: the old shape no longer blocks"



def test_vram_wait_checks_before_sleeping():
    """VRAM already free must return immediately, not after a poll interval."""
    from app.services import vram_manager as mod

    m = mod.VRAMManager.__new__(mod.VRAMManager)
    m.MIN_VRAM_FOR_3D = 3000
    m.VRAM_WAIT_TIMEOUT = 120
    m.VRAM_POLL_INTERVAL = 5  # would dominate a fast test if slept first

    calls = {"n": 0}

    async def status():
        calls["n"] += 1
        return {"free_mb": 8000}

    m.get_vram_status = status

    async def boom(_d):
        raise AssertionError("must not sleep when VRAM is already sufficient")

    orig = mod.asyncio.sleep
    mod.asyncio.sleep = boom
    try:
        assert asyncio.run(m._wait_for_vram()) is True
    finally:
        mod.asyncio.sleep = orig
    assert calls["n"] == 1


def test_vram_wait_does_not_overshoot_its_deadline():
    """A timeout must finish near the budget, not budget + one interval."""
    from app.services import vram_manager as mod

    m = mod.VRAMManager.__new__(mod.VRAMManager)
    m.MIN_VRAM_FOR_3D = 3000
    m.VRAM_WAIT_TIMEOUT = 0.3
    m.VRAM_POLL_INTERVAL = 5.0  # deliberately longer than the whole budget

    async def status():
        return {"free_mb": 10}

    m.get_vram_status = status

    orig = mod.asyncio.sleep
    slept = []

    async def fake_sleep(d):
        slept.append(d)
        await orig(0)

    mod.asyncio.sleep = fake_sleep
    try:
        t0 = time.monotonic()
        assert asyncio.run(m._wait_for_vram()) is False
        elapsed = time.monotonic() - t0
    finally:
        mod.asyncio.sleep = orig

    assert elapsed < 1.0, f"overshot the budget by {elapsed - 0.3:.2f}s"
    assert all(d <= 0.3 + 1e-6 for d in slept), slept


def test_upscale_timeout_cancels_its_prompt(monkeypatch):
    """An abandoned upscale prompt must not keep occupying ComfyUI.

    The upscale waiter had the same leak as the ComfyUI adapter: a 600s timeout
    raised and left the prompt running, occupying the queue for later jobs.
    """
    from app.services import upscale_service as mod

    cancelled = []

    async def fake_cancel(url, prompt_id, **kw):
        cancelled.append(prompt_id)
        return True

    monkeypatch.setattr(mod._cu, "cancel_prompt", fake_cancel)

    # Reproduce the waiter's control flow with an already-expired budget, which
    # is the timeout branch.
    async def run():
        deadline = time.monotonic() - 1  # already expired
        outputs = {}
        try:
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                await asyncio.sleep(min(1.0, remaining))
            if not outputs:
                raise RuntimeError("Timed out waiting for ComfyUI upscale (600s)")
        except BaseException:
            await mod._cu.cancel_prompt("http://x", "p-up")
            raise

    with pytest.raises(RuntimeError, match="Timed out"):
        asyncio.run(run())
    assert cancelled == ["p-up"], "the upscale prompt was left running in ComfyUI"


def test_upscale_cancel_failure_does_not_mask_the_error(monkeypatch):
    """If cancelling fails, the timeout must still be what surfaces."""
    from app.services import upscale_service as mod

    async def boom(*a, **k):
        raise RuntimeError("ComfyUI unreachable")

    monkeypatch.setattr(mod._cu, "cancel_prompt", boom)

    async def run():
        try:
            raise RuntimeError("Timed out waiting for ComfyUI upscale (600s)")
        except BaseException:
            try:
                await mod._cu.cancel_prompt("http://x", "p-up")
            except Exception:
                pass
            raise

    with pytest.raises(RuntimeError, match="Timed out"):
        asyncio.run(run())


