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
from app.services import source_separation as ss
from app.services.source_separation import SeparationOptions, SourceSeparator

_AUDIO_LIBRARY_DIR = ss.PROJECT_ROOT / "output" / "audio"


def _real_library_track(min_bytes: int = 1_000_000) -> str:
    """Newest real track from the media library, or None when there is none.

    The idempotency-cache keys hash actual audio bytes, so these queue-routing
    tests run against a real library file (several MB) instead of fixture bytes.
    Skips cleanly on machines without a populated media library.
    """
    if not _AUDIO_LIBRARY_DIR.is_dir():
        return None
    candidates: list = []
    for ext in ("*.wav", "*.mp3", "*.m4a", "*.flac"):
        for p in _AUDIO_LIBRARY_DIR.glob(ext):
            if p.is_file() and p.stat().st_size >= min_bytes:
                candidates.append(p)
    if not candidates:
        return None
    return str(max(candidates, key=lambda p: p.stat().st_mtime))


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
async def test_single_and_hierarchical_both_go_through_the_queue(monkeypatch, tmp_path):
    """Both modes must serialise: max concurrent backend calls == 1."""
    track = _real_library_track()
    if track is None:
        pytest.skip("no populated media library under output/audio")

    sep = SourceSeparator(model="mdx_extra_q")
    rec = _Recorder()

    async def fake_demucs(path, model, device, out_dir, cmd, opts):
        return await rec.backend(path, opts, "single")

    async def fake_hier(path, opts):
        return await rec.backend(path, opts, "hierarchical")

    monkeypatch.setattr(sep, "_separate_demucs", fake_demucs)
    monkeypatch.setattr(sep, "_separate_hierarchical", fake_hier)
    # This is a routing test; skip the incidental ffmpeg loudness probe on the fake wavs.
    async def fake_normalize(path):
        return path, False

    monkeypatch.setattr(ss, "normalize_audio_lufs", fake_normalize)

    await sep.start_worker()
    try:
        monkeypatch.setattr(ss, "CACHE_DIR", tmp_path / "stems-cache")
        monkeypatch.setattr(ss, "TELEMETRY_PATH", tmp_path / "stem-telemetry.json")
        opts = SeparationOptions(model="mdx_extra_q")
        await asyncio.gather(
            sep.separate(track, options=opts, mode="single"),
            sep.separate(track, options=opts, mode="hierarchical"),
            sep.separate(track, options=opts, mode="hierarchical"),
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
async def test_hierarchical_reaches_the_hierarchical_backend(monkeypatch, tmp_path):
    """Routing is preserved: mode= still selects the hierarchical backend."""
    track = _real_library_track()
    if track is None:
        pytest.skip("no populated media library under output/audio")

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
        monkeypatch.setattr(ss, "CACHE_DIR", tmp_path / "stems-cache")
        monkeypatch.setattr(ss, "TELEMETRY_PATH", tmp_path / "stem-telemetry.json")
        result = await sep.separate(
            track, options=SeparationOptions(model="mdx_extra_q"), mode="hierarchical"
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
