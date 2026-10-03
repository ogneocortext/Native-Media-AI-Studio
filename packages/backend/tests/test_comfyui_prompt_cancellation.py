"""Abandoned ComfyUI prompts must be cancelled, not left running.

This was the root cause of ComfyUI appearing unreliable. Both waiters raised on
timeout while the prompt kept executing inside ComfyUI, so every timeout
permanently lengthened the FIFO queue for later jobs - including the retry of
the job that had just timed out. Measured on this machine: ComfyUI completes
images in ~11s median (max 163s over 93 prompts) while the client waited 300s
and then walked away, leaving 24 orphaned prompts queued.

The image waiter also extends its deadline when the prompt is merely *queued*,
because spending the budget waiting behind someone else's multi-minute video
job is not the same as the job being slow.
"""

import asyncio

import pytest
from app.adapters.comfyui import _QUEUE_BACKLOG_TIMEOUT, ComfyUIAdapter


def _adapter():
    a = ComfyUIAdapter.__new__(ComfyUIAdapter)
    a.base_url = "http://127.0.0.1:8188"
    return a


class _Recorder:
    """Stands in for the comfyui_client cancel helper."""

    def __init__(self):
        self.cancelled = []

    async def cancel_prompt(self, base_url, prompt_id, **kw):
        self.cancelled.append(prompt_id)
        return True


@pytest.fixture
def rec(monkeypatch):
    from app.adapters import comfyui as mod
    r = _Recorder()
    monkeypatch.setattr(mod._cu, "cancel_prompt", r.cancel_prompt)
    return r


def test_image_timeout_cancels_the_prompt(rec):
    """The core fix: a timed-out prompt must not keep occupying the queue."""

    async def run():
        a = _adapter()

        async def no_history(_pid):
            return {}

        # Not in the queue: this prompt was executing, so the normal deadline
        # applies and it must time out promptly. (A prompt still sitting in the
        # queue gets its deadline extended - see the backlog tests.)
        async def not_queued(_pid):
            return None

        a._get_history = no_history
        a._get_queue_status = not_queued
        await a._wait_for_result("p-abc", timeout=0)

    with pytest.raises(TimeoutError):
        asyncio.run(run())
    assert rec.cancelled == ["p-abc"], "abandoned prompt was left running in ComfyUI"


def test_image_execution_error_cancels_the_prompt(rec):
    async def run():
        a = _adapter()

        async def errored(_pid):
            return {"p-err": {"status_str": "error", "error": "CUDA OOM"}}

        a._get_history = errored
        await a._wait_for_result("p-err", timeout=30)

    with pytest.raises(RuntimeError):
        asyncio.run(run())
    assert rec.cancelled == ["p-err"]


def test_image_success_does_not_cancel(rec):
    """A prompt that produced its image must be left alone."""
    import base64

    async def run():
        a = _adapter()
        png = b"\x89PNG\r\n\x1a\n" + b"0" * 64

        async def done(_pid):
            return {
                "p-ok": {"outputs": {"9": {"images": [
                    {"filename": "a.png", "subfolder": ""}]}}}
            }

        a._get_history = done
        a._fetch_image = lambda f, s="": asyncio.sleep(
            0, result=base64.b64encode(png).decode()
        )
        return await a._wait_for_result("p-ok", timeout=30)

    result = asyncio.run(run())
    assert result  # base64 payload
    assert rec.cancelled == [], "a successful prompt must not be cancelled"


def test_queued_prompt_extends_the_deadline(rec, monkeypatch):
    """Waiting behind another job is not the same as being slow.

    With a short timeout and a prompt still sitting in the queue, the waiter must
    extend rather than time out - otherwise it cancels a job that never ran.
    """
    from app.adapters import comfyui as mod

    async def run():
        a = _adapter()

        async def never(_pid):
            return {}

        async def still_queued(_pid):
            return {"queued": True}

        async def fake_sleep(_d):
            # Advance a fake clock rather than really waiting.
            state["t"] += 50.0

        state = {"t": 0.0}
        a._get_history = never
        a._get_queue_status = still_queued

        loop = asyncio.get_event_loop()
        real_time, real_sleep = loop.time, mod.asyncio.sleep
        loop.time = lambda: state["t"]
        mod.asyncio.sleep = fake_sleep
        try:
            with pytest.raises(TimeoutError):
                await a._wait_for_result("p-q", timeout=100)
        finally:
            mod.asyncio.sleep = real_sleep
            loop.time = real_time
        return state["t"]

    elapsed = asyncio.run(run())
    # It should have survived well past the 100s original timeout.
    assert elapsed > 100, "deadline was not extended while queued"
    assert rec.cancelled == ["p-q"]


