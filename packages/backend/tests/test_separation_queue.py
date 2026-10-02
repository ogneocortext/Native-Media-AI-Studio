"""All GPU separation must serialise through the single queue worker.

Finding: `separate(mode="hierarchical")` used to call `_separate_hierarchical`
directly, bypassing `enqueue()`. Two concurrent hierarchical separations would
hold two Demucs models on an 8 GB card - the CUDA OOM the queue exists to
prevent, and reachable because StemMixer exposes a separation-mode selector.

These assert the routing, not the DSP: the backends are replaced with recording
stubs so no Demucs/model download is involved.
"""

import asyncio

import pytest
from app.services.source_separation import SeparationOptions, SourceSeparator


class _Recorder:
    """Records concurrent entries so we can detect overlap."""

    def __init__(self) -> None:
        self.active = 0
        self.max_active = 0
        self.modes: list[str] = []

    async def backend(self, _path, _opts, mode):
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        self.modes.append(mode)
        try:
            await asyncio.sleep(0.02)
        finally:
            self.active -= 1


@pytest.mark.asyncio
async def test_single_and_hierarchical_both_go_through_the_queue(monkeypatch):
    """Both modes must serialise: max concurrent backend calls == 1."""
    sep = SourceSeparator(model="mdx_extra_q")
    rec = _Recorder()

    async def fake_demucs(path, model, device, out_dir, cmd, opts):
        return await rec.backend(path, opts, "single")

    async def fake_hier(path, opts):
        return await rec.backend(path, opts, "hierarchical")

    monkeypatch.setattr(sep, "_separate_demucs", fake_demucs)
    monkeypatch.setattr(sep, "_separate_hierarchical", fake_hier)

    await sep.start_worker()
    try:
        opts = SeparationOptions(model="mdx_extra_q")
        await asyncio.gather(
            sep.separate("a.wav", options=opts, mode="single"),
            sep.separate("b.wav", options=opts, mode="hierarchical"),
            sep.separate("c.wav", options=opts, mode="hierarchical"),
        )
    finally:
        sep._worker_task.cancel()
        try:
            await sep._worker_task
        except (asyncio.CancelledError, Exception):
            pass

    assert rec.max_active == 1, (
        f"backends ran {rec.max_active} at once; GPU work is not serialised"
    )
    assert sorted(rec.modes) == ["hierarchical", "hierarchical", "single"]


@pytest.mark.asyncio
async def test_hierarchical_reaches_the_hierarchical_backend(monkeypatch):
    """Routing is preserved: mode= still selects the hierarchical backend."""
    from app.services.source_separation import SeparationResult

    sep = SourceSeparator(model="mdx_extra_q")
    seen: list[str] = []
    expected = SeparationResult(
        audio_file="x.wav", model="hierarchical", stems={"vocals": "v.wav"},
        duration=1.0, computed_at="now",
    )

    async def fake_hier(path, opts):
        seen.append("hierarchical")
        return expected

    monkeypatch.setattr(sep, "_separate_hierarchical", fake_hier)

    await sep.start_worker()
    try:
        result = await sep.separate(
            "x.wav", options=SeparationOptions(model="mdx_extra_q"), mode="hierarchical"
        )
    finally:
        sep._worker_task.cancel()
        try:
            await sep._worker_task
        except (asyncio.CancelledError, Exception):
            pass

    assert seen == ["hierarchical"]
    assert result.stems == {"vocals": "v.wav"}
    assert result.error is None


@pytest.mark.asyncio
async def test_enqueue_defaults_to_single_mode():
    """A job enqueued without an explicit mode still means single-pass."""
    sep = SourceSeparator(model="mdx_extra_q")
    job = sep.enqueue("z.wav", SeparationOptions(model="mdx_extra_q"))
    assert job.mode == "single"
