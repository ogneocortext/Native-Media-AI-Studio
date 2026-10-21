"""
Tests for the music-prompt analyze-reference endpoint.

Regression guard for music-track-stack-integration Follow-up 1:
POST /api/music-prompts/analyze-reference accepts an audio upload,
runs tools/audio-analysis/analyze.py, and returns {bpm, key, key_confidence,
lufs, sub_share, stereo_width, duration_s}. On any failure it degrades to
null fields — never a 500.
"""

from __future__ import annotations

import shutil
import wave

import numpy as np
import pytest

FFMPEG = shutil.which("ffmpeg")
requires_ffmpeg = pytest.mark.skipif(
    not FFMPEG, reason="ffmpeg not on PATH; analyze end-to-end skipped"
)


def _write_wav(path, duration_s=0.5, sample_rate=44100, n_channels=2):
    """Write a short stereo WAV file."""
    t = np.linspace(0, duration_s, int(sample_rate * duration_s), endpoint=False)
    samples = np.sin(2 * np.pi * 440 * t).astype(np.float32)
    if n_channels == 2:
        samples = np.column_stack([samples, samples])
    samples = np.clip(samples * 0.5, -1.0, 1.0).astype(np.float32)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(n_channels)
        w.setsampwidth(4)
        w.setframerate(sample_rate)
        w.writeframes(samples.astype("<f4").tobytes())


@pytest.mark.asyncio
async def test_analyze_reference_no_file_returns_422(client):
    """POST without a file should return 422 (FastAPI validation)."""
    resp = await client.post("/api/music-prompts/analyze-reference")
    assert resp.status_code == 422


@pytest.mark.asyncio
@requires_ffmpeg
async def test_analyze_reference_response_shape(client, tmp_path):
    """POST with a WAV file returns the AnalyzeReferenceResponse shape."""
    wav_path = tmp_path / "test.wav"
    _write_wav(wav_path, duration_s=0.5)
    with open(wav_path, "rb") as f:
        resp = await client.post(
            "/api/music-prompts/analyze-reference",
            files={"file": ("test.wav", f, "audio/wav")},
        )
    assert resp.status_code == 200
    body = resp.json()
    # All expected keys present (may be null if analyzer degrades)
    for key in (
        "bpm",
        "key",
        "key_confidence",
        "lufs",
        "sub_share",
        "stereo_width",
        "duration_s",
        "raw",
        "error",
    ):
        assert key in body


@pytest.mark.asyncio
async def test_analyze_reference_bad_file_degrades(client, tmp_path):
    """POST with a non-audio file degrades to null fields — never a 500."""
    bad_path = tmp_path / "not_audio.txt"
    bad_path.write_text("this is not audio")
    with open(bad_path, "rb") as f:
        resp = await client.post(
            "/api/music-prompts/analyze-reference",
            files={"file": ("not_audio.txt", f, "text/plain")},
        )
    assert resp.status_code == 200
    body = resp.json()
    # Degraded: fields null, error present
    assert body["bpm"] is None
    assert body["key"] is None
    assert body["error"] is not None
    assert len(body["error"]) > 0