def test_prompt_not_yet_started_does_not_extend_forever(rec, monkeypatch):
    """A prompt that has left the queue is not waiting on a backlog."""
    from app.adapters import comfyui as mod

    async def run():
        a = _adapter()

        async def never(_pid):
            return {}

        async def not_queued(_pid):
            return None

        async def fake_sleep(_d):
            state["t"] += 50.0

        state = {"t": 0.0}
        a._get_history = never
        a._get_queue_status = not_queued

        loop = asyncio.get_event_loop()
        real_time, real_sleep = loop.time, mod.asyncio.sleep
        loop.time = lambda: state["t"]
        mod.asyncio.sleep = fake_sleep
        try:
            with pytest.raises(TimeoutError):
                await a._wait_for_result("p-n", timeout=100)
        finally:
            mod.asyncio.sleep = real_sleep
            loop.time = real_time
        return state["t"]

    elapsed = asyncio.run(run())
    assert elapsed <= 150, "deadline was extended for a prompt that was not queued"


def test_video_timeout_cancels_the_prompt(rec):
    async def run():
        a = _adapter()

        async def no_history(_pid):
            return {}

        # Not queued, so the video waiter's own 60s "prompt vanished" check does
        # not fire first; we are testing the timeout path specifically.
        async def not_queued(_pid):
            return {"prompt_id": "v-1"}

        a._get_history = no_history
        a._get_queue_status = not_queued
        await a._wait_for_video_result("v-1", timeout=0)

    with pytest.raises(TimeoutError):
        asyncio.run(run())
    assert rec.cancelled == ["v-1"]


def test_cancel_failure_does_not_mask_the_original_error(rec, monkeypatch):
    """If cancelling itself fails, the real error must still surface."""
    from app.adapters import comfyui as mod

    async def boom(*a, **k):
        raise RuntimeError("ComfyUI unreachable")

    monkeypatch.setattr(mod._cu, "cancel_prompt", boom)

    async def run():
        a = _adapter()

        async def no_history(_pid):
            return {}

        async def not_queued(_pid):
            return None

        a._get_history = no_history
        a._get_queue_status = not_queued
        await a._wait_for_result("p-x", timeout=0)

    # The cleanup raised; the TimeoutError that actually explains the failure
    # must still be what propagates.
    with pytest.raises(TimeoutError):
        asyncio.run(run())


def test_backlog_timeout_exceeds_the_default_image_timeout():
    """The extension must actually be an extension."""
    assert _QUEUE_BACKLOG_TIMEOUT > 300


class TestCancelPromptWireContract:
    """Regression: the first implementation looked the prompt up with
    ``DELETE /queue``, which this ComfyUI build answers with 405 Method Not
    Allowed. Treating that as fatal made cancellation a silent no-op - verified
    live, the prompt stayed queued and the queue kept growing. These pin the
    wire contract so it cannot regress to a call that appears to work.
    """

    def _session(self, monkeypatch, get_status=200, post_status=200, body=None):
        from app.core import comfyui_client as cc

        calls = {"delete": 0, "get": 0, "post": 0}
        queued = body if body is not None else {
            "queue_running": [],
            "queue_pending": [[7, "p-1", {}, {}, []]],
        }

        class _Ctx:
            def __init__(self, status, payload):
                self.status = status
                self._payload = payload

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def json(self):
                return self._payload

        class _Sess:
            def delete(self, *a, **k):
                calls["delete"] += 1
                return _Ctx(405, {})

            def get(self, *a, **k):
                calls["get"] += 1
                return _Ctx(get_status, queued)

            def post(self, *a, **k):
                calls["post"] += 1
                return _Ctx(post_status, {})

        monkeypatch.setattr(cc, "get_shared_session", lambda: _asyncio_sleep(_Sess()))
        return calls

    def _run_cancel(self, monkeypatch, prompt_id="p-1", **kw):
        import asyncio

        from app.core import comfyui_client as cc

        calls = self._session(monkeypatch, **kw)

        async def go():
            return await cc.cancel_prompt("http://x", prompt_id)

        return asyncio.run(go()), calls

    def test_does_not_use_delete_which_comfyui_rejects(self, monkeypatch):
        ok, calls = self._run_cancel(monkeypatch)
        assert calls["delete"] == 0, "DELETE /queue returns 405 on this build"
        assert calls["get"] == 1

    def test_posts_the_delete_and_reports_success(self, monkeypatch):
        ok, calls = self._run_cancel(monkeypatch)
        assert ok is True
        assert calls["post"] == 1

    def test_returns_false_when_the_prompt_is_absent(self, monkeypatch):
        ok, calls = self._run_cancel(monkeypatch, body={"queue_running": [], "queue_pending": []})
        assert ok is False
        assert calls["post"] == 0, "must not delete an id ComfyUI does not know"

    def test_survives_an_unreachable_queue_endpoint(self, monkeypatch):
        """A dead ComfyUI must not raise out of cleanup."""
        ok, _ = self._run_cancel(monkeypatch, get_status=503)
        assert ok is False


async def _asyncio_sleep(x):
    return x
