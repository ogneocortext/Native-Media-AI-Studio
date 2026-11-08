"""Tests for the local F5-TTS voice-synthesis integration.

Covers the fail-open contract (missing python/wrapper/weights never crash —
they name the missing step), sentence-boundary chunking, voice-profile
resolution, the VRAM declaration (D7), the job-type wiring (D8), and route
registration. The actual F5-TTS model call is a Windows-GPU gate and is not
exercised here.
"""

import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))


def _config(tmp_path, **overrides):
    """A VoiceConfig pointed at temp dirs."""
    from app.services.voice.f5tts_adapter import VoiceConfig

    kwargs = {
        "python_exe": str(tmp_path / "no-python.exe"),
        "wrapper_script": tmp_path / "no-wrapper.py",
        "voices_dir": tmp_path / "voices",
    }
    kwargs.update(overrides)
    return VoiceConfig(**kwargs)


# ---------------------------------------------------------------------------
# Chunking
# ---------------------------------------------------------------------------


def test_chunk_text_short_single_chunk():
    from app.services.voice.text_chunking import chunk_text

    assert chunk_text("Hello world.") == ["Hello world."]


def test_chunk_text_splits_at_sentence_boundaries():
    from app.services.voice.text_chunking import chunk_text

    text = "First sentence here. " + "x" * 200 + ". Second sentence follows. Third one too."
    chunks = chunk_text(text, max_chunk_chars=120, max_total_chars=2000)
    assert len(chunks) >= 2
    for c in chunks:
        assert len(c) <= 120 or " " not in c


def test_chunk_text_oversized_sentence_clause_split():
    from app.services.voice.text_chunking import chunk_text

    long_sentence = ("word " * 100).strip() + "."
    chunks = chunk_text(long_sentence, max_chunk_chars=100, max_total_chars=5000)
    assert len(chunks) > 1
    assert all(len(c) <= 100 for c in chunks)


def test_chunk_text_rejects_empty_and_too_long():
    from app.services.voice.text_chunking import chunk_text

    with pytest.raises(ValueError, match="empty"):
        chunk_text("   ")
    with pytest.raises(ValueError, match="too long"):
        chunk_text("x" * 5000, max_total_chars=4000)


# ---------------------------------------------------------------------------
# Adapter preflight / voice resolution
# ---------------------------------------------------------------------------


def test_check_installation_fail_open_missing_python(tmp_path):
    from app.services.voice.f5tts_adapter import F5TTSAdapter

    adapter = F5TTSAdapter(_config(tmp_path))
    status = adapter.check_installation()
    assert status["installed"] is False
    assert any("python" in m for m in status["missing"])


def test_check_installation_fail_open_missing_weights(tmp_path):
    from app.services.voice.f5tts_adapter import F5TTSAdapter

    python = tmp_path / "python.exe"
    python.write_bytes(b"x")
    wrapper = tmp_path / "wrapper.py"
    wrapper.write_text("pass")
    voices = tmp_path / "voices"
    voices.mkdir()
    adapter = F5TTSAdapter(
        _config(
            tmp_path,
            python_exe=str(python),
            wrapper_script=wrapper,
            voices_dir=voices,
            hf_cache_dir=tmp_path / "hf",
        )
    )
    status = adapter.check_installation()
    assert status["installed"] is False
    assert status["weights_found"] is False
    assert any("weights" in m for m in status["missing"])


def test_resolve_voice_by_id(tmp_path):
    from app.services.voice.f5tts_adapter import F5TTSAdapter

    voices = tmp_path / "voices"
    prof = voices / "maya"
    prof.mkdir(parents=True)
    (prof / "ref.wav").write_bytes(b"RIFF")
    (prof / "ref.txt").write_text("hello there", encoding="utf-8")
    adapter = F5TTSAdapter(_config(tmp_path, voices_dir=voices))
    ref, text = adapter.resolve_voice("maya")
    assert ref.name == "ref.wav"
    assert text == "hello there"


def test_resolve_voice_profile_from_profile_json(tmp_path):
    from app.services.voice.f5tts_adapter import F5TTSAdapter

    voices = tmp_path / "voices"
    prof = voices / "bob"
    prof.mkdir(parents=True)
    (prof / "reference.flac").write_bytes(b"fLaC")
    (prof / "profile.json").write_text(
        '{"name": "Bob", "ref_text": "transcript here"}', encoding="utf-8"
    )
    adapter = F5TTSAdapter(_config(tmp_path, voices_dir=voices))
    ref, text = adapter.resolve_voice("bob")
    assert ref.name == "reference.flac"
    assert text == "transcript here"


def test_resolve_voice_explicit_pair(tmp_path):
    from app.services.voice.f5tts_adapter import F5TTSAdapter

    ref = tmp_path / "clip.wav"
    ref.write_bytes(b"RIFF")
    adapter = F5TTSAdapter(_config(tmp_path))
    path, text = adapter.resolve_voice(
        None, ref_audio_path=str(ref), ref_text="  transcript  "
    )
    assert path == ref
    assert text == "transcript"


