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


def test_split_command_handles_quoted_windows_paths():
    """Quoted args must lose their quotes but keep spaces/backslashes intact.

    Regression: shlex.split(posix=False) retained literal quote characters in
    the tokens, so subprocess re-quoting mangled any path containing spaces --
    and this repo's own root path contains spaces.
    """
    from app.services.lipsync.musetalk_adapter import _split_command

    cmd = _split_command(
        'python "C:\\my dir\\run.py" --video "D:\\a b\\v.mp4" --batch_size=4'
    )
    assert cmd == [
        "python",
        "C:\\my dir\\run.py",
        "--video",
        "D:\\a b\\v.mp4",
        "--batch_size=4",
    ]


def test_split_command_unquoted_and_single_quotes():
    from app.services.lipsync.musetalk_adapter import _split_command

    assert _split_command("ffmpeg -i in.wav -ar 16000 out.wav") == [
        "ffmpeg",
        "-i",
        "in.wav",
        "-ar",
        "16000",
        "out.wav",
    ]
    # Single quotes group too; a quote char inside the other quote style is literal.
    assert _split_command("run 'D:\\a b\\x' \"it's\"") == ["run", "D:\\a b\\x", "it's"]


def test_split_command_empty_quoted_arg_and_bad_quote():
    from app.services.lipsync.musetalk_adapter import LipSyncError, _split_command

    assert _split_command('cmd --flag "" tail') == ["cmd", "--flag", "", "tail"]
    with pytest.raises(LipSyncError, match="Unterminated quote"):
        _split_command('cmd "unterminated')


# ---------------------------------------------------------------------------
# POST /api/video/lipsync-upload — multipart staging + shared job flow
# ---------------------------------------------------------------------------

import io  # noqa: E402
from pathlib import Path  # noqa: E402

from fastapi import HTTPException  # noqa: E402


class _FakeUpload:
    """Minimal UploadFile stand-in: filename + async read()."""

    def __init__(self, data: bytes, filename: str):
        self._buf = io.BytesIO(data)
        self.filename = filename

    async def read(self, n: int = -1) -> bytes:
        return self._buf.read(n)


def _patched_upload_root(monkeypatch, tmp_path):
    """Point the lazy PROJECT_ROOT import at a temp tree."""
    import app.core.config as cfg

    monkeypatch.setattr(cfg, "PROJECT_ROOT", tmp_path)


def test_lipsync_upload_route_registered():
    from app.api.video import router

    paths = [r.path for r in router.routes]
    assert "/api/video/lipsync-upload" in paths


def test_store_lipsync_upload_stages_uuid_name(monkeypatch, tmp_path):
    import asyncio

    from app.api import video as video_api

    _patched_upload_root(monkeypatch, tmp_path)
    dest = asyncio.run(
        video_api._store_lipsync_upload(
            _FakeUpload(b"RIFFfake", "my song.TAKE.wav"), {".wav"}, "audio"
        )
    )
    # Client filename never survives — stored name is a bare uuid + ext.
    assert dest.parent == tmp_path / "output" / "uploads" / "lipsync"
    assert dest.name.endswith(".wav")
    assert dest.stem != "my song.TAKE"
    assert len(dest.stem) == 32  # uuid4().hex
    assert dest.read_bytes() == b"RIFFfake"


def test_store_lipsync_upload_rejects_bad_extension(monkeypatch, tmp_path):
    import asyncio

    from app.api import video as video_api

    _patched_upload_root(monkeypatch, tmp_path)
    with pytest.raises(HTTPException) as ei:
        asyncio.run(
            video_api._store_lipsync_upload(
                _FakeUpload(b"MZ", "evil.exe"), {".wav", ".mp3"}, "audio"
            )
        )
    assert ei.value.status_code == 400
    # Traversal-looking names are just bad extensions here — nothing written.
    assert not (tmp_path / "output" / "uploads").exists() or not any(
        (tmp_path / "output" / "uploads").rglob("*")
    )


def test_store_lipsync_upload_size_cap_413(monkeypatch, tmp_path):
    import asyncio

    from app.api import video as video_api

    _patched_upload_root(monkeypatch, tmp_path)
    monkeypatch.setattr(video_api, "_LIPSYNC_UPLOAD_MAX_BYTES", 16)
    with pytest.raises(HTTPException) as ei:
        asyncio.run(
            video_api._store_lipsync_upload(
                _FakeUpload(b"x" * 64, "a.wav"), {".wav"}, "audio"
            )
        )
    assert ei.value.status_code == 413


def test_lipsync_upload_rejects_image_plus_video_path():
    """image upload + video_path is ambiguous -> 400 before any staging."""
    import asyncio

    from app.api import video as video_api

    with pytest.raises(HTTPException) as ei:
        asyncio.run(
            video_api.lipsync_upload(
                audio=_FakeUpload(b"wav", "a.wav"),
                image=_FakeUpload(b"png", "p.png"),
                video_path="D:\\clip.mp4",
            )
        )
    assert ei.value.status_code == 400


def test_lipsync_upload_passes_staged_paths_to_enqueue(monkeypatch, tmp_path):
    """Staged audio/image paths land in the shared enqueue call unchanged."""
    import asyncio

    from app.api import video as video_api

    _patched_upload_root(monkeypatch, tmp_path)
    captured = {}

    async def fake_enqueue(**kwargs):
        captured.update(kwargs)
        return video_api.LipSyncResponse(success=True, job_id="j1")

    monkeypatch.setattr(video_api, "_enqueue_lipsync", fake_enqueue)
    resp = asyncio.run(
        video_api.lipsync_upload(
            audio=_FakeUpload(b"wavdata", "take.wav"),
            image=_FakeUpload(b"pngdata", "still.PNG"),
            video_path=None,
            image_path=None,
            output_path=None,
            section="hook",
        )
    )
    assert resp.success is True
    assert captured["section"] == "hook"
    assert captured["video_path"] is None
    assert captured.get("audio_filename") is None
    audio_path = captured["audio_path"]
    image_path = captured["image_path"]
    assert audio_path.endswith(".wav") and Path(audio_path).is_file()
    assert image_path.endswith(".png") and Path(image_path).is_file()
    # Both staged under the dedicated uploads dir, uuid names only.
    assert "lipsync" in audio_path and "lipsync" in image_path


def test_uploads_dir_excluded_from_media_scan():
    from app.api.outputs_scanner import _SCAN_EXCLUDE_DIRS

    assert "uploads" in _SCAN_EXCLUDE_DIRS