def test_resolve_voice_rejects_partial_explicit(tmp_path):
    from app.services.voice.f5tts_adapter import F5TTSAdapter, VoiceSynthesisError

    adapter = F5TTSAdapter(_config(tmp_path))
    with pytest.raises(VoiceSynthesisError, match="both ref_audio_path and ref_text"):
        adapter.resolve_voice(None, ref_audio_path="x.wav")


def test_resolve_voice_rejects_bad_id(tmp_path):
    from app.services.voice.f5tts_adapter import F5TTSAdapter, VoiceSynthesisError

    adapter = F5TTSAdapter(_config(tmp_path))
    with pytest.raises(VoiceSynthesisError, match="Invalid voice_id"):
        adapter.resolve_voice("../escape")


def test_resolve_voice_missing_profile(tmp_path):
    from app.services.voice.f5tts_adapter import F5TTSAdapter, VoiceSynthesisError

    adapter = F5TTSAdapter(_config(tmp_path))
    with pytest.raises(VoiceSynthesisError, match="incomplete"):
        adapter.resolve_voice("ghost")


def test_list_voices_skips_incomplete(tmp_path):
    from app.services.voice.f5tts_adapter import F5TTSAdapter

    voices = tmp_path / "voices"
    good = voices / "maya"
    good.mkdir(parents=True)
    (good / "ref.wav").write_bytes(b"RIFF")
    (good / "ref.txt").write_text("hi", encoding="utf-8")
    bad = voices / "broken"
    bad.mkdir()
    (bad / "ref.wav").write_bytes(b"RIFF")  # no transcript
    adapter = F5TTSAdapter(_config(tmp_path, voices_dir=voices))
    assert [v["voice_id"] for v in adapter.list_voices()] == ["maya"]


def test_synthesize_raises_not_configured(tmp_path):
    from app.services.voice.f5tts_adapter import F5TTSAdapter, VoiceNotConfiguredError

    adapter = F5TTSAdapter(_config(tmp_path))
    with pytest.raises(VoiceNotConfiguredError, match="not ready"):
        asyncio.run(adapter.synthesize("hi", tmp_path / "o.wav", voice_id="maya"))


# ---------------------------------------------------------------------------
# VRAM handshake (D7)
# ---------------------------------------------------------------------------


def test_vram_budget_declared():
    from app.services.voice.f5tts_adapter import F5TTSAdapter
    from app.services.vram_manager import GPUWorkload, VRAMManager

    assert F5TTSAdapter.VRAM_BUDGET_MB == 2560
    assert GPUWorkload.VOICE_SYNTHESIS.value == "voice_synthesis"

    m = VRAMManager.__new__(VRAMManager)
    m._init_thresholds()
    assert m.MIN_VRAM_FOR_VOICE == 2560
    assert hasattr(m, "begin_voice_synthesis")
    assert hasattr(m, "end_voice_synthesis")


def test_vram_begin_end_voice_cycle():
    """begin sets the VOICE_SYNTHESIS workload, end restores IDLE (mocked GPU)."""
    from app.services.vram_manager import GPUWorkload, VRAMManager

    async def go():
        m = VRAMManager.__new__(VRAMManager)
        m._lock = asyncio.Lock()
        m._current_workload = GPUWorkload.IDLE
        m._ollama_loaded = True
        m._voice_synthesis_running = False
        m.MIN_VRAM_FOR_VOICE = 2560

        async def status():
            return {"free_mb": 6000}

        m.get_vram_status = status
        begun = await m.begin_voice_synthesis(vram_budget_mb=2560)
        assert begun["success"] is True
        assert m._current_workload == GPUWorkload.VOICE_SYNTHESIS
        assert m._voice_synthesis_running is True

        async def status2():
            return {"free_mb": 6000}

        m.get_vram_status = status2
        ended = await m.end_voice_synthesis()
        assert ended["success"] is True
        assert m._current_workload == GPUWorkload.IDLE
        assert m._voice_synthesis_running is False

    asyncio.run(go())


# ---------------------------------------------------------------------------
# Wiring: job type, handler registration, routes
# ---------------------------------------------------------------------------


def test_job_type_registered():
    from app.models.job import JobType

    assert JobType.VOICE_SYNTHESIS.value == "voice_synthesis"


def test_handler_registered():
    from app.models.job import JobType
    from app.queue.processor import JobProcessor

    proc = JobProcessor.__new__(JobProcessor)
    proc._handlers = {}
    proc._register_default_handlers()
    assert JobType.VOICE_SYNTHESIS in proc._handlers


def test_routes_registered():
    from app.main import app

    paths = app.openapi()["paths"]
    assert "/api/voice/synthesize" in paths
    assert "/api/voice/voices" in paths
    assert "/api/voice/status" in paths
